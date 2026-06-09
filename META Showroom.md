# META Online – 3D Online Showroom
## Projektplan & Vibe-Coding Prompt

---

## 📐 Architektur-Übersicht

```
meta-showroom/
├── index.html
├── vite.config.js
├── tailwind.config.js
├── package.json
├── src/
│   ├── main.js                        # App Entry Point
│   ├── styles/
│   │   └── main.css                   # Tailwind Directives
│   │
│   ├── showroom/                      # THREE.JS CORE
│   │   ├── SceneManager.js            # Renderer, Scene, Loop, Resize
│   │   ├── RoomEnvironment.js         # Virtueller Lagerraum (Boden, Wände, HDRI)
│   │   ├── ProductLoader.js           # GLTFLoader + DRACOLoader, Cache
│   │   ├── ProductPlacement.js        # Mehrere Regale im Raum positionieren
│   │   ├── MaterialManager.js         # RAL-Farbwechsel per MeshStandardMaterial
│   │   ├── LightingManager.js         # HDRI Environment + Spotlights
│   │   ├── CameraController.js        # OrbitControls + Kamera-Animationen
│   │   ├── HotspotManager.js          # 3D→2D Projektion, Click-Handling
│   │   └── ARManager.js               # WebXR / model-viewer Integration
│   │
│   ├── ui/                            # ALPINE.JS + TAILWIND UI
│   │   ├── Sidebar.js                 # Produktauswahl, Raumnavigation
│   │   ├── ColorPicker.js             # RAL-Farbpalette
│   │   ├── HotspotOverlay.js          # Info-Cards über Hotspots
│   │   ├── LoadingScreen.js           # Ladescreen mit Progress
│   │   └── MobileMenu.js              # Touch-optimiertes UI
│   │
│   └── data/
│       ├── products.json              # Produktkatalog
│       ├── ralColors.json             # RAL-Farbdefinitionen
│       └── rooms.json                 # Raumkonfigurationen
│
└── public/
    ├── models/                        # GLB-Dateien (optimiert)
    │   ├── room-base.glb              # Lagerraum Grundstruktur
    │   ├── products/
    │   │   ├── regal-classic.glb
    │   │   ├── regal-heavy-duty.glb
    │   │   └── regal-longspan.glb
    │   └── draco/                     # DRACO Decoder WASM
    ├── hdri/
    │   └── warehouse.hdr              # HDRI für Beleuchtung
    └── textures/
        └── floor-concrete.jpg
```

---

## 🧩 Modul-Beschreibungen

### SceneManager.js
Zentrale Klasse – initialisiert WebGL Renderer, Scene, Camera und den Render-Loop. Managed auch Window-Resize und ist der einzige Zugang zur Three.js Scene für alle anderen Module.

### RoomEnvironment.js
Baut den virtuellen Lagerraum: Betonboden-Textur, Wände optional, Deckenbeleuchtung als Mesh. Definiert `PlacementZones` – vordefinierte Positionen wo Regale aufgestellt werden.

### ProductLoader.js
Lädt GLB-Dateien via GLTFLoader + DRACOLoader. Cached bereits geladene Modelle. Emittiert Events (load-progress, load-complete) für den Ladescreen.

### ProductPlacement.js
Verwaltet welche Produkte in welcher PlacementZone stehen. Animiert Ein-/Ausblenden mit GSAP. Ermöglicht das Wechseln zwischen verschiedenen Regal-Konfigurationen.

### MaterialManager.js
Traversiert alle Meshes eines geladenen GLB, identifiziert färbbare Materialien (z.B. via Material-Name Convention wie `_colorable`) und wendet MeshStandardMaterial-Farben an. RAL-zu-Hex Mapping aus ralColors.json.

### HotspotManager.js
Konvertiert 3D-Weltkoordinaten in 2D-Bildschirmkoordinaten via `Vector3.project()`. Rendert HTML-Hotspot-Marker als absolute-positioned Divs. Bei Click → Info-Card via Alpine.js.

### ARManager.js
Nutzt `<model-viewer>` Web Component von Google für Mobile AR. Generiert dynamisch ein model-viewer Element mit der aktuell konfigurierten Produktfarbe (via materials API).

### CameraController.js
Wraps OrbitControls. Bietet zusätzlich animierte `focusProduct(productId)` Methode, die die Kamera smooth zu einem Produkt bewegt (via GSAP/Tween).

