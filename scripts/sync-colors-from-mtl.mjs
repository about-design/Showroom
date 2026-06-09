#!/usr/bin/env node
import { createLogger } from './lib/logger.mjs'
const log = createLogger("sync-colors-from-mtl")

/**
 * MTL-Master: Liest Kd-Farben aus MTL-Dateien der Produkte, ordnet sie über
 * public/mtl-ral-color-mapping.json RAL zu und aktualisiert products.json
 * (defaultColor, surfaceFinish, _mtlColors).
 *
 * Nutzung:
 *   node scripts/sync-colors-from-mtl.mjs
 *   node scripts/sync-colors-from-mtl.mjs --dry-run
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { normalizeMappingHex } from '../src/lib/hexMapping.js'

/** @see ../src/lib/defaultColorMapping.js DEFAULT_COLOR_FROM_MAPPING */
const DEFAULT_COLOR_FROM_MAPPING = '__mapping__'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const PRODUCTS_PATH = resolve(ROOT, 'src/data/products.json')
const MAPPING_PATH = resolve(ROOT, 'public/mtl-ral-color-mapping.json')
const PUBLIC = resolve(ROOT, 'public')

const RAL_VERZINKT = 'RAL 9007'

const dryRun = process.argv.includes('--dry-run')

function rgbToHex(r, g, b) {
  const to255 = (v) => Math.round(Math.max(0, Math.min(1, Number(v))) * 255)
  return normalizeMappingHex(
    '#' + [to255(r), to255(g), to255(b)].map((x) => x.toString(16).padStart(2, '0')).join(''),
  )
}

/**
 * Pro Materialblock: map_Kd → texturiert (Kd nicht als Produktfarbe nutzen).
 * Nur Kd-Zeilen (diffuse) auswerten.
 */
function parseMtlMaterials(content) {
  const blocks = []
  let current = null
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    if (t.startsWith('newmtl ')) {
      current = { name: t.slice(7).trim(), hasMapKd: false, kd: null }
      blocks.push(current)
      continue
    }
    if (!current) continue
    if (/^map_Kd\b/i.test(t)) {
      current.hasMapKd = true
      continue
    }
    if (t.startsWith('Kd ') || t.startsWith('kd ')) {
      const parts = t.slice(2).trim().split(/\s+/).map(Number)
      if (parts.length >= 3 && parts.every((n) => Number.isFinite(n))) {
        current.kd = { r: parts[0], g: parts[1], b: parts[2] }
      }
    }
  }
  return blocks
}

