import * as THREE from 'three'
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js'
import SceneManager from './SceneManager.js'

/**
 * HDRI Environment (wenn vorhanden) + Spotlights / Ambient für den Lagerraum.
 */
/** Basis-Intensitäten (+20 %) – werden mit dem Regler skaliert */
const BASE = {
  ambient: 0.216,
  main: 0.264,
  fill: 0.06,
  sideLeft: 0.336,
  sideRight: 0.336,
  frontPanel: 3,
  backLeft: 0.24,
  backRight: 0.24,
  topDown: 0.8,
}

class LightingManager {
  constructor() {
    this.scene = SceneManager.getScene()
    this.lights = {}
    this.intensity = 1
  }

  /**
   * Setzt Standard-Beleuchtung (ohne HDRI): weich für metallische Oberflächen inkl. Seitenlicht.
   */
  init() {
    RectAreaLightUniformsLib.init()

    const ambient = new THREE.AmbientLight(0xffffff, BASE.ambient)
    this.scene.add(ambient)
    this.lights.ambient = ambient

    const main = new THREE.DirectionalLight(0xfff8f0, BASE.main)
    main.position.set(5, 8, 5)
    main.castShadow = true
    main.shadow.mapSize.width = 2048
    main.shadow.mapSize.height = 2048
    main.shadow.radius = 4
    main.shadow.camera.near = 0.5
    main.shadow.camera.far = 50
    main.shadow.camera.left = -10
    main.shadow.camera.right = 10
    main.shadow.camera.top = 10
    main.shadow.camera.bottom = -10
    this.scene.add(main)
    this.lights.main = main

    const fill = new THREE.DirectionalLight(0xe8eeff, BASE.fill)
    fill.position.set(-3, 4, 3)
    this.scene.add(fill)
    this.lights.fill = fill

    // Links: Licht von links (negatives X), gleiche Tiefe wie Regale (z=0) → beleuchtet linke Regalseite
    const sideLeft = new THREE.DirectionalLight(0xfffaf0, BASE.sideLeft)
    sideLeft.position.set(-9, 1.5, 0)
    sideLeft.target.position.set(-1, 1, 0)
    this.scene.add(sideLeft.target)
    this.scene.add(sideLeft)
    this.lights.sideLeft = sideLeft

    // Rechts: Licht von rechts (positives X), z=0 → beleuchtet rechte Regalseite
    const sideRight = new THREE.DirectionalLight(0xfffaf0, BASE.sideRight)
    sideRight.position.set(9, 1.5, 0)
    sideRight.target.position.set(1, 1, 0)
    this.scene.add(sideRight.target)
    this.scene.add(sideRight)
    this.lights.sideRight = sideRight

    // Flächenleuchte vorne (RectAreaLight)
    const frontPanel = new THREE.RectAreaLight(0xffffff, BASE.frontPanel, 10, 4)
    frontPanel.position.set(0, 2.5, 5.5)
    frontPanel.lookAt(0, 1, 0)
    this.scene.add(frontPanel)
    this.lights.frontPanel = frontPanel

    // Aus Richtung der (blauen) Pfeile: hinten links → zur Szene, hinten rechts → zur Szene
    const backLeft = new THREE.DirectionalLight(0xfffaf0, BASE.backLeft)
    backLeft.position.set(-6, 1.8, -4)
    backLeft.target.position.set(0, 1, 0)
    this.scene.add(backLeft.target)
    this.scene.add(backLeft)
    this.lights.backLeft = backLeft

    const backRight = new THREE.DirectionalLight(0xfffaf0, BASE.backRight)
    backRight.position.set(6, 1.8, -4)
    backRight.target.position.set(0, 1, 0)
    this.scene.add(backRight.target)
    this.scene.add(backRight)
    this.lights.backRight = backRight

    const topDown = new THREE.DirectionalLight(0xffffff, BASE.topDown)
    topDown.position.set(0, 10, -4)
    topDown.target.position.set(0, 0, 2)
    topDown.castShadow = false
    this.scene.add(topDown.target)
    this.scene.add(topDown)
    this.lights.topDown = topDown
  }

  /**
   * Setzt die Lichtstärke (0 = dunkel, 1 = 100 % der Basis-Werte). Gilt für alle Lichter inkl. Seitenlicht.
   * @param {number} value - 0 … 1
   */
  setIntensity(value) {
    this.intensity = Math.max(0, Math.min(1, value))
    if (this.lights.ambient) this.lights.ambient.intensity = BASE.ambient * this.intensity
    if (this.lights.main) this.lights.main.intensity = BASE.main * this.intensity
    if (this.lights.fill) this.lights.fill.intensity = BASE.fill * this.intensity
    if (this.lights.sideLeft) this.lights.sideLeft.intensity = BASE.sideLeft * this.intensity
    if (this.lights.sideRight) this.lights.sideRight.intensity = BASE.sideRight * this.intensity
    if (this.lights.frontPanel) this.lights.frontPanel.intensity = BASE.frontPanel * this.intensity
    if (this.lights.backLeft) this.lights.backLeft.intensity = BASE.backLeft * this.intensity
    if (this.lights.backRight) this.lights.backRight.intensity = BASE.backRight * this.intensity
    if (this.lights.topDown) this.lights.topDown.intensity = BASE.topDown * this.intensity
  }

  /**
   * Optional: HDRI als Environment setzen (wenn RoomEnvironment/SceneManager es lädt).
   * @param {THREE.Texture} envMap
   */
  setEnvironmentMap(envMap) {
    if (!envMap) return
    envMap.mapping = THREE.EquirectangularReflectionMapping
    this.scene.environment = envMap
  }
}

export default new LightingManager()
