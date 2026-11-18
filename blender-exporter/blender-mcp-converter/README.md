# Blender MCP Converter

Ein vollständiges **Model Context Protocol (MCP)** basiertes System zur automatisierten Konvertierung von .OBJ/.MTL-Modellen in .GLB-Dateien mit eingebetteten Texturen unter Verwendung von Blender.

## 🏗️ Systemarchitektur

Das System besteht aus vier Hauptkomponenten:

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Node.js API   │    │   Python MCP    │    │     Blender     │
│    Gateway      │◄──►│     Server      │◄──►│   Headless CLI  │
│  (Express.js)   │    │   (FastAPI)     │    │  (convert_to_   │
│                 │    │                 │    │      glb.py)    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │
         ▼                       │
┌─────────────────┐              │
│    BullMQ Job   │              │
│     Queue       │              │
│    (Redis)      │              │
└─────────────────┘              │
                                 ▼
                    ┌─────────────────┐
                    │  AI Material    │
                    │  Recognition    │
                    │ (ai_material.py)│
                    └─────────────────┘
```

## 📋 Systemanforderungen

- **Node.js** ≥ 20.0.0
- **Python** ≥ 3.10
- **Blender** (Headless CLI) - Download von [blender.org](https://www.blender.org/download/)
- **Redis** (optional, für persistente Job-Warteschlange)
- **Operating System**: macOS, Linux oder Windows 10/11

### Schnelle Installation der Abhängigkeiten

```bash
# macOS mit Homebrew
brew install node python blender redis

# Oder Blender direkt von blender.org herunterladen
# Das System erkennt automatisch: /Applications/Blender.app/Contents/MacOS/Blender

# Ubuntu/Debian
sudo apt update
sudo apt install nodejs npm python3 python3-pip blender redis-server

# Arch Linux
sudo pacman -S nodejs npm python python-pip blender redis
```

### 🍎 macOS-spezifische Hinweise

**Blender Installation auf macOS:**
```bash
# Option 1: Homebrew (empfohlen für CLI-Nutzung)
brew install blender

# Option 2: Download von blender.org
# Wird automatisch erkannt unter: /Applications/Blender.app/Contents/MacOS/Blender

# Option 3: Link in PATH erstellen (optional)
ln -s /Applications/Blender.app/Contents/MacOS/Blender /usr/local/bin/blender
```

**Blender-Integration testen:**
```bash
./test-blender-macos.sh
```

### 💻 Windows-spezifische Hinweise

**Grundinstallation:**

- Installieren Sie Node.js ≥ 20 sowie Python ≥ 3.10 (z. B. mit [winget](https://learn.microsoft.com/windows/package-manager/winget/) oder direkt von den Herstellerseiten).
- Installieren Sie Blender mit dem offiziellen Installer und belassen Sie den Standardpfad `C:\Program Files\Blender Foundation\Blender\blender.exe`, der vom Launcher automatisch erkannt wird. Für alternative Installationen setzen Sie die Umgebungsvariable `BLENDER_PATH` bzw. `BLENDER_EXECUTABLE`.
- Redis lässt sich am einfachsten über Docker Desktop bereitstellen: `docker run --name redis -p 6379:6379 -d redis:alpine`.

**Launcher & Ablauf:**

- Verwenden Sie `start-all.cmd` (Doppelklick) oder `node scripts/start-all.mjs`, um API-Gateway, MCP-Server und Frontend gemeinsam zu starten.
- Der Launcher legt das Ausgabe-Verzeichnis automatisch an und setzt `BLENDER_OUTPUT_DIR`. Liegt dieses Verzeichnis in OneDrive, versucht das System Platzhalterdateien automatisch herunterzuladen, bevor sie ausgeliefert werden.

## 🚀 Schnellstart

### 1. Repository klonen oder herunterladen

```bash
git clone <repository-url>
cd blender-mcp-converter
```

### 2. Automatische Einrichtung und Start

```bash
# macOS / Linux
./start.sh

