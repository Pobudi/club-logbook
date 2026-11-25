// AKŻ AGH — self-hosted backend.
// Serves the static site and the small document/photo store that the page uses on claude.ai,
// so voyages, slide layouts, framing, authors and photos persist in DATA_DIR (a Docker volume).
// No dependencies: Node's standard library only.
"use strict";
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");

const PORT = +process.env.PORT || 8080;
const DATA = process.env.DATA_DIR || "/data";
const PUB = process.env.PUBLIC_DIR || path.join(__dirname, "public");
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const MAX_UPLOAD = (+process.env.MAX_UPLOAD_MB || 20) * 1048576;
const UPLOADS_PER_DAY = +process.env.UPLOADS_PER_DAY || 300;      // per IP, for non-admins
const SESSION_H = +process.env.SESSION_HOURS || 72;
const MIN_FREE = (+process.env.MIN_FREE_MB || 500) * 1048576;     // writes are refused below this much free disk
const DBF = path.join(DATA, "db.json"), BLOBS = path.join(DATA, "blobs"), SNAP = path.join(DATA, "snapshots");
for (const d of [DATA, BLOBS, SNAP]) fs.mkdirSync(d, {recursive: true});

// ---------- document store ----------
let DB = {};
try { DB = JSON.parse(fs.readFileSync(DBF, "utf8")); }
catch (e) { if (e.code !== "ENOENT") { console.error("db.json is unreadable — refusing to start so nothing gets overwritten:", e.message); process.exit(1); } }

const backup = require("./github-backup.js")({DATA, BLOBS, DBF});

// ---------- disk space: refuse a write rather than lose it ----------
const diskFree = () => { try { const s = fs.statfsSync(DATA); return {free: s.bavail * s.bsize, total: s.blocks * s.bsize}; } catch (e) { return {free: Infinity, total: 0}; } };
const roomFor = bytes => diskFree().free - bytes > MIN_FREE;
const DISK_FULL = Object.assign(new Error("disk_full"), {status: 507});
const blobBytes = () => fs.readdirSync(BLOBS).reduce((n, f) => { try { return n + fs.statSync(path.join(BLOBS, f)).size; } catch (e) { return n; } }, 0);

// writes are queued; a failed write rejects for its caller (who then reports it) without blocking later ones
let saving = Promise.resolve();
const save = () => { const p = saving.then(() => {
  if (!roomFor(Buffer.byteLength(JSON.stringify(DB)) * 2)) throw DISK_FULL;
  const tmp = DBF + ".tmp", body = JSON.stringify(DB);
  const fd = fs.openSync(tmp, "w"); fs.writeSync(fd, body); fs.fsyncSync(fd); fs.closeSync(fd);
  fs.renameSync(tmp, DBF);
  // one snapshot per day, last 30 kept
  const day = new Date().toISOString().slice(0, 10), snap = path.join(SNAP, `db-${day}.json`);
  if (!fs.existsSync(snap)) { fs.writeFileSync(snap, body);
    fs.readdirSync(SNAP).filter(f => f.startsWith("db-")).sort().slice(0, -30).forEach(f => fs.unlinkSync(path.join(SNAP, f))); }
}); saving = p.catch(e => console.error("save failed:", e.message)); p.then(() => backup.data(), () => {}); return p; };

const SEG = /^[^\/\s.][^\/\s]{0,159}$/;
const validDoc = p => typeof p === "string" && p.split("/").length === 2 && p.split("/").every(s => SEG.test(s));
const validCol = p => typeof p === "string" && SEG.test(p);

// ---------- events (live updates for open pages) ----------
const clients = new Set();
const broadcast = p => { const msg = `data: ${JSON.stringify({path: p})}\n\n`; for (const r of clients) r.write(msg); };
setInterval(() => { for (const r of clients) r.write(": ping\n\n"); }, 25000);

// ---------- accounts and sessions ----------
// sessions survive restarts and redeploys; only a hash of each token is stored
const SESSF = path.join(DATA, "sessions.json"), tokHash = t => crypto.createHash("sha256").update(t).digest("hex");
const sessions = new Map(); try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(SESSF, "utf8")))) if (v.exp > Date.now()) sessions.set(k, v); } catch (e) {}
let sessT = null; const saveSessions = () => { clearTimeout(sessT); sessT = setTimeout(() => {
  try { fs.writeFileSync(SESSF + ".tmp", JSON.stringify(Object.fromEntries(sessions))); fs.renameSync(SESSF + ".tmp", SESSF); } catch (e) { console.error("sessions not saved:", e.message); } }, 200); };
