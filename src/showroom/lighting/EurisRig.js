import * as THREE from 'three'
import { EURIS } from '../eurisConstants.js'

/**
 * Euris (Babylon-Konfigurator): Hemi + Point + Ambient.
 * @param {THREE.Group} lightsRoot
 * @returns {{
 *   eurisRig: THREE.Group,
 *   lights: { eurisHemi: THREE.HemisphereLight, eurisPoint: THREE.PointLight, eurisAmbient: THREE.AmbientLight },
 * }}
 */
export function createEurisRig(lightsRoot) {
  const eurisRig = new THREE.Group()
  eurisRig.name = 'euris-lights-rig'
  eurisRig.visible = false
  lightsRoot.add(eurisRig)

  const eurisHemi = new THREE.HemisphereLight(EURIS.hemiSky, EURIS.hemiGround, EURIS.hemiIntensity)
  eurisHemi.name = 'euris-hemi'
  eurisHemi.position.set(0, 1, 0)
  eurisRig.add(eurisHemi)

  const eurisPoint = new THREE.PointLight(EURIS.pointColor, EURIS.pointIntensity, EURIS.pointDistance, 2)
  eurisPoint.name = 'euris-point'
  eurisPoint.position.set(EURIS.pointPosition.x, EURIS.pointPosition.y, EURIS.pointPosition.z)
  eurisPoint.castShadow = true
  eurisPoint.shadow.mapSize.set(2048, 2048)
  /** Sehr weiche Schatten (VSMShadowMap). PointLight = 6 Cube-Faces, daher etwas konservativer. */
  eurisPoint.shadow.radius = 18
  eurisPoint.shadow.blurSamples = 24
  eurisPoint.shadow.bias = -0.0005
  eurisPoint.shadow.normalBias = 0.04
  eurisPoint.shadow.camera.near = EURIS.pointShadowNear
  eurisPoint.shadow.camera.far = EURIS.pointShadowFar
  eurisRig.add(eurisPoint)

  const eurisAmbient = new THREE.AmbientLight(0xffffff, EURIS.ambientIntensity)
  eurisAmbient.name = 'euris-ambient'
  eurisRig.add(eurisAmbient)

  return {
    eurisRig,
    lights: { eurisHemi, eurisPoint, eurisAmbient },
  }
}
