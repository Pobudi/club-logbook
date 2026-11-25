"""Build voyages.js from the club sheet export.

    python3 tools/build_voyages.py            # tools/historia.csv -> voyages.js
    python3 tools/build_voyages.py --check    # parse, place and validate only, no routing

Inputs (all in tools/): historia.csv (sheet export with "Trasa z karty"), places.csv (coordinates and
spelling variants), data/*.geojson.gz (Natural Earth coastline). Ports already in voyages.js and the
gazetteer gaz.js are used for names not in places.csv. Sea routes are cached in route_cache.json, so a
rebuild only routes new hops. Tracks of the existing voyages (including the ones drawn from the plotter
GPX) are reused where their end points match.
"""
import collections, datetime as dt, gzip, hashlib, json, math, os, re, statistics, sys, time
sys.path.insert(0, os.path.dirname(__file__))
from routes import read_rows, fold
from geo import Geo, km

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T = lambda *p: os.path.join(ROOT, "tools", *p)
CHECK = "--check" in sys.argv

# ---------- encoded polylines (same format as app.js enc/dec, 1e5) ----------
def enc(pts):
    out, px, py = [], 0, 0
    for x, y in pts:
        X, Y = round(x * 1e5), round(y * 1e5)
        for v in (Y - py, X - px):
            v = ~(v << 1) if v < 0 else v << 1
            while v >= 0x20: out.append(chr((0x20 | (v & 0x1f)) + 63)); v >>= 5
            out.append(chr(v + 63))
        px, py = X, Y
    return "".join(out)
def dec(s):
    pts, i, x, y = [], 0, 0, 0
    while i < len(s):
        vals = []
        for _ in range(2):
            sh = r = 0
            while True:
                b = ord(s[i]) - 63; i += 1; r |= (b & 0x1f) << sh; sh += 5
                if b < 0x20: break
            vals.append(~(r >> 1) if r & 1 else r >> 1)
        y += vals[0]; x += vals[1]; pts.append([x / 1e5, y / 1e5])
    return pts

# ---------- rows -> voyages -> legs -> route variants ----------
rows = read_rows(T("historia.csv"))
geo = Geo(T("places.csv"), os.path.join(ROOT, "voyages.js"), os.path.join(ROOT, "gaz.js"))
s = open(os.path.join(ROOT, "voyages.js"), encoding="utf-8").read()
OLD = json.loads(s[s.index("["):s.rindex("]") + 1])

ok = lambda r: r["s"] and r["e"] and r["e"] >= r["s"] and (r["e"] - r["s"]).days <= 60
# season of rows with impossible dates: the neighbouring row of the same voyage type
for r in rows:
    r["season"] = r["s"].year if ok(r) else None
for r in rows:
    if r["season"] is None:
        nb = [x for x in rows if x["voy"] == r["voy"] and x["season"] and abs(x["i"] - r["i"]) <= 3]
        r["season"] = min(nb, key=lambda x: abs(x["i"] - r["i"]))["season"] if nb else 0

report = collections.defaultdict(list)
groups = collections.OrderedDict()
for r in rows: groups.setdefault((r["voy"], r["season"]), []).append(r)

# place every stop; namesakes are resolved towards the previous stop on the same route
PORTS, ANCH, SRC = {}, set(), collections.Counter()
for (voy, season), rs in groups.items():
    pts = [(c[1], c[2]) for r in rs for n, _ in r["stops"] for src, cs in [geo.candidates(n)] if src in ("places", "site") for c in cs[:1]]
    centre = (statistics.median(p[0] for p in pts), statistics.median(p[1] for p in pts)) if pts else None
    for r in rs:
        out = []
        for n, anch in r["stops"]:
            src, c = geo.pick(n, PORTS[out[-1]] if out else centre)
            SRC[src] += 1
            if src == "ignore": report["skipped (unknown place)"].append(f"line {r['line']}: {n}"); continue
            if c is None: report["NOT PLACED"].append(f"line {r['line']}: {n}"); continue
            name = c[0]
            PORTS[name] = [round(c[1], 4), round(c[2], 4)]
            if anch or c[3]: ANCH.add(name)
            if name in geo.approx: report["approximate positions"].append(name)
            if not out or out[-1] != name: out.append(name)
        r["route"] = out
        d = sum(km(PORTS[a], PORTS[b]) for a, b in zip(out, out[1:])) / 1.852
        if r["nm"] and d > 1.15 * r["nm"] + 15: report["route longer than logged miles"].append(f"line {r['line']} {voy} {r['boat']}: {d:.0f} > {r['nm']}")