---

## 📦 Dependencies (package.json)

```json
{
  "dependencies": {
    "three": "^0.170.0",
    "@google/model-viewer": "^4.0.0",
    "gsap": "^3.12.0"
  },
  "devDependencies": {
    "vite": "^6.0.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0",
    "alpinejs": "^3.14.0"
  }
}
```

---

## 🎨 RAL-Farbsystem (ralColors.json Struktur)

```json
{
  "RAL 7035": { "hex": "#D7D7D7", "name": "Lichtgrau", "popular": true },
  "RAL 7016": { "hex": "#383E42", "name": "Anthrazitgrau", "popular": true },
  "RAL 5010": { "hex": "#0E4FA2", "name": "Enzianblau", "popular": true },
  "RAL 3000": { "hex": "#AB2524", "name": "Feuerrot", "popular": false },
  "RAL 6011": { "hex": "#587246", "name": "Resedagrün", "popular": false },
  "RAL 9005": { "hex": "#0A0A0A", "name": "Tiefschwarz", "popular": true },
  "RAL 9010": { "hex": "#F4F4F4", "name": "Reinweiß", "popular": true }
}
```

---

## 🏭 Produktdaten (products.json Struktur)

```json
{
  "products": [
    {
      "id": "regal-classic",
      "name": "META Regal Classic",
      "glbFile": "/models/products/regal-classic.glb",
      "colorableMeshes": ["Frame", "Shelf_Boards"],
      "defaultColor": "RAL 7035",
      "hotspots": [
        {
          "id": "hs-1",
          "position": { "x": 0.5, "y": 1.8, "z": 0 },
          "title": "Traglast",
          "content": "Bis zu 500 kg pro Ebene",
          "icon": "weight"
        }
      ],
      "specs": {
        "load": "500 kg/Ebene",
        "height": "200 cm",
        "width": "100 cm",
        "depth": "60 cm"
      },
      "shopwareProductId": "SW10001"
    }
  ]
}
```

---

## 🗺️ Räume (rooms.json Struktur)

```json
{
  "rooms": [
    {
      "id": "warehouse-standard",
      "name": "Lager Standard",
      "placementZones": [
        { "id": "zone-1", "position": { "x": -2, "y": 0, "z": 0 }, "rotation": 0 },
        { "id": "zone-2", "position": { "x": 0, "y": 0, "z": 0 }, "rotation": 0 },
        { "id": "zone-3", "position": { "x": 2, "y": 0, "z": 0 }, "rotation": 0 }
      ],
      "cameraStart": { "position": { "x": 0, "y": 2, "z": 6 }, "target": { "x": 0, "y": 1, "z": 0 } }
    }
  ]
}
```

---

## 📱 AR-Strategie (Mobile)

- **iOS (Safari):** `<model-viewer>` nutzt Quick Look / USDZ automatisch
- **Android (Chrome):** `<model-viewer>` nutzt Scene Viewer / WebXR
- **Fallback:** 3D-Ansicht im Browser bleibt immer verfügbar
- **Farbübergabe an AR:** model-viewer Materials API für dynamische RAL-Farbe
- **Konvertierung:** GLB → USDZ für iOS via reality-converter oder Online-Tool

---

## 🚀 GLB-Optimierungs-Checkliste

Vor dem Einsatz jedes GLB-Modells:

- [ ] **Polygon-Count:** Max. 50.000 Tris pro Produkt
- [ ] **Draco Komprimierung:** `gltf-pipeline -i input.glb -o output.glb --draco.compressionLevel 7`
- [ ] **Texturen:** Max. 1024x1024, WebP-Format wenn möglich
- [ ] **Material-Naming:** Färbbare Meshes mit `_colorable` Suffix benennen
- [ ] **Pivot:** Auf Boden-Mittelpunkt gesetzt (für PlacementZone)
- [ ] **Scale:** 1 Unit = 1 Meter
- [ ] **Unused Data:** Animationen, Kameras etc. entfernen

---

## ⚡ Performance-Ziele

| Metrik | Ziel |
|--------|------|
| Initial Load (3 Modelle) | < 3 Sekunden |
| GLB-Dateigröße pro Produkt | < 2 MB nach DRACO |
| Frame Rate | 60fps Desktop, 30fps Mobile |
| Lighthouse Performance | > 85 |
| WebGL Support | 95%+ Browser (WebGL 2.0) |

