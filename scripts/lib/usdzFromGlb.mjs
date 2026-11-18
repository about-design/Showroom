import { spawnSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { createLogger } from './logger.mjs'

const log = createLogger('usdz')
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const BLENDER_SCRIPT = path.resolve(ROOT, 'scripts/blender/glb-to-usd.py')

/** Erste existierende Datei aus der Liste. */
function firstExisting(candidates) {
  for (const c of candidates) {
    if (c && existsSync(c)) return c
  }
  return null
}

/**
 * Blender-Pfad aus der .env des Konverters lesen. Dort steht er bereits — der
 * MCP-Server startet Blender damit. Eine zweite Konfigurationsstelle im Showroom
 * würde nur auseinanderlaufen.
 * @returns {string|null}
 */
function blenderFromConverterEnv() {
  const envFile = path.resolve(ROOT, 'blender-exporter/blender-mcp-converter/mcp-server/.env')
  if (!existsSync(envFile)) return null
  try {
    for (const line of readFileSync(envFile, 'utf-8').split(/\r?\n/)) {
      const m = /^\s*(BLENDER_EXECUTABLE|BLENDER_PATH)\s*=\s*(.+?)\s*$/.exec(line)
      if (!m) continue
      const val = m[2].replace(/^["']|["']$/g, '').trim()
      if (val && val.toLowerCase() !== 'auto' && existsSync(val)) return val
    }
  } catch { /* ignore */ }
  return null
}

/**
 * Blender-Binary auflösen: BLENDER_PATH/BLENDER_EXECUTABLE, dann die Konverter-.env,
 * dann Standardorte, sonst `blender` aus dem PATH.
 * @returns {string|null}
 */
export function resolveBlenderBinary() {
  const env = (process.env.BLENDER_PATH || process.env.BLENDER_EXECUTABLE || '').trim()
  if (env && env.toLowerCase() !== 'auto' && existsSync(env)) return env

  const fromConverter = blenderFromConverterEnv()
  if (fromConverter) return fromConverter

  if (process.platform === 'darwin') {
    const found = firstExisting([
      '/Applications/Blender.app/Contents/MacOS/Blender',
      '/usr/local/bin/blender',
      '/opt/homebrew/bin/blender',
    ])
    if (found) return found
  } else if (process.platform === 'win32') {
    const pf = process.env.ProgramFiles || 'C:\\Program Files'
    const found = firstExisting(
      ['5.2', '5.1', '5.0', '4.2'].map((v) =>
        path.join(pf, 'Blender Foundation', `Blender ${v}`, 'blender.exe'),
      ),
    )
    if (found) return found
  }

  // Letzter Versuch: im PATH.
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['blender'], {
    stdio: 'pipe',
    encoding: 'utf-8',
  })
  const hit = (which.stdout || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean)
  return hit && existsSync(hit) ? hit : null
}

/** usdzip aus USD-Tools; ohne das Werkzeug kann keine USDZ gepackt werden. */
export function resolveUsdzip() {
  const env = (process.env.USDZIP_PATH || '').trim()
  if (env && existsSync(env)) return env
  const found = firstExisting(['/usr/bin/usdzip', '/usr/local/bin/usdzip', '/opt/homebrew/bin/usdzip'])
  if (found) return found
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['usdzip'], {
    stdio: 'pipe',
    encoding: 'utf-8',
  })
  const hit = (which.stdout || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean)
  return hit && existsSync(hit) ? hit : null
}

/**
 * USDZ aus einer FERTIG gebackenen GLB erzeugen.
 *
 * Hintergrund: Der Konverter erzeugt die USDZ aus der Blender-Rohszene, also VOR
 * dem Bake. Sichtbarkeits-Regeln, Farb-/Finish-Bake und das Aufräumen verwaister
 * Ressourcen wirken damit nicht auf die USDZ — die AR-Ansicht zeigt dann Teile,
 * die in der GLB längst entfernt sind, bei entsprechend vielfacher Dateigröße.
 * Diese Funktion baut sie deshalb aus der ausgelieferten GLB neu auf:
 * Blender-Import → USD-Export → `usdzip --arkitAsset`.
 *
 * Schreibt das Ergebnis erst nach `usdzPath`, wenn die komplette Kette erfolgreich
 * war — eine vorhandene USDZ bleibt bei Fehlern unangetastet.
 *
 * @param {string} glbPath  absoluter Pfad zur gebackenen GLB
 * @param {string} usdzPath absoluter Zielpfad der USDZ
 * @param {{timeoutMs?: number}} [opts]
 * @returns {{ ok: boolean, reason?: string, detail?: string }}
 */
export function buildUsdzFromGlb(glbPath, usdzPath, opts = {}) {
  const timeout = opts.timeoutMs ?? 10 * 60 * 1000

  if (!existsSync(glbPath)) return { ok: false, reason: 'glb-missing', detail: glbPath }
  if (!existsSync(BLENDER_SCRIPT)) return { ok: false, reason: 'script-missing', detail: BLENDER_SCRIPT }

  const blender = resolveBlenderBinary()
  if (!blender) return { ok: false, reason: 'blender-not-found' }
  const usdzip = resolveUsdzip()
  if (!usdzip) return { ok: false, reason: 'usdzip-not-found' }

  const tmp = mkdtempSync(path.join(tmpdir(), 'showroom-usdz-'))
  const usdPath = path.join(tmp, 'scene.usdc')
  // In den Temp-Ordner packen und erst am Ende verschieben, damit ein Abbruch
  // mittendrin keine halbe Datei am Zielpfad hinterlässt.
  const usdzTmp = path.join(tmp, 'scene.usdz')

  try {
    const blenderRun = spawnSync(
      blender,
      ['--background', '--factory-startup', '--python', BLENDER_SCRIPT, '--', glbPath, usdPath],
      { stdio: 'pipe', encoding: 'utf-8', timeout },
    )
    if (blenderRun.error) {
      return { ok: false, reason: 'blender-failed', detail: blenderRun.error.message }
    }
    if (blenderRun.status !== 0 || !existsSync(usdPath)) {
      const stderr = (blenderRun.stderr || '').trim().split('\n').slice(-3).join(' | ')
      return { ok: false, reason: 'blender-failed', detail: stderr || `Exit ${blenderRun.status}` }
    }

    const zipRun = spawnSync(usdzip, ['--arkitAsset', usdPath, usdzTmp], {
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout,
    })
    if (zipRun.error) return { ok: false, reason: 'usdzip-failed', detail: zipRun.error.message }
    if (zipRun.status !== 0 || !existsSync(usdzTmp)) {
      const stderr = (zipRun.stderr || '').trim().split('\n').slice(-3).join(' | ')
      return { ok: false, reason: 'usdzip-failed', detail: stderr || `Exit ${zipRun.status}` }
    }

    // renameSync scheitert über Volume-Grenzen (EXDEV) — Kopieren ist hier robuster.
    const cp = spawnSync(process.platform === 'win32' ? 'cmd' : 'cp',
      process.platform === 'win32' ? ['/c', 'copy', '/Y', usdzTmp, usdzPath] : [usdzTmp, usdzPath],
      { stdio: 'pipe', encoding: 'utf-8' })
    if (cp.status !== 0 || !existsSync(usdzPath)) {
      return { ok: false, reason: 'copy-failed', detail: (cp.stderr || '').trim() }
    }
    return { ok: true }
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}

/** Kurztext für Logs/Warnungen zu einem Fehlschlag. */
export function usdzFailureHint(reason) {
  switch (reason) {
    case 'blender-not-found':
      return 'Blender nicht gefunden (BLENDER_PATH setzen)'
    case 'usdzip-not-found':
      return 'usdzip nicht gefunden (USD-Tools installieren oder USDZIP_PATH setzen)'
    case 'glb-missing':
      return 'gebackene GLB fehlt'
    case 'script-missing':
      return 'scripts/blender/glb-to-usd.py fehlt'
    default:
      return reason || 'unbekannter Fehler'
  }
}

export { log as usdzLog }
