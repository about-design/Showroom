import * as THREE from 'three'
import SceneManager from './SceneManager.js'
import ProductPlacement from './ProductPlacement.js'

const MARKER_RADIUS = 0.02
const MARKER_COLOR = 0xff4444

/**
 * Zeigt die Pivot Points (Nullpunkte) der platzierten Objekte als kleine Kugeln an.
 */
class PivotDebugView {
  constructor() {
    this.group = null
    this.markers = []
    this.visible = false
  }

  init() {
    this.group = new THREE.Group()
    this.group.name = 'pivot-debug'
    SceneManager.getScene().add(this.group)
  }

  setVisible(visible) {
    this.visible = !!visible
    if (this.group) this.group.visible = this.visible
  }

  toggle() {
    this.setVisible(!this.visible)
  }

  createMarker() {
    const geo = new THREE.SphereGeometry(MARKER_RADIUS, 12, 8)
    const mat = new THREE.MeshBasicMaterial({ color: MARKER_COLOR })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.name = 'pivot-marker'
    return mesh
  }

  updatePositions(zoneId) {
    if (!this.group) return
    if (!this.visible) return

    const placement = ProductPlacement.getPlacement(zoneId)
    if (!placement?.group) {
      this.markers.forEach((m) => this.group.remove(m))
      this.markers = []
      return
    }

    const children = placement.group.children
    while (this.markers.length < children.length) {
      const m = this.createMarker()
      this.markers.push(m)
      this.group.add(m)
    }
    while (this.markers.length > children.length) {
      const m = this.markers.pop()
      this.group.remove(m)
    }

    const worldPos = new THREE.Vector3()
    placement.group.updateMatrixWorld(true)
    children.forEach((child, i) => {
      child.getWorldPosition(worldPos)
      this.markers[i].position.copy(worldPos)
    })
  }
}

const instance = new PivotDebugView()
export default instance
