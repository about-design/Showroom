#!/usr/bin/env node
import { createLogger } from './lib/logger.mjs'
const log = createLogger("slim-mtl-mapping")

/**
 * Erzeugt eine schlanke mtl-ral-color-mapping.json für public/ (< 2 MB),
 * damit Vite convert-product die Datei nicht verwirft.
 *
 * Nutzung:
 *   node scripts/slim-mtl-mapping.mjs
 *   node scripts/slim-mtl-mapping.mjs path/zur/gross-mapping.json path/zur/ausgabe.json
 */
import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const ROOT = process.cwd()
/** Standard-Quelle: schlankes Mapping in public/ (die große src/data-Datei ist entfernt). */
const src = resolve(ROOT, process.argv[2] || 'public/mtl-ral-color-mapping.json')
const out = resolve(ROOT, process.argv[3] || 'public/mtl-ral-color-mapping.json')

const raw = readFileSync(src, 'utf8')
const data = JSON.parse(raw)

const slim = {}
if (Array.isArray(data.sourcePalette)) slim.sourcePalette = data.sourcePalette
if (data.matchRal && typeof data.matchRal === 'object') slim.matchRal = data.matchRal
if (Array.isArray(data.matchPalette)) slim.matchPalette = data.matchPalette
if (data.matches && typeof data.matches === 'object') slim.matches = data.matches
if (Array.isArray(data.overrideExcludeHex)) slim.overrideExcludeHex = data.overrideExcludeHex
if (Array.isArray(data.nameColorRules)) slim.nameColorRules = data.nameColorRules
if (Array.isArray(data.geometryColorRules)) slim.geometryColorRules = data.geometryColorRules
if (Array.isArray(data.vertexReductionRules)) slim.vertexReductionRules = data.vertexReductionRules
slim._comment =
  data._comment ||
  'Schlanke Variante (ohne materials/hexToId-Ballast). Erzeugt mit: node scripts/slim-mtl-mapping.mjs'

const json = JSON.stringify(slim, null, 2)
writeFileSync(out, json, 'utf8')
const bytes = Buffer.byteLength(json, 'utf8')
log.info('Geschrieben:', out)
log.info('Größe:', bytes, 'Bytes', `(${(bytes / 1024).toFixed(1)} KB)`)
if (bytes > 2 * 1024 * 1024) {
    log.warn('Warnung: > 2 MB – Vite convert-product ignoriert Mapping weiterhin.')
}
