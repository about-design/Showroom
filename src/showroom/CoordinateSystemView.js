import * as THREE from 'three'
import ProductPlacement from './ProductPlacement.js'
import { subscribeViewCubeSettings } from '../lib/viewCubeSettings.js'

const AXIS_COLORS = { x: 0xe53935, y: 0x2eaf5d, z: 0x3478d4 }

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
    this.syncShowroomSettings = syncShowroomSettings
    if (syncShowroomSettings) {
      subscribeViewCubeSettings((settings) => this.setVisible(settings.showCoordinateSystem))
    }
  }

  setVisible(visible) {
    this.visible = !!visible
    if (this.root) this.root.visible = this.visible
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
    root.add(makeAxis(new THREE.Vector3(0, 0, 0), new THREE.Vector3(this.axisSize, 0, 0), AXIS_COLORS.x, 'X', axisRadius))
    root.add(makeAxis(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, this.axisSize, 0), AXIS_COLORS.y, 'Y', axisRadius))
    root.add(makeAxis(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, this.axisSize), AXIS_COLORS.z, 'Z', axisRadius))

    const origin = new THREE.Mesh(
      new THREE.SphereGeometry(this.axisSize * 0.11, 16, 10),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: .95 }),
    )
    origin.name = 'coordinate-system-origin-marker'
    root.add(origin)

    const labelOffset = this.axisSize * 1.12
    for (const [axis, position] of [
      ['X', new THREE.Vector3(labelOffset, 0, 0)],
      ['Y', new THREE.Vector3(0, labelOffset, 0)],
      ['Z', new THREE.Vector3(0, 0, labelOffset)],
    ]) {
      const label = makeLabel(axis, AXIS_COLORS[axis.toLowerCase()])
      label.position.copy(position)
      label.scale.setScalar(this.axisSize * 0.32)
      root.add(label)
    }

    root.visible = this.visible
    target.add(root)
    this.root = root
  }

  update(zoneId) {
    const placement = ProductPlacement.getPlacement(zoneId)
    this.updateTarget(placement?.model || placement?.group)
  }
}

const instance = new CoordinateSystemView()
export default instance