def overlap(a, b):
    """same leg: the boats sailed (nearly) the same days — flotillas, also when they left from different marinas"""
    lo, hi = max(a[0], b[0]), min(a[1], b[1])
    return hi > lo and (hi - lo).days >= 0.8 * max((a[1] - a[0]).days, (b[1] - b[0]).days)

# existing voyages keep their ids (photos and slide settings on the site are stored under them)
KEEP = {("WSEx", 2026): ("wsex-2026", "Zatoka Sarońska i Argolidzka — flotylla dwunastu jachtów"),
        ("May I Sail - Bałtyk", 2026): ("may-i-sail-baltyk-2026", "Bornholm, Christiansø i południowa Szwecja"),
        ("NNE West", 2026): ("north-sea-baltic", "Od Łaby po Solent, przez Skagerrak, z powrotem do Szczecina"),
        ("NNE", 2026): ("norway-svalbard", "Ze Szczecina do granicy lodu na 80°34,7′N i z powrotem")}
slug = lambda t: re.sub(r"[^a-z0-9]+", "-", fold(t)).strip("-")

voyages = []
for (voy, season), rs in groups.items():
    legs = []
    for r in rs:
        if not ok(r): continue
        L = next((L for L in legs if overlap((L["s"], L["e"]), (r["s"], r["e"]))), None)
        if L: L["rows"].append(r); L["s"] = min(L["s"], r["s"]); L["e"] = max(L["e"], r["e"])
        else: legs.append({"s": r["s"], "e": r["e"], "rows": [r]})
    for r in rs:
        if ok(r): continue
        same = next((L for L in legs if any(x["route"] == r["route"] and x["route"] for x in L["rows"])), None)
        if same:
            same["rows"].append(r); report["impossible dates → joined the leg with the same route"].append(f"line {r['line']} {voy} {r['boat']}")
            continue
        # continuity: the same boat's leg ending where this one starts, and the one starting where it ends
        mine = sorted([L for L in legs for x in L["rows"] if x["boat"] == r["boat"] and x["route"]], key=lambda L: L["s"])
        before = [L for L in mine if r["route"] and any(x["boat"] == r["boat"] and x["route"][-1] == r["route"][0] for x in L["rows"])]
        after = [L for L in mine if r["route"] and any(x["boat"] == r["boat"] and x["route"][0] == r["route"][-1] for x in L["rows"])]
        s0 = before[0]["e"] if before else None
        e0 = min((L["s"] for L in after if not s0 or L["s"] > s0), default=None)
        if not s0 and r["s"] and r["s"].year == season: s0 = r["s"]
        legs.append({"s": s0, "e": e0, "rows": [r]})
        report["impossible dates → taken from the neighbouring legs"].append(f"line {r['line']} {voy} {r['boat']}: {r['s']}–{r['e']} → {s0}–{e0}")
    legs.sort(key=lambda L: (L["s"] or dt.date(season or 1900, 12, 31)))
    out_legs = []
    for L in legs:
        seqs = []
        for r in L["rows"]:
            if r["route"] and r["route"] not in seqs: seqs.append(r["route"])
        seqs.sort(key=lambda q: -sum(1 for r in L["rows"] if r["route"] == q))
        if not seqs: seqs = [[]]
        boats = []
        for r in L["rows"]:
            if not r["route"] and len(L["rows"]) > 1: report["no route given → shown with the flotilla's main route"].append(f"line {r['line']} {voy} {r['boat'] or '(no name)'}")
            if not r["boat"]: report["no boat name"].append(f"line {r['line']} {voy}")
            if r["h"] is None: report["no hours/miles"].append(f"line {r['line']} {voy} {r['boat'] or '(no name)'}")
            boats.append({"name": r["boat"] or "Jacht bez nazwy", "crew": r["crew"], "h": r["h"] or 0, "nm": r["nm"] or 0,
                          "route": seqs.index(r["route"]) if r["route"] in seqs else 0})
        out_legs.append({"start": L["s"].isoformat() if L["s"] else None, "end": L["e"].isoformat() if L["e"] else None,
                         "routes": [{"stops": q, "hops": []} for q in seqs], "boats": boats})
    vid, sub = KEEP.get((voy, season), (f"{slug(voy)}-{season}", ""))
    voyages.append({"id": vid, "title": voy, "sub": sub, "legs": out_legs, "season": season})

ids = collections.Counter(v["id"] for v in voyages)
assert all(n == 1 for n in ids.values()), [i for i, n in ids.items() if n > 1]
print(f"{len(rows)} rows → {len(voyages)} voyages, {sum(len(v['legs']) for v in voyages)} legs; places: {dict(SRC)}")
for k, v in report.items():
    u = list(dict.fromkeys(v))
    print(f"\n{k} ({len(u)}):"); [print("  ", x) for x in u[:60]]
