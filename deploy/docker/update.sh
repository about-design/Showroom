#!/usr/bin/env bash
# META Showroom – Online/Docker: Auto-Deploy-Skript
#
# Wird auf dem SERVER ausgeführt (manuell, per Cron oder via GitHub Actions/SSH).
# Holt den neuesten Stand von 'online-docker', baut geänderte Docker-Images neu
# und startet nur die betroffenen Container neu.
#
# Aufruf:
#   bash deploy/docker/update.sh
#
# Voraussetzung: Skript liegt im Checkout des Showroom-Repos auf dem Server,
# Arbeitsverzeichnis ist der Repo-Root (oder wird per REPO_DIR übersteuert).

set -euo pipefail

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
BRANCH="${DEPLOY_BRANCH:-online-docker}"
LOG_PREFIX="[deploy $(date '+%Y-%m-%d %H:%M:%S')]"

cd "$REPO_DIR"

echo "$LOG_PREFIX Repo: $REPO_DIR (Branch: $BRANCH)"

# --- Vorher/Nachher-Commit merken, um sinnlose Rebuilds zu vermeiden ---
BEFORE="$(git rev-parse HEAD)"

echo "$LOG_PREFIX git fetch/reset auf origin/$BRANCH ..."
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

AFTER="$(git rev-parse HEAD)"

if [ "$BEFORE" = "$AFTER" ]; then
  echo "$LOG_PREFIX Kein neuer Commit ($AFTER) – nichts zu tun."
  exit 0
fi

echo "$LOG_PREFIX Update $BEFORE -> $AFTER"

# --- Konverter-Vendor-Sync (Symlink/CONVERTER_SOURCE -> vendor/) ---
if [ -f package.json ]; then
  echo "$LOG_PREFIX npm run vendor:converter ..."
  npm run vendor:converter
fi

# --- Images neu bauen + Stack aktualisieren (nur geänderte Container werden ersetzt) ---
echo "$LOG_PREFIX docker compose build + up -d ..."
docker compose -f deploy/docker/docker-compose.yml --env-file deploy/docker/.env build
docker compose -f deploy/docker/docker-compose.yml --env-file deploy/docker/.env up -d

echo "$LOG_PREFIX Aufräumen alter Images ..."
docker image prune -f >/dev/null 2>&1 || true

echo "$LOG_PREFIX Fertig. Laufende Container:"
docker compose -f deploy/docker/docker-compose.yml --env-file deploy/docker/.env ps
