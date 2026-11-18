import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { getVisibleProductBounds, getFitView, isFitViewShortcut } from '../src/showroom/fitToView.js'

test('visible bounds exclude hidden meshes/parents/materials and preserve model transforms', () => {
  const root = new THREE.Group()
  root.position.set(10, -2, 5)
  root.rotation.y = .6
  root.scale.set(2, 3, 4)
  const shown = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 3), new THREE.MeshBasicMaterial())
  root.add(shown)
  const hidden = shown.clone(); hidden.position.x = 100; hidden.visible = false; root.add(hidden)
  const hiddenParent = new THREE.Group(); hiddenParent.visible = false; root.add(hiddenParent)
  const child = shown.clone(); child.position.y = 100; hiddenParent.add(child)
  const hiddenMaterial = shown.clone(); hiddenMaterial.material = shown.material.clone(); hiddenMaterial.material.visible = false; hiddenMaterial.position.z = 100; root.add(hiddenMaterial)
  const before = [root.position.toArray(), root.quaternion.toArray(), root.scale.toArray(), ...shown.geometry.attributes.position.array]
  const camera = new THREE.PerspectiveCamera()
  const expected = new THREE.Box3().setFromObject(shown)
  root.updateWorldMatrix(true, true)
  expected.setFromObject(shown)
  const box = getVisibleProductBounds(root, camera)
  assert.ok(box.min.distanceTo(expected.min) < 1e-6 && box.max.distanceTo(expected.max) < 1e-6)
  assert.deepEqual([root.position.toArray(), root.quaternion.toArray(), root.scale.toArray(), ...shown.geometry.attributes.position.array], before)
  shown.visible = false
  assert.equal(getVisibleProductBounds(root, camera), null)
})

test('framing fits all corners at any aspect, depth, scale, zoom and viewing direction', () => {
  for (const aspect of [.3, 1, 3]) for (const scale of [.001, 1, 1000]) for (const direction of [[1,.5,2], [-1,2,-3], [0,-1,.00001]]) {
    const camera = new THREE.PerspectiveCamera(35, aspect, .000001, 1e8)
    camera.zoom = 1.7
    camera.position.fromArray(direction).multiplyScalar(5)
    const target = new THREE.Vector3()
    const box = new THREE.Box3(new THREE.Vector3(-2,-1,-3).multiplyScalar(scale), new THREE.Vector3(3,4,7).multiplyScalar(scale))
    const view = getFitView(box, camera, target, aspect)
    camera.position.copy(view.position); camera.lookAt(view.target)
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true)
    for (const x of [box.min.x,box.max.x]) for (const y of [box.min.y,box.max.y]) for (const z of [box.min.z,box.max.z]) {
      const ndc = new THREE.Vector3(x,y,z).project(camera)
      assert.ok(Math.abs(ndc.x) <= 1 / 1.12 + 1e-6 && Math.abs(ndc.y) <= 1 / 1.12 + 1e-6)
    }
    assert.ok(view.target.distanceTo(box.getCenter(new THREE.Vector3())) < 1e-9)
  }
})

test('shortcut ignores editing, composition, modifiers and repeats', () => {
  assert.equal(isFitViewShortcut({ key: 'f' }), true)
  assert.equal(isFitViewShortcut({ key: 'F', shiftKey: true }), true)
  for (const flag of ['defaultPrevented','repeat','isComposing','ctrlKey','altKey','metaKey']) assert.equal(isFitViewShortcut({ key: 'f', [flag]: true }), false)
  assert.equal(isFitViewShortcut({ key: 'f', composedPath: () => [{ isContentEditable: true }] }), false)
  assert.equal(isFitViewShortcut({ key: 'f', composedPath: () => [{ matches: () => true }] }), false)
})