if report.get("NOT PLACED"): sys.exit("\nsome stops could not be placed — add them to tools/places.csv")
if "--list" in sys.argv:
    for v in voyages: print(f"  {v['id']:<44}{len(v['legs']):>3} legs  boats/leg {[len(L['boats']) for L in v['legs']]}  variants {[len(L['routes']) for L in v['legs']]}")
if CHECK: sys.exit(0)

# ---------- sea routing ----------
import numpy as np
from PIL import Image, ImageDraw
from shapely.geometry import shape, box
from shapely.strtree import STRtree
from scipy import ndimage
from skimage.graph import route_through_array

def load(name):
    with gzip.open(T("data", name + ".geojson.gz"), "rt", encoding="utf-8") as f: return json.load(f)["features"]
land, lakes = [], []
for n in ["ne_10m_land", "ne_10m_minor_islands"]:
    for ft in load(n):
        g = shape(ft["geometry"]); land += [p for p in getattr(g, "geoms", [g]) if p.geom_type == "Polygon"]
for ft in load("ne_10m_lakes"):
    g = shape(ft["geometry"]); lakes += [p for p in getattr(g, "geoms", [g]) if p.geom_type == "Polygon"]
LT, KT = STRtree(land), STRtree(lakes)
# waterways the 10 m coastline closes (lon, lat)
CANALS = [
    [(14.66, 53.42), (14.64, 53.41), (14.60, 53.48), (14.60, 53.56), (14.55, 53.62), (14.40, 53.70), (14.27, 53.91)],  # Szczecin – Dąbie – Oder – Świna
    [(14.76, 54.03), (14.77, 53.97), (14.70, 53.90), (14.62, 53.84), (14.55, 53.80)],                              # Dziwna: Dziwnów – Kamień – Wolin – lagoon
    [(13.79, 54.16), (13.77, 54.05), (13.80, 53.93)],                                                              # Peenestrom, Wolgast
    [(9.14, 53.89), (9.67, 54.30), (10.15, 54.37)],                                                                # Kiel Canal
    [(8.70, 53.87), (9.14, 53.89), (9.42, 53.79), (9.70, 53.57), (9.97, 53.54)],                                   # Elbe to Hamburg
    [(4.58, 52.46), (4.75, 52.43), (4.90, 52.38)],                                                                 # North Sea Canal to Amsterdam
    [(5.10, 53.10), (5.33, 53.07), (5.40, 53.05)],                                                                 # Kornwerderzand
    [(-4.23, 57.48), (-4.31, 57.44), (-4.68, 57.145), (-4.81, 57.02), (-4.99, 56.915), (-5.09, 56.85), (-5.125, 56.843)],  # Caledonian Canal
    [(0.75, 51.50), (0.37, 51.445), (0.07, 51.49), (-0.072, 51.507)],                                              # Thames
    [(-7.25, 55.10), (-7.32, 55.00)],                                                                              # Foyle to Derry
]
cache_path = T("route_cache.json")
CACHE = json.load(open(cache_path)) if os.path.exists(cache_path) else {}
key = lambda a, b: f"{a[0]:.4f},{a[1]:.4f}|{b[0]:.4f},{b[1]:.4f}"
# tracks already on the site (plotter GPX for NNE 2026) win over freshly routed ones
for v in OLD:
    for L in v["legs"]:
        for R in L.get("routes", [L]):
            for h in R["hops"]:
                if h["from"] in v["ports"] and h["to"] in v["ports"]:
                    a, b = v["ports"][h["from"]], v["ports"][h["to"]]
                    c = h.get("coords") or dec(h.get("enc", ""))
                    if len(c) > 1: CACHE.setdefault(key(a, b), enc(c))

