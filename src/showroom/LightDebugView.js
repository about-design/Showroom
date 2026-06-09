import * as THREE from 'three'
import SceneManager from './SceneManager.js'
import LightingManager from './LightingManager.js'
import { EURIS } from './eurisConstants.js'

const LIGHTS = [
  { key: 'ambient', name: 'Ambient' },
  { key: 'labKey', name: 'GLB Lab Key' },
  { key: 'labFill', name: 'GLB Lab Fill' },
  { key: 'labHemi', name: 'GLB Lab Hemi' },
  { key: 'eurisHemi', name: 'Euris Hemi' },
  { key: 'eurisPoint', name: 'Euris Point' },
  { key: 'eurisAmbient', name: 'Euris Ambient' },
  { key: 'main', name: 'Hauptlicht' },
  { key: 'fill', name: 'Fill' },
  { key: 'sideLeft', name: 'Seite links' },
  { key: 'sideRight', name: 'Seite rechts' },
  { key: 'frontPanel', name: 'Flächenleuchte vorne' },
  { key: 'frontKey', name: 'Festes Licht vorne' },
  { key: 'backKey', name: 'Festes Licht hinten' },
  { key: 'backLeft', name: 'Hinten links (Pfeil)' },
  { key: 'backRight', name: 'Hinten rechts (Pfeil)' },
  { key: 'topDown', name: 'Von oben' },
  { key: 'freeArea', name: 'Freies Flächenlicht' },
]

const ARROW_LENGTH = 2.2
const ARROW_HEAD = 0.45
const ARROW_COLOR = 0xffcc00

/**
 * Erstellt einen einfachen 3D-Pfeil (Richtung +Z in Lokalraum).
 * position/origin und direction werden beim Update gesetzt.
 */
function createArrowMesh() {
  const group = new THREE.Group()
  const lineGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, Math.max(0.001, ARROW_LENGTH - ARROW_HEAD)),
  ])
  const line = new THREE.Line(
    lineGeo,
    new THREE.LineBasicMaterial({ color: ARROW_COLOR, toneMapped: false })
  )
  group.add(line)
  const coneGeo = new THREE.ConeGeometry(ARROW_HEAD * 0.4, ARROW_HEAD, 8)
  coneGeo.rotateX(-Math.PI / 2)
  const cone = new THREE.Mesh(
    coneGeo,
    new THREE.MeshBasicMaterial({ color: ARROW_COLOR, toneMapped: false })
  )
  cone.position.z = ARROW_LENGTH - ARROW_HEAD
  group.add(cone)
  return group
}

/**
 * Richtung so setzen, dass der Pfeil (Lokal +Z) in dir zeigt.
 */
function setArrowDirection(arrow, dir) {
  if (dir.lengthSq() < 1e-10) return
  dir = dir.clone().normalize()
  const up = new THREE.Vector3(0, 1, 0)
  if (Math.abs(dir.dot(up)) > 0.999) up.set(1, 0, 0)
  arrow.lookAt(arrow.position.clone().add(dir))
}

/**
 * Zeigt die Positionen und Richtungen aller Lichter in der Szene an (2D-Labels + 3D-Pfeile).
 */
class LightDebugView {
  constructor() {
    this.container = null
    this.labels = []
    this.visible = false
    this.arrowsGroup = null
    this.arrowMeshes = {}
    this._vOrigin = new THREE.Vector3()
    this._vTarget = new THREE.Vector3()
    this._vDir = new THREE.Vector3()
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

    this._initArrows()
  }

  _initArrows() {
    const scene = SceneManager.getScene()
    this.arrowsGroup = new THREE.Group()
    this.arrowsGroup.name = 'light-direction-arrows'
    scene.add(this.arrowsGroup)

    const directionalKeys = [
      'labKey', 'labFill',
      'main', 'fill', 'sideLeft', 'sideRight', 'frontKey', 'backKey',
      'backLeft', 'backRight', 'topDown',
    ]
    directionalKeys.forEach((key) => {
      const light = LightingManager.lights[key]
      if (!light || !light.target) return
      const arrow = createArrowMesh()
      arrow.userData.lightKey = key
      this.arrowsGroup.add(arrow)
      this.arrowMeshes[key] = arrow
    })

    // RectAreaLight (frontPanel): Richtung aus World-Richtung
    const frontPanel = LightingManager.lights.frontPanel
    if (frontPanel && frontPanel.position) {
      const arrow = createArrowMesh()
      arrow.userData.lightKey = 'frontPanel'
      arrow.userData.isRectArea = true
      this.arrowsGroup.add(arrow)
      this.arrowMeshes.frontPanel = arrow
    }

    const freeArea = LightingManager.lights.freeArea
    if (freeArea && freeArea.position) {
      const arrow = createArrowMesh()
      arrow.userData.lightKey = 'freeArea'
      arrow.userData.isRectArea = true
      this.arrowsGroup.add(arrow)
      this.arrowMeshes.freeArea = arrow
    }

    const eurisPoint = LightingManager.lights.eurisPoint
    if (eurisPoint) {
      const arrow = createArrowMesh()
      arrow.userData.lightKey = 'eurisPoint'
      arrow.userData.eurisPointToTarget = true
      this.arrowsGroup.add(arrow)
      this.arrowMeshes.eurisPoint = arrow
    }

    this.arrowsGroup.visible = false
  }

  setVisible(visible) {
    this.visible = !!visible
    if (this.container) this.container.style.display = this.visible ? 'block' : 'none'
    if (this.arrowsGroup) this.arrowsGroup.visible = this.visible
  }

  toggle() {
    this.setVisible(!this.visible)
  }

  updatePositions() {
    if (!this.visible) return

    if (this.container) {
      const camera = SceneManager.getCamera()
      const renderer = SceneManager.getRenderer()
      const el = renderer.domElement
      const width = el.clientWidth
      const height = el.clientHeight

      this.labels.forEach(({ key, element, hasPosition }) => {
        if (key === 'ambient' || key === 'labHemi' || key === 'eurisHemi' || key === 'eurisAmbient') return
        const light = LightingManager.lights[key]
        if (!light || !light.position) {
          element.style.display = 'none'
          return
        }
        light.getWorldPosition(this._vOrigin)
        const pos = this._vOrigin.clone().project(camera)
        const x = (pos.x + 1) / 2 * width
        const y = (1 - (pos.y + 1) / 2) * height
        const inFront = pos.z <= 1
        const inView = x >= -30 && x <= width + 30 && y >= -30 && y <= height + 30
        element.style.display = inFront && inView ? 'block' : 'none'
        element.style.left = `${x}px`
        element.style.top = `${y}px`
      })
    }

    if (this.arrowsGroup && this.arrowsGroup.visible) {
      Object.entries(this.arrowMeshes).forEach(([key, arrow]) => {
        const light = LightingManager.lights[key]
        if (!light) return
        light.getWorldPosition(this._vOrigin)
        arrow.position.copy(this._vOrigin)
        if (arrow.userData.isRectArea) {
          light.getWorldDirection(this._vDir).negate()
          setArrowDirection(arrow, this._vDir)
        } else if (arrow.userData.eurisPointToTarget) {
          this._vTarget.set(0, EURIS.orbitTargetY, 0)
          this._vDir.copy(this._vTarget).sub(this._vOrigin)
          setArrowDirection(arrow, this._vDir)
        } else if (light.target) {
          light.target.getWorldPosition(this._vTarget)
          this._vDir.copy(this._vTarget).sub(this._vOrigin)
          setArrowDirection(arrow, this._vDir)
        }
      })
    }
  }
}

const instance = new LightDebugView()
export default instance
