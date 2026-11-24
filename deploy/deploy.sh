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

  # the pull may have changed this script: continue with the new version
  if [ "${AKZ_DEPLOY_REEXEC:-}" != 1 ]; then
    flock -u 9
    AKZ_DEPLOY_REEXEC=1 exec "$(readlink -f "$0")" "$@"
  fi

  test -f .env || { echo "missing .env (copy .env.example and set AKZ_ADMIN_PASSWORD)"; exit 1; }

  sudo docker compose up -d --build --remove-orphans
  sudo docker image prune -f >/dev/null

  sudo docker compose ps
  local ok=""
  for _ in $(seq 1 30); do
    if curl -fsS localhost:8090/healthz >/dev/null; then ok=1; break; fi
    sleep 2
  done
  if [ -z "$ok" ]; then
    echo "== app does not answer on localhost:8090"
    sudo docker compose logs --tail 80
    return 1
  fi
  echo "== app answers on localhost:8090"

  # nginx must forward the domain to that same port (a mismatch shows up as 502)
  sudo python3 deploy/nginx_akz.py akz.ai4es.xyz 8090
  local code=""
  for _ in $(seq 1 10); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --resolve akz.ai4es.xyz:443:127.0.0.1 https://akz.ai4es.xyz/healthz || true)
    [ "$code" = 200 ] && break
    sleep 2
  done
  echo "== https://akz.ai4es.xyz/healthz through nginx: $code"
  if [ "$code" != 200 ]; then
    echo "== nginx error log:"; sudo tail -n 8 /var/log/nginx/error.log || true
    return 1
  fi
  echo "== healthy"
}

# the whole function is read before git reset can rewrite this file
main "$@"
