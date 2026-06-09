import * as THREE from 'three'
import { BASE, LIGHT_TARGET } from './lightConstants.js'
import { attachShowroomFreeArea } from './FreeAreaLight.js'

/**
 * Showroom-Standard-Rig: Ambient + Directionals + RectArea + freies Flächenlicht.
 * @param {THREE.Group} lightsRoot
 * @returns {{ showroomRig: THREE.Group, lights: Record<string, THREE.Light|THREE.RectAreaLight|THREE.Group|THREE.Mesh> }}
 */
export function createShowroomRig(lightsRoot) {
  const showroomRig = new THREE.Group()
  showroomRig.name = 'showroom-lights-rig'
  lightsRoot.add(showroomRig)

  const lights = {}

  const ambient = new THREE.AmbientLight(0xffffff, BASE.ambient)
  showroomRig.add(ambient)
  lights.ambient = ambient

  const main = new THREE.DirectionalLight(0xfff8f0, BASE.main)
  main.position.set(5, 8, 5)
  main.target.position.copy(LIGHT_TARGET)
  showroomRig.add(main.target)
  main.castShadow = true
  main.shadow.mapSize.width = 4096
  main.shadow.mapSize.height = 4096
  /** Sehr weiche Schatten (VSMShadowMap): großer Filterradius + viele Blur-Samples. */
  main.shadow.radius = 24
  main.shadow.blurSamples = 32
  main.shadow.bias = -0.0005
  main.shadow.normalBias = 0.04
  main.shadow.camera.near = 0.5
  main.shadow.camera.far = 50
  main.shadow.camera.left = -10
  main.shadow.camera.right = 10
  main.shadow.camera.top = 10
  main.shadow.camera.bottom = -10
  showroomRig.add(main)
  lights.main = main

  const fill = new THREE.DirectionalLight(0xe8eeff, BASE.fill)
  fill.position.set(-3, 4, 3)
  fill.target.position.copy(LIGHT_TARGET)
  showroomRig.add(fill.target)
  showroomRig.add(fill)
  lights.fill = fill

  const sideLeft = new THREE.DirectionalLight(0xfffaf0, BASE.sideLeft)
  sideLeft.position.set(-10.5, 2.2, 5.2)
  sideLeft.target.position.copy(LIGHT_TARGET)
  showroomRig.add(sideLeft.target)
  showroomRig.add(sideLeft)
  lights.sideLeft = sideLeft

  const sideRight = new THREE.DirectionalLight(0xfffaf0, BASE.sideRight)
  sideRight.position.set(10.5, 2.2, 5.2)
  sideRight.target.position.copy(LIGHT_TARGET)
  showroomRig.add(sideRight.target)
  showroomRig.add(sideRight)
  lights.sideRight = sideRight

  const frontPanel = new THREE.RectAreaLight(0xffffff, BASE.frontPanel, 10, 4)
  frontPanel.position.set(0, 2.5, 5.5)
  frontPanel.lookAt(LIGHT_TARGET)
  showroomRig.add(frontPanel)
  lights.frontPanel = frontPanel

  const frontKey = new THREE.DirectionalLight(0xffffff, BASE.frontKey)
  frontKey.position.set(0, 3, 8)
  frontKey.target.position.copy(LIGHT_TARGET)
  showroomRig.add(frontKey.target)
  showroomRig.add(frontKey)
  lights.frontKey = frontKey

  const backKey = new THREE.DirectionalLight(0xfff8f0, BASE.backKey)
  backKey.position.set(0, 3, -8)
  backKey.target.position.copy(LIGHT_TARGET)
  showroomRig.add(backKey.target)
  showroomRig.add(backKey)
  lights.backKey = backKey

  const backLeft = new THREE.DirectionalLight(0xfffaf0, BASE.backLeft)
  backLeft.position.set(-6, 1.8, -4)
  backLeft.target.position.copy(LIGHT_TARGET)
  showroomRig.add(backLeft.target)
  showroomRig.add(backLeft)
  lights.backLeft = backLeft

  const backRight = new THREE.DirectionalLight(0xfffaf0, BASE.backRight)
  backRight.position.set(6, 1.8, -4)
  backRight.target.position.copy(LIGHT_TARGET)
  showroomRig.add(backRight.target)
  showroomRig.add(backRight)
  lights.backRight = backRight

  const topDown = new THREE.DirectionalLight(0xffffff, BASE.topDown)
  topDown.position.set(0, 10, -4)
  topDown.target.position.copy(LIGHT_TARGET)
  topDown.castShadow = false
  showroomRig.add(topDown.target)
  showroomRig.add(topDown)
  lights.topDown = topDown

  const fa = attachShowroomFreeArea(showroomRig)
  lights.freeArea = fa.freeArea
  lights.freeAreaGroup = fa.freeAreaGroup
  lights.freeAreaHelper = fa.freeAreaHelper

  return { showroomRig, lights, initialFreeLightState: fa.initialFreeLightState }
}
