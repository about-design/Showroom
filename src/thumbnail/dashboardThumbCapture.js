/**
 * Headless genutzte Seite (Puppeteer): rendert ein GLB wie die Dashboard-Karte
 * und liefert ein PNG als data-URL.
 */
import { createLogger } from '../lib/logger.js'
const log = createLogger("dashboardThumbCapture")


import '../lib/loggerInit.js'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import {
  stripModelLights,
  createCardScene,
  createCardRenderer,
  disposeSceneGpuResources,
} from '../dashboard/modules/previewThree.js'
import { applyDashboardModelAppearance } from '../dashboard/modules/previewAppearance.js'

function createFallbackThumbnailDataUrl(width, height, product, reason = '') {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    const grad = ctx.createLinearGradient(0, 0, width, height)
    grad.addColorStop(0, '#eef1f5')
    grad.addColorStop(1, '#dce2ea')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, width, height)

    ctx.fillStyle = '#64748b'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = '600 22px system-ui, -apple-system, Segoe UI, sans-serif'
    ctx.fillText('Vorschau nicht verfuegbar', width / 2, height / 2 - 8)

    const label = String(product?.name || product?.id || '').trim()
    if (label) {
      ctx.fillStyle = '#475569'
      ctx.font = '500 15px system-ui, -apple-system, Segoe UI, sans-serif'
      ctx.fillText(label.slice(0, 72), width / 2, height / 2 + 22)
    }

    if (reason) {
      ctx.fillStyle = '#94a3b8'
      ctx.font = '400 12px system-ui, -apple-system, Segoe UI, sans-serif'
      ctx.fillText(String(reason).slice(0, 88), width / 2, height - 18)
    }
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

function safeForceWebGLContextLoss(renderer) {
  if (!renderer || typeof renderer.forceContextLoss !== 'function') return
  try {
    const gl = renderer.getContext?.()
    if (!gl || !gl.getExtension('WEBGL_lose_context')) return
    renderer.forceContextLoss()
  } catch {
    /* ignore */
  }
}

const gltfLoader = new GLTFLoader()
const dracoLoader = new DRACOLoader()
dracoLoader.setDecoderPath('/draco/')
gltfLoader.setDRACOLoader(dracoLoader)

/**
 * @param {{ glbUrl: string, productJson: string, width?: number, height?: number }} opts
 * @returns {Promise<string|null>} data:image/png;base64,... oder null
 */
window.renderDashboardThumbnail = async ({ glbUrl, productJson, width, height }) => {
  const w = Math.max(64, Math.round(width || 640))
  const h = Math.max(64, Math.round(height || 400))
  let product
  try {
    product = typeof productJson === 'string' ? JSON.parse(productJson) : productJson
  } catch {
    return null
  }
  if (!glbUrl || typeof glbUrl !== 'string') return null

  let renderer
  try {
    renderer = createCardRenderer(w, h)
  } catch (e) {
        log.scoped("dashboard-thumb-capture").warn("webgl init:", e)
    return createFallbackThumbnailDataUrl(w, h, product, 'WebGL deaktiviert')
  }
  const scene = createCardScene(renderer)
  const camera = new THREE.PerspectiveCamera(35, w / h, 0.01, 50)

  return new Promise((resolve) => {
    gltfLoader.load(
      glbUrl,
      async (gltf) => {
        try {
          const model = gltf.scene
          stripModelLights(model)
          try {
            await applyDashboardModelAppearance(model, product)
          } catch (e) {
                        log.scoped("dashboard-thumb-capture").warn("appearance:", e)
          }
          scene.add(model)

          const box = new THREE.Box3().setFromObject(model)
          const center = box.getCenter(new THREE.Vector3())
          const size = box.getSize(new THREE.Vector3())
          const maxDim = Math.max(size.x, size.y, size.z, 0.001)
          const dist = maxDim * 1.8

          camera.position.set(center.x + dist * 0.5, center.y + dist * 0.35, center.z + dist * 0.7)
          camera.lookAt(center)
          renderer.render(scene, camera)

          const dataUrl = renderer.domElement.toDataURL('image/png')
          disposeSceneGpuResources(scene)
          renderer.dispose()
          safeForceWebGLContextLoss(renderer)
          resolve(dataUrl)
        } catch (e) {
                    log.scoped("dashboard-thumb-capture").warn("render:", e)
          try {
            disposeSceneGpuResources(scene)
            renderer.dispose()
            safeForceWebGLContextLoss(renderer)
          } catch {
            /* ignore */
          }
          resolve(createFallbackThumbnailDataUrl(w, h, product, 'Rendering fehlgeschlagen'))
        }
      },
      undefined,
      (err) => {
                log.scoped("dashboard-thumb-capture").warn("load:", err)
        try {
          renderer.dispose()
          safeForceWebGLContextLoss(renderer)
        } catch {
          /* ignore */
        }
        resolve(createFallbackThumbnailDataUrl(w, h, product, 'Modell konnte nicht geladen werden'))
      },
    )
  })
}

window.__thumbReady = true
