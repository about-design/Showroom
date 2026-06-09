# MTL→RAL-Projekt-Mapping

Einheitliches Farb-Mapping für Konverter und Massenexport. Eine Datei, eine Quelle.

## Speicherort

- **Datei:** `public/mtl-ral-color-mapping.json`
- Wird vom **Konverter** (converter.html) beim Start geladen.
- Wird von der **Dashboard-Massenkonvertierung** („Alle GLBs neu konvertieren“) vor jeder Konvertierung gelesen.

## Erzeugen und Pflegen

1. **MTL-Colormatching-Tool** öffnen: `/tools/mtl-color-matching.html` (unter Vite-Dev-Server, z. B. `npm run dev` → `http://localhost:5050/tools/mtl-color-matching.html`).
2. **Daten laden:** OBJ/MTL-Dateien ablegen oder JSON einfügen (z. B. Ausgabe von `node tools/extract-mtl-colors.js`). Es reicht **ein** repräsentativer Satz Farben – ein Mapping gilt für alle Konvertierungen.
3. **RAL-Palette:** Wird automatisch aus `src/data/ralColors.json` geladen (unter Dev-Server). Sonst RAL-JSON manuell wählen.
4. **Farben zuordnen:** Pro Quellfarbe RAL auswählen oder „Alle auf nächsten RAL mappen“, bei Bedarf nachjustieren.
5. **„Mapping im Projekt speichern“** klicken → das Mapping wird per API unter **`public/mtl-ral-color-mapping.json`** gespeichert. Konverter und „Alle GLBs neu konvertieren“ nutzen es sofort. (Max. 1 MB; nur das Farb-Mapping, nicht pro Datei.)

**Alternativ:** „Als JSON herunterladen“ und die Datei manuell nach `public/mtl-ral-color-mapping.json` kopieren.

## MTL-Editor im Dashboard (einzelne Datei)

Für **produktbezogene** Anpassungen an einer konkreten `.mtl` (ohne das globale Mapping zu ändern):

1. Im **Produkt-Detail** unter CAD-Dateien bei einer **.mtl** auf **Bearbeiten** (Stift) klicken.
2. Materialnamen (`newmtl`), Farben **Ka / Kd / Ks / Ke** (Farbpicker, Hex, optional RAL-Dropdown), Skalare **Ns, Ni, d, Tr, illum** sowie **Texturpfade** (`map_Kd`, `map_bump`, …) bearbeiten.
3. **Speichern** schreibt die Datei unter dem gleichen Pfad in `public/models/…` zurück.

**Sicherung:** Vor jedem Speichern wird die vorherige Datei als **`<name>.mtl.bak`** überschrieben (nur der **letzte** Stand – kein Versionsverlauf).

**Konvertierung:** Änderungen wirken auf neue GLB-Exports; bestehende GLBs **nicht** automatisch. Produkt anschließend **neu konvertieren** (Button im Detail), damit der Farbvergleich und der Showroom zur MTL passen.

**API (nur Vite-Dev-Server):** `GET /__api/mtl?path=/models/obj/…` liefert geparste JSON-Daten; `POST /__api/mtl` mit `{ path, header, materials }` speichert (gleiche Origin-Regeln wie andere `/__api/*`-Routen).

**OBJ – `mtllib`:** In der CAD-Liste bei **.obj** auf das **Link-Symbol** klicken → Dialog mit der aktuellen `mtllib`-Zeile (Materialbibliothek). Speichern schreibt die OBJ zurück (`.bak` daneben). API: `GET /__api/obj-mtllib?path=…`, `POST` mit `{ path, mtllib: "170830.mtl" }`.

**Große Mapping-Dateien:** Liegt die Datei (z. B. mit vielen `materials`-Einträgen) über **2 MB**, ignoriert der Dashboard-Massenexport sie. Dann eine schlanke Variante erzeugen:

```bash
npm run mtl:slim-mapping
```

