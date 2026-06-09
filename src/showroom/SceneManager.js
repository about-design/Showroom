import * as THREE from 'three'

/**
 * Zentrale Klasse für WebGL Renderer, Scene, Camera und Render-Loop.
 * Singleton – einziger Zugang zur Three.js Scene für alle anderen Module.
 */
class SceneManager {
  constructor() {
    if (SceneManager.instance) return SceneManager.instance
    SceneManager.instance = this

    this.container = document.getElementById('canvas-container')
    if (!this.container) {
      console.warn('[SceneManager] #canvas-container nicht gefunden')
      return
    }

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0xfafafa)
    this.scene.environment = null

    const aspect = this.container.clientWidth / this.container.clientHeight
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 10000)
    this.camera.position.set(0, 2, 6)
    this.camera.lookAt(0, 1, 0)

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.baseExposure = 0.8
    this.renderer.toneMappingExposure = this.baseExposure
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.container.appendChild(this.renderer.domElement)

    this.clock = new THREE.Clock()
    this.isRunning = false
    this.animationFrameId = null

    window.addEventListener('resize', () => this.onResize())
  }

  /**
   * Startet den Render-Loop.
   */
  start() {
    if (this.isRunning) return
    this.isRunning = true
    this.clock.start()
    const loop = () => {
      this.animationFrameId = requestAnimationFrame(loop)
      const delta = this.clock.getDelta()
      this.renderer.render(this.scene, this.camera)
      if (this.onTick) this.onTick(delta)
    }
    loop()
  }

  /**
   * Stoppt den Render-Loop.
   */
  stop() {
    this.isRunning = false
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = null
    }
  }

  /**
   * Window-Resize: Renderer und Kamera anpassen.
   */
  onResize() {
    if (!this.container) return
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
  }

  /** @returns {THREE.Scene} */
  getScene() { return this.scene }

  /** @returns {THREE.PerspectiveCamera} */
  getCamera() { return this.camera }

  /** @returns {THREE.WebGLRenderer} */
  getRenderer() { return this.renderer }

  /** @returns {THREE.Clock} */
  getClock() { return this.clock }

  /**
   * Setzt die Tonemapping-Exposure (0 = dunkel, 1 = 100 % Basis).
   * @param {number} value - 0 … 1
   */
  setExposure(value) {
    const v = Math.max(0, Math.min(1, value))
    this.renderer.toneMappingExposure = this.baseExposure * v
  }
}

const instance = new SceneManager()
export default instance
