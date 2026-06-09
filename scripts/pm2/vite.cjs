/**
 * pm2-Wrapper für den Vite-Devserver.
 * Siehe scripts/pm2/mcp.cjs für Hintergrund.
 */
const { spawn } = require('node:child_process')
const path = require('node:path')

const runner = path.join(__dirname, '..', 'run-vite.mjs')

const child = spawn(process.execPath, [runner], {
  cwd: path.resolve(__dirname, '..', '..'),
  stdio: 'inherit',
  env: { ...process.env },
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
child.on('error', (err) => {
  console.error('[pm2/vite]', err)
  process.exit(1)
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { try { child.kill(sig) } catch {} })
}
