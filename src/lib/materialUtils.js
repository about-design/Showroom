/**
 * Gemeinsame Three.js-Material-/Mesh-Hilfen (Showroom, Dashboard, MaterialManager).
 */

/** True für Three.js PBR-Materialien (Standard / Physical). */
export function isPbrMaterial(m) {
  return !!(m && (m.isMeshStandardMaterial === true || m.isMeshPhysicalMaterial === true))
}

/** Farbe aus Material (oder Material-Array) als Hex-String. */
export function getColorFromMaterial(mat) {
  if (!mat) return null
  const materials = Array.isArray(mat) ? mat : [mat]
  for (const m of materials) {
    if (m.color && typeof m.color.getHexString === 'function') {
      return '#' + m.color.getHexString()
    }
  }
  return null
}

/**
 * Liest metalness/roughness vom ersten PBR-Slot (nicht nur materials[0] – bei Multi-Material
 * kann Slot 0 z. B. Basic/Line sein).
 */
export function readMetalnessRoughnessFromMaterial(m) {
  if (!isPbrMaterial(m)) return null
  const metalOk = typeof m.metalness === 'number' && Number.isFinite(m.metalness)
  const roughOk = typeof m.roughness === 'number' && Number.isFinite(m.roughness)
  const hasMRMap = !!(m.metalnessMap || m.roughnessMap)
  return {
    metalness: metalOk ? m.metalness : null,
    roughness: roughOk ? m.roughness : null,
    hasMRMap,
  }
}

/**
 * Metallisch / Rauheit: aktuelle Werte am Three.js-Material (0–1 oder null).
 */
export function getMetalnessRoughness(mat) {
  if (!mat) return { metalness: null, roughness: null, hasMRMap: false }
  const materials = Array.isArray(mat) ? mat : [mat]
  for (const m of materials) {
    const r = readMetalnessRoughnessFromMaterial(m)
    if (r) return r
  }
  return { metalness: null, roughness: null, hasMRMap: false }
}

/** Alle Meshes in Traversier-Reihenfolge (gleiche Reihenfolge wie traverse). */
export function collectMeshesFromGroup(group) {
  if (!group) return []
  const meshes = []
  group.traverse((obj) => {
    if (obj.isMesh) meshes.push(obj)
  })
  return meshes
}
