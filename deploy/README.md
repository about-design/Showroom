# META Showroom – Online / Docker

Reine Online-Version des META Showroom für Webserver- und Docker-Betrieb.  
Branch: **`online-docker`**

## Architektur

| Service | Rolle | Port (intern) |
|---------|-------|---------------|
| **proxy** | Reverse-Proxy, Basic-Auth, Rate-Limits | 8080 (öffentlich) |
| **web** | Statischer Vite-Build (Showroom, Dashboard-UI, Konverter-UI) | 80 |
| **dashboard-api** | Node-Server mit `/__api/*` (ehem. Vite-Plugin) | 5080 |
| **converter-gateway** | Express-API für CAD→GLB | 3000 |
| **converter-mcp** | Python/FastAPI + Blender headless | 8001 |
| **redis** | Job-Queue (BullMQ) | 6379 |

Öffentlich ohne Login: **Showroom** (`/`).  
Mit Basic-Auth: Dashboard, Konverter, `/__api/*`, `/api/*`, `/outputs/*`.

3D-Modelle (~2,6 GB) werden **nicht** ins Image gebacken, sondern über **`VITE_ASSET_BASE_URL`** von externem CDN/Storage geladen.

## Voraussetzungen

- Docker + Docker Compose v2
- `rsync` (für `npm run vendor:converter`)
- Symlink `blender-exporter` → Konverter-Projekt **oder** `CONVERTER_SOURCE=/pfad/zu/blender-mcp-converter`

## Schnellstart

```bash
# 1. Konfiguration
cp deploy/docker/.env.example deploy/docker/.env
# VITE_ASSET_BASE_URL und SHOWROOM_ORIGIN anpassen

# 2. Basic-Auth-Passwort setzen (Beispiel: admin / geheim)
docker run --rm httpd:2.4-alpine htpasswd -nbB admin 'geheim' > deploy/docker/htpasswd

# 3. Konverter ins Repo vendoren + Images bauen
npm run docker:build

# 4. Stack starten
npm run docker:up
```

Showroom: **http://localhost:8080/**  
Dashboard: **http://localhost:8080/dashboard.html** (Login)  
Konverter: **http://localhost:8080/converter.html** (Login)

## Externe Modelle (CDN)

In `deploy/docker/.env`:

```env
VITE_ASSET_BASE_URL=https://cdn.example.com/showroom-assets
```

Pfade in `products.json` bleiben relativ (`/models/products/…`).  
Das Frontend löst sie via [`src/lib/resolveAssetUrl.js`](../src/lib/resolveAssetUrl.js) auf.

**CORS** am CDN für `GET` auf `.glb`, `.usdz`, Bilder erlauben.

## Persistenz (Docker Volumes)

| Volume | Inhalt |
|--------|--------|
| `showroom-data` | `products.json`, `cad-index.json` |
| `showroom-public` | Uploads, Thumbnails, `mtl-ral-color-mapping.json` |
| `converter-outputs` | Konvertierte GLB/USDZ |
| `redis-data` | Job-Queue |

## Lokaler API-Server (ohne Docker)

Nach `npm run build`:

```bash
SHOWROOM_ORIGIN=http://127.0.0.1:5080 \
CONVERTER_API_URL=http://127.0.0.1:3000 \
npm run start:dashboard-api
```

## TLS (Produktion)

Variante A – **Caddy** (siehe [`deploy/docker/Caddyfile`](docker/Caddyfile)):

```bash
# Hash erzeugen: caddy hash-password
export BASIC_AUTH_HASH='…'
export SHOWROOM_DOMAIN=showroom.example.com
```

Variante B – externer Reverse-Proxy (Traefik, nginx auf Host) vor Port 8080.

## Wichtige Umgebungsvariablen

| Variable | Beschreibung |
|----------|--------------|
| `VITE_ASSET_BASE_URL` | CDN-Basis-URL für Modelle (Build-Arg für `web`) |
| `SHOWROOM_ORIGIN` | Öffentliche Origin für CSRF/CORS |
| `SHOWROOM_API_TOKEN` | Optionales Shared Secret (`X-Showroom-Token`) |
| `CONVERTER_API_URL` | Dashboard-API → Gateway (intern: `http://converter-gateway:3000`) |
| `CLAUDE_API_KEY` | Optional für KI-Klassifikation im MCP-Server |

## Continuous Integration (GitHub Actions)

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) läuft bei jedem Push und Pull Request auf `main`, `online-docker` und `windows-rollout` – **rein zur Qualitätssicherung, kein Deploy:**

