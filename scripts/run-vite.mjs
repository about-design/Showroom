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

// JS-Entry direkt mit node starten statt vite.cmd: Windows kann .cmd nicht ohne
// shell:true spawnen (EINVAL), und der node-Aufruf ist robust gegen Leerzeichen im Pfad.
const viteEntry = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
if (!fs.existsSync(viteEntry)) {
    log.error(`[run-vite] vite nicht gefunden unter ${viteEntry}. Führe \`npm install\` aus.`)
  process.exit(1)
}

// Weitere CLI-Argumente an vite durchreichen (z. B. --host, --port, --mode).
const extraArgs = process.argv.slice(2)

const child = spawn(process.execPath, [viteEntry, ...extraArgs], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env },
})

child.on('exit', (code) => process.exit(code ?? 0))
child.on('error', (err) => {
    log.error(err)
  process.exit(1)
})