const b64 = buf => Buffer.from(buf).toString("base64");
const hashPw = (pw, salt, iter) => b64(crypto.pbkdf2Sync(pw, Buffer.from(salt, "base64"), iter, 32, "sha256"));
const accounts = () => ((DB["config/admins"] || {}).accounts || []);
if (!accounts().length && process.env.ADMIN_LOGIN && (process.env.ADMIN_PASSWORD || "").length >= 8) {
  const salt = b64(crypto.randomBytes(16));
  DB["config/admins"] = {accounts: [{login: process.env.ADMIN_LOGIN, salt, hash: hashPw(process.env.ADMIN_PASSWORD, salt, 150000), iter: 150000}]};
  save(); console.log(`created admin account "${process.env.ADMIN_LOGIN}"`);
}

// simple fixed-window rate limits
const buckets = new Map();
const limited = (key, max, ms) => { const now = Date.now(); let b = buckets.get(key);
  if (!b || b.reset < now) { b = {n: 0, reset: now + ms}; buckets.set(key, b); } return ++b.n > max; };
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
  let gone = 0; for (const [t, s] of sessions) if (s.exp < now) { sessions.delete(t); gone++; } if (gone) saveSessions(); }, 600000);

const cookies = req => Object.fromEntries((req.headers.cookie || "").split(";").map(c => c.trim().split("=")).filter(c => c[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]));
const ipOf = req => (TRUST_PROXY && (req.headers["x-forwarded-for"] || "").split(",")[0].trim()) || req.socket.remoteAddress;
const secure = req => process.env.COOKIE_SECURE === "1" || (TRUST_PROXY && req.headers["x-forwarded-proto"] === "https");
const setCookie = (req, res, name, val, maxAge) => {
  const c = `${name}=${encodeURIComponent(val)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure(req) ? "; Secure" : ""}`;
  const prev = res.getHeader("Set-Cookie"); res.setHeader("Set-Cookie", prev ? [].concat(prev, c) : c);
};
const ctxOf = (req, res) => {
  const ck = cookies(req); let vid = ck.akz_v;
  if (!/^[a-f0-9]{32}$/.test(vid || "")) { vid = crypto.randomBytes(16).toString("hex"); setCookie(req, res, "akz_v", vid, 31536000); }
  const s = ck.akz_s && sessions.get(tokHash(ck.akz_s)); const admin = !!(s && s.exp > Date.now() && accounts().some(a => a.login === s.login));
  if (admin && s.exp - Date.now() < SESSION_H * 3600e3 - 600e3) { s.exp = Date.now() + SESSION_H * 3600e3; saveSessions(); setCookie(req, res, "akz_s", ck.akz_s, SESSION_H * 3600); }
  return {uid: "v_" + vid, admin, login: admin ? s.login : null, ip: ipOf(req)};
};

// who may read and write what (mirrors the rules on claude.ai)
const canRead = (p, c) => { const [col, id] = p.split("/");
  if (col === "config") return c.admin; if (col === "submissions") return c.admin || id === c.uid; return true; };
const canList = (col, c) => (col === "config" || col === "submissions") ? c.admin : true;
const canWrite = (p, c) => c.admin || p === "submissions/" + c.uid;

