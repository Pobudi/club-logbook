"""Resolve stop names to coordinates: tools/places.csv first, then ports already in voyages.js, then the gazetteer (gaz.js).
When several places share a name, the one nearest the voyage's other stops wins."""
import collections, csv, json, math, re
from routes import fold

base = lambda n: re.sub(r"\s+", " ", re.sub(r"\(.*?\)", "", fold(n))).strip()
IGNORE = {fold(x) for x in ["Nisos", "Azmos", "Paralia", "Cala Portese", "Cala di Capo Secco", "Uvala Stranac", "Uvala Susica", "Lykta",
                            "Kjelbotn", "Kleppholmen", "Nesvagen", "Bakkasunded", "Gulfikfjord", "Rosneshamn"]}

def km(a, b):
    (x1, y1), (x2, y2) = a, b
    return 6371 * math.hypot(math.radians(x2 - x1) * math.cos(math.radians((y1 + y2) / 2)), math.radians(y2 - y1))

class Geo:
    def __init__(self, places="tools/places.csv", seed="voyages.js", gaz="gaz.js"):
        self.C = collections.defaultdict(list)   # key -> [(canonical, lon, lat, anchor, src)]
        self.approx = set()
        with open(places, encoding="utf-8") as f:
            for r in csv.DictReader(l for l in f if not l.startswith("#")):
                c = (r["name"], float(r["lon"]), float(r["lat"]), r["anchor"] == "1", "places")
                if r.get("note") == "approximate": self.approx.add(r["name"])
                for n in [r["name"]] + [a for a in (r["aliases"] or "").split("|") if a]:
                    for k in {fold(n), base(n)}:
                        if c not in self.C[k]: self.C[k].append(c)
        self.n_places = len(self.C)
        s = open(seed, encoding="utf-8").read(); old = json.loads(s[s.index("["):s.rindex("]") + 1])
        self.O = {}
        for v in old:
            for n, (x, y) in v["ports"].items():
                for k in {fold(n), base(n)}: self.O.setdefault(k, (n, x, y, n in v.get("anchor", []), "site"))
        g = json.loads(open(gaz, encoding="utf-8").read()[len("window.GAZ="):].rstrip(";\n"))
        self.G = collections.defaultdict(list)
        for n, la, lo, cc, port in g: self.G[fold(n)].append((n, lo, la, False, "gazetteer"))

    def candidates(self, name):
        f, b = fold(name), base(name)
        if f in IGNORE or b in IGNORE: return "ignore", []
        for k in (f, b):
            if k in self.C: return "places", self.C[k]
        for k in (f, b):
            if k in self.O: return "site", [self.O[k]]
        for k in (f, b):
            if k in self.G: return "gazetteer", self.G[k]
        return "missing", []

    def pick(self, name, near=None):
        src, cs = self.candidates(name)
        if not cs: return src, None
        if len(cs) == 1 or near is None: return src, cs[0]
        return src, min(cs, key=lambda c: km((c[1], c[2]), near))
