/**
 * META Euris / Babylon-Konfigurator → Showroom (Three.js).
 * Babylon-Werte waren in mm; der Showroom arbeitet in Metern → ÷ 1000.
 */
export const EURIS = {
  /** Kamera-Clipping (Babylon minZ/maxZ 100 / 100000 mm) */
  cameraNear: 0.1,
  cameraFar: 100,
  /** Orbit-Target (0, 1500, 0 mm) */
  orbitTargetY: 1.5,
  /** Start ungefähr radius 6000 mm vom Target */
  cameraPosition: { x: 4, y: 3, z: 4 },
  minDistance: 0.5,
  maxDistance: 35,
  maxPolarAngle: Math.PI * 0.48,
  minPolarAngle: 0.1,
  dampingFactor: 0.08,
  panSpeed: 2,
  /** HemisphereLight */
  hemiSky: 0xffffff,
  hemiGround: 0x444444,
  hemiIntensity: 0.6,
  /** PointLight (5000, 10000, 5000 mm), distance 50000 mm */
  pointPosition: { x: 5, y: 10, z: 5 },
  pointIntensity: 1,
  pointDistance: 50,
  pointColor: 0xffffff,
  /** Shadow-Hilfskamera (100 / 30000 mm) */
  pointShadowNear: 0.1,
  pointShadowFar: 30,
  /** Ambient */
  ambientIntensity: 0.3,
  /** Szene */
  background: 0xf0f0f0,
  floor: 0x888888,
  /** Optional: HDRI wie im Babylon-Dokument */
  hdriPath: '/hdri/warehouse.hdr',
}
