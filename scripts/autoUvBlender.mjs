/**
 * Automatische UVs für OBJ per Blender (Smart Project + Pack).
 *
 * Voraussetzung: Blender auf dem Rechner (oder CI), z. B.
 *   export BLENDER_PATH="/Applications/Blender.app/Contents/MacOS/Blender"
 *
 * Aktivierung Konvertierung (Vite convert-product):
 *   export AUTO_UV_BLENDER=1
 *   und/oder conversionPreset.autoUvObj: "true"
 *   und/oder POST-Body options.autoUv: true
 *
 * CLI: npm run cad:auto-uv -- --input public/models/obj/foo.obj
 */
import { createLogger } from './lib/logger.mjs'
const log = createLogger("autoUvBlender")


import { spawnSync } from 'child_process'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'

/** Erste mtllib-Zeile aus dem Original-OBJ (ASCII) erhalten. */
export function extractMtllibLine(objUtf8) {
  const m = objUtf8.match(/^mtllib\s+.+$/m)
  return m ? m[0].trimEnd() : null
}

/** mtllib aus dem Original in den Blender-Export übernehmen (Pfade zu MTL bleiben konsistent). */
export function mergeOriginalMtllib(originalUtf8, exportedUtf8) {
  const ml = extractMtllibLine(originalUtf8)
  if (!ml) return exportedUtf8
  if (/^mtllib\s/m.test(exportedUtf8)) return exportedUtf8.replace(/^mtllib\s.*$/m, ml)
  const lines = exportedUtf8.split(/\r?\n/)
  let i = 0
  while (i < lines.length && (lines[i].startsWith('#') || lines[i].trim() === '')) i++
  lines.splice(i, 0, ml)
  return lines.join('\n')
}

/**
 * @param {string} ROOT - Projektroot
 * @param {{ cadUrl: string, buf: Buffer }[]} filesToAppend
 */
export async function runBlenderAutoUvOnObjBuffers(ROOT, filesToAppend) {
  const blenderExe = (process.env.BLENDER_PATH || process.env.BLENDER || 'blender').trim()
  const py = resolve(ROOT, 'scripts', 'blender_auto_uv.py')
  for (const entry of filesToAppend) {
    const name = (entry.cadUrl || '').split('/').pop() || ''
    if (!name.toLowerCase().endsWith('.obj')) continue
    const originalUtf8 = entry.buf.toString('utf-8')
    const tmp = await mkdtemp(join(tmpdir(), 'meta-auto-uv-'))
    const inP = join(tmp, 'in.obj')
    const outP = join(tmp, 'out.obj')
    try {
      await writeFile(inP, entry.buf)
      const r = spawnSync(blenderExe, ['--background', '--python', py, '--', inP, outP], {
        encoding: 'utf-8',
        cwd: ROOT,
        maxBuffer: 50 * 1024 * 1024,
      })
      if (r.status !== 0) {
        log.warn(
          `Blender beendet mit ${r.status} (${name}). Stderr:`,
          (r.stderr || r.stdout || '').slice(0, 1500),
        )
        continue
      }
      let outText = (await readFile(outP)).toString('utf-8')
      outText = mergeOriginalMtllib(originalUtf8, outText)
      entry.buf = Buffer.from(outText, 'utf-8')
            log.info(`[auto-uv] UV gesetzt (Blender Smart Project): ${name}`)
    } catch (e) {
            log.warn(`[auto-uv] ${name}:`, e.message)
    } finally {
      await rm(tmp, { recursive: true, force: true }).catch(() => {})
    }
  }
}
