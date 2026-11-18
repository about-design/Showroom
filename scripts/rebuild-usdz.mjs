/**
 * USDZ aus den ausgelieferten GLBs neu erzeugen.
 *
 * Nötig für Produkte, deren USDZ noch aus der Zeit stammt, als sie roh vom
 * Konverter übernommen wurde: Die Konverter-USDZ entsteht vor dem Bake und
 * enthält deshalb Teile, die Sichtbarkeits-Regeln aus der GLB entfernt haben —
 * bei entsprechend vielfacher Dateigröße.
 *
 * Aufruf:
 *   node scripts/rebuild-usdz.mjs              → alle Produkte mit GLB prüfen
 *   node scripts/rebuild-usdz.mjs --dry-run    → nur zeigen, was passieren würde
 *   node scripts/rebuild-usdz.mjs --id=<id>    → nur ein Produkt
 */
import { readFile, stat } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { buildUsdzFromGlb, usdzFailureHint, resolveBlenderBinary, resolveUsdzip } from './lib/usdzFromGlb.mjs'
import { createLogger } from './lib/logger.mjs'

const log = createLogger('rebuild-usdz')
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const onlyId = (args.find((a) => a.startsWith('--id=')) || '').slice('--id='.length) || null

const kb = (n) => `${(n / 1024).toFixed(0)} KB`

async function sizeOf(file) {
  try {
    return (await stat(file)).size
  } catch {
    return null
  }
}

const blender = resolveBlenderBinary()
const usdzip = resolveUsdzip()
log.info(`Blender: ${blender || 'NICHT GEFUNDEN'}`)
log.info(`usdzip : ${usdzip || 'NICHT GEFUNDEN'}`)
if (!dryRun && (!blender || !usdzip)) {
  log.error('Ohne Blender und usdzip kann keine USDZ erzeugt werden — abgebrochen.')
  process.exit(1)
}

const data = JSON.parse(await readFile(path.resolve(ROOT, 'src/data/products.json'), 'utf-8'))
const products = (Array.isArray(data?.products) ? data.products : []).filter(
  (p) => p?.glbFile && (!onlyId || p.id === onlyId),
)

let done = 0
let skipped = 0
let failed = 0
let bytesBefore = 0
let bytesAfter = 0

for (const p of products) {
  const glb = path.resolve(ROOT, 'public', p.glbFile.split('?')[0].replace(/^\//, ''))
  if (!existsSync(glb)) {
    skipped++
    continue
  }
  const usdz = glb.replace(/\.glb$/i, '.usdz')
  const before = await sizeOf(usdz)
  const glbSize = await sizeOf(glb)

  if (dryRun) {
    log.info(`${p.id}: GLB ${kb(glbSize)} · USDZ aktuell ${before == null ? '—' : kb(before)}`)
    continue
  }

  const res = buildUsdzFromGlb(glb, usdz)
  if (!res.ok) {
    failed++
    log.warn(`${p.id}: fehlgeschlagen — ${usdzFailureHint(res.reason)}${res.detail ? ` (${res.detail})` : ''}`)
    continue
  }
  const after = await sizeOf(usdz)
  bytesBefore += before || 0
  bytesAfter += after || 0
  done++
  const factor = before && after ? ` · Faktor ${(before / after).toFixed(before / after >= 10 ? 0 : 1)}` : ''
  log.info(`${p.id}: ${before == null ? 'neu' : kb(before)} → ${kb(after)}${factor}`)
}

if (!dryRun) {
  log.info(
    `Fertig: ${done} erzeugt, ${skipped} ohne GLB übersprungen, ${failed} fehlgeschlagen. ` +
      `Gesamt ${kb(bytesBefore)} → ${kb(bytesAfter)}.`,
  )
}
