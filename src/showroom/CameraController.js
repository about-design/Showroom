import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import * as THREE from 'three'
import SceneManager from './SceneManager.js'
import gsap from 'gsap'

/**
 * OrbitControls: Drehen um den aktuellen Drehpunkt, Klick setzt keinen neuen Pivot.
 */
class CameraController {
  constructor() {
    this.camera = SceneManager.getCamera()
    this.renderer = SceneManager.getRenderer()
    this.domElement = this.renderer.domElement
    this.controls = new OrbitControls(this.camera, this.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.05
    this.controls.minDistance = 2
    this.controls.maxDistance = 20
    this.controls.maxPolarAngle = Math.PI / 2 - 0.1
    this.controls.target.set(0, 1, 0)

    this.startPosition = new THREE.Vector3().copy(this.camera.position)
    this.startTarget = new THREE.Vector3().copy(this.controls.target)
  }

  /**
   * Wird im Render-Loop aufgerufen (Controls müssen updated werden).
   */
  update() {
    this.controls.update()
  }

  /**
   * Animiert die Kamera so, dass das Produkt zentriert und vollständig im Bild ist.
   * Bei angegebener Bounding-Box wird der Abstand so gewählt, dass die gesamte Breite/Höhe ins Bild passt.
   * @param {THREE.Vector3|{x,y,z}} position - Weltposition des Fokuspunkts (Mitte)
   * @param {number} duration
   * @param {THREE.Box3|null} worldBox - optionale Welt-Bounding-Box des Produkts (für Framing)
   */
  focusProduct(position, duration = 0.8, worldBox = null) {
    const target = position instanceof THREE.Vector3
      ? position
      : new THREE.Vector3(position.x, position.y, position.z)
    const cam = this.camera
    const controls = this.controls

    const dir = new THREE.Vector3(0, 1.5, 3).normalize()
    let distance = dir.length()
    if (worldBox) {
      const sphere = new THREE.Sphere()
      worldBox.getBoundingSphere(sphere)
      const aspect = this.renderer.domElement.clientWidth / this.renderer.domElement.clientHeight
      const vFov = (cam.fov * Math.PI) / 180
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect)
      const margin = 1.4
      const minDistance = Math.max(sphere.radius / Math.tan(hFov / 2), sphere.radius / Math.tan(vFov / 2)) * margin
      distance = THREE.MathUtils.clamp(minDistance, this.controls.minDistance, this.controls.maxDistance)
    } else {
      distance = new THREE.Vector3(0, 1.5, 3).length()
    }

    const desiredPos = new THREE.Vector3().copy(target).add(dir.clone().multiplyScalar(distance))

    gsap.to(cam.position, {
      x: desiredPos.x,
      y: desiredPos.y,
      z: desiredPos.z,
      duration,
      ease: 'power2.inOut',
    })
    gsap.to(controls.target, {
      x: target.x,
      y: target.y,
      z: target.z,
      duration,
      ease: 'power2.inOut',
    })
  }

  /**
   * Wechselt zur Ansicht einer Modell-Kamera (Position + Target).
   * @param {{ position: {x,y,z}, target: {x,y,z} }} view
   * @param {number} duration
   */
  setToView(view, duration = 0.6) {
    if (!view || !view.position || !view.target) return
    const cam = this.camera
    const controls = this.controls
    gsap.to(cam.position, {
      x: view.position.x,
      y: view.position.y,
      z: view.position.z,
      duration,
      ease: 'power2.inOut',
    })
    gsap.to(controls.target, {
      x: view.target.x,
      y: view.target.y,
      z: view.target.z,
      duration,
      ease: 'power2.inOut',
    })
  }

  /**
   * Setzt Kamera und Target auf Startposition zurück.
   */
  resetCamera() {
    gsap.to(this.camera.position, {
      x: this.startPosition.x,
      y: this.startPosition.y,
      z: this.startPosition.z,
      duration: 0.8,
      ease: 'power2.inOut',
    })
    gsap.to(this.controls.target, {
      x: this.startTarget.x,
      y: this.startTarget.y,
      z: this.startTarget.z,
      duration: 0.8,
      ease: 'power2.inOut',
    })
  }

  /** @returns {OrbitControls} */
  getControls() {
    return this.controls
  }
}

export default new CameraController()
