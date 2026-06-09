#!/usr/bin/env node
import { createLogger } from './lib/logger.mjs'
const log = createLogger("check-glb-orientations")

/**
 * Prüft alle in products.json referenzierten GLB-Dateien auf Orientierung
 * und baut/aktualisiert glb-export-config.json für einheitlichen Export.
 *
 * Usage:
 *   node scripts/check-glb-orientations.js           → Nur Report (Console)
 *   node scripts/check-glb-orientations.js --write    → Config-Datei schreiben/aktualisieren
 *   node scripts/check-glb-orientations.js --products=pfad/products.json
 *   node scripts/check-glb-orientations.js --config=pfad/glb-export-config.json
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const args = process.argv.slice(2)
const flag = (name) => {
  const eq = args.find((a) => a.startsWith(`--${name}=`))
  if (eq) return eq.split('=').slice(1).join('=')
  const idx = args.indexOf(`--${name}`)
  if (idx >= 0 && idx + 1 < args.length && !args[idx + 1].startsWith('--')) return args[idx + 1]
  return undefined
}
const hasFlag = (name) => args.some((a) => a === `--${name}` || a.startsWith(`--${name}=`))

const productsPath = path.resolve(ROOT, flag('products') || 'src/data/products.json')
const configPath = path.resolve(ROOT, flag('config') || 'glb-export-config.json')
const doWrite = hasFlag('write')

// ─── Orientierung aus GLB (Root-Node) ─────────────────────────────
function isIdQuat(x, y, z, w) {
  return Math.abs(x) < 0.01 && Math.abs(y) < 0.01 && Math.abs(z) < 0.01 && Math.abs(Math.abs(w) - 1) < 0.01
}
function isZupCorrQuat(x, y, z, w) {
  return Math.abs(Math.abs(x) - 0.7071) < 0.02 && Math.abs(y) < 0.02 && Math.abs(z) < 0.02 && Math.abs(Math.abs(w) - 0.7071) < 0.02
}
function isZupCorrMatrix(m) {
  const a = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1]
  const b = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]
  const cl = (r) => r.every((v, i) => Math.abs(m[i] - v) < 0.02)
  return cl(a) || cl(b)
}

function detectOrientation(glbAbsPath) {
  try {
    const buf = fs.readFileSync(glbAbsPath)
    if (buf.length < 20) return null
    if (buf.readUInt32LE(0) !== 0x46546c67) return null
    const jsonLen = buf.readUInt32LE(12)
    const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf-8'))
    const rootIndices = json.scenes?.[json.scene ?? 0]?.nodes || []
    let hasZup = false
    let hasRot = false
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
  } catch {
    return null
  }
}

// ─── Main ──────────────────────────────────────────────────────────
let products = []
if (fs.existsSync(productsPath)) {
  const data = JSON.parse(fs.readFileSync(productsPath, 'utf-8'))
  products = Array.isArray(data?.products) ? data.products : []
}

const glbFiles = [...new Set(products.filter((p) => p.glbFile).map((p) => p.glbFile))]
const publicDir = path.join(ROOT, 'public')

const report = { total: glbFiles.length, yUp: 0, zUp: 0, yUpRoot: 0, missing: 0, error: 0 }
const fileResults = []

for (const glbFile of glbFiles) {
  const normalized = glbFile.replace(/^\//, '')
  const absPath = path.join(publicDir, normalized)
  const productIds = products.filter((p) => p.glbFile === glbFile).map((p) => p.id)
  const rotationOffset = products.find((p) => p.glbFile === glbFile)?.rotationOffset ?? null

  const entry = {
    glbFile,
    productIds,
    rotationOffset,
    exists: fs.existsSync(absPath),
    detectedOrientation: null,
    needsBakeYUp: false,
    suggestedRotationOffset: null,
  }

  if (!entry.exists) {
    report.missing++
    fileResults.push(entry)
    continue
  }

  const ori = detectOrientation(absPath)
  entry.detectedOrientation = ori

  if (ori === 'z-up') {
    report.zUp++
    entry.needsBakeYUp = true
    entry.suggestedRotationOffset = { x: -90, y: 0, z: 0 }
  } else if (ori === 'y-up-root') {
    report.yUpRoot++
    entry.needsBakeYUp = true
    entry.suggestedRotationOffset = null
  } else if (ori === 'y-up') {
    report.yUp++
  } else {
    report.error++
  }

  fileResults.push(entry)
}

// Config laden/erzeugen
let config = {
  _comment: 'Zentrale Konfiguration für einheitlichen GLB-Export.',
  _meta: { version: 1, updatedAt: new Date().toISOString(), description: 'Defaults für alle Exporte; files pro GLB.' },
  defaults: {
    converter: {
      scale: '0.001',
      importUpAxis: 'AUTO',
      bakeYUp: true,
      rotateAxis: '',
      rotateDegrees: '',
      useDraco: false,
      tessellationQuality: '0.1',
      decimateRatio: '1.0',
      embedTextures: true,
      stripCamerasLights: true,
      materialFinish: 'auto',
    },
    pipeline: {
      bakeYUpAfterConvert: true,
      useDracoAfterBake: false,
    },
    runtime: { rotationOffset: null },
  },
  files: {},
}

if (fs.existsSync(configPath)) {
  try {
    const existing = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    if (existing.defaults) config.defaults = { ...config.defaults, ...existing.defaults }
    if (existing.files && typeof existing.files === 'object') config.files = { ...existing.files }
  } catch (_) {}
}

for (const r of fileResults) {
  const key = r.glbFile
  config.files[key] = {
    detectedOrientation: r.detectedOrientation,
    needsBakeYUp: r.needsBakeYUp,
    suggestedRotationOffset: r.suggestedRotationOffset,
    rotationOffset: r.rotationOffset,
    productIds: r.productIds,
    exists: r.exists,
  }
}
config._meta.updatedAt = new Date().toISOString()

// Report
log.info('\n╔══════════════════════════════════════════════════════╗')
log.info('║   GLB-Orientierungs-Check (products.json)           ║')
log.info('╚══════════════════════════════════════════════════════╝')
log.info(`  Produkte mit GLB: ${report.total}`)
log.info(`  Y-up (bereits korrekt):  ${report.yUp}`)
log.info(`  Z-up (Bake Y-up nötig):  ${report.zUp}`)
log.info(`  Y-up mit Root-Rotation:  ${report.yUpRoot}`)
log.info(`  Datei fehlt:             ${report.missing}`)
if (report.error) log.info(`  Fehler beim Lesen:       ${report.error}`)
log.info('')

if (report.zUp + report.yUpRoot > 0) {
    log.info('  Empfehlung: Diese Dateien einheitlich mit Bake Y-up verarbeiten:')
    log.info('    npm run glb:bake-yup          # Dry-Run')
    log.info('    npm run glb:bake-yup:write    # In-Place mit Backup')
    log.info('  Oder im CAD-Konverter: bakeYUp aktivieren + ggf. rotateAxis X / rotateDegrees 90.')
    log.info('')
}

if (doWrite) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
    log.info(`  Config geschrieben: ${configPath}`)
} else {
    log.info('  Nur Report. Zum Aktualisieren der Config: --write')
}

log.info('')
