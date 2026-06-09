# Showroom – Lichtsetup für Babylon.js

> Extrahiert aus der Three.js-Implementierung (`LightingManager.js`, `SceneManager.js`, `RoomEnvironment.js`, `eurisConstants.js`, `glbLabLightingPresets.js`).
> Alle Positionen in **Metern**, Farben als Hex.
> Koordinatensystem: Y = oben, Z = Tiefe (vorne positiv).

---

## Allgemeine Renderer-/Szenen-Einstellungen

| Eigenschaft | Wert | Babylon-Äquivalent |
|---|---|---|
| Tone Mapping | ACES Filmic | `scene.imageProcessingConfiguration.toneMappingEnabled = true; .toneMappingType = BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES` |
| Basis-Exposure | `0.8` | `scene.imageProcessingConfiguration.exposure = 0.8` |
| Output Color Space | sRGB | Standard in Babylon |
| Shadow Map Typ | PCF Soft | `light.shadowGenerator = new BABYLON.ShadowGenerator(2048, light); generator.usePercentageCloserFiltering = true;` |
| Hintergrundfarbe | `#fafafa` | `scene.clearColor = new BABYLON.Color4(0.98, 0.98, 0.98, 1)` |
| Pixel Ratio | `min(devicePixelRatio, 2)` | `engine.setHardwareScalingLevel(1 / min(dpr, 2))` |

---

## Gemeinsames Lichtziel (alle Richtlichter)

```
Target: (0, 1, 0)   // Szenenmitte auf Produkthöhe
```

---

## Profil 1: Showroom (Standard)

### Übersicht aller Lichtquellen

| # | Name | Babylon-Typ | Farbe | Intensität (Basis) | Position | Shadows |
|---|---|---|---|---|---|---|
| 1 | ambient | `HemisphericLight` (nur diffus) | `#ffffff` | 0.216 | – | Nein |
| 2 | main | `DirectionalLight` | `#fff8f0` | 0.264 | (5, 8, 5) | **Ja** |
| 3 | fill | `DirectionalLight` | `#e8eeff` | 0.06 | (−3, 4, 3) | Nein |
| 4 | sideLeft | `DirectionalLight` | `#fffaf0` | 1.05 | (−10.5, 2.2, 5.2) | Nein |
| 5 | sideRight | `DirectionalLight` | `#fffaf0` | 1.05 | (10.5, 2.2, 5.2) | Nein |
| 6 | frontPanel | *(Flächenlicht)* | `#ffffff` | 3.0 | (0, 2.5, 5.5) | Nein |
| 7 | frontKey | `DirectionalLight` | `#ffffff` | 4.0 | (0, 3, 8) | Nein |
| 8 | backKey | `DirectionalLight` | `#fff8f0` | 2.5 | (0, 3, −8) | Nein |
| 9 | backLeft | `DirectionalLight` | `#fffaf0` | 0.5 | (−6, 1.8, −4) | Nein |
| 10 | backRight | `DirectionalLight` | `#fffaf0` | 0.5 | (6, 1.8, −4) | Nein |
| 11 | topDown | `DirectionalLight` | `#ffffff` | 1.2 | (0, 10, −4) | Nein |

> **Hinweis Intensitäts-Skalierung:** Alle Basis-Intensitäten werden mit einem globalen Faktor `intensity` (0–1) multipliziert:
> `effektiv = Basis × intensity`

### Details pro Licht

#### 1. Ambient

```javascript
// Babylon.js
const ambient = new BABYLON.HemisphericLight("ambient", new BABYLON.Vector3(0, 1, 0), scene);
ambient.intensity = 0.216;
ambient.diffuse = new BABYLON.Color3(1, 1, 1);
ambient.specular = BABYLON.Color3.Black(); // kein Specular, nur Ambient-Ersatz
ambient.groundColor = new BABYLON.Color3(1, 1, 1);
```

#### 2. Main (Key Light + Schatten)

