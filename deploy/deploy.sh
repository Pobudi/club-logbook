#!/usr/bin/env bash
# Runs on the VM. Called by GitHub Actions over SSH (the deploy key is locked to this script),
# or by hand: ~/club-logbook/deploy/deploy.sh
# Updates the code to origin/main, rebuilds and restarts the container, checks it answers.
# Data lives in the Docker volume and .env is untracked, so neither is touched.
set -euo pipefail

main() {
  cd "$(dirname "$(readlink -f "$0")")/.."
  exec 9>/tmp/akz-deploy.lock
  flock -w 600 9

  echo "== $(date -Is) deploying (requested: ${SSH_ORIGINAL_COMMAND:-manual})"
  git fetch --quiet origin main
  git reset --hard origin/main
  echo "== now at $(git log -1 --format='%h %s')"

  test -f .env || { echo "missing .env (copy .env.example and set AKZ_ADMIN_PASSWORD)"; exit 1; }

  sudo docker compose up -d --build --remove-orphans
  sudo docker image prune -f >/dev/null

  for _ in $(seq 1 30); do
    if curl -fsS localhost:8090/healthz >/dev/null; then echo "== healthy"; return 0; fi
    sleep 2
  done
  echo "== health check failed"
  sudo docker compose logs --tail 80
  return 1
}

# the whole function is read before git reset can rewrite this file
main "$@"