# Windows (PowerShell oder Eingabeaufforderung)
node scripts/start-all.mjs
# oder per Doppelklick auf start-all.cmd
```

Das Skript führt automatisch folgende Schritte aus:
- ✅ Überprüfung der Systemanforderungen
- 📦 Installation der Node.js und Python Dependencies
- ⚙️ Erstellung der Konfigurationsdateien
- 🚀 Start aller Services

### 3. Services sind bereit!

Nach dem erfolgreichen Start sind folgende Services verfügbar:
- **API Gateway**: http://localhost:3000
- **MCP Server**: http://localhost:8001

## 📖 Manuelle Installation

Falls Sie die Services einzeln konfigurieren möchten:

### Node.js API Gateway einrichten

```bash
cd api-gateway
cp .env.example .env
npm install
npm start
```

### Python MCP Server einrichten

```bash
cd mcp-server
cp .env.example .env
python3 -m venv venv
source venv/bin/activate  # Linux/macOS
# oder: venv\\Scripts\\activate  # Windows
pip install -r requirements.txt
python main.py
```

### Redis starten (optional)

```bash
# macOS
brew services start redis

# Linux
sudo systemctl start redis
# oder
redis-server

# Windows / Cross-Plattform (Docker Desktop)
docker run --name redis -p 6379:6379 -d redis:alpine
```

## 🔌 API Nutzung

### 1. Dateien hochladen und konvertieren

```bash
curl -X POST http://localhost:3000/api/v1/convert \
  -F "file=@model.obj" \
  -F "file=@model.mtl" \
  -F "file=@texture_diffuse.jpg" \
  -F "file=@texture_normal.png" \
  -F "embedTextures=true" \
  -F "useAI=false" \
  -F "outputFormat=glb"
```

**Response:**
```json
{
  "message": "Conversion job started",
  "jobId": "uuid-job-id",
  "status": "queued",
  "estimatedTime": "2-5 minutes",
  "statusUrl": "/api/v1/status/uuid-job-id",
  "downloadUrl": "/api/v1/download/uuid-job-id"
}
```

### 2. Job-Status abfragen

```bash
curl http://localhost:3000/api/v1/status/{jobId}
```

**Response:**
```json
{
  "jobId": "uuid-job-id",
  "status": "processing",
  "progress": 75,
  "createdAt": "2024-11-07T10:00:00Z",
  "logs": [
    {
      "timestamp": "2024-11-07T10:00:30Z",
      "level": "INFO",
      "message": "Importing OBJ file: model.obj"
    }
  ],
  "downloadUrl": null
}
```

**Mögliche Status-Werte:**
- `queued` - Job wurde zur Warteschlange hinzugefügt
- `processing` - Konvertierung läuft
- `completed` - Fertig, Download verfügbar
- `failed` - Fehler aufgetreten

### 3. Konvertierte Datei herunterladen

```bash
curl -O http://localhost:3000/api/v1/download/{jobId}
```

### 4. KI-Automation Rezept ausführen

```bash
curl -X POST http://localhost:3000/api/v1/automation/run \
  -H "Content-Type: application/json" \
  -d '{
        "blendFile": "/absolute/path/to/scene.blend",
        "jobId": "automation-demo-01",
        "recipe": {
          "actions": [
            { "type": "select_camera", "camera": "Camera" },
            { "type": "render", "filename": "hero.png" }
          ]
        },
        "options": {
          "dryRun": false,
          "outputRoot": "/tmp/outputs/renders"
        }
      }'
