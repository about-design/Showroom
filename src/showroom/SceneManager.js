import { createLogger } from '../lib/logger.js'
const log = createLogger("SceneManager")

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
            log.scoped("SceneManager").warn("#canvas-container nicht gefunden")
      return
    }

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0xfafafa)
    this.scene.environment = null

    const aspect = this.container.clientWidth / this.container.clientHeight
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 10000)
    this.camera.position.set(0, 2, 6)
    this.camera.lookAt(0, 1, 0)

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.baseExposure = 0.8
    this.renderer.toneMappingExposure = this.baseExposure
    this.renderer.shadowMap.enabled = true
    /** VSMShadowMap: echte Gauss-geblurrte (sehr weiche) Schatten. PCFSoft ignoriert shadow.radius/blurSamples. */
    this.renderer.shadowMap.type = THREE.VSMShadowMap
    this.container.appendChild(this.renderer.domElement)

    this.clock = new THREE.Clock()
    this.isRunning = false
    this.animationFrameId = null
    /** @type {Set<(delta: number) => void>} */
    this._tickListeners = new Set()

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
      this._tickListeners.forEach((fn) => {
        try {
          fn(delta)
        } catch (e) {
                    log.scoped("SceneManager").error("tick listener:", e)
        }
      })
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
   * Zusätzliche Render-Loop-Callbacks (nach render, vor legacy `onTick`).
   * @param {(delta: number) => void} fn
   */
  addTickListener(fn) {
    if (typeof fn === 'function') this._tickListeners.add(fn)
  }

  /**
   * @param {(delta: number) => void} fn
   */
  removeTickListener(fn) {
    this._tickListeners.delete(fn)
  }

  /**
   * Setzt die Tonemapping-Exposure (0 = dunkel, 1 = 100 % Basis).
   * @param {number} value - 0 … 1
   */
  setExposure(value) {
    const v = Math.max(0, Math.min(1, value))
    this.renderer.toneMappingExposure = this.baseExposure * v
  }

  /**
   * GLB Lighting Lab: Exposure wie im Original (Faktor × Basis-Renderer-Exposure), zusätzlich Nutzer-Dimmung.
   * @param {number} labExposure - Preset sE (typ. 0,9…1,3)
   * @param {number} dim01 - 0…1 (z. B. aus Lichtregler)
   */
  setLabExposure(labExposure, dim01) {
    const d = Math.max(0, Math.min(1, dim01))
    const e = Math.max(0, Number(labExposure) || 0)
    this.renderer.toneMappingExposure = this.baseExposure * e * d
  }

  /** Euris: absolute Exposure wie im Babylon-Dokument (1.0 bei vollem Regler). */
  setToneMappingExposureAbsolute(value) {
    this.renderer.toneMappingExposure = Math.max(0, Number(value) || 0)
  }

  /**
   * Erstellt ein PNG der aktuellen Szene. Mit { transparent: true } wird der
   * Hintergrund (scene.background) entfernt und der Renderer mit Alpha=0 geleert,
   * sodass nur die Objekte sichtbar sind. Hintergrund-Meshes (Boden/Wände) müssen
   * vor dem Aufruf vom Caller ausgeblendet werden, danach wiederhergestellt.
   * @param {{ transparent?: boolean, mimeType?: string, quality?: number }} [opts]
   * @returns {Promise<Blob>} PNG-Blob der gerenderten Szene
   */
  captureScreenshot(opts = {}) {
    const { transparent = true, mimeType = 'image/png', quality = 1 } = opts
    return new Promise((resolve, reject) => {
      if (!this.renderer || !this.scene || !this.camera) {
        reject(new Error('SceneManager nicht initialisiert'))
        return
      }
      const wasRunning = this.isRunning
      if (wasRunning) this.stop()

      const oldBg = this.scene.background
      const oldClearColor = new THREE.Color()
      this.renderer.getClearColor(oldClearColor)
      const oldClearAlpha = this.renderer.getClearAlpha()

      try {
        if (transparent) {
          this.scene.background = null
          this.renderer.setClearColor(0x000000, 0)
        }
        this.renderer.clear()
        this.renderer.render(this.scene, this.camera)

        this.renderer.domElement.toBlob(
          (blob) => {
            this.scene.background = oldBg
            this.renderer.setClearColor(oldClearColor, oldClearAlpha)
            if (wasRunning) this.start()
            if (!blob) reject(new Error('toBlob() lieferte null'))
            else resolve(blob)
          },
          mimeType,
          quality,
        )
      } catch (err) {
        this.scene.background = oldBg
        this.renderer.setClearColor(oldClearColor, oldClearAlpha)
        if (wasRunning) this.start()
        reject(err)
      }
    })
  }

  /**
   * @param {number|string} color - Hex-Zahl (0xfafafa) oder CSS-String (#1a1c20)
   */
  setBackgroundColor(color) {
    if (!this.scene) return
    const c = typeof color === 'string' ? parseInt(color.replace('#', ''), 16) : color
    if (!Number.isFinite(c)) return
    this.scene.background = new THREE.Color(c)
  }
}

const instance = new SceneManager()
export default instance
