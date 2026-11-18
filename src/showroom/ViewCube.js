import * as THREE from 'three'
import gsap from 'gsap'
import { subscribeViewCubeSettings } from '../lib/viewCubeSettings.js'
import './viewCube.css'

// World axes: front +Z, right +X, top +Y. No model transforms are touched.
const faces = [
  ['Vorne', 0, 0, 'translateZ(24px)'],
  ['Hinten', 0, Math.PI, 'rotateY(180deg) translateZ(24px)'],
  ['Links', 0, -Math.PI / 2, 'rotateY(-90deg) translateZ(24px)'],
  ['Rechts', 0, Math.PI / 2, 'rotateY(90deg) translateZ(24px)'],
  ['Oben', -Math.PI / 2, 0, 'rotateX(90deg) translateZ(24px)'],
  ['Unten', Math.PI / 2, 0, 'rotateX(-90deg) translateZ(24px)'],
]

export function createViewCube(container, camera, controls) {
  const root = document.createElement('div')
  root.className = 'view-cube'
  root.setAttribute('role', 'group')
  root.setAttribute('aria-label', 'Kameraansicht')
  const cube = document.createElement('div')
  cube.className = 'view-cube-solid'
  root.append(cube)
  container.append(root)
  let frame = 0
  let saved = null
  let disposed = false
  const cancel = () => {
    cancelAnimationFrame(frame)
    frame = 0
    if (saved) {
      Object.assign(controls, saved)
      saved = null
    }
  }
  const sync = () => {
    const matrix = new THREE.Matrix4().makeRotationFromQuaternion(camera.quaternion.clone().invert())
    // Convert Three's upward Y to CSS's downward Y on both sides of the rotation.
    for (const i of [1, 4, 6, 9]) matrix.elements[i] *= -1
    cube.style.transform = `matrix3d(${matrix.elements.join(',')})`
  }
  const select = direction => {
    cancel()
    gsap.killTweensOf(camera.position)
    gsap.killTweensOf(controls.target)
    saved = { minPolarAngle: controls.minPolarAngle, maxPolarAngle: controls.maxPolarAngle, autoRotate: controls.autoRotate, enableDamping: controls.enableDamping }
    controls.minPolarAngle = 0
    controls.maxPolarAngle = Math.PI
    controls.autoRotate = false
    controls.enableDamping = false
    controls.update() // Drain any remaining damping before starting the camera move.
    const start = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target))
    const end = new THREE.Spherical().setFromVector3(direction.clone().normalize().multiplyScalar(start.radius))
    end.makeSafe()
    const delta = THREE.MathUtils.euclideanModulo(end.theta - start.theta + Math.PI, Math.PI * 2) - Math.PI
    const began = performance.now()
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 350
    const step = now => {
      if (disposed) return
      const t = duration ? Math.min(1, (now - began) / duration) : 1
      const ease = t * t * (3 - 2 * t)
      const spherical = new THREE.Spherical(start.radius, THREE.MathUtils.lerp(start.phi, end.phi, ease), start.theta + delta * ease)
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical))
      controls.update()
      sync()
      if (t < 1) frame = requestAnimationFrame(step)
      else { frame = 0; controls.enableDamping = saved.enableDamping }
    }
    frame = requestAnimationFrame(step)
  }
  for (const [name, rx, ry, transform] of faces) {
    const face = document.createElement('div')
    face.className = 'view-cube-face'
    face.style.transform = transform
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
      const direction = new THREE.Vector3(col - 1, 1 - row, 1).applyEuler(new THREE.Euler(rx, ry, 0)).round()
      const button = document.createElement('button')
      button.type = 'button'
      const center = row === 1 && col === 1
      const label = center ? name : `${name}: ${row === 0 ? 'oben' : row === 2 ? 'unten' : ''} ${col === 0 ? 'links' : col === 2 ? 'rechts' : ''}`.trim()
      button.textContent = center ? name : ''
      button.title = label
      button.setAttribute('aria-label', label)
      button.dataset.direction = direction.toArray().join(',')
      button.addEventListener('click', event => { event.stopPropagation(); select(direction) })
      face.append(button)
    }
    cube.append(face)
  }
  const stop = event => event.stopPropagation()
  for (const type of ['pointerdown', 'dblclick', 'wheel', 'contextmenu']) root.addEventListener(type, stop)
  controls.addEventListener('change', sync)
  controls.addEventListener('start', cancel)
  const unsubscribe = subscribeViewCubeSettings(settings => {
    root.hidden = !settings.showViewCube
    root.dataset.position = settings.viewCubePosition
    if (root.hidden) cancel()
  })
  sync()
  return {
    cancel,
    stopTransition() {
      cancelAnimationFrame(frame)
      frame = 0
      if (saved) controls.enableDamping = saved.enableDamping
    },
    dispose() {
      disposed = true
      cancel()
      unsubscribe()
      controls.removeEventListener('change', sync)
      controls.removeEventListener('start', cancel)
      root.remove()
    },
  }
}
