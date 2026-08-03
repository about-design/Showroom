#!/usr/bin/env node
/**
 * Erzeugt Vorschaubilder (previewImage) für alle Produkte mit glbFile, die noch
 * keins haben – per Headless-Puppeteer (gleicher Renderpfad wie die Karten-
 * Vorschau im Dashboard, siehe scripts/thumbnail/headlessThumbnail.mjs).
 *
 * Voraussetzung: ein laufender Vite-Dev-Server (Standard http://127.0.0.1:5050),
 * der /src/thumbnail/dashboardThumbCapture.html und die GLB-Dateien ausliefert.
 *
 * Usage:
 *   node scripts/generate-missing-thumbnails.mjs [--limit N] [--origin URL]
 */
import { readFile, writeFile, mkdir, stat, rename, unlink } from 'fs/promises'
import { resolve, basename, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createLogger } from './lib/logger.mjs'
import { captureDashboardThumbnailPng, closeThumbnailBrowser } from './thumbnail/headlessThumbnail.mjs'

const log = createLogger('generate-missing-thumbnails')
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const PRODUCTS_PATH = resolve(ROOT, 'src/data/products.json')
const THUMB_DIR = resolve(ROOT, 'public/models/output/thumbnails')
const PUBLIC_ROOT = resolve(ROOT, 'public')

const args = process.argv.slice(2)
const limitArg = args.indexOf('--limit')
const LIMIT = limitArg !== -1 ? parseInt(args[limitArg + 1], 10) : Infinity
const originArg = args.indexOf('--origin')
const ORIGIN = originArg !== -1 ? args[originArg + 1] : 'http://127.0.0.1:5050'
const SAVE_EVERY = 10

async function saveProducts(data) {
  const tmp = `${PRODUCTS_PATH}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8')
  try {
    await rename(tmp, PRODUCTS_PATH)
  } catch (err) {
    try { await unlink(tmp) } catch {}
    throw err
  }
}

async function main() {
  const raw = await readFile(PRODUCTS_PATH, 'utf-8')
  const data = JSON.parse(raw)
  const products = Array.isArray(data.products) ? data.products : []

  const missing = products.filter((p) => p.glbFile && !p.previewImage).slice(0, LIMIT)
  if (!missing.length) {
    log.info('Keine Produkte ohne Vorschaubild gefunden.')
    return
  }
  log.info(`${missing.length} Produkte ohne Vorschaubild (Origin: ${ORIGIN}).`)
  await mkdir(THUMB_DIR, { recursive: true })

  let ok = 0
  let failed = 0
  for (let i = 0; i < missing.length; i++) {
    const p = missing[i]
    const glbBasename = basename(String(p.glbFile))
    if (!/\.glb$/i.test(glbBasename)) { failed++; continue }
    const localPath = resolve(PUBLIC_ROOT, String(p.glbFile).replace(/^\//, ''))
    try {
      await stat(localPath)
    } catch {
      log.warn(`[${i + 1}/${missing.length}] ${p.id}: GLB fehlt auf Disk (${p.glbFile}) – übersprungen.`)
      failed++
      continue
    }

    const pngName = glbBasename.replace(/\.glb$/i, '.png')
    const outAbs = resolve(THUMB_DIR, pngName)
    let glbUrl = ''
    try {
      glbUrl = new URL(String(p.glbFile), ORIGIN).toString()
    } catch {
      failed++
      continue
    }

    let success = false
    try {
      success = await captureDashboardThumbnailPng({
        serverOrigin: ORIGIN,
        glbUrl,
        product: p,
        outAbsPath: outAbs,
        width: 640,
        height: 400,
      })
    } catch (e) {
      log.warn(`[${i + 1}/${missing.length}] ${p.id}: Fehler –`, e?.message || e)
    }

    if (success) {
      const st = await stat(outAbs)
      const v = Math.round(st.mtimeMs)
      p.previewImage = `/models/output/thumbnails/${pngName}?v=${v}`
      p.previewImageGeneratedAt = new Date().toISOString()
      ok++
      log.info(`[${i + 1}/${missing.length}] ${p.id}: ok`)
    } else {
      failed++
      log.warn(`[${i + 1}/${missing.length}] ${p.id}: fehlgeschlagen`)
    }

    if ((i + 1) % SAVE_EVERY === 0) {
      await saveProducts(data)
      log.info(`Zwischenstand gespeichert (${ok} ok, ${failed} fehlgeschlagen).`)
    }
  }

  await saveProducts(data)
  await closeThumbnailBrowser()
  log.info(`Fertig: ${ok} erzeugt, ${failed} fehlgeschlagen von ${missing.length}.`)
}

main().catch((e) => {
  log.error('Abbruch:', e?.message || e)
  process.exitCode = 1
})