```

**Response:**
```json
{
  "message": "Automation job queued",
  "jobId": "automation-demo-01",
  "status": "queued",
  "statusUrl": "/api/v1/automation/status/automation-demo-01",
  "resultUrl": "/api/v1/automation/status/automation-demo-01"
}
```

### 5. Automation-Status abfragen

```bash
curl http://localhost:3000/api/v1/automation/status/{jobId}
```

**Response (gekürzt):**
```json
{
  "jobId": "automation-demo-01",
  "status": "completed",
  "outputs": [
    {
      "type": "render",
      "actionIndex": 1,
      "path": "/absolute/path/to/outputs/renders/automation-demo-01/hero.png"
    }
  ],
  "logs": [
    { "timestamp": "2024-11-07T10:15:00Z", "level": "INFO", "message": "Rendered still to ..." }
  ]
}
```

### 6. Automation-Render herunterladen

```bash
curl -L "http://localhost:3000/api/v1/automation/download/{jobId}?index=0" -o hero.png
```

- `index` (optional): Wählt das n-te Output-Asset aus (Default: `0`).
- Response liefert das Original-Image (PNG/JPEG/TIFF/EXR etc.).

## 📝 Detaillierte API-Referenz

### POST /api/v1/convert

Lädt Dateien hoch und startet den Konvertierungsprozess.

**Parameter:**
- `file` (FormData, mehrere Dateien): .obj, .mtl, Texturdateien
- `embedTextures` (boolean, optional): Texturen in GLB einbetten (Standard: true)
- `useAI` (boolean, optional): KI-basierte Materialerkennung (Standard: false)
- `outputFormat` (string, optional): "glb" oder "gltf" (Standard: "glb")
- `scale` (number, optional): Skalierungsfaktor (z.B. 0.01 für 1% des ursprünglichen Maßstabs, Standard: 1.0)
- `decimateRatio` (number, optional): Mesh-Vereinfachung (0.1–1.0; 1.0 = keine Reduktion, Standard: 1.0)
- `autoLabelParts` (boolean, optional): Heuristische Bauteil-Benennung (Pfosten/Strebe/Fuß/Kappe), Standard: false
- `useGTINNaming` (boolean, optional): Aktiviert die CSV-/XLSX-basierte Namensauflösung (Standard: false)
- `gtin` (string, optional): 8–14-stellige GTIN/EAN für den Lookup im Namensschema (z.B. `4000001234567`)
- `articleNumber` (string, optional): Artikelnummer für den Lookup; gemeinsam mit `gtin` entsteht `GTIN_Artikelnummer_<Suffix>.glb`

**Unterstützte Dateiformate:**
- **3D-Modelle**: .obj, .mtl
- **Texturen**: .jpg, .jpeg, .png, .tiff, .tga, .bmp

### GET /api/v1/status/:jobId

Ruft den aktuellen Status eines Konvertierungsjobs ab.

### GET /api/v1/download/:jobId

Lädt die konvertierte .glb/.gltf Datei herunter.

### DELETE /api/v1/jobs/:jobId

Bereinigt Job-Dateien und -Daten.

## 🧠 KI-basierte Materialerkennung

Das System enthält ein erweiterbares KI-Modul für die automatische Materialerkennung:

```python
# ai_material.py - Beispiel für zukünftige CLIP-Integration
recognizer = AIMateriaTeleRecognizer()
material_props = recognizer.analyze_material("texture.jpg")

