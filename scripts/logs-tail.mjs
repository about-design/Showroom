#!/usr/bin/env node
/**
 * Zeigt neue Zeilen in logs/*.log (fs.watch).
 *   node scripts/logs-tail.mjs [--scope=frontend] [--level=error]
 */
import { watch, readdir, readFile, stat } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const logDir = join(root, 'logs')

let scopeFilter = ''
let levelFilter = ''
for (const a of process.argv.slice(2)) {
  if (a.startsWith('--scope=')) scopeFilter = a.slice('--scope='.length).toLowerCase()
  if (a.startsWith('--level=')) levelFilter = a.slice('--level='.length).toLowerCase()
}

/** @type {Map<string, number>} */
const positions = new Map()

function tailFile(abs, rel) {
  stat(abs, (err, st) => {
    if (err) return
    const prev = positions.get(abs) ?? 0
    const size = st.size
    if (size < prev) positions.set(abs, 0)
    const start = Math.min(prev, size)
    if (start === size) {
      positions.set(abs, size)
      return
    }
    readFile(abs, { encoding: 'utf-8', start, end: size - 1 }, (e, chunk) => {
      if (e) return
      positions.set(abs, size)
      for (const line of chunk.split(/\r?\n/)) {
        if (!line.trim()) continue
        if (scopeFilter && !line.toLowerCase().includes(scopeFilter)) continue
        if (levelFilter && !line.toLowerCase().includes(`"${levelFilter}"`)) continue
        process.stdout.write(`[${rel}] ${line}\n`)
      }
    })
  })
}

function scanAll() {
  readdir(logDir, { withFileTypes: true }, (err, entries) => {
    if (err) {
      console.error('logs/:', err.message, '(Verzeichnis fehlt – einmal Dev-Server starten oder mkdir logs)')
      return
    }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.log')) continue
      const abs = join(logDir, e.name)
      tailFile(abs, e.name)
    }
  })
}

try {
  watch(logDir, { persistent: true }, () => scanAll())
} catch (e) {
  console.error(e.message)
  process.exit(1)
}
console.log(`Tail ${logDir} (Ctrl+C beenden)`)
scanAll()
setInterval(scanAll, 1500).unref?.()
