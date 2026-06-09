#!/usr/bin/env node
import { createLogger } from './lib/logger.mjs'
const log = createLogger("run-vite")

/**
 * Startet den Vite-Devserver – robust gegen Leerzeichen im Projektpfad
 * (pm2 würde den Pfad sonst per `bash -c` zerreißen).
 *
 * Verwendung:
 *   node scripts/run-vite.mjs         # wie `npx vite`
 */
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const IS_WIN = process.platform === 'win32'

const viteBin = path.join(ROOT, 'node_modules', '.bin', IS_WIN ? 'vite.cmd' : 'vite')
if (!fs.existsSync(viteBin)) {
    log.error(`[run-vite] vite-Binary nicht gefunden unter ${viteBin}. Führe \`npm install\` aus.`)
  process.exit(1)
}

// Weitere CLI-Argumente an vite durchreichen (z. B. --host, --port, --mode).
const extraArgs = process.argv.slice(2)

const child = spawn(viteBin, extraArgs, {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env },
})

child.on('exit', (code) => process.exit(code ?? 0))
child.on('error', (err) => {
    log.error(err)
  process.exit(1)
})