# Rückgabe:
{
  "roughness": 0.1,
  "metallic": 1.0,
  "specular": 1.0,
  "base_color": [0.7, 0.7, 0.7],
  "detected_type": "metal",
  "confidence": 0.85
}
```

**Geplante Features:**
- CLIP-basierte Bildklassifizierung
- Automatische PBR-Parameter-Schätzung
- Trainingsunterstützung für eigene Materialien

## 🔧 Konfiguration

### API Gateway (.env)

```bash
NODE_ENV=development
PORT=3000
REDIS_HOST=localhost
REDIS_PORT=6379
MCP_SERVER_URL=http://localhost:8001
WORKER_CONCURRENCY=2
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001
LOG_LEVEL=info
# Gemeinsames Ausgabeverzeichnis (wird automatisch erstellt, Standard: ../outputs relativ zum MCP-Server)
BLENDER_OUTPUT_DIR=/absolute/path/zum/projekt/outputs
```

### Frontend (.env)

```bash
# Basis-URL ohne abschließenden Slash; Standard ist http(s)://<host>:3000
VITE_API_BASE_URL=http://localhost:3000
# Optional: explicit router für statische Ausgaben (Default: ${VITE_API_BASE_URL}/outputs)
VITE_OUTPUTS_BASE_URL=http://localhost:3000/outputs
```

### MCP Server (.env)

```bash
HOST=localhost
PORT=8001
BLENDER_EXECUTABLE=blender
BLENDER_TIMEOUT=300
LOG_LEVEL=INFO
```

#### GTIN-/Artikelnummer-Namensschema

- `GTIN_ENABLED=true` aktiviert die CSV-/XLSX-basierte Dateinamenauflösung.
- `GTIN_DATABASE_PATH=/pfad/zur/gtin_map.csv` zeigt auf die Mapping-Datei mit GTIN, Artikelnummer und optionaler RAL-/Oberflächen-Spalte.
- `GTIN_COLUMN_NAME=GTIN`, `ARTICLE_NUMBER_COLUMN=Artikelnummer`, `COLOR_CODE_COLUMN=RAL`, `FINISH_SUFFIX_COLUMN=Finish` steuern, wie die Spalten heißen.
- `GTIN_DEFAULT_SUFFIX=vzk` definiert den Standardzusatz – Dateinamen werden nach dem Muster `GTIN_Artikelnummer_vzk.glb` erzeugt, sofern keine farbspezifische RAL-Spalte gesetzt ist.
- Enthält die Zeile einen RAL-Code, wird stattdessen `RALXXXX.glb` erzeugt.
- `GTIN_DEFAULT_EXTENSION=.glb` überschreibt bei Bedarf die Standard-Endung.

> Tipp: Die CSV darf beliebig viele Spalten enthalten; nur die konfigurierten Spalten werden eingelesen. Änderungen an der Datei können zur Laufzeit über `/gtin/filename` und `/gtin/search` verifiziert werden.

## 🏷️ Bauteil-Labeling (Pfosten/Strebe/Fuß/Kappe)

Wenn die Option `autoLabelParts` aktiviert ist (Frontend-Checkbox oder API-Flag), werden Bauteile heuristisch benannt. Die Heuristiken kombinieren Geometrie-Merkmale und optional Farb-/Materialhinweise.

### Aktivierung

- Frontend: Checkbox „Auto-Label Teile“ aktivieren
- API: `autoLabelParts=true`

### Steuernde Umgebungsvariablen

```bash
# Material-/Farbheuristik
export LABEL_USE_MATERIAL=1                 # Materialfarben in Heuristik nutzen (Default 1)
export LABEL_COLOR_DIFF_THRESHOLD=0.18      # Farbdifferenz-Schwelle (0..√3), ab der sich Teile vom Pfosten unterscheiden

# Metrik-Export (JSON) für Auswertung
export LABEL_EXPORT_JSON=1                  # schreibt <output>-labels.json neben die GLB
export LABEL_DEBUG=1                        # zusätzliche Debug-Logs pro Objekt und ebenfalls JSON-Export

# Feinjustierung Fuß-Erkennung (direkt unter dem Pfosten)
export LABEL_FUSS_MAX_SCENE_RATIO=0.35      # maximale relative Höhe eines Fußes (bezogen auf Szenenhöhe)
export LABEL_FUSS_BASE_MAX_RATIO=0.06       # wie nah am Boden der Fuß beginnen muss
export LABEL_FUSS_XY_MARGIN=0.15            # XY-Marge relativ zur Pfosten-Footprint-Größe für Überlappprüfung
export LABEL_FUSS_CENTER_DIST_RATIO=0.6     # erlaubte Distanz zum Pfosten-Zentrum (Fallback ohne Overlap)
export LABEL_FUSS_TOP_MAX_RATIO=0.14        # maximale Oberkante des Fußes relativ zur Szenenhöhe
```

```bash
# Feinjustierung Kappe-Erkennung (nur am oberen Pfostenende)
export LABEL_KAPPE_MAX_SCENE_RATIO=0.25     # maximale relative Höhe einer Kappe
export LABEL_KAPPE_TOP_MAX_RATIO=0.08       # wie nah am globalen Top die Kappe sein muss
export LABEL_KAPPE_XY_MARGIN=0.20           # XY-Marge relativ zur Pfosten-Footprint-Größe für Überlappprüfung
export LABEL_KAPPE_Z_PENETRATION=0.02       # Mindest-Penetration in Z in den Pfosten (Anteil an Szenenhöhe)
export LABEL_KAPPE_MAX_ASPECT=2.0           # max. Schlankheitsverhältnis, um lange Streben auszuschließen
export LABEL_KAPPE_MAX_HORIZ_MULT=1.6       # max. horizontale Ausdehnung relativ zum Pfosten-Footprint
export LABEL_KAPPE_CENTER_DIST_RATIO=0.8    # Nähe zum Pfosten-Zentrum erforderlich (rel. zu Footprint + Objektbreite)

