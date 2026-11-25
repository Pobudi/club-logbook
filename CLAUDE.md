# AKŻ AGH — voyage archive & presentation map

Static site (`index.html`, `app.js`, map data in `base.js` / `voyages.js` / `gaz.js`) plus a small
dependency-free Node server (`server/server.js`) that stores documents and photos in `/data`.
`server/selfhost.js` gives the page the same `window.claude` db/assets/user API it has on claude.ai;
the Dockerfile injects it into `index.html`. Keep both runtimes working: don't call the server
directly from `app.js` except behind `SELF`.

UI text is Polish. Pushing to `main` deploys to https://akz.ai4es.xyz (see `.github/workflows/deploy.yml`).

Before committing:
- `node --check server/server.js && node -e "new Function(require('fs').readFileSync('app.js','utf8'))"`
- `docker build -t akz . && docker run --rm -p 8080:8080 -e ADMIN_LOGIN=a -e ADMIN_PASSWORD=password1 akz`
  then open http://localhost:8080

## Voyage data

`voyages.js` is generated — never edit it by hand. Source of truth is the club sheet export
`tools/historia.csv` (columns: Od, Do, Typ rejsu, Trasa z karty, Nazwa, Liczba godzin, Liczba mil, Liczba osób).
To change voyages: edit/replace the CSV, then

    pip install --break-system-packages numpy scipy scikit-image shapely pillow   # once
    python3 tools/build_voyages.py --check   # parse + place every stop, prints problems, no routing
    python3 tools/build_voyages.py           # routes new hops by sea, writes voyages.js

Commit the CSV, `voyages.js` and `tools/route_cache.json` together.
- A stop that can't be placed stops the build: add it (or a spelling variant in `aliases`) to `tools/places.csv`.
- Rows with impossible dates get dates from the same boat's neighbouring legs; the build prints what it did.
- Ids of existing voyages must not change (photos and slide settings on the server are stored under them):
  see `KEEP` in `build_voyages.py`; new voyages get `<type>-<year>`.
- Each voyage carries `rev` (fingerprint of its data). Copies of a voyage that admins saved on the server
  for an older `rev` are ignored, so the file always wins after a rebuild.

Never commit `.env`, backups (`*.tar`) or anything from `/data`.
Don't change the port mapping in `docker-compose.yml` (nginx on the VM proxies to 127.0.0.1:8090).
