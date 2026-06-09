#!/usr/bin/env node
import { createLogger } from './lib/logger.mjs'
const log = createLogger("compress-glb-draco")

/**
 * Wendet Draco-Mesh-Kompression auf eine GLB-Datei an (in-place oder --out).
 * Wird nach dem Bake (bake-glb-yup.js) aufgerufen, damit die Reihenfolge
 * „Bake → Draco" eingehalten wird und die Dateigröße gering bleibt.
 *
 * Usage:
 *   node scripts/compress-glb-draco.js --file=pfad/zu.glb   → in-place
 *   node scripts/compress-glb-draco.js --file=in.glb --out=out.glb
 */
import { NodeIO } from '@gltf-transform/core'
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions'
import fs from 'fs'
import path from 'path'

const args = process.argv.slice(2)
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]

const fileIn = flag('file')
const fileOut = flag('out')

if (!fileIn) {
    log.error('Usage: node scripts/compress-glb-draco.js --file=path/to.glb [--out=path/out.glb]')
  process.exit(1)
}

const inputPath = path.resolve(fileIn)
if (!fs.existsSync(inputPath)) {
    log.error('Datei nicht gefunden:', inputPath)
  process.exit(1)
}

const outputPath = fileOut ? path.resolve(fileOut) : inputPath

async function main() {
  const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS)
  try {
    const draco = await import('draco3dgltf')
    io.registerDependencies({
      'draco3d.decoder': await draco.default.createDecoderModule(),
      'draco3d.encoder': await draco.default.createEncoderModule(),
    })
  } catch (e) {
        log.error('Draco-Modul fehlt (draco3dgltf):', e.message)
    process.exit(1)
  }

  const { draco: dracoTransform } = await import('@gltf-transform/functions')

  const doc = await io.read(inputPath)
  await doc.transform(
    dracoTransform({ method: 'edgebreaker' })
  )

  if (outputPath === inputPath) {
    const tmp = inputPath + '.tmp.glb'
    await io.write(tmp, doc)
    fs.renameSync(tmp, inputPath)
  } else {
    await io.write(outputPath, doc)
  }
}

main().catch((err) => {
    log.error(err)
  process.exit(1)
})