(Standard: liest `public/mtl-ral-color-mapping.json`, schreibt dieselbe Datei nur mit `sourcePalette`, `matchRal`, `matchPalette`, `matches`, `overrideExcludeHex`, `nameColorRules`, `geometryColorRules` – sinnvoll bei Bearbeitung einer Kopie mit Ballast.)

## Stammdaten aus MTL (`products.json`)

Die MTL-**Kd**-Werte sind die fachliche Referenz für die Pulver-/Zinkfarbe. Das Skript **`npm run sync:colors`** (siehe [`scripts/sync-colors-from-mtl.mjs`](../scripts/sync-colors-from-mtl.mjs)):

- Liest alle `.mtl`-Pfade aus `cadFiles` je Produkt
- Wertet nur **Kd** aus (Materialien mit **map_Kd** werden übersprungen)
- Ordnet Hex-Werte über die **diffuse**-Einträge in `sourcePalette` + `matchRal` RAL-Codes zu
- Setzt `defaultColor`, `surfaceFinish` (RAL 9007 → `verzinkt`, sonst `pulver`), `defaultColorOverride: true`, sowie `_mtlColors` (Meta)

Option **`--dry-run`**: nur Statistik, keine Änderung an `products.json`.

Nach erfolgreicher Konvertierung schreibt **`POST /__api/register-converted`** fehlende `defaultColor` / `surfaceFinish` aus dem verwendeten Bake-RAL nach, falls noch leer.

Zum **Bearbeiten:** **„Projekt-Mapping laden“** klicken (unter Dev-Server), anpassen, erneut **„Mapping im Projekt speichern“**.

## JSON-Struktur

Die Datei nutzt dieselbe Struktur wie der Export aus dem MTL-Tool:

