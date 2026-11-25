"""Parse tools/historia.csv (the club sheet export) into rows with clean stop lists.

Shared by build_voyages.py. Route notation in the sheet varies: "->", "-->", "=>", ">", "→", " - "
or plain commas; anchorages are marked with ⚓︎ / [⚓︎] / (⚓︎) / Ω; free-text notes appear in brackets.
"""
import csv, datetime as dt, re, unicodedata

def fold(s):
    s = s.lower().replace("ø", "o").replace("æ", "ae").replace("ł", "l").replace("ß", "ss").replace("ð", "d").replace("þ", "th")
    s = unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9() -]", " ", s)).strip()

def pdate(s):
    try: return dt.datetime.strptime(s.strip(), "%d.%m.%Y").date()
    except Exception: return None

def num(s):
    s = (s or "").replace(" ", "").replace(" ", "").strip().rstrip(",").rstrip(".")
    if not s: return None
    return float(s.replace(",", "."))

# whole-phrase fixes applied before splitting (compound names that contain a separator)
PRE = [
    (r"Trogir\s*-\s*Seget Donji", "Seget Donji"), (r"Port of Fontvieille\s*-\s*Monaco", "Fontvieille (Monaco)"),
    (r"Port Vauban\s*-\s*Antibes", "Port Vauban (Antibes)"), (r"Ateny\s*-\s*Kalamaki", "Kalamaki (Ateny)"),
    (r"Krabi Marina", "Krabi"), (r"Pala,os", "Palamos"), (r"Kph Lynetten", "Lynetten (Kopenhaga)"),
    (r"Eeeeeee\.\.\.\.\s*Ystad przez tydzień", "Ystad"), (r"\(to nie wiem[^)]*\)", ""), (r"\(\s*todo\s*\)", ""),
    (r"St Vincent i Grenadyny:\s*", ""), (r"Martynika:\s*", ""), (r"St Lucia - Rodney Bay", "Rodney Bay"),
    (r"Maryeau/Salt Whistle Bay", "Salt Whistle Bay"), (r"Union/Clifton", "Clifton"), (r"Sivota\s+Gouvia", "Sivota -> Gouvia"),
    (r"Kastri Pt\. / Aggios Ioannis", "Agios Ioannis (Skopelos)"), (r"Ormos Prasso / Kavos", "Ormos Prasso"),
    (r"Anıt Mezar /Goat Bay", "Goat Bay"), (r"Szczecin-Trzebież", "Szczecin - Trzebież"), (r"Pomorski-Szczecin", "Pomorski - Szczecin"),
    (r"Kytra_>", "Kytra ->"), (r"Phuket - Ko Khai Nai - Ko Phi Phi Le", "Phuket, Ko Khai Nai, Ko Phi Phi Le"),
]
ANCH_RE = re.compile(r"\[\s*⚓︎?️?\s*\]|\(\s*⚓︎?️?\s*\)|⚓︎?️?|Ω")
ARROWS = r"\s*(?:-{1,3}>|={1,2}>|>{1,2}|→)\s*"

def split_route(text):
    """'A -> ⚓︎ B -> C' -> [('A', False), ('B', True), ('C', False)]"""
    t = (text or "").replace("\n", " ").strip()
    for a, b in PRE: t = re.sub(a, b, t, flags=re.I)
    if not t: return []
    arrows = re.search(ARROWS, t) is not None
    # commas inside parentheses never separate stops
    t = re.sub(r"\([^)]*\)", lambda m: m[0].replace(",", "⁣"), t)
    parts = re.split(ARROWS, t) if arrows else re.split(r"\s*,\s*", t)
    out = []
    for p in parts:
        # " - " separates stops too (Palamos - Blanes, "Hooksiel -> Bremershaven - Cuxhaven")
        for q in re.split(r"\s+-\s*|\s*-\s+|(?<=\))-", p):
            # with arrows, a comma is either "Island, Port" (one place) or two stops both written as "Place (Island)"
            subs = [q]
            if arrows and "," in q:
                cs = [c.strip() for c in q.split(",") if c.strip()]
                subs = cs if all("(" in c for c in cs) else [q]
            for s in subs:
                s = s.replace("⁣", ",")
                anch = bool(ANCH_RE.search(s))
                s = ANCH_RE.sub("", s).strip(" .;:")
                if s: out.append((re.sub(r"\s+", " ", s), anch))
    return out

def read_rows(path):
    rows = []
    with open(path, encoding="utf-8", newline="") as f:
        for i, r in enumerate(csv.DictReader(f)):
            s, e = pdate(r["Od"]), pdate(r["Do"])
            crew = num(r["Liczba osób"])
            rows.append({"i": i, "line": i + 2, "voy": re.sub(r"\s+", " ", r["Typ rejsu"]).strip(), "s": s, "e": e,
                         "raw": r["Trasa z karty"], "stops": split_route(r["Trasa z karty"]),
                         "boat": re.sub(r"\s+", " ", (r["Nazwa"] or "").strip().strip('"')).strip(),
                         "h": num(r["Liczba godzin"]), "nm": num(r["Liczba mil"]), "crew": int(crew) if crew is not None else None})
    return rows

if __name__ == "__main__":
    import sys, collections
    rows = read_rows(sys.argv[1] if len(sys.argv) > 1 else "tools/historia.csv")
    names = collections.Counter(n for r in rows for n, _ in r["stops"])
    print(len(rows), "rows,", len(names), "unique stop names")
    for n, c in sorted(names.items(), key=lambda x: fold(x[0])): print(f"{c:3d}  {n}")
