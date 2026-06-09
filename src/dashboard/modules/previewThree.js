import * as THREE from 'three'

export function stripModelLights(root) {
  const toRemove = []
  root.traverse((child) => {
    if (child.isLight) toRemove.push(child)
  })
  toRemove.forEach((light) => {
    if (light.parent) light.parent.remove(light)
    if (light.dispose) light.dispose()
  })
}

let _sharedEnvTexture = null

export function getSharedEnvTexture(renderer) {
  if (_sharedEnvTexture) return _sharedEnvTexture
  const pmrem = new THREE.PMREMGenerator(renderer)
  const envScene = new THREE.Scene()
  envScene.background = new THREE.Color(0xcccccc)
  const hL = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0)
  envScene.add(hL)
  _sharedEnvTexture = pmrem.fromScene(envScene, 0).texture
  pmrem.dispose()
  return _sharedEnvTexture
}

export function createCardScene(renderer) {
  const scene = new THREE.Scene()
  scene.environment = getSharedEnvTexture(renderer)

  const hemi = new THREE.HemisphereLight(0xf0e9df, 0x2a2a35, 1.2)
  scene.add(hemi)

  const key = new THREE.DirectionalLight(0xfff5e8, 3.0)
  key.position.set(3, 6, 4)
  scene.add(key)

  const fill = new THREE.DirectionalLight(0xc8d8f0, 1.4)
  fill.position.set(-4, 3, -1)
  scene.add(fill)

  const rim = new THREE.DirectionalLight(0xffffff, 0.6)
  rim.position.set(0, 2, -5)
  scene.add(rim)

  return scene
}

export function createDetailScene(renderer) {
  const scene = new THREE.Scene()
  scene.environment = getSharedEnvTexture(renderer)

  const hemi = new THREE.HemisphereLight(0xf0e9df, 0x2a2a35, 1.1)
  scene.add(hemi)

  const key = new THREE.DirectionalLight(0xfff5e8, 3.2)
  key.position.set(4, 8, 5)
  key.castShadow = true
  key.shadow.mapSize.set(1024, 1024)
  key.shadow.radius = 6
  key.shadow.blurSamples = 16
  key.shadow.bias = -0.0005
  key.shadow.normalBias = 0.02
  scene.add(key)

  const fill = new THREE.DirectionalLight(0xc8d8f0, 1.6)
  fill.position.set(-5, 4, -2)
  scene.add(fill)

  const rim = new THREE.DirectionalLight(0xffffff, 1.0)
  rim.position.set(1, 3, -6)
  scene.add(rim)

  const bottom = new THREE.DirectionalLight(0xe0e4f0, 0.5)
  bottom.position.set(0, -3, 2)
  scene.add(bottom)

  return { scene, keyLight: key }
}

export function addShadowGround(scene, model) {
  const box = new THREE.Box3().setFromObject(model)
  const size = box.getSize(new THREE.Vector3())
  const groundSize = Math.max(size.x, size.z) * 3

  const groundGeo = new THREE.PlaneGeometry(groundSize, groundSize)
  const groundMat = new THREE.ShadowMaterial({ opacity: 0.25 })
  const ground = new THREE.Mesh(groundGeo, groundMat)
  ground.rotation.x = -Math.PI / 2
  ground.position.y = box.min.y
  ground.receiveShadow = true
  scene.add(ground)
  return ground
}

export function enableShadowsOnModel(root) {
  root.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true
      child.receiveShadow = true
    }
  })
}

export function fitShadowCamera(light, box, margin = 1.2) {
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z) * margin
  light.shadow.camera.left = -maxDim
  light.shadow.camera.right = maxDim
  light.shadow.camera.top = maxDim
  light.shadow.camera.bottom = -maxDim
  light.shadow.camera.near = 0.1
  light.shadow.camera.far = maxDim * 4
  light.target.position.copy(center)
  light.target.updateMatrixWorld()
  light.shadow.camera.updateProjectionMatrix()
}

export function createCardRenderer(w, h) {
  /** preserveDrawingBuffer: nötig für toDataURL (clientseitige PNG-Karten-Vorschau). */
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setSize(w, h)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(0x000000, 0)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.0
  renderer.outputColorSpace = THREE.SRGBColorSpace
  return renderer
}

/**
 * Geometrien/Materialien/Texturen einer Szene freigeben (vor renderer.dispose), um GPU-Speicher und WebGL-Kontexte zu entlasten.
 * scene.environment (z. B. geteilte PMREM-Textur) wird nicht angetastet.
 */
export function disposeSceneGpuResources(root) {
  if (!root) return
  root.traverse((o) => {
    if (o.geometry) {
      o.geometry.dispose()
    }
    if (!o.isMesh && !o.isLine && !o.isLineSegments && !o.isPoints) return
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    for (const mat of mats) {
      if (!mat) continue
      for (const key of Object.keys(mat)) {
        const v = mat[key]
        if (v && typeof v.dispose === 'function' && v.isTexture) v.dispose()
      }
      mat.dispose?.()
    }
  })
}

export function createDetailRenderer(w, h) {
  /** preserveDrawingBuffer: für Screenshot / Vorschaubild-Neu erzeugen (toDataURL). */
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setSize(w, h)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(0x000000, 0)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.0
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.VSMShadowMap
  return renderer
}
