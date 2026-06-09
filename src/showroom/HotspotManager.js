import * as THREE from 'three'
import SceneManager from './SceneManager.js'

const eventTarget = new EventTarget()
const HOTSPOT_CLICK = 'hotspot-click'

/**
 * Projiziert 3D-Hotspots auf 2D, rendert HTML-Marker, bei Klick → Event für Alpine.js.
 */
class HotspotManager {
  constructor() {
    this.camera = SceneManager.getCamera()
    this.renderer = SceneManager.getRenderer()
    this.container = document.getElementById('hotspot-container')
    this.hotspots = [] // { id, position (Vector3), title, content, element, parentObject3D }
    this.visibleRange = new THREE.Vector3(0, 0, -1)
  }

  /**
   * Registriert einen Listener für Hotspot-Klicks.
   * @param {(e: CustomEvent<{id: string, title: string, content: string}>) => void} fn
   */
  onHotspotClick(fn) {
    eventTarget.addEventListener(HOTSPOT_CLICK, fn)
  }

  /**
   * Fügt einen Hotspot hinzu (3D-Position relativ zu parentObject3D).
   * @param {object} hotspotData - { id, position: {x,y,z}, title, content, icon? }
   * @param {THREE.Object3D} parentObject3D - Gruppe des Produkts
   */
  addHotspot(hotspotData, parentObject3D) {
    const worldPos = new THREE.Vector3(
      hotspotData.position.x,
      hotspotData.position.y,
      hotspotData.position.z
    )
    if (parentObject3D) parentObject3D.localToWorld(worldPos)

    const el = document.createElement('button')
    el.type = 'button'
    el.className = 'hotspot-pulse absolute w-8 h-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-500/90 border-2 border-amber-400 focus:outline-none focus:ring-2 focus:ring-white'
    el.setAttribute('data-hotspot-id', hotspotData.id)
    el.setAttribute('aria-label', hotspotData.title || 'Info')
    el.innerHTML = '<span class="text-gray-900 font-bold text-sm">i</span>'

    const inner = this.container.querySelector('.pointer-events-auto') || this.container
    inner.appendChild(el)

    el.addEventListener('click', (e) => {
      e.stopPropagation()
      eventTarget.dispatchEvent(new CustomEvent(HOTSPOT_CLICK, {
        detail: { id: hotspotData.id, title: hotspotData.title, content: hotspotData.content },
      }))
    })

    this.hotspots.push({
      id: hotspotData.id,
      worldPos,
      title: hotspotData.title,
      content: hotspotData.content,
      element: el,
      parentObject3D,
    })
  }

  /**
   * Entfernt alle Hotspots und löscht die DOM-Elemente.
   */
  clear() {
    this.hotspots.forEach((h) => {
      if (h.element && h.element.parentNode) h.element.parentNode.removeChild(h.element)
    })
    this.hotspots = []
  }

  /**
   * Sollte im Render-Loop aufgerufen werden: projiziert 3D → 2D und aktualisiert Position/Sichtbarkeit.
   */
  updatePositions() {
    const camera = this.camera
    const el = this.renderer.domElement
    const width = el.clientWidth
    const height = el.clientHeight

    this.hotspots.forEach((h) => {
      const pos = h.worldPos.clone().project(camera)
      const ndcX = (pos.x + 1) / 2
      const ndcY = 1 - (pos.y + 1) / 2
      const x = ndcX * width
      const y = ndcY * height

      const inFront = pos.z <= 1
      const inView = x >= -20 && x <= width + 20 && y >= -20 && y <= height + 20
      h.element.style.display = inFront && inView ? 'block' : 'none'
      h.element.style.left = `${x}px`
      h.element.style.top = `${y}px`
    })
  }

  /**
   * Setzt Hotspots für ein platziertes Produkt (aus product.hotspots, relativ zur Gruppe).
   * @param {THREE.Group} productGroup
   * @param {Array} hotspotsData
   */
  setProductHotspots(productGroup, hotspotsData) {
    this.clear()
    if (!hotspotsData || !productGroup) return
    hotspotsData.forEach((hs) => this.addHotspot(hs, productGroup))
  }
}

export default new HotspotManager()
