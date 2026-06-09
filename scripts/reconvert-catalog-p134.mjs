#!/usr/bin/env node
import { createLogger } from './lib/logger.mjs'
const log = createLogger("reconvert-catalog-p134")

/**
 * Stückliste Katalog S. 134 – Ständerrahmen (85/20, 100/20, 120/20), 92 Artikel.
 * Startet für jedes in products.json vorhandene Produkt eine Konvertierung
 * über POST /__api/convert-product (gleiche API wie Dashboard).
 *
 * Voraussetzungen:
 *   - Vite-Devserver mit Middleware (z. B. npm run dev:full) → Standard PORT 5050
 *   - Converter-API auf localhost:3000
 *
 * Nutzung:
 *   node scripts/reconvert-catalog-p134.mjs
 *   node scripts/reconvert-catalog-p134.mjs --dry-run
 *   SHOWROOM_URL=http://127.0.0.1:5173 node scripts/reconvert-catalog-p134.mjs
 *
 * Optional: gleiche Zusatzoptionen wie im Dashboard (Rotation vor Konvertierung):
 *   ROTATE_AXIS=X ROTATE_DEGREES=90 node scripts/reconvert-catalog-p134.mjs
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { usesProductDefaultSurfaceColor } from '../src/lib/defaultColorMapping.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const PRODUCTS_PATH = join(ROOT, 'src/data/products.json')
const RAL_COLORS_PATH = join(ROOT, 'src/data/ralColors.json')

/** 13-stellige Artikelnummern wie im Katalog (Reihenfolge: Tabelle 1 → 2 → 3) */
const CATALOG_P134_ARTICLES = [
  // Ständerrahmen 85/20
  '4026212124385', '4026212124552',
  '4026212124408', '4026212124569',
  '4026212124422', '4026212124576',
  '4026212124439', '4026212124583',
  '4026212124446', '4026212124590',
  '4026212124453', '4026212124606',
  '4026212124460', '4026212124613',
  '4026212214017', '4026212214116',
  // Ständerrahmen 100/20
  '4026212179767', '4026212182804',
  '4026212179774', '4026212182811',
  '4026212179781', '4026212182828',
  '4026212179798', '4026212182835',
  '4026212179804', '4026212182842',
  '4026212179811', '4026212182866',
  '4026212179828', '4026212182873',
  '4026212179835', '4026212182880',
  '4026212179842', '4026212182897',
  '4026212179859', '4026212182903',
  '4026212179866', '4026212182910',
  '4026212179873', '4026212182927',
  '4026212179880', '4026212182934',
  '4026212179897', '4026212182941',
  '4026212179903', '4026212182958',
  '4026212179910', '4026212182965',
  '4026212179927', '4026212182972',
  '4026212179934', '4026212182989',
  '4026212179941', '4026212182996',
  // Ständerrahmen 120/20
  '4026212260649', '4026212260915',
  '4026212260656', '4026212260922',
  '4026212260663', '4026212260939',
  '4026212260670', '4026212260946',
  '4026212260687', '4026212260953',
  '4026212260694', '4026212260960',
  '4026212260700', '4026212260977',
  '4026212260717', '4026212260984',
  '4026212260724', '4026212260991',
  '4026212260731', '4026212261004',
  '4026212260748', '4026212261011',
  '4026212260755', '4026212261028',
  '4026212260762', '4026212261035',
  '4026212260779', '4026212261042',
  '4026212260786', '4026212261059',
  '4026212260793', '4026212261066',
  '4026212260809', '4026212261073',
  '4026212260816', '4026212261080',
  '4026212260823', '4026212261097',
]

const DELAY_MS = Number(process.env.RECONVERT_DELAY_MS || 1500)
const SHOWROOM_URL = (process.env.SHOWROOM_URL || 'http://localhost:5050').replace(/\/$/, '')

