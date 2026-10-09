import * as THREE from 'three'
import ProductPlacement from './ProductPlacement.js'
import { subscribeViewCubeSettings } from '../lib/viewCubeSettings.js'

const AXIS_COLORS = { x: 0xe53935, y: 0x2eaf5d, z: 0x3478d4 }
const DEFAULT_AXIS_DISPLAY_LENGTH_PX = 50

function makeLabel(text, color) {
  const canvas = document.createElement('canvas')
  canvas.width = 96
  canvas.height = 96
  const context = canvas.getContext('2d')
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.font = '700 58px Arial, sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.lineWidth = 8
  context.strokeStyle = 'rgba(255,255,255,.9)'
  context.strokeText(text, 48, 48)
  context.fillStyle = `#${color.toString(16).padStart(6, '0')}`
  context.fillText(text, 48, 48)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })
  const sprite = new THREE.Sprite(material)
  sprite.name = `coordinate-label-${text}`
  return sprite
}

function makeAxis(start, end, color, name, radius) {
  const direction = end.clone().sub(start)
  const length = direction.length()
  const geometry = new THREE.CylinderGeometry(radius, radius, length, 12, 1, false)
  const material = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: .95 })
  const axis = new THREE.Mesh(geometry, material)
  axis.userData.isViewerHelper = true
  axis.position.copy(start).add(end).multiplyScalar(.5)
  axis.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())
  axis.name = `coordinate-axis-${name}`
  return axis
}

export class CoordinateSystemView {
  constructor({ syncShowroomSettings = true } = {}) {
    this.visible = false
    this.root = null
    this.axisSize = 0
    this.originMarker = null
    this.axisVisuals = null
    this.originVisible = true
    this.axisDisplayLengthPx = DEFAULT_AXIS_DISPLAY_LENGTH_PX
    this.syncShowroomSettings = syncShowroomSettings
    if (syncShowroomSettings) {
      subscribeViewCubeSettings((settings) => {
        this.setVisible(settings.showCoordinateSystem)
        this.setOriginVisible(settings.showCoordinateOrigin)
        this.setAxisDisplayLength(settings.coordinateAxisSizePx)
      })
    }
  }

  setVisible(visible) {
    this.visible = !!visible
    if (this.root) this.root.visible = this.visible
  }

  setOriginVisible(visible) {
    this.originVisible = !!visible
    if (this.originMarker) this.originMarker.visible = this.originVisible
  }

  setAxisDisplayLength(value) {
    this.axisDisplayLengthPx = THREE.MathUtils.clamp(Number(value) || DEFAULT_AXIS_DISPLAY_LENGTH_PX, 25, 100)
  }

  clear() {
    if (!this.root) return
    const parent = this.root.parent
    parent?.remove(this.root)
    this.root.traverse((object) => {
      object.geometry?.dispose()
      if (object.material) {
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        materials.forEach((material) => {
          material.map?.dispose()
          material.dispose()
        })
      }
    })
    this.root = null
    this.originMarker = null
    this.axisVisuals = null
  }

  updateTarget(target) {
    if (!this.visible) return
    if (!target) {
      this.clear()
      return
    }
    if (this.root?.parent === target) return
    this.clear()

    target.updateWorldMatrix(true, true)
    const bounds = new THREE.Box3().setFromObject(target)
    const size = bounds.getSize(new THREE.Vector3())
    const diagonal = Math.max(size.length(), 0.001)
    this.axisSize = THREE.MathUtils.clamp(diagonal * 0.13, 0.12, 0.42)
    const axisRadius = this.axisSize * 0.022

    const root = new THREE.Group()
    root.name = 'coordinate-system-origin'
    root.renderOrder = 100
    const axisVisuals = new THREE.Group()
    axisVisuals.name = 'coordinate-system-axes'
    axisVisuals.add(makeAxis(new THREE.Vector3(0, 0, 0), new THREE.Vector3(this.axisSize, 0, 0), AXIS_COLORS.x, 'X', axisRadius))
    axisVisuals.add(makeAxis(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, this.axisSize, 0), AXIS_COLORS.y, 'Y', axisRadius))
    axisVisuals.add(makeAxis(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, this.axisSize), AXIS_COLORS.z, 'Z', axisRadius))
    root.add(axisVisuals)

    const origin = new THREE.Mesh(
      new THREE.SphereGeometry(this.axisSize * 0.025, 16, 10),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: .95 }),
    )
    origin.name = 'coordinate-system-origin-marker'
    origin.userData.isViewerHelper = true
    origin.visible = this.originVisible
    root.add(origin)
    this.originMarker = origin

    const labelOffset = this.axisSize * 1.12
    for (const [axis, position] of [
      ['X', new THREE.Vector3(labelOffset, 0, 0)],
      ['Y', new THREE.Vector3(0, labelOffset, 0)],
      ['Z', new THREE.Vector3(0, 0, labelOffset)],
    ]) {
      const label = makeLabel(axis, AXIS_COLORS[axis.toLowerCase()])
      label.position.copy(position)
      label.scale.setScalar(this.axisSize * 0.32)
      label.userData.isViewerHelper = true
      axisVisuals.add(label)
    }

    root.userData.isViewerHelper = true

    root.visible = this.visible
    target.add(root)
    this.root = root
    this.axisVisuals = axisVisuals
  }

  /** Keep the three axes and their labels at a constant screen length. */
  updateAxisSize(camera, viewportHeight) {
    if (!this.axisVisuals || !camera || !this.root || !this.visible) return
    const height = Math.max(1, Number(viewportHeight) || 1)
    // The marker is attached below the product root. Refresh both matrices
    // before measuring; camera controls and placement updates happen before
    // the next WebGL render and matrixWorld may still contain the old frame.
    camera.updateMatrixWorld(true)
    this.root.updateWorldMatrix(true, true)
    const worldPosition = new THREE.Vector3()
    this.root.getWorldPosition(worldPosition)
    const rootWorldScale = new THREE.Vector3()
    this.root.getWorldScale(rootWorldScale)
    const modelScale = Math.max(rootWorldScale.x, rootWorldScale.y, rootWorldScale.z, 1e-6)

    let pixelsPerWorldUnit
    if (camera.isOrthographicCamera) {
      pixelsPerWorldUnit = height * camera.zoom / Math.max(camera.top - camera.bottom, 1e-6)
    } else {
      const cameraPosition = new THREE.Vector3()
      camera.getWorldPosition(cameraPosition)
      const distance = Math.max(cameraPosition.distanceTo(worldPosition), 1e-6)
      const fov = THREE.MathUtils.degToRad(camera.getEffectiveFOV())
      pixelsPerWorldUnit = height / (2 * Math.tan(fov / 2) * distance)
    }
    const desiredWorldLength = this.axisDisplayLengthPx / Math.max(pixelsPerWorldUnit, 1e-6)
    const desiredLocalScale = desiredWorldLength / Math.max(this.axisSize * modelScale, 1e-6)
    if (Number.isFinite(desiredLocalScale) && desiredLocalScale > 0) {
      this.axisVisuals.scale.setScalar(THREE.MathUtils.clamp(desiredLocalScale, 1e-5, 1e5))
    }
  }

  update(zoneId) {
    const placement = ProductPlacement.getPlacement(zoneId)
    this.updateTarget(placement?.model || placement?.group)
  }
}

const instance = new CoordinateSystemView()
export default instance