```javascript
const main = new BABYLON.DirectionalLight("main", 
    new BABYLON.Vector3(0, 1, 0).subtract(new BABYLON.Vector3(5, 8, 5)).normalize(), scene);
main.position = new BABYLON.Vector3(5, 8, 5);
main.intensity = 0.264;
main.diffuse = BABYLON.Color3.FromHexString("#fff8f0");

// Shadow Generator
const shadowGen = new BABYLON.ShadowGenerator(2048, main);
shadowGen.usePercentageCloserFiltering = true;  // PCF Soft
shadowGen.filteringQuality = BABYLON.ShadowGenerator.QUALITY_MEDIUM;
shadowGen.bias = 0.001;
// Shadow-Kamera Frustum:
main.shadowMinZ = 0.5;
main.shadowMaxZ = 50;
main.shadowOrthoScale = 10;  // left/right/top/bottom = ±10
```

#### 3. Fill

```javascript
const fill = new BABYLON.DirectionalLight("fill",
    new BABYLON.Vector3(0, 1, 0).subtract(new BABYLON.Vector3(-3, 4, 3)).normalize(), scene);
fill.position = new BABYLON.Vector3(-3, 4, 3);
fill.intensity = 0.06;
fill.diffuse = BABYLON.Color3.FromHexString("#e8eeff");
```

#### 4. Side Left

```javascript
const sideLeft = new BABYLON.DirectionalLight("sideLeft",
    new BABYLON.Vector3(0, 1, 0).subtract(new BABYLON.Vector3(-10.5, 2.2, 5.2)).normalize(), scene);
sideLeft.position = new BABYLON.Vector3(-10.5, 2.2, 5.2);
sideLeft.intensity = 1.05;
sideLeft.diffuse = BABYLON.Color3.FromHexString("#fffaf0");
```

#### 5. Side Right

```javascript
const sideRight = new BABYLON.DirectionalLight("sideRight",
    new BABYLON.Vector3(0, 1, 0).subtract(new BABYLON.Vector3(10.5, 2.2, 5.2)).normalize(), scene);
sideRight.position = new BABYLON.Vector3(10.5, 2.2, 5.2);
sideRight.intensity = 1.05;
sideRight.diffuse = BABYLON.Color3.FromHexString("#fffaf0");
```

#### 6. Front Panel (Flächenlicht)

> Babylon hat kein natives RectAreaLight. Empfohlene Approximation:

```javascript
// Option A: SpotLight mit breitem Winkel
const frontPanel = new BABYLON.SpotLight("frontPanel",
    new BABYLON.Vector3(0, 2.5, 5.5),
    new BABYLON.Vector3(0, 1, 0).subtract(new BABYLON.Vector3(0, 2.5, 5.5)).normalize(),
    Math.PI / 2, 2, scene);
frontPanel.intensity = 3.0;
frontPanel.diffuse = new BABYLON.Color3(1, 1, 1);

// Option B: Emissive Mesh (10 × 4 m Plane) + PointLight dahinter
// → visuell und beleuchterisch näher am Original
```

**Original-Maße:** 10 m breit × 4 m hoch, Position (0, 2.5, 5.5), blickt auf (0, 1, 0).

#### 7. Front Key

```javascript
const frontKey = new BABYLON.DirectionalLight("frontKey",
    new BABYLON.Vector3(0, 1, 0).subtract(new BABYLON.Vector3(0, 3, 8)).normalize(), scene);
frontKey.position = new BABYLON.Vector3(0, 3, 8);
frontKey.intensity = 4.0;
frontKey.diffuse = new BABYLON.Color3(1, 1, 1);
```

#### 8. Back Key

```javascript
const backKey = new BABYLON.DirectionalLight("backKey",
    new BABYLON.Vector3(0, 1, 0).subtract(new BABYLON.Vector3(0, 3, -8)).normalize(), scene);
backKey.position = new BABYLON.Vector3(0, 3, -8);
backKey.intensity = 2.5;
backKey.diffuse = BABYLON.Color3.FromHexString("#fff8f0");
```

#### 9. Back Left

```javascript
const backLeft = new BABYLON.DirectionalLight("backLeft",
    new BABYLON.Vector3(0, 1, 0).subtract(new BABYLON.Vector3(-6, 1.8, -4)).normalize(), scene);
backLeft.position = new BABYLON.Vector3(-6, 1.8, -4);
backLeft.intensity = 0.5;
backLeft.diffuse = BABYLON.Color3.FromHexString("#fffaf0");
```

