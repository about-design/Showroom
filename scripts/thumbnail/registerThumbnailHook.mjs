import { createLogger } from '../lib/logger.mjs'
const log = createLogger("registerThumbnailHook")

import { mkdir, stat } from 'fs/promises'
import { resolve } from 'path'

/**
 * Nach erfolgreichem register-converted: PNG-Thumbnails schreiben und
 * previewImage / previewImageGeneratedAt am Produkt setzen.
 *
 * @param {object} opts
 * @param {string} opts.ROOT Projektroot
 * @param {string} opts.viteServerOrigin z. B. http://127.0.0.1:5050
 * @param {Array<{ safe: string, glbUrl: string, localPath: string, p: object }>} opts.glbRows
 * @param {string} opts.outputDir absolutes output-Verzeichnis (public/models/output)
 */
export async function refreshProductThumbnailsAfterConvert({ ROOT, viteServerOrigin, glbRows, outputDir }) {
  if (!Array.isArray(glbRows) || glbRows.length === 0) return

  let mod
  try {
    mod = await import('./headlessThumbnail.mjs')
  } catch (e) {
        log.scoped("thumbnail").warn("Modul headlessThumbnail:", e?.message || e)
    return
  }

  const thumbDir = resolve(ROOT, 'public/models/output/thumbnails')
  await mkdir(thumbDir, { recursive: true })

  for (const row of glbRows) {
    const { safe, glbUrl, localPath, p } = row
    if (!p?.id || !p?.glbFile || !safe || !localPath) continue
    if (!String(safe).toLowerCase().endsWith('.glb')) continue

    try {
      await stat(localPath)
    } catch {
      continue
    }

    const pngName = safe.replace(/\.glb$/i, '.png')
    const outAbs = resolve(thumbDir, pngName)
    const relPath = `/models/output/thumbnails/${pngName}`
    let glbFetchUrl = ''
    try {
      glbFetchUrl = new URL(String(glbUrl || ''), String(viteServerOrigin || '')).toString()
    } catch (e) {
            log.warn(`[thumbnail] Ungültige GLB-URL bei ${p.id}:`, e?.message || e)
      delete p.previewImage
      delete p.previewImageGeneratedAt
      continue
    }

    let ok = false
    try {
      ok = await mod.captureDashboardThumbnailPng({
        serverOrigin: viteServerOrigin,
        glbUrl: glbFetchUrl,
        product: p,
        outAbsPath: outAbs,
        width: 640,
        height: 400,
      })
    } catch (e) {
            log.warn(`[thumbnail] Unerwarteter Fehler bei ${p.id}:`, e?.message || e)
      ok = false
    }

    if (ok) {
      const st = await stat(outAbs)
      const v = Math.round(st.mtimeMs)
      p.previewImage = `${relPath}?v=${v}`
      p.previewImageGeneratedAt = new Date().toISOString()
    } else {
      delete p.previewImage
      delete p.previewImageGeneratedAt
            log.warn(`[thumbnail] Erzeugung fehlgeschlagen, previewImage entfernt: ${p.id}`)
    }
  }
}
