import * as THREE from 'three'
import SceneManager from './SceneManager.js'

export const PERF_STRESS_GROUP_NAME = 'perf-stress'

/**
 * @param {THREE.BufferGeometry} geom
 * @returns {number}
 */
function triangleCount(geom) {
  if (!geom) return 0
  if (geom.index) return Math.floor(geom.index.count / 3)
  const pos = geom.attributes?.position
  return pos ? Math.floor(pos.count / 3) : 0
}

/**
 * @param {THREE.Texture} tex
 * @returns {number}
 */
function textureBytesEstimate(tex) {
  if (!tex || !tex.isTexture) return 0
  const img = tex.image
  let w = img?.width ?? img?.videoWidth ?? tex.source?.data?.width ?? tex.width ?? 0
  let h = img?.height ?? img?.videoHeight ?? tex.source?.data?.height ?? tex.height ?? 0
  if (!w || !h) return 0
  let bytes = w * h * 4
  if (tex.generateMipmaps !== false) bytes *= 4 / 3
  return Math.round(bytes)
}

/**
 * @param {THREE.Object3D|null|undefined} root
 * @returns {import('three').Material[]}
 */
function collectMaterialsFromObject(root) {
  const list = []
  if (!root) return list
  root.traverse((o) => {
    if (!o.isMesh && !o.isLine && !o.isLineSegments && !o.isPoints) return
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    for (const m of mats) {
      if (m) list.push(m)
    }
  })
  return list
}

/**
 * Geometrie- und Mesh-Statistik (gleiche Traversierreihenfolge wie meshInfoList in main.js).
 * @param {THREE.Object3D|null|undefined} root
 */
export function measureModel(root) {
  if (!root) return null

  const meshRows = []
  let vertices = 0
  let triangles = 0
  const geomUuids = new Set()
  const matUuids = new Set()

  let meshIndex = 0
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry) return
    const geom = obj.geometry
    const v = geom.attributes?.position?.count ?? 0
    const t = triangleCount(geom)
    vertices += v
    triangles += t
    geomUuids.add(geom.uuid)
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats) {
      if (m) matUuids.add(m.uuid)
    }
    meshRows.push({
      index: meshIndex++,
      name: obj.name || '(ohne Namen)',
      vertices: v,
      triangles: t,
    })
  })

  const topMeshes = [...meshRows]
    .sort((a, b) => b.triangles - a.triangles || b.vertices - a.vertices)
    .slice(0, 5)

  return {
    vertices,
    triangles,
    meshes: meshRows.length,
    uniqueGeometries: geomUuids.size,
    uniqueMaterials: matUuids.size,
    meshRows,
    topMeshes,
  }
}

/**
 * Schätzung GPU-Speicher (Geometrie-Attribute + Texturen, dedupliziert per UUID).
 * @param {THREE.Object3D|null|undefined} root
 */
export function estimateGpuMemory(root) {
  if (!root) {
    return {
      geometryBytes: 0,
      textureBytes: 0,
      geomMb: 0,
      texMb: 0,
      totalMb: 0,
    }
  }

  const seenGeom = new Set()
  let geometryBytes = 0
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return
    const geom = o.geometry
    if (seenGeom.has(geom.uuid)) return
    seenGeom.add(geom.uuid)
    for (const key of Object.keys(geom.attributes || {})) {
      const attr = geom.attributes[key]
      if (attr?.array?.byteLength) geometryBytes += attr.array.byteLength
    }
    if (geom.index?.array?.byteLength) geometryBytes += geom.index.array.byteLength
  })

  const seenTex = new Set()
  let textureBytes = 0
  const materials = collectMaterialsFromObject(root)
  for (const mat of materials) {
    for (const key of Object.keys(mat)) {
      const v = mat[key]
      if (!v || !v.isTexture || seenTex.has(v.uuid)) continue
      seenTex.add(v.uuid)
      textureBytes += textureBytesEstimate(v)
    }
  }

  const geomMb = geometryBytes / (1024 * 1024)
  const texMb = textureBytes / (1024 * 1024)
  return {
    geometryBytes,
    textureBytes,
    geomMb,
    texMb,
    totalMb: geomMb + texMb,
  }
}