# Feinjustierung Strebe-Erkennung (zwischen Pfosten)
export LABEL_STREBE_ASPECT_LONG=3.8         # Mindest-Längs/Schlankheits-Verhältnis
export LABEL_STREBE_CENTER_MIN=0.04         # minimaler Zentrumshöhenanteil
export LABEL_STREBE_CENTER_MAX=0.96         # maximaler Zentrumshöhenanteil
export LABEL_STREBE_BETWEEN_MARGIN=0.2      # Marge relativ zum Pfostenabstand für XY-Union
export LABEL_STREBE_MAX_DEPTH_RATIO=0.95    # Streben-Dicke darf diesen Anteil der Pfosten-Dicke nicht überschreiten
```

### Erkennungslogik (Kurzfassung)

- Pfosten: deutlich höher als breit, Fußpunkt nahe Boden
- Kappe: kleines Teil in Pfostennähe, sehr nah am oberen Ende oder klar andere Farbe
- Fuß: kleines Teil in Pfostennähe, sehr nah am Boden UND direkter XY-Überlapp mit dem Pfosten (mit einstellbarer Marge)
- Strebe: lang und schlankes Teil im mittleren Höhenbereich, nicht z-dominant wie ein Pfosten

Tipp: Für eine datenbasierte Feinjustierung `LABEL_EXPORT_JSON=1` setzen. Neben der GLB entsteht dann eine `*-labels.json` mit Geometrie- und Farbmetriken pro erkanntem Teil.


## 🐳 Docker-Deployment

```bash
# Docker Compose für vollständiges System
docker-compose up -d
```

**docker-compose.yml:**
```yaml
version: '3.8'
services:
  redis:
    image: redis:alpine
    ports:
      - "6379:6379"
  
  mcp-server:
    build: ./mcp-server
    ports:
      - "8001:8001"
    depends_on:
      - redis
  
  api-gateway:
    build: ./api-gateway
    ports:
      - "3000:3000"
    depends_on:
      - mcp-server
      - redis
```

## 🧪 Tests ausführen

```bash
# API Gateway Tests
cd api-gateway
npm test

# MCP Server Tests
cd mcp-server
source venv/bin/activate
pytest tests/

# Blender Script Tests
cd blender-scripts
python ai_material.py  # Führt Beispieltests aus
```

## 📊 Performance & Monitoring

### Typical Performance Metrics

| Modell-Größe | Texturen | Verarbeitungszeit | Ausgabegröße |
|--------------|----------|-------------------|--------------|
| Klein (< 10MB) | 1-3 | 30-60 Sekunden | 5-15MB |
| Medium (10-50MB) | 4-8 | 1-3 Minuten | 15-40MB |
| Groß (> 50MB) | 8+ | 3-7 Minuten | 40MB+ |

### Health Checks

```bash
# Gesundheitsprüfung aller Services
curl http://localhost:3000/health  # API Gateway
curl http://localhost:8001/health  # MCP Server

### Cleanup- & Start-Konfiguration

Der API Gateway besitzt einen automatischen Aufräum-Job, der alte Uploads/Outputs entfernt. Zusätzlich prüft das Startskript freien Speicher & Basis-Abhängigkeiten bevor Dienste gestartet werden.

Umgebungsvariablen (Defaults in Klammern):

```
CLEANUP_MAX_TOTAL_MB=1000        # Max. Gesamtgröße der Uploads (1000)
CLEANUP_MAX_AGE_HOURS=48         # Ordner älter als X Stunden werden gelöscht (48)
CLEANUP_INTERVAL_MINUTES=30      # Ausführungsintervall des Cleanups in Minuten (30)
MIN_FREE_DISK_MB=512             # Mindest-freier Speicher für Startskript (Default 512)
```

Der Scheduler startet beim Serverstart (siehe `api-gateway/src/server.js`) und wird bei SIGINT/SIGTERM sauber gestoppt.

### Startskript und Logs

Mit `./start-services.sh` werden API, MCP und Frontend gestartet. Ports werden freigeräumt, Preflight Checks (Speicher/Abhängigkeiten) durchgeführt, Logs angelegt und Health-Checks mit Retry ausgeführt.

