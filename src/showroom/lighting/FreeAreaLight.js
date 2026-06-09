import * as THREE from 'three'
import { FREE_RECT_MAX_INTENSITY } from './lightConstants.js'

/**
 * Emissionsrichtung (normalisiert) aus horizontaler Drehung (°) und Neigung (°).
 * Horizontal: 0° → +Z, 90° → +X. Neigung: 0° horizontal, +90° senkrecht nach oben.
 */
export function directionFromYawPitchDeg(yawDeg, pitchDeg) {
  const yaw = THREE.MathUtils.degToRad(yawDeg)
  const pitch = THREE.MathUtils.degToRad(pitchDeg)
  const c = Math.cos(pitch)
  return new THREE.Vector3(c * Math.sin(yaw), Math.sin(pitch), c * Math.cos(yaw))
}

/**
 * Freies RectAreaLight unter dem Showroom-Rig (Position/Yaw/Pitch/Größe).
 * @param {THREE.Group} showroomRig
 * @returns {{
 *   freeArea: THREE.RectAreaLight,
 *   freeAreaGroup: THREE.Group,
 *   freeAreaHelper: THREE.Mesh,
 *   initialFreeLightState: object,
 * }}
 */
export function attachShowroomFreeArea(showroomRig) {
  const freeAreaGroup = new THREE.Group()
  freeAreaGroup.name = 'free-area-light-root'
  freeAreaGroup.visible = false
  freeAreaGroup.position.set(3, 2.8, 2.5)

  const freeArea = new THREE.RectAreaLight(0xfff4e8, 0, 2.6, 1.8)
  freeArea.name = 'free-area-light'
  freeAreaGroup.add(freeArea)

  const helperPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      color: 0xffb84d,
      toneMapped: false,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthTest: false,
      wireframe: false,
    }),
  )
  helperPlane.name = 'free-area-light-helper'
  helperPlane.renderOrder = 1000
  freeAreaGroup.add(helperPlane)

  showroomRig.add(freeAreaGroup)

  const initialFreeLightState = {
    enabled: false,
    intensityNorm: 0,
    x: 3,
    y: 2.8,
    z: 2.5,
    width: 2.6,
    height: 1.8,
    yawDeg: -130,
    pitchDeg: -27,
  }

  return {
    freeArea,
    freeAreaGroup,
    freeAreaHelper: helperPlane,
    initialFreeLightState,
  }
}

/**
 * Wendet freies Flächenlicht an (RectArea + Helper).
 * @param {object} parts - freeArea, freeAreaGroup, freeAreaHelper
 * @param {object} state - mutable _freeLight
 * @param {object} opts - Partial-Updates
 */
export function applyFreeLightState(parts, state, opts) {
  const rect = parts?.freeArea
  const group = parts?.freeAreaGroup
  const helper = parts?.freeAreaHelper
  if (!rect || !group || !state) return

  if (opts.enabled !== undefined) state.enabled = !!opts.enabled
  if (opts.intensity !== undefined) {
    state.intensityNorm = Math.max(0, Math.min(1, Number(opts.intensity)))
  }
  if (opts.x !== undefined) state.x = Number(opts.x)
  if (opts.y !== undefined) state.y = Number(opts.y)
  if (opts.z !== undefined) state.z = Number(opts.z)
  if (opts.width !== undefined) {
    state.width = Math.max(0.15, Math.min(20, Number(opts.width)))
  }
  if (opts.height !== undefined) {
    state.height = Math.max(0.15, Math.min(20, Number(opts.height)))
  }
  if (opts.yawDeg !== undefined) state.yawDeg = Number(opts.yawDeg)
  if (opts.pitchDeg !== undefined) {
    state.pitchDeg = Math.max(-89, Math.min(89, Number(opts.pitchDeg)))
  }

  const { x, y, z, width, height, yawDeg, pitchDeg, enabled, intensityNorm } = state

  group.position.set(x, y, z)
  const dir = directionFromYawPitchDeg(yawDeg, pitchDeg)
  const target = new THREE.Vector3(x + dir.x, y + dir.y, z + dir.z)
  group.lookAt(target)

  rect.width = width
  rect.height = height

  if (helper) {
    helper.scale.set(width, height, 1)
    helper.visible = enabled
  }

  const emits = enabled && intensityNorm > 0.0001
  rect.intensity = emits ? intensityNorm * FREE_RECT_MAX_INTENSITY : 0
  group.visible = enabled
}
