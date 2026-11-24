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

Never commit `.env`, backups (`*.tar`) or anything from `/data`.
Don't change the port mapping in `docker-compose.yml` (nginx on the VM proxies to 127.0.0.1:8090).
