import { createLogger } from '../lib/logger.js'
const log = createLogger("ProductLoader")

import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'

const eventTarget = new EventTarget()

/**
 * Lädt GLB-Dateien via GLTFLoader + Draco.
 * Events: load-progress, load-complete, load-error
 */
class ProductLoader {
  constructor() {
    this.cache = new Map()
    this.dracoLoader = new DRACOLoader()
    this.dracoLoader.setDecoderPath('/draco/')
    this.gltfLoader = new GLTFLoader()
    this.gltfLoader.setDRACOLoader(this.dracoLoader)
  }

  /**
   * Emittiert ein Custom-Event für UI/Progress.
   * @param {string} name - load-progress | load-complete | load-error
   * @param {any} detail
   */
  emit(name, detail = {}) {
    eventTarget.dispatchEvent(new CustomEvent(name, { detail }))
  }

  /**
   * Registriert einen Listener für Loader-Events.
   * @param {string} name
   * @param {(e: CustomEvent) => void} fn
   */
  on(name, fn) {
    eventTarget.addEventListener(name, fn)
  }

  /**
   * Lädt ein GLB (oder erstellt Platzhalter wenn Pfad fehlt/Placeholder).
   * @param {string} glbPath - z.B. /models/products/regal-classic.glb
   * @returns {Promise<THREE.Group>}
   */
  async loadProduct(glbPath) {
    const cacheKey = glbPath
    if (this.cache.has(cacheKey)) {
      const master = this.cache.get(cacheKey)
      return master.clone(true)
    }

    this.emit('load-progress', { progress: 0, path: glbPath })

    // Platzhalter nur, wenn ausdrücklich kein Pfad oder "placeholder" angegeben
    const usePlaceholder = !glbPath || glbPath.includes('placeholder')
    if (usePlaceholder) {
      const placeholder = this.createPlaceholder(glbPath || 'placeholder')
      this.emit('load-progress', { progress: 100, path: glbPath })
      this.emit('load-complete', { path: glbPath, model: placeholder })
      this.cache.set(cacheKey, placeholder)
      return placeholder.clone(true)
    }

    try {
      const gltf = await new Promise((resolve, reject) => {
        this.gltfLoader.load(
          glbPath,
          resolve,
          (xhr) => {
            const progress = xhr.lengthComputable ? (xhr.loaded / xhr.total) * 100 : 50
            this.emit('load-progress', { progress, path: glbPath })
          },
          reject
        )
      })
      const model = gltf.scene
      const lightsToRemove = []
      model.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true
          o.receiveShadow = true
        }
        if (o.isLight) lightsToRemove.push(o)
      })
      lightsToRemove.forEach((light) => {
        if (light.parent) light.parent.remove(light)
      })
      if (import.meta.env.DEV) {
        const names = []
        model.traverse((o) => { names.push({ name: o.name || '(unnamed)', type: o.type }) })
                log.scoped("ProductLoader").info("Szenenstruktur:", glbPath, names)
      }
      this.emit('load-progress', { progress: 100, path: glbPath })
      this.emit('load-complete', { path: glbPath, model })
      this.cache.set(cacheKey, model)
      return model.clone(true)
    } catch (err) {
      if (import.meta.env.DEV) log.scoped("ProductLoader").warn("GLB fehlgeschlagen, nutze Platzhalter:", glbPath, err)
      this.emit('load-error', { path: glbPath, error: err })
      const placeholder = this.createPlaceholder(glbPath)
      this.emit('load-complete', { path: glbPath, model: placeholder })
      this.cache.set(cacheKey, placeholder)
      return placeholder
    }
  }

  /**
   * Erstellt eine Box als Regal-Placeholder mit färbbarem Material (_colorable).
   * Größe variiert je nach Pfad/Produkt, damit der Wechsel in der Sidebar sichtbar ist.
   * @param {string} name - z.B. Pfad oder "regal-classic", "regal-heavy-duty", "regal-longspan"
   * @returns {THREE.Group}
   */
  createPlaceholder(name) {
    const group = new THREE.Group()
    group.name = name

    // Unterschiedliche Maße pro Produkt (Breite, Höhe, Tiefe), 1 Unit = 1 m
    let w = 1, h = 2, d = 0.6
    const path = (name || '').toLowerCase()
    if (path.includes('heavy-duty')) {
      w = 1.2
      h = 2.5
      d = 0.8
    } else if (path.includes('longspan') || path.includes('weitspann')) {
      w = 2
      h = 2
      d = 0.8
    }

    const frameGeo = new THREE.BoxGeometry(w, h, d)
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0xd7d7d7,
      roughness: 0.6,
      metalness: 0.3,
    })
    frameMat.name = 'Frame_colorable'
    const frame = new THREE.Mesh(frameGeo, frameMat)
    frame.name = 'Frame_colorable'
    frame.castShadow = true
    frame.receiveShadow = true
    group.add(frame)

    const shelfGeo = new THREE.BoxGeometry(w * 0.95, 0.05, d * 0.92)
    const shelfMat = new THREE.MeshStandardMaterial({
      color: 0xd7d7d7,
      roughness: 0.6,
      metalness: 0.3,
    })
    shelfMat.name = 'Shelf_Boards_colorable'
    const shelfCount = path.includes('heavy-duty') ? 5 : 4
    for (let i = 0; i < shelfCount; i++) {
      const shelf = new THREE.Mesh(shelfGeo, shelfMat.clone())
      shelf.name = 'Shelf_Boards_colorable'
      shelf.position.y = -h / 2 + 0.1 + (i * (h - 0.2)) / (shelfCount - 1)
      shelf.castShadow = true
      group.add(shelf)
    }

    return group
  }

  /**
   * Gibt das gecachte Master-Modell zurück (lädt bei Bedarf). Nur zum Klonen verwenden – nicht in die Szene einfügen.
   * @param {string} glbPath
   * @returns {Promise<THREE.Group>}
   */
  async getCachedOrLoad(glbPath) {
    const cacheKey = glbPath
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey)
    await this.loadProduct(glbPath)
    return this.cache.get(cacheKey)
  }

  /** Leert den Cache (z.B. bei Raumwechsel). */
  clearCache() {
    this.cache.clear()
  }
}

export default new ProductLoader()
