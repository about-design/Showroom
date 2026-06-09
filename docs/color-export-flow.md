# Ablauf: Wie die Farben beim Export ausgewählt und übernommen werden

**Siehe auch:** [benennung-farbauswahl.md](benennung-farbauswahl.md) – einheitliche Begriffe (Standard-Farbe, Override, Farbfilter, RAL).

## 1. Konverter (converter.html) – manuelle Konvertierung

### 1.1 Start ohne Preflight (Batch > 10 Dateien)
- **Formular:** `buildFormData()` baut das FormData für `POST /api/v1/convert`.
- **Farben:** Es werden nur die **geladenen** Farben aus dem Projekt-Mapping genutzt:
  - Beim Seitenstart wird `public/mtl-ral-color-mapping.json` geladen → `loadProjectColorMapping()` → `loadedColorMapping`.
  - Wenn `loadedColorMapping.colorOverrides` Einträge hat, wird genau dieses Objekt als **colorOverrides** (JSON-String) ans Formular angehängt.
- **Wichtig:** Die **Preflight-Farben und die UI im Preflight-Modal** werden dabei **nicht** verwendet, weil bei großem Batch kein Preflight läuft.

### 1.2 Start mit Preflight (≤ 10 Dateien)
1. **Erster Request:** `POST /api/v1/preflight` mit den gleichen Dateien (und optional bereits `loadedColorMapping.colorOverrides` im Formular, falls beim ersten Request mitgeschickt).
2. **Antwort:** Preflight-API liefert z. B. `preflight.colorUsage[]` mit `rgb` (0–1) pro Farbe.
3. **Farbliste im Konverter:**  
   Aus `colorUsage` wird eine Liste gebaut:
   - `hex = rgbToHex(cu.rgb)` → **ColorService.rgbToHex** (ergibt `#rrggbb` **lowercase**).
   - Diese `hex`-Werte sind die **Quellfarben** (MTL/OBJ).
4. **Anzeige im Preflight-Modal (initialHex pro Zeile):**
   - **Priorität 1:** Wenn `loadedColorMapping.colorOverrides` existiert: Lookup mit **ColorService.normalizeHex(hex)** → Key im Mapping → **initialHex = colorOverrides[normalized]** (Ziel-RAL-Hex).
   - **Priorität 2:** Sonst, wenn Auto-Matching an: **ColorService.nearestRALFromRgbRgb(r255, g255, b255)** → **initialHex = matched.hex** (bei gleichem RGB-Abstand: lexikographisch kleinster RAL-Code; feste Ausnahme RGB 132,126,120 → RAL 9007).
   - **Priorität 3:** Sonst **initialHex = hex** (Original-Quellfarbe).
   - **Zusätzlich:** Erste Zeile: Wenn Produkt-Standard geladen ist **und** die Checkbox **„Produkt-Standard (RAL) für erste Farbe verwenden“** aktiv ist (Standard: an; Abwahl in `localStorage`: `converter_preflightProductDefaultFirstRow` = `false`) → **initialHex = productDefaultHex**. Sonst bleibt Zeile 1 bei Mapping/Auto-Match.
5. **Im DOM:**
   - Jede Zeile: `data-original-hex` = **originalHex** = `(hex || '').replace(/^#?/, '#').toUpperCase()` → also **#RRGGBB uppercase** (Quellfarbe).
   - `<input class="pf-color-override" value="…">` = **initialHex** (kann lowercase von ColorService sein, z. B. von `matched.hex`).