---

# 🤖 VIBE-CODING PROMPT

> Diesen Prompt in Cursor/GitHub Copilot/Claude Code einfügen um das Projekt zu starten.

---

```
Ich baue einen webbasierten 3D-Online-Showroom für B2B-Regalsysteme (META Online).
Erstelle mir ein vollständiges Vite-Projekt mit folgendem exakten Tech-Stack:

## Tech Stack
- Vite 6 (Build Tool)
- Three.js ^0.170 (3D Engine)
- Tailwind CSS 4 (Styling via @tailwindcss/vite Plugin)
- Alpine.js 3 (reaktive UI-Komponenten, via CDN im HTML oder NPM)
- GSAP 3 (Kamera-Animationen und Übergänge)
- @google/model-viewer 4 (Mobile AR)

## Was der Showroom kann (V1)
1. Virtuellen Lagerraum rendern (Betonboden, neutrale Wände, industrielle Beleuchtung)
2. Mehrere GLB-Produkte (Regale) in definierten Zonen im Raum platzieren
3. Orbit Controls: Maus/Touch-Navigation durch den Raum
4. RAL-Farbkonfigurator: User wählt RAL-Farbe → alle färbbaren Meshes (suffix "_colorable") eines Produkts ändern Farbe via MeshStandardMaterial
5. Hotspots: 3D-Punkte projiziert auf 2D-Screen als HTML-Marker, bei Klick öffnet sich Info-Card (Alpine.js)
6. Produktwechsel: Sidebar (Alpine.js) zum Wechseln zwischen verschiedenen Produkten/Raumkonfigurationen mit Kamera-Fokus-Animation
7. AR-Preview: Button auf Mobile öffnet <model-viewer> mit aktuellem Modell + RAL-Farbe

## Projektstruktur
Erstelle folgende Dateien:

### index.html
- Tailwind via Vite eingebunden
- Alpine.js initialisiert
- Canvas-Element für Three.js fullscreen
- Overlay-Layer für UI (Sidebar, Hotspots, Loading, AR-Button)
- @google/model-viewer Script Tag

### vite.config.js
- @tailwindcss/vite Plugin
- Public-Dir für Models und HDRI

### src/main.js
- Initialisiert alle Manager in der richtigen Reihenfolge
- SceneManager → LightingManager → RoomEnvironment → ProductLoader → HotspotManager → CameraController
- Alpine.js Store für UI-State (currentProduct, currentColor, activeHotspot, isLoading)

### src/showroom/SceneManager.js
- WebGLRenderer mit antialias, pixelRatio, outputColorSpace: SRGBColorSpace
- PerspectiveCamera (FOV 60)
- Window Resize Handler
- Render Loop via requestAnimationFrame
- Singleton-Muster: export default new SceneManager()

### src/showroom/RoomEnvironment.js
- Betonboden: PlaneGeometry, MeshStandardMaterial mit RepeatWrapping Textur
- Optionale Wände (deaktivierbar)
- PlacementZones als Array von {id, position, rotation} Objekten
- Methode: getZonePosition(zoneId) → Vector3

### src/showroom/ProductLoader.js
- GLTFLoader + DRACOLoader (DRACO Decoder aus /draco/ Public-Ordner)
- Async loadProduct(glbPath) → cached gltf
- EventEmitter für load-progress, load-complete, load-error

### src/showroom/MaterialManager.js
- traverseMeshes(object3D) → findet alle Meshes mit "_colorable" im Namen
- applyRALColor(object3D, hexColor) → setzt .color auf MeshStandardMaterial
- getCurrentColor() → gibt aktuelle RAL-Farbe zurück

### src/showroom/HotspotManager.js
- addHotspot(hotspotData, parentObject3D) → erstellt HTML-Marker
- updatePositions() → wird im Render-Loop aufgerufen, projiziert 3D→2D
- onHotspotClick → triggert Alpine.js Event

### src/showroom/CameraController.js
- OrbitControls mit sinnvollen Limits (min/maxDistance, maxPolarAngle)
- focusProduct(position) → GSAP Tween für smooth Kamera-Animation
- resetCamera() → zurück zur Startposition

### src/showroom/ARManager.js
- showAR(glbUrl, hexColor) → erstellt/aktualisiert <model-viewer> Element
- Nur auf Touch-Geräten anzeigen
- model-viewer Materials API für Farbübernahme

### src/data/products.json
Beispieldaten für 2 Produkte:
- "meta-classic": einfaches Regal, 2 Hotspots
- "meta-heavy-duty": schweres Regal, 3 Hotspots
Beide mit colorableMeshes, specs, shopwareProductId

### src/data/ralColors.json
Die 7 wichtigsten META RAL-Farben:
RAL 7035 Lichtgrau, RAL 7016 Anthrazitgrau, RAL 5010 Enzianblau,
RAL 3000 Feuerrot, RAL 6011 Resedagrün, RAL 9005 Tiefschwarz, RAL 9010 Reinweiß

### UI-Layer im index.html (Alpine.js)
- Sidebar links: Produktliste, Klick → loadProduct + focusCamera
- Unten: RAL-Farbpalette als Kreise, Klick → applyRALColor
- Hotspot-Marker: absolut positionierte Divs mit pulse-Animation
- Info-Card: erscheint bei Hotspot-Klick mit Titel + Content
- Loading-Overlay: Progress-Bar während GLB lädt
- AR-Button: nur mobile, floating bottom-right

### Styling-Prinzipien (Tailwind)
- Dark Theme: bg-gray-900 für Canvas-Hintergrund
- UI-Panels: bg-gray-800/80 backdrop-blur-sm, abgerundete Ecken
- Akzentfarbe: amber-500 (META Brand)
- Responsive: Sidebar wird auf Mobile zu Bottom-Sheet

## GLB Platzhalter
Da noch keine echten GLB-Dateien vorliegen, erstelle Platzhalter-Geometrien in Three.js:
- BoxGeometry als Regal-Placeholder
- Material mit "_colorable" im Name damit der Farbwechsel testbar ist
- Kommentar im Code wo später loadProduct() aufgerufen wird

## Code-Qualität
- ES6+ Modules durchgängig
- JSDoc-Kommentare für alle public Methoden
- Keine TypeScript (für Vibe-Coding optimiert, einfacher zu iterieren)
- Fehlerbehandlung: try/catch in allen async Loader-Methoden
- Console.log für wichtige Events (development mode)

Starte mit: index.html, vite.config.js, package.json, src/main.js
Dann: alle Showroom-Manager in der Reihenfolge wie oben
Zum Schluss: UI-Integration und Alpine.js Store

Nach jedem Datei-Block frage kurz ob ich Anpassungen möchte bevor du weiter machst.
```