// ---------- http helpers ----------
const CSP = "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob: https://server.arcgisonline.com; connect-src 'self' https://server.arcgisonline.com";
const send = (res, code, body, type = "application/json; charset=utf-8", extra = {}) => {
  res.writeHead(code, {"Content-Type": type, "Cache-Control": "no-store", ...extra}); res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const readBody = (req, limit) => new Promise((ok, bad) => { const parts = []; let n = 0;
  req.on("data", d => { n += d.length; if (n > limit) { bad(Object.assign(new Error("too large"), {status: 413})); req.destroy(); } else parts.push(d); });
  req.on("end", () => ok(Buffer.concat(parts))); req.on("error", bad); });
const readJson = async (req, limit) => { try { return JSON.parse((await readBody(req, limit)).toString("utf8")); } catch (e) { throw e.status ? e : Object.assign(new Error("bad json"), {status: 400}); } };
const imageType = b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? "image/jpeg" : b.slice(0, 4).toString("hex") === "89504e47" ? "image/png"
  : b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WEBP" ? "image/webp" : b.slice(0, 4).toString() === "GIF8" ? "image/gif" : null;
const blobPath = id => /^[a-f0-9]{32}$/.test(id) ? path.join(BLOBS, id) : null;

// ---------- backup (tar: db.json + blobs/<id>) ----------
const tarHeader = (name, size) => { const h = Buffer.alloc(512);
  h.write(name, 0, 100); h.write("0000644\0", 100); h.write("0000000\0", 108); h.write("0000000\0", 116);
  h.write(size.toString(8).padStart(11, "0") + "\0", 124); h.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, "0") + "\0", 136);
  h.write("        ", 148); h.write("0", 156); h.write("ustar\0", 257); h.write("00", 263);
  let sum = 0; for (const x of h) sum += x; h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148); return h; };
const tarEntry = (res, name, buf) => { res.write(tarHeader(name, buf.length)); res.write(buf); const pad = (512 - buf.length % 512) % 512; if (pad) res.write(Buffer.alloc(pad)); };
const exportTar = res => {
  res.writeHead(200, {"Content-Type": "application/x-tar", "Content-Disposition": `attachment; filename="akz-kopia-${new Date().toISOString().slice(0, 10)}.tar"`, "Cache-Control": "no-store"});
  tarEntry(res, "db.json", Buffer.from(JSON.stringify(DB)));
  for (const f of fs.readdirSync(BLOBS)) if (!f.endsWith(".part")) tarEntry(res, "blobs/" + f, fs.readFileSync(path.join(BLOBS, f)));
  res.end(Buffer.alloc(1024));
};
// Merges a backup into the store: its documents replace ones with the same path, photos are added. Nothing else is removed.
const importTar = file => {
  const fd = fs.openSync(file, "r"), size = fs.fstatSync(fd).size, h = Buffer.alloc(512); let pos = 0, docs = 0, blobs = 0, db = null;
  try {
    while (pos + 512 <= size) {
      fs.readSync(fd, h, 0, 512, pos); if (h.every(x => x === 0)) break;
      const name = (h.toString("utf8", 345, 500).replace(/\0.*$/s, "") ? h.toString("utf8", 345, 500).replace(/\0.*$/s, "") + "/" : "") + h.toString("utf8", 0, 100).replace(/\0.*$/s, "");
      const len = parseInt(h.toString("utf8", 124, 136).replace(/\0.*$/s, "").trim() || "0", 8), type = String.fromCharCode(h[156] || 48);
      const clean = name.replace(/^\.\//, "");
      if (type === "0" || type === "\0") {
        const buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, pos + 512);
        if (clean === "db.json") db = JSON.parse(buf.toString("utf8"));
        else { const m = /^blobs\/([a-f0-9]{32})$/.exec(clean); if (m && imageType(buf)) { fs.writeFileSync(path.join(BLOBS, m[1]), buf); blobs++; backup.photo(m[1]); } }
      }
      pos += 512 + Math.ceil(len / 512) * 512;
    }
  } finally { fs.closeSync(fd); }
  if (db) for (const [k, v] of Object.entries(db)) if (validDoc(k) && v && typeof v === "object") { DB[k] = v; docs++; }
  save(); broadcast("*"); return {docs, blobs};
};
// the same, from the JSON the claude.ai version copies to the clipboard: {format:"akz-backup", docs:{path:data}, blobs:{id:base64}}
const importJson = obj => { if (!obj || obj.format !== "akz-backup") throw Object.assign(new Error("not a backup"), {status: 400});
  let docs = 0, blobs = 0;
  for (const [id, b] of Object.entries(obj.blobs || {})) { const buf = Buffer.from(String(b), "base64"); if (/^[a-f0-9]{32}$/.test(id) && imageType(buf)) { fs.writeFileSync(path.join(BLOBS, id), buf); blobs++; backup.photo(id); } }
  for (const [k, v] of Object.entries(obj.docs || {})) if (validDoc(k) && !k.startsWith("config/") && v && typeof v === "object") { DB[k] = v; docs++; }
  save(); broadcast("*"); return {docs, blobs}; };
