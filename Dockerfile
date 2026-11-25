# AKŻ AGH — voyage archive & presentation map, self-hosted with persistent storage.
# Everything admins and visitors save (voyages, slide layouts, framing, authors, photos) lives in /data.
FROM node:22-alpine

WORKDIR /app
COPY server/server.js server/github-backup.js /app/
COPY index.html app.js router-worker.js voyages.js base.js gaz.js \
     maplibre-gl-csp.js maplibre-gl-csp-worker.js maplibre-gl.css /app/public/
COPY photos/ /app/public/photos/
COPY server/selfhost.js /app/public/selfhost.js

# Plug the page into this server instead of claude.ai, and pre-compress text files
RUN sed -i 's#<script src="app.js"></script>#<script src="selfhost.js"></script><script src="app.js"></script>#' /app/public/index.html \
 && grep -q 'selfhost.js' /app/public/index.html \
 && find /app/public -type f \( -name '*.js' -o -name '*.css' -o -name '*.html' \) -exec gzip -9 -k {} \; \
 && mkdir -p /data && chown node:node /data

USER node
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "/app/server.js"]
