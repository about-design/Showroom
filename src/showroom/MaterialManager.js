import * as THREE from 'three'

const CAP_MATERIAL = { color: 0xd4d4d4, roughness: 0.55, metalness: 0.0 }

/**
 * Erkennung von Plastikkappen: Kleine Meshes die ganz oben auf den Ständern sitzen.
 * Kriterien: Mesh-Oberkante nahe Modell-Oberkante, Mesh-Höhe < 3% der Gesamthöhe,
 * Mesh-Unterkante oberhalb von 90% der Gesamthöhe.
 */
const CAP_MAX_HEIGHT_RATIO = 0.03
const CAP_MIN_Y_RATIO = 0.90
const CAP_TOP_TOLERANCE = 0.005 // 5 mm

/**
 * Findet färbbare Meshes (_colorable) und wendet RAL/Hex auf MeshStandardMaterial an.
 * Erkennt Kunststoffkappen (positionsbasiert) und weist ihnen eine feste, nicht-metallische Oberfläche zu.
 */
class MaterialManager {
  constructor() {
    this.currentHex = '#D7D7D7'
    this.currentRAL = 'RAL 7035'
    this.colorableMeshes = []
    this.capMeshes = []
  }

  /**
   * Durchsucht ein Object3D nach Meshes mit "_colorable" im Namen (Mesh oder Material).
   * Erkennt zusätzlich Kappen-Meshes anhand ihrer Position und weist ihnen die Kunststoff-Oberfläche zu.
   * @param {THREE.Object3D} object3D
   * @returns {THREE.Mesh[]}
   */
  traverseMeshes(object3D) {
    const colorable = []
    if (!object3D) return colorable

    const allMeshes = []
    object3D.traverse((o) => {
      if (!o.isMesh) return
      const nameLower = (o.name || '').toLowerCase()
      const matName = (o.material && !Array.isArray(o.material)) ? (o.material.name || '').toLowerCase() : ''
      if (nameLower.includes('_colorable') || matName.includes('_colorable')) {
        colorable.push(o)
      }
      allMeshes.push(o)
    })

    const caps = this.detectCapsByPosition(object3D, allMeshes)
    this.colorableMeshes = colorable.filter((m) => !caps.includes(m))
    this.capMeshes = caps
    if (caps.length) this.applyCapMaterial(caps)
    return this.colorableMeshes
  }

  /**
   * Erkennt Kappen anhand der Position: kleine Meshes ganz oben am Modell.
   * Ein Mesh gilt als Kappe wenn:
   *   1. Seine Oberkante nahe der Modell-Oberkante liegt (±5 mm)
   *   2. Seine Eigenhöhe < 3% der Gesamthöhe ist (typisch: ~10-15 mm bei 2000+ mm Ständer)
   *   3. Seine Unterkante oberhalb von 90% der Gesamthöhe liegt
   * @param {THREE.Object3D} object3D
   * @param {THREE.Mesh[]} allMeshes
   * @returns {THREE.Mesh[]}
   */
  detectCapsByPosition(object3D, allMeshes) {
    if (allMeshes.length < 2) return []

    const fullBox = new THREE.Box3().setFromObject(object3D)
    const modelHeight = fullBox.max.y - fullBox.min.y
    if (modelHeight < 0.3) return [] // Modell zu klein für Ständer mit Kappen

    const maxMeshHeight = modelHeight * CAP_MAX_HEIGHT_RATIO
    const minBottomY = fullBox.min.y + modelHeight * CAP_MIN_Y_RATIO
    const topY = fullBox.max.y

    const caps = []
    const tmpBox = new THREE.Box3()
    for (const mesh of allMeshes) {
      tmpBox.setFromObject(mesh)
      const meshHeight = tmpBox.max.y - tmpBox.min.y
      const nearTop = Math.abs(tmpBox.max.y - topY) < CAP_TOP_TOLERANCE
      const isSmall = meshHeight < maxMeshHeight
      const sitsOnTop = tmpBox.min.y > minBottomY

      if (nearTop && isSmall && sitsOnTop) {
        caps.push(mesh)
      }
    }

    if (caps.length && import.meta.env.DEV) {
      console.log(`[MaterialManager] ${caps.length} Kappe(n) erkannt:`,
        caps.map((m) => `${m.name || '(unnamed)'} (h=${(tmpBox.setFromObject(m), (tmpBox.max.y - tmpBox.min.y) * 1000).toFixed(1)}mm)`))
    }

    return caps
  }

