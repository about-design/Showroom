#!/usr/bin/env node
/**
 * Repariert previewImage-Verweise, die verlorengingen, weil der laufende Dev-Server
 * mit einem veralteten In-Memory-Cache products.json überschrieben hat (fs.watch
 * feuert auf diesem externen Volume nicht zuverlässig für Schreibzugriffe fremder
 * Prozesse). Prüft für jedes Produkt ohne previewImage, ob die passende PNG bereits
 * unter public/models/output/thumbnails liegt, und verknüpft sie – ohne erneutes
 * Rendern. Schreibt über die laufende Dashboard-API (PATCH), damit der Server-Cache
 * garantiert konsistent bleibt (kein externer Direktschreibzugriff).
 */
import { readFile, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { resolve, basename, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createLogger } from './lib/logger.mjs'

const log = createLogger('relink-existing-thumbnails')
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const ORIGIN = process.argv.includes('--origin')
  ? process.argv[process.argv.indexOf('--origin') + 1]
  : 'http://127.0.0.1:5050'
const THUMB_DIR = resolve(ROOT, 'public/models/output/thumbnails')

async function main() {
  const raw = await readFile(resolve(ROOT, 'src/data/products.json'), 'utf-8')
  const data = JSON.parse(raw)
  const missing = data.products.filter((p) => p.glbFile && !p.previewImage)
  log.info(`${missing.length} Produkte ohne previewImage – prüfe vorhandene PNGs …`)

  let relinked = 0
  let stillMissing = 0
  for (const p of missing) {
    const pngName = basename(p.glbFile).replace(/\.glb$/i, '.png')
    const abs = resolve(THUMB_DIR, pngName)
    if (!existsSync(abs)) { stillMissing++; continue }
    const st = await stat(abs)
    const v = Math.round(st.mtimeMs)
    const previewImage = `/models/output/thumbnails/${pngName}?v=${v}`

    const res = await fetch(`${ORIGIN}/__api/products/${encodeURIComponent(p.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ previewImage, previewImageGeneratedAt: new Date().toISOString() }),
    })
    if (res.ok) {
      relinked++
    } else {
      log.warn(`${p.id}: PATCH fehlgeschlagen (${res.status})`)
      stillMissing++
    }
  }
  log.info(`Fertig: ${relinked} verknüpft, ${stillMissing} weiterhin ohne Vorschaubild.`)
}

main().catch((e) => {
  log.error('Abbruch:', e?.message || e)
  process.exitCode = 1
})
