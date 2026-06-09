import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import * as THREE from 'three'
import SceneManager from './SceneManager.js'
import gsap from 'gsap'
import { EURIS } from './eurisConstants.js'

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

    this._showroomControls = {
      minDistance: this.controls.minDistance,
      maxDistance: this.controls.maxDistance,
      maxPolarAngle: this.controls.maxPolarAngle,
      minPolarAngle: this.controls.minPolarAngle,
      dampingFactor: this.controls.dampingFactor,
      panSpeed: this.controls.panSpeed,
      cameraNear: this.camera.near,
      cameraFar: this.camera.far,
      targetY: this.controls.target.y,
    }
    this._eurisActive = false

    /** Aktuelle Brennweite (Kleinbild-Äquivalent, mm). 24 ≙ ~53° vFOV (nahe Three.js-Standard 60°). */
    this.focalLengthMm = 24
    this.setFocalLength(this.focalLengthMm)
  }

  /**
   * Setzt die Brennweite als Kleinbild-/Vollformat-Äquivalent (Sensorhöhe 24 mm)
   * und passt den vertikalen FOV der Three.js-PerspectiveCamera entsprechend an.
   * @param {number} mm - z. B. 16, 24, 50, 100, 200
   */
  setFocalLength(mm) {
    const f = Number(mm)
    if (!Number.isFinite(f) || f <= 0) return
    this.focalLengthMm = f
    const SENSOR_HEIGHT_MM = 24
    const vFovRad = 2 * Math.atan(SENSOR_HEIGHT_MM / (2 * f))
    this.camera.fov = (vFovRad * 180) / Math.PI
    this.camera.updateProjectionMatrix()
    this.controls.update()
  }

  /** @returns {number} aktuelle Brennweite in mm (Kleinbild-Äquivalent) */
  getFocalLength() {
    return this.focalLengthMm
  }

  /**
   * Euris (Babylon ArcRotateCamera → Orbit): Target 1,5 m, Zoom 0,5–35 m, Clipping 0,1–100 m.
   * @param {boolean} on
   */
  setEurisMode(on) {
    const c = this.controls
    const cam = this.camera
    const s = this._showroomControls
    if (on) {
      this._eurisActive = true
      cam.near = EURIS.cameraNear
      cam.far = EURIS.cameraFar
      cam.updateProjectionMatrix()
      c.target.set(0, EURIS.orbitTargetY, 0)
      c.minDistance = EURIS.minDistance
      c.maxDistance = EURIS.maxDistance
      c.maxPolarAngle = EURIS.maxPolarAngle
      c.minPolarAngle = EURIS.minPolarAngle
      c.dampingFactor = EURIS.dampingFactor
      c.panSpeed = EURIS.panSpeed
      cam.position.set(EURIS.cameraPosition.x, EURIS.cameraPosition.y, EURIS.cameraPosition.z)
    } else {
      this._eurisActive = false
      cam.near = s.cameraNear
      cam.far = s.cameraFar
      cam.updateProjectionMatrix()
      c.target.set(0, s.targetY, 0)
      c.minDistance = s.minDistance
      c.maxDistance = s.maxDistance
      c.maxPolarAngle = s.maxPolarAngle
      c.minPolarAngle = s.minPolarAngle
      c.dampingFactor = s.dampingFactor
      c.panSpeed = s.panSpeed
    }
    c.update()
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
   * Wechselt zur Ansicht einer Modell-Kamera (Position + Target, optional Brennweite).
   * @param {{ position: {x,y,z}, target: {x,y,z}, focalLength?: number }} view
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
    if (Number.isFinite(view.focalLength) && view.focalLength > 0) {
      this.setFocalLength(view.focalLength)
    }
  }

  /**
   * Liefert die aktuelle Kameraansicht: Position, Target und Brennweite.
   * Kann als Preset gespeichert und später per setToView() wieder angewendet werden.
   * @returns {{ position: {x:number,y:number,z:number}, target: {x:number,y:number,z:number}, focalLength: number }}
   */
  getCurrentView() {
    const p = this.camera.position
    const t = this.controls.target
    const u = this.camera.up
    return {
      position: { x: p.x, y: p.y, z: p.z },
      target: { x: t.x, y: t.y, z: t.z },
      /** Welt-Up wie von OrbitControls / PerspectiveCamera genutzt (für Blender-Look-at). */
      up: { x: u.x, y: u.y, z: u.z },
      focalLength: this.focalLengthMm,
    }
  }

  /** Dieselbe PerspectiveCamera wie SceneManager (OrbitControls-Objekt). */
  getCamera() {
    return this.camera
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