#### 10. Back Right

```javascript
const backRight = new BABYLON.DirectionalLight("backRight",
    new BABYLON.Vector3(0, 1, 0).subtract(new BABYLON.Vector3(6, 1.8, -4)).normalize(), scene);
backRight.position = new BABYLON.Vector3(6, 1.8, -4);
backRight.intensity = 0.5;
backRight.diffuse = BABYLON.Color3.FromHexString("#fffaf0");
```

#### 11. Top Down

```javascript
const topDown = new BABYLON.DirectionalLight("topDown",
    new BABYLON.Vector3(0, 1, 0).subtract(new BABYLON.Vector3(0, 10, -4)).normalize(), scene);
topDown.position = new BABYLON.Vector3(0, 10, -4);
topDown.intensity = 1.2;
topDown.diffuse = new BABYLON.Color3(1, 1, 1);
// Explizit KEIN Shadow
```

---

## Profil 2: Euris (Babylon-Konfigurator Nachbau)

> Dieses Profil bildet den originalen Babylon-Konfigurator nach. Werte stammen aus dem Original-Babylon-Dokument (mm → m konvertiert).

| # | Name | Babylon-Typ | Farbe | Intensität | Position | Shadows |
|---|---|---|---|---|---|---|
| 1 | eurisHemi | `HemisphericLight` | Sky `#ffffff`, Ground `#444444` | 0.6 | (0, 1, 0) | Nein |
| 2 | eurisPoint | `PointLight` | `#ffffff` | 1.0 | (5, 10, 5) | **Ja** |
| 3 | eurisAmbient | `HemisphericLight` (diffus) | `#ffffff` | 0.3 | – | Nein |

### HDRI Environment

- **Datei:** `/hdri/warehouse.hdr`
- **Mapping:** Equirectangular Reflection
- **Babylon:** `scene.environmentTexture = new BABYLON.HDRCubeTexture("warehouse.hdr", scene, 256);`

### Details

```javascript
// Hemisphere Light
const eurisHemi = new BABYLON.HemisphericLight("eurisHemi", new BABYLON.Vector3(0, 1, 0), scene);
eurisHemi.intensity = 0.6;
eurisHemi.diffuse = new BABYLON.Color3(1, 1, 1);        // Sky: #ffffff
eurisHemi.groundColor = BABYLON.Color3.FromHexString("#444444");

// Point Light mit Schatten
const eurisPoint = new BABYLON.PointLight("eurisPoint", new BABYLON.Vector3(5, 10, 5), scene);
eurisPoint.intensity = 1.0;
eurisPoint.diffuse = new BABYLON.Color3(1, 1, 1);
eurisPoint.range = 50;  // distance

const shadowGen = new BABYLON.ShadowGenerator(2048, eurisPoint);
shadowGen.bias = -0.0001;
eurisPoint.shadowMinZ = 0.1;
eurisPoint.shadowMaxZ = 30;

// Ambient
const eurisAmbient = new BABYLON.HemisphericLight("eurisAmbient", new BABYLON.Vector3(0, 1, 0), scene);
eurisAmbient.intensity = 0.3;
eurisAmbient.diffuse = new BABYLON.Color3(1, 1, 1);
eurisAmbient.specular = BABYLON.Color3.Black();

// HDRI
const hdrTexture = new BABYLON.HDRCubeTexture("/hdri/warehouse.hdr", scene, 256);
scene.environmentTexture = hdrTexture;
```

### Euris Szenen-Einstellungen

| Eigenschaft | Wert |
|---|---|
| Hintergrund | `#f0f0f0` |
| Boden-Farbe | `#888888` |
| Kamera Near/Far | 0.1 / 100 |
| Orbit Target Y | 1.5 |
| Kamera Startposition | (4, 3, 4) |
| Min/Max Orbit Distance | 0.5 / 35 |
| Max Polar Angle | π × 0.48 |
| Min Polar Angle | 0.1 |
| Damping Factor | 0.08 |
| Rückwand | 20 × 5 m bei (0, 2.5, −10), `receiveShadow = true`, Farbe `#cccccc` |

---

## Profil 3: GLB Lighting Lab (Presets)

