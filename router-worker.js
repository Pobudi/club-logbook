// Sea routing between ports, run in a Web Worker.
// Each hop gets its own raster of the land polygons (longitude cells scaled by cos(lat)),
// plotter GPX lines are burned in as water and made cheap, A* finds the path,
// and string-pulling straightens it as far as open water allows.
let LAND = [];
const bboxOf = r => { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const [x, y] of r) { if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y; } return [a, b, c, d]; };

onmessage = e => {
  const m = e.data;
  if (m.type === "land") { LAND = m.polys.map(rings => ({rings, bb: bboxOf(rings[0])})); postMessage({type: "ready"}); return; }
  if (m.type === "route") {
    const gpx = (m.gpx || []).map(l => ({l, bb: bboxOf(l)}));
    const out = [];
    m.hops.forEach(([a, b], i) => {
      let c;
      try { c = hop(a, b, gpx); } catch (err) { c = [a, b]; }
      out.push(c);
      postMessage({type: "progress", done: i + 1, total: m.hops.length});
    });
    postMessage({type: "done", id: m.id, routes: out});
  }
};

function hop(a, b, gpx) {
  const [x1, y1] = a, [x2, y2] = b, R = Math.PI / 180;
  const span = Math.max(Math.abs(y2 - y1), Math.abs(x2 - x1) * Math.cos((y1 + y2) / 2 * R));
  const pad = Math.max(0.5, 0.35 * span);
  const S = Math.min(y1, y2) - pad, N = Math.max(y1, y2) + pad, k = Math.cos((S + N) / 2 * R);
  const W = Math.min(x1, x2) - pad / k, E = Math.max(x1, x2) + pad / k;
  let res = 0.004, nx, ny;
  const size = () => { nx = Math.ceil((E - W) / (res / k)) + 1; ny = Math.ceil((N - S) / res) + 1; };
  size();
  const MAXC = 1.4e6;
  if (nx * ny > MAXC) { res *= Math.sqrt(nx * ny / MAXC); size(); }
  const rx = res / k, n = nx * ny;
  const U = x => (x - W) / rx, V = y => (N - y) / res;

  // land raster
  const cv = new OffscreenCanvas(nx, ny), g = cv.getContext("2d", {willReadFrequently: true});
  g.fillStyle = "#000"; g.fillRect(0, 0, nx, ny); g.fillStyle = "#fff";
  for (const p of LAND) {
    if (p.bb[2] < W || p.bb[0] > E || p.bb[3] < S || p.bb[1] > N) continue;
    g.beginPath();
    for (const r of p.rings) { r.forEach(([x, y], i) => i ? g.lineTo(U(x), V(y)) : g.moveTo(U(x), V(y))); g.closePath(); }
    g.fill("evenodd");
  }
  const lines = gpx.filter(q => !(q.bb[2] < W || q.bb[0] > E || q.bb[3] < S || q.bb[1] > N));
  const stroke = (ctx, w, col) => { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineJoin = ctx.lineCap = "round";
    for (const q of lines) { ctx.beginPath(); q.l.forEach(([x, y], i) => i ? ctx.lineTo(U(x), V(y)) : ctx.moveTo(U(x), V(y))); ctx.stroke(); } };
  stroke(g, 3, "#000");
  const L = new Uint8Array(n), C = new Uint8Array(n);
  { const d = g.getImageData(0, 0, nx, ny).data; for (let i = 0; i < n; i++) L[i] = d[i * 4] > 127 ? 1 : 0; }
  if (lines.length) {
    const c2 = new OffscreenCanvas(nx, ny), h = c2.getContext("2d", {willReadFrequently: true});
    h.fillStyle = "#000"; h.fillRect(0, 0, nx, ny); stroke(h, 5, "#fff");
    const d = h.getImageData(0, 0, nx, ny).data; for (let i = 0; i < n; i++) C[i] = d[i * 4] > 127 ? 1 : 0;
  }

  // nearness to land (box blur twice), so routes keep an offshore line
  const r = Math.max(2, Math.round(2.5 / (res * 111)));
  let P = new Float32Array(n); for (let i = 0; i < n; i++) P[i] = L[i];
  const blur = (src, horiz) => {
    const out = new Float32Array(n), len = horiz ? nx : ny, lines2 = horiz ? ny : nx, w = 2 * r + 1;
    for (let l = 0; l < lines2; l++) {
      const at = t => horiz ? l * nx + t : t * nx + l;
      let s = 0;
      for (let t = -r; t <= r; t++) s += src[at(Math.min(len - 1, Math.max(0, t)))];
      for (let t = 0; t < len; t++) {
        out[at(t)] = s / w;
        s += src[at(Math.min(len - 1, t + r + 1))] - src[at(Math.max(0, t - r))];
      }
    }
    return out;
  };
  P = blur(blur(blur(blur(P, true), false), true), false);
  const cost = new Float32Array(n);
  for (let i = 0; i < n; i++) cost[i] = L[i] ? 1e6 : C[i] ? 0.5 : 1 + 6 * Math.min(1, P[i] * 2.5);

  const cellOf = (x, y) => [Math.min(ny - 1, Math.max(0, Math.floor(V(y)))), Math.min(nx - 1, Math.max(0, Math.floor(U(x))))];
  const snap = ([rr, cc]) => {
    if (!L[rr * nx + cc]) return rr * nx + cc;
    for (let d = 1; d < 400; d++) for (let dr = -d; dr <= d; dr++) for (const dc of [-d, d]) {
      const a1 = rr + dr, b1 = cc + dc, a2 = rr + dc, b2 = cc + dr;
      if (a1 >= 0 && a1 < ny && b1 >= 0 && b1 < nx && !L[a1 * nx + b1]) return a1 * nx + b1;
      if (a2 >= 0 && a2 < ny && b2 >= 0 && b2 < nx && !L[a2 * nx + b2]) return a2 * nx + b2;
    }
    return rr * nx + cc;
  };
  const s0 = snap(cellOf(x1, y1)), t0 = snap(cellOf(x2, y2));
  const path = astar(cost, nx, ny, s0, t0);
  if (!path) return [a, b];

  // string pulling
  const pr = path.map(i => (i / nx) | 0), pc = path.map(i => i % nx), m = path.length;
  const cumL = new Int32Array(m + 1); for (let i = 0; i < m; i++) cumL[i + 1] = cumL[i] + L[path[i]];
  const onC = path.map(i => C[i]);
  const allC = (i, j) => { for (let q = i; q <= j; q++) if (!onC[q]) return false; return true; };
  const ok = (i, j) => {
    const cnt = Math.max(Math.abs(pr[j] - pr[i]), Math.abs(pc[j] - pc[i])) * 2 + 2;
    let land = 0, offC = false;
    for (let q = 0; q <= cnt; q++) {
      const t = q / cnt, rr = Math.round(pr[i] + (pr[j] - pr[i]) * t), cc = Math.round(pc[i] + (pc[j] - pc[i]) * t), id = rr * nx + cc;
      land += L[id]; if (!C[id]) offC = true;
    }
    if (onC[i] && onC[j] && offC && allC(i, j)) return false;
    return land <= (cumL[j + 1] - cumL[i]) * 2;
  };
  const keep = [0]; let i = 0;
  while (i < m - 1) {
    let j = i + 1, step = 1;
    while (j + step < m && ok(i, j + step)) { j += step; step *= 2; }
    while (step > 1) { step >>= 1; if (j + step < m && ok(i, j + step)) j += step; }
    keep.push(j); i = j;
  }
  const rd = v => Math.round(v * 1e4) / 1e4;
  return [a, ...keep.map(q => [rd(W + (pc[q] + .5) * rx), rd(N - (pr[q] + .5) * res)]), b];
}

