#!/usr/bin/env node
import { createLogger } from './lib/logger.mjs'
const log = createLogger("run-api")

/**
 * Startet das Blender-API-Gateway.
 *
 *   default:        `npm start`   (= node src/server.js, kein Hot-Reload)
 *   WATCH_MODE=1:   `nodemon src/server.js` (Hot-Reload bei Code-Änderungen)
 *
 * Verwendung:
 *   node scripts/run-api.mjs           # wie bisher (für dev:full)
 *   WATCH_MODE=1 node scripts/run-api.mjs   # pm2-Modus mit Hot-Reload
 */
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'
import { ensureDir, resolveBlenderOutputDir } from './lib/windowsPaths.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const API_DIR = path.join(ROOT, 'blender-exporter', 'blender-mcp-converter', 'api-gateway')

const WATCH = process.env.WATCH_MODE === '1' || process.env.API_WATCH === '1'
const IS_WIN = process.platform === 'win32'

function resolveBinary(name) {
  const bin = path.join(API_DIR, 'node_modules', '.bin', IS_WIN ? `${name}.cmd` : name)
  return fs.existsSync(bin) ? bin : null
}

let cmd
let args

if (WATCH) {
  const nodemon = resolveBinary('nodemon')
  if (!nodemon) {
        log.scoped("run-api").error("nodemon nicht gefunden – führe `npm install` im api-gateway aus.")
    process.exit(1)
  }
  cmd = nodemon
  args = [
    '--watch', 'src',
    '--ext', 'js,mjs,cjs,json',
    '--ignore', 'src/logs/*',
    '--delay', '500ms',
    'src/server.js',
  ]
} else {
  cmd = IS_WIN ? 'npm.cmd' : 'npm'
  args = ['start']
}

const child = spawn(cmd, args, {
  cwd: API_DIR,
  stdio: 'inherit',
  env: {
    ...process.env,
    BLENDER_OUTPUT_DIR: ensureDir(resolveBlenderOutputDir()),
  },
})

child.on('exit', (code) => process.exit(code ?? 0))
child.on('error', (err) => {
    log.error(err)
  process.exit(1)
})
