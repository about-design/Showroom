# META Showroom – Setup unter Windows

Anleitung, um das Showroom-Projekt inklusive Blender-Converter, MCP-Server und Redis unter Windows zum Laufen zu bringen.

**Für IT-Rollout auf Büro-Rechnern (ohne Admin für Anwender):** siehe [docs/windows-it-rollout.md](docs/windows-it-rollout.md)

---

## Windows-Installer (installierbare Desktop-Version)

Du kannst eine **installierbare Windows-Version** des Showrooms bauen. Nach der Installation startet die App wie eine normale Desktop-Anwendung (ohne Node.js auf dem Zielrechner).

### Installer bauen (auf einem Rechner mit Node.js)

Am besten auf **Windows** ausführen (dann entfallen Cross-Build-Downloads):

```powershell
npm install
npm run dist:win
```

Die fertigen Dateien liegen in `release/`:

- **META Showroom Setup 1.0.0.exe** – NSIS-Installer (empfohlen zum Verteilen)
- Optional: portable Version in `release/win-unpacked/`

### Installer installieren

1. `META Showroom Setup 1.0.0.exe` ausführen.
2. Installationspfad wählen (oder Standard übernehmen).
3. Installation abschließen – die App erscheint im Startmenü und auf dem Desktop.

### Hinweis zur installierten Version

Die **installierte Desktop-Version** enthält den **3D Showroom** (Produktansicht) inkl. der zum Build-Zeitpunkt in `src/data/products.json` hinterlegten Produkte. **Dashboard** und **Konverter** (Produktverwaltung, CAD-Konvertierung) benötigen die laufenden Dienste (API, Redis, Blender). Für die volle Funktionalität siehe unten „Schritt-für-Schritt Einrichtung“ und `npm run dev:full`.

---

## Voraussetzungen

| Komponente    | Version    | Download / Installation |
|---------------|------------|---------------------------|
| Node.js       | 20.11+     | https://nodejs.org/       |
| Python        | 3.10+      | https://www.python.org/downloads/ („Add to PATH“ aktivieren) |
| Git           | aktuell    | https://git-scm.com/download/win |
| Docker Desktop| optional   | https://www.docker.com/products/docker-desktop/ (für Redis) |
| Blender       | 4.x        | https://www.blender.org/download/ (für CAD-Konvertierung). Bei nicht standard-Installation: Umgebungsvariable `BLENDER_PATH` auf `blender.exe` setzen. |

---

## Schritt-für-Schritt Einrichtung

### 1. Repository klonen / Projekt öffnen

```powershell
cd "D:\META Apps\showroom"   # oder dein Pfad
```

### 2. Automatisches Setup ausführen

Im Projektroot (als Administrator empfohlen, falls Symlink nötig):

```powershell
.\scripts\setup-windows.ps1
```

Das Script prüft Node.js, Python und optional Docker, fragt nach dem Pfad zum Blender-Converter, erstellt den Symlink, installiert npm- und Python-Abhängigkeiten und startet ggf. Redis per Docker.

### 3. Symlink „blender-exporter“ (manuell, falls nötig)

Der Blender-Converter liegt in einem separaten Ordner (z. B. `D:\META Apps\GLB export Blender`). Das Showroom-Projekt erwartet einen Ordner/Eintrag namens `blender-exporter` im Projektroot.

**Option A: Symbolischer Link (empfohlen)**

- **Developer Mode:** Einstellungen → Update & Sicherheit → Für Entwickler → Developer Mode aktivieren.
- Oder: PowerShell **als Administrator** ausführen.

```powershell
cd "D:\META Apps\showroom"
$target = "D:\META Apps\GLB export Blender"   # dein tatsaechlicher Pfad
New-Item -ItemType SymbolicLink -Path "blender-exporter" -Target $target
```

**Option B: Junction (ohne Admin, nur lokale Laufwerke)**

```powershell
cmd /c mklink /J "blender-exporter" "D:\META Apps\GLB export Blender"
```

Ersetze den Zielpfad durch den Ort deines Blender-Converter-Projekts.

### 4. Redis starten

**Mit Docker Desktop:**

```powershell
docker run -d --name showroom-redis -p 6379:6379 redis:alpine
```

Beim nächsten Mal reicht: Container „showroom-redis“ starten (z. B. über Docker Desktop).

**Ohne Docker:**

- **Memurai** (Redis-kompatibel für Windows): https://www.memurai.com/
- Oder **WSL2** installieren und darin Redis starten: `sudo service redis-server start`

### 5. Entwicklungsumgebung starten

```powershell
npm run dev:full
```

Dabei werden nacheinander geprüft: Blender-Converter-Pfad, Redis, Python, API-Gateway-Deps, MCP-venv. Anschließend starten MCP-Server (Port 8001), API-Gateway (Port 3000) und Vite (Port **5050**).

- Showroom: http://localhost:5050  
- Dashboard: http://localhost:5050/dashboard.html  
- Converter: http://localhost:5050/converter.html  

---

## Troubleshooting

### „Redis nicht erreichbar“

- Mit Docker: `docker ps` prüfen, ob Container `showroom-redis` oder `redis` läuft.
- Ohne Docker: Memurai-Dienst oder Redis in WSL starten und Port 6379 freigeben.

### „Python 3.10+ nicht gefunden“

- Python von python.org installieren und bei der Installation **„Add Python to PATH“** aktivieren.
- Neue PowerShell/CMD öffnen und `python --version` prüfen.

### „Blender Converter not found“

