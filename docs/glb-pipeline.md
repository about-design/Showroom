# GLB-Pipeline (Bake + Draco)

## Einheitlicher Export (glb-export-config.json)

Damit alle GLB-Dateien gleich exportiert werden (gleiche Orientierung, gleiche Optionen):

1. **Orientierungen prüfen** – alle in `products.json` referenzierten GLB-Dateien analysieren und Config aufbauen:
   ```bash
   npm run glb:check-orientations        # Nur Report
   npm run glb:check-orientations:write  # Report + glb-export-config.json aktualisieren
   ```

2. **glb-export-config.json** enthält:
   - **defaults.converter** – Voreinstellungen für CAD→GLB (scale, importUpAxis, bakeYUp, rotateAxis, useDraco, …).
   - **defaults.pipeline** – z. B. `bakeYUpAfterConvert`, `useDracoAfterBake`.
   - **files** – pro `glbFile`: `detectedOrientation`, `needsBakeYUp`, `suggestedRotationOffset` (z. B. Z-up → `{ "x": -90, "y": 0, "z": 0 }` für products.json).

Nutze die **defaults** im CAD-Konverter und **bakeYUp** in der Pipeline; Dateien mit `needsBakeYUp: true` sollten mit `bake-glb-yup.js` nachbearbeitet werden (oder bereits mit bakeYUp konvertiert werden).

## Ablauf

1. **check-glb-orientations.js** – prüft alle GLB-Pfade aus products.json, schreibt/aktualisiert `glb-export-config.json`.
2. **bake-glb-yup.js** – brennt Root-Node Z-up→Y-up-Korrekturen in die Vertex-Daten ein.
3. **compress-glb-draco.js** – wendet Draco-Mesh-Kompression an.

Die Skripte bake-glb-yup und compress-glb-draco nutzen ausschließlich `KHRONOS_EXTENSIONS` (kein Meshopt).

## Kompression

- Nur **Draco** (KHR_draco_mesh_compression) – Blender-kompatibel.
- **gltfpack** wird nicht verwendet (würde Meshopt einführen).

## Blender-Export

Beim Export aus Blender: **„Mesh Optimization"** deaktivieren, damit kein EXT_meshopt_compression entsteht.