6. **Beim Klick „Konvertierung starten“:**  
   **collectPreflightEdits()** liest die aktuellen Werte:
   - `originalHex` = `row.dataset.originalHex` (bleibt **#RRGGBB uppercase**).
   - `targetHex` = `(inp.value || '').replace(/^#?/, '#').toUpperCase()` (immer **#RRGGBB uppercase**).
   - Es wird **colorOverrides** gebaut: `{ [originalHex]: targetHex }` (Keys und Values **uppercase**).
7. **Zweiter Request:** `POST /api/v1/convert/confirm` mit Body:
   - `jobId`, Slider-Werte, Optionen,
   - **colorOverrides:** `JSON.stringify(colorOverrides)` → z. B. `{"#A1B2C3":"#D4E5F6"}`.

Die Konvertierungs-API (Backend) muss diese **colorOverrides** beim Erzeugen des GLB anwenden: Sie nimmt jede Material-/Quellfarbe, wandelt sie in einen Hex-Key um, und wenn dieser Key in **colorOverrides** vorkommt, wird die Ersatzfarbe (value) verwendet.  
**Mögliches Problem:** Wenn das Backend den Hex-Key z. B. als **lowercase** (`#a1b2c3`) erzeugt, der Key in **colorOverrides** aber **uppercase** (`#A1B2C3`) ist, findet der Lookup nicht statt → Farben werden nicht übernommen.

---

## 2. Dashboard – „Alle GLBs neu konvertieren“ (vite.config.js)

- **Projekt-Mapping:** Es wird `public/mtl-ral-color-mapping.json` gelesen (falls vorhanden). Zusammen mit `src/data/ralColors.json` werden daraus **colorOverrides** gebaut (gleiche Priorität wie im Konverter: matchRal+sourcePalette → matchPalette → matches+sourcePalette). **Projekt-Mapping hat Vorrang.**
- **Fallback:** Nur wenn **kein** (oder leeres) Projekt-Mapping existiert und **defaultColorOverride** + **defaultColorHex** gesetzt sind: Preflight wird aufgerufen, alle vorkommenden Farben auf diese eine Ziel-Farbe gemappt.
- Siehe auch [docs/mtl-mapping.md](mtl-mapping.md).

---

## 3. Kurzüberblick

| Schritt | Wo | Was passiert mit den Farben |
|--------|-----|-----------------------------|
| Mapping laden | Converter, Seitenstart | `public/mtl-ral-color-mapping.json` → `loadedColorMapping.colorOverrides` |
| Mapping laden | Dashboard convert-product | `public/mtl-ral-color-mapping.json` + `src/data/ralColors.json` → `colorOverrides` (Priorität vor defaultColorOverride) |
| Formular (ohne Preflight) | buildFormData() | `colorOverrides` = `loadedColorMapping.colorOverrides` (JSON) an Formular |
| Preflight-Antwort | API | Liefert z. B. `colorUsage[].rgb` (0–1) |
| Quell-Hex | openPreflightModal | `hex = rgbToHex(cu.rgb)` (lowercase), `originalHex` = hex normalisiert (#RRGGBB) |
| Initiale Anzeige | Preflight-Modal | Mapping-Lookup (normalized) → sonst Auto-Match RAL → sonst Original; Zeile 1 ggf. productDefaultHex (abschaltbar) |
| Nutzer ändert Farbe | Preflight-Modal | `<input class="pf-color-override">` value = gewählte Farbe |
| Beim Bestätigen | collectPreflightEdits() | `colorOverrides[originalHex] = targetHex` (beide normalisiert) |
| An Backend | convert/confirm bzw. convert-product | Body/Form enthält `colorOverrides` (JSON-String) |
| Backend | Konvertierungs-API | Sollte jede Materialfarbe per Hex-Key in colorOverrides ersetzen (Format #RRGGBB) |

---

## 4. Typische Ursache: Farben werden nicht übernommen

- **Hex-Format:** Frontend sendet Keys in **#RRGGBB uppercase**. Wenn das Backend beim Lookup einen anderen String verwendet (z. B. lowercase oder ohne `#`), stimmt der Key nicht überein → keine Ersetzung.
- **Empfehlung:** Beim Senden **colorOverrides** einheitlich normalisieren (z. B. über **ColorService.normalizeHex** für Key und Value). Im Backend beim Lookup den Material-Hex mit derselben Normalisierung (z. B. `#` + uppercase 6 Zeichen) vergleichen.

## 4.1 Prozessschutz gegen Farb-Kollaps (STEP → GLB)

- Beim Registrieren konvertierter GLBs (`/__api/register-converted`) läuft jetzt ein automatischer Check:
  - STEP: eindeutige `COLOUR_RGB`-Farben zählen
  - GLB: eindeutige `materials[].pbrMetallicRoughness.baseColorFactor`-Farben zählen
- Wenn STEP **mehrfarbig** ist (>= 2), das GLB aber auf **eine** Materialfarbe kollabiert, wird eine Warnung erzeugt:
  - Server-Log: `Farb-Kollaps erkannt …`
  - API-Response: `warnings[]` mit `reason: "color-collapse"`
- Ziel: frühes Erkennen von Fällen, in denen Overrides/Preflight alle Quellfarben auf eine Zielfarbe zusammenziehen.

## 4.2 Automatische Farb-Aliase aus Namen (generisch)

- In der Bake-Pipeline (`scripts/bake-glb-yup.js`) läuft als letzte Farbschicht ein generischer Alias-Fallback:
  - Quelle: `src/lib/colorNameAliases.js`
  - Auswertung: Materialname, danach Mesh-/Knotenname
  - Regel: **letztes erkanntes Farb-Token gewinnt** (z. B. `..._Platte_Rot` → Rot)
- Unterstützte Farbgruppen (de/en) sind zentral gepflegt und auf RAL gemappt, u. a.:
  - rot/red, blau/blue, gelb/yellow, orange, gruen/green, grau/grey/gray, schwarz/black, verzinkt/metal/silver/stahl
- Reihenfolge der Farbschichten bleibt:
  1. Hex-Mapping (`colorOverrides`)
  2. `--ral`/Standardfarbe (nur ohne Mapping-Treffer)
  3. Geometrie-Regeln
  4. Explizite `nameColorRules`
  5. **Auto-Alias-Fallback** (nur für noch nicht gemappte Materialien)

---

## 5. Reproduzierbarkeit und Backend-Vertrag

### 5.1 Gemeinsame Logik im Repo

- **Mapping → `colorOverrides`:** Implementierung nur noch in [`src/lib/hexMapping.js`](../src/lib/hexMapping.js) (`buildColorOverridesFromMapping`). Konverter und **Vite** `convert-product` nutzen dieselbe Funktion – keine doppelte Prioritätskette.
- **Hex-Normalisierung:** `normalizeMappingHex` / `ColorService.normalizeHex` – `#` + sechs Hex-Zeichen, **uppercase**.
- **Extraktion:** `node tools/extract-mtl-colors.js` sortiert MTL-Pfade und die **Palette nach Hex**; IDs sind damit bei gleicher Farbmenge stabil (Hinweis: Nach Umstellung können sich IDs gegenüber älteren Extrakten ändern – `matchRal` ggf. neu zuordnen).

### 5.2 Checkliste Konvertierungs-API (Backend, z. B. Port 3000)

1. **Keys:** Material-/MTL-Farbe vor Lookup in `colorOverrides` mit derselben Regel normalisieren wie das Frontend (`#RRGGBB` uppercase). Zusätzlich **lowercase-Key** prüfen, falls das Frontend beide Varianten mitschickt.
2. **Werte:** Ziel-Hex ebenfalls normalisiert ins GLB schreiben.
3. **Gleiche Quellfarbe:** Keine zufällige Reihenfolge bei der Ersetzung – deterministisch pro Request reicht; zwischen Requests identisch, wenn `colorOverrides` identisch ist.

### 5.3 Schlanke Mapping-Datei

- Dashboard liest nur `public/mtl-ral-color-mapping.json` bis **2 MB**. Große Dateien mit `materials`/`hexToId` per **`npm run mtl:slim-mapping`** ( [`scripts/slim-mtl-mapping.mjs`](../scripts/slim-mtl-mapping.mjs) ) in eine schlanke `public/`-Datei übernehmen (Standard-Eingabe: `public/mtl-ral-color-mapping.json`).

### 5.4 Showroom (MaterialManager)

- Wenn nur **ein Teil** der Meshes `_colorable` heißt, bleiben z. B. **Ständer** ohne Tag auf dem dunklen GLB-MTL – wir färben dann **alle Meshes außer Kappen**, sofern weniger als **85 %** der Nicht-Kappen-Meshes `_colorable` sind. Sind fast alle Teile getaggt, bleibt es bei nur diesen Meshes.