function astar(cost, nx, ny, s, t) {
  const n = nx * ny, G = new Float32Array(n).fill(Infinity), from = new Int32Array(n).fill(-1), done = new Uint8Array(n);
  const tr = (t / nx) | 0, tc = t % nx, SQ = Math.SQRT2;
  const h = i => { const dr = Math.abs(((i / nx) | 0) - tr), dc = Math.abs(i % nx - tc); return 0.5 * (Math.max(dr, dc) + (SQ - 1) * Math.min(dr, dc)); };
  // binary heap
  let hk = new Float32Array(1 << 16), hv = new Int32Array(1 << 16), hn = 0;
  const push = (key, v) => {
    if (hn >= hk.length) { const k2 = new Float32Array(hk.length * 2), v2 = new Int32Array(hk.length * 2); k2.set(hk); v2.set(hv); hk = k2; hv = v2; }
    let i = hn++; while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= key) break; hk[i] = hk[p]; hv[i] = hv[p]; i = p; } hk[i] = key; hv[i] = v;
  };
  const pop = () => {
    const v = hv[0], key = hk[--hn], val = hv[hn]; let i = 0;
    while (true) { let c = 2 * i + 1; if (c >= hn) break; if (c + 1 < hn && hk[c + 1] < hk[c]) c++; if (hk[c] >= key) break; hk[i] = hk[c]; hv[i] = hv[c]; i = c; }
    hk[i] = key; hv[i] = val; return v;
  };
  G[s] = 0; push(h(s), s);
  const DR = [-1, -1, -1, 0, 0, 1, 1, 1], DC = [-1, 0, 1, -1, 1, -1, 0, 1];
  while (hn) {
    const u = pop(); if (done[u]) continue; done[u] = 1;
    if (u === t) break;
    const ur = (u / nx) | 0, uc = u % nx;
    for (let d = 0; d < 8; d++) {
      const vr = ur + DR[d], vc = uc + DC[d]; if (vr < 0 || vr >= ny || vc < 0 || vc >= nx) continue;
      const v = vr * nx + vc; if (done[v]) continue;
      const g2 = G[u] + (cost[u] + cost[v]) * 0.5 * (DR[d] && DC[d] ? SQ : 1);
      if (g2 < G[v]) { G[v] = g2; from[v] = u; push(g2 + h(v), v); }
    }
  }
  if (from[t] < 0 && s !== t) return null;
  const p = [t]; let c = t; while (c !== s) { c = from[c]; p.push(c); }
  return p.reverse();
}