/** hex (normalized) → RAL-Code-String "RAL nnnn" nur für diffuse-Palette-Einträge */
function buildDiffuseHexToRal(mapping) {
  const out = new Map()
  const palette = mapping.sourcePalette
  if (!Array.isArray(palette) || !mapping.matchRal) return out
  for (const c of palette) {
    if (String(c.type || '').toLowerCase() !== 'diffuse') continue
    const id = String(c.id)
    const ralKey = mapping.matchRal[id]
    if (!ralKey || !c.hex) continue
    const hex = normalizeMappingHex(c.hex)
    if (hex && /^#[0-9A-F]{6}$/.test(hex)) out.set(hex, ralKey)
  }
  return out
}

function resolveCadPath(cadUrl) {
  const rel = String(cadUrl || '').replace(/^\//, '')
  return resolve(PUBLIC, ...rel.split('/').filter(Boolean))
}

function analyzeProductMtls(product, hexToRal, excludeSet) {
  const cadFiles = product.cadFiles
  if (!Array.isArray(cadFiles) || cadFiles.length === 0) return null

  const mtlUrls = cadFiles.filter((f) => /\.mtl$/i.test(f))
  if (mtlUrls.length === 0) return null

  /** @type {{ hex: string, ral: string | null, material: string, skippedTexture: boolean }[]} */
  const entries = []
  /** @type {Map<string, number>} */
  const ralCounts = new Map()

  for (const url of mtlUrls) {
    const path = resolveCadPath(url)
    if (!existsSync(path)) continue
    let content
    try {
      content = readFileSync(path, 'utf8')
    } catch {
      continue
    }
    const mats = parseMtlMaterials(content)
    for (const m of mats) {
      if (m.hasMapKd) {
        entries.push({
          hex: null,
          ral: null,
          material: m.name,
          skippedTexture: true,
        })
        continue
      }
      if (!m.kd) continue
      const hex = rgbToHex(m.kd.r, m.kd.g, m.kd.b)
      if (!hex || !/^#[0-9A-F]{6}$/.test(hex)) continue
      if (excludeSet.has(hex)) {
        entries.push({ hex, ral: null, material: m.name, excluded: true })
        continue
      }
      const ral = hexToRal.get(hex) || null
      entries.push({ hex, ral, material: m.name, skippedTexture: false })
      if (ral) {
        ralCounts.set(ral, (ralCounts.get(ral) || 0) + 1)
      }
    }
  }

  if (entries.length === 0) return null
  if (ralCounts.size === 0) {
    return { entries, dominantRal: null, ralCounts }
  }

  let dominantRal = null
  let best = -1
  for (const [ral, n] of ralCounts) {
    if (n > best) {
      best = n
      dominantRal = ral
    }
  }

  return { entries, dominantRal, ralCounts }
}

function surfaceFinishFromRal(ralKey) {
  if (!ralKey) return 'auto'
  return ralKey.trim() === RAL_VERZINKT ? 'verzinkt' : 'pulver'
}

function main() {
  if (!existsSync(MAPPING_PATH)) {
        log.error('Mapping fehlt:', MAPPING_PATH)
    process.exit(1)
  }
  if (!existsSync(PRODUCTS_PATH)) {
        log.error('products.json fehlt:', PRODUCTS_PATH)
    process.exit(1)
  }

  const mapping = JSON.parse(readFileSync(MAPPING_PATH, 'utf8'))
  const excludeSet = new Set(
    (mapping.overrideExcludeHex || []).map((h) => normalizeMappingHex(h)).filter(Boolean),
  )
  const hexToRal = buildDiffuseHexToRal(mapping)

  const raw = readFileSync(PRODUCTS_PATH, 'utf8')
  const data = JSON.parse(raw)
  const products = data.products
  if (!Array.isArray(products)) {
        log.error('products.json: products[] erwartet')
    process.exit(1)
  }

  let updated = 0
  let skipped = 0
  let noMtl = 0
  let noMatch = 0

  for (const p of products) {
    const analysis = analyzeProductMtls(p, hexToRal, excludeSet)
    if (!analysis) {
      noMtl++
      continue
    }
    const { entries, dominantRal, ralCounts } = analysis
    if (!dominantRal) {
      noMatch++
      continue
    }

    const nextDefaultColor = dominantRal
    const nextSurface = surfaceFinishFromRal(dominantRal)
    const metaBase = {
      dominantRal,
      ralCounts: Object.fromEntries(ralCounts),
      materials: entries,
    }
    const prevMeta = p._mtlColors
      ? {
          dominantRal: p._mtlColors.dominantRal,
          ralCounts: p._mtlColors.ralCounts,
          materials: p._mtlColors.materials,
        }
      : null

    const isAuto = p.defaultColor === DEFAULT_COLOR_FROM_MAPPING
    const changed = isAuto
      ? p.surfaceFinish !== nextSurface || JSON.stringify(prevMeta) !== JSON.stringify(metaBase)
      : p.defaultColor !== nextDefaultColor ||
        p.surfaceFinish !== nextSurface ||
        JSON.stringify(prevMeta) !== JSON.stringify(metaBase)

    if (changed) {
      updated++
      if (!dryRun) {
        p.surfaceFinish = nextSurface
        p._mtlColors = { ...metaBase, syncedAt: new Date().toISOString() }
        if (!isAuto) {
          p.defaultColor = nextDefaultColor
        }
      }
    } else {
      skipped++
    }
  }

  if (!dryRun && updated > 0) {
    writeFileSync(PRODUCTS_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8')
  }

  log.info(
    dryRun ? '[dry-run] Keine Datei geschrieben.' : `Geschrieben: ${PRODUCTS_PATH}`,
  )
    log.info(`Produkte gesamt: ${products.length}`)
    log.info(`Aktualisiert (oder nur _mtlColors): ${updated}`)
    log.info(`Unverändert: ${skipped}`)
    log.info(`Ohne MTL in cadFiles: ${noMtl}`)
    log.info(`Mit MTL aber kein RAL-Match: ${noMatch}`)
}

main()