| Feld | Beschreibung |
|------|--------------|
| `sourcePalette` | Array von `{ id, hex, r?, g?, b?, ... }` – MTL-Quellfarben. |
| `matchRal` | `{ "1": "RAL 7035", ... }` – Zuordnung Quell-ID → RAL-Code. Wird mit `src/data/ralColors.json` zu Hex aufgelöst. |
| `matchPalette` | Array von `{ originalHex, matchHex, r?, g?, b? }` – Fallback ohne RAL-Lookup. |
| `matches` | `{ "1": "#HEX", ... }` – Alternative Zuordnung ID → Ziel-Hex. |
| `overrideExcludeHex` | `["#RRGGBB", ...]` – Quellfarben, die **nicht** überschrieben werden (z. B. von Materialien mit PNG/JPG-Textur in der MTL). Beim Konvertieren zählt dann die Oberfläche aus der MTL. |
| `nameColorRules` | Optional: Regeln nach **Material- oder Node-Namen** (Regex) → Ziel-RAL. Siehe [Namensregeln](#namensregeln-form--mesh). |
| `geometryColorRules` | Optional: Regeln nach **Vertexzahl und/oder Bounding-Box** (pro Primitive) → Ziel-RAL. Siehe [Geometrie-Regeln](#geometrie-regeln). Laufen **vor** dem MTL-Hex-Mapping. |
| `vertexReductionRules` | Optional: Reduziert die Vertexzahl pro Primitive beim Baken (z. B. für hochauflösende Schrauben). Siehe [Vertex-Reduktion](#vertex-reduktion). |
| `materials`, `hexToId` | Optional, für Referenz. |
| `_comment` | Optional. |

**Priorität** beim Auslesen (Konverter und convert-product):

1. `matchRal` + `sourcePalette` (mit RAL-Palette zu Hex aufgelöst)
2. `matchPalette` (originalHex → matchHex)
3. `matches` + `sourcePalette`

Hex-Werte werden einheitlich als **#RRGGBB** (uppercase) gespeichert und verglichen.

## Geometrie-Regeln

Wenn **MTL-Farben** bei verschiedenen Bauteilen gleich sind (z. B. gleicher Grauton für Kappe und anderes Teil), reicht ein reines Hex-Mapping nicht. Dann können Regeln nach **Messwerten aus der glTF-Geometrie** (pro **Primitive**, Attribut `POSITION`) verwendet werden: **Vertexzahl**, Kantenlängen der **axis-aligned Bounding Box** (unsortiert `extentMin`/`extentMax` auf `dx,dy,dz` oder **sortiert** `sortedExtentMin`/`sortedExtentMax` für rotationsinvariante Vergleiche), optional **maxExtent** (längste Kante) und **Volumen** `dx·dy·dz`.

Alle angegebenen Schranken einer Regel müssen **gleichzeitig** erfüllt sein. **Erste passende Regel** in der Liste gewinnt (Merge: zuerst Produkt-`conversionPreset`, dann global).

| Feld | Beschreibung |
|------|--------------|
| `ral` | Ziel-RAL (Pflicht). |
| `vertexCount` | Optional: erwartete Vertexzahl; zusammen mit `vertexCountTolerance` (Standard `0`). |
| `vertexCountMin` / `vertexCountMax` | Optional: Bereich für Vertexzahl. |
| `extentMin` / `extentMax` | Optional: `[dx, dy, dz]` — jeweils Mindest- bzw. Höchstmaße der **unsortierten** Kanten der Bounding Box. |
| `sortedExtentMin` / `sortedExtentMax` | Optional: `[s0, s1, s2]` mit `s0 ≤ s1 ≤ s2` (kleinste bis größte Kantenlänge), für „gleiche Form“ unabhängig von Achsenlage. |
| `maxExtentMin` / `maxExtentMax` | Optional: Schranken für die **längste** Kante. |
| `volumeMin` / `volumeMax` | Optional: Schranken für das Box-Volumen. |

Beispiel (zwei identische Kunststoffkappen mit 3370 Vertices und typischen Kanten ~0,026 / 0,0415 / 0,051 m):

```json
"geometryColorRules": [
  {
    "ral": "RAL 7035",
    "vertexCount": 3370,
    "vertexCountTolerance": 0,
    "sortedExtentMin": [0.024, 0.04, 0.05],
    "sortedExtentMax": [0.028, 0.043, 0.053]
  }
]
```

## Vertex-Reduktion

Hochauflösende CAD-Bauteile (typisch **Schrauben/Norm­teile** mit 100 000–600 000 Vertices) lassen sich beim Baken auf eine sinnvolle Spielzeit-Größe schrumpfen, ohne Material- oder Farb-Zuweisung anzufassen. Die Reduktion nutzt **`weldPrimitive` + `simplifyPrimitive`** aus `@gltf-transform/functions` mit dem `MeshoptSimplifier` aus `meshoptimizer` und arbeitet **pro Primitive**.

### JSON pro Regel

| Feld | Beschreibung |
|------|--------------|
| `target` | `"material"`, `"node"`, `"mesh"` (Standard), `"nodePath"` oder `"extras"` – wie bei Namens-Farbregeln. |
| `pattern` | Optional: ECMAScript-Regex als String. Leer lassen, wenn nur per Geometrie-Filter gematcht werden soll. |
| `flags` | Optional, z. B. `"i"`. |
| `vertexCountMin` / `vertexCountMax` | Optional: nur Primitives in diesem Vertex-Bereich werden reduziert. |
| `extentMin` / `extentMax` / `sortedExtentMin` / `sortedExtentMax` / `maxExtentMin` / `maxExtentMax` / `volumeMin` / `volumeMax` | Optional, identisch zu Geometrie-Farbregeln. |
| `ratio` | `0…1` – Anteil zu erhaltender Vertices (z. B. `0.10` = 10 %). |
| `targetVertexCount` | Alternativ: absolute Ziel-Vertexzahl. Hat Vorrang vor `ratio`. |
| `error` | Maximaler relativer Fehler (Standard `0.001` ≈ 0,1 % Modell-Radius). |
| `lockBorder` | `true` hält offene Kanten/Ränder – sinnvoll bei vielen kleinen Plättchen. |

Regex- **und** Geometrie-Bedingung müssen gleichzeitig erfüllt sein, soweit beide gesetzt sind. **Letzte passende Regel gewinnt** (Merge: zuerst global, dann Produkt-`conversionPreset`).

Beispiele:

```json
"vertexReductionRules": [
  {
    "target": "mesh",
    "pattern": "(?:Schraube|Bolt|Mutter|DIN_?\\d+|ISO_?\\d+|_M\\d+)",
    "flags": "i",
    "vertexCountMin": 5000,
    "ratio": 0.1,
    "error": 0.005
  },
  {
    "target": "mesh",
    "vertexCountMin": 200000,
    "targetVertexCount": 5000,
    "error": 0.01
  }
]
```

### Wo es angewendet wird

Pro Bake-Lauf in **`scripts/bake-glb-yup.js`**: Die Reduktion läuft **vor** den Farb-Schichten, damit Material- und Finish-Zuweisung anschließend auf den reduzierten Primitives sitzen. Die UI im Dashboard liegt direkt unter den Namens-Farbregeln (Detail-Panel) sowie im Header-Button **„Vertex-Reduktion“** (globales Modal). Speichern/laden via `POST /__api/save-vertex-reduction-rules`.

Manuell:

```bash
node scripts/bake-glb-yup.js --file=public/models/output/foo.glb --write \
  --name-rules=rules.json   # JSON mit { vertexReductionRules: [...] }
```

`meshoptimizer` ist bereits Projekt-Dependency – ohne Paket wird die Reduktion mit Warnung übersprungen.

## Namensregeln (Form / Mesh)

Zusätzlich zum **Kd-Hex-Mapping** können stabile **Benennungen** aus der GLB genutzt werden, damit gleiche Teile immer dieselbe Zielfarbe erhalten – unabhängig von kleinen Abweichungen der CAD-Diffusfarbe.

### JSON pro Regel

| Feld | Beschreibung |
|------|--------------|
| `target` | `"material"` (Standard) = Regex auf **glTF-Materialnamen** (häufig = MTL `newmtl`). `"node"` = **Knotenname** in der Szene (wie im DCC). `"mesh"` = **Name der glTF-Mesh-Ressource** (kann vom Knotennamen abweichen). `"nodePath"` = **Pfad von der Wurzel** mit `/` verbunden, z. B. `Baugruppe/Rahmen/shape-02` — hilfreich, wenn der Blatt-Knoten nur `shape-…` heißt, der Pfad aber stabilere Segmente enthält. `"extras"` = Regex auf ein **JSON** aus `extras` von Node, Mesh und Primitive (Konverter/Exporter können hier CAD-IDs ablegen). |
| `pattern` | ECMAScript-Regular Expression als String. |
| `flags` | Optional, z. B. `"i"` (case-insensitive). |
| `ral` | Ziel-RAL, z. B. `"RAL 7016"`. |

Beispiel in `public/mtl-ral-color-mapping.json`:

```json
"nameColorRules": [
  { "target": "material", "pattern": "^Rahmen", "ral": "RAL 7016", "flags": "i" },
  { "target": "nodePath", "pattern": ".*/Rahmen/.*", "ral": "RAL 7016" },
  { "target": "mesh", "pattern": "Blech_(oben|unten)", "ral": "RAL 9006", "flags": "i" },
  { "target": "extras", "pattern": "\"shapeId\"\\s*:\\s*\"SIDE_A\"", "ral": "RAL 5010" },
  { "target": "node", "pattern": "Fenster", "ral": "RAL 9006" }
]
```

### Pro Produkt (`conversionPreset`)

In `products.json` kann unter `conversionPreset` ebenfalls `nameColorRules` gesetzt werden (gleiche Struktur). **Merge:** zuerst Einträge aus dem **Produkt-Preset**, dann globale Einträge aus `mtl-ral-color-mapping.json`. **Erste passende Regel** gewinnt: **Material-Regeln** zuerst (alle Materialien), danach **Szenen-Regeln** in der Reihenfolge der JSON-Datei — `node`, `mesh`, `nodePath` und `extras` sind dabei in einer gemeinsamen Liste und pro Primitive gilt die erste passende dieser Regeln.

### Wo es angewendet wird

Die Namensregeln werden in **`scripts/bake-glb-yup.js`** ausgewertet (CLI `--name-rules=…` mit JSON `{ "nameColorRules": [ … ], "geometryColorRules": [ … ] }`). Reihenfolge in der Bake-Pipeline:

1. **Geometrie-Regeln** (`geometryColorRules`) — pro Primitive; Material landet in der „schon gesetzt“-Menge
2. Hex-Overrides (`--color-overrides`, aus MTL-Mapping + Preset) — nur Materialien, die noch **nicht** durch Geometrie gesetzt wurden
3. **Namensregeln** (`nameColorRules`) — ebenfalls nur noch ungesetzte diffuse Materialien ohne Textur
4. `--ral` nur für verbleibende, noch nicht gesetzte diffuse Materialien

Materialien **mit** Base-Color-Textur werden weder von Hex-Overrides noch von Namens-/Geometrie-Regeln überschrieben.

**Hinweise:** Materialnamen sind meist konsistent mit MTL. Bei generischen Knotennamen (`shape-12`, …) lohnt sich **`nodePath`** (übergeordnete Ebenen oft semantischer) oder **`mesh`**, falls der Exporter den **Mesh**-Namen anders setzt als den **Knoten**. **`extras`** setzt voraus, dass der Konverter sinnvolle Schlüssel in `extras` schreibt; zum Prüfen eines GLB z. B. [glTF Viewer](https://github.khronos.org/glTF-Sample-Viewer-Release/) oder ein JSON-Export mit gltf-transform. Bei `target: "node"` (und den anderen Szenen-Zielen) werden alle Primitives des Knotens betrachtet, deren Material keine Textur hat.

### Pipeline

- **`POST /__api/register-converted`** (nach Konvertierung): merged globale + Produkt-Regeln und übergibt sie an den lokalen Bake neben den Hex-Overrides.
- **`convert-product`:** loggt die Anzahl zusammengeführter Regeln; die physische Anwendung erfolgt beim Bake nach Registrierung der GLB.

Manuell:

```bash
node scripts/bake-glb-yup.js --file=public/models/output/foo.glb --write --name-rules=rules.json --ral=7035
```

## Speichern per API

- **POST /__api/save-mapping** (Body: Mapping-JSON, max. 1 MB): Schreibt das Mapping nach `public/mtl-ral-color-mapping.json`. Das MTL-Tool nutzt diesen Endpunkt beim Klick auf „Mapping im Projekt speichern“. So wird nur das Farb-Mapping zentral gespeichert und ist sofort systemweit abrufbar.

## Wo das Mapping genutzt wird

- **Konverter:** Beim Start wird `public/mtl-ral-color-mapping.json` geladen; bei jeder Konvertierung werden die abgeleiteten `colorOverrides` an die Konvertierungs-API geschickt.
- **Dashboard „Alle GLBs neu konvertieren“:** Vor dem Aufruf der Konvertierungs-API werden Projekt-Mapping und `src/data/ralColors.json` gelesen, daraus `colorOverrides` gebaut und mitgeschickt. **Projekt-Mapping hat Vorrang:** Nur wenn kein (oder leeres) Mapping existiert, wird bei aktivem „Standardfarbe überschreiben“ die eine Produktfarbe für alle MTL-Farben verwendet.

## RAL-Referenz

- **Quelle:** `src/data/ralColors.json` (Single Source im Projekt).
- Im MTL-Tool unter Dev-Server über **/ralColors.json** abrufbar; beim Build wird die Datei nach `dist/ralColors.json` kopiert.