  /**
   * Weist Kappen-Meshes eine feste Kunststoff-Oberfläche zu (hellgrau, matt, nicht-metallisch).
   * @param {THREE.Mesh[]} caps
   */
  applyCapMaterial(caps) {
    const mat = new THREE.MeshStandardMaterial(CAP_MATERIAL)
    mat.name = 'PlasticCap'
    caps.forEach((mesh) => {
      mesh.material = mat
    })
  }

  /**
   * Setzt die Farbe aller zuvor gefundenen (oder übergebenen) colorable Meshes.
   * Kappen-Meshes werden nicht eingefärbt.
   * @param {THREE.Object3D} object3D - Gruppe/Mesh des Produkts
   * @param {string} hexColor - z.B. "#D7D7D7"
   * @param {boolean} forceTraverse - wenn true, immer object3D durchsuchen (für Klone/zusammengesetzte Produkte)
   */
  applyRALColor(object3D, hexColor, forceTraverse = false) {
    if (!object3D && !this.colorableMeshes.length) return
    this.currentHex = hexColor
    const meshes = (forceTraverse && object3D) ? this.traverseMeshes(object3D) : (this.colorableMeshes.length ? this.colorableMeshes : this.traverseMeshes(object3D))
    const color = new THREE.Color(hexColor)
    meshes.forEach((mesh) => {
      if (!mesh.material) return
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((m) => { if (m.color) m.color.copy(color) })
      } else if (mesh.material.color) {
        mesh.material.color.copy(color)
      }
    })
  }

  /**
   * Setzt die aktuelle RAL-Bezeichnung (für UI).
   * @param {string} ralCode
   */
  setCurrentRAL(ralCode) {
    this.currentRAL = ralCode
  }

  /** @returns {string} Aktuelle Hex-Farbe */
  getCurrentColor() {
    return this.currentHex
  }

  /** @returns {string} Aktueller RAL-Code */
  getCurrentRAL() {
    return this.currentRAL
  }

  /** @returns {THREE.Mesh[]} Zuletzt erkannte Kappen-Meshes */
  getCapMeshes() {
    return this.capMeshes
  }

  /**
   * Berechnet die Höhe der Kappen über der Oberkante des restlichen Modells.
   * @param {THREE.Object3D} object3D - gesamtes Modell
   * @returns {number} Kappenhöhe in Metern (0 wenn keine Kappen)
   */
  getCapHeight(object3D) {
    if (!this.capMeshes.length || !object3D) return 0
    const fullBox = new THREE.Box3().setFromObject(object3D)
    const nonCapMaxY = this.computeNonCapMaxY(object3D)
    return Math.max(0, fullBox.max.y - nonCapMaxY)
  }

  /**
   * Berechnet die maximale Y-Höhe aller Nicht-Kappen-Meshes.
   * @param {THREE.Object3D} object3D
   * @returns {number}
   */
  computeNonCapMaxY(object3D) {
    const capSet = new Set(this.capMeshes)
    let maxY = -Infinity
    const tmpBox = new THREE.Box3()
    object3D.traverse((o) => {
      if (!o.isMesh || capSet.has(o)) return
      tmpBox.setFromObject(o)
      if (tmpBox.max.y > maxY) maxY = tmpBox.max.y
    })
    return maxY === -Infinity ? 0 : maxY
  }
}

export default new MaterialManager()
