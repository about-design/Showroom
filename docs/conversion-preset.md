# `conversionPreset` (optional pro Produkt)

In `products.json` kann jedes Produkt ein optionales Feld **`conversionPreset`** tragen: gespeicherte Konvertierungsoptionen vom letzten erfolgreichen Export (Konverter-UI mit `productId` oder Dashboard-Konvertierung).

- **Optional:** Produkte ohne `conversionPreset` verhalten sich wie bisher (nur Server-Defaults + Request-Optionen).
- **Merge-Reihenfolge** bei `POST /__api/convert-product`:  
  `defaults` → `conversionPreset` aus dem Produkt → `options` aus dem Request (Request gewinnt).
- **`colorOverrides`:** Objekt `{ "#RRGGBB": "#RRGGBB", … }` (wie beim Konverter-API-Formular). Liegt im Preset, werden sie **über** das globale `public/mtl-ral-color-mapping.json` gelegt; Request-`options.colorOverrides` gehen zuletzt.

Typische Schlüssel (alle optional, meist Strings wie im Formular):

- `colorOverrides`, `rotateAxis`, `rotateDegrees`, `scale`, `importUpAxis`, `bakeYUp`
- `useDraco`, `tessellationQuality`, `decimateRatio`, `materialFinish`
- `colorSaturation`, `colorBrightness`, `roughnessMultiplier`, `metallicMultiplier`
- `materialFinishVerzinktMetallic`, `materialFinishVerzinktRoughness`, `materialFinishRalMetallic`, `materialFinishRalRoughness`
- `embedTextures`, `stripCamerasLights`, `overwriteExisting`, `outputFormat`, `useGTINNaming`, `batchChunkSize`, `gtin`, `articleNumber`, `rotateYUp` (Dashboard)

Nicht jedes Feld muss gesetzt sein; fehlende Werte fallen auf Server-Defaults zurück.
