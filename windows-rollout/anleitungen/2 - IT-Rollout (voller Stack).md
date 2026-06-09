# META Showroom – IT-Rollout (Windows, voller Stack)

Anleitung für die IT-Abteilung: Installation auf Büro-Rechnern **ohne dauerhafte Admin-Rechte** für Anwender. Die IT installiert einmalig mit Administrator; danach starten Anwender über Desktop-Verknüpfung.

---

## Übersicht

| Komponente | Zweck | Port |
|------------|-------|------|
| Vite Preview (Showroom UI) | Showroom, Dashboard, Konverter | 5050 |
| API-Gateway (Node.js) | Konvertierungs-API | 3000 |
| MCP-Server (Python) | Blender-Orchestrierung | 8001 |
| Memurai (Redis) | Job-Queue | 6379 |
| Blender 4.x | CAD → GLB Konvertierung | – |

**Installationspfad (empfohlen):** `C:\meta\showroom\` (keine Leerzeichen)

**User-Daten (beschreibbar ohne Admin):** `%LOCALAPPDATA%\meta-showroom\` (logs, outputs)

---

## Lieferumfang vom Showroom-Team

1. **`meta-showroom-1.0.0-win-x64.zip`** – Anwendungspaket (gebaut mit `npm run package:win`)
2. **Drittsoftware-Installer** (Versionen pinnen, auf IT-Share ablegen):
   - Node.js 20.11+ LTS x64
   - Python 3.10+ oder 3.11+ x64
   - Blender 4.2 LTS x64
   - Memurai Developer Edition
3. Diese Datei: **`docs/windows-it-rollout.md`**

---

## Schritt 1: Drittsoftware (silent, als Administrator)

### Node.js

```powershell
msiexec /i node-v20.11.1-x64.msi /qn /norestart
```

### Python

```powershell
python-3.11.9-amd64.exe /quiet InstallAllUsers=1 PrependPath=1 Include_test=0
```

Nach Installation **neue PowerShell** öffnen und prüfen:

```powershell
node -v    # v20.11.x oder höher
python --version   # Python 3.10+
```

### Blender 4.2 LTS

```powershell
msiexec /i blender-4.2.0-windows-x64.msi /qn /norestart
```

Standardpfad: `C:\Program Files\Blender Foundation\Blender 4.2\blender.exe`

### Memurai (Redis-Ersatz für Windows)

Memurai Developer Edition von https://www.memurai.com/ installieren (MSI, als Dienst).

Nach Installation:

```powershell
Get-Service Memurai
# Status sollte Running sein; StartType: Automatic
```

**Start-Recht für Anwender** (damit `start-showroom.cmd` Memurai ohne Admin starten kann):

```powershell
# Als Administrator – interaktive User (IU) dürfen Dienst starten/stoppen
sc.exe sdset Memurai "D:(A;;CCLCSWRPWPDTLOCRRC;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;RPWPCR;;;IU)(A;;RPWPCR;;;SU)(A;;CCLCSWRPWP;;;AU)"
```

---

## Schritt 2: Anwendungspaket entpacken

```powershell
New-Item -ItemType Directory -Path "C:\meta\showroom" -Force
Expand-Archive -Path "\\server\share\meta-showroom-1.0.0-win-x64.zip" -DestinationPath "C:\meta\showroom" -Force
```

Falls ZIP einen Unterordner enthält, Inhalt nach `C:\meta\showroom` verschieben (dort müssen `package.json`, `start-showroom.cmd`, `dist\` liegen).

---

## Schritt 3: IT-Installationsscript

PowerShell **als Administrator** im Projektroot:

```powershell
cd C:\meta\showroom
powershell -ExecutionPolicy Bypass -File install-windows.ps1 -Unattended
```

Das Script:
- prüft Node.js, Python, Memurai, Blender
- erstellt MCP Python-venv und installiert Abhängigkeiten
- setzt `BLENDER_PATH`, `BLENDER_OUTPUT_DIR`, `LOG_DIR` (User-Umgebung)
- legt Desktop- und Startmenü-Verknüpfungen an
- führt Pre-Flight-Checks aus

**Falls `blender-exporter` fehlt** (nicht im ZIP):

```powershell
powershell -ExecutionPolicy Bypass -File install-windows.ps1 -Unattended -BlenderConverterPath "D:\Pfad\zum\GLB export Blender"
```

---

## Schritt 4: Antivirus-Ausnahmen

Ersten Start ohne Ausnahme kann **5–15 Minuten** dauern (Defender scannt `node_modules`).

Empfohlene Ausnahmen (je nach AV-Produkt):

| Pfad / Prozess | Grund |
|----------------|-------|
| `C:\meta\showroom\` | Node/Python-Module |
| `blender.exe` | Headless-Konvertierung |
| `%LOCALAPPDATA%\meta-showroom\` | Logs, Konvertierungs-Outputs |

---

## Schritt 5: Smoke-Test (als normaler Büro-User, ohne Admin)

1. Desktop-Verknüpfung **„META Showroom"** doppelklicken
2. Browser öffnet `http://localhost:5050/` – 3D-Showroom sichtbar
3. `http://localhost:5050/dashboard.html` – Dashboard lädt
4. `http://localhost:5050/converter.html` – Konverter zeigt „API erreichbar" (grün)
5. Kleine OBJ+MTL-Datei hochladen und konvertieren
6. GLB erscheint unter `%LOCALAPPDATA%\meta-showroom\outputs\`
7. **„META Showroom stoppen"** – Ports 3000, 5050, 8001 frei

### Pre-Flight manuell

```powershell
cd C:\meta\showroom
node scripts\start-services.mjs
```

Alle Zeilen müssen grün/OK sein.

---

## Tägliche Nutzung (Anwender)

| Aktion | Wie |
|--------|-----|
| Starten | Desktop: **META Showroom** |
| Beenden | Desktop: **META Showroom stoppen** |
| Logs | `%LOCALAPPDATA%\meta-showroom\logs\` |
| Konvertierte Dateien | `%LOCALAPPDATA%\meta-showroom\outputs\` |

**Hinweis:** Browser schließen beendet den Stack **nicht** – dafür „META Showroom stoppen" verwenden.

---

## Update (neue Version)

1. Anwender: **META Showroom stoppen**
2. IT: ZIP-Inhalt über `C:\meta\showroom` legen (oder nur `dist\`, `scripts\`, `node_modules\` ersetzen)
3. IT:

```powershell
cd C:\meta\showroom
powershell -ExecutionPolicy Bypass -File install-windows.ps1 -Update -Unattended
```

User-Daten in `%LOCALAPPDATA%\meta-showroom\` bleiben erhalten.

---

## Deinstallation

1. **META Showroom stoppen**
2. Desktop-/Startmenü-Verknüpfungen löschen
3. Ordner `C:\meta\showroom` entfernen
4. Optional: `%LOCALAPPDATA%\meta-showroom` löschen
5. Drittsoftware (Node, Python, Blender, Memurai) nach Firmenrichtlinie deinstallieren

---

## Troubleshooting

### „Port 5050/3000/8001 bereits belegt"

Andere Anwendung oder alter Showroom-Prozess. **META Showroom stoppen** oder Rechner neu starten.

### „Redis nicht erreichbar"

```powershell
Get-Service Memurai
Start-Service Memurai
```

Falls Start fehlgeschlagen: IT prüft Memurai-Installation und `sc sdset` (Schritt 1).

### „Blender conversion failed"

- `BLENDER_PATH` prüfen: Systemsteuerung → Umgebungsvariablen
- Blender 4.x installiert?
- Logs: `%LOCALAPPDATA%\meta-showroom\logs\` und Konsole des minimierten CMD-Fensters

### „Pre-Flight: Blender Converter not found"

`blender-exporter\blender-mcp-converter\` fehlt im Paket. IT-Installation mit `-BlenderConverterPath` wiederholen oder vollständiges ZIP liefern.

### PowerShell blockiert Scripts

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

---

## Checkliste für IT (pro Rechner)

- [ ] Node.js 20.11+ installiert
- [ ] Python 3.10+ installiert (`Add to PATH`)
- [ ] Blender 4.x installiert
- [ ] Memurai installiert und Dienst läuft
- [ ] Memurai Start-Recht für User gesetzt
- [ ] ZIP nach `C:\meta\showroom` entpackt
- [ ] `install-windows.ps1 -Unattended` erfolgreich
- [ ] AV-Ausnahme gesetzt
- [ ] Smoke-Test als normaler User bestanden
- [ ] Desktop-Verknüpfungen vorhanden

---

## Referenzen

- Entwickler-Setup: [README-windows.md](../README-windows.md)
- Bedienung für Anwender: [bedienungsanleitung-kollegen.md](bedienungsanleitung-kollegen.md)
- Paket bauen: `npm run package:win` (auf Windows-Referenzrechner)
