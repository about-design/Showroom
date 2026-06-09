# MTL-Farben extrahieren (Colormatching)

Kleines Standalone-Tool: liest OBJ/MTL-Dateien und gibt alle vorkommenden Farben aus – für Colormatching (z.B. in Design-Tools oder Paletten). **Gleiche Farben (gleicher Hex) werden zusammengefasst** und bekommen eine feste **colorId**; das Mapping (Material → Slot → colorId) vereinfacht die Integration in euer Colormatching-Tool. **Reihenfolge ist deterministisch:** MTL-Pfade alphabetisch, Palette nach **Hex sortiert** (stabile IDs bei gleicher Farbmenge).

## Nutzung

```bash
# Einzelne MTL-Datei
node tools/extract-mtl-colors.js pfad/zur/datei.mtl

# OBJ-Datei (sucht automatisch die zugehörige MTL via mtllib)
node tools/extract-mtl-colors.js pfad/zur/datei.obj

# Ganzer Ordner (alle .mtl und über OBJ referenzierten MTLs)
node tools/extract-mtl-colors.js pfad/zum/ordner

# Ausgabeformate
node tools/extract-mtl-colors.js ./modelle --format list   # lesbar (Standard)
node tools/extract-mtl-colors.js ./modelle --format hex    # nur Hex-Codes, eine pro Zeile
node tools/extract-mtl-colors.js ./modelle --format json   # vollständiges JSON
```

## Ausgabe

- **list**: Palette mit IDs `[1]`, `[2]`, … (zusammengefasst), plus Mapping Material → Slot → colorId und Detail pro Material.
- **hex**: Nur Hex-Codes der zusammengefassten Farben, eine pro Zeile.
- **json**: Für euer Tool:
  - **palette**: `{ id, hex, r, g, b, sources[] }` – eine Zeile pro eindeutiger Farbe.
  - **materials**: pro Material `material`, `file`, **mapping** `{ ambient?, diffuse?, specular?, emissive? }` → **colorId**, plus `colors[]` mit `type`, `colorId`, `hex`.
  - **hexToId**: `{ "#hex": id }` für schnelles Nachschlagen.

Euer Tool kann damit: Palette einmal durchgehen (Colormatching pro `id`), dann über `materials[].mapping` wissen, welche colorId pro Material und Slot (z.B. diffuse) gilt.

Es werden alle MTL-Farbtypen ausgewertet: **Ka** (ambient), **Kd** (diffuse), **Ks** (specular), **Ke** (emissive).

---

## Frontend: Colormatching & JSON speichern

`tools/mtl-color-matching.html` – OBJ/MTL auswählen, JSON wird gebaut, Farben zuordnen, Matching speichern.

1. **Daten laden** (eine der Optionen):
   - **OBJ/MTL-Dateien**: Tab „OBJ/MTL-Dateien“ – mehrere .obj- und .mtl-Dateien auswählen oder ablegen. Die JSON (Palette + Materials) wird im Browser daraus gebaut; bei OBJ wird die referenzierte MTL (mtllib) automatisch mitverwendet, sofern sie in den ausgewählten Dateien ist.
   - **JSON**: Tab „JSON einfügen“ – bestehende JSON-Datei laden oder Text einfügen (z.B. Ausgabe von `extract-mtl-colors.js --format json`).
2. **Matching**: RAL-Palette optional laden (z. B. `src/data/ralColors.json`) → **„Alle auf nächsten RAL mappen“** setzt jede MTL-Farbe auf die ähnlichste RAL-Farbe. Anschließend pro Zeile anpassbar (Farbwähler/Hex). Wenn die Ersatzfarbe einer RAL-Farbe entspricht, wird der RAL-Name angezeigt.
3. **Speichern**: „Als JSON-Datei herunterladen“ oder „In Zwischenablage kopieren“. Die gespeicherte JSON enthält:
   - `sourcePalette`, `materials`, `hexToId` (Original-Daten)
   - `matches`: `{ "1": "#hex", ... }` (colorId → Ersatzfarbe)
   - `matchPalette`: `[ { id, originalHex, matchHex, r, g, b }, ... ]` für eure Pipeline  
   - `matchRal`: `{ "1": "RAL 7035", "2": "RAL 9010", ... }` (colorId → RAL), sofern RAL-Palette geladen und zugeordnet wurde

Öffnen: `npm run mtl:matching` oder `open tools/mtl-color-matching.html`
