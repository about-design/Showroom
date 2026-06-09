import * as THREE from 'three'
import SceneManager from './SceneManager.js'

/**
 * Baut den virtuellen Raum: endloser Boden, keine Wände, PlacementZones.
 */
class RoomEnvironment {
  constructor() {
    this.scene = SceneManager.getScene()
    this.placementZones = []
    this.meshes = { floor: null, walls: null, ceilingLight: null }
    this.showWalls = false
  }

  /**
   * Initialisiert den Raum (endlos wirkender Boden, optional Wände).
   * @param {Array<{id: string, position: {x,y,z}, rotation: number}>} zones
   */
  init(zones = []) {
    this.placementZones = zones

    // Endlos-Boden: sehr groß, gleiche Farbe wie Hintergrund → keine Kante
    const floorSize = 4000
    const floorGeo = new THREE.PlaneGeometry(floorSize, floorSize)
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0xfafafa,
      roughness: 0.85,
      metalness: 0.05,
    })
    this.meshes.floor = new THREE.Mesh(floorGeo, floorMat)
    this.meshes.floor.rotation.x = -Math.PI / 2
    this.meshes.floor.receiveShadow = true
    this.scene.add(this.meshes.floor)

    if (this.showWalls) {
      const wallGeo = new THREE.PlaneGeometry(20, 4)
      const wallMat = new THREE.MeshStandardMaterial({ color: 0xd1d5db, roughness: 0.8, metalness: 0.05 })
      const backWall = new THREE.Mesh(wallGeo, wallMat)
      backWall.position.set(0, 2, -6)
      this.scene.add(backWall)
      this.meshes.walls = backWall
    }

    // Deckenfläche im Endlosraum aus – nur noch Lichtregler steuert Helligkeit
    const lightGeo = new THREE.PlaneGeometry(1, 1)
    this.ceilingBaseOpacity = 0
    const lightMat = new THREE.MeshBasicMaterial({
      color: 0xfff8e7,
      transparent: true,
      opacity: 0,
    })
    this.meshes.ceilingLight = new THREE.Mesh(lightGeo, lightMat)
    this.meshes.ceilingLight.visible = false
    this.scene.add(this.meshes.ceilingLight)
  }

  /**
   * Deckenfläche an Lichtregler koppeln (0 = unsichtbar, 1 = volle Opacity).
   * @param {number} value - 0 … 1
   */
  setCeilingIntensity(value) {
    if (!this.meshes.ceilingLight || !this.meshes.ceilingLight.material) return
    this.meshes.ceilingLight.material.opacity = this.ceilingBaseOpacity * Math.max(0, Math.min(1, value))
  }

  /**
   * Gibt die Weltposition einer PlacementZone zurück.
   * @param {string} zoneId
   * @returns {THREE.Vector3|null}
   */
  getZonePosition(zoneId) {
    const zone = this.placementZones.find(z => z.id === zoneId)
    if (!zone) return null
    return new THREE.Vector3(zone.position.x, zone.position.y, zone.position.z)
  }

  /**
   * Gibt die Rotation der Zone in Radiant zurück (Y-Achse).
   * @param {string} zoneId
   * @returns {number}
   */
  getZoneRotation(zoneId) {
    const zone = this.placementZones.find(z => z.id === zoneId)
    return zone ? (zone.rotation ?? 0) * (Math.PI / 180) : 0
  }

  /** @returns {Array} */
  getPlacementZones() {
    return this.placementZones
  }

  /** Optionale Wände ein/aus */
  setWallsVisible(visible) {
    this.showWalls = visible
    if (this.meshes.walls) this.meshes.walls.visible = visible
  }
}

export default new RoomEnvironment()
