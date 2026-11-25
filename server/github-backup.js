// Off-site backup: every photo and the data file (db.json) are copied to a private GitHub repo.
// Layout in the repo matches the admin panel's backup file: db.json + blobs/<id>, so a clone can be
// packed with `tar -cf kopia.tar db.json blobs` and loaded back through "Wczytaj kopię z pliku".
// Enabled when GITHUB_BACKUP_REPO (owner/name) and GITHUB_BACKUP_TOKEN (fine-grained, Contents: read & write
// on that repo only) are set. Pending uploads are kept in a queue file, so nothing is lost while GitHub is
// unreachable or the server restarts. Uses only Node's standard library.
"use strict";
const fs = require("fs"), path = require("path"), http = require("http"), https = require("https");
const API = new URL(process.env.GITHUB_API_URL || "https://api.github.com");   // overridable for tests

module.exports = function githubBackup({DATA, BLOBS, DBF, log = console.log}) {
  const REPO = process.env.GITHUB_BACKUP_REPO, TOKEN = process.env.GITHUB_BACKUP_TOKEN, BRANCH = process.env.GITHUB_BACKUP_BRANCH || "main";
  const status = {enabled: !!(REPO && TOKEN), repo: REPO || null, queued: 0, photos: 0, lastOk: null, lastError: null, dbPending: false};
  if (!status.enabled) return {status, photo() {}, data() {}};

  const QF = path.join(DATA, "backup-queue.json");
  let queue = []; try { queue = JSON.parse(fs.readFileSync(QF, "utf8")); } catch (e) {}
  const saveQ = () => { try { fs.writeFileSync(QF + ".tmp", JSON.stringify(queue)); fs.renameSync(QF + ".tmp", QF); } catch (e) {} status.queued = queue.length; };
  status.queued = queue.length;

  const gh = (method, p, body) => new Promise((ok, bad) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = (API.protocol === "http:" ? http : https).request({host: API.hostname, port: API.port || undefined, path: p, method, timeout: 120000, headers: {
      "Authorization": "Bearer " + TOKEN, "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "akz-agh-backup", ...(data ? {"Content-Type": "application/json", "Content-Length": data.length} : {})}}, res => {
      const parts = []; res.on("data", d => parts.push(d));
      res.on("end", () => { const t = Buffer.concat(parts).toString(); let j = null; try { j = JSON.parse(t); } catch (e) {} ok({code: res.statusCode, body: j}); });
    });
    req.on("timeout", () => req.destroy(new Error("timeout"))); req.on("error", bad);
    if (data) req.write(data); req.end();
  });
  const contents = f => `/repos/${REPO}/contents/${f}`;
  const put = async (file, buf, message) => {
    let sha;
    const cur = await gh("GET", contents(file) + "?ref=" + BRANCH);
    if (cur.code === 200 && cur.body) sha = cur.body.sha;
    const r = await gh("PUT", contents(file), {message, content: buf.toString("base64"), branch: BRANCH, ...(sha ? {sha} : {})});
    if (r.code !== 200 && r.code !== 201) throw new Error(`GitHub ${r.code}: ${(r.body && r.body.message) || ""}`);
  };

  let busy = false, dbDirty = false, dbTimer = null;
  const pump = async () => {
    if (busy) return; busy = true;
    try {
      while (queue.length) {
        const id = queue[0], f = path.join(BLOBS, id);
        if (fs.existsSync(f)) await put("blobs/" + id, fs.readFileSync(f), "photo " + id);
        queue.shift(); saveQ(); status.photos++; status.lastOk = new Date().toISOString(); status.lastError = null;
      }
      if (dbDirty) {
        dbDirty = false;
        try { await put("db.json", fs.readFileSync(DBF), "data " + new Date().toISOString().slice(0, 16).replace("T", " ")); }
        catch (e) { dbDirty = true; throw e; }
        status.dbPending = false; status.lastOk = new Date().toISOString(); status.lastError = null; }
    } catch (e) {
      status.lastError = e.message; log("backup to GitHub failed, will retry:", e.message);
      setTimeout(pump, +process.env.GITHUB_BACKUP_RETRY_MS || 5 * 60000);   // GitHub down or token wrong: try again later
    } finally { busy = false; }
  };

  // catch up on start: anything on disk that the repo doesn't have yet goes into the queue
  const catchUp = async () => {
    try {
      const r = await gh("GET", `/repos/${REPO}/git/trees/${BRANCH}?recursive=1`);
      // 404/409: repo or branch still empty; anything else: GitHub unreachable, compare again later
      if (r.code !== 200 && r.code !== 404 && r.code !== 409) throw new Error(`GitHub ${r.code}: ${(r.body && r.body.message) || ""}`);
      const have = new Set(r.code === 200 && r.body && r.body.tree ? r.body.tree.map(t => t.path) : []);
      const missing = fs.readdirSync(BLOBS).filter(f => /^[a-f0-9]{32}$/.test(f) && !have.has("blobs/" + f) && !queue.includes(f));
      queue.push(...missing); saveQ();
      status.photos = [...have].filter(p => p.startsWith("blobs/")).length;
      if (!have.has("db.json") && fs.existsSync(DBF)) dbDirty = true;
      log(`backup to GitHub: ${REPO}, ${status.photos} photos there, ${queue.length} to send`);
    } catch (e) { status.lastError = e.message; log("backup to GitHub: can't reach the repo yet:", e.message); setTimeout(catchUp, +process.env.GITHUB_BACKUP_RETRY_MS || 5 * 60000); }
    pump();
  };
  catchUp();

  return {
    status,
    photo(id) { queue.push(id); saveQ(); pump(); },
    // data changes come in bursts (editing a slide): send at most once a minute
    data() { status.dbPending = true; if (dbTimer) return; dbTimer = setTimeout(() => { dbTimer = null; dbDirty = true; pump(); }, 60000); }
  };
};
