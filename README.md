# META Showroom

## Entwicklung – welche URL?

| Was du sehen willst | URL (Vite-Dev, Standard **Port 5050**) |
|---------------------|----------------------------------------|
| **3D-Showroom**     | **http://localhost:5050/**             |
| **Dashboard**       | http://localhost:5050/dashboard.html   |
| **GLB-Konvertierung** (OBJ/STEP/ZIP) | http://localhost:5050/converter.html |

### Häufiger Fehler: „Step Converter“ statt Showroom

- **Port 3000** = API-Gateway des **Blender/MCP-Konverters** (Backend). Dort kann eine andere Web-Oberfläche erscheinen – **nicht** der Showroom.
- **Port 8001** = MCP-Server (API), kein Showroom.

**Richtig:** Immer **http://localhost:5050/** für den Showroom (bzw. `/dashboard.html` fürs Dashboard).

Wenn 5050 belegt ist, zeigt Vite im Terminal einen anderen Port (z. B. 5051) – diese URL verwenden.

## Dashboard: PNG-Karten-Vorschau (nach Konvertierung)

Nach erfolgreichem **`POST /__api/register-converted`** (z. B. wenn das Dashboard eine fertige Konvertierung registriert) versucht die Vite-API, ein **Screenshot-ähnliches PNG** pro GLB zu erzeugen und in `products.json` die Felder **`previewImage`** und **`previewImageGeneratedAt`** zu setzen. Im Dashboard werden die Karten dann als **statisches Bild** statt WebGL gerendert (kein „Verschwinden“ beim Scrollen durch WebGL-Pool-Limits).

- **Chrome/Chromium** muss auf dem Rechner installiert sein. Es wird **`puppeteer-core`** + **`chrome-launcher`** verwendet (kein gebündeltes Chromium).
- Findet `chrome-launcher` keinen Browser, wird der Schritt übersprungen; Karten fallen auf die **3D-WebGL-Vorschau** zurück.
- Optional: **`PUPPETEER_EXECUTABLE_PATH`** auf die Binary setzen (z. B. Chrome unter macOS/Windows), falls die automatische Suche fehlschlägt.
- Technische Seite für den Headless-Render: [`src/thumbnail/dashboardThumbCapture.html`](src/thumbnail/dashboardThumbCapture.html) (wird von Puppeteer über dieselbe Vite-URL wie der Showroom geladen).

## Befehle

```bash
npm install
npm run dev          # nur Vite (Showroom + Dashboard + Converter)
npm run dev:full     # + API (3000) + MCP (8001) für Konvertierung
```

Weitere Infos: [README-windows.md](README-windows.md)

## Einstieg fuer neue Kolleg:innen

Eine kompakte Bedienungsanleitung fuer den Team-Start findest du hier:

- [docs/bedienungsanleitung-kollegen.md](docs/bedienungsanleitung-kollegen.md)

## Blender-Render (Showroom-Einstellungen)

Im Showroom unter **Einstellungen → Blender-Render** kann die aktuelle Ansicht (GLB, Kamera, Brennweite, gewählte RAL-Farbe) als **PNG** per **headless Blender** gerendert werden (transparenter Hintergrund, weicher Bodenschatten).

### Voraussetzungen

- Showroom mit **Vite** starten (`npm run dev`), damit der Endpoint **`POST /__api/blender-render`** (Dashboard-API-Plugin) aktiv ist.
- **Blender 4.x** installiert (Eevee Next / Cycles).
- **Blender** muss installiert sein. Ohne `BLENDER_PATH` wird automatisch gesucht: typische macOS-Pfade (`Blender.app`, `Blender LTS.app`), sonst `blender` im `PATH` (`which` / Windows `where`).
- Optional: Umgebungsvariable **`BLENDER_PATH`** auf die Binary setzen, z. B. macOS:
  - `export BLENDER_PATH="/Applications/Blender.app/Contents/MacOS/Blender"`
- Optional: Umgebungs-HDRI unter **`public/hdri/warehouse.hdr`** (entspricht `EURIS.hdriPath` in `src/showroom/eurisConstants.js`) – sonst neutrales Studio-World-Shader im Skript.

### Render-Engines

- **Eevee** – schneller Vorschau-Render.
- **Cycles** – raytracing (Standard: **GPU** mit automatischem CPU-Fallback, falls kein kompatibles Gerät verfügbar; erzwingbar per API-Body `cyclesDevice: "CPU"`). Plattform-Prioritäten: macOS = METAL, Windows/Linux = OPTIX → CUDA → HIP → ONEAPI.

Skript: `scripts/blender_render.py` · Server-Logik: `scripts/render/blenderRenderRoute.mjs`.