Logs:
- API Gateway (Winston): `api-gateway/logs/combined.log`, Fehler: `api-gateway/logs/error.log`
- API Gateway Prozess-stdout: `api-gateway/logs/api-gateway.log`
- MCP Server: `mcp-server/logs/mcp-server.log`
- Frontend (Vite): `frontend/logs/frontend.log`
```

## 🤖 KI Automation

Mit dem Automations-Runner kannst du Kameras, Lichtsetups und Renderings per JSON-Rezept steuern – ideal für wiederholbare Produkt-Shoots oder KI-generierte Workflows.

- Direkt-Endpoint: `POST http://localhost:8001/automation/run`
- MCP Tool: `POST /mcp/call` mit Payload `{ "method": "blender-automation", ... }`
- Standard-Ausgabe: `outputs/renders/<jobId>/`
- Ergebnis enthält neben Render-Dateien auch `logs[]` und `outputs[]` Einträge (siehe `=== AUTOMATION_RESULT ===` in der Blender-Konsole).

**Schema & Beispiele** sind in `docs/kiautomation.md` dokumentiert. Unterstützte Actions: `select_camera`, `set_light_power`, `set_light_color`, `set_light_temperature`, `set_world_strength`, `render` (inkl. optionaler Render-Parameter) sowie freie `log`-Einträge.

## 🔍 Troubleshooting

### Häufige Probleme

**1. Blender nicht im PATH gefunden**
```bash
# macOS
echo 'export PATH="/Applications/Blender.app/Contents/MacOS:$PATH"' >> ~/.zshrc
source ~/.zshrc

# Linux - Blender aus Snap
export PATH="/snap/bin:$PATH"
```

**2. Redis-Verbindungsfehler**
```bash
# Redis installieren und starten
brew install redis  # macOS
brew services start redis

sudo apt install redis-server  # Ubuntu
sudo systemctl start redis
```

**3. Port bereits belegt**
```bash
# Prüfen welcher Prozess den Port nutzt
lsof -i :3000  # API Gateway
lsof -i :8001  # MCP Server

# Prozess beenden
kill -9 <PID>
```

**4. Texturen werden nicht geladen**
- Überprüfen Sie, dass Texturdateien im gleichen Upload enthalten sind
- Verwenden Sie konsistente Dateinamen (z.B. `model_diffuse.jpg`)
- Unterstützte Formate: JPG, PNG, TIFF, TGA, BMP

### Log-Dateien

```bash
# API Gateway Logs
tail -f api-gateway/logs/combined.log

# MCP Server Logs
tail -f mcp-server/logs/mcp_server.log

# Blender Conversion Logs
# In den Job-Status-Response enthalten
```

## 🤝 Entwicklung & Erweiterung

### Neue Materialtypen hinzufügen

```python
# blender-scripts/ai_material.py erweitern
material_database = {
    "your_material": {
        "roughness": 0.4,
        "metallic": 0.2,
        "specular": 0.8,
        "base_color": [0.8, 0.6, 0.4],
        "keywords": ["custom", "special"]
    }
}
```

### Custom MCP Tools

```python
# mcp-server/main.py - neue Tools hinzufügen
@app.post("/mcp/call")
async def call_mcp_tool(request: MCPRequest):
    if request.method == "your-new-tool":
        return await your_tool_handler(request.params)
```

### API Endpoints erweitern

```javascript
// api-gateway/src/routes/ - neue Routen
router.post('/custom-convert', async (req, res) => {
    // Ihre custom Logik
});
```

## 📚 Weiterführende Ressourcen

- [Blender Python API](https://docs.blender.org/api/current/)
- [Model Context Protocol Specification](https://spec.modelcontextprotocol.io/)
- [glTF/GLB Format Documentation](https://www.khronos.org/gltf/)
- [PBR Material Guide](https://learnopengl.com/PBR/Theory)

## 📄 Lizenz

MIT License - siehe [LICENSE](LICENSE) für Details.

## 🙋‍♂️ Support

Für Fragen und Support:
1. Überprüfen Sie zuerst die [Troubleshooting](#-troubleshooting) Sektion
2. Schauen Sie in die Log-Dateien für detaillierte Fehlermeldungen
3. Erstellen Sie ein Issue mit Systeminformationen und Logs

---

**Blender MCP Converter** - Automatisierte 3D-Model-Konvertierung mit KI-unterstützter Materialerkennung