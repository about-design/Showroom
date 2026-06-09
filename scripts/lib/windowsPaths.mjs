/**
 * Windows IT-Rollout: beschreibbare Pfade ausserhalb des Programmverzeichnisses.
 * Unter Windows default: %LOCALAPPDATA%\meta-showroom\{logs,outputs}
 * Unter macOS/Linux: weiterhin Projektordner (logs/, blender-exporter/.../outputs).
 */
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..')

/** @returns {string} Absoluter Pfad fuer Konvertierungs-Outputs */
export function resolveBlenderOutputDir() {
  if (process.env.BLENDER_OUTPUT_DIR) {
    const raw = process.env.BLENDER_OUTPUT_DIR
    return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(PROJECT_ROOT, raw)
  }
  if (process.platform === 'win32') {
    return path.join(homedir(), 'AppData', 'Local', 'meta-showroom', 'outputs')
  }
  return path.join(PROJECT_ROOT, 'blender-exporter', 'blender-mcp-converter', 'outputs')
}

/** @returns {string} Absoluter Pfad fuer Anwendungs-Logs */
export function resolveLogDir() {
  if (process.env.LOG_DIR) {
    return path.resolve(process.env.LOG_DIR)
  }
  if (process.platform === 'win32') {
    return path.join(homedir(), 'AppData', 'Local', 'meta-showroom', 'logs')
  }
  return path.join(PROJECT_ROOT, 'logs')
}

/** @param {string} dir */
export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Env-Block fuer Kindprozesse (API, MCP, concurrently) */
export function windowsRuntimeEnv() {
  const outputDir = ensureDir(resolveBlenderOutputDir())
  const logDir = ensureDir(resolveLogDir())
  return {
    BLENDER_OUTPUT_DIR: outputDir,
    LOG_DIR: logDir,
  }
}
