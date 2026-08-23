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

Ein roter Haken im [Actions-Tab](https://github.com/about-design/Showroom/actions) heißt: Build ist kaputt – **vor** dem Push auf `online-docker` noch mal prüfen, da Mittwald jeden Push dort sofort baut und live schaltet (siehe unten).

## Deployment (Mittwald Cloud / mStudio)

Gehostet wird bei **Mittwald Cloud/mStudio**. Mittwalds Compose-Import ist **kein** normales `docker compose` – akzeptiert wurden dabei folgende Einschränkungen (per Validierungsfehler bestätigt):

- kein `build:` – nur fertige Images per `image:` aus einer Registry
- kein `restart:`
- keine relativen Bind-Mount-Pfade (nur absolute Pfade oder benannte Volumes)
- keine `${VAR}`-Interpolation in `ports:`, nur literale Werte wie `"80:80"`
- Routing/TLS/Domain übernimmt Mittwald selbst → kein eigener nginx-Proxy-Service nötig

Deshalb gibt es zwei getrennte Compose-Dateien:

| Datei | Zweck |
|---|---|
| [`docker-compose.yml`](docker/docker-compose.yml) | Lokale Entwicklung/eigener Server, baut Images selbst (`npm run docker:build`/`docker:up`) |
| [`docker-compose.mittwald.yml`](docker/docker-compose.mittwald.yml) | **Upload bei Mittwald** – referenziert fertige Images aus GHCR, kein `build`/`restart`/Proxy |

**Bilder-Pipeline:**

- `showroom-web` und `showroom-dashboard-api` werden automatisch von [`.github/workflows/build-images.yml`](../.github/workflows/build-images.yml) bei jedem Push auf `online-docker` gebaut und nach `ghcr.io/about-design/…` gepusht (Tags `latest` + Commit-SHA).
- `showroom-converter-mcp` und `showroom-converter-gateway` können dort **nicht** gebaut werden – ihr Build-Kontext (`vendor/blender-mcp-converter`) liegt nur lokal vor (gitignored, separates Blender-Projekt, kein GitHub-Remote). Diese zwei müssen manuell gepusht werden: [`deploy/docker/push-converter-images.sh`](docker/push-converter-images.sh) auf einem Rechner mit `blender-exporter`-Symlink ausführen, nach `docker login ghcr.io`.
- GHCR-Pakete müssen entweder **öffentlich** sein (einfachste Variante) oder Mittwald braucht einen Registry-Zugang (GitHub PAT mit `read:packages`) hinterlegt, um private Images zu ziehen.

**Offene Punkte, die ich nicht raten wollte/konnte** (bitte beim Hochladen/Testen gegenprüfen):

- Ob Mittwald mehrere öffentlich erreichbare Ports/Services pro Projekt unterstützt (aktuell ist nur `web` mit `ports: 80:80` als öffentlicher Eintrittspunkt gesetzt; `dashboard-api`/`converter-gateway` sind nur `expose`, also intern – falls `dashboard.html`/`converter.html` bei Mittwald auch von außen erreichbar sein müssen, braucht’s dafür ggf. eine weitere Mittwald-seitige Freigabe).
- Ob `${VAR:-default}`/`.env`-Interpolation in der hochgeladenen Compose überhaupt ausgewertet wird – deshalb stehen in `docker-compose.mittwald.yml` literale Platzhalterwerte (z. B. `https://showroom.example.com`), die nach dem Import über Mittwalds eigene Umgebungsvariablen-Verwaltung pro Service echt gesetzt werden müssen.
- Ob `expose`, `depends_on`, `healthcheck` von Mittwalds Parser unterstützt werden (nicht explizit als Fehler gemeldet, aber auch nicht bestätigt) – falls der nächste Upload-Versuch weitere Fehler wirft, bitte die Fehlermeldungen 1:1 hier reinkopieren, dann passe ich gezielt nach.

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
