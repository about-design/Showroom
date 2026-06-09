#!/usr/bin/env node
import { createLogger } from './lib/logger.mjs'
const log = createLogger("update-products-from-models")

/**
 * Scannt public/models/products (inkl. Unterordner) nach .glb-Dateien
 * und aktualisiert src/data/products.json:
 * - Neue GLBs werden als Produkte hinzugefügt (bestehende Einträge bleiben).
 * - Mit --sync werden Einträge entfernt, deren GLB-Datei nicht mehr existiert.
 *
 * Unterordner: z.B. public/models/products/Regale/classic.glb
 *   → glbFile: "/models/products/Regale/classic.glb"
 *   → id: "Regale-classic"
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const productsDir = path.join(root, 'public', 'models')
const productsJsonPath = path.join(root, 'src', 'data', 'products.json')

const sync = process.argv.includes('--sync')

function* walkDir(dir, relative = '') {
  if (!fs.existsSync(dir)) return
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const e of entries) {
    const rel = relative ? `${relative}/${e.name}` : e.name
    const fullPath = path.join(dir, e.name)
    const isDir = e.isDirectory() || (e.isSymbolicLink() && fs.statSync(fullPath).isDirectory())
    if (isDir) {
      yield* walkDir(fullPath, rel)
    } else if ((e.isFile() || e.isSymbolicLink()) && e.name.toLowerCase().endsWith('.glb')) {
      yield rel
    }
  }
}

function pathToId(relativePath) {
  return relativePath
    .replace(/\.glb$/i, '')
    .replace(/[/\\]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'product'
}

function urlPath(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/')
  return `/models/${normalized}`
}

function hasUsdz(relativePath) {
  const dir = path.join(productsDir, path.dirname(relativePath))
  const base = path.basename(relativePath, '.glb')
  return fs.existsSync(path.join(dir, `${base}.usdz`))
}

function usdzPath(relativePath) {
  const normalized = relativePath.replace(/\.glb$/i, '.usdz').replace(/\\/g, '/')
  return `/models/${normalized}`
}

const CAD_EXTENSIONS = ['.obj', '.mtl', '.step', '.stp', '.fbx', '.stl', '.dae', '.iges', '.igs', '.3ds']
const scanOrientation = process.argv.includes('--orientations')

// ── GLB Orientierungs-Erkennung ────────────────────────────────────
function isIdQuat(x, y, z, w) {
  return Math.abs(x) < .01 && Math.abs(y) < .01 && Math.abs(z) < .01 && Math.abs(Math.abs(w) - 1) < .01
}
function isZupCorrQuat(x, y, z, w) {
  return Math.abs(Math.abs(x) - .7071) < .02 && Math.abs(y) < .02 && Math.abs(z) < .02 && Math.abs(Math.abs(w) - .7071) < .02
}
function isZupCorrMatrix(m) {
  const a = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1]
  const b = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]
  const cl = r => r.every((v, i) => Math.abs(m[i] - v) < .02)
  return cl(a) || cl(b)
}

function detectOrientationFromGlb(glbPath) {
  try {
    const fd = fs.openSync(glbPath, 'r')
    try {
      const header = Buffer.alloc(20)
      fs.readSync(fd, header, 0, 20, 0)
      if (header.readUInt32LE(0) !== 0x46546C67) return null
      const jsonLen = header.readUInt32LE(12)
      // Schutz gegen manipulierte/korrupte GLBs: unbegrenztes Buffer.alloc vermeiden
      const MAX_GLB_JSON_BYTES = 64 * 1024 * 1024
      if (!Number.isFinite(jsonLen) || jsonLen <= 0 || jsonLen > MAX_GLB_JSON_BYTES) return null
      const jsonBuf = Buffer.alloc(jsonLen)
      fs.readSync(fd, jsonBuf, 0, jsonLen, 20)
      const json = JSON.parse(jsonBuf.toString('utf-8'))
      const rootIndices = json.scenes?.[json.scene ?? 0]?.nodes || []
      let hasZup = false, hasRot = false
      for (const idx of rootIndices) {
        const node = json.nodes?.[idx]
        if (!node) continue
        if (node.rotation) {
          const [qx, qy, qz, qw] = node.rotation
          if (isZupCorrQuat(qx, qy, qz, qw)) hasZup = true
          else if (!isIdQuat(qx, qy, qz, qw)) hasRot = true
        }
        if (node.matrix) {
          const m = node.matrix
          const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
          if (!m.every((v, i) => Math.abs(v - id[i]) < 0.001)) {
            if (isZupCorrMatrix(m)) hasZup = true
            else hasRot = true
          }
        }
      }
      return hasZup ? 'z-up' : hasRot ? 'y-up-root' : 'y-up'
    } finally { fs.closeSync(fd) }
  } catch { return null }
}

function findCadFiles(relativePath) {
  const dir = path.join(productsDir, path.dirname(relativePath))
  if (!fs.existsSync(dir)) return []
  const found = []
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      const ext = path.extname(entry.name).toLowerCase()
      if (!CAD_EXTENSIONS.includes(ext)) continue
      const relDir = path.dirname(relativePath)
      const relFile = relDir === '.' ? entry.name : `${relDir}/${entry.name}`
      found.push(urlPath(relFile))
    }
  } catch {}
  return found
}

/** Liest RAL aus Dateinamen: z.B. "…_RAL_7035.glb" → "RAL 7035". _VZK wird nicht mehr als RAL 9007 gewertet. */
function ralFromFilename(relativePath) {
  const base = path.basename(relativePath, '.glb')
  const ralMatch = base.match(/_RAL_(\d{4})(?:_|\.|$)/i)
  if (ralMatch) return `RAL ${ralMatch[1]}`
  return null
}