- Symlink/Junction `blender-exporter` prüfen: `Get-Item blender-exporter` (sollte auf dein Converter-Verzeichnis zeigen).
- Pfad im Setup-Script oder bei der manuellen Symlink-Erstellung anpassen.

### „MCP server error: Blender conversion failed with exit code 1“

Die Konvertierung wird vom MCP-Server an Blender übergeben. Exit Code 1 bedeutet, dass Blender mit einem Fehler beendet wurde.

**Typische Ursachen und Prüfungen:**

1. **Blender nicht gefunden oder falsche Version**
   - Blender 4.x installiert? Unter Windows: Standardpfad z. B. `C:\Program Files\Blender Foundation\Blender 4.2\blender.exe`.
   - Wenn Blender woanders liegt: Umgebungsvariable setzen:
     - Windows (PowerShell, Session): `$env:BLENDER_PATH = "C:\Pfad\zu\blender.exe"`
     - Dauerhaft: Systemeigenschaften → Umgebungsvariablen → `BLENDER_PATH` auf die `blender.exe` setzen.
   - `npm run dev:full` bzw. API/MCP in derselben Shell starten, in der `BLENDER_PATH` gesetzt ist.

2. **Blender-Ausgabe im Terminal**
   - Beim Start von `npm run dev:full` laufen API (Port 3000) und MCP (Port 8001). Wenn ein Konvertierungs-Job läuft, gibt der MCP-Server oft die **Blender-Standardausgabe/-fehler** in der Konsole aus. Dort steht der konkrete Python- oder Importfehler (z. B. fehlendes Modul, STEP-Import fehlgeschlagen).

3. **STEP-Dateien**
   - STEP-Import in Blender erfordert eine passende Blender-Version bzw. Add-on. Wenn nur OBJ/MTL konvertiert werden, funktioniert es; bei reinen STEP-Dateien die MCP-/Blender-Logs prüfen („STEP“, „stp“, „import“).

4. **Ausgabeordner**
   - Der Converter schreibt nach `blender-exporter/blender-mcp-converter/outputs` (oder `BLENDER_OUTPUT_DIR`). Ordner muss existieren und beschreibbar sein.

5. **Schnelltest**
   - Im Konverter eine kleine OBJ+MTL-Datei hochladen und konvertieren. Wenn das klappt, liegt das Problem eher am konkreten Dateiformat (z. B. STEP) oder der jeweiligen Datei.

Die genaue Fehlermeldung steht in der Regel in der **Konsole**, in der `npm run dev:full` (bzw. der MCP-Prozess) läuft – dort nach Zeilen mit „Error“, „Traceback“ oder „Blender“ suchen.

### „Symlink fehlgeschlagen“

- PowerShell als Administrator ausführen, oder Developer Mode aktivieren (s. oben).
- Alternativ Junction verwenden (`mklink /J`).

### „npm run dev:full“ bricht mit Fehlercode ab

- Einzelne Schritte manuell ausführen:  
  `node scripts/start-services.mjs` (zeigt, welche Prüfung scheitert), dann ggf. Redis/Python/Symlink beheben.

### Scriptausführung blockiert (Execution Policy)

Falls PowerShell Scripts verweigert:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

---

## Nützliche Befehle

| Befehl              | Beschreibung |
|---------------------|--------------|
| `start-showroom.cmd`| Anwender-Start (IT-Rollout, voller Stack) |
| `stop-showroom.cmd` | Anwender-Stop |
| `update-showroom.cmd` | **Für Git-Checkouts:** stoppt den Stack, holt `git pull`, `npm install`, `npm run build`, startet neu. Ersetzt manuelles Pull+Build. |
| `install-windows.ps1 -Unattended` | IT-Einmalinstallation |
| `npm run package:win` | ZIP-Paket für IT bauen |
| `npm run dev`       | Nur Vite (ohne Converter/MCP) |
| `npm run dev:full`  | Vite + API-Gateway + MCP |
| `npm run start:showroom` | Production-Preview + API + MCP |
| `npm run build`     | Production-Build nach `dist/` |
| `npm run preview`   | Lokale Vorschau des Builds |
| `npm run glb:check` | GLB-Orientierungs-Tool im Browser öffnen |
| `npm run mtl:matching` | MTL-Farb-Matching-Tool im Browser öffnen |

---

## Statischer Build (Deploy)

Für einen rein statischen Deploy (nur Showroom-Frontend, ohne Dashboard-API/Converter):

```powershell
npm run build
```

Oder mit Prüfung und optionalem Upload:

```powershell
npm run deploy
npm run deploy -- --upload=netlify
npm run deploy -- --upload=gh-pages
```

Der Inhalt von `dist/` kann auf einen beliebigen Webserver oder CDN hochgeladen werden. Unterstützte Upload-Ziele in `scripts/deploy.mjs`: `netlify`, `gh-pages`, `rsync` (mit `DEPLOY_RSYNC_DEST`).

---

## Test-Checkliste (Windows)

Nach dem Setup unter Windows empfohlen:

| Test | Befehl / Aktion |
|------|------------------|
| Pre-Flight | `node scripts/start-services.mjs` (alle Checks grün) |
| Dev-Stack | `npm run dev:full` → Vite **5050**, API 3000, MCP 8001 erreichbar |
| Build | `npm run build` → `dist/` mit index/dashboard/converter.html und ralColors.json |
| Preview | `npm run preview` → lokale Vorschau des Builds |
| Tools | `npm run glb:check` und `npm run mtl:matching` öffnen im Browser |
| Deploy | `npm run deploy` → Build + Verifikation von dist/ |
