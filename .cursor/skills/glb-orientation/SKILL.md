---
name: glb-orientation
description: Prüft und korrigiert die Orientierung von GLB-Dateien (Y-up-Koordinatensystem). Verwende diese Skill wenn es um GLB-Dateien, 3D-Koordinatensysteme, Z-up/Y-up-Konvertierung, Root-Node-Rotationen oder das Einbrennen von Transforms geht.
---

# GLB-Orientierung: Prüfen & Einbrennen

## Koordinatensystem-Konventionen

| Eigenschaft | Konvention |
|-------------|------------|
| Koordinatensystem | **Y-up**, rechtshändig (Three.js / glTF-Standard) |
| Y-Achse | Vertikal nach oben |
| XZ-Ebene | Bodenfläche (Y = 0) |
| Maßstab | 1 Einheit = 1 Meter |
| Pivot | Unten Mitte, Modell steht auf XZ-Ebene |
| Format | GLB, optional Draco-komprimiert |

## Häufiges Problem: Z-up CAD-Exporte

CAD-Tools (SolidWorks, Inventor, STEP-Konverter) exportieren oft mit **Z-up**. Der Exporter fügt eine Root-Node-Rotation (`±90° X`) hinzu, die das Modell visuell korrigiert, aber die Vertex-Daten bleiben Z-up. Das kann in anderen Tools (Babylon.js, AR-Viewer) zu Problemen führen.

### Erkennung

- Root-Node-Quaternion `[±0.7071, 0, 0, 0.7071]` = Z-up → Y-up Korrektur
- Andere Root-Rotationen = gedrehter CAD-Export
- Keine Root-Rotation = bereits Y-up (oder manuell prüfen)

## Verfügbare Tools

### 1. Browser-Tool: Visueller Check + Einbrennen

```bash
open tools/check-glb-orientation.html
```

**Funktionen:**
- Ordner/Dateien auswählen → Vorschau mit Achsen-Overlay und Bodenraster
- Metadaten-Analyse (Generator, Root-Node-Rotationen)
- Toggle "Einbrennen" → Download einzeln oder als ZIP
- **Nicht-Draco-Dateien**: direkte Binär-Manipulation (gleiche Dateigröße)
- **Draco-Dateien**: Fallback auf Three.js GLTFExporter (Dateien werden größer!)

### 2. Node.js-Script: Batch-Verarbeitung

```bash
npm run glb:bake-yup          # Dry-Run (nur Analyse)
npm run glb:bake-yup:write    # In-Place mit .bak-Backup
node scripts/bake-glb-yup.js --out=pfad  # In separaten Ordner
```

**Nutzt gltf-transform** mit nativem Draco-Encoder → erhält Kompression.

Bevorzuge dieses Script für **Draco-komprimierte** Dateien.

### Wann welches Tool?

| Situation | Tool |
|-----------|------|
| Schneller visueller Check | Browser-Tool |
| Einzelne Dateien einbrennen (nicht Draco) | Browser-Tool |
| Batch-Verarbeitung | Node.js-Script |
| Draco-komprimierte Dateien einbrennen | Node.js-Script |

## Einbrenn-Algorithmus (Referenz)

Die Root-Rotation wird rekursiv in die Vertex-Daten geschrieben:

1. Quaternion → 3×3-Rotationsmatrix
2. Eigenes Mesh des Root-Nodes: POSITION, NORMAL, TANGENT transformieren
3. Kinder-Nodes: Translation rotieren, Rotation komponieren
4. Rekursiv bis zu Blatt-Nodes mit Meshes
5. Root-Rotation auf Identity setzen
6. Accessor min/max aktualisieren

**Wichtig**: Bei Draco-komprimierten GLBs kann der Vertex-Buffer nicht direkt modifiziert werden – Dekodierung + Re-Enkodierung nötig (nur gltf-transform kann das im Node.js-Script).

## Abhängigkeiten

```json
{
  "devDependencies": {
    "@gltf-transform/core": "^4.3.0",
    "@gltf-transform/extensions": "^4.3.0",
    "draco3dgltf": "^1.5.7"
  }
}
```

## Relevante Dateien

- `tools/check-glb-orientation.html` – Browser-Tool
- `scripts/bake-glb-yup.js` – Node.js Batch-Script
- `public/models/products/README.md` – GLB-Anforderungen
- `src/showroom/ProductPlacement.js` – Runtime-Rotation (`rotationOffset`)
- `src/data/products.json` – Produkt-Config mit optionalem `rotationOffset`
