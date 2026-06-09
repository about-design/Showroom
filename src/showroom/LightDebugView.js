import * as THREE from 'three'
import SceneManager from './SceneManager.js'
import LightingManager from './LightingManager.js'

const LIGHTS = [
  { key: 'ambient', name: 'Ambient' },
  { key: 'main', name: 'Hauptlicht' },
  { key: 'fill', name: 'Fill' },
  { key: 'sideLeft', name: 'Seite links' },
  { key: 'sideRight', name: 'Seite rechts' },
  { key: 'frontPanel', name: 'Flächenleuchte vorne' },
  { key: 'backLeft', name: 'Hinten links (Pfeil)' },
  { key: 'backRight', name: 'Hinten rechts (Pfeil)' },
]

/**
 * Zeigt die Positionen der Lichter mit Namen in der Szene an (Debug-Overlay).
 */
class LightDebugView {
  constructor() {
    this.container = null
    this.labels = []
    this.visible = false
  }

  init() {
    this.container = document.getElementById('light-debug-container')
    if (!this.container) return

    LIGHTS.forEach(({ key, name }) => {
      const light = LightingManager.lights[key]
      const el = document.createElement('div')
      el.className = 'absolute px-2 py-1 rounded text-xs font-medium whitespace-nowrap pointer-events-none'
      el.textContent = name
      el.dataset.key = key
      if (key === 'ambient') {
        el.style.left = '16px'
        el.style.top = '140px'
        el.style.transform = 'none'
        el.classList.add('bg-amber-500/90', 'text-gray-900')
      } else {
        el.style.transform = 'translate(-50%, -50%)'
        el.classList.add('bg-amber-500/90', 'text-gray-900', 'border', 'border-amber-700')
      }
      this.container.appendChild(el)
      this.labels.push({ key, name, element: el, hasPosition: key !== 'ambient' })
    })
  }

  setVisible(visible) {
    this.visible = !!visible
    if (this.container) this.container.style.display = this.visible ? 'block' : 'none'
  }

  toggle() {
    this.setVisible(!this.visible)
  }

  updatePositions() {
    if (!this.visible || !this.container) return
    const camera = SceneManager.getCamera()
    const renderer = SceneManager.getRenderer()
    const el = renderer.domElement
    const width = el.clientWidth
    const height = el.clientHeight

    this.labels.forEach(({ key, element, hasPosition }) => {
      if (key === 'ambient') return
      const light = LightingManager.lights[key]
      if (!light || !light.position) {
        element.style.display = 'none'
        return
      }
      const pos = light.position.clone().project(camera)
      const x = (pos.x + 1) / 2 * width
      const y = (1 - (pos.y + 1) / 2) * height
      const inFront = pos.z <= 1
      const inView = x >= -30 && x <= width + 30 && y >= -30 && y <= height + 30
      element.style.display = inFront && inView ? 'block' : 'none'
      element.style.left = `${x}px`
      element.style.top = `${y}px`
    })
  }
}

const instance = new LightDebugView()
export default instance
