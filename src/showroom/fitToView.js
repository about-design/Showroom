import * as THREE from 'three'

/** Bounds of rendered product vertices, excluding hidden parents, meshes and materials. */
export function getVisibleProductBounds(root, camera) {
  if (!root) return null
  for (let parent = root.parent; parent; parent = parent.parent) if (!parent.visible) return null
  root.updateWorldMatrix(true, true)
  const box = new THREE.Box3()
  const vertex = new THREE.Vector3()
  const instance = new THREE.Matrix4()
  const world = new THREE.Matrix4()
  root.traverseVisible(mesh => {
    if (!mesh.isMesh || !mesh.geometry?.attributes.position || !mesh.layers.test(camera.layers)) return
    const geometry = mesh.geometry
    const count = geometry.index?.count ?? geometry.attributes.position.count
    const start = Math.max(0, geometry.drawRange.start)
    const end = Math.min(count, start + geometry.drawRange.count)
    const groups = Array.isArray(mesh.material) ? geometry.groups : [{ start, count: end - start, materialIndex: 0 }]
    if (mesh.isSkinnedMesh) mesh.skeleton.update()
    for (let n = 0; n < (mesh.isInstancedMesh ? mesh.count : 1); n++) {
      world.copy(mesh.matrixWorld)
      if (mesh.isInstancedMesh) { mesh.getMatrixAt(n, instance); world.multiply(instance) }
      for (const group of groups) {
        const material = Array.isArray(mesh.material) ? mesh.material[group.materialIndex] : mesh.material
        if (!material || !material.visible || (material.transparent && material.opacity === 0)) continue
        const last = Math.min(end, group.start + group.count)
        for (let i = Math.max(start, group.start); i < last; i++) {
          mesh.getVertexPosition(geometry.index ? geometry.index.getX(i) : i, vertex)
          box.expandByPoint(vertex.applyMatrix4(world))
        }
      }
    }
  })
  return box.isEmpty() || ![...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite) ? null : box
}

/** Fit all eight box corners in the existing camera direction, including their depth. */
export function getFitView(box, camera, target, aspect, margin = 1.12) {
  if (!box || box.isEmpty() || !(aspect > 0)) return null
  const center = box.getCenter(new THREE.Vector3())
  const backward = camera.position.clone().sub(target).normalize()
  if (!backward.lengthSq()) backward.set(0, 0, 1)
  const right = new THREE.Vector3().crossVectors(camera.up, backward).normalize()
  if (!right.lengthSq()) right.setFromMatrixColumn(camera.matrixWorld, 0).normalize()
  const up = new THREE.Vector3().crossVectors(backward, right).normalize()
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.getEffectiveFOV()) / 2)
  const tanH = tanV * aspect
  let distance = 0
  let depth = 0
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const offset = new THREE.Vector3(x, y, z).sub(center)
    const along = offset.dot(backward)
    depth = Math.max(depth, Math.abs(along))
    distance = Math.max(distance, along + margin * Math.abs(offset.dot(right)) / tanH, along + margin * Math.abs(offset.dot(up)) / tanV)
  }
  distance = Math.max(distance, depth + Math.max(box.getSize(new THREE.Vector3()).length() * .01, .0001))
  return { target: center, position: center.clone().addScaledVector(backward, distance), distance, depth }
}

export function isFitViewShortcut(event) {
  if (event.defaultPrevented || event.repeat || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.key?.toLowerCase() !== 'f') return false
  return !(event.composedPath?.() || [event.target]).some(element =>
    element?.isContentEditable || element?.matches?.('input, textarea, select, [role="textbox"], [role="searchbox"], [role="combobox"]'))
}
