#!/usr/bin/env node
/**
 * Pre-flight checks and dependency setup for Blender Converter services.
 * Does NOT start long-running processes. Use with concurrently for dev:full.
 */
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs/promises'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const CONVERTER_ROOT = path.join(ROOT, 'blender-exporter', 'blender-mcp-converter')

function log(msg) { console.log(msg) }
function warn(msg) { console.warn('[WARN]', msg) }
function err(msg) { console.error('[ERROR]', msg) }

async function pathExists(p) {
  try { await fs.access(p); return true } catch { return false }
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts })
  return { ok: r.status === 0, stdout: r.stdout || '', stderr: r.stderr || '' }
}

async function checkRedis() {
  const { ok } = run('redis-cli', ['ping'])
  if (!ok) {
    err('Redis is not running. Start it with: brew services start redis')
    return false
  }
  log('Redis: OK')
  return true
}

function findPython310() {
  if (process.platform === 'win32') return 'python'
  const candidates = [
    'python3.12', 'python3.11', 'python3.10',
    '/opt/homebrew/bin/python3.12', '/opt/homebrew/bin/python3.11', '/opt/homebrew/bin/python3.10',
    '/usr/local/bin/python3.12', '/usr/local/bin/python3.11', '/usr/local/bin/python3.10',
    'python3', 'python',
  ]
  for (const py of candidates) {
    const r = run(py, ['--version'])
    if (!r.ok) continue
    const m = (r.stdout + r.stderr).match(/Python (\d+)\.(\d+)/)
    if (!m) continue
    const major = parseInt(m[1], 10)
    const minor = parseInt(m[2], 10)
    if (major > 3 || (major === 3 && minor >= 10)) return py
  }
  return null
}

async function checkPython() {
  const py = findPython310()
  if (!py) {
    err('Python 3.10+ nicht gefunden. Installiere mit: brew install python@3.10')
    return false
  }
  const { stdout, stderr } = run(py, ['--version'])
  log(`Python: OK  (${(stdout + stderr).trim()}, Befehl: ${py})`)
  process.env.PYTHON_BIN = py
  return true
}

async function ensureConverterExists() {
  const p = path.join(CONVERTER_ROOT, 'api-gateway', 'package.json')
  if (!(await pathExists(p))) {
    err(`Blender Converter not found at ${CONVERTER_ROOT}. Check blender-exporter symlink.`)
    return false
  }
  log('Blender Converter path: OK')
  return true
}

async function ensureApiDeps() {
  const apiDir = path.join(CONVERTER_ROOT, 'api-gateway')
  const nodeModules = path.join(apiDir, 'node_modules')
  if (!(await pathExists(nodeModules))) {
    log('Installing API Gateway dependencies...')
    const { ok } = run('npm', ['install'], { cwd: apiDir, stdio: 'inherit' })
    if (!ok) {
      err('API Gateway npm install failed.')
      return false
    }
  }
  log('API Gateway deps: OK')
  return true
}

async function ensureMcpVenv() {
  const mcpDir = path.join(CONVERTER_ROOT, 'mcp-server')
  const venvDir = path.join(mcpDir, 'venv')
  const isWin = process.platform === 'win32'
  const venvPython = isWin
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python3')

  // Prüfe ob das venv existiert und mindestens Python 3.10 hat
  let needsCreate = !(await pathExists(venvPython))
  if (!needsCreate) {
    const vr = run(venvPython, ['--version'])
    const vm = (vr.stdout + vr.stderr).match(/Python (\d+)\.(\d+)/)
    if (vm && (parseInt(vm[1]) < 3 || (parseInt(vm[1]) === 3 && parseInt(vm[2]) < 10))) {
      warn(`Vorhandenes venv nutzt Python ${vm[1]}.${vm[2]} – wird mit Python 3.10+ neu erstellt...`)
      const { spawnSync: sp } = await import('child_process')
      sp('rm', ['-rf', venvDir], { stdio: 'inherit' })
      needsCreate = true
    }
  }
  if (needsCreate) {
    log('Creating MCP virtual environment...')
    const py = process.env.PYTHON_BIN || (isWin ? 'python' : 'python3')
    const { ok } = run(py, ['-m', 'venv', 'venv'], { cwd: mcpDir, stdio: 'inherit' })
    if (!ok) {
      err(`Failed to create MCP venv with ${py}.`)
      return false
    }
  }

  log('Installing/verifying MCP dependencies...')
  const { ok } = run(venvPython, ['-m', 'pip', 'install', '-r', 'requirements.txt'], {
    cwd: mcpDir,
    stdio: 'inherit',
  })
  if (!ok) {
    err('MCP pip install failed.')
    return false
  }
  log('MCP deps: OK')
  return true
}

async function main() {
  log('Blender Converter – pre-flight checks...\n')

  if (!(await ensureConverterExists())) process.exit(1)
  if (!(await checkRedis())) process.exit(1)
  if (!(await checkPython())) process.exit(1)
  if (!(await ensureApiDeps())) process.exit(1)
  if (!(await ensureMcpVenv())) process.exit(1)

  log('\nAll checks passed. You can start services with: npm run dev:full')
}

main().catch((e) => {
  err(e.message)
  process.exit(1)
})
