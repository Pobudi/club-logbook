{
// Ustaw true tylko przy hostowaniu strony samodzielnie: strony claude.ai nie ładują zewnętrznych kafelków mapy.
const SATELLITE = false;

// ---------- helpers ----------
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const NF = new Intl.NumberFormat("pl", {maximumFractionDigits: 1});
const fmt = v => NF.format(v);
const kn = v => isFinite(v) ? new Intl.NumberFormat("pl", {minimumFractionDigits: 1, maximumFractionDigits: 1}).format(v) : "—";
const rng = a => { const lo = Math.min(...a), hi = Math.max(...a); return lo === hi ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`; };
const plural = (n, one, few, many) => n === 1 ? one : (n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14)) ? few : many;
const nRejs = n => `${n} ${plural(n, "rejs", "rejsy", "rejsów")}`;
const nJacht = n => `${n} ${plural(n, "jacht", "jachty", "jachtów")}`;
const DF = new Intl.DateTimeFormat("pl", {day: "numeric", month: "long", year: "numeric"});
const dates = V => { if (!V.start) return ""; const a = new Date(V.start), b = V.end ? new Date(V.end) : a; try { return DF.formatRange(a, b); } catch (e) { return DF.format(a) + " – " + DF.format(b); } };
const dms = (v, p, n) => { const a = Math.abs(v), d = Math.floor(a), m = ((a - d) * 60).toFixed(1).replace(".", ","); return `${d}°${m.padStart(4, "0")}′${v >= 0 ? p : n}`; };
const pos = ([x, y]) => `${dms(y, "N", "S")} ${dms(x, "E", "W")}`;
const COUNTRY = {Portsmouth:"Anglia",Dover:"Anglia",Dunkierka:"Francja",Zeebrugge:"Belgia",Amsterdam:"Holandia",Helgoland:"Niemcy",Cuxhaven:"Niemcy",Hooksiel:"Niemcy",Bremerhaven:"Niemcy","Thyborøn":"Dania",Aalborg:"Dania",Marstrand:"Szwecja","Göteborg":"Szwecja",Kopenhaga:"Dania","Kåseberga":"Szwecja","Rønne":"Bornholm, Dania","Ueckermünde":"Niemcy","Szczecin Dąbie":"Polska",Szczecin:"Polska","Stępnica":"Polska","Malmö":"Szwecja",Hanstholm:"Dania","Østerby Havn (Læsø)":"Dania"};
const country = (n, c) => COUNTRY[n] || (c && c[1] > 74 && c[0] > 5 && c[0] < 35 ? "Svalbard" : c && c[0] > 4 && c[0] < 32 && c[1] > 57.9 ? "Norwegia" : "");
const fold = s => String(s).toLowerCase().replace(/ø/g, "o").replace(/æ/g, "ae").replace(/ł/g, "l").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9() -]/g, " ").replace(/\s+/g, " ").trim();
const baseName = s => fold(s).replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim();
const slug = s => fold(s).replace(/[()]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 40) || "rejs";
const NPH = 30, PH = i => `photos/p${String(((i % NPH) + NPH) % NPH).padStart(2, "0")}.jpg`;
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const ease = t => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
const merc = ([x, y]) => { const s = Math.sin(y * Math.PI / 180); return [(x + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)]; };
const unmerc = ([u, v]) => [u * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * v))) * 180 / Math.PI];
// polyline (1e5) for compact storage of tracks in the database
const enc = pts => { let out = "", px = 0, py = 0; const e = v => { v = v < 0 ? ~(v << 1) : v << 1; let s = ""; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); };
  for (const [x, y] of pts) { const X = Math.round(x * 1e5), Y = Math.round(y * 1e5); out += e(Y - py) + e(X - px); px = X; py = Y; } return out; };
const dec = str => { const pts = []; let i = 0, x = 0, y = 0; const d = () => { let r = 0, s = 0, b; do { b = str.charCodeAt(i++) - 63; r |= (b & 0x1f) << s; s += 5; } while (b >= 0x20); return r & 1 ? ~(r >> 1) : r >> 1; };
  while (i < str.length) { y += d(); x += d(); pts.push([x / 1e5, y / 1e5]); } return pts; };

// ---------- club sheet parser ----------
// Route rows: start date, end date, voyage name, route ("A -> B -> ⚓︎ C"). Boat rows: boat, hours, miles, crew.
// Rows pair up in order (blank rows inside a block keep their place, so empty pairs are skipped together).
const ALIAS = {"copenhagen":"Kopenhaga","kobenhavn":"Kopenhaga","dunkirk":"Dunkierka","dunkerque":"Dunkierka","bremershaven":"Bremerhaven","gothenburg":"Göteborg",
  "horsund":"Hornsund (Polska Stacja Polarna)","hornsund":"Hornsund (Polska Stacja Polarna)","isbjornhamna":"Hornsund (Polska Stacja Polarna)","polska stacja polarna":"Hornsund (Polska Stacja Polarna)","stacja polarna hornsund":"Hornsund (Polska Stacja Polarna)",
  "stacja polarna umk":"Kaffiøyra (Stacja Polarna UMK)","kaffioyra":"Kaffiøyra (Stacja Polarna UMK)","granica polarnej czapy lodowej":"Granica lodu (80°34,7′N)","granica lodu":"Granica lodu (80°34,7′N)",
  "nikoy":"Nikøy (Bulandet)","sorland":"Sørland (Værøy)","husoya":"Husøy (Senja)","husoy":"Husøy (Senja)","osterby havn":"Østerby Havn (Læsø)","osterby":"Østerby Havn (Læsø)","floro":"Florø","szczecin dabie":"Szczecin Dąbie",
  "nauplion":"Nafplio","nauplio":"Nafplio","pedrika":"Perdika","nexo":"Nexø","christianso":"Christiansø","trzebiez":"Trzebież"};
const DATE_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$|^(\d{4})-(\d{2})-(\d{2})$/;
const pdate = s => { const m = String(s || "").trim().match(DATE_RE); if (!m) return null;
  const [y, mo, d] = m[1] ? [+m[3], +m[2], +m[1]] : [+m[4], +m[5], +m[6]];
  const t = new Date(Date.UTC(y, mo - 1, d)); if (t.getUTCMonth() !== mo - 1 || y < 1990 || y > 2100) return null;
  return t.toISOString().slice(0, 10); };
const num = s => { s = String(s ?? "").trim().replace(/\s/g, "").replace(",", "."); return s === "" || isNaN(+s) ? null : +s; };
const splitRoute = route => {
  const body = String(route).replace(/\([^)]*\)/g, m => m.replace(/,/g, "⁣"));
  const stops = [];
  for (let t of body.split(/\s*(?:-{1,2}>|=>|→|⟶|[–—]>|,|;|\s[-–—]\s)\s*/)) {
    t = t.replace(/⁣/g, ",");
    const anchor = /⚓/.test(t);
    t = t.replace(/\[\s*⚓︎?️?\s*\]/g, "").replace(/⚓︎?️?/g, "").replace(/\[\s*\]/g, "").replace(/\s+/g, " ").trim();
    if (!t || /^\(?\s*todo\s*\)?$/i.test(t) || /^\.+$/.test(t)) continue;
    stops.push({raw: t, anchor});
  }
  return stops;
};
const parseSheet = text => {
  const rq = [], bq = [], errors = [], skipped = [];
  for (const line of String(text).replace(/\r/g, "").split("\n")) {
    if (!line.trim()) continue;
    const c = line.split("\t").map(x => x.trim());
    if (c.length >= 3 && (DATE_RE.test(c[0]) || c[0] === "") && c[2]) rq.push({start: pdate(c[0]), end: pdate(c[1]), rawDates: `${c[0]} – ${c[1] || ""}`, voy: c[2].replace(/\s+/g, " "), route: c[3] || ""});
    else if (c[0] && c.length >= 2 && !DATE_RE.test(c[0])) bq.push({name: c[0], h: num(c[1]), nm: num(c[2]), crew: num(c[3]) == null ? null : Math.round(num(c[3]))});
    else skipped.push(line);
  }
  if (!rq.length) errors.push("Nie znaleziono wierszy z trasami. Każdy wiersz trasy to: data początku, data końca, nazwa wyprawy, trasa — rozdzielone tabulatorem (tak kopiuje się z arkusza).");
  if (rq.length !== bq.length) errors.push(`Liczba wierszy z trasami (${rq.length}) nie zgadza się z liczbą wierszy z jachtami (${bq.length}). Każdej trasie odpowiada jeden wiersz: jacht, godziny, mile, liczba osób — w tej samej kolejności.`);
  const rows = [];
  rq.forEach((r, i) => { const b = bq[i]; if (!b || !r.route.trim() || b.h == null || b.nm == null) return;
    const stops = splitRoute(r.route);
    if (stops.length < 2) { errors.push(`Za mało portów w trasie: „${r.route}”.`); return; }
    const ok = !!(r.start && r.end && r.end >= r.start && (new Date(r.end) - new Date(r.start)) / 864e5 <= 60);
    rows.push({...r, ok, stops, boat: b, i: rows.length}); });
  return {rows, errors, skipped};
};
// group rows into voyages (by name) and legs (by overlapping dates; a row with bad dates joins the neighbouring leg with the same route)
const groupRows = rows => {
  const days = (a, b) => (new Date(b) - new Date(a)) / 864e5;
  const overlap = (a, b) => { const lo = a.start > b.start ? a.start : b.start, hi = a.end < b.end ? a.end : b.end;
    return hi > lo && days(lo, hi) >= 0.5 * Math.min(days(a.start, a.end), days(b.start, b.end)); };
  const out = [];
  for (const r of rows) { let V = out.find(v => fold(v.title) === fold(r.voy)); if (!V) out.push(V = {title: r.voy, legs: [], rows: []}); V.rows.push(r); }
  for (const V of out) {
    for (const r of V.rows.filter(r => r.ok)) {
      const L = V.legs.find(L => L.start && overlap(L, r));
      if (L) { L.rows.push(r); if (r.start < L.start) L.start = r.start; if (r.end > L.end) L.end = r.end; }
      else V.legs.push({start: r.start, end: r.end, rows: [r], first: r.i});
    }
    for (const r of V.rows.filter(r => !r.ok)) {
      const sig = r.names.join(">");
      const L = V.legs.find(L => L.rows.some(x => Math.abs(x.i - r.i) === 1 && x.names.join(">") === sig));
      r.joined = !!L;
      if (L) L.rows.push(r); else V.legs.push({start: null, end: null, rows: [r], first: r.i});
    }
    V.legs.sort((a, b) => a.first - b.first);
  }
  return out;
};
window.VOYAGE_LIB = {parseSheet, splitRoute, pdate, fold, baseName, enc, dec};

// ---------- start ----------
const stepsEl = $("#steps"), nav = $(".nav"), cnt = $("#cnt"), prev = $("#prev"), next = $("#next"), homebtn = $("#homebtn");
const lb = $("#lb"), lbi = lb.querySelector("img");

const showErr = msg => { let b = document.getElementById("errbox"); if (!b) { b = document.createElement("div"); b.id = "errbox"; b.setAttribute("role", "alert"); document.body.append(b); } b.textContent = "Błąd strony: " + msg; };
addEventListener("error", e => showErr(e.message || "nieznany"));
addEventListener("unhandledrejection", e => showErr((e.reason && (e.reason.message || e.reason.code)) || String(e.reason)));
new Promise((res, rej) => { if (window.SEED && window.BASE && window.maplibregl) res([window.SEED, window.BASE]); else rej(new Error("nie wczytano danych mapy")); }).then(([SEED, land]) => {
  if (maplibregl.setWorkerUrl) maplibregl.setWorkerUrl("maplibre-gl-csp-worker.js");
  let DBV = [], META = {}, VOY = [];
  let db = null, assets = null, isAdmin = false;
  // voyage -> legs -> {routes: [{stops, hops}], boats: [{name, crew, h, nm, route}]}; older saved voyages are converted
  const norm = v => {
    if (!v.legs || !v.legs.length || v.legs[0].routes) return v;
    const ys = v.yachts || [];
    return {...v, legs: v.legs.map((l, li) => ({start: null, end: null, routes: [{stops: l.stops, hops: l.hops}],
      boats: ys.map(y => ({name: y.name || "", crew: y.crew ?? null, h: y.log[li]?.[0] || 0, nm: y.log[li]?.[1] || 0, route: 0}))}))};
  };
  const rebuild = () => {
    const vs = [...SEED.map(v => ({...v, seed: true})), ...DBV];
    VOY = vs.map(v => { const m = META[v.id] || {};
      const fresh = x => !v.seed || !v.rev || (x && x === v.rev);
      const b = norm(m.override && fresh(m.override.rev) ? {...v, ...m.override, rev: v.rev} : v);
      const crew = m.crew && fresh(m.crewRev) ? m.crew : null;
      const legs = (b.legs || []).map((L, li) => ({...L, boats: L.boats.map((x, bi) => { const k = li + ":" + bi; return crew && k in crew ? {...x, crew: crew[k]} : x; })}));
      return {...b, legs, photos: m.photos || {}, cover: m.cover || null, slides: m.slides || {}, credits: m.credits || {}, hidden: !!m.hidden}; })
      .filter(v => !v.hidden && v.legs && v.legs.length);
    VOY.forEach(V => {
      V.legs.forEach(L => { if (!L.routes || !L.routes.length) L.routes = [{stops: [], hops: []}]; L.stops = L.routes[0].stops; L.nm = L.boats.reduce((a, b) => a + b.nm, 0); L.h = L.boats.reduce((a, b) => a + b.h, 0);
        L.crew = L.boats.reduce((a, b) => a + (b.crew || 0), 0); L.crewKnown = L.boats.every(b => b.crew != null); });
      V.totNm = V.legs.reduce((a, L) => a + L.nm, 0); V.totH = V.legs.reduce((a, L) => a + L.h, 0);
      V.crew = V.legs.reduce((a, L) => a + L.crew, 0); V.crewKnown = V.legs.every(L => L.crewKnown);
      const by = new Map();
      V.legs.forEach(L => L.boats.forEach(b => { const k = b.name; const e = by.get(k) || {name: b.name, legs: 0, h: 0, nm: 0, crew: 0, crewKnown: true};
        e.legs++; e.h += b.h; e.nm += b.nm; e.crew += b.crew || 0; if (b.crew == null) e.crewKnown = false; by.set(k, e); }));
      V.boatTot = [...by.values()];
      const st = V.legs.map(L => L.start).filter(Boolean).sort(), en = V.legs.map(L => L.end).filter(Boolean).sort();
      V.start = V.start || st[0] || null; V.end = V.end || en[en.length - 1] || null;
      V.allStops = [...new Set(V.legs.flatMap(L => L.routes.flatMap(R => R.stops)))];
    });
    VOY.sort((a, b) => (b.start || "").localeCompare(a.start || ""));
  };
  rebuild();
  // editions held every year; a voyage belongs to one by its name (or an explicit "series" field)
  const SERIES = [
    {key: "sylwester", name: "Sylwester", re: /sylwest/},
    {key: "wsex", name: "WSEx", full: "Winter Sail Expedition", re: /\bwsex\b|winter sail/},
    {key: "may-i-sail", name: "May I Sail", re: /may i sail/},
    {key: "nne", name: "NNE", full: "Navigare Necesse Est", re: /\bnne\b|navigare/},
    {key: "sun-sail-experience", name: "Sun Sail Experience", re: /sun sail|\bssex\b/},
    {key: "znaczy-agh", name: "Znaczy AGH", re: /znaczy agh/},
    {key: "south-sail-sensation", name: "South Sail Sensation", re: /south sail|\bsss\b/},
    {key: "lange-wochenende", name: "Lange Wochenende", re: /\blange\b/}];
  const seriesOf = V => V.series || (SERIES.find(x => x.re.test(fold(V.title))) || {key: "inne"}).key;
  const seriesList = () => { const out = SERIES.map(x => ({...x, Vs: VOY.filter(v => seriesOf(v) === x.key)}));
    const other = VOY.filter(v => !SERIES.some(x => x.key === seriesOf(v))); if (other.length) out.push({key: "inne", name: "Inne rejsy", Vs: other}); return out; };
  const gFull = g => { const t = ((typeof TEXTS === "object" && TEXTS.series) || {})[g.key]; return t && t.full != null && t.full !== "" ? t.full : g.full || ""; };
  const yearOf = V => V.start ? V.start.slice(0, 4) : "";
  const vt = V => { const y = yearOf(V); return y && !String(V.title).includes(y) ? `${V.title} ${y}` : V.title; };

  // ---- map ----
  const grat = {type: "FeatureCollection", features: []};
  for (let x = -180; x <= 180; x += 10) grat.features.push({type: "Feature", geometry: {type: "LineString", coordinates: [[x, -80], [x, 85]]}});
  for (let y = -80; y <= 80; y += 10) grat.features.push({type: "Feature", geometry: {type: "LineString", coordinates: [[-180, y], [180, y]]}});
  const PAL = {
    chart: {sea:"#d3e6ee",deep:"#b9d4e2",land:"#f0e5c6",coast:"#8f7f57",lake:"#d3e6ee",river:"#9fc4d4",border:"#b29f75",grat:"#4d7488",plan:"#7d2a2a",wake:"#13375c",glow:"rgba(255,255,255,0.75)",pin:"#d62828",v:["#13375c","#b2391c","#2f6b3a","#6b3a8c","#8a5a12","#1f6f7a"]},
    night: {sea:"#0f2636",deep:"#0b1d2a",land:"#2a2b24",coast:"#6c8790",lake:"#0f2636",river:"#2c4b5c",border:"#555a4d",grat:"#8fb3c7",plan:"#fff1cf",wake:"#fff1cf",glow:"rgba(255,241,207,0.35)",pin:"#ff4a3d",v:["#fff1cf","#ff8a5c","#8fd19e","#c9a4ff","#f2c46d","#7fd6e0"]}};
  const P = PAL.chart; document.documentElement.dataset.map = "chart";
  const k = v => ["==", ["get", "k"], v];
  const empty = {type: "FeatureCollection", features: []}, NONE = "rgba(0,0,0,0)";
  const style = {version: 8, sources: {base: {type: "geojson", data: land, attribution: "Natural Earth"}, grat: {type: "geojson", data: grat},
      plan: {type: "geojson", data: empty}, others: {type: "geojson", data: empty}, fleet: {type: "geojson", data: empty}, wake: {type: "geojson", data: empty, lineMetrics: true}, ports: {type: "geojson", data: empty}},
    layers: [{id: "sea", type: "background", paint: {"background-color": P.sea}}, {id: "deep", type: "fill", source: "base", filter: k("deep"), paint: {"fill-color": P.deep}}]};
  if (SATELLITE) { style.sources.sat = {type: "raster", tileSize: 256, attribution: "Esri World Imagery", tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"]}; style.layers.push({id: "sat", type: "raster", source: "sat"}); }
  else style.layers.push(
    {id: "land", type: "fill", source: "base", filter: k("land"), paint: {"fill-color": P.land}},
    {id: "lake", type: "fill", source: "base", filter: k("lake"), paint: {"fill-color": P.lake}},
    {id: "river", type: "line", source: "base", filter: k("river"), paint: {"line-color": P.river, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.6, 9, 1.6]}},
    {id: "border", type: "line", source: "base", filter: k("border"), paint: {"line-color": P.border, "line-width": 1, "line-dasharray": [3, 2]}},
    {id: "coast", type: "line", source: "base", filter: k("land"), paint: {"line-color": P.coast, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.6, 9, 1.4]}});
  style.layers.push(
    {id: "grat", type: "line", source: "grat", paint: {"line-color": P.grat, "line-opacity": 0.14, "line-width": 0.6}},
    {id: "others", type: "line", source: "others", layout: {"line-cap": "round", "line-join": "round"}, paint: {"line-color": ["get", "c"], "line-opacity": ["case", ["==", ["get", "h"], 1], 0.95, 0.55], "line-width": ["case", ["==", ["get", "h"], 1], 4, 2]}},
    {id: "fleet", type: "line", source: "fleet", layout: {"line-cap": "round", "line-join": "round"}, paint: {"line-color": ["get", "c"], "line-width": 2.4, "line-opacity": 0.85}},
    {id: "plan", type: "line", source: "plan", paint: {"line-color": P.plan, "line-opacity": 0.45, "line-width": 1.4, "line-dasharray": [2, 3]}},
    {id: "glow", type: "line", source: "wake", layout: {"line-cap": "round", "line-join": "round"}, paint: {"line-width": 8, "line-blur": 4, "line-gradient": ["step", ["line-progress"], NONE, 0.5, NONE]}},
    {id: "wake", type: "line", source: "wake", layout: {"line-cap": "round", "line-join": "round"}, paint: {"line-width": 2.8, "line-gradient": ["step", ["line-progress"], NONE, 0.5, NONE]}},
    {id: "pins", type: "circle", source: "ports", paint: {"circle-color": ["case", ["==", ["get", "a"], 1], "#fff", P.pin], "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 3, 9, 7], "circle-stroke-color": ["case", ["==", ["get", "a"], 1], P.pin, "#fff"], "circle-stroke-width": ["case", ["==", ["get", "a"], 1], 2.5, 1.5]}});
  const EUROPE = [[-12, 35], [36, 72]];
  const map = new maplibregl.Map({container: "map", style, bounds: EUROPE, minZoom: 0, maxZoom: 13, attributionControl: {compact: true}, dragRotate: false, pitchWithRotate: false, scrollZoom: false});
  map.addControl(new maplibregl.NavigationControl({showCompass: false}), "top-right");
  map.on("error", e => { if (e && e.error && !/abort/i.test(String(e.error.message))) showErr("mapa: " + e.error.message); });
  const mapEl = $("#map");
  const farChk = () => mapEl.classList.toggle("far", map.getZoom() < 5); map.on("zoom", farChk); map.on("moveend", farChk); farChk();
  [["Morze Północne",3.2,55.6],["Kanał La Manche",-0.6,50.35],["Skagerrak",9.2,57.85],["Kattegat",11.4,56.75],["Morze Bałtyckie",16.6,55.6],["Zatoka Niemiecka",7.0,54.4],["Morze Norweskie",4.5,66.5],["Morze Barentsa",28,73.5],["Morze Grenlandzkie",3,77.5],["Vestfjorden",13.6,67.75],["Cieśnina Hinlopen",18.6,79.25],["Isfjorden",14.6,78.32]].forEach(([n, x, y]) => {
    const el = document.createElement("div"); el.className = "seaname"; el.textContent = n; new maplibregl.Marker({element: el}).setLngLat([x, y]).addTo(map); });
  const bel = document.createElement("div"); bel.className = "boat";
  const boat = new maplibregl.Marker({element: bel}).setLngLat([0, 0]);
  let markers = [], labels = {};
  const setPorts = (portList, anchors = [], withLabels = true) => {
    markers.forEach(m => m.remove()); markers = []; labels = {};
    map.getSource("ports").setData({type: "FeatureCollection", features: portList.map(([p, c]) => ({type: "Feature", properties: {a: anchors.includes(p) ? 1 : 0}, geometry: {type: "Point", coordinates: c}}))});
    if (withLabels) for (const [p, c] of portList) { if (labels[p]) continue;
      const el = document.createElement("div"); el.className = "lbl"; el.textContent = p; labels[p] = el;
      markers.push(new maplibregl.Marker({element: el, anchor: "left"}).setLngLat(c).addTo(map)); }
  };
  const portsOf = Vs => Vs.flatMap(V => Object.entries(V.ports));
  const anchorsOf = Vs => Vs.flatMap(V => V.anchor || []);

  // ---- tracks ----
  const coordsOf = h => h.coords || dec(h.enc || "");
  // the animated wake follows each leg's main route (the one most boats sailed)
  const flatten = Vs => {
    const all = [], breaks = [], hops = [], legRange = [];
    Vs.forEach((V, vi) => V.legs.forEach((leg, li) => { const R = leg.routes[0], ls = all.length;
      R.hops.forEach((h, hi) => {
        const cs = coordsOf(h);
        const last = all[all.length - 1], gap = last && hi === 0 && (last[0] !== cs[0][0] || last[1] !== cs[0][1]);
        if (gap) breaks.push(all.length);
        const start = gap || !last ? all.length : all.length - 1;
        cs.forEach((c, j) => { if (gap || !last || j > 0) all.push(c); });
        hops.push({from: h.from, to: h.to, v: vi, leg: li, idx: hi, n: R.hops.length, start, end: all.length - 1});
      });
      const lh = hops.filter(h => h.v === vi && h.leg === li);
      if (lh.length) legRange.push({v: vi, leg: li, start: lh[0].start, end: lh[lh.length - 1].end}); }));
    const M = all.map(merc), m = [0];
    for (let i = 1; i < M.length; i++) m.push(m[i - 1] + Math.hypot(M[i][0] - M[i - 1][0], M[i][1] - M[i - 1][1]));
    const T = m[m.length - 1] || 1;
    return {Vs, all, M, m, T, breaks, hops, legRange, prog: i => m[i] / T};
  };
  // route variants of one leg, each in its own colour (boats that sailed a different way)
  const FC = ["#d62828", "#2a9d8f", "#f77f00", "#6a4c93", "#0077b6", "#8ab17d", "#b5179e", "#bc6c25", "#457b9d", "#e9c46a"];
  const legFleet = L => ({type: "FeatureCollection", features: L.routes.flatMap((R, i) => R.hops.map(h => ({type: "Feature", properties: {c: FC[i % FC.length]}, geometry: {type: "LineString", coordinates: coordsOf(h)}})))});
  const legPts = L => L.routes.flatMap(R => R.hops.flatMap(coordsOf));
  const parts = S => { const out = []; let run = [S.all[0]];
    for (let i = 1; i < S.all.length; i++) { if (S.breaks.includes(i)) { if (run.length > 1) out.push(run); run = [S.all[i]]; } else run.push(S.all[i]); }
    if (run.length > 1) out.push(run); return out; };
  const othersData = (Vs, hi = null) => ({type: "FeatureCollection", features: Vs.flatMap(V => { const i = VOY.indexOf(V);
    return parts(flatten([V])).map(c => ({type: "Feature", properties: {c: P.v[(i < 0 ? 0 : i) % P.v.length], h: (Array.isArray(hi) ? hi.includes(V) : V === hi) ? 1 : 0}, geometry: {type: "LineString", coordinates: c}})); })});
  const colorOf = V => P.v[Math.max(0, VOY.indexOf(V)) % P.v.length];
  const bounds = cs => cs.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(cs[0], cs[0]));

  let S = null, curP = 0, anim = 0, lastDur = 0;
  const grad = (p, col) => {
    const st = []; const add = (x, c) => { if (st.length && x <= st[st.length - 2] + 1e-9) st.splice(-2, 2); st.push(x, c); };
    for (const b of S.breaks) { const a = S.prog(b - 1), c = S.prog(b); if (a >= p) break; add(a, NONE); if (c < p) add(c, col); }
    add(Math.max(p, 1e-7), NONE);
    return ["step", ["line-progress"], p > 0 ? col : NONE, ...st];
  };
  const at = p => { const d = p * S.T; let lo = 0, hi = S.m.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (S.m[mid] <= d) lo = mid; else hi = mid; }
    const seg = S.m[hi] - S.m[lo] || 1, t = Math.min(1, Math.max(0, (d - S.m[lo]) / seg));
    return {m: [S.M[lo][0] + (S.M[hi][0] - S.M[lo][0]) * t, S.M[lo][1] + (S.M[hi][1] - S.M[lo][1]) * t], hidden: S.breaks.includes(hi) && t > 0 && t < 1}; };
  const paint = p => { map.setPaintProperty("wake", "line-gradient", grad(p, P.wake)); map.setPaintProperty("glow", "line-gradient", grad(p, P.glow));
    const b = at(p); boat.setLngLat(unmerc(b.m)); bel.style.opacity = b.hidden ? 0 : 1; return b; };
  const animate = (p1, cam) => {
    cancelAnimationFrame(anim);
    const p0 = curP, c0 = merc(map.getCenter().toArray()), z0 = map.getZoom();
    const end = cam.chase ? at(p1).m : merc(cam.center), z1 = cam.zoom;
    const diag = Math.hypot(mapEl.clientWidth, mapEl.clientHeight), world = 512 * 2 ** Math.min(z0, z1);
    const travel = Math.max(Math.hypot(end[0] - c0[0], end[1] - c0[1]), Math.abs(p1 - p0) * S.T) * world / diag;
    const bump = travel > 1.2 ? Math.min(3, Math.log2(travel) + 0.3) : 0;
    const dur = reduce ? 0 : Math.min(4200, 1000 + 900 * Math.log2(1 + travel)), t0 = performance.now(); lastDur = dur;
    const frame = now => {
      const t = dur ? Math.min(1, (now - t0) / dur) : 1, e = ease(t);
      curP = p0 + (p1 - p0) * e; const b = paint(curP);
      let c; if (cam.chase) { const w = ease(Math.min(1, t / 0.35)); c = [c0[0] + (b.m[0] - c0[0]) * w, c0[1] + (b.m[1] - c0[1]) * w]; }
      else c = [c0[0] + (end[0] - c0[0]) * e, c0[1] + (end[1] - c0[1]) * e];
      map.jumpTo({center: unmerc(c), zoom: z0 + (z1 - z0) * e - bump * Math.sin(Math.PI * e)});
      if (t < 1) anim = requestAnimationFrame(frame);
    };
    anim = requestAnimationFrame(frame);
  };

  // ---- photos ----
  const realPhotos = (V, stop) => (V.photos[stop] || []).map(id => "/_blob/" + id);
  const coverOf = (V, i) => V.cover ? "/_blob/" + V.cover : (Object.values(V.photos).flat()[0] ? "/_blob/" + Object.values(V.photos).flat()[0] : PH(i * 13));
  // photos on a slide: the admin's choice and layout for that slide, else photos filed under the port, else placeholders
  // framing of a photo on one slide: focal point x/y in %, zoom z, fit = show the whole photo
  const pidOf = src => src.startsWith("/_blob/") ? src.slice(7) : "";
  const frameCss = p => { const x = p ? p.x : 50, y = p ? p.y : 50;
    return `object-position:${x}% ${y}%;transform-origin:${x}% ${y}%;--z:${p ? p.z || 1 : 1}${p && p.fit ? ";object-fit:contain" : ""}`; };
  const credit = (V, id) => id && (V.credits || {})[id] ? String(V.credits[id]) : "";
  const imgTag = (V, key, src, cls, extra = "") => { const id = pidOf(src), p = id ? (((V.slides || {})[key] || {}).pos || {})[id] : null;
    return `<img ${cls}src="${src}"${id ? ` data-pid="${esc(id)}" data-credit="${esc(credit(V, id))}"` : ""} style="${frameCss(p)}" alt=""${extra}>`; };
  // ---- photo boards: photos placed freely on a slide. x, y, w are fractions of the board width, h = height / width ----
  let CANVAS = {}, OPEN_UNTIL = null, boardEditing = null;
  const openNow = () => !!OPEN_UNTIL && Date.parse(OPEN_UNTIL) > Date.now();
  const canArrange = () => editOn() || (SELF && openNow());
  const boardId = (V, key) => V.id + "__" + key.replace(/:/g, "-");
  const boardOf = (V, key) => CANVAS[boardId(V, key)];
  const itemCss = (it, h) => `left:${it.x * 100}%;top:${it.y / h * 100}%;width:${it.w * 100}%;height:${it.w * it.ar / h * 100}%;z-index:${(it.z || 0) + 10}${it.rot ? `;transform:rotate(${it.rot}deg)` : ""}`;
  const boardHtml = (V, key) => { const b = boardOf(V, key); if (!b || !b.items || !b.items.length) return "";
    return `<div class="board" style="aspect-ratio:1/${b.h}">${[...b.items].sort((a, c) => (a.z || 0) - (c.z || 0)).map(it =>
      `<button type="button" class="bi" style="${itemCss(it, b.h)}" aria-label="Powiększ zdjęcie"><img loading="lazy" src="/_blob/${esc(it.id)}" alt="" data-credit="${esc(it.author || "")}">${it.author ? `<span class="bcr">fot. ${esc(it.author)}</span>` : ""}</button>`).join("")}</div>`; };
  const slidePhotos = (V, key, stop, ph) => {
    const bd = boardHtml(V, key); if (bd) return bd;
    const cfg = (V.slides || {})[key]; if (cfg && cfg.layout === "none") return "";
    let list = cfg && cfg.photos && cfg.photos.length ? cfg.photos.map(id => "/_blob/" + id) : [];
    if (!list.length && stop) list = realPhotos(V, stop).slice(0, 7);
    if (!list.length) list = [ph(), ph(), ph()];
    const lay = cfg && cfg.layout && cfg.layout !== "auto" ? cfg.layout : list.length === 1 ? "one" : list.length === 2 ? "two" : list.length === 3 ? "big2" : "grid";
    return `<div class="ph ${lay}">${list.map(src => { const by = credit(V, pidOf(src));
      return `<figure class="pf"><button type="button" aria-label="Powiększ zdjęcie">${imgTag(V, key, src, 'loading="lazy" ')}</button>${by ? `<figcaption>fot. ${esc(by)}</figcaption>` : ""}</figure>`; }).join("")}</div>`; };
  const slideBg = (V, key) => { const c = (V.slides || {})[key]; return c && c.photos && c.photos.length && c.layout !== "none" ? "/_blob/" + c.photos[0] : null; };
  // full-bleed background of hero/leg slides, with the author in the corner
  const bgImg = (V, key, src, lazy) => { const by = credit(V, pidOf(src));
    return imgTag(V, key, src, lazy ? 'loading="lazy" class="bg" ' : 'class="bg" ') + (by ? `<span class="credit">fot. ${esc(by)}</span>` : ""); };
  const tools = (V, key, upload = true) => mode === "present" ? "" : `<div class="stools">${upload && !editOn() && canArrange()
      ? `<button type="button" class="tbtn open" data-board="${esc(V.id)}|${key}">Dodaj i ułóż zdjęcia</button>`
      : upload ? `<button type="button" class="tbtn" data-up="${esc(V.id)}|${key}">Dodaj zdjęcia</button>` : ""}${upload && editOn() ? `<button type="button" class="tbtn ed" data-board="${esc(V.id)}|${key}">Układaj zdjęcia</button>` : ""}${editOn() ? `<button type="button" class="tbtn ed" data-ed="${esc(V.id)}|${key}">Edytuj</button>${upload ? `<button type="button" class="tbtn ed" data-crop="${esc(V.id)}|${key}">Kadruj zdjęcia</button>` : ""}` : ""}</div>`;

  // ---- story ----
  let steps = [], secs = [], cur = -1, io = null, mode = "home";
  const stats = (nm, h, extra = "") => `<div class="big"><div>${nm} Mm<small>mil morskich</small></div><div>${h} h<small>żeglugi</small></div>${extra}</div>`;
  const route = stops => !stops.length ? "Trasa nieznana" : stops.length === 1 ? esc(stops[0]) : `${esc(stops[0])} – ${esc(stops[stops.length - 1])}`;
  const nOs = n => `${n} ${plural(n, "osoba", "osoby", "osób")}`;
  const crewTxt = (n, known) => known ? fmt(n) : (n ? fmt(n) + "+" : "—");
  const legDates = L => L.start ? dates(L) : "";
  const fleet = V => V.boatTot.length ? `<div class="fleet"><span class="kick">${V.boatTot.length > 1 ? nJacht(V.boatTot.length) : "Jacht"}</span>${V.boatTot.map(y => `<span class="chip">${esc(y.name)}</span>`).join("")}</div>` : "";
  const table = (head, rows, tot) => `<div class="scroll"><table><thead><tr>${head.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}${tot ? `<tr class="tot">${tot.map(c => `<td><b>${c}</b></td>`).join("")}</tr>` : ""}</tbody></table></div>`;
  const sw = i => `<span class="sw" style="background:${FC[i % FC.length]}"></span>`;

  const build = S => {
    const out = [], multi = S.Vs.length > 1;
    if (mode === "present") { const nm = S.Vs.reduce((a, v) => a + v.totNm, 0), h = S.Vs.reduce((a, v) => a + v.totH, 0);
      out.push({html: `<section class="step overview"><div class="kick">Prezentacja · ${S.Vs.length} ${plural(S.Vs.length, "wyprawa", "wyprawy", "wypraw")} · ${nRejs(S.Vs.reduce((a, v) => a + v.legs.length, 0))}</div>
      <h1>${esc(presOpts.title || "Co dziś pokażemy")}</h1>
      <ol class="plan">${S.Vs.map(v => `<li><span class="sw" style="background:${colorOf(v)}"></span><span><b>${esc(vt(v))}</b><span class="hint2">${[dates(v), nRejs(v.legs.length), nJacht(v.boatTot.length), fmt(v.totNm) + " Mm"].filter(Boolean).join(" · ")}</span></span></li>`).join("")}</ol>
      ${stats(fmt(nm), fmt(h))}<div class="hint">Naciśnij ↓ lub przewiń, aby zacząć</div></section>`, cam: {all: true}, upto: 0, port: null, overview: true}); }
    S.Vs.forEach((V, vi) => {
      let pi = VOY.indexOf(V) * 13; const ph = () => PH(pi++);
      const vh = S.hops.filter(h => h.v === vi), vfirst = vh[0], vlast = vh[vh.length - 1];
      // voyages or legs without a known route: no track, the map shows their ports (if any) instead
      const vcam = vfirst ? {from: vfirst.start, to: vlast.end} : {pts: Object.values(V.ports)};
      const stopPts = L => L.stops.map(p => V.ports[p]).filter(Boolean);
      let last = vfirst ? vfirst.start : (out.length ? out[out.length - 1].upto : 0);
      out.push({key: "hero", html: `<section class="step hero">${bgImg(V, "hero", slideBg(V, "hero") || coverOf(V, VOY.indexOf(V)))}<div class="over">
        <div class="kick">${multi ? `Wyprawa ${vi + 1} z ${S.Vs.length} · ` : ""}${nRejs(V.legs.length)}${dates(V) ? " · " + dates(V) : ""}</div>
        <h1>${esc(vt(V))}</h1>${V.sub ? `<p class="sub">${esc(V.sub)}</p>` : ""}
        ${stats(fmt(V.totNm), fmt(V.totH), `<div>${V.boatTot.length}<small>${plural(V.boatTot.length, "jacht", "jachty", "jachtów")}</small></div>${V.crew ? `<div>${crewTxt(V.crew, V.crewKnown)}<small>osób w załogach</small></div>` : ""}`)}
        ${fleet(V)}${multi ? "" : `<div class="hint">Przewiń lub naciśnij ↓, aby płynąć</div>`}${boardHtml(V, "hero")}${tools(V, "hero")}</div></section>`,
        cam: vcam, upto: last, port: null});
      V.legs.forEach((L, li) => {
        const lr = S.legRange.find(r => r.v === vi && r.leg === li), lh = vh.filter(h => h.leg === li);
        const one = L.boats.length === 1, b0 = L.boats[0];
        out.push({key: "leg:" + li, html: `<section class="step leg">${bgImg(V, "leg:" + li, slideBg(V, "leg:" + li) || realPhotos(V, L.stops[0])[0] || ph(), true)}<div class="over">
          <div class="kick">${multi ? esc(vt(V)) + " · " : ""}Rejs ${li + 1} z ${V.legs.length}${legDates(L) ? " · " + legDates(L) : ""}</div><h2>${route(L.stops)}</h2>
          ${stats(fmt(L.nm), fmt(L.h), one ? `<div>${kn(L.nm / L.h)} w<small>średnio</small></div>` : `<div>${L.boats.length}<small>${plural(L.boats.length, "jacht", "jachty", "jachtów")}</small></div>`)}
          <div class="facts"><span class="w">${esc(L.stops.join(" · "))}</span></div>${boardHtml(V, "leg:" + li)}${tools(V, "leg:" + li)}</div></section>`,
          cam: lr ? {from: lr.start, to: lr.end} : {pts: stopPts(L)}, upto: lr ? lr.start : last, port: L.stops[0] || null});
        // short page: who sailed this leg
        const vars = L.routes.length > 1;
        const rows = L.boats.map(b => [`${vars ? sw(b.route) : ""}${esc(b.name)}`, b.crew == null ? "—" : fmt(b.crew), fmt(b.h) + " h", fmt(b.nm) + " Mm", kn(b.nm / b.h) + " w"]);
        out.push({key: "boats:" + li, html: `<section class="step boats"><div class="kick">Rejs ${li + 1} · ${one ? "jacht i załoga" : "jachty i załogi"}</div>
          <h2 class="name">${one ? esc(b0.name) : nJacht(L.boats.length)}</h2>
          ${one ? stats(fmt(b0.nm), fmt(b0.h), `<div>${b0.crew == null ? "—" : fmt(b0.crew)}<small>${b0.crew == null ? "załoga: brak danych" : plural(b0.crew, "osoba", "osoby", "osób") + " w załodze"}</small></div>`)
            : table(["Jacht", "Załoga", "Godziny", "Mile", "Średnio"], rows, ["Razem", crewTxt(L.crew, L.crewKnown), fmt(L.h) + " h", fmt(L.nm) + " Mm", kn(L.nm / L.h) + " w"])}
          ${vars ? `<div class="vars"><b>Warianty trasy</b>${L.routes.map((R, i) => `<p>${sw(i)}<span>${esc(R.stops.join(" → "))}<small> · ${nJacht(L.boats.filter(b => b.route === i).length)}</small></span></p>`).join("")}</div>` : ""}
          ${!L.crewKnown ? `<p class="note">Brak danych o liczbie osób — administrator może je uzupełnić.</p>` : ""}${tools(V, "boats:" + li, false)}</section>`,
          cam: {pts: legPts(L).length ? legPts(L) : stopPts(L)}, upto: lr ? lr.start : last, port: null, fleet: vars ? [vi, li] : null});
        if (lr) last = lr.end;
        lh.forEach(h => out.push({key: `hop:${li}:${h.idx}`, html: `<section class="step"><div class="kick">Rejs ${li + 1} · etap ${h.idx + 1} z ${h.n}</div>
          <h2 class="name">${esc(h.to)}</h2>
          <div class="facts"><b>poprzedni port: ${esc(h.from)}</b>${(V.anchor || []).includes(h.to) ? "<span>na kotwicy</span>" : ""}${country(h.to, V.ports[h.to]) ? `<span>${country(h.to, V.ports[h.to])}</span>` : ""}<span>${pos(V.ports[h.to])}</span></div>${slidePhotos(V, `hop:${li}:${h.idx}`, h.to, ph)}${tools(V, `hop:${li}:${h.idx}`)}</section>`,
          cam: {chase: true}, upto: h.end, port: h.to, fleet: vars ? [vi, li] : null}));
      });
      const legRows = V.legs.map((L, i) => [`${i + 1}. ${route(L.stops)}${legDates(L) ? `<small class="d">${legDates(L)}</small>` : ""}`, L.boats.length > 3 ? nJacht(L.boats.length) : esc(L.boats.map(b => b.name).join(", ")), fmt(L.h) + " h", fmt(L.nm) + " Mm"]);
      const boatRows = V.boatTot.map(b => [esc(b.name), nRejs(b.legs), crewTxt(b.crew, b.crewKnown), fmt(b.h) + " h", fmt(b.nm) + " Mm"]);
      out.push({key: "log", html: `<section class="step"><div class="kick">${esc(vt(V))} · dziennik</div><h2 class="name">${fmt(V.totNm)} Mm za rufą</h2>
        ${table(["Rejs", "Jachty", "Godziny", "Mile"], legRows, ["Razem", nJacht(V.boatTot.length), fmt(V.totH) + " h", fmt(V.totNm) + " Mm"])}
        <h3>Jachty</h3>${table(["Jacht", "Rejsy", "Załogi", "Godziny", "Mile"], boatRows, V.boatTot.length > 1 ? ["Razem", "", crewTxt(V.crew, V.crewKnown), fmt(V.totH) + " h", fmt(V.totNm) + " Mm"] : null)}
        ${slidePhotos(V, "log", vlast ? vlast.to : null, ph)}${tools(V, "log")}</section>`,
        cam: vcam, upto: vlast ? vlast.end : last, port: vlast ? vlast.to : null});
    });
    if (multi) { const nm = S.Vs.reduce((a, v) => a + v.totNm, 0), h = S.Vs.reduce((a, v) => a + v.totH, 0);
      out.push({html: `<section class="step"><div class="kick">Podsumowanie</div><h2 class="name">${fmt(nm)} Mm pod żaglami</h2>
      ${table(["Wyprawa", "Jachty", "Godziny", "Mile"], S.Vs.map(v => [`${esc(vt(v))} <small class="d">${nRejs(v.legs.length)}</small>`, String(v.boatTot.length), fmt(v.totH) + " h", fmt(v.totNm) + " Mm"]), ["Razem", "", fmt(h) + " h", fmt(nm) + " Mm"])}</section>`,
      cam: {all: true}, upto: Math.max(0, S.all.length - 1), port: null}); }
    out[out.length - 1].html = out[out.length - 1].html.replace(/<\/section>$/, `<p class="note">Godziny i mile pochodzą z dzienników jachtowych; przy kilku jachtach to suma wszystkich jachtów. Ślad na mapie odtworzono z tras plotera i żeglugi między portami. Tam, gdzie brakuje zdjęć, pokazano grafiki poglądowe.</p>
      <div><button type="button" class="btn ghost" data-home>${mode === "present" ? "Zakończ prezentację" : "← Wszystkie wyprawy"}</button></div></section>`);
    return out;
  };
  const go = i => {
    if (!S || i === cur) return; cur = i; const s = steps[i];
    const wide = innerWidth > 860, track = S.all.length > 1, p1 = track ? S.prog(Math.min(s.upto, S.all.length - 1)) : 0;
    if (s.cam.chase && track) animate(p1, {chase: true, zoom: wide ? 7.3 : 6.4});
    else { const pts = s.cam.pts || (s.cam.all ? S.all : S.all.slice(s.cam.from, s.cam.to + 1));
      if (pts.length) { const c = map.cameraForBounds(bounds(pts), {padding: wide ? 70 : 36});
        const cam = {center: c.center.toArray ? c.center.toArray() : [c.center.lng, c.center.lat], zoom: Math.min(pts.length > 1 ? 8.6 : 7, c.zoom)};
        if (track) animate(p1, cam); else map.easeTo({...cam, duration: reduce ? 0 : 1200}); } }
    Object.entries(labels).forEach(([p, el]) => el.classList.toggle("on", p === s.port));
    map.getSource("fleet").setData(s.fleet ? legFleet(S.Vs[s.fleet[0]].legs[s.fleet[1]]) : empty);
    if (mode === "present") { const ov = !!s.overview;
      map.getSource("others").setData(ov ? othersData(S.Vs) : empty); map.setLayoutProperty("plan", "visibility", ov ? "none" : "visible");
      bel.style.visibility = ov ? "hidden" : ""; mapEl.classList.toggle("nolabels", ov); }
    cnt.textContent = `${i + 1} / ${steps.length}`; prev.disabled = i === 0; next.disabled = i === steps.length - 1;
    scheduleAuto();
  };
  // ---- automatic slides: the next slide comes N seconds after the boat reaches the current one ----
  let presOpts = {title: "", auto: false, sec: 8}, autoT = 0, autoPaused = false;
  try { presOpts = {...presOpts, ...JSON.parse(sessionStorage.getItem("akz-pres") || "{}")}; } catch (e) {}
  const autobtn = $("#autobtn");
  const scheduleAuto = () => { clearTimeout(autoT);
    const on = mode === "present" && presOpts.auto; autobtn.hidden = !on;
    autobtn.textContent = autoPaused ? "▶ Wznów" : `⏸ Pauza (${presOpts.sec} s)`;
    if (!on || autoPaused || !S || cur >= steps.length - 1) return;
    autoT = setTimeout(() => jump(1), lastDur + presOpts.sec * 1000); };
  autobtn.addEventListener("click", () => { autoPaused = !autoPaused; scheduleAuto(); });
  addEventListener("keydown", e => { if (mode === "present" && presOpts.auto && (e.key === "p" || e.key === "P") && !e.target.closest("input,textarea,select")) { autoPaused = !autoPaused; scheduleAuto(); } });
  let lock = false, lockT = 0;
  addEventListener("scroll", () => { if (lock) { clearTimeout(lockT); lockT = setTimeout(() => { lock = false; }, 250); } }, {passive: true});
  const jump = d => { if (!S) return; const i = Math.max(0, Math.min(secs.length - 1, cur + d)); if (i === cur) return;
    lock = true; clearTimeout(lockT); lockT = setTimeout(() => { lock = false; }, 1500);
    go(i); secs[i].scrollIntoView({behavior: reduce ? "auto" : "smooth", block: "start"}); };
  prev.addEventListener("click", () => jump(-1)); next.addEventListener("click", () => jump(1));
  addEventListener("keydown", e => {
    if (lb.classList.contains("open") || !S || !$("#presdlg").hidden || e.target.closest("input,textarea,select")) return;
    if (e.key === " " && e.target.closest("button")) return;
    if (["ArrowDown", "ArrowRight", "PageDown", " "].includes(e.key)) { e.preventDefault(); jump(1); }
    if (["ArrowUp", "ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); jump(-1); }
  });

  // ---- views ----
  let picked = new Set();
  const navMode = m => { [cnt, prev, next].forEach(el => el.hidden = m !== "story"); homebtn.hidden = m === "home";
    const pres = m === "story" && mode === "present"; $("#fsbtn").hidden = !pres; $("#cleanbtn").hidden = !pres;
    if (!pres) { document.body.classList.remove("clean", "peek"); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } };
  const stopStory = () => { clearTimeout(autoT); autoPaused = false; autobtn.hidden = true; if (typeof endPick === "function" && picking) endPick(); draftMarkers.forEach(m => m.remove()); draftMarkers = []; S = null; if (io) io.disconnect(); cancelAnimationFrame(anim); boat.remove(); cur = -1;
    map.getSource("wake").setData(empty); map.getSource("plan").setData(empty); map.getSource("fleet").setData(empty); };
  const card = (v, i) => `<div class="vcard" data-i="${i}">
    <button type="button" class="vopen"><img src="${coverOf(v, VOY.indexOf(v))}" alt="">
    <span class="in"><span class="kick">${[dates(v), nRejs(v.legs.length), nJacht(v.boatTot.length)].filter(Boolean).join(" · ")}</span><h2>${esc(vt(v))}</h2>${v.sub ? `<p>${esc(v.sub)}</p>` : ""}${stats(fmt(v.totNm), fmt(v.totH))}</span></button></div>`;
  const totals = Vs => ({nm: Vs.reduce((a, v) => a + v.totNm, 0), h: Vs.reduce((a, v) => a + v.totH, 0), legs: Vs.reduce((a, v) => a + v.legs.length, 0), boats: new Set(Vs.flatMap(v => v.boatTot.map(b => b.name))).size});
  const showHome = () => {
    mode = "home"; stopStory(); navMode("home");
    const t = totals(VOY), groups = seriesList();
    stepsEl.innerHTML = `<section class="step home"><div class="kick">${esc(TEXTS.kick || "Dziennik klubowy")}</div><h1>${esc(TEXTS.title || "AKŻ AGH")}</h1>${TEXTS.intro ? `<p class="sub">${esc(TEXTS.intro)}</p>` : ""}
      ${editOn() ? `<div class="stools"><button type="button" class="tbtn ed" data-te="">Edytuj teksty</button></div>` : ""}
      ${stats(fmt(t.nm), fmt(t.h), `<div>${t.legs}<small>${plural(t.legs, "rejs", "rejsy", "rejsów")}</small></div><div>${t.boats}<small>${plural(t.boats, "jacht", "jachty", "jachtów")}</small></div>`)}
      ${db ? "" : `<p class="hint2" id="dbnote">${SELF ? "Wczytuję wyprawy z serwera…" : "Pokazano wyprawy zapisane na stronie. Zaloguj się do Claude, aby zobaczyć też te dodane przez administratorów."}</p>`}
      <div class="series">${groups.map(g => g.Vs.length ? `<button type="button" class="stile" data-s="${g.key}"><img src="${coverOf(g.Vs[0], VOY.indexOf(g.Vs[0]))}" alt="">
        <span class="in"><span class="kick">${g.Vs.length} ${plural(g.Vs.length, "edycja", "edycje", "edycji")} · ${[...new Set(g.Vs.map(yearOf).filter(Boolean))].join(", ")}</span><b>${esc(g.name)}</b>${gFull(g) ? `<span class="full">${esc(gFull(g))}</span>` : ""}
        <span class="sline">${fmt(totals(g.Vs).nm)} Mm · ${nRejs(totals(g.Vs).legs)}</span></span></button>`
        : `<div class="stile empty"><span class="in"><b>${esc(g.name)}</b>${gFull(g) ? `<span class="full">${esc(gFull(g))}</span>` : ""}<span class="sline">brak wypraw w archiwum</span></span></div>`).join("")}</div></section>`;
    map.getSource("others").setData(othersData(VOY)); setPorts(portsOf(VOY), anchorsOf(VOY), false);
    map.fitBounds(EUROPE, {padding: 10, duration: 0});
    stepsEl.querySelectorAll(".stile[data-s]").forEach(b => { const g = groups.find(x => x.key === b.dataset.s);
      b.addEventListener("click", () => { location.hash = "edycja-" + g.key; });
      b.addEventListener("mouseenter", () => map.getSource("others").setData(othersData(VOY, g.Vs))); b.addEventListener("mouseleave", () => map.getSource("others").setData(othersData(VOY))); });
    scrollTo(0, 0);
  };
  const showSeries = g => {
    mode = "series"; stopStory(); navMode("series"); homebtn.textContent = "← Wszystkie edycje"; homebtn.dataset.to = "";
    const t = totals(g.Vs);
    const sd = (TEXTS.series || {})[g.key] || {};
    stepsEl.innerHTML = `<section class="step home"><div class="kick">${esc(TEXTS.title || "AKŻ AGH")} · edycje</div><h1>${esc(g.name)}</h1>${gFull(g) ? `<p class="sub">${esc(gFull(g))}</p>` : ""}${sd.desc ? `<p class="desc">${esc(sd.desc)}</p>` : ""}
      ${editOn() ? `<div class="stools"><button type="button" class="tbtn ed" data-te="${g.key}">Edytuj opis edycji</button></div>` : ""}
      ${stats(fmt(t.nm), fmt(t.h), `<div>${t.legs}<small>${plural(t.legs, "rejs", "rejsy", "rejsów")}</small></div><div>${t.boats}<small>${plural(t.boats, "jacht", "jachty", "jachtów")}</small></div>`)}
      <div class="cards">${g.Vs.map(card).join("")}</div></section>`;
    map.getSource("others").setData(othersData(g.Vs)); setPorts(portsOf(g.Vs), anchorsOf(g.Vs), false);
    const pts = g.Vs.flatMap(v => v.legs.flatMap(legPts)); if (pts.length) map.fitBounds(bounds(pts), {padding: innerWidth > 860 ? 60 : 24, maxZoom: 8, duration: reduce ? 0 : 900});
    stepsEl.querySelectorAll(".vcard").forEach(c => { const V = g.Vs[+c.dataset.i];
      c.querySelector(".vopen").addEventListener("click", () => { location.hash = V.id; });
      c.addEventListener("mouseenter", () => map.getSource("others").setData(othersData(g.Vs, V))); c.addEventListener("mouseleave", () => map.getSource("others").setData(othersData(g.Vs))); });
    scrollTo(0, 0);
  };
  const showStory = (Vs, present) => {
    mode = present ? "present" : "archive"; stopStory(); curP = 0; navMode("story"); mapEl.classList.remove("nolabels"); bel.style.visibility = "";
    map.setLayoutProperty("plan", "visibility", "visible");
    const g = seriesList().find(x => x.key === seriesOf(Vs[0]));
    homebtn.textContent = present ? "Zakończ prezentację" : "← " + (g ? g.name : "Wszystkie edycje"); homebtn.dataset.to = present || !g ? "" : "edycja-" + g.key;
    S = flatten(Vs); steps = build(S);
    stepsEl.innerHTML = steps.map(s => s.html).join(""); secs = [...stepsEl.querySelectorAll(".step")]; secs.forEach((el, i) => { if (steps[i].key) el.dataset.key = steps[i].key; });
    map.getSource("wake").setData(S.all.length > 1 ? {type: "Feature", geometry: {type: "LineString", coordinates: S.all}} : empty);
    map.getSource("plan").setData({type: "FeatureCollection", features: parts(S).map(c => ({type: "Feature", geometry: {type: "LineString", coordinates: c}}))});
    map.getSource("others").setData(present ? empty : othersData(VOY.filter(v => !Vs.includes(v))));
    setPorts(portsOf(Vs), anchorsOf(Vs)); if (S.all.length > 1) { boat.addTo(map); paint(0); } scrollTo(0, 0);
    io = new IntersectionObserver(es => { if (lock) return; es.forEach(e => { if (e.isIntersecting) go(secs.indexOf(e.target)); }); }, {rootMargin: "-58% 0px -40% 0px"});
    secs.forEach(s => io.observe(s)); go(0);
  };
  homebtn.addEventListener("click", () => { location.hash = homebtn.dataset.to || ""; });

  // ---- side menu (☰): presentation and admin live here ----
  const drawer = $("#drawer"), menubtn = $("#menubtn"), menuAdmin = $("#m-admin");
  const setMenu = open => { drawer.hidden = !open; menubtn.setAttribute("aria-expanded", String(open)); if (open) drawer.querySelector("button:not([hidden])").focus(); };
  menubtn.addEventListener("click", () => setMenu(drawer.hidden));
  drawer.addEventListener("click", e => { if (e.target === drawer) setMenu(false); });
  drawer.addEventListener("keydown", e => { if (e.key === "Escape") { e.stopPropagation(); setMenu(false); menubtn.focus(); } });
  $("#m-home").addEventListener("click", () => { setMenu(false); location.hash = ""; });
  $("#m-pres").addEventListener("click", () => { setMenu(false); openDlg(); });
  menuAdmin.addEventListener("click", () => { setMenu(false); location.hash = "admin"; });
  const setMenuOpen = setMenu;

  // ---- presentation picker ----
  const dlg = $("#presdlg");
  const closeDlg = () => { dlg.hidden = true; menubtn.focus(); };
  const openDlg = () => {
    const cur = mode === "archive" && S ? S.Vs.map(v => v.id) : [...picked];
    $("#pd-list").innerHTML = seriesList().filter(g => g.Vs.length).map(g => `<div class="pd-g"><span class="kick">${esc(g.name)}</span>${g.Vs.map(v => `<label class="pd-i"><input type="checkbox" value="${esc(v.id)}"${cur.includes(v.id) ? " checked" : ""}>
      <span class="sw" style="background:${colorOf(v)}"></span><span><b>${esc(vt(v))}</b><span class="hint2">${[dates(v), nRejs(v.legs.length), nJacht(v.boatTot.length), fmt(v.totNm) + " Mm"].filter(Boolean).join(" · ")}</span></span></label>`).join("")}</div>`).join("");
    dlgStep = 1; $("#pd-t").textContent = "Prezentacja"; $("#pd-lead").textContent = "Zaznacz wyprawy do pokazania. Pozostałe trasy znikną z mapy. Kolejność jak na liście."; $("#pd-x").textContent = "Anuluj";
    const go2 = $("#pd-go"), boxes = [...dlg.querySelectorAll("#pd-list input")];
    const sync = () => { const n = boxes.filter(b => b.checked).length; go2.disabled = !n; go2.textContent = n ? `Dalej (${n}) →` : "Dalej →"; };
    boxes.forEach(b => b.addEventListener("change", sync)); sync();
    dlg.hidden = false; (boxes[0] || go2).focus();
  };
  let dlgStep = 1, dlgIds = [];
  $("#pd-x").addEventListener("click", () => { if (dlgStep === 2) openDlgKeep(); else closeDlg(); });
  const openDlgKeep = () => { const keep = new Set(dlgIds); picked = keep; openDlg(); };
  dlg.addEventListener("click", e => { if (e.target === dlg) closeDlg(); });
  dlg.addEventListener("keydown", e => { if (e.key === "Escape") { e.stopPropagation(); closeDlg(); } });
  $("#pd-go").addEventListener("click", () => {
    if (dlgStep === 1) {
      dlgIds = [...dlg.querySelectorAll("#pd-list input:checked")].map(b => b.value); if (!dlgIds.length) return;
      dlgStep = 2; $("#pd-t").textContent = "Ustawienia prezentacji"; $("#pd-lead").textContent = `${dlgIds.length} ${plural(dlgIds.length, "wyprawa", "wyprawy", "wypraw")}: ${dlgIds.map(id => vt(VOY.find(v => v.id === id))).join(", ")}`;
      $("#pd-list").innerHTML = `<div class="form one">
        <label>Tytuł slajdu startowego<input id="po-title" value="${esc(presOpts.title || "Co dziś pokażemy")}" maxlength="80"></label>
        <label class="radio"><input type="checkbox" id="po-auto"${presOpts.auto ? " checked" : ""}> Automatyczne przechodzenie slajdów</label>
        <label id="po-secw">Ile sekund na slajd (po dopłynięciu łódki)<input id="po-sec" type="number" min="2" max="120" step="1" value="${presOpts.sec}"></label>
        <p class="hint2">W trakcie: <b>P</b> — pauza, <b>H</b> — ukryj przyciski, <b>F</b> — pełny ekran, strzałki — ręcznie dalej/wstecz.</p></div>`;
      const sync2 = () => { $("#po-sec").disabled = !$("#po-auto").checked; $("#po-secw").classList.toggle("off", !$("#po-auto").checked); };
      $("#po-auto").addEventListener("change", sync2); sync2();
      $("#pd-go").disabled = false; $("#pd-go").textContent = "Rozpocznij prezentację"; $("#pd-x").textContent = "← Wstecz"; $("#po-title").focus();
      return;
    }
    const sec = Math.max(2, Math.min(120, Math.round(+$("#po-sec").value || 8)));
    presOpts = {title: $("#po-title").value.trim() || "Co dziś pokażemy", auto: $("#po-auto").checked, sec};
    try { sessionStorage.setItem("akz-pres", JSON.stringify(presOpts)); } catch (e) {}
    picked = new Set(dlgIds); dlg.hidden = true; dlgStep = 1;
    const h = "prezentacja--" + dlgIds.join("--");
    if (location.hash.slice(1) === h) routeTo(); else location.hash = h; });

  const routeTo = () => {
    const h = decodeURIComponent(location.hash.slice(1));
    if (h === "admin") { if (adminOn()) return showAdmin(); showHome(); return openLogin(); }
    if (h.startsWith("prezentacja--") || h.startsWith("present--")) {
      const Vs = h.split("--").slice(1).map(id => VOY.find(v => v.id === id)).filter(Boolean);
      if (Vs.length) { picked = new Set(Vs.map(v => v.id)); return showStory(Vs, true); }
    }
    if (h.startsWith("edycja-")) { const g = seriesList().find(x => x.key === h.slice(7)); if (g && g.Vs.length) return showSeries(g); }
    const V = VOY.find(v => v.id === h); V ? showStory([V], false) : showHome();
  };
  stepsEl.addEventListener("click", e => {
    if (e.target.closest("[data-home]")) { location.hash = ""; return; }
    const b = e.target.closest(".ph button, .board .bi"); if (!b || b.closest(".cropping")) return;
    const im = b.querySelector("img"); lbi.src = im.src; $("#lbc").textContent = im.dataset.credit ? "fot. " + im.dataset.credit : "";
    lb.classList.add("open"); $("#lbx").focus();
  });
  const closeLb = () => lb.classList.remove("open");
  lb.addEventListener("click", e => { if (e.target !== lbi) closeLb(); });
  addEventListener("keydown", e => { if (e.key === "Escape") closeLb(); });
  addEventListener("hashchange", routeTo);

  // ================= ADMIN =================
  let worker = null, workerReady = null;
  const getWorker = () => {
    if (worker) return workerReady;
    worker = new Worker("router-worker.js");
    const polys = land.features.filter(f => f.properties.k === "land").flatMap(f => f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates);
    workerReady = new Promise(res => { const h = e => { if (e.data.type === "ready") { worker.removeEventListener("message", h); res(worker); } }; worker.addEventListener("message", h); });
    worker.postMessage({type: "land", polys});
    return workerReady;
  };
  const routeHops = async (hops, gpx, onProgress) => {
    const w = await getWorker(); const id = Math.random().toString(36).slice(2);
    return new Promise(res => { const h = e => { if (e.data.type === "progress") onProgress(e.data.done, e.data.total); if (e.data.type === "done" && e.data.id === id) { w.removeEventListener("message", h); res(e.data.routes); } };
      w.addEventListener("message", h); w.postMessage({type: "route", id, hops, gpx}); });
  };
  const parseGpx = async files => { const lines = [];
    for (const f of files) { const x = new DOMParser().parseFromString(await f.text(), "application/xml");
      for (const tag of [["rte", "rtept"], ["trkseg", "trkpt"]]) for (const r of x.getElementsByTagName(tag[0])) {
        const pts = [...r.getElementsByTagName(tag[1])].map(p => [+p.getAttribute("lon"), +p.getAttribute("lat")]).filter(p => isFinite(p[0]) && isFinite(p[1]));
        if (pts.length > 1) lines.push(pts); } }
    return lines; };
  const registry = () => { const R = new Map();
    for (const V of VOY.concat(SEED)) for (const [n, c] of Object.entries(V.ports)) { const a = (V.anchor || []).includes(n);
      if (!R.has(fold(n))) R.set(fold(n), {name: n, c, a}); if (!R.has("b:" + baseName(n))) R.set("b:" + baseName(n), {name: n, c, a}); }
    return R; };
  const resolve = (R, raw) => { const f = fold(raw), b = baseName(raw);
    return R.get(f) || (ALIAS[f] && R.get(fold(ALIAS[f]))) || R.get("b:" + b) || (ALIAS[b] && R.get(fold(ALIAS[b]))) || null; };
  const signature = legs => legs.map(l => l.stops.map(baseName).join(">")).join("|");

  const showAdmin = () => {
    mode = "admin"; stopStory(); navMode("admin"); homebtn.textContent = "← Strona główna"; homebtn.dataset.to = "";
    stepsEl.innerHTML = `<section class="step admin">
      <div class="kick">Panel administratora</div><h1>Dodaj rejsy</h1>
      ${db ? "" : `<p class="warn">Baza danych jest niedostępna — zapis nie zadziała.${SELF ? " Sprawdź, czy serwer działa." : " Otwórz stronę w Claude jako edytor."}</p>`}
      <form id="af" class="form" novalidate>
        <label class="f2">Wklej wiersze z arkusza
          <textarea id="a-log" rows="12" spellcheck="false" placeholder="21.02.2026	28.02.2026	WSEx	Alimos (Ateny) -> Poros -> ⚓︎ Perdika -> Alimos (Ateny)
21.02.2026	28.02.2026	WSEx	Alimos (Ateny) -> Poros -> Hydra -> Alimos (Ateny)
SUPER PUMA	52	222	8
KYVELI	49	209,4	7"></textarea>
          <span class="help">Najpierw wiersze tras: <b>początek, koniec, nazwa wyprawy, trasa</b>. Potem — w tej samej kolejności — wiersze jachtów: <b>jacht, godziny, mile, liczba osób</b>. Kolumny rozdziela tabulator (tak kopiuje się z Excela). Porty rozdziel „->”, „=>” lub przecinkami; ⚓︎ oznacza kotwicowisko. Wiersze z tą samą nazwą wyprawy i nakładającymi się datami to jeden rejs kilku jachtów. Jeśli wyprawa o tej nazwie już istnieje, rejsy i jachty zostaną do niej dopisane.</span></label>
        <label class="f2">Ślad z plotera (GPX) <span class="opt">(opcjonalnie, można kilka plików)</span><input id="a-gpx" type="file" accept=".gpx,application/gpx+xml" multiple></label>
        <div class="f2 row"><button type="submit" class="btn">Sprawdź dane</button><span class="hint2" id="a-status" role="status"></span></div>
      </form>
      <div id="a-prev"></div>
      <h2 class="sec">Zdjęcia od uczestników</h2>
      <p class="hint2">${SELF ? "Każdy odwiedzający" : "Każdy z dostępem „Współtwórca”"} może dodać zdjęcia przy slajdzie. Tu są te, których jeszcze nie wybrano ani nie odrzucono. Zdjęcia na slajdach układa się przyciskiem „Edytuj” na danym slajdzie.</p>
      <div id="a-q"></div>
      <h2 class="sec">Wyprawy w archiwum</h2>
      <div id="a-list"></div>
      <h2 class="sec">Konta administratorów</h2>
      <div id="a-acc"></div>
      ${SELF ? `<h2 class="sec">Tryb otwarty</h2><p class="hint2" id="op-s" role="status"></p>
      <div class="row"><button type="button" class="btn ghost sm" data-op="24">Włącz na 24 h</button><button type="button" class="btn ghost sm" data-op="72">Na 3 dni</button>
      <button type="button" class="btn ghost sm" data-op="168">Na tydzień</button><button type="button" class="btn ghost sm" data-op="0">Wyłącz</button></div>
      <h2 class="sec">Miejsce na serwerze</h2><p class="hint2" id="disk" role="status">Sprawdzam…</p>
      <h2 class="sec">Kopia zapasowa</h2>
      <p class="hint2">Wszystko — wyprawy, układy slajdów, kadry, autorzy i zdjęcia — jest zapisane na serwerze. Pobierz kopię co jakiś czas i trzymaj ją w innym miejscu.</p>
      <div class="row"><a class="btn ghost sm" href="/api/export" download>Pobierz kopię (.tar)</a>
      <label class="btn ghost sm filebtn">Wczytaj kopię z pliku…<input type="file" id="bk-in" accept=".tar,.json,application/x-tar,application/json" hidden></label></div>
      <label class="f2">Albo wklej dane skopiowane z wersji strony w Claude<textarea id="bk-paste" rows="3" spellcheck="false" placeholder="Ctrl+V"></textarea></label>
      <div class="row"><button type="button" class="btn ghost sm" id="bk-go">Wczytaj wklejone dane</button></div>
      <p class="hint2" id="bk-s" role="status">Wczytanie kopii dodaje jej zawartość: wyprawy i ustawienia o tych samych nazwach zostaną zastąpione, reszta zostaje. Konta administratorów się nie zmieniają.</p>`
      : `<h2 class="sec">Przeniesienie na własny serwer</h2>
      <p class="hint2">Kopiuje wszystko — wyprawy, układy slajdów, kadry, autorów, zgłoszenia i zdjęcia — do schowka. Na własnym serwerze wklej to w panelu administratora, w sekcji „Kopia zapasowa”.</p>
      <div class="row"><button type="button" class="btn ghost sm" id="mv-prep">Przygotuj dane</button><button type="button" class="btn sm" id="mv-copy" hidden>Kopiuj do schowka</button></div>
      <p class="hint2" id="mv-s" role="status"></p>`}
    </section>`;
    renderOpen();
    document.querySelectorAll("[data-op]").forEach(b => b.addEventListener("click", async () => { const h = +b.dataset.op;
      try { await db.doc("site/open").set({until: h ? new Date(Date.now() + h * 3600e3).toISOString() : null, by: adminLogin || null}); OPEN_UNTIL = h ? new Date(Date.now() + h * 3600e3).toISOString() : null; renderOpen(); }
      catch (e) { $("#op-s").textContent = "Nie udało się zmienić — spróbuj ponownie."; } }));
    if (SELF) window.claude.me().then(m => { const d = m.disk, el = $("#disk"); if (!d || !el) return;
      const gb = b => (b / 1073741824).toLocaleString("pl", {maximumFractionDigits: 1}) + " GB", mb = b => Math.round(b / 1048576) + " MB";
      const low = d.free < d.reserve + 1073741824;
      el.innerHTML = `Wolne ${gb(d.free)} z ${gb(d.total)} · zdjęcia zajmują ${mb(d.photos)}.` +
        (m.backup && m.backup.enabled ? `<br>Kopia na GitHubie (${esc(m.backup.repo)}): ${m.backup.photos} ${plural(m.backup.photos, "zdjęcie", "zdjęcia", "zdjęć")}` +
          (m.backup.queued ? `, ${m.backup.queued} w kolejce` : "") + (m.backup.lastError ? ` · <b class="warn">ostatnia próba nieudana: ${esc(m.backup.lastError)}</b>` : m.backup.lastOk ? ` · ostatnio ${new Date(m.backup.lastOk).toLocaleString("pl")}` : "")
          : "<br>Kopia na GitHubie: wyłączona.") +
        (low ? ` <b class="warn">Zostało mało miejsca — poniżej ${mb(d.reserve)} serwer przestanie przyjmować zdjęcia i zmiany. Zwolnij miejsce na dysku albo go powiększ.</b>` : "");
    }).catch(() => {});
    const bkSend = async (body, type) => { const st = $("#bk-s"); st.textContent = "Wczytuję kopię…";
      try { const r = await fetch("/api/import", {method: "POST", credentials: "same-origin", headers: {"X-AKZ": "1", "Content-Type": type}, body});
        if (!r.ok) throw new Error(); const j = await r.json(); st.textContent = `Wczytano: ${j.docs} ${plural(j.docs, "wpis", "wpisy", "wpisów")}, ${j.blobs} ${plural(j.blobs, "zdjęcie", "zdjęcia", "zdjęć")}.`; }
      catch (e) { st.textContent = "Nie udało się wczytać kopii — sprawdź, czy to cały skopiowany tekst albo plik kopii."; } };
    const bk = $("#bk-in"); if (bk) bk.addEventListener("change", async () => { const f = bk.files[0]; if (!f) return;
      await bkSend(f, /\.json$/i.test(f.name) ? "application/json" : "application/x-tar"); bk.value = ""; });
    const bkg = $("#bk-go"); if (bkg) bkg.addEventListener("click", async () => { const t = $("#bk-paste").value.trim(); if (!t) { $("#bk-s").textContent = "Najpierw wklej dane."; return; }
      await bkSend(t, "application/json"); $("#bk-paste").value = ""; });
    const mvp = $("#mv-prep"); if (mvp) { let payload = "";
      mvp.addEventListener("click", async () => { const st = $("#mv-s"); mvp.disabled = true; $("#mv-copy").hidden = true; st.textContent = "Zbieram dane…";
        try { payload = await buildBackup(n => { st.textContent = `Pobieram zdjęcia… ${n}`; });
          st.textContent = `Gotowe: ${(payload.length / 1048576).toFixed(1).replace(".", ",")} MB. Kliknij „Kopiuj do schowka”.`; $("#mv-copy").hidden = false; }
        catch (e) { st.textContent = "Nie udało się zebrać danych."; } mvp.disabled = false; });
      $("#mv-copy").addEventListener("click", async () => { const st = $("#mv-s");
        try { await navigator.clipboard.writeText(payload); st.textContent = "Skopiowano. Teraz wklej to na własnym serwerze: menu → Panel administratora → Kopia zapasowa."; }
        catch (e) { st.textContent = "Przeglądarka nie pozwoliła skopiować — spróbuj ponownie."; } }); }
    map.getSource("others").setData(othersData(VOY)); setPorts([], []);
    $("#af").addEventListener("submit", e => { e.preventDefault(); preview(); });
    renderList(); renderQueue(); renderAccounts(); scrollTo(0, 0);
  };
  const openSlide = (vid, key) => { location.hash = vid;
    setTimeout(() => { const V = VOY.find(v => v.id === vid), i = steps.findIndex(x => x.key === key); if (!V || i < 0) return;
      secs[i].scrollIntoView({block: "start"}); cur = -1; go(i); openEditor(V, key); }, 400); };
  const renderQueue = () => { const el = $("#a-q"); if (!el) return;
    const groups = VOY.map(V => ({V, items: pendingFor(V)})).filter(g => g.items.length);
    el.innerHTML = groups.length ? groups.map(({V, items}) => `<div class="qv"><b>${esc(vt(V))}</b><div class="pm-g">${items.map(s2 => `<figure class="pm-t"><img src="/_blob/${esc(s2.id)}" alt=""><figcaption>${esc(s2.label || keyLabel(V, s2.key))}${s2.caption ? " · " + esc(s2.caption) : ""}${s2.author ? " · fot. " + esc(s2.author) : ""}</figcaption>
      <div class="pm-b"><button type="button" class="link" data-os="${esc(V.id)}|${esc(s2.key)}">otwórz slajd</button><button type="button" class="link" data-qr="${esc(s2.id)}">odrzuć</button></div></figure>`).join("")}</div></div>`).join("")
      : `<p class="hint2">${SUBS.length ? "Wszystkie zgłoszone zdjęcia zostały już przejrzane." : "Na razie nikt nie dodał zdjęć."}</p>`;
    el.querySelectorAll("[data-os]").forEach(b => b.addEventListener("click", () => { const [vid, key] = b.dataset.os.split("|"); openSlide(vid, key); }));
    el.querySelectorAll("[data-qr]").forEach(b => b.addEventListener("click", async () => { REJECTED = [...REJECTED, b.dataset.qr]; try { await db.doc("review/state").set({rejected: REJECTED}); } catch (e) {} renderQueue(); }));
  };
  const renderAccounts = async () => { const el = $("#a-acc"); if (!el || !db) return;
    let acc = []; try { const sn = await db.doc("config/admins").get(); acc = sn.exists ? sn.data().accounts || [] : []; } catch (e) {}
    el.innerHTML = `<ul class="ylist">${acc.map((a, i) => `<li>${esc(a.login)}${a.login === adminLogin ? " (ty)" : ""} ${acc.length > 1 ? `<button type="button" class="link" data-ra="${i}">usuń</button>` : ""}</li>`).join("")}</ul>
      <form id="acc-f" class="form" novalidate><label>Nowy login<input id="acc-u" autocomplete="off"></label><label>Hasło (min. 8 znaków)<input id="acc-p" type="password" autocomplete="new-password"></label>
      <div class="f2 row"><button type="submit" class="btn sm">Dodaj konto</button><span class="hint2" id="acc-s" role="status"></span></div></form>
      ${SELF ? "" : `<p class="hint2">Logować się mogą tylko osoby, którym udostępniono stronę w Claude z dostępem „Edytor”.</p>`}`;
    el.querySelectorAll("[data-ra]").forEach(b => { let arm = false; b.addEventListener("click", async () => { if (!arm) { arm = true; b.textContent = "na pewno?"; return; }
      acc.splice(+b.dataset.ra, 1); await db.doc("config/admins").set({accounts: acc}); renderAccounts(); }); });
    $("#acc-f").addEventListener("submit", async e => { e.preventDefault(); const u = $("#acc-u").value.trim(), p = $("#acc-p").value, st = $("#acc-s");
      if (!u || p.length < 8) { st.textContent = "Podaj login i hasło (min. 8 znaków)."; return; }
      if (acc.some(a => a.login.toLowerCase() === u.toLowerCase())) { st.textContent = "Taki login już istnieje."; return; }
      const salt = newSalt(); acc.push({login: u, salt, hash: await hashPw(p, salt), iter: 150000});
      try { await db.doc("config/admins").set({accounts: acc}); renderAccounts(); } catch (err) { st.textContent = "Nie udało się zapisać."; } });
  };

  // ---- preview of pasted sheet rows ----
  let draft = null;
  const sameDates = (a, b) => a.start && b.start && a.start < b.end && b.start < a.end;
  const preview = async () => {
    const status = $("#a-status"), box = $("#a-prev");
    const P0 = parseSheet($("#a-log").value);
    if (P0.errors.length || !P0.rows.length) { box.innerHTML = `<div class="warn"><b>Do poprawy:</b><ul>${(P0.errors.length ? P0.errors : ["Brak kompletnych wierszy (trasa + jacht z godzinami i milami)."]).map(e => `<li>${esc(e)}</li>`).join("")}</ul></div>`; status.textContent = ""; return; }
    const R = registry(), unknown = new Map();
    for (const r of P0.rows) {
      r.st = r.stops.map(s => { const hit = resolve(R, s.raw); const name = hit ? hit.name : s.raw.replace(/\s*\(.*?\)\s*/g, " ").trim() || s.raw;
        if (!hit && !unknown.has(name)) unknown.set(name, {name, raw: s.raw, anchor: s.anchor, c: null, cands: []});
        if (!hit && s.anchor) unknown.get(name).anchor = true;
        return {name, c: hit ? hit.c : null, a: s.anchor || !!(hit && hit.a)}; });
      r.names = r.st.map(s => s.name);
    }
    const gpx = await parseGpx($("#a-gpx").files);
    if (unknown.size) { status.textContent = "Szukam miejsc w bazie portów…";
      try { await loadGaz(); } catch (e) { status.textContent = e.message; }
      const known = P0.rows.flatMap(r => r.st.filter(s => s.c).map(s => s.c));
      const near = known.length ? [known.reduce((a, c) => a + c[0], 0) / known.length, known.reduce((a, c) => a + c[1], 0) / known.length] : null;
      for (const u of unknown.values()) { u.cands = GZ ? findPlace(u, near) : []; if (u.cands.length) { u.pick = 0; u.c = [u.cands[0][2], u.cands[0][1]]; u.how = "gaz"; } } }
    const groups = groupRows(P0.rows);
    for (const G of groups) {
      G.target = VOY.find(v => fold(v.title) === fold(G.title)) || null;
      for (const L of G.legs) { const sig = L.rows[0].names.join(">");
        L.match = G.target ? G.target.legs.findIndex(x => (L.start && x.start) ? sameDates(L, x) : (!L.start && !x.start && x.routes.some(R2 => R2.stops.join(">") === sig))) : -1; }
    }
    draft = {groups, unknown, gpx, legs: P0.rows.map(r => ({stops: r.st})), bad: P0.rows.filter(r => !r.ok)};
    renderPreview(); status.textContent = P0.skipped.length ? `Pominięto ${P0.skipped.length} ${plural(P0.skipped.length, "wiersz", "wiersze", "wierszy")}, których nie rozpoznano.` : "";
  };
  const renderPreview = (fit = true) => {
    const d = draft, box = $("#a-prev"); const unk = [...d.unknown.values()];
    box.innerHTML = `<div class="card2">
      ${d.groups.map(G => `<div class="pv"><h2>${esc(G.title)}</h2><span class="kick">Edycja: ${esc((seriesList().find(x => x.key === seriesOf(G.target || {title: G.title})) || {name: "Inne rejsy"}).name)}</span>
        <p class="hint2">${G.target ? `Wyprawa już istnieje — ${G.legs.filter(L => L.match >= 0).length ? "jachty zostaną dopisane do istniejących rejsów, " : ""}nowe rejsy zostaną dodane.` : "Nowa wyprawa."}</p>
        ${table(["Rejs", "Jachty (h · Mm · osoby)"], G.legs.map((L, i) => [`${i + 1}. ${route(L.rows[0].names)}<small class="d">${L.start ? dates(L) : "brak poprawnych dat"}${L.match >= 0 ? ` · dopisze do rejsu ${L.match + 1}` : G.target ? " · nowy rejs" : ""}</small>${[...new Set(L.rows.map(r => r.names.join(">")))].length > 1 ? `<small class="d">${[...new Set(L.rows.map(r => r.names.join(">")))].length} warianty trasy</small>` : ""}`,
          L.rows.map(r => `${esc(r.boat.name)} <span class="hint2">${fmt(r.boat.h)} · ${fmt(r.boat.nm)} · ${r.boat.crew == null ? "—" : r.boat.crew}</span>`).join("<br>")]))}</div>`).join("")}
      ${d.bad.length ? `<div class="match"><b>Błędne daty (${d.bad.length})</b>${d.bad.map(r => `<p>${esc(r.voy)}: ${esc(r.rawDates)} — ${esc(route(r.names))}, ${esc(r.boat.name)} → ${r.joined ? "dołączono do sąsiedniego rejsu z tą samą trasą" : "zapisany bez dat"}</p>`).join("")}</div>` : ""}
      ${d.groups.some(G => G.legs.some(L => L.rows.some(r => r.boat.crew == null))) ? `<p class="hint2">Część jachtów nie ma liczby osób (4. kolumna) — można ją uzupełnić później w „Szczegółach”.</p>` : ""}
      ${d.gpx.length ? `<p class="hint2">GPX: ${d.gpx.length} ${plural(d.gpx.length, "trasa", "trasy", "tras")} z plotera — ślad pójdzie po nich.</p>` : ""}
      ${unk.length ? `<div class="unk"><h3>Nowe miejsca (${unk.length})</h3>
        <p class="hint2">Dopasowano je do bazy ok. 28 000 portów i nadmorskich miejscowości. Jeśli miejsca nie ma (np. kotwicowisko) albo dopasowanie jest złe — kliknij „Postaw na mapie” i wskaż je kliknięciem. Każdą czerwoną pinezkę można przeciągnąć.</p>
        <ul class="plist">${unk.map((u, i) => `<li><div class="pl-h"><b>${esc(u.name)}</b><span class="${u.c ? "ok" : "no"}">${u.c ? (u.how === "map" ? "postawiono na mapie" : u.how === "drag" ? "przesunięto ręcznie" : "znaleziono") : "brak — wskaż na mapie"}</span></div>
          <div class="row">${u.cands.length ? `<select data-cand="${i}" aria-label="Dopasowanie dla ${esc(u.name)}">${u.cands.map((c, j) => `<option value="${j}"${u.pick === j ? " selected" : ""}>${esc(c[0])} — ${esc(ccName(c[3]))}${c[4] ? ", port" : ""}</option>`).join("")}${u.how === "map" || u.how === "drag" ? `<option value="-1" selected>własna pinezka</option>` : ""}</select>` : ""}
          <button type="button" class="btn ghost sm" data-pickmap="${i}">Postaw na mapie</button>
          <label class="radio"><input type="checkbox" data-ua="${i}"${u.anchor ? " checked" : ""}> kotwicowisko</label></div>
          ${u.c ? `<span class="hint2">${pos(u.c)}</span>` : ""}</li>`).join("")}</ul></div>` : ""}
      <div class="row"><button type="button" class="btn" id="save">Wyznacz trasy i zapisz</button><span class="hint2" id="save-s" role="status"></span></div>
      <div class="bar" id="bar" hidden><i></i></div></div>`;
    box.querySelectorAll("[data-cand]").forEach(sel => sel.addEventListener("change", () => { const u = unk[+sel.dataset.cand], j = +sel.value;
      if (j >= 0) { const c = u.cands[j]; u.pick = j; u.c = [c[2], c[1]]; u.how = "gaz"; renderPreview(false); flyToPin(u); } }));
    box.querySelectorAll("[data-pickmap]").forEach(b => b.addEventListener("click", () => startPick(unk[+b.dataset.pickmap])));
    box.querySelectorAll("[data-ua]").forEach(cb => cb.addEventListener("change", () => { unk[+cb.dataset.ua].anchor = cb.checked; }));
    $("#save").addEventListener("click", save);
    showDraftPins(fit);
    if (fit) box.scrollIntoView({behavior: reduce ? "auto" : "smooth", block: "start"});
  };
  const draftPorts = () => { const out = [];
    for (const l of draft.legs) for (const s of l.stops) { const c = s.c || draft.unknown.get(s.name)?.c; if (c && isFinite(c[0]) && isFinite(c[1])) out.push([s.name, c]); } return out; };
  let draftMarkers = [], picking = null;
  const pinEl = (name, own) => { const e = document.createElement("div"); e.className = own ? "dpin own" : "dpin"; e.title = name; return e; };
  const showDraftPins = (fit) => {
    draftMarkers.forEach(m => m.remove()); draftMarkers = [];
    const pp = draftPorts(); setPorts(pp.filter(([n]) => !draft.unknown.has(n)), []);
    for (const u of draft.unknown.values()) { if (!u.c) continue;
      const m = new maplibregl.Marker({element: pinEl(u.name, true), draggable: true}).setLngLat(u.c).addTo(map);
      const lab = document.createElement("div"); lab.className = "lbl on"; lab.textContent = u.name;
      const lm = new maplibregl.Marker({element: lab, anchor: "left"}).setLngLat(u.c).addTo(map);
      m.on("drag", () => lm.setLngLat(m.getLngLat()));
      m.on("dragend", () => { const p = m.getLngLat(); u.c = [+p.lng.toFixed(4), +p.lat.toFixed(4)]; u.how = "drag"; renderPreview(false); });
      draftMarkers.push(m, lm); }
    if (fit && pp.length) map.fitBounds(bounds(pp.map(p => p[1])), {padding: 60, maxZoom: 7, duration: reduce ? 0 : 800});
  };
  const flyToPin = u => { if (u.c) map.flyTo({center: u.c, zoom: Math.max(map.getZoom(), 8), duration: reduce ? 0 : 900}); };
  // where to look for a place that is not in the gazetteer: between its known neighbours on the route
  const guessArea = u => { for (const l of draft.legs) { const i = l.stops.findIndex(s => s.name === u.name); if (i < 0) continue;
      const known = j => { const s = l.stops[j]; if (!s) return null; return s.c || draft.unknown.get(s.name)?.c || null; };
      let a = null, b = null; for (let j = i - 1; j >= 0 && !a; j--) a = known(j); for (let j = i + 1; j < l.stops.length && !b; j++) b = known(j);
      if (a && b) return {center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], pts: [a, b]}; if (a || b) return {center: a || b, pts: [a || b]}; }
    return null; };
  const startPick = u => {
    picking = u; mapEl.classList.add("picking");
    const h = $("#pickhint"); h.hidden = false; h.querySelector("b").textContent = u.name;
    const g = u.c ? {center: u.c, pts: [u.c]} : guessArea(u);
    if (g) { if (g.pts.length > 1) map.fitBounds(bounds(g.pts), {padding: 80, maxZoom: 9, duration: reduce ? 0 : 900}); else map.flyTo({center: g.center, zoom: 9, duration: reduce ? 0 : 900}); }
    if (innerWidth <= 860) scrollTo({top: 0, behavior: reduce ? "auto" : "smooth"});
  };
  const endPick = () => { picking = null; mapEl.classList.remove("picking"); $("#pickhint").hidden = true; };
  $("#pickhint button").addEventListener("click", endPick);
  map.on("click", e => { if (!picking || !draft) return; const u = picking; endPick();
    u.c = [+e.lngLat.lng.toFixed(4), +e.lngLat.lat.toFixed(4)]; u.how = "map"; renderPreview(false); });
  // gazetteer: club ports first, then UN/LOCODE seaports and coastal towns (loaded only for admins)
  let GZ = null;
  const loadGaz = () => GZ ? Promise.resolve(GZ) : new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = "gaz.js";
    sc.onload = () => { GZ = new Map(); for (const g of window.GAZ) { for (const k of new Set([fold(g[0]), baseName(g[0])])) { if (!GZ.has(k)) GZ.set(k, []); GZ.get(k).push(g); } } res(GZ); };
    sc.onerror = () => rej(new Error("nie wczytano bazy portów")); document.head.append(sc); });
  const CC = {NO:"Norwegia",SE:"Szwecja",DK:"Dania",DE:"Niemcy",PL:"Polska",GB:"Wielka Brytania",FR:"Francja",NL:"Holandia",BE:"Belgia",SJ:"Svalbard",FI:"Finlandia",EE:"Estonia",LV:"Łotwa",LT:"Litwa",RU:"Rosja",IS:"Islandia",IE:"Irlandia",ES:"Hiszpania",PT:"Portugalia",IT:"Włochy",HR:"Chorwacja",GR:"Grecja",TR:"Turcja",ME:"Czarnogóra",FO:"Wyspy Owcze",GL:"Grenlandia",US:"USA",CA:"Kanada"};
  const ccName = c => CC[c] || c;
  const findPlace = (u, near) => { const k1 = fold(u.raw), k2 = baseName(u.raw), al = ALIAS[k1] || ALIAS[k2];
    const list = [...(GZ.get(k1) || []), ...(GZ.get(k2) || []), ...(al ? GZ.get(fold(al)) || [] : [])];
    const uniq = []; for (const g of list) if (!uniq.some(x => Math.abs(x[1] - g[1]) < 0.05 && Math.abs(x[2] - g[2]) < 0.1)) uniq.push(g);
    const d2 = g => near ? (g[1] - near[1]) ** 2 + ((g[2] - near[0]) * Math.cos(near[1] * Math.PI / 180)) ** 2 : 0;
    return uniq.sort((a, b) => d2(a) - d2(b) || a[4] - b[4]).slice(0, 6); };
  // stored form of a voyage: tracks polyline-encoded so a whole voyage fits one record
  const packLegs = legs => legs.map(L => ({start: L.start || null, end: L.end || null,
    routes: L.routes.map(R => ({stops: R.stops, hops: R.hops.map(h => ({from: h.from, to: h.to, enc: h.enc || enc(h.coords)}))})),
    boats: L.boats.map(b => ({name: b.name, crew: b.crew ?? null, h: b.h, nm: b.nm, route: b.route}))}));
  const save = async () => {
    const d = draft, s = $("#save-s"), btn = $("#save");
    if (!db) { s.textContent = "Brak dostępu do bazy danych."; return; }
    for (const u of d.unknown.values()) if (!u.c || !isFinite(u.c[0]) || !isFinite(u.c[1])) { s.textContent = `Brak położenia: ${u.name} — wskaż je na mapie.`; return; }
    btn.disabled = true;
    try {
      // known tracks are reused; only new passages are routed
      const known = new Map(); const key = (a, b) => a + "\u0000" + b;
      for (const V of VOY) for (const L of V.legs) for (const R of L.routes) for (const h of R.hops) { known.set(key(h.from, h.to), h); }
      const coordOf = n => { const u = d.unknown.get(n); if (u) return u.c; for (const r of d.legs) for (const x of r.stops) if (x.name === n && x.c) return x.c; return null; };
      const need = [], needIdx = new Map();
      for (const r of d.legs) for (let i = 0; i < r.stops.length - 1; i++) { const a = r.stops[i].name, b = r.stops[i + 1].name;
        if (known.has(key(a, b)) || known.has(key(b, a)) || needIdx.has(key(a, b)) || needIdx.has(key(b, a))) continue;
        needIdx.set(key(a, b), need.length); need.push([coordOf(a), coordOf(b)]); }
      let routed = [];
      if (need.length) { $("#bar").hidden = false; s.textContent = "Wyznaczam trasy po morzu…";
        routed = await routeHops(need, d.gpx, (k2, n) => { $("#bar i").style.width = (100 * k2 / n) + "%"; s.textContent = `Wyznaczam trasy po morzu… ${k2}/${n}`; }); }
      const hopOf = (a, b) => { if (known.has(key(a, b))) { const h = known.get(key(a, b)); return {from: a, to: b, enc: h.enc || enc(coordsOf(h))}; }
        if (known.has(key(b, a))) return {from: a, to: b, enc: enc(coordsOf(known.get(key(b, a))).slice().reverse())};
        if (needIdx.has(key(a, b))) return {from: a, to: b, enc: enc(routed[needIdx.get(key(a, b))])};
        return {from: a, to: b, enc: enc(routed[needIdx.get(key(b, a))].slice().reverse())}; };
      const mkRoute = names => ({stops: names, hops: names.slice(0, -1).map((a, i) => hopOf(a, names[i + 1]))});
      let firstId = null;
      for (const G of d.groups) {
        const T = G.target;
        const legs = T ? T.legs.map(L => ({start: L.start, end: L.end, routes: L.routes.map(R => ({stops: R.stops, hops: R.hops})), boats: L.boats.map(b => ({...b}))})) : [];
        for (const NL of G.legs) {
          const L = NL.match >= 0 ? legs[NL.match] : {start: NL.start, end: NL.end, routes: [], boats: []};
          if (NL.match < 0) legs.push(L);
          if (NL.start && (!L.start || NL.start < L.start)) L.start = NL.start;
          if (NL.end && (!L.end || NL.end > L.end)) L.end = NL.end;
          for (const r of NL.rows) {
            let ri = L.routes.findIndex(R => R.stops.join(">") === r.names.join(">"));
            if (ri < 0) { L.routes.push(mkRoute(r.names)); ri = L.routes.length - 1; }
            const boat = {name: r.boat.name, crew: r.boat.crew, h: r.boat.h, nm: r.boat.nm, route: ri};
            const bi = L.boats.findIndex(b => b.name === boat.name);
            if (bi >= 0) L.boats[bi] = boat; else L.boats.push(boat);
          }
        }
        // the route most boats sailed comes first: the animation follows it
        for (const L of legs) { const cnt2 = L.routes.map((_, i) => L.boats.filter(b => b.route === i).length);
          const order = L.routes.map((_, i) => i).sort((a, b) => cnt2[b] - cnt2[a] || a - b);
          L.routes = order.map(i => L.routes[i]); L.boats.forEach(b => { b.route = order.indexOf(b.route); }); }
        legs.sort((a, b) => (a.start && b.start) ? a.start.localeCompare(b.start) : 0);
        const ports = {...(T ? T.ports : {})}, anchor = new Set(T ? T.anchor || [] : []);
        for (const r of G.rows) for (const x of r.st) { ports[x.name] = d.unknown.get(x.name)?.c || x.c; if (d.unknown.get(x.name)?.anchor || x.a) anchor.add(x.name); }
        const body = {title: T ? T.title : G.title, sub: T ? T.sub || "" : "", start: null, end: null, ports, anchor: [...anchor], legs: packLegs(legs)};
        const st = legs.map(L => L.start).filter(Boolean).sort(), en = legs.map(L => L.end).filter(Boolean).sort();
        body.start = st[0] || null; body.end = en[en.length - 1] || null;
        if (JSON.stringify(body).length > 240000) throw {code: "too_big", title: body.title};
        s.textContent = `Zapisuję „${body.title}”…`;
        if (T && T.seed) { const m = {...(META[T.id] || {})}; m.override = body; delete m.crew; await db.doc("meta/" + T.id).set(m); firstId = firstId || T.id; }
        else if (T) { await db.doc("voyages/" + T.id).set({...body, created: T.created || new Date().toISOString()});
          if (META[T.id] && META[T.id].crew) { const m = {...META[T.id]}; delete m.crew; await db.doc("meta/" + T.id).set(m); } firstId = firstId || T.id; }
        else { const id = slug(body.title) + "-" + Math.random().toString(36).slice(2, 6); await db.doc("voyages/" + id).set({...body, created: new Date().toISOString()}); firstId = firstId || id; }
      }
      s.textContent = "Zapisano."; location.hash = firstId;
    } catch (e) {
      s.textContent = e && e.code === "too_big" ? `Wyprawa „${e.title}” jest za duża do zapisu w jednym rekordzie.` : e && e.code === "quota_exceeded" ? "Baza jest pełna — usuń zbędne wpisy." : e && e.code === "invalid_argument" ? "Brak uprawnień do zapisu (potrzebny dostęp edytora)." : "Zapis nie powiódł się — spróbuj ponownie.";
      btn.disabled = false;
    }
  };

  // ---- archive list: crew, photos, removal ----
  let openPane = null, paneMsg = "";
  const renderList = () => {
    const el = $("#a-list"); if (!el) return;
    const all = [...SEED.map(v => ({...v, seed: true})), ...DBV].map(v => VOY.find(x => x.id === v.id) || {...norm(v), seed: !!SEED.find(s => s.id === v.id), hidden: true, photos: (META[v.id] || {}).photos || {}});
    el.innerHTML = all.map(V => `<div class="aitem${V.hidden ? " off" : ""}" data-id="${esc(V.id)}">
      <div class="ahead"><div><b>${esc(vt(V))}</b><span class="hint2">${nRejs(V.legs.length)}${V.boatTot ? " · " + nJacht(V.boatTot.length) : ""}${dates(V) ? " · " + dates(V) : ""}${V.hidden ? " · ukryta" : ""}</span></div>
      <div class="row">${V.hidden ? "" : `<a class="btn ghost sm" href="#${esc(V.id)}">Otwórz</a>`}<button type="button" class="btn ghost sm" data-act="edit">Załogi i widoczność</button></div></div>
      <div class="apanel" hidden></div></div>`).join("") || `<p class="hint2">Brak wypraw.</p>`;
    el.querySelectorAll(".aitem").forEach(it => { const V = all.find(v => v.id === it.dataset.id), pane = it.querySelector(".apanel");
      const open = kind => { const same = !pane.hidden && pane.dataset.k === kind; pane.hidden = same; pane.dataset.k = kind; paneMsg = "";
        openPane = same ? null : {id: V.id, k: kind}; if (!same) editPane(V, pane); };
      it.querySelector("[data-act=edit]").addEventListener("click", () => open("e"));
      if (openPane && openPane.id === V.id) { pane.hidden = false; pane.dataset.k = openPane.k; editPane(V, pane); }
      it.addEventListener("mouseenter", () => { if (!V.hidden) map.getSource("others").setData(othersData(VOY, VOY.find(x => x.id === V.id))); });
    });
  };
  // destructive actions: in a closed red section, confirmed twice (button, then typing the voyage name)
  const dangerZone = acts => acts.length ? `<details class="danger"><summary>Strefa niebezpieczna</summary>
    ${acts.map(a => `<div class="dz"><p>${a.desc}</p><button type="button" class="btn red sm" data-dz="${a.id}">${a.label}</button></div>`).join("")}
    <div class="dz-c" hidden><p class="dz-q"></p><input class="dz-in" autocomplete="off" spellcheck="false" aria-label="Nazwa wyprawy do potwierdzenia">
    <div class="row"><button type="button" class="btn red sm dz-go" disabled></button><button type="button" class="btn ghost sm dz-no">Anuluj</button></div><p class="hint2 dz-s" role="status"></p></div></details>` : "";
  const wireDanger = (root, V, acts) => { const dz = root.querySelector("details.danger"); if (!dz) return;
    const c = dz.querySelector(".dz-c"), inp = c.querySelector(".dz-in"), go = c.querySelector(".dz-go"), name = vt(V);
    let act = null;
    dz.querySelectorAll("[data-dz]").forEach(b => b.addEventListener("click", () => { act = acts.find(a => a.id === b.dataset.dz);
      c.hidden = false; inp.value = ""; go.disabled = true; go.textContent = act.confirm; c.querySelector(".dz-s").textContent = "";
      c.querySelector(".dz-q").innerHTML = `${act.warn} Aby potwierdzić, wpisz nazwę wyprawy: <b>${esc(name)}</b>`; inp.focus(); }));
    inp.addEventListener("input", () => { go.disabled = inp.value.trim().toLowerCase() !== name.toLowerCase(); });
    c.querySelector(".dz-no").addEventListener("click", () => { c.hidden = true; act = null; });
    go.addEventListener("click", async () => { if (go.disabled || !act) return; go.disabled = true; c.querySelector(".dz-s").textContent = "Pracuję…";
      try { await act.run(); } catch (e) { c.querySelector(".dz-s").textContent = "Nie udało się."; go.disabled = false; } });
  };
  const removeVoyage = async V => { if (V.seed) await metaSet(V.id, {hidden: true}); else { await db.doc("voyages/" + V.id).delete(); await db.doc("meta/" + V.id).delete(); } };
  const voyageActs = (V, after) => [{id: "del", label: V.seed ? "Ukryj wyprawę" : "Usuń wyprawę", confirm: V.seed ? "Ukryj wyprawę" : "Usuń na zawsze",
    desc: V.seed ? "Wyprawa zniknie ze strony. Można ją potem przywrócić w panelu administratora." : "Usuwa wyprawę razem z ustawieniami slajdów. Tego nie da się cofnąć.",
    warn: V.seed ? "Wyprawa zniknie ze strony." : "Wyprawa zostanie usunięta na zawsze.", run: async () => { await removeVoyage(V); after(); }}];
  const metaSet = async (id, patch) => { const m = {...(META[id] || {}), ...patch}; await db.doc("meta/" + id).set(m); META[id] = m; rebuild(); };
  const editPane = (V, pane) => {
    pane.innerHTML = `<div class="form">
      <div class="f2"><b>Liczba osób na jachtach</b>
        ${V.legs.map((L, li) => `<div class="crewleg"><span class="hint2">Rejs ${li + 1}: ${esc(route(L.routes[0].stops))}${L.start ? " · " + dates(L) : ""}</span>
          ${L.boats.map((b, bi) => `<label class="crew"><span>${esc(b.name)}</span><input type="number" min="0" max="99" inputmode="numeric" data-crew="${li}:${bi}" value="${b.crew ?? ""}" aria-label="Liczba osób: ${esc(b.name)}, rejs ${li + 1}"></label>`).join("")}</div>`).join("")}</div>
      <div class="f2 row"><button type="button" class="btn sm" data-a="crew">Zapisz załogi</button>
      ${V.hidden ? `<button type="button" class="btn ghost sm" data-a="hide">Przywróć wyprawę</button>` : ""}<span class="hint2" role="status"></span></div>
      ${V.hidden ? "" : dangerZone(voyageActs(V, () => {}))}</div>`;
    const st = pane.querySelector("[role=status]");
    st.textContent = paneMsg;
    const run = async (fn, okMsg) => { if (!db) { st.textContent = "Brak dostępu do bazy."; return; } try { await fn(); paneMsg = okMsg; } catch (e) { paneMsg = "Nie udało się zapisać."; }
      const st2 = document.querySelector(`.aitem[data-id="${CSS.escape(V.id)}"] .apanel [role=status]`); if (st2) st2.textContent = paneMsg; };
    pane.querySelector("[data-a=crew]").addEventListener("click", () => run(async () => {
      const crew = {}; pane.querySelectorAll("[data-crew]").forEach(i => { const v = i.value.trim(); if (v !== "") crew[i.dataset.crew] = Math.max(0, Math.round(+v)); });
      await metaSet(V.id, {crew, crewRev: V.rev || null});
    }, "Zapisano załogi."));
    const rb = pane.querySelector("[data-a=hide]"); if (rb) rb.addEventListener("click", () => run(() => metaSet(V.id, {hidden: false}), "Przywrócono."));
    wireDanger(pane, V, voyageActs(V, () => { paneMsg = "Gotowe."; }));
  };
  // ================= LOGIN, SUBMISSIONS, EDITING, PRESENTATION CONTROLS =================
  // Real write protection is the page's sharing level (only Editors can change data).
  // The login is a second lock on top of it: admin tools appear only after logging in.
  let canEditor = false, isOwnerU = false, uid = null, userCap = null;
  const SELF = !!(window.claude && window.claude.selfHosted);
  let adminLogin = null; try { adminLogin = sessionStorage.getItem("akz-admin"); } catch (e) {}
  let editMode = true; try { editMode = sessionStorage.getItem("akz-edit") !== "0"; } catch (e) {}
  const adminOn = () => !!(canEditor && adminLogin);
  const editOn = () => adminOn() && editMode;
  let SUBS = [], REJECTED = [], TEXTS = {};
  const b64e = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const hashPw = async (pw, salt, iter = 150000) => {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
    return b64e(await crypto.subtle.deriveBits({name: "PBKDF2", hash: "SHA-256", salt: b64d(salt), iterations: iter}, key, 256)); };
  const newSalt = () => b64e(crypto.getRandomValues(new Uint8Array(16)));
  const setSession = login => { adminLogin = login; try { login ? sessionStorage.setItem("akz-admin", login) : sessionStorage.removeItem("akz-admin"); } catch (e) {} syncMenu(); };

  // ---- generic modal ----
  const modal = $("#modal"), mBody = $("#m-body");
  let modalClose = null;
  const openModal = (html, onClose) => { mBody.innerHTML = html; modal.hidden = false; modalClose = onClose || null;
    const f = mBody.querySelector("input:not([type=hidden]),select,textarea,button"); if (f) f.focus(); };
  const closeModal = () => { modal.hidden = true; mBody.innerHTML = ""; const c = modalClose; modalClose = null; if (c) c(); };
  modal.addEventListener("click", e => { if (e.target === modal || e.target.closest("[data-mclose]")) closeModal(); });
  addEventListener("keydown", e => { if (e.key === "Escape" && !modal.hidden) { e.stopPropagation(); closeModal(); } }, true);

  // ---- menu state ----
  const syncMenu = () => { const on = adminOn();
    $("#m-login").hidden = on; $("#m-admin").hidden = !on; $("#m-edit").hidden = !on; $("#m-logout").hidden = !on;
    $("#m-edit").firstChild.textContent = editMode ? "Tryb edycji: włączony" : "Tryb edycji: wyłączony";
    isAdmin = on; };
  $("#m-login").addEventListener("click", () => { setMenu(false); openLogin(); });
  $("#m-logout").addEventListener("click", () => { setMenu(false); if (SELF) { window.claude.logout(); canEditor = false; } setSession(null); if (mode === "admin") location.hash = ""; else rerender(); });
  $("#m-edit").addEventListener("click", () => { editMode = !editMode; try { sessionStorage.setItem("akz-edit", editMode ? "1" : "0"); } catch (e) {} syncMenu(); setMenu(false); rerender(); });

  const openLogin = () => {
    openModal(`<h2>Logowanie administratora</h2>
      <form id="lf" class="form one" novalidate>
        <label>Login<input id="lg-u" autocomplete="username" required></label>
        <label>Hasło<input id="lg-p" type="password" autocomplete="current-password" required></label>
        <label id="lg-p2w" hidden>Powtórz hasło<input id="lg-p2" type="password" autocomplete="new-password"></label>
        <div class="row"><button type="submit" class="btn" id="lg-go">Zaloguj</button><button type="button" class="btn ghost" data-mclose>Anuluj</button></div>
        <p class="hint2" id="lg-s" role="status"></p></form>`);
    let setup = false;
    $("#lf").addEventListener("submit", async e => { e.preventDefault();
      const st = $("#lg-s"), u = $("#lg-u").value.trim(), p = $("#lg-p").value;
      if (!u || !p) { st.textContent = "Podaj login i hasło."; return; }
      if (SELF) { st.textContent = "Sprawdzam…";
        try { const r = await window.claude.login(u, p); canEditor = true; startSubs(); setSession(r.login); closeModal(); rerender(); }
        catch (err) { st.textContent = err.status === 401 ? "Nieprawidłowy login lub hasło." : err.status === 429 ? "Za dużo prób — spróbuj ponownie za kwadrans."
          : err.status === 409 ? "Na serwerze nie ma jeszcze konta. Uruchom kontener ze zmiennymi ADMIN_LOGIN i ADMIN_PASSWORD." : "Nie udało się połączyć z serwerem."; }
        return; }
      if (!db || !canEditor) { st.textContent = "Logowanie jest dostępne tylko dla osób z dostępem „Edytor” do tej strony w Claude. Poproś właściciela strony o taki dostęp."; return; }
      if (!crypto.subtle) { st.textContent = "Ta przeglądarka nie obsługuje bezpiecznego logowania."; return; }
      st.textContent = "Sprawdzam…";
      try {
        const snap = await db.doc("config/admins").get(); const acc = snap.exists ? (snap.data().accounts || []) : [];
        if (!acc.length) {
          if (!isOwnerU) { st.textContent = "Nie ma jeszcze żadnego konta. Pierwsze konto zakłada właściciel strony."; return; }
          if (!setup) { setup = true; $("#lg-p2w").hidden = false; $("#lg-go").textContent = "Utwórz konto i zaloguj"; st.textContent = "To pierwsze logowanie: ustal login i hasło administratora (min. 8 znaków) i powtórz hasło."; $("#lg-p2").focus(); return; }
          if (p.length < 8) { st.textContent = "Hasło musi mieć co najmniej 8 znaków."; return; }
          if (p !== $("#lg-p2").value) { st.textContent = "Hasła się różnią."; return; }
          const salt = newSalt(); await db.doc("config/admins").set({accounts: [{login: u, salt, hash: await hashPw(p, salt), iter: 150000}]});
          setSession(u); closeModal(); rerender(); return;
        }
        const a = acc.find(x => x.login.toLowerCase() === u.toLowerCase());
        if (!a || await hashPw(p, a.salt, a.iter || 150000) !== a.hash) { st.textContent = "Nieprawidłowy login lub hasło."; return; }
        setSession(a.login); closeModal(); rerender();
      } catch (err) { st.textContent = "Nie udało się zalogować — spróbuj ponownie."; }
    });
  };

  // ---- photo submissions (anyone with Contributor access) ----
  const urlOf = id => "/_blob/" + id;
  const usedPhotos = V => new Set(Object.values(V.slides || {}).flatMap(s => s.photos || []));
  const pendingFor = (V, key) => { const used = usedPhotos(V); return SUBS.filter(s => s.v === V.id && (!key || s.key === key) && !REJECTED.includes(s.id) && !used.has(s.id)); };
  const shrink = async file => {
    let bmp; try { bmp = await createImageBitmap(file); } catch (e) { return file; } const s = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise(r => c.toBlob(b => r(b || file), "image/jpeg", 0.85));
  };
  const openUpload = (V, key, label) => {
    const can = !!(db && assets && uid);
    openModal(`<h2>Dodaj zdjęcia</h2><p class="hint2">${esc(vt(V))} · ${esc(label)}</p>
      ${can ? `<form id="uf" class="form one" novalidate>
        <label>Zdjęcia<input id="uf-f" type="file" accept="image/*" multiple required></label>
        <label>Opis <span class="opt">(opcjonalnie — co jest na zdjęciu)</span><input id="uf-c" maxlength="200"></label>
        <label>Autor zdjęć <span class="opt">(opcjonalnie — imię i nazwisko pojawi się pod zdjęciem)</span><input id="uf-a" maxlength="80" autocomplete="name"></label>
        <p class="hint2">Zdjęcia trafią do administratorów, którzy wybiorą, co pokazać na stronie.</p>
        <div class="row"><button type="submit" class="btn">Wyślij</button><button type="button" class="btn ghost" data-mclose>Zamknij</button></div>
        <div class="bar" id="uf-bar" hidden><i></i></div><p class="hint2" id="uf-s" role="status"></p></form>`
      : SELF ? `<p>Nie udało się połączyć z serwerem — spróbuj za chwilę.</p><div class="row"><button type="button" class="btn ghost" data-mclose>Zamknij</button></div>`
      : `<p>Aby dodawać zdjęcia, zaloguj się do Claude i poproś właściciela strony o dostęp „Współtwórca” (Contributor) lub wyższy.</p><div class="row"><button type="button" class="btn ghost" data-mclose>Zamknij</button></div>`}`);
    if (!can) return;
    try { $("#uf-a").value = localStorage.getItem("akz-author") || ""; } catch (e) {}
    $("#uf").addEventListener("submit", async e => { e.preventDefault();
      const author = $("#uf-a").value.trim(); try { localStorage.setItem("akz-author", author); } catch (e2) {}
      const files = [...$("#uf-f").files], st = $("#uf-s"); if (!files.length) { st.textContent = "Wybierz co najmniej jedno zdjęcie."; return; }
      const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true; $("#uf-bar").hidden = false;
      const items = [];
      for (let i = 0; i < files.length; i++) { st.textContent = `Wysyłam ${i + 1} z ${files.length}…`; $("#uf-bar i").style.width = (100 * i / files.length) + "%";
        try { const r = await assets.upload(await shrink(files[i])); items.push({id: r.id, v: V.id, key, label, caption: $("#uf-c").value.trim(), author, ts: new Date().toISOString()}); }
        catch (err) { st.textContent = err.status === 507 ? "Na serwerze skończyło się miejsce — zdjęcie nie zostało zapisane. Daj znać administratorowi."
          : err.status === 415 ? "To nie jest zdjęcie JPG, PNG, WebP ani GIF: " + files[i].name : "Nie udało się wysłać: " + files[i].name; } }
      $("#uf-bar i").style.width = "100%";
      if (items.length) { try { const ref = db.doc("submissions/" + uid); const cur0 = await ref.get();
          const prevItems = cur0.exists ? (cur0.data().items || []) : [];
          await ref.set({items: [...prevItems, ...items].slice(-800)});
          st.textContent = `Dziękujemy! Wysłano ${items.length} ${plural(items.length, "zdjęcie", "zdjęcia", "zdjęć")} — czekają na wybór administratora.`;
        } catch (err) { st.textContent = "Zdjęcia wysłano, ale nie udało się ich zgłosić — spróbuj ponownie."; } }
      btn.disabled = false; $("#uf-f").value = "";
    });
  };

  // ---- persisting edits ----
  const persistVoyage = async (V, mutate) => {
    const doc = {title: V.title, sub: V.sub || "", series: V.series || null, ports: {...V.ports}, anchor: [...(V.anchor || [])],
      legs: V.legs.map(L => ({start: L.start || null, end: L.end || null, routes: L.routes.map(R => ({stops: [...R.stops], hops: R.hops.map(h => ({...h}))})), boats: L.boats.map(b => ({...b}))}))};
    await mutate(doc);
    const st = doc.legs.map(L => L.start).filter(Boolean).sort(), en = doc.legs.map(L => L.end).filter(Boolean).sort();
    const body = {...doc, start: st[0] || null, end: en[en.length - 1] || null, legs: packLegs(doc.legs)};
    if (JSON.stringify(body).length > 240000) throw new Error("za duże");
    const m = {...(META[V.id] || {})}; const hadCrew = !!m.crew; delete m.crew;
    if (V.seed) { m.override = {...body, rev: V.rev || null}; await db.doc("meta/" + V.id).set(m); }
    else { await db.doc("voyages/" + V.id).set({...body, created: V.created || new Date().toISOString()}); if (hadCrew) await db.doc("meta/" + V.id).set(m); }
    META[V.id] = m; if (!V.seed) { const i = DBV.findIndex(x => x.id === V.id); if (i >= 0) DBV[i] = {id: V.id, ...body}; }
    rebuild();
  };
  const saveSlide = async (V, key, cfg, credits) => { const patch = {slides: {...(META[V.id]?.slides || {}), [key]: cfg}};
    if (credits) { const c = {...(META[V.id]?.credits || {})}; for (const [id, a] of Object.entries(credits)) { if (a) c[id] = a; else delete c[id]; } patch.credits = c; }
    await metaSet(V.id, patch); };

  // ---- per-slide editor ----
  const LAYOUTS = [["auto", "Automatycznie"], ["one", "Jedno duże"], ["big2", "Duże + dwa małe"], ["two", "Dwa obok siebie"], ["grid", "Siatka"], ["none", "Bez zdjęć"]];
  const photoManager = (V, key) => {
    const cfg = (V.slides || {})[key] || {layout: "auto", photos: []};
    const sel = [...(cfg.photos || [])];
    const pend = pendingFor(V, key), others = SUBS.filter(s => s.v === V.id && s.key !== key && !REJECTED.includes(s.id) && !sel.includes(s.id));
    const usedElsewhere = [...usedPhotos(V)].filter(id => !sel.includes(id) && !others.some(o => o.id === id));
    const th = (id, btns, cap) => `<figure class="pm-t"><img src="${urlOf(id)}" alt="">${cap ? `<figcaption>${esc(cap)}</figcaption>` : ""}<div class="pm-b">${btns}</div></figure>`;
    const cred = {}; sel.forEach(id => { cred[id] = credit(V, id) || (SUBS.find(x => x.id === id) || {}).author || ""; });
    return {sel, cfg, cred, html: `<div class="pm">
      <label>Układ zdjęć<select id="pm-l">${LAYOUTS.map(([v, t]) => `<option value="${v}"${(cfg.layout || "auto") === v ? " selected" : ""}>${t}</option>`).join("")}</select></label>
      <h3>Na slajdzie <span class="hint2">(kolejność jak tu; pierwsze jest największe${key === "hero" || key.startsWith("leg:") ? " i jest tłem slajdu" : ""})</span></h3>
      <div class="pm-g" id="pm-sel"></div>
      <h3>Zgłoszone do tego slajdu (${pend.length})</h3>
      <div class="pm-g">${pend.map(s => th(s.id, `<button type="button" class="link" data-add="${esc(s.id)}">dodaj</button><button type="button" class="link" data-rej="${esc(s.id)}">odrzuć</button>`, [s.caption, s.author && "fot. " + s.author].filter(Boolean).join(" · "))).join("") || `<p class="hint2">Brak nowych zgłoszeń.</p>`}</div>
      ${others.length || usedElsewhere.length ? `<details><summary>Inne zdjęcia z tej wyprawy (${others.length + usedElsewhere.length})</summary><div class="pm-g">${others.map(s => th(s.id, `<button type="button" class="link" data-add="${esc(s.id)}">dodaj</button>`, s.label + (s.caption ? " · " + s.caption : ""))).join("")}${usedElsewhere.map(id => th(id, `<button type="button" class="link" data-add="${esc(id)}">dodaj</button>`, "użyte na innym slajdzie")).join("")}</div></details>` : ""}
      <label>Dodaj własne zdjęcia<input id="pm-up" type="file" accept="image/*" multiple${assets ? "" : " disabled"}></label></div>`};
  };
  const wirePM = (V, key, pm, root) => {
    const draw = () => { root.querySelector("#pm-sel").innerHTML = pm.sel.length ? pm.sel.map((id, i) => `<figure class="pm-t"><img src="${urlOf(id)}" alt=""><span class="pm-n">${i + 1}</span><div class="pm-b">
      <button type="button" class="link" data-mv="${i}:-1" aria-label="Przesuń wcześniej"${i ? "" : " disabled"}>←</button><button type="button" class="link" data-mv="${i}:1" aria-label="Przesuń dalej"${i < pm.sel.length - 1 ? "" : " disabled"}>→</button><button type="button" class="link" data-rm="${i}">usuń</button></div><input class="pm-a" data-au="${esc(id)}" value="${esc(pm.cred[id] || "")}" placeholder="autor zdjęcia" aria-label="Autor zdjęcia ${i + 1}" maxlength="80"></figure>`).join("")
      : `<p class="hint2">Brak — pokażą się ${key.startsWith("hop:") || key === "log" ? "zdjęcia dodane wcześniej do portu albo grafiki poglądowe" : "grafiki poglądowe"}.</p>`; };
    draw();
    root.addEventListener("click", async e => { const t = e.target;
      if (t.dataset.add) { const id = t.dataset.add; pm.sel.push(id); if (!(id in pm.cred)) pm.cred[id] = credit(V, id) || (SUBS.find(x => x.id === id) || {}).author || ""; t.closest("figure").remove(); draw(); }
      else if (t.dataset.mv) { const [i, d] = t.dataset.mv.split(":").map(Number); const x = pm.sel.splice(i, 1)[0]; pm.sel.splice(i + d, 0, x); draw(); }
      else if (t.dataset.rm) { pm.sel.splice(+t.dataset.rm, 1); draw(); }
      else if (t.dataset.rej) { const id = t.dataset.rej; REJECTED = [...REJECTED, id]; t.closest("figure").remove(); try { await db.doc("review/state").set({rejected: REJECTED}); } catch (err) {} }
    });
    root.addEventListener("input", e => { if (e.target.dataset.au) pm.cred[e.target.dataset.au] = e.target.value.trim(); });
    root.querySelector("#pm-up").addEventListener("change", async e => { for (const f of e.target.files) { try { const r = await assets.upload(await shrink(f)); pm.sel.push(r.id); draw(); } catch (err) {} } e.target.value = ""; });
  };
  const keyLabel = (V, key) => { const p = key.split(":");
    if (key === "hero") return "strona tytułowa"; if (key === "log") return "dziennik";
    if (p[0] === "leg") return `rejs ${+p[1] + 1}`; if (p[0] === "boats") return `rejs ${+p[1] + 1} · jachty`;
    if (p[0] === "hop") { const h = V.legs[+p[1]].routes[0].hops[+p[2]]; return `rejs ${+p[1] + 1} · ${h ? h.from + " → " + h.to : ""}`; } return key; };
  const openEditor = (V, key) => {
    const p = key.split(":"), li = +p[1], L = V.legs[li];
    let form = "";
    if (key === "hero") form = `<label>Nazwa wyprawy<input id="e-title" value="${esc(V.title)}"></label><label>Opis<input id="e-sub" value="${esc(V.sub || "")}"></label>
      <label>Edycja<select id="e-series">${seriesList().filter(g => g.key !== "inne").map(g => `<option value="${g.key}"${seriesOf(V) === g.key ? " selected" : ""}>${esc(g.name)}</option>`).join("")}</select></label>
      <p class="hint2">Rok w nazwie dopisuje się sam z dat rejsów.</p>`;
    else if (p[0] === "leg") form = `<div class="row2"><label>Początek<input id="e-s" type="date" value="${L.start || ""}"></label><label>Koniec<input id="e-e" type="date" value="${L.end || ""}"></label></div>`;
    else if (p[0] === "boats") form = `<div class="scroll"><table class="grid"><thead><tr><th>Jacht</th><th>Osoby</th><th>Godziny</th><th>Mile</th><th></th></tr></thead><tbody id="e-b">${L.boats.map((b, bi) => `<tr data-bi="${bi}"><td><input data-f="name" value="${esc(b.name)}" aria-label="Nazwa jachtu"></td><td><input data-f="crew" type="number" min="0" value="${b.crew ?? ""}" aria-label="Liczba osób"></td><td><input data-f="h" inputmode="decimal" value="${String(b.h).replace(".", ",")}" aria-label="Godziny"></td><td><input data-f="nm" inputmode="decimal" value="${String(b.nm).replace(".", ",")}" aria-label="Mile"></td><td><button type="button" class="link" data-delb="${bi}">usuń</button></td></tr>`).join("")}</tbody></table></div>
      <button type="button" class="btn ghost sm" id="e-addb">Dodaj jacht</button>`;
    else if (p[0] === "hop") { const h = L.routes[0].hops[+p[2]], name = h.to, c = V.ports[name];
      form = `<label>Nazwa miejsca<input id="e-pn" value="${esc(name)}"></label>
      <div class="row2"><label>Szer. (N)<input id="e-lat" inputmode="decimal" value="${String(c[1]).replace(".", ",")}"></label><label>Dł. (E)<input id="e-lon" inputmode="decimal" value="${String(c[0]).replace(".", ",")}"></label></div>
      <label class="radio"><input type="checkbox" id="e-anc"${(V.anchor || []).includes(name) ? " checked" : ""}> kotwicowisko</label>
      <p class="hint2">Zmiana nazwy obowiązuje w całej wyprawie. Po zmianie położenia odcinki do i z tego miejsca zostaną wyznaczone na nowo.</p>`; }
    const withPhotos = key !== "boats:" + li || false;
    const pm = p[0] === "boats" ? null : photoManager(V, key);
    const done = () => { closeModal(); location.hash = ""; };
    const dActs = key === "hero" ? voyageActs(V, done) : p[0] === "leg" && V.legs.length > 1 ? [{id: "dell", label: "Usuń ten rejs", confirm: "Usuń rejs na zawsze",
      desc: `Usuwa rejs ${li + 1} (${esc(route(L.stops))}) z tej wyprawy. Tego nie da się cofnąć.`, warn: `Rejs ${li + 1} zostanie usunięty na zawsze.`,
      run: async () => { await persistVoyage(V, d => { d.legs.splice(li, 1); }); done(); }}] : [];
    openModal(`<h2>Edycja · ${esc(keyLabel(V, key))}</h2><p class="hint2">${esc(vt(V))}</p>
      <div class="form one">${form}</div>${pm ? pm.html : ""}
      <div class="row sticky-b"><button type="button" class="btn" id="e-save">Zapisz</button><button type="button" class="btn ghost" data-mclose>Anuluj</button>
      <span class="hint2" id="e-st" role="status"></span></div>${dangerZone(dActs)}`);
    wireDanger(mBody, V, dActs);
    if (pm) wirePM(V, key, pm, mBody);
    const st = $("#e-st");
    if (p[0] === "boats") {
      mBody.addEventListener("click", e => { if (e.target.dataset.delb != null) e.target.closest("tr").remove(); });
      $("#e-addb").addEventListener("click", () => { const tr = document.createElement("tr"); tr.dataset.bi = "new";
        tr.innerHTML = `<td><input data-f="name" aria-label="Nazwa jachtu"></td><td><input data-f="crew" type="number" min="0" aria-label="Liczba osób"></td><td><input data-f="h" inputmode="decimal" aria-label="Godziny"></td><td><input data-f="nm" inputmode="decimal" aria-label="Mile"></td><td><button type="button" class="link" data-delb="x">usuń</button></td>`;
        $("#e-b").append(tr); tr.querySelector("input").focus(); });
    }
    $("#e-save").addEventListener("click", async () => {
      if (!db) { st.textContent = "Brak dostępu do bazy."; return; }
      const btn = $("#e-save"); btn.disabled = true; st.textContent = "Zapisuję…";
      try {
        if (key === "hero") { const t = $("#e-title").value.trim(); if (!t) throw new Error("Nazwa nie może być pusta.");
          await persistVoyage(V, d => { d.title = t; d.sub = $("#e-sub").value.trim(); d.series = $("#e-series").value; }); }
        else if (p[0] === "leg") { const s1 = $("#e-s").value || null, e1 = $("#e-e").value || null; if (s1 && e1 && e1 < s1) throw new Error("Koniec przed początkiem.");
          await persistVoyage(V, d => { d.legs[li].start = s1; d.legs[li].end = e1; }); }
        else if (p[0] === "boats") { const rows = [...$("#e-b").querySelectorAll("tr")].map(tr => { const g = f => tr.querySelector(`[data-f=${f}]`).value.trim();
            return {bi: tr.dataset.bi, name: g("name"), crew: g("crew") === "" ? null : Math.round(+g("crew")), h: num(g("h")), nm: num(g("nm"))}; });
          if (rows.some(r => !r.name || r.h == null || r.nm == null)) throw new Error("Każdy jacht musi mieć nazwę, godziny i mile.");
          if (!rows.length) throw new Error("Rejs musi mieć co najmniej jeden jacht.");
          await persistVoyage(V, d => { const old = d.legs[li].boats; d.legs[li].boats = rows.map(r => ({...(r.bi === "new" ? {route: 0} : old[+r.bi]), name: r.name, crew: r.crew, h: r.h, nm: r.nm})); }); }
        else if (p[0] === "hop") { const h = L.routes[0].hops[+p[2]], old = h.to, nn = $("#e-pn").value.trim(), lat = num($("#e-lat").value), lon = num($("#e-lon").value);
          if (!nn || lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error("Podaj nazwę i poprawne współrzędne.");
          const moved = Math.abs(lat - V.ports[old][1]) > 1e-5 || Math.abs(lon - V.ports[old][0]) > 1e-5;
          if (nn !== old && V.ports[nn]) throw new Error("Miejsce o tej nazwie już jest w wyprawie.");
          let rerouted = null;
          if (moved) { const pairs = []; const ref = [];
            V.legs.forEach((L2, a) => L2.routes.forEach((R, b) => R.hops.forEach((x, c) => { if (x.from === old || x.to === old) { ref.push([a, b, c]);
              const A = x.from === old ? [lon, lat] : V.ports[x.from], B = x.to === old ? [lon, lat] : V.ports[x.to]; pairs.push([A, B]); } })));
            st.textContent = "Wyznaczam odcinki na nowo…"; const rs = await routeHops(pairs, [], () => {}); rerouted = ref.map((r, i) => [r, rs[i]]); }
          await persistVoyage(V, d => {
            if (rerouted) for (const [[a, b, c], cs] of rerouted) { const x = d.legs[a].routes[b].hops[c]; delete x.coords; x.enc = enc(cs); }
            d.ports[nn] = [lon, lat]; if (nn !== old) delete d.ports[old];
            d.anchor = d.anchor.filter(x => x !== old && x !== nn); if ($("#e-anc").checked) d.anchor.push(nn);
            if (nn !== old) d.legs.forEach(L2 => L2.routes.forEach(R => { R.stops = R.stops.map(x => x === old ? nn : x); R.hops.forEach(x => { if (x.from === old) x.from = nn; if (x.to === old) x.to = nn; }); }));
          }); }
        if (pm) { const V2 = VOY.find(x => x.id === V.id) || V, old = (V2.slides || {})[key] || {}, pos = {...(old.pos || {})};
          const cr = {}; for (const id of pm.sel) cr[id] = pm.cred[id] || "";
          await saveSlide(V2, key, {...old, layout: mBody.querySelector("#pm-l").value, photos: pm.sel, pos}, cr); }
        closeModal(); rerender(true);
      } catch (e) { st.textContent = e && e.message && !/^\w+$/.test(e.code || "") ? e.message : "Nie udało się zapisać."; btn.disabled = false; }
    });
  };
  // home and edition texts
  const openTextEditor = gkey => {
    const g = gkey ? seriesList().find(x => x.key === gkey) : null, T = TEXTS || {}, ser = (T.series || {})[gkey] || {};
    openModal(`<h2>Edycja · ${g ? esc(g.name) : "strona główna"}</h2><div class="form one">
      ${g ? `<label>Pełna nazwa<input id="t-full" value="${esc(ser.full ?? g.full ?? "")}"></label><label>Opis edycji<textarea id="t-desc" rows="4">${esc(ser.desc || "")}</textarea></label>`
          : `<label>Nadtytuł<input id="t-kick" value="${esc(T.kick || "Dziennik klubowy")}"></label><label>Tytuł<input id="t-title" value="${esc(T.title || "AKŻ AGH")}"></label><label>Wstęp<textarea id="t-intro" rows="4">${esc(T.intro || "")}</textarea></label>`}
      <div class="row"><button type="button" class="btn" id="t-save">Zapisz</button><button type="button" class="btn ghost" data-mclose>Anuluj</button><span class="hint2" id="t-st" role="status"></span></div></div>`);
    $("#t-save").addEventListener("click", async () => { const n = JSON.parse(JSON.stringify(TEXTS || {}));
      if (g) { n.series = n.series || {}; n.series[gkey] = {full: $("#t-full").value.trim(), desc: $("#t-desc").value.trim()}; }
      else { n.kick = $("#t-kick").value.trim(); n.title = $("#t-title").value.trim(); n.intro = $("#t-intro").value.trim(); }
      try { await db.doc("site/texts").set(n); TEXTS = n; closeModal(); rerender(); } catch (e) { $("#t-st").textContent = "Nie udało się zapisać."; } });
  };
  stepsEl.addEventListener("click", e => {
    const up = e.target.closest("[data-up]"), ed = e.target.closest("[data-ed]"), te = e.target.closest("[data-te]");
    if (up) { const [vid, key] = up.dataset.up.split("|"); const V = VOY.find(v => v.id === vid); if (V) openUpload(V, key, keyLabel(V, key)); }
    if (ed) { const [vid, key] = ed.dataset.ed.split("|"); const V = VOY.find(v => v.id === vid); if (V) openEditor(V, key); }
    if (te) openTextEditor(te.dataset.te);
    const cr = e.target.closest("[data-crop]");
    if (cr) { const [vid, key] = cr.dataset.crop.split("|"); const V = VOY.find(v => v.id === vid); if (V) startCrop(V, key, cr.closest("section")); }
    const bo = e.target.closest("[data-board]");
    if (bo) { const [vid, key] = bo.dataset.board.split("|"); const V = VOY.find(v => v.id === vid); if (V) openBoard(V, key); }
  });

  // ---- board editor: a full-screen sheet, the same board scaled up; changes save themselves ----
  const openBoard = (V, key) => {
    if (boardEditing || !db) return;
    const id = boardId(V, key), cur = boardOf(V, key);
    const B = {h: cur ? cur.h : 0.75, items: cur ? JSON.parse(JSON.stringify(cur.items || [])) : []};
    boardEditing = id;
    const el = document.createElement("div"); el.className = "bed"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Układanie zdjęć");
    el.innerHTML = `<div class="bed-bar">
        <div class="bed-t"><b>Układanie zdjęć</b><span>${esc(vt(V))} · ${esc(keyLabel(V, key))}</span></div>
        <label class="btn sm filebtn">Dodaj zdjęcia<input type="file" accept="image/*" multiple hidden id="bed-f"></label>
        <input id="bed-a" placeholder="Autor zdjęć (opcjonalnie)" maxlength="80" aria-label="Autor dodawanych zdjęć">
        <span class="bed-sel" hidden><button type="button" data-a="front">Na wierzch</button><button type="button" data-a="back">Na spód</button>
          <button type="button" data-a="l" aria-label="Obróć w lewo">↺</button><button type="button" data-a="r" aria-label="Obróć w prawo">↻</button>
          <button type="button" data-a="del" class="del">Usuń</button></span>
        <span id="bed-s" class="hint2" role="status"></span>
        <button type="button" class="btn sm" id="bed-x">Gotowe</button></div>
      <div class="bed-scroll"><div class="bed-board" id="bed-b"></div>
        <div class="bed-grow" role="slider" tabindex="0" aria-label="Wysokość tablicy">⇕ przeciągnij, aby wydłużyć lub skrócić tablicę</div>
        <p class="bed-help">Przeciągnij zdjęcie, aby je przesunąć; uchwyt w prawym dolnym rogu zmienia rozmiar. Strzałki przesuwają, Delete usuwa.
        ${editOn() ? "Zmiany zapisują się same." : "Zmiany zapisują się same i od razu widzą je wszyscy."}</p></div>`;
    document.body.appendChild(el); document.body.classList.add("bed-open");
    const board = el.querySelector("#bed-b"), st = el.querySelector("#bed-s"), selBar = el.querySelector(".bed-sel");
    try { el.querySelector("#bed-a").value = localStorage.getItem("akz-author") || ""; } catch (e) {}
    let sel = null, drag = null, saveT = null, saving = Promise.resolve();
    const W = () => board.clientWidth;
    const minH = () => Math.max(0.3, ...B.items.map(it => it.y + it.w * it.ar));
    const draw = () => {
      board.style.height = W() * B.h + "px";
      board.innerHTML = B.items.length ? [...B.items].sort((a, c) => (a.z || 0) - (c.z || 0)).map(it =>
        `<div class="bit${it.id === sel ? " sel" : ""}" data-id="${esc(it.id)}" style="${itemCss(it, B.h)}" tabindex="0" aria-label="Zdjęcie${it.author ? ", autor " + esc(it.author) : ""}">
          <img src="/_blob/${esc(it.id)}" alt="" draggable="false">${it.author ? `<span class="bcr">fot. ${esc(it.author)}</span>` : ""}<span class="rz" aria-hidden="true"></span></div>`).join("")
        : `<p class="bed-empty">Tablica jest pusta. Dodaj zdjęcia przyciskiem u góry — potem przeciągnij je, gdzie chcesz.</p>`;
      selBar.hidden = !sel;
    };
    // changes are written 0.7 s after the last edit; closing writes a pending change immediately
    const flush = () => { clearTimeout(saveT); saveT = null; saving = saving.then(async () => {
        try { await db.doc("canvas/" + id).set({h: Math.round(B.h * 1000) / 1000, items: B.items.map(it => ({...it, x: +it.x.toFixed(4), y: +it.y.toFixed(4), w: +it.w.toFixed(4)})), updated: new Date().toISOString(), by: uid || null});
          CANVAS[id] = {h: B.h, items: JSON.parse(JSON.stringify(B.items))}; st.textContent = "Zapisano"; }
        catch (e) { st.textContent = e.status === 403 ? "Tryb otwarty się skończył — zmiany nie zostały zapisane." : e.status === 507 ? "Na serwerze skończyło się miejsce — nie zapisano." : "Nie udało się zapisać — spróbuj jeszcze raz."; }
      }); return saving; };
    const save = () => { clearTimeout(saveT); st.textContent = "Zapisuję…"; saveT = setTimeout(flush, 700); };
    const item = idv => B.items.find(it => it.id === idv);
    const select = idv => { sel = idv; board.querySelectorAll(".bit").forEach(n => n.classList.toggle("sel", n.dataset.id === idv)); selBar.hidden = !sel; };
    board.addEventListener("pointerdown", e => {
      const n = e.target.closest(".bit"); if (!n) { select(null); return; }
      e.preventDefault(); select(n.dataset.id); n.focus({preventScroll: true});
      const it = item(n.dataset.id); n.setPointerCapture(e.pointerId);
      drag = {n, it, mode: e.target.classList.contains("rz") ? "size" : "move", x: e.clientX, y: e.clientY, o: {...it}};
    });
    board.addEventListener("pointermove", e => { if (!drag) return; const {n, it, o} = drag, dx = (e.clientX - drag.x) / W(), dy = (e.clientY - drag.y) / W();
      if (drag.mode === "move") { it.x = Math.min(1 - it.w * 0.25, Math.max(-it.w * 0.75, o.x + dx)); it.y = Math.max(0, o.y + dy); }
      else it.w = Math.min(1.2, Math.max(0.06, o.w + dx));
      if (it.y + it.w * it.ar > B.h) { B.h = it.y + it.w * it.ar + 0.02; board.style.height = W() * B.h + "px"; board.querySelectorAll(".bit").forEach(m => { m.style.cssText = itemCss(item(m.dataset.id), B.h); }); }
      else n.style.cssText = itemCss(it, B.h); });
    const end = () => { if (drag) { drag = null; save(); } };
    board.addEventListener("pointerup", end); board.addEventListener("pointercancel", end);
    // stretch the board
    const grow = el.querySelector(".bed-grow"); let gd = null;
    grow.addEventListener("pointerdown", e => { e.preventDefault(); grow.setPointerCapture(e.pointerId); gd = {y: e.clientY, h: B.h}; });
    grow.addEventListener("pointermove", e => { if (!gd) return; B.h = Math.min(6, Math.max(minH(), gd.h + (e.clientY - gd.y) / W())); board.style.height = W() * B.h + "px";
      board.querySelectorAll(".bit").forEach(m => { m.style.cssText = itemCss(item(m.dataset.id), B.h); }); });
    grow.addEventListener("pointerup", () => { if (gd) { gd = null; save(); } });
    grow.addEventListener("keydown", e => { if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return; e.preventDefault(); B.h = Math.min(6, Math.max(minH(), B.h + (e.key === "ArrowDown" ? 0.1 : -0.1))); draw(); save(); });
    // selected photo: order, rotation, removal
    selBar.addEventListener("click", e => { const a = e.target.dataset.a, it = item(sel); if (!a || !it) return;
      const zs = B.items.map(x => x.z || 0);
      if (a === "front") it.z = Math.max(...zs) + 1; if (a === "back") it.z = Math.min(...zs) - 1;
      if (a === "l" || a === "r") it.rot = ((it.rot || 0) + (a === "l" ? -5 : 5)) % 360;
      if (a === "del") { B.items = B.items.filter(x => x !== it); sel = null; }
      draw(); save(); });
    const keys = e => { if (e.key === "Escape") { close(); return; }
      const it = item(sel); if (!it || e.target.tagName === "INPUT") return;
      const d = e.shiftKey ? 0.05 : 0.01, mv = {ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d]}[e.key];
      if (mv) { e.preventDefault(); it.x = Math.min(1 - it.w * 0.25, Math.max(-it.w * 0.75, it.x + mv[0])); it.y = Math.max(0, it.y + mv[1]); B.h = Math.max(B.h, it.y + it.w * it.ar); draw(); save(); }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); B.items = B.items.filter(x => x !== it); sel = null; draw(); save(); } };
    document.addEventListener("keydown", keys);
    // add photos: they land in a cascade where the board is currently scrolled to
    el.querySelector("#bed-f").addEventListener("change", async e => {
      const files = [...e.target.files], author = el.querySelector("#bed-a").value.trim(); e.target.value = "";
      try { localStorage.setItem("akz-author", author); } catch (x) {}
      const top = Math.max(0, (el.querySelector(".bed-scroll").scrollTop - board.offsetTop) / W());
      let k = 0;
      for (const f of files) {
        st.textContent = `Wysyłam ${k + 1} z ${files.length}…`;
        try {
          const blob = await shrink(f); const bmp = await createImageBitmap(blob).catch(() => null);
          const ar = bmp ? bmp.height / bmp.width : 0.75; const r = await assets.upload(blob);
          const w = ar > 1.2 ? 0.28 : 0.4, it = {id: r.id, x: Math.min(1 - w, 0.04 + (k % 5) * 0.06), y: top + 0.04 + (k % 5) * 0.05, w, ar: +ar.toFixed(4),
            z: Math.max(0, ...B.items.map(x => x.z || 0)) + 1, author: author || undefined, by: uid || undefined};
          B.items.push(it); B.h = Math.max(B.h, it.y + w * ar + 0.03); sel = it.id; k++; draw();
        } catch (err) { st.textContent = err.status === 507 ? "Na serwerze skończyło się miejsce — zdjęcie nie zostało zapisane." : err.status === 415 ? "To nie jest zdjęcie JPG, PNG, WebP ani GIF: " + f.name : "Nie udało się wysłać: " + f.name; }
      }
      if (k) save();
    });
    let closing = false;
    const close = async () => { if (closing) return; closing = true;
      document.removeEventListener("keydown", keys); removeEventListener("resize", draw);
      await (saveT ? flush() : saving); el.remove(); document.body.classList.remove("bed-open"); boardEditing = null; rerender(true); };
    el.querySelector("#bed-x").addEventListener("click", close);
    addEventListener("resize", draw); draw();
  };

  // ---- framing photos directly on the slide (admin): drag = move, wheel/slider = zoom ----
  let crop = null;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const startCrop = (V, key, sec) => {
    if (crop) crop.end(true);
    const imgs = () => [...sec.querySelectorAll("img[data-pid]")];
    const inPh = imgs().filter(im => im.closest(".ph")), canOrder = inPh.length > 1;
    const pos = JSON.parse(JSON.stringify(((V.slides || {})[key] || {}).pos || {}));
    const P = id => pos[id] || (pos[id] = {x: 50, y: 50, z: 1});
    sec.classList.add("cropping");
    const bar = document.createElement("div"); bar.className = "cropbar";
    bar.innerHTML = imgs().length ? `<b>Kadrowanie</b><span>Przeciągnij zdjęcie, aby przesunąć kadr. Kółko myszy lub suwak powiększa.${canOrder ? " Strzałki zmieniają kolejność — pierwsze jest największe." : ""}</span>
      <div class="cb-row"><label class="cb-z">Powiększenie<input type="range" id="cb-z" min="1" max="4" step="0.01" value="1"></label>
      <button type="button" class="tbtn" id="cb-fit">Pokaż całe zdjęcie</button><button type="button" class="tbtn" id="cb-reset">Wyśrodkuj</button>
      ${canOrder ? `<button type="button" class="tbtn" id="cb-l" aria-label="Przesuń zdjęcie wcześniej">←</button><button type="button" class="tbtn" id="cb-r" aria-label="Przesuń zdjęcie dalej">→</button>` : ""}</div>
      <div class="cb-row"><button type="button" class="tbtn ed" id="cb-save">Zapisz kadry</button><button type="button" class="tbtn" id="cb-x">Anuluj</button><span id="cb-st" role="status"></span></div>`
      : `<b>Kadrowanie</b><span>Na tym slajdzie są tylko grafiki poglądowe — najpierw dodaj zdjęcia przyciskiem „Edytuj”.</span><div class="cb-row"><button type="button" class="tbtn" id="cb-x">Zamknij</button></div>`;
    sec.prepend(bar);
    const q = id => bar.querySelector(id), zr = q("#cb-z"), fitb = q("#cb-fit");
    let act = null, drag = null;
    const apply = im => { im.style.cssText = frameCss(pos[im.dataset.pid]); };
    const select = im => { act = im; imgs().forEach(x => (x.closest(".ph button") || x).classList.toggle("sel", x === im));
      const p = P(im.dataset.pid); zr.value = p.z || 1; zr.disabled = !!p.fit; fitb.textContent = p.fit ? "Wypełnij kadr" : "Pokaż całe zdjęcie"; };
    const down = e => { const im = e.target.closest("img[data-pid]"); if (!im || !sec.contains(im) || e.button > 0) return;
      e.preventDefault(); select(im); const p = P(im.dataset.pid); if (p.fit) return;
      im.setPointerCapture(e.pointerId); drag = {im, x: e.clientX, y: e.clientY, p0: {...p}}; };
    const move = e => { if (!drag) return; const {im, p0} = drag, p = P(im.dataset.pid), z = p.z || 1;
      const W = im.clientWidth, H = im.clientHeight, nw = im.naturalWidth || W, nh = im.naturalHeight || H, sc = Math.max(W / nw, H / nh);
      // how far the visible centre moves per 1 (100%) of focal point, so the photo follows the cursor exactly
      const dX = nw * sc - W + W - W / z, dY = nh * sc - H + H - H / z;
      if (dX > .5) p.x = clamp(p0.x - (e.clientX - drag.x) / z / dX * 100, 0, 100);
      if (dY > .5) p.y = clamp(p0.y - (e.clientY - drag.y) / z / dY * 100, 0, 100);
      apply(im); };
    const up = () => { drag = null; };
    const wheel = e => { const im = e.target.closest("img[data-pid]"); if (!im || !sec.contains(im)) return; e.preventDefault();
      if (act !== im) select(im); const p = P(im.dataset.pid); if (p.fit) return;
      p.z = clamp((p.z || 1) * Math.exp(-e.deltaY * .0015), 1, 4); zr.value = p.z; apply(im); };
    const nodrag = e => { if (e.target.closest("img[data-pid]")) e.preventDefault(); };
    const key2 = e => { if (e.key === "Escape" && modal.hidden) end(true); };
    const end = cancel => { sec.removeEventListener("pointerdown", down); sec.removeEventListener("pointermove", move); sec.removeEventListener("pointerup", up);
      sec.removeEventListener("pointercancel", up); sec.removeEventListener("wheel", wheel); sec.removeEventListener("dragstart", nodrag); removeEventListener("keydown", key2);
      crop = null; if (cancel) rerender(true); };
    crop = {end};
    sec.addEventListener("pointerdown", down); sec.addEventListener("pointermove", move); sec.addEventListener("pointerup", up); sec.addEventListener("pointercancel", up);
    sec.addEventListener("wheel", wheel, {passive: false}); sec.addEventListener("dragstart", nodrag); addEventListener("keydown", key2);
    q("#cb-x").addEventListener("click", () => end(true));
    if (!imgs().length) return;
    select(imgs()[0]);
    zr.addEventListener("input", () => { if (!act) return; P(act.dataset.pid).z = +zr.value; apply(act); });
    fitb.addEventListener("click", () => { if (!act) return; const p = P(act.dataset.pid); p.fit = !p.fit; if (!p.fit) delete p.fit; apply(act); select(act); });
    q("#cb-reset").addEventListener("click", () => { if (!act) return; pos[act.dataset.pid] = {x: 50, y: 50, z: 1}; apply(act); select(act); });
    const shift = d => { if (!act) return; const f = act.closest(".pf"); if (!f) return;
      if (d < 0 && f.previousElementSibling) f.parentNode.insertBefore(f, f.previousElementSibling);
      if (d > 0 && f.nextElementSibling) f.parentNode.insertBefore(f.nextElementSibling, f); };
    if (canOrder) { q("#cb-l").addEventListener("click", () => shift(-1)); q("#cb-r").addEventListener("click", () => shift(1)); }
    q("#cb-save").addEventListener("click", async () => { const st = q("#cb-st"), btn = q("#cb-save");
      if (!db) { st.textContent = "Brak dostępu do bazy."; return; }
      btn.disabled = true; st.textContent = "Zapisuję…";
      const V2 = VOY.find(x => x.id === V.id) || V, old = (V2.slides || {})[key] || {layout: "auto", photos: []}, out = {...(old.pos || {})};
      for (const [id, p] of Object.entries(pos)) { const r = {x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, z: Math.round((p.z || 1) * 100) / 100};
        if (p.fit) r.fit = 1; if (r.x === 50 && r.y === 50 && r.z === 1 && !r.fit) delete out[id]; else out[id] = r; }
      const cfg = {...old, pos: out}, order = [...sec.querySelectorAll(".ph img[data-pid]")].map(im => im.dataset.pid);
      if (order.length) cfg.photos = order;
      try { await saveSlide(V2, key, cfg); end(false); rerender(true); }
      catch (e) { st.textContent = "Nie udało się zapisać."; btn.disabled = false; }
    });
  };
  // re-render the current view, keeping the current slide
  const rerender = (keep = true) => {
    if (mode === "archive" || mode === "present") { const ids = S ? S.Vs.map(v => v.id) : [], at = cur;
      const Vs = ids.map(id => VOY.find(v => v.id === id)).filter(Boolean); if (!Vs.length) return routeTo();
      showStory(Vs, mode === "present"); if (keep && at > 0 && secs[at]) { secs[at].scrollIntoView({block: "start"}); cur = -1; go(Math.min(at, steps.length - 1)); } }
    else routeTo();
  };

  // ---- presentation: fullscreen and clean screen ----
  const fsbtn = $("#fsbtn"), cleanbtn = $("#cleanbtn");
  fsbtn.addEventListener("click", async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch (e) { fsbtn.textContent = "Pełny ekran niedostępny"; setTimeout(() => { fsbtn.textContent = "⛶ Pełny ekran"; }, 2500); } });
  document.addEventListener("fullscreenchange", () => { fsbtn.textContent = document.fullscreenElement ? "Zamknij pełny ekran" : "⛶ Pełny ekran"; });
  let peekT = 0;
  const setClean = on => { document.body.classList.toggle("clean", on); cleanbtn.textContent = on ? "Pokaż przyciski" : "Ukryj przyciski"; };
  cleanbtn.addEventListener("click", () => setClean(!document.body.classList.contains("clean")));
  addEventListener("mousemove", e => { if (!document.body.classList.contains("clean")) return; if (innerHeight - e.clientY < 120 || e.clientX < 80 && e.clientY < 80) {
    document.body.classList.add("peek"); clearTimeout(peekT); peekT = setTimeout(() => document.body.classList.remove("peek"), 2500); } });
  addEventListener("keydown", e => { if (mode !== "present" || e.target.closest("input,textarea,select")) return;
    if (e.key === "h" || e.key === "H") setClean(!document.body.classList.contains("clean"));
    if (e.key === "f" || e.key === "F") fsbtn.click(); });

  // ---- connect platform capabilities (absent outside Claude: the page still shows the built-in voyages) ----
  // everything stored on claude.ai, as one JSON for the self-hosted server (admin accounts stay out)
  const readCol = col => new Promise(ok => { let done = false, un = null;
    un = db.collection(col).onSnapshot(sn => { if (done) return; done = true; ok(sn.docs.map(d => [col + "/" + d.id, d.data()])); try { un && un(); } catch (e) {} }, () => { if (!done) { done = true; ok([]); } }); });
  const buildBackup = async progress => {
    const docs = Object.fromEntries((await Promise.all(["voyages", "meta", "site", "review", "submissions", "canvas"].map(readCol))).flat());
    const ids = new Set();
    for (const [k, d] of Object.entries(docs)) { if (k.startsWith("meta/")) { Object.values(d.slides || {}).forEach(c => (c.photos || []).forEach(i => ids.add(i)));
        Object.values(d.photos || {}).flat().forEach(i => ids.add(i)); if (d.cover) ids.add(d.cover); }
      if (k.startsWith("submissions/")) (d.items || []).forEach(it => ids.add(it.id)); }
    const blobs = {}; let n = 0;
    for (const id of ids) { try { const r = await fetch(urlOf(id)); if (!r.ok) continue; const u = new Uint8Array(await r.arrayBuffer()); let bin = "";
        for (let i = 0; i < u.length; i += 32768) bin += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); blobs[id] = btoa(bin); progress(++n + " / " + ids.size); } catch (e) {} }
    return JSON.stringify({format: "akz-backup", from: "claude.ai", at: new Date().toISOString(), docs, blobs}); };
  const renderOpen = () => { const el = $("#op-s"); if (!el) return;
    el.innerHTML = openNow() ? `<b class="ok">Włączony do ${new Date(OPEN_UNTIL).toLocaleString("pl", {dateStyle: "long", timeStyle: "short"})}.</b> Każdy odwiedzający może dodawać zdjęcia i od razu układać je na slajdach, bez akceptacji. Wyłączy się sam.`
      : "Wyłączony. Zdjęcia od odwiedzających trafiają do kolejki i czekają na wybór administratora. Włącz na czas wydarzenia, np. prezentacji, żeby wszyscy mogli od razu dodawać i układać zdjęcia."; };
  let subsOn = false;
  const startSubs = () => { if (subsOn || !db) return; subsOn = true;
    db.collection("submissions").onSnapshot(sn => { SUBS = sn.docs.flatMap(x => (x.data().items || []).map(it => ({...it, by: x.id}))); if (mode === "admin") renderQueue(); }, () => {}); };
  // saved data arrived or changed: redraw what is on screen (an open voyage keeps its slide; a running presentation only on first load)
  let seenData = 0;
  const refresh = () => { rebuild(); seenData++;
    if (mode === "home" || mode === "series") routeTo(); else if (mode === "admin") { renderList(); renderQueue(); }
    else if (mode === "archive" && !crop && modal.hidden) rerender(true);
    else if (mode === "present" && seenData <= 2) rerender(true); };
  map.on("load", async () => {
    routeTo();
    const C = window.claude; if (!C || !C.use) return;
    const [d, u, a] = await Promise.all(["db", "user", "assets"].map(n => C.use(n).catch(() => null)));
    db = d; assets = a; userCap = u;
    try { canEditor = !!(u && await u.canEdit()); isOwnerU = !!(u && await u.isOwner()); uid = u ? await u.id() : null; } catch (e) { canEditor = false; }
    if (!canEditor && adminLogin) setSession(null);
    if (SELF && canEditor && !adminLogin) try { setSession((await u.me()).login); } catch (e) {}
    syncMenu();
    if (mode === "home") showHome(); else navMode(mode === "admin" ? "admin" : mode === "series" ? "series" : "story");
    if (location.hash === "#admin" && mode !== "admin") { if (adminOn()) showAdmin(); }
    else if (adminOn() && (mode === "archive" || mode === "home" || mode === "series")) rerender();
    if (!db) return;
    db.doc("site/texts").onSnapshot(sn => { TEXTS = sn.exists ? sn.data() : {}; if (mode === "home" || mode === "series") routeTo(); }, () => {});
    db.collection("canvas").onSnapshot(sn => { CANVAS = {}; sn.docs.forEach(x => { CANVAS[x.id] = x.data(); });
      if (mode === "archive" && !boardEditing && !crop && modal.hidden) rerender(true); }, () => {});
    db.doc("site/open").onSnapshot(sn => { OPEN_UNTIL = sn.exists ? sn.data().until || null : null;
      if (mode === "archive" && !boardEditing && !crop && modal.hidden) rerender(true); if (mode === "admin") renderOpen(); }, () => {});
    db.doc("review/state").onSnapshot(sn => { REJECTED = sn.exists ? sn.data().rejected || [] : []; if (mode === "admin") renderQueue(); }, () => {});
    if (canEditor) startSubs();
    let first = true;
    const timer = setTimeout(() => { const n = $("#dbnote"); if (n) n.textContent = "Nie udało się jeszcze wczytać wypraw dodanych przez administratorów."; }, 10000);
    db.collection("voyages").onSnapshot(snap => { clearTimeout(timer); DBV = snap.docs.map(x => ({id: x.id, ...x.data()})); refresh();
      if (first) { first = false; const h = decodeURIComponent(location.hash.slice(1)); if (h && mode === "home") routeTo(); } }, () => clearTimeout(timer));
    db.collection("meta").onSnapshot(snap => { META = {}; snap.docs.forEach(x => { META[x.id] = x.data(); }); refresh(); }, () => {});
  });
}).catch(err => { showErr(err.message); stepsEl.innerHTML = `<section class="step"><h2>Nie udało się wczytać mapy</h2><p>${esc(err.message)}</p></section>`; });
}
