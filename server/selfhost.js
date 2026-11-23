// Self-hosted adapter: gives the page the same db / assets / user interface it has on claude.ai,
// backed by the server in server.js. Only added to index.html in the Docker image.
(() => {
  if (window.claude) return;
  const H = {"X-AKZ": "1"};
  const api = async (url, opt = {}) => {
    const r = await fetch(url, {credentials: "same-origin", ...opt, headers: {...H, ...(opt.headers || {})}});
    if (!r.ok) { let code = "error"; try { code = (await r.json()).error || code; } catch (e) {} throw Object.assign(new Error(code), {code, status: r.status}); }
    return r.json();
  };
  const q = p => encodeURIComponent(p);
  const snap = (id, exists, data) => ({id, exists, data: () => data == null ? undefined : JSON.parse(JSON.stringify(data)), metadata: {fromCache: false}});

  // live updates: the server says which path changed, listeners re-read it
  const listeners = new Set(); let es = null;
  const fireAll = () => listeners.forEach(l => l.run());
  const connect = () => { if (es) return; es = new EventSource("/api/events"); let opened = false;
    es.onopen = () => { if (opened) fireAll(); opened = true; };
    es.onmessage = e => { let p = "*"; try { p = JSON.parse(e.data).path; } catch (x) {} listeners.forEach(l => { if (p === "*" || l.match(p)) l.run(); }); }; };
  const watch = (match, run) => { const l = {match, run}; listeners.add(l); connect(); run(); return () => listeners.delete(l); };

  const doc = path => ({path, id: path.split("/").pop(),
    get: async () => { const r = await api(`/api/doc?path=${q(path)}`); return snap(path.split("/").pop(), r.exists, r.data); },
    set: async d => { await api(`/api/doc?path=${q(path)}`, {method: "PUT", headers: {"Content-Type": "application/json"}, body: JSON.stringify(d)}); },
    delete: async () => { await api(`/api/doc?path=${q(path)}`, {method: "DELETE"}); },
    onSnapshot: (next, err) => watch(p => p === path, () => doc(path).get().then(next, e => err && err(e)))});
  const collection = path => ({path, doc: id => doc(path + "/" + id),
    onSnapshot: (next, err) => watch(p => p.split("/")[0] === path, () => api(`/api/col?path=${q(path)}`).then(rows => {
      const docs = rows.map(r => snap(r.id, true, r.data)); next({docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: {fromCache: false}});
    }, e => err && err(e)))});
  const db = {doc, collection};
  const assets = {upload: async blob => api("/api/assets", {method: "POST", headers: {"Content-Type": blob.type || "application/octet-stream"}, body: blob})};

  let me = null;
  const who = async (fresh) => { if (!me || fresh) me = await api("/api/me"); return me; };
  const user = {canEdit: async () => (await who()).admin, isOwner: async () => false, id: async () => (await who()).uid, me: async () => who()};

  window.claude = {
    selfHosted: true,
    use: async name => ({db, assets, user})[name] || null,
    login: async (login, password) => { const r = await api("/api/login", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({login, password})}); await who(true); return r; },
    logout: async () => { try { await api("/api/logout", {method: "POST"}); } finally { await who(true).catch(() => {}); } },
    me: () => who(true)
  };
})();
