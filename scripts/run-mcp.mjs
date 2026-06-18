#!/usr/bin/env node
import { createLogger } from './lib/logger.mjs'
const log = createLogger("run-mcp")

/**
 * Startet den Blender-MCP-Uvicorn-Server.
 *
 *   default:        uvicorn ohne --reload (stabil, für dev:full)
 *   WATCH_MODE=1:   uvicorn --reload mit sinnvollen reload-dirs/excludes
 *
 * Verwendung:
 *   node scripts/run-mcp.mjs                  # klassisch (dev:full)
 *   WATCH_MODE=1 node scripts/run-mcp.mjs     # pm2-Modus mit Hot-Reload
 */
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import { ensureDir, resolveBlenderOutputDir } from './lib/windowsPaths.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const MCP_DIR = path.join(ROOT, 'blender-exporter', 'blender-mcp-converter', 'mcp-server')
const IS_WIN = process.platform === 'win32'
const VENV_PY = path.join(MCP_DIR, IS_WIN ? 'venv/Scripts/python.exe' : 'venv/bin/python3')

const WATCH = process.env.WATCH_MODE === '1' || process.env.MCP_RELOAD === '1'

function firstExistingPath(candidates) {
  for (const p of candidates) {
    if (p && existsSync(p)) return p
  }
  return undefined
}

function defaultBlenderPath() {
  if (process.env.BLENDER_PATH) return process.env.BLENDER_PATH
  if (process.platform !== 'win32') return undefined
  const pf = process.env.ProgramFiles || 'C:\\Program Files'
  return firstExistingPath([
    path.join(pf, 'Blender Foundation', 'Blender 5.1', 'blender.exe'),
    path.join(pf, 'Blender Foundation', 'Blender 5.0', 'blender.exe'),
    path.join(pf, 'Blender Foundation', 'Blender 4.2', 'blender.exe'),
  ])
}

function defaultFreecadPath() {
  if (process.env.FREECAD_PATH) return process.env.FREECAD_PATH
  if (process.platform !== 'win32') return undefined
  const pf = process.env.ProgramFiles || 'C:\\Program Files'
  return firstExistingPath([
    path.join(pf, 'FreeCAD 1.1', 'bin', 'freecad.exe'),
    path.join(pf, 'FreeCAD 1.0', 'bin', 'freecad.exe'),
    path.join(pf, 'FreeCAD 0.21', 'bin', 'freecad.exe'),
  ])
}

const blenderPath = defaultBlenderPath()
const freecadPath = defaultFreecadPath()

const baseArgs = ['-m', 'uvicorn', 'main:app', '--host', '0.0.0.0', '--port', '8001']
const reloadArgs = WATCH
  ? [
      '--reload',
      '--reload-dir', MCP_DIR,
      '--reload-exclude', 'venv/*',
      '--reload-exclude', 'outputs/*',
      '--reload-exclude', '__pycache__/*',
      '--reload-exclude', '*.pyc',
    ]
  : []

const child = spawn(VENV_PY, [...baseArgs, ...reloadArgs], {
  cwd: MCP_DIR,
  stdio: 'inherit',
  env: {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    BLENDER_OUTPUT_DIR: ensureDir(resolveBlenderOutputDir()),
    ...(blenderPath ? { BLENDER_PATH: blenderPath } : {}),
    ...(freecadPath ? { FREECAD_PATH: freecadPath } : {}),
    // GLB = Wahrheit: USDZ ohne Blau-Kompensation, damit RAL 5010 in der
    // USDZ nicht abgedunkelt erscheint. Kann per ENV überschrieben werden.
    USDZ_BLUE_COMPENSATION: process.env.USDZ_BLUE_COMPENSATION ?? 'false',
    EXPORT_USDZ_OVERWRITE: process.env.EXPORT_USDZ_OVERWRITE ?? 'true',
  },
})

child.on('exit', (code) => process.exit(code ?? 0))
child.on('error', (err) => {
    log.error(err)
  process.exit(1)
})