1. **Frontend-Build:** `npm ci` + `npm run build`, prüft dass `dist/index.html` entsteht – der exakte Befehl, der auch `dist/` für Windows/Docker erzeugt.
2. **Docker-Image-Build:** baut `Dockerfile.web` und `Dockerfile.dashboard-api` probeweise (ohne Push), um sicherzustellen, dass die produktiven Images sauber bauen.

`converter-mcp`/`converter-gateway` werden **nicht** mitgebaut, da ihr Docker-Kontext (`vendor/blender-mcp-converter`) erst lokal per `npm run vendor:converter` aus dem separaten Blender-Converter-Projekt erzeugt wird und in GitHub Actions nicht vorliegt.

Ein roter Haken im [Actions-Tab](https://github.com/about-design/Showroom/actions) heißt: Build ist kaputt – bevor der Commit über `update-showroom.cmd`, den Docker-Auto-Deploy oder manuell auf Mittwald landet, noch mal prüfen.

**Hinweis Mittwald:** Dieser CI-Workflow prüft nur, dass Build/Images lokal sauber entstehen. Er ist unabhängig davon, wie Mittwald Cloud/mStudio das Image beim eigentlichen Deploy baut oder zieht (Git-Trigger vs. Registry-Push) – dazu müssten wir die konkrete Mittwald-Projektkonfiguration ansehen, sobald ihr die Zugangsdaten/den Workflow dafür bereit habt.

## Automatisches Deployment (GitHub Actions)

Bei jedem Push auf `online-docker` rollt [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) automatisch auf dem Server aus: GitHub Actions verbindet sich per SSH und führt dort [`deploy/docker/update.sh`](docker/update.sh) aus (git reset auf `origin/online-docker`, `npm run vendor:converter`, `docker compose build` + `up -d`, altes Image-Aufräumen). Reine `git pull`s auf dem Server ohne diesen Rebuild-Schritt reichen **nicht** aus – der `web`-Container bäckt `dist/` beim Image-Build ein, nicht zur Laufzeit.

**Einmalige Einrichtung (Server-Admin):**

1. Auf dem Server einen eigenen Deploy-User anlegen (kein root), der in der `docker`-Gruppe ist, und dort das Repo einmalig klonen, z. B. nach `/opt/showroom` (Branch `online-docker` auschecken, `.env`/`htpasswd` wie oben einrichten und den Stack einmal manuell hochfahren, um alles zu verifizieren).
2. Dediziertes SSH-Schlüsselpaar für den Deploy-User erzeugen und den Public Key in dessen `~/.ssh/authorized_keys` eintragen:
   ```bash
   ssh-keygen -t ed25519 -f deploy_key -C "github-actions-showroom" -N ""
   ```
3. Im GitHub-Repo unter **Settings → Secrets and variables → Actions** anlegen:
   - `DEPLOY_HOST` – Hostname/IP des Servers
   - `DEPLOY_USER` – der Deploy-User aus Schritt 1
   - `DEPLOY_SSH_KEY` – Inhalt der privaten Schlüsseldatei (`deploy_key`) aus Schritt 2
   - `DEPLOY_PATH` – Pfad zum Checkout auf dem Server, z. B. `/opt/showroom`
   - optional `DEPLOY_PORT`, falls SSH nicht auf 22 läuft
4. Testen: Push auf `online-docker` (oder „Run workflow“ im Actions-Tab) und den Job-Log prüfen.

Ohne diese Secrets schlägt der Workflow fehl, ändert aber nichts – reines Einrichten der Datei ist ungefährlich.

## Hinweise

- **Blender** läuft headless im Container (CPU). GPU-Cycles ist auf typischen Webservern nicht verfügbar.
- **Konverter** wird per `npm run vendor:converter` aus dem Symlink `blender-exporter` kopiert – nicht committen (`vendor/` ist gitignored).
- Der Windows-/Electron-Stack auf `main` bleibt unverändert.

## Dateien

- [`deploy/docker/docker-compose.yml`](docker/docker-compose.yml) – Stack-Definition
- [`deploy/docker/Dockerfile.*`](docker/) – Images
- [`deploy/docker/nginx-proxy.conf`](docker/nginx-proxy.conf) – Auth + Rate-Limits
- [`server/dashboard-server.mjs`](../server/dashboard-server.mjs) – Standalone Dashboard-API
- [`scripts/vite-plugin/dashboardApi.mjs`](../scripts/vite-plugin/dashboardApi.mjs) – `registerDashboardApi()` (Dev + Prod)
