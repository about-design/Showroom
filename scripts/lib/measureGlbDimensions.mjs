/**
 * Maße (B × H × T in mm) aus GLB per Axis-Aligned Bounding Box.
 * Optional `rotationOffset` wie im Showroom (THREE Euler XYZ).
 */
import { existsSync } from 'node:fs'
import { NodeIO } from '@gltf-transform/core'
import { getBounds } from '@gltf-transform/functions'
import * as THREE from 'three'

const DEG = Math.PI / 180

/**
 * @param {{ min: number[], max: number[] }} bounds
 * @param {{ x?: number, y?: number, z?: number }|null|undefined} rotationOffset
 */
function boundsWithRotationOffset(bounds, rotationOffset) {
  const min = bounds.min
  const max = bounds.max
  if (!rotationOffset || (!rotationOffset.x && !rotationOffset.y && !rotationOffset.z)) {
    return bounds
  }
  const box = new THREE.Box3(
    new THREE.Vector3(min[0], min[1], min[2]),
    new THREE.Vector3(max[0], max[1], max[2]),
  )
  const euler = new THREE.Euler(
    (rotationOffset.x ?? 0) * DEG,
    (rotationOffset.y ?? 0) * DEG,
    (rotationOffset.z ?? 0) * DEG,
    'XYZ',
  )
  const m = new THREE.Matrix4().makeRotationFromEuler(euler)
  const out = new THREE.Box3()
  const p = new THREE.Vector3()
  const xs = [box.min.x, box.max.x]
  const ys = [box.min.y, box.max.y]
  const zs = [box.min.z, box.max.z]
  for (const x of xs) {
    for (const y of ys) {
      for (const z of zs) {
        p.set(x, y, z).applyMatrix4(m)
        out.expandByPoint(p)
      }
    }
  }
  return { min: [out.min.x, out.min.y, out.min.z], max: [out.max.x, out.max.y, out.max.z] }
}

export function formatMmSpec(mm) {
  if (!Number.isFinite(mm) || mm <= 0) return ''
  return `${Math.round(mm)} mm`
}

/**
 * @param {string} glbAbsPath
 * @param {{ x?: number, y?: number, z?: number }|null|undefined} [rotationOffset]
 * @returns {Promise<{ width: number, height: number, depth: number }|null>}
 */
export async function measureGlbDimensionsMm(glbAbsPath, rotationOffset = null) {
  if (!glbAbsPath || !existsSync(glbAbsPath)) return null
  try {
    const io = new NodeIO()
    const doc = await io.read(glbAbsPath)
    const scenes = doc.getRoot().listScenes()
    const scene = scenes[0]
    if (!scene) return null
    let { min, max } = getBounds(scene)
    if (!min?.every?.(Number.isFinite) || !max?.every?.(Number.isFinite)) return null
    ;({ min, max } = boundsWithRotationOffset({ min, max }, rotationOffset))
    const width = Math.round((max[0] - min[0]) * 1000)
    const height = Math.round((max[1] - min[1]) * 1000)
    const depth = Math.round((max[2] - min[2]) * 1000)
    if (!width && !height && !depth) return null
    return { width, height, depth }
  } catch {
    return null
  }
}

/**
 * @param {object} product
 * @param {{ width: number, height: number, depth: number }} dims
 */
export function applyDimensionsToProductSpecs(product, dims) {
  const specs = product.specs && typeof product.specs === 'object' ? { ...product.specs } : {}
  if (!specs.load) specs.load = '–'
  specs.width = formatMmSpec(dims.width)
  specs.height = formatMmSpec(dims.height)
  specs.depth = formatMmSpec(dims.depth)
  product.specs = specs
}
