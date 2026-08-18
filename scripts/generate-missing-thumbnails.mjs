#!/usr/bin/env node
/**
 * Erzeugt Vorschaubilder (previewImage) für alle Produkte mit glbFile, die noch
 * keins haben ODER deren referenzierte PNG-Datei nicht (mehr) auf Disk liegt –
 * per Headless-Puppeteer (gleicher Renderpfad wie die Karten-Vorschau im
 * Dashboard, siehe scripts/thumbnail/headlessThumbnail.mjs).
 *
 * Schreibt über die laufende Dashboard-API (PATCH pro Produkt) statt direkt in
 * products.json, damit der Server-Cache garantiert konsistent bleibt (siehe
 * ensureProductsCache()-mtime-Check in dashboardApi.mjs).
 *
 * Voraussetzung: ein laufender Vite-Dev-Server (Standard http://127.0.0.1:5050).
 *
 * Usage:
 *   node scripts/generate-missing-thumbnails.mjs [--limit N] [--origin URL] [--timeout MS] [--max-size-mb N]
 */
import { readFile, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { resolve, basename, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createLogger } from './lib/logger.mjs'
import { captureDashboardThumbnailPng, closeThumbnailBrowser } from './thumbnail/headlessThumbnail.mjs'

const log = createLogger('generate-missing-thumbnails')
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const PUBLIC_ROOT = resolve(ROOT, 'public')
const THUMB_DIR = resolve(ROOT, 'public/models/output/thumbnails')

const args = process.argv.slice(2)
const limitArg = args.indexOf('--limit')
const LIMIT = limitArg !== -1 ? parseInt(args[limitArg + 1], 10) : Infinity
const originArg = args.indexOf('--origin')
const ORIGIN = originArg !== -1 ? args[originArg + 1] : 'http://127.0.0.1:5050'
const timeoutArg = args.indexOf('--timeout')
const TIMEOUT_MS = timeoutArg !== -1 ? parseInt(args[timeoutArg + 1], 10) : 25000
const maxSizeArg = args.indexOf('--max-size-mb')
// Riesen-GLBs (>200 MB) würden den Batch für alle anderen blockieren/verlangsamen –
// lieber sauber überspringen und melden als endlos versuchen.
const MAX_SIZE_BYTES = (maxSizeArg !== -1 ? parseInt(args[maxSizeArg + 1], 10) : 200) * 1024 * 1024

function needsThumbnail(p) {
  if (!p.glbFile) return false
  if (!p.previewImage) return true
  const rel = String(p.previewImage).split('?')[0]
  const abs = resolve(PUBLIC_ROOT, rel.replace(/^\//, ''))
  return !existsSync(abs)
}

async function main() {
  const raw = await readFile(resolve(ROOT, 'src/data/products.json'), 'utf-8')
  const data = JSON.parse(raw)
  const todo = data.products.filter(needsThumbnail).slice(0, LIMIT)
  if (!todo.length) {
    log.info('Alle Produkte mit GLB haben ein vorhandenes Vorschaubild.')
    return
  }
  log.info(`${todo.length} Produkte ohne (gültiges) Vorschaubild (Origin: ${ORIGIN}).`)

  let ok = 0
  let failed = 0
  for (let i = 0; i < todo.length; i++) {
    const p = todo[i]
    const tag = `[${i + 1}/${todo.length}] ${p.id}`
    // Jedes Produkt einzeln abfangen: ein Netzwerk-Hänger o. Ä. darf nicht den
    // ganzen Batch abbrechen (vorher: unbehandelter fetch-Fehler killte main()).
    try {
      const glbBasename = basename(String(p.glbFile))
      if (!/\.glb$/i.test(glbBasename)) { failed++; log.warn(`${tag}: glbFile ohne .glb`); continue }
      const localPath = resolve(PUBLIC_ROOT, String(p.glbFile).replace(/^\//, ''))
      let glbStat
      try {
        glbStat = await stat(localPath)
      } catch {
        log.warn(`${tag}: GLB fehlt auf Disk (${p.glbFile}) – übersprungen.`)
        failed++
        continue
      }
      if (glbStat.size === 0) {
        log.warn(`${tag}: GLB ist leer (0 Byte) – Datenproblem, nicht durch Rendern lösbar.`)
        failed++
        continue
      }
      if (glbStat.size > MAX_SIZE_BYTES) {
        log.warn(`${tag}: GLB zu groß (${(glbStat.size / 1024 / 1024).toFixed(0)} MB > ${MAX_SIZE_BYTES / 1024 / 1024} MB) – übersprungen, blockiert sonst den Batch.`)
        failed++
        continue
      }

      const pngName = glbBasename.replace(/\.glb$/i, '.png')
      const outAbs = resolve(THUMB_DIR, pngName)
      const glbUrl = new URL(String(p.glbFile), ORIGIN).toString()

      const success = await captureDashboardThumbnailPng({
        serverOrigin: ORIGIN,
        glbUrl,
        product: p,
        outAbsPath: outAbs,
        width: 640,
        height: 400,
        timeoutMs: TIMEOUT_MS,
      })
      if (!success) {
        failed++
        log.warn(`${tag}: Rendern fehlgeschlagen`)
        continue
      }

      const st = await stat(outAbs)
      const v = Math.round(st.mtimeMs)
      const previewImage = `/models/output/thumbnails/${pngName}?v=${v}`
      const res = await fetch(`${ORIGIN}/__api/products/${encodeURIComponent(p.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: JSON.stringify({ previewImage, previewImageGeneratedAt: new Date().toISOString() }),
      })
      if (res.ok) {
        ok++
        log.info(`${tag}: ok`)
      } else {
        failed++
        log.warn(`${tag}: PATCH fehlgeschlagen (${res.status})`)
      }
    } catch (e) {
      failed++
      log.warn(`${tag}: Fehler –`, e?.message || e)
    }
  }

  await closeThumbnailBrowser()
  log.info(`Fertig: ${ok} erzeugt, ${failed} fehlgeschlagen von ${todo.length}.`)
}

main().catch(async (e) => {
  log.error('Abbruch:', e?.message || e)
  // Sonst bleibt der Prozess hängen (offene Puppeteer/CDP-Verbindung hält die
  // Event-Loop am Leben) und wird nie als beendet erkannt.
  await closeThumbnailBrowser().catch(() => {})
  process.exitCode = 1
})