> Für GLB-Modell-Vorschau mit wechselbaren Stimmungen. Neutral-graue Environment Map (PMREM).

### Feste Lichter

| Name | Typ | Farbe | Position | Shadows |
|---|---|---|---|---|
| labKey | `DirectionalLight` | *per Preset* | *per Preset* | **Ja** (2048, radius 4, near 0.5, far 50, ortho ±10) |
| labFill | `DirectionalLight` | `#dde0ff` | (−5, 3, −3) | Nein |
| labHemi | `HemisphericLight` | *per Preset* | – | Nein |

### Presets

| Preset | Key Intensität | Key Position | Key Farbe | Fill Intensität | Hemi Intensität | Hemi Sky | Hemi Ground | Exposure | Hintergrund |
|---|---|---|---|---|---|---|---|---|---|
| **verzinkt** | 2.0 | (5, 8, 5) | `#f0f0ff` | 0.8 | 0.6 | `#eef2ff` | `#888888` | 1.0 | `#1a1c20` |
| **studio** | 2.5 | (5, 5, 3) | `#ffffff` | 1.0 | 0.8 | `#ffffff` | `#b0b0b0` | 1.1 | `#1a1a1a` |
| **warehouse** | 1.5 | (3, 10, 2) | `#fff5e0` | 0.5 | 0.4 | `#fff5e0` | `#6b6050` | 0.9 | `#12110e` |
| **bright** | 3.0 | (5, 6, 5) | `#ffffff` | 1.2 | 1.0 | `#f8f8ff` | `#cccccc` | 1.3 | `#e8e8e8` |
| **noenv** | 3.5 | (5, 8, 5) | `#ffffff` | 1.2 | 1.0 | `#ffffff` | `#aaaaaa` | 1.2 | `#1a1c20` |

> Hinweis: Alle Lab-Intensitäten werden ebenfalls mit dem globalen Regler (0–1) multipliziert.

---

## Schatten-Empfänger (Meshes)

| Mesh | Typ | Größe | Position | Rotation | Material |
|---|---|---|---|---|---|
| Boden (Showroom) | Plane | 4000 × 4000 | (0, 0, 0) | −90° X | `roughness: 0.85, metalness: 0.05, color: #fafafa` |
| Rückwand (Euris) | Plane | 20 × 5 | (0, 2.5, −10) | – | `roughness: 0.95, metalness: 0.05, color: #cccccc, doubleSide` |

---

## Optionales freies Flächenlicht (interaktiv)

Ein zusätzliches, vom User steuerbares Flächenlicht (`RectAreaLight` → in Babylon als SpotLight oder emissive Mesh approximieren):

| Eigenschaft | Standard | Bereich |
|---|---|---|
| Position | (3, 2.8, 2.5) | frei verschiebbar |
| Größe | 2.6 × 1.8 m | 0.15–20 m |
| Richtung | Yaw −130°, Pitch −27° | Yaw 0–360°, Pitch −89°–89° |
| Max. Intensität | 14 | 0–14 (Normwert 0–1 × 14) |
| Farbe | `#fff4e8` | – |

---

## Hinweise zur Portierung Three.js → Babylon.js

1. **DirectionalLight-Richtung:** In Three.js zeigt das Licht von `position` auf `target`. In Babylon ist `direction` ein Richtungsvektor. Berechnung: `direction = normalize(target - position)`.

2. **AmbientLight → HemisphericLight:** Three.js `AmbientLight` hat keine Richtung. In Babylon `HemisphericLight` mit `specular = Color3.Black()` verwenden und `groundColor = diffuse` setzen für gleichmäßiges Ambient.

3. **RectAreaLight:** Existiert nicht in Babylon. Alternativen:
   - SpotLight mit breitem Winkel
   - Emissive Mesh + PointLight
   - Area Light Plugin (Community)

4. **Tone Mapping Exposure:** In Three.js global auf dem Renderer. In Babylon auf `scene.imageProcessingConfiguration.exposure`.

5. **Shadow Map PCF Soft:** `ShadowGenerator` mit `usePercentageCloserFiltering = true`.

6. **Alle Lichter bleiben fest im Weltraum** – sie rotieren NICHT mit der Kamera (OrbitControls). In Babylon ist das Standardverhalten.