function findProductIdForArticle(products, article) {
  const prefix = `output-${article}_`
  return (
    products.find((x) => {
      if (typeof x.id === 'string' && x.id.startsWith(prefix)) return true
      if (x.glbFile && String(x.glbFile).includes(`/${article}_`)) return true
      return false
    })?.id ?? null
  )
}

function parseArgs() {
  const dryRun = process.argv.includes('--dry-run')
  return { dryRun }
}

async function main() {
  const { dryRun } = parseArgs()
  const raw = await readFile(PRODUCTS_PATH, 'utf-8')
  const { products } = JSON.parse(raw)
  if (!Array.isArray(products)) throw new Error('products.json: products[] fehlt')

  let ralPalette = {}
  try { ralPalette = JSON.parse(await readFile(RAL_COLORS_PATH, 'utf-8')) } catch {}
  const ralToHex = (ral) => {
    const e = ralPalette?.[ral]
    return e?.hex ? '#' + e.hex.replace(/^#/, '').toUpperCase() : null
  }

  const seen = new Set()
  const jobs = []
  const missing = []

  for (const article of CATALOG_P134_ARTICLES) {
    const id = findProductIdForArticle(products, article)
    if (!id) {
      missing.push(article)
      continue
    }
    if (seen.has(id)) continue
    seen.add(id)
    const prod = products.find((p) => p.id === id)
    jobs.push({ article, productId: id, product: prod })
  }

    log.info(`Katalog S.134: ${CATALOG_P134_ARTICLES.length} Artikelnummern → ${jobs.length} eindeutige Produkte (jobs), fehlend in DB: ${missing.length}`)
  if (missing.length) {
        log.info('Nicht in products.json gefunden:', missing.join(', '))
  }
  if (dryRun) {
    jobs.forEach((j, i) => log.info(`${i + 1}. ${j.productId} (Art. ${j.article})`))
        log.info('\n--dry-run: keine Requests.')
    return
  }

  const rotateAxis = (process.env.ROTATE_AXIS || '').trim().toUpperCase()
  const rotateDegrees = (process.env.ROTATE_DEGREES || '').trim()
  let options = undefined
  if ((rotateAxis === 'X' || rotateAxis === 'Y' || rotateAxis === 'Z') && ['90', '180', '270'].includes(rotateDegrees)) {
    options = { rotateAxis, rotateDegrees, rotateYUp: 'false' }
        log.info(`Rotation vor Konvertierung: ${rotateAxis} ${rotateDegrees}°`)
  }

    log.info(`Ziel: ${SHOWROOM_URL}/__api/convert-product (Pause ${DELAY_MS} ms)\n`)

  for (let i = 0; i < jobs.length; i++) {
    const { productId, article, product } = jobs[i]
    const payload = { productId, ...(options ? { options } : {}) }
    const dcHex = product?.defaultColor ? ralToHex(product.defaultColor) : null
    if (usesProductDefaultSurfaceColor(product) && dcHex) {
      payload.defaultColorHex = dcHex
    }
    try {
      const res = await fetch(`${SHOWROOM_URL}/__api/convert-product`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const text = await res.text()
      let data = {}
      try {
        data = text ? JSON.parse(text) : {}
      } catch {
        data = { raw: text }
      }
      if (!res.ok || !data.jobId) {
                log.error(`[${i + 1}/${jobs.length}] FEHLER ${productId}:`, data.error || data.message || text || res.status)
      } else {
                log.info(`[${i + 1}/${jobs.length}] OK jobId=${data.jobId} ${productId} (Art. ${article})`)
      }
    } catch (e) {
            log.error(`[${i + 1}/${jobs.length}] FETCH ${productId}:`, e.message)
    }
    if (i < jobs.length - 1) await new Promise((r) => setTimeout(r, DELAY_MS))
  }

    log.info('\nFertig. Job-Status im Converter-Dashboard prüfen; nach Abschluss registriert der Client wie gewohnt die GLBs.')
}

main().catch((e) => {
    log.error(e)
  process.exit(1)
})