// first start: load a backup if the store is empty
if (process.env.IMPORT && !Object.keys(DB).some(k => !k.startsWith("config/")) && fs.existsSync(process.env.IMPORT)) {
  try { const f = process.env.IMPORT; console.log("imported backup:", f.endsWith(".json") ? importJson(JSON.parse(fs.readFileSync(f, "utf8"))) : importTar(f)); } catch (e) { console.error("import failed:", e.message); }
}

// ---------- static files ----------
const TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp", ".ico": "image/x-icon", ".tar": "application/x-tar"};
const serveStatic = (req, res, url) => {
  let rel = decodeURIComponent(url.pathname); if (rel.endsWith("/")) rel += "index.html";
  const file = path.join(PUB, path.normalize(rel).replace(/^(\.\.[\/\\])+/, ""));
  if (!file.startsWith(PUB + path.sep)) return send(res, 403, "forbidden", "text/plain");
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, "nie znaleziono", "text/plain; charset=utf-8");
    const ext = path.extname(file), gz = /\bgzip\b/.test(req.headers["accept-encoding"] || "") && fs.existsSync(file + ".gz");
    res.writeHead(200, {"Content-Type": TYPES[ext] || "application/octet-stream", "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=86400",
      ...(gz ? {"Content-Encoding": "gzip", Vary: "Accept-Encoding"} : {})});
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(gz ? file + ".gz" : file).pipe(res);
  });
};

