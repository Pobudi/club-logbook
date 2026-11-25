# AKŻ AGH — dziennik rejsów (self-hosted)

    cp .env.example .env        # set AKZ_ADMIN_PASSWORD (min. 8 characters)
    docker compose up -d --build

Site: http://<server>:8080 · first login: `admin` + the password from `.env`.

All data (voyages, slide layouts, framing, photo authors, photos, logins) is kept in the
`akz-data` Docker volume (`/data`), so it survives restarts, rebuilds and redeploys.
`/data/snapshots` keeps a daily copy of the database (last 30 days).

Moving data from the claude.ai version: there, Admin panel → "Przeniesienie na własny
serwer" → Przygotuj dane → Kopiuj do schowka. Here, Admin panel → "Kopia zapasowa" →
paste → Wczytaj wklejone dane.

Backups: Admin panel → "Pobierz kopię (.tar)". Restore with "Wczytaj kopię z pliku…".

Updating the site: `docker compose up -d --build`. Never run `docker compose down -v`:
`-v` deletes the volume with all the data.

Environment: ADMIN_LOGIN / ADMIN_PASSWORD (only used while there is no admin account),
TRUST_PROXY=1 (behind an HTTPS reverse proxy), MAX_UPLOAD_MB (20), UPLOADS_PER_DAY
per visitor IP (300), SESSION_HOURS (72).

## Off-site backup to GitHub

Every uploaded photo is copied to a private GitHub repo right after upload, and the data file
(`db.json`: voyages edited on the site, slide layouts, framing, authors, upload queue, admin
accounts) a minute after any change. Photos that can't be sent wait in `/data/backup-queue.json`
and are retried every 5 minutes; on start the server sends anything the repo is missing.

Setup: create a **private** repo (e.g. `club-logbook-backup`) and a fine-grained token limited to
that repo with *Contents: Read and write*, then in `.env` on the VM:

    GITHUB_BACKUP_REPO=Pobudi/club-logbook-backup
    GITHUB_BACKUP_TOKEN=github_pat_...

and run `./deploy/deploy.sh`. The admin panel shows the backup status.

Restore: `git clone` the backup repo, `tar -cf kopia.tar db.json blobs`, then in the admin panel
→ Kopia zapasowa → "Wczytaj kopię z pliku…".
