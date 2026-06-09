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
import { fileURLToPath } from 'url'
import path from 'path'
import { ensureDir, resolveBlenderOutputDir } from './lib/windowsPaths.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const MCP_DIR = path.join(ROOT, 'blender-exporter', 'blender-mcp-converter', 'mcp-server')
const IS_WIN = process.platform === 'win32'
const VENV_PY = path.join(MCP_DIR, IS_WIN ? 'venv/Scripts/python.exe' : 'venv/bin/python3')

const WATCH = process.env.WATCH_MODE === '1' || process.env.MCP_RELOAD === '1'

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
    // Immer absolut! MCP-cwd ist mcp-server (hinter einem Symlink) und eine
    // relative ENV würde dort fälschlich aufgelöst.
    BLENDER_OUTPUT_DIR: ensureDir(resolveBlenderOutputDir()),
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
