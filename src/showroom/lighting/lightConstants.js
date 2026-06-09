import * as THREE from 'three'

/** Alle Richtlichter zielen auf diesen Punkt (Objekt-/Szenenmitte in Produkthöhe). */
export const LIGHT_TARGET = new THREE.Vector3(0, 1, 0)

/** Basis-Intensitäten (+20 %) – werden mit dem Regler skaliert */
export const BASE = {
  ambient: 0.216,
  main: 0.264,
  fill: 0.06,
  sideLeft: 1.05,
  sideRight: 1.05,
  frontPanel: 3,
  frontKey: 4,
  backKey: 2.5,
  backLeft: 0.5,
  backRight: 0.5,
  topDown: 1.2,
}

/** Max. Intensität des freien Flächenlichts bei Regler 100 % (nicht vom globalen Beleuchtungsregler skaliert). */
export const FREE_RECT_MAX_INTENSITY = 14