def route(a, b):
    (x1, y1), (x2, y2) = a, b
    span = max(abs(y2 - y1), abs(x2 - x1) * math.cos(math.radians((y1 + y2) / 2)))
    RES = max(0.003, span / 1400)
    pad = max(0.3, 0.35 * span); S, N = max(-85, min(y1, y2) - pad), min(85, max(y1, y2) + pad)
    k = math.cos(math.radians((S + N) / 2)); W, E = min(x1, x2) - pad / k, max(x1, x2) + pad / k; rx = RES / k
    nx, ny = int((E - W) / rx) + 1, int((N - S) / RES) + 1
    px = lambda x, y: ((x - W) / rx, (N - y) / RES)
    img = Image.new("L", (nx, ny), 0); d = ImageDraw.Draw(img); win = box(W, S, E, N)
    for i in LT.query(win):
        p = land[i]; d.polygon([px(*c) for c in p.exterior.coords], fill=1)
        for h in p.interiors: d.polygon([px(*c) for c in h.coords], fill=0)
    for i in KT.query(win):
        p = lakes[i]
        if p.area > 0.002: d.polygon([px(*c) for c in p.exterior.coords], fill=0)
    for l in CANALS: d.line([px(*c) for c in l], fill=0, width=3)
    L = np.array(img, bool)
    dist = ndimage.distance_transform_edt(~L) * RES * 111
    cost = 1 + 6 * np.exp(-dist / 1.5); cost[L] = 1e6
    idx = ndimage.distance_transform_edt(L, return_distances=False, return_indices=True)
    def cell(x, y):
        r, c = min(ny - 1, max(0, int((N - y) / RES))), min(nx - 1, max(0, int((x - W) / rx)))
        return (idx[0][r, c], idx[1][r, c]) if L[r, c] else (r, c)
    path, _ = route_through_array(cost, cell(x1, y1), cell(x2, y2), fully_connected=True, geometric=True)
    pr = np.array([p[0] for p in path]); pc = np.array([p[1] for p in path]); onL = L[pr, pc]
    cum = np.concatenate([[0], np.cumsum(onL)])
    def fine(i, j):
        n = max(abs(pr[j] - pr[i]), abs(pc[j] - pc[i])) * 2 + 2
        rr = np.linspace(pr[i], pr[j], n).round().astype(int); cc = np.linspace(pc[i], pc[j], n).round().astype(int)
        return L[rr, cc].sum() <= (cum[j + 1] - cum[i]) * 2
    keep = [0]; i = 0
    while i < len(path) - 1:
        j = i + 1; st = 1
        while j + st < len(path) and fine(i, j + st): j += st; st *= 2
        while st > 1:
            st //= 2
            if j + st < len(path) and fine(i, j + st): j += st
        keep.append(j); i = j
    return [[x1, y1]] + [[round(W + (pc[t] + .5) * rx, 4), round(N - (pr[t] + .5) * RES, 4)] for t in keep] + [[x2, y2]]

todo = []
for V in voyages:
    for L in V["legs"]:
        for R in L["routes"]:
            for a, b in zip(R["stops"], R["stops"][1:]):
                pa, pb = PORTS[a], PORTS[b]
                if key(pa, pb) not in CACHE and key(pb, pa) not in CACHE and (pa, pb) not in todo and (pb, pa) not in todo: todo.append((pa, pb))
print(f"\nrouting {len(todo)} new hops ({len(CACHE)} cached)")
t0, detours = time.time(), []
for n, (a, b) in enumerate(todo, 1):
    c = route(a, b); CACHE[key(a, b)] = enc(c)
    gc = km(a, b); tl = sum(km(p, q) for p, q in zip(c, c[1:]))
    if gc > 5 and tl > 3 * gc: detours.append(f"{a} → {b}: {tl:.0f} km for {gc:.0f} km straight")
    if n % 25 == 0 or n == len(todo):
        json.dump(CACHE, open(cache_path, "w"), separators=(",", ":"))
        print(f"  {n}/{len(todo)}  {time.time() - t0:.0f}s", flush=True)
if detours: print("long detours (check the waterway):"); [print("  ", d) for d in detours]

def hop_coords(a, b):
    pa, pb = PORTS[a], PORTS[b]
    if key(pa, pb) in CACHE: return CACHE[key(pa, pb)]
    return enc(dec(CACHE[key(pb, pa)])[::-1])

out = []
for V in voyages:
    for L in V["legs"]:
        for R in L["routes"]:
            R["hops"] = [{"from": a, "to": b, "enc": hop_coords(a, b)} for a, b in zip(R["stops"], R["stops"][1:])]
    used = sorted({n for L in V["legs"] for R in L["routes"] for n in R["stops"]})
    st = sorted(L["start"] for L in V["legs"] if L["start"]); en = sorted(L["end"] for L in V["legs"] if L["end"])
    v = {"id": V["id"], "title": V["title"], "sub": V["sub"], "start": st[0] if st else None, "end": en[-1] if en else None,
         "ports": {n: PORTS[n] for n in used}, "anchor": sorted(ANCH & set(used)), "legs": V["legs"]}
    # a fingerprint of the data: copies of a voyage saved on the server from an older version are ignored
    v["rev"] = hashlib.sha1(json.dumps(v, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:10]
    out.append(v)
out.sort(key=lambda v: v["start"] or "", reverse=True)
open(os.path.join(ROOT, "voyages.js"), "w", encoding="utf-8").write("window.SEED=" + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n")
print(f"\nvoyages.js: {len(out)} voyages, {os.path.getsize(os.path.join(ROOT, 'voyages.js')) / 1e6:.1f} MB")