class PerformanceMonitor {
  constructor() {
    this._fpsFrame = 0
    this._fpsDeltas = []
    this._onTick = null
  }

  measureModel(root) {
    return measureModel(root)
  }

  estimateGpuMemory(root) {
    return estimateGpuMemory(root)
  }

  /**
   * @param {(delta: number) => void} fn
   */
  startFpsSampling(fn) {
    this.stopFpsSampling()
    this._fpsFrame = 0
    this._fpsDeltas = []
    this._onTick = (delta) => {
      this._fpsFrame += 1
      if (this._fpsFrame > 10) this._fpsDeltas.push(delta)
      if (typeof fn === 'function') fn(delta)
    }
    SceneManager.addTickListener(this._onTick)
  }

  stopFpsSampling() {
    if (this._onTick) {
      SceneManager.removeTickListener(this._onTick)
      this._onTick = null
    }
  }

  /**
   * @returns {{ min: number, avg: number, max: number, frames: number, durationS: number, drawCalls?: number, triRender?: number }|null}
   */
  readFpsStats(durationS) {
    const deltas = this._fpsDeltas
    if (!deltas.length) return null
    const fps = deltas.map((d) => 1 / Math.max(d, 1e-9))
    const min = Math.min(...fps)
    const max = Math.max(...fps)
    const avg = fps.reduce((a, b) => a + b, 0) / fps.length
    return {
      min,
      avg,
      max,
      frames: deltas.length,
      durationS: durationS ?? 0,
    }
  }

  /**
   * Entfernt die Stresstest-Gruppe aus der Szene (kein dispose – geteilte Geometrien/Materialien).
   * @param {THREE.Scene} scene
   */
  clearStress(scene) {
    if (!scene) return
    for (let i = scene.children.length - 1; i >= 0; i--) {
      const c = scene.children[i]
      if (c.name === PERF_STRESS_GROUP_NAME) scene.remove(c)
    }
  }

  /**
   * @param {{
   *   sourceRoot: THREE.Object3D,
   *   count: number,
   *   scene: THREE.Scene,
   *   sampleMs?: number,
   * }} opts
   */
  async runStress({ sourceRoot, count, scene, sampleMs = 2000 }) {
    this.clearStress(scene)
    if (!sourceRoot || !scene || count < 1) return null

    sourceRoot.updateMatrixWorld(true)
    const boxWorld = new THREE.Box3().setFromObject(sourceRoot)
    const size = boxWorld.getSize(new THREE.Vector3())
    const step = Math.max(size.x, size.z, 0.01) * 1.1

    const cols = Math.ceil(Math.sqrt(count))
    const stressGroup = new THREE.Group()
    stressGroup.name = PERF_STRESS_GROUP_NAME

    const min = boxWorld.min
    const max = boxWorld.max
    const margin = step * 0.55
    stressGroup.position.set(max.x + margin, min.y, (min.z + max.z) * 0.5)
    scene.add(stressGroup)

    for (let i = 0; i < count; i++) {
      const inst = sourceRoot.clone(true)
      const col = i % cols
      const row = Math.floor(i / cols)
      inst.position.set(col * step, 0, row * step)
      stressGroup.add(inst)
    }
    stressGroup.updateMatrixWorld(true)

    this.startFpsSampling()
    const t0 = performance.now()
    await new Promise((resolve) => {
      setTimeout(resolve, sampleMs)
    })
    const durationS = (performance.now() - t0) / 1000
    this.stopFpsSampling()

    const base = this.readFpsStats(durationS)
    SceneManager.getRenderer()
    let drawCalls
    let triRender
    if (renderer?.info?.render) {
      drawCalls = renderer.info.render.calls
      triRender = renderer.info.render.triangles
    }

    if (!base) {
      return {
        count,
        min: 0,
        avg: 0,
        max: 0,
        frames: 0,
        durationS,
        drawCalls,
        triRender,
      }
    }

    return {
      count,
      min: base.min,
      avg: base.avg,
      max: base.max,
      frames: base.frames,
      durationS,
      drawCalls,
      triRender,
    }
  }
}

const performanceMonitor = new PerformanceMonitor()
export default performanceMonitor
