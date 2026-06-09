#!/usr/bin/env node
import { createLogger } from './lib/logger.mjs'
const log = createLogger("run-auto-uv")

/**
 * CLI: eine OBJ-Datei mit Blender neu UV-mappen.
 *   npm run cad:auto-uv -- --input public/models/obj/200170830.obj
 * Optional: --output anderer.obj (sonst In-Place + .bak)
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { runBlenderAutoUvOnObjBuffers } from './autoUvBlender.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

function arg(name, short) {
  const i = process.argv.indexOf(name)
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  const j = short ? process.argv.indexOf(short) : -1
  if (j >= 0 && process.argv[j + 1]) return process.argv[j + 1]
  const eq = process.argv.find((a) => a.startsWith(`${name}=`))
  if (eq) return eq.split('=').slice(1).join('=')
  return null
}

const inputRel = arg('--input', '-i')
const outputRel = arg('--output', '-o')

if (!inputRel) {
    log.error('Nutze: npm run cad:auto-uv -- --input public/models/obj/datei.obj [--output out.obj]')
  process.exit(1)
}

const inputAbs = resolve(ROOT, inputRel)
if (!existsSync(inputAbs)) {
    log.error('Datei nicht gefunden:', inputAbs)
  process.exit(2)
}

const buf = readFileSync(inputAbs)
const fake = [{ cadUrl: inputRel, buf }]
await runBlenderAutoUvOnObjBuffers(ROOT, fake)
const outBuf = fake[0].buf

const outAbs = outputRel ? resolve(ROOT, outputRel) : inputAbs
if (outAbs === inputAbs) {
  const bak = inputAbs + '.bak'
  copyFileSync(inputAbs, bak)
    log.info('Backup:', bak)
}
writeFileSync(outAbs, outBuf)
log.info('Geschrieben:', outAbs)
