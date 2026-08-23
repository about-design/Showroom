#!/usr/bin/env bash
# META Showroom – converter-mcp/converter-gateway nach GHCR pushen
#
# Diese zwei Images können NICHT in GitHub Actions gebaut werden: ihr
# Build-Kontext (vendor/blender-mcp-converter) entsteht erst lokal per
# `npm run vendor:converter` aus dem separaten Blender-Converter-Projekt
# (Symlink "blender-exporter", gitignored). Deshalb: manuell auf einem
# Rechner ausführen, der diesen Symlink/Ordner hat.
#
# Voraussetzung: einmalig eingeloggt sein:
#   echo "$GHCR_TOKEN" | docker login ghcr.io -u <dein-github-user> --password-stdin
# (GHCR_TOKEN = GitHub Personal Access Token mit Scope "write:packages")
#
# Aufruf aus dem Repo-Root:
#   bash deploy/docker/push-converter-images.sh

set -euo pipefail

OWNER="${GHCR_OWNER:-about-design}"
REGISTRY="ghcr.io/${OWNER}"

echo "==> Konverter-Quelle synchronisieren (npm run vendor:converter)"
npm run vendor:converter

echo "==> converter-mcp bauen"
docker build \
  -f vendor/blender-mcp-converter/Dockerfile.converter-mcp \
  -t "${REGISTRY}/showroom-converter-mcp:latest" \
  vendor/blender-mcp-converter

echo "==> converter-gateway bauen"
docker build \
  -f vendor/blender-mcp-converter/Dockerfile.converter-gateway \
  -t "${REGISTRY}/showroom-converter-gateway:latest" \
  vendor/blender-mcp-converter

echo "==> Push nach ${REGISTRY}"
docker push "${REGISTRY}/showroom-converter-mcp:latest"
docker push "${REGISTRY}/showroom-converter-gateway:latest"

echo "==> Fertig. Mittwald zieht beim naechsten Redeploy die neuen ':latest'-Images."