function defaultProduct(relativePath) {
  const id = pathToId(relativePath)
  const glbUrl = urlPath(relativePath)
  const defaultColor = ralFromFilename(relativePath) || 'RAL 7035'
  const product = {
    id,
    name: `Produkt ${id}`,
    glbFile: glbUrl,
    colorableMeshes: [],
    defaultColor,
    hotspots: [
      {
        id: 'info-1',
        position: { x: 0, y: 1, z: 0.5 },
        title: 'Info',
        content: `${id} – Infos in products.json anpassen.`,
        icon: 'info',
      },
    ],
    specs: { load: '–', height: '–', width: '–', depth: '–' },
    shopwareProductId: '',
  }
  if (hasUsdz(relativePath)) {
    product.usdzFile = usdzPath(relativePath)
  }
  const cadFiles = findCadFiles(relativePath)
  if (cadFiles.length) product.cadFiles = cadFiles
  return product
}

// Alle GLBs auf der Festplatte (mit Unterordnern)
const foundPaths = [...walkDir(productsDir)]
const foundByUrl = new Map(foundPaths.map((rel) => [urlPath(rel), rel]))

// Bestehende products.json laden
let data = { products: [] }
if (fs.existsSync(productsJsonPath)) {
  data = JSON.parse(fs.readFileSync(productsJsonPath, 'utf8'))
  if (!Array.isArray(data.products)) data.products = []
}

const existingByGlb = new Map(data.products.map((p) => [p.glbFile, p]))
const updated = []

// 1) Bestehende behalten – nur bei --sync entfernen, wenn Datei fehlt
for (const p of data.products) {
  const exists = foundByUrl.has(p.glbFile)
  if (exists) {
    updated.push(p)
  } else if (!sync) {
    updated.push(p)
  }
  // wenn sync && !exists: nicht übernehmen (Eintrag entfernen)
}

// 2) Neue GLBs hinzufügen + bei bestehenden CAD-Dateien ergänzen
for (const rel of foundPaths) {
  const url = urlPath(rel)
  if (!existingByGlb.has(url)) {
    updated.push(defaultProduct(rel))
  } else {
    const existing = existingByGlb.get(url)
    // USDZ-Datei ergänzen falls vorhanden
    if (!existing.usdzFile && hasUsdz(rel)) {
      existing.usdzFile = usdzPath(rel)
    }
    // CAD-Dateien ergänzen (nicht überschreiben)
    const foundCad = findCadFiles(rel)
    if (foundCad.length) {
      const existingSet = new Set(existing.cadFiles || [])
      foundCad.forEach(f => existingSet.add(f))
      existing.cadFiles = [...existingSet]
    }
  }
}

const removed = sync ? data.products.length - updated.length : 0
data.products = updated

// Orientierungserkennung (--orientations)
if (scanOrientation) {
  let scanned = 0, skipped = 0
  for (const p of data.products) {
    if (p.orientation) { skipped++; continue }
    if (!p.glbFile) continue
    const absGlb = path.join(root, 'public', ...p.glbFile.replace(/^\//, '').split('/'))
    const ori = detectOrientationFromGlb(absGlb)
    if (ori) { p.orientation = ori; scanned++ }
  }
    log.info(`Orientierung erkannt: ${scanned} Produkte gescannt, ${skipped} übersprungen (bereits gesetzt).`)
}

fs.writeFileSync(productsJsonPath, JSON.stringify(data, null, 2) + '\n', 'utf8')

log.info(`products.json aktualisiert: ${updated.length} Produkte (${foundPaths.length} GLB(s) im Ordner).`)
if (removed > 0) log.info(`Entfernt (--sync): ${removed} Einträge ohne vorhandene GLB-Datei.`)
