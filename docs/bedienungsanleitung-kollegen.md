# META Showroom - Bedienungsanleitung fuer Kolleg:innen

Diese Anleitung ist fuer alle, die den Showroom nutzen oder betreuen, aber den technischen Hintergrund noch nicht kennen.

## 1) Was ist was?

- `Showroom`: 3D-Ansicht der Regalsysteme
- `Dashboard`: Verwaltung, Produktuebersicht, Kartenansicht
- `Converter`: Konvertierung von CAD/OBJ/STEP nach GLB

Wichtige URL (lokal):

- Showroom: `http://localhost:5050/`
- Dashboard: `http://localhost:5050/dashboard.html`
- Converter: `http://localhost:5050/converter.html`

Hinweis: Port `3000` und `8001` sind Hintergrunddienste (API/MCP), nicht die eigentliche Showroom-Oberflaeche.

## 2) Schnellstart (Standard)

### Windows (Buero, nach IT-Installation)

1. Desktop-Verknuepfung **„META Showroom"** doppelklicken
2. Browser oeffnet automatisch `http://localhost:5050/`
3. Zum Beenden: **„META Showroom stoppen"** auf dem Desktop

Kein Terminal, kein `npm` noetig – IT hat alles vorbereitet. Details: `docs/windows-it-rollout.md`

### Entwicklung (Mac / Windows mit Node.js)

1. Projektordner oeffnen
2. Abhaengigkeiten installieren:
   - `npm install`
3. Nur Frontend starten (Showroom + Dashboard + Converter UI):
   - `npm run dev`
4. Fuer komplette Konvertierungsfunktion (inkl. API + MCP):
   - `npm run dev:full`

## 3) Wann nutze ich welchen Startbefehl?

- `npm run dev`: Wenn du nur Showroom/Dashboard ansehen oder UI pruefen willst
- `npm run dev:full`: Wenn du wirklich konvertieren willst (Datei-Upload, Conversion-Jobs, API-Prozesse)

## 4) Typischer Arbeitsablauf fuer neue Produkte

1. Dev-Stack mit `npm run dev:full` starten
2. Converter oeffnen (`/converter.html`)
3. Dateien hochladen und Konvertierung starten
4. Ergebnis im Dashboard pruefen
5. Produkt im Showroom oeffnen und Farbe/Ansicht testen

## 5) Vor dem Teilen mit Team/Kunden kurz pruefen

- Showroom laedt ohne Fehler
- Produkt ist sichtbar und korrekt ausgerichtet
- Farbwechsel funktioniert
- Dashboard-Karte wird angezeigt
- Keine offensichtlichen Fehlermeldungen in der Konsole des laufenden Dev-Stacks

## 6) Haeufige Stolpersteine

### "Ich sehe die falsche Seite"

- Wenn du auf Port `3000` bist, bist du im API-Umfeld.
- Fuer den Showroom immer `http://localhost:5050/` verwenden.

### "Konvertierung geht nicht"

- Pruefen, ob `npm run dev:full` laeuft (nicht nur `npm run dev`)
- Blender muss installiert sein (bei Bedarf `BLENDER_PATH` setzen)
- Redis/API/MCP muessen gestartet sein (wird durch `dev:full` vorbereitet)

### "Vorschau-Karte fehlt im Dashboard"

- Nach Konvertierung kann die PNG-Generierung von lokaler Chrome/Chromium-Installation abhaengen.
- Ohne erzeugtes PNG faellt die Ansicht auf WebGL-Vorschau zurueck.

## 7) Nuetzliche Befehle im Alltag

- `npm run check` - Produktionsbuild als schneller Integritaetscheck
- `npm run build` - Build nach `dist/`
- `npm run preview` - lokalen Build testen
- `npm run services:status` - Status der Services pruefen
- `npm run services:logs` - Service-Logs ansehen

## 8) Wer macht was im Projekt?

- Fachbereich/Vertrieb: Inhalte, Produkte, Freigaben
- Showroom-Team: Darstellung, Farben, User Experience
- Technik/Dev: Build, Services, Konverter, Fehleranalyse

Wenn etwas unklar ist, zuerst die URL und den gestarteten Modus (`dev` oder `dev:full`) pruefen. Das loest die meisten Startprobleme.

## 9) Inbetriebnahme-Checkliste (Windows, nach IT-Setup)

Nach der Installation durch die IT einmal kurz pruefen:

| # | Pruefung | Erwartung |
|---|----------|-----------|
| 1 | Desktop-Icon **META Showroom** starten | Browser oeffnet Showroom ohne Fehlermeldung |
| 2 | URL `http://localhost:5050/` | 3D-Showroom sichtbar, Produkte laden |
| 3 | `http://localhost:5050/dashboard.html` | Dashboard-Karten werden angezeigt |
| 4 | `http://localhost:5050/converter.html` | Status „API erreichbar" (gruen) |
| 5 | Kleine OBJ-Datei konvertieren | Job endet mit Erfolg, Download moeglich |
| 6 | **META Showroom stoppen** | Anwendung beendet sich, erneuter Start funktioniert |

Bei Fehlern: IT kontaktieren und `docs/windows-it-rollout.md` (Troubleshooting) nennen.

Logs liegen unter: `%LOCALAPPDATA%\meta-showroom\logs\`

## 10) Tiefergehende Doku

- Hauptuebersicht: `README.md`
- Windows-Setup (Entwickler): `README-windows.md`
- Windows-IT-Rollout: `docs/windows-it-rollout.md`
- GLB-Pipeline: `docs/glb-pipeline.md`
- MTL/Farbmapping: `docs/mtl-mapping.md`
