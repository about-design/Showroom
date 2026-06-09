/**
 * pm2-Wrapper für den MCP-Uvicorn-Server.
 *
 * pm2 lädt Scripts im Fork-Mode über seinen eigenen CJS-Container, der kein
 * ESM (.mjs) unterstützt. Dieser Wrapper ist bewusst CJS und forkt
 * `scripts/run-mcp.mjs` via spawn – so bleiben Leerzeichen im Projektpfad
 * korrekt und der ESM-Code läuft unverändert weiter.
 */
const { spawn } = require('node:child_process')
const path = require('node:path')

// __dirname zeigt nach Symlink-Auflösung auf den echten Projektpfad – das
// ist gewollt, weil `scripts/run-mcp.mjs` dort liegt.
const runner = path.join(__dirname, '..', 'run-mcp.mjs')

const child = spawn(process.execPath, [runner], {
  cwd: path.resolve(__dirname, '..', '..'),
  stdio: 'inherit',
  env: { ...process.env, WATCH_MODE: process.env.WATCH_MODE || '1' },
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
child.on('error', (err) => {
  console.error('[pm2/mcp]', err)
  process.exit(1)
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { try { child.kill(sig) } catch {} })
}