// ---------- routes ----------
const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Security-Policy", CSP); res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  const url = new URL(req.url, "http://x"), P = url.pathname, M = req.method;
  try {
    if (P === "/healthz") return send(res, 200, "ok\n", "text/plain");
    if (P.startsWith("/_blob/")) { const f = blobPath(P.slice(7)); if (!f || !fs.existsSync(f)) return send(res, 404, "nie znaleziono", "text/plain; charset=utf-8");
      const head = Buffer.alloc(12); const fd = fs.openSync(f, "r"); fs.readSync(fd, head, 0, 12, 0); fs.closeSync(fd);
      res.writeHead(200, {"Content-Type": imageType(head) || "application/octet-stream", "Cache-Control": "public, max-age=31536000, immutable"});
      return fs.createReadStream(f).pipe(res); }
    if (!P.startsWith("/api/")) return (M === "GET" || M === "HEAD") ? serveStatic(req, res, url) : send(res, 405, {error: "method"});

    const c = ctxOf(req, res);
    // state-changing calls must come from the page itself (custom header => no cross-site form posts)
    if (M !== "GET" && req.headers["x-akz"] !== "1") return send(res, 403, {error: "csrf"});

    if (P === "/api/me") return send(res, 200, {admin: c.admin, login: c.login, uid: c.uid, accounts: accounts().length > 0,
      ...(c.admin ? {disk: {...diskFree(), photos: blobBytes(), reserve: MIN_FREE}, backup: backup.status} : {})});
    if (P === "/api/events") {
      res.writeHead(200, {"Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no"});
      res.write("retry: 3000\n\n"); clients.add(res); req.on("close", () => clients.delete(res)); return; }
    if (P === "/api/login" && M === "POST") {
      if (limited("login:" + c.ip, 10, 900e3)) return send(res, 429, {error: "too_many"});
      const {login, password} = await readJson(req, 4096); if (!accounts().length) return send(res, 409, {error: "no_accounts"});
      const a = accounts().find(x => x.login.toLowerCase() === String(login || "").toLowerCase());
      const ok = a && crypto.timingSafeEqual(Buffer.from(hashPw(String(password || ""), a.salt, a.iter || 150000)), Buffer.from(a.hash));
      if (!ok) return send(res, 401, {error: "bad_credentials"});
      const t = crypto.randomBytes(32).toString("hex"); sessions.set(tokHash(t), {login: a.login, exp: Date.now() + SESSION_H * 3600e3}); saveSessions();
      setCookie(req, res, "akz_s", t, SESSION_H * 3600); return send(res, 200, {login: a.login}); }
    if (P === "/api/logout" && M === "POST") { const t = cookies(req).akz_s; if (t) { sessions.delete(tokHash(t)); saveSessions(); } setCookie(req, res, "akz_s", "", 0); return send(res, 200, {}); }

    if (P === "/api/doc") { const p = url.searchParams.get("path"); if (!validDoc(p)) return send(res, 400, {error: "path"});
      if (M === "GET") { if (!canRead(p, c)) return send(res, 403, {error: "permission_denied"}); return send(res, 200, {exists: p in DB, data: DB[p] ?? null}); }
      if (!canWrite(p, c)) return send(res, 403, {error: "permission_denied"});
      if (M === "PUT") { const d = await readJson(req, c.admin ? 2097152 : 262144); if (!d || typeof d !== "object" || Array.isArray(d)) return send(res, 400, {error: "data"});
        const had = p in DB, prev = DB[p]; DB[p] = d;
        try { await save(); } catch (e) { if (had) DB[p] = prev; else delete DB[p]; throw e.status ? e : DISK_FULL; }
        broadcast(p); return send(res, 200, {}); }
      if (M === "DELETE") { const prev = DB[p]; delete DB[p];
        try { await save(); } catch (e) { if (prev !== undefined) DB[p] = prev; throw e.status ? e : DISK_FULL; }
        broadcast(p); return send(res, 200, {}); }
      return send(res, 405, {error: "method"}); }
    if (P === "/api/col" && M === "GET") { const col = url.searchParams.get("path"); if (!validCol(col)) return send(res, 400, {error: "path"});
      if (!canList(col, c)) return send(res, 403, {error: "permission_denied"});
      return send(res, 200, Object.keys(DB).filter(k => k.startsWith(col + "/")).map(k => ({id: k.slice(col.length + 1), data: DB[k]}))); }

    if (P === "/api/assets" && M === "POST") {
      if (!c.admin && limited("up:" + c.ip, UPLOADS_PER_DAY, 86400e3)) return send(res, 429, {error: "too_many"});
      if (!roomFor(+req.headers["content-length"] || MAX_UPLOAD)) throw DISK_FULL;
      const buf = await readBody(req, MAX_UPLOAD), type = imageType(buf); if (!type) return send(res, 415, {error: "not_an_image"});
      if (!roomFor(buf.length)) throw DISK_FULL;
      const id = crypto.randomBytes(16).toString("hex"), file = path.join(BLOBS, id), tmp = file + ".part";
      try { const fd = fs.openSync(tmp, "w"); fs.writeSync(fd, buf); fs.fsyncSync(fd); fs.closeSync(fd); fs.renameSync(tmp, file); }
      catch (e) { fs.rm(tmp, {force: true}, () => {}); console.error("photo not saved:", e.message); throw e.code === "ENOSPC" ? DISK_FULL : e; }
      backup.photo(id);
      return send(res, 200, {id, url: "/_blob/" + id, contentType: type, sizeBytes: buf.length}); }

    if (P === "/api/export" && M === "GET") { if (!c.admin) return send(res, 403, {error: "permission_denied"}); return exportTar(res); }
    if (P === "/api/import" && M === "POST") { if (!c.admin) return send(res, 403, {error: "permission_denied"});
      const tmp = path.join(DATA, `import-${Date.now()}.tar`);
      await new Promise((ok, bad) => { const w = fs.createWriteStream(tmp); req.pipe(w); w.on("finish", ok); w.on("error", bad); req.on("error", bad); });
      try { const json = /json/.test(req.headers["content-type"] || "");
        return send(res, 200, json ? importJson(JSON.parse(fs.readFileSync(tmp, "utf8"))) : importTar(tmp)); }
      catch (e) { throw e.status ? e : Object.assign(new Error("bad backup"), {status: 400}); }
      finally { fs.unlink(tmp, () => {}); } }

    return send(res, 404, {error: "not_found"});
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, {error: e.status ? e.message : "server"}); else res.end();
    if (!e.status) console.error(e);
  }
});
server.listen(PORT, () => console.log(`AKŻ AGH listening on :${PORT}, data in ${DATA}`));
const stop = () => { server.close(); saving.finally(() => process.exit(0)); };
process.on("SIGTERM", stop); process.on("SIGINT", stop);
