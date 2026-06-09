/**
 * POST /__api/blender-render
 * Body: JSON mit glbPath (unter /models/…), Kamera, Farbe, engine, resolution, …
 * Antwort: image/png (Binär) oder JSON { error } bei Fehler.
 */
import { spawn, spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { platform, tmpdir } from 'os'
import { join, resolve } from 'path'
import { createLogger } from '../lib/logger.mjs'

const log = createLogger('blender_render')

const BLENDER_TIMEOUT_MS = 10 * 60 * 1000 // 10 min
const MAX_BODY_BYTES = 256 * 1024
const MAX_DIM = 8192

const BLENDER_NOT_FOUND_HINT =
  'Blender wurde nicht gefunden. macOS: Blender von https://www.blender.org/download/ installieren, '
  + 'oder im Terminal vor `npm run dev` setzen: export BLENDER_PATH="/Applications/Blender.app/Contents/MacOS/Blender" '
  + '(Pfad anpassen, falls „Blender LTS.app“ o. Ä.). Windows: Blender installieren und ggf. BLENDER_PATH auf blender.exe zeigen.'

/** @returns {string|null} erste funktionierende Blender-Binary oder null */
function findBlenderExecutable() {
  const tryFile = (abs) => {
    const s = typeof abs === 'string' ? abs.trim() : ''
    if (s && existsSync(s)) return s
    return null
  }

  const envPath = tryFile(process.env.BLENDER_PATH || '')
  if (envPath) return envPath
  const envBlender = tryFile(process.env.BLENDER || '')
  if (envBlender) return envBlender

  if (platform() === 'darwin') {
    const macCandidates = [
      '/Applications/Blender.app/Contents/MacOS/Blender',
      '/Applications/Blender LTS.app/Contents/MacOS/Blender',
      '/Applications/Blender Studio.app/Contents/MacOS/Blender',
    ]
    for (const p of macCandidates) {
      const x = tryFile(p)
      if (x) return x
    }
  }

  if (platform() === 'win32') {
    const r = spawnSync('where', ['blender'], { encoding: 'utf-8', windowsHide: true, shell: true })
    if (r.status === 0 && r.stdout?.trim()) {
      const line = r.stdout.split(/\r?\n/).map((l) => l.trim()).find(Boolean)
      if (line) return line
    }
  } else {
    const r = spawnSync('which', ['blender'], { encoding: 'utf-8' })
    if (r.status === 0 && r.stdout?.trim()) {
      return r.stdout.trim().split(/\r?\n/)[0].trim()
    }
  }

  return null
}

/**
 * @param {{ ROOT: string, readBody: (req: import('http').IncomingMessage, max?: number) => Promise<Buffer>, isSafePath: (base: string, target: string) => boolean }} deps
 */
export function createBlenderRenderMiddleware(deps) {
  const { ROOT, readBody, isSafePath } = deps
  const PUBLIC_MODELS = resolve(ROOT, 'public', 'models')
  const PUBLIC_ROOT = resolve(ROOT, 'public')
  const PY_SCRIPT = resolve(ROOT, 'scripts', 'blender_render.py')

  return async function blenderRenderMiddleware(req, res) {
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'Nur POST' }))
      return
    }
    res.setHeader('Cache-Control', 'no-store')

    let tmpDir = null
    try {
      if (!existsSync(PY_SCRIPT)) {
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'blender_render.py fehlt im Projekt' }))
        return
      }

      const raw = await readBody(req, MAX_BODY_BYTES)
      let body
      try {
        body = JSON.parse(raw.toString('utf-8'))
      } catch (e) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: `Ungültiges JSON: ${e.message}` }))
        return
      }

      const glbPath = String(body?.glbPath || '').trim()
      if (!glbPath || !/\.glb$/i.test(glbPath)) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'glbPath (.glb) erforderlich' }))
        return
      }
      const clean = glbPath.startsWith('/') ? glbPath.slice(1) : glbPath
      if (!clean.toLowerCase().startsWith('models/')) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'glbPath muss mit /models/ beginnen' }))
        return
      }
      const glbAbs = resolve(ROOT, 'public', ...clean.split('/').filter(Boolean))
      if (!isSafePath(PUBLIC_MODELS, glbAbs)) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'GLB liegt nicht unter public/models/' }))
        return
      }
      if (!existsSync(glbAbs)) {
        res.statusCode = 404
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'GLB-Datei nicht gefunden' }))
        return
      }

      let hdriAbs = null
      const hdriRel = String(body?.hdriPath || '').trim()
      if (hdriRel) {
        const hc = hdriRel.startsWith('/') ? hdriRel.slice(1) : hdriRel
        if (/\.(hdr|exr)$/i.test(hc)) {
          const hAbs = resolve(ROOT, 'public', ...hc.split('/').filter(Boolean))
          if (isSafePath(PUBLIC_ROOT, hAbs) && existsSync(hAbs)) hdriAbs = hAbs
        }
      }

      const w = Math.min(MAX_DIM, Math.max(64, parseInt(body?.resolution?.width, 10) || 1920))
      const h = Math.min(MAX_DIM, Math.max(64, parseInt(body?.resolution?.height, 10) || 1080))
      const engine = String(body?.engine || 'eevee').toLowerCase() === 'cycles' ? 'cycles' : 'eevee'
      const format = String(body?.format || 'png').toLowerCase() === 'jpg' ? 'jpg' : 'png'

      const col16 = (arr) => {
        if (!Array.isArray(arr) || arr.length !== 16) return null
        const nums = arr.map((x) => Number(x))
        return nums.every((n) => Number.isFinite(n)) ? nums : null
      }
      const placementMatrixWorld = col16(body?.placementMatrixWorld)
      const cameraMatrixWorld = col16(body?.cameraMatrixWorld)
      const hasCamMat = !!cameraMatrixWorld
      const hasCamPT = body?.camera?.position && body?.camera?.target

      // Showroom Y-up → Blender Z-up: Kamera bevorzugt cameraMatrixWorld (C @ M @ C⁻¹), sonst Orbit pos/tgt.
      const job = {
        glbAbs,
        usesGlbOriginalColors: !!body?.usesGlbOriginalColors,
        hex: String(body?.hex || '#D7D7D7'),
        ralCode: String(body?.ralCode || ''),
        surfaceFinish: String(body?.surfaceFinish || ''),
        camera: body?.camera || {},
        placementMatrixWorld,
        cameraMatrixWorld,
        fovDeg: Number(body?.fovDeg),
        aspect: Number(body?.aspect),
        near: body?.near != null ? Number(body.near) : undefined,
        far: body?.far != null ? Number(body.far) : undefined,
        resolution: { width: w, height: h },
        engine,
        format,
        transparentBackground: body?.transparentBackground !== false,
        shadowCatcher: body?.shadowCatcher !== false,
        hdriAbs,
        cyclesDevice: String(body?.cyclesDevice || 'GPU').toUpperCase() === 'CPU' ? 'CPU' : 'GPU',
        cyclesSamples: Number(body?.cyclesSamples) || 128,
        eeveeSamples: Number(body?.eeveeSamples) || 64,
        // Color Management & Look (optional; sinnvolle Defaults setzt das Python-Skript).
        viewTransform: body?.viewTransform ? String(body.viewTransform) : undefined,
        look: body?.look ? String(body.look) : undefined,
        exposure: Number.isFinite(Number(body?.exposure)) ? Number(body.exposure) : undefined,
        gamma: Number.isFinite(Number(body?.gamma)) ? Number(body.gamma) : undefined,
        hdriStrength: Number.isFinite(Number(body?.hdriStrength)) ? Number(body.hdriStrength) : undefined,
        shadowStrength: Number.isFinite(Number(body?.shadowStrength)) ? Number(body.shadowStrength) : undefined,
        // Compositor-Verstärkung des Catcher-Alpha-Kanals (1.0=neutral, >1.0=Schatten sichtbarer).
        shadowBoost: Number.isFinite(Number(body?.shadowBoost)) ? Number(body.shadowBoost) : undefined,
        // Licht-Soft­ness-Overrides (alle optional). softness ist der High-Level-Hebel,
        // sunAngle/fillEnergy/areaEnergy/areaSize gezielte Direktüberschreibungen.
        softness: Number.isFinite(Number(body?.softness)) ? Number(body.softness) : undefined,
        sunAngle: Number.isFinite(Number(body?.sunAngle)) ? Number(body.sunAngle) : undefined,
        fillEnergy: Number.isFinite(Number(body?.fillEnergy)) ? Number(body.fillEnergy) : undefined,
        areaEnergy: Number.isFinite(Number(body?.areaEnergy)) ? Number(body.areaEnergy) : undefined,
        areaSize: Number.isFinite(Number(body?.areaSize)) ? Number(body.areaSize) : undefined,
      }

      if (!hasCamMat && !hasCamPT) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({
          error: 'cameraMatrixWorld (16 Zahlen) oder camera.position + camera.target erforderlich',
        }))
        return
      }

      tmpDir = await mkdtemp(join(tmpdir(), 'meta-blender-render-'))
      const jobPath = join(tmpDir, 'job.json')
      const outExt = format === 'jpg' ? 'jpg' : 'png'
      const outPng = join(tmpDir, `out.${outExt}`)
      await writeFile(jobPath, JSON.stringify(job), 'utf-8')

      const blenderExe = findBlenderExecutable()
      if (!blenderExe) {
        res.statusCode = 503
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: BLENDER_NOT_FOUND_HINT }))
        return
      }

      const args = ['--background', '--python', PY_SCRIPT, '--', jobPath, outPng]

      await new Promise((resolvePromise, rejectPromise) => {
        const ac = new AbortController()
        const t = setTimeout(() => {
          ac.abort()
        }, BLENDER_TIMEOUT_MS)
        let stderr = ''
        const child = spawn(blenderExe, args, {
          cwd: ROOT,
          signal: ac.signal,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env },
        })
        child.stderr?.on('data', (d) => { stderr += d.toString('utf-8') })
        child.stdout?.on('data', (d) => { stderr += d.toString('utf-8') })
        child.on('error', (err) => {
          clearTimeout(t)
          if (err.code === 'ENOENT') {
            rejectPromise(Object.assign(new Error('Blender nicht gefunden (BLENDER_PATH setzen)'), { code: 'ENOENT' }))
          } else {
            rejectPromise(err)
          }
        })
        child.on('close', (code, signal) => {
          clearTimeout(t)
          if (signal) {
            rejectPromise(new Error(
              signal === 'SIGKILL' || signal === 'SIGTERM'
                ? 'Render abgebrochen (Timeout)'
                : `Blender beendet (${signal})`,
            ))
            return
          }
          if (code === 0) {
            // Diagnose-Logs (z. B. Shadow-Catcher-Flag, Engine, film_transparent) auch im
            // Erfolgsfall sichtbar machen — sonst Blindflug bei visuellen Problemen.
            const diag = stderr
              .split(/\r?\n/)
              .filter((l) => l.includes('[blender_render]'))
              .slice(-30)
              .join('\n')
            if (diag) log.info('[blender_render] Diagnose', { lines: diag })
            resolvePromise()
          }
          else rejectPromise(new Error(`Blender Exit ${code}: ${stderr.slice(-4000)}`))
        })
      })

      const pngBuf = await readFile(outPng)
      res.statusCode = 200
      res.setHeader('Content-Type', format === 'jpg' ? 'image/jpeg' : 'image/png')
      res.setHeader('Content-Length', String(pngBuf.length))
      res.end(pngBuf)
    } catch (e) {
      const msg = e?.message || String(e)
      log.error('Blender-Render fehlgeschlagen', { message: msg, code: e?.code, name: e?.name })
      if (e?.code === 'ENOENT' || msg.includes('Blender nicht gefunden')) {
        res.statusCode = 503
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: BLENDER_NOT_FOUND_HINT }))
        return
      }
      if (e?.name === 'AbortError' || msg.includes('abort')) {
        res.statusCode = 504
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'Render-Timeout (10 min)' }))
        return
      }
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: msg.slice(0, 2000) }))
    } finally {
      if (tmpDir) {
        await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      }
    }
  }
}
