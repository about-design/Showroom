import * as THREE from 'three'
import {
  GLB_LAB_FILL_COLOR,
  GLB_LAB_FILL_POSITION,
} from '../glbLabLightingPresets.js'
import { LIGHT_TARGET } from './lightConstants.js'

/**
 * GLB Lighting Lab: Key + Fill + Hemisphere.
 * @param {THREE.Group} lightsRoot
 * @returns {{ labRig: THREE.Group, lights: { labKey: THREE.DirectionalLight, labFill: THREE.DirectionalLight, labHemi: THREE.HemisphereLight } }}
 */
export function createGlbLabRig(lightsRoot) {
  const labRig = new THREE.Group()
  labRig.name = 'glb-lab-lights-rig'
  labRig.visible = false
  lightsRoot.add(labRig)

  const labKey = new THREE.DirectionalLight(0xf0f0ff, 2)
  labKey.name = 'glb-lab-key'
  labKey.position.set(5, 8, 5)
  labKey.target.position.copy(LIGHT_TARGET)
  labRig.add(labKey.target)
  labKey.castShadow = true
  labKey.shadow.mapSize.width = 4096
  labKey.shadow.mapSize.height = 4096
  /** Sehr weiche Schatten (VSMShadowMap): siehe ShowroomRig. */
  labKey.shadow.radius = 24
  labKey.shadow.blurSamples = 32
  labKey.shadow.bias = -0.0005
  labKey.shadow.normalBias = 0.04
  labKey.shadow.camera.near = 0.5
  labKey.shadow.camera.far = 50
  labKey.shadow.camera.left = -10
  labKey.shadow.camera.right = 10
  labKey.shadow.camera.top = 10
  labKey.shadow.camera.bottom = -10
  labRig.add(labKey)

  const labFill = new THREE.DirectionalLight(GLB_LAB_FILL_COLOR, 0.8)
  labFill.name = 'glb-lab-fill'
  labFill.position.set(GLB_LAB_FILL_POSITION.x, GLB_LAB_FILL_POSITION.y, GLB_LAB_FILL_POSITION.z)
  labFill.target.position.copy(LIGHT_TARGET)
  labRig.add(labFill.target)
  labRig.add(labFill)

  const labHemi = new THREE.HemisphereLight(0xeef2ff, 0x888888, 0.6)
  labHemi.name = 'glb-lab-hemi'
  labRig.add(labHemi)

  return {
    labRig,
    lights: { labKey, labFill, labHemi },
  }
}