---

## 🗓️ Empfohlene Umsetzungs-Phasen

| Phase | Inhalt | Dauer |
|-------|--------|-------|
| **Phase 1** | Vite Setup, Three.js Grundszene, Orbit Controls, Platzhalter-Geometrien | 1 Tag |
| **Phase 2** | GLB-Loader, erstes echtes Modell laden, DRACOLoader | 1 Tag |
| **Phase 3** | Farbkonfigurator (RAL-Picker + MaterialManager) | 0,5 Tage |
| **Phase 4** | Virtueller Raum (Boden, Beleuchtung, HDRI, PlacementZones) | 1 Tag |
| **Phase 5** | Hotspot-System (3D→2D, Info-Cards) | 1 Tag |
| **Phase 6** | Alpine.js UI (Sidebar, Color Picker, Responsive) | 1 Tag |
| **Phase 7** | AR-Preview (model-viewer, Mobile Testing) | 1 Tag |
| **Phase 8** | Performance-Optimierung, GLB-Optimierung, Testing | 1 Tag |
| **GESAMT** | | **~7-8 Tage Vibe-Coding** |

---

## 🔗 Nächste Schritte nach V1

- **Shopware-Integration:** Produkt-IDs aus products.json → direkter Link in Shop
- **CPQ-Anbindung:** Konfiguriertes Produkt (Maße, RAL, Menge) an Shopware-Warenkorb übergeben
- **Analytics:** Hotspot-Klicks und Farbauswahl tracken
- **Mehr Räume:** Büro, Produktion, Archiv als weitere Raumtypen
- **Animations:** Regal wird bestückt/entleert (Lager-Simulation)