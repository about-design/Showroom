#!/usr/bin/env node
import { createLogger } from './lib/logger.mjs'
import { ensureDir, resolveBlenderOutputDir, resolveLogDir } from './lib/windowsPaths.mjs'
const log = createLogger('start-services')

/**
 * Pre-flight checks and dependency setup for Blender Converter services.
 * Does NOT start long-running processes. Use with concurrently for dev:full.
 */
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs/promises'
import { rmSync } from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const CONVERTER_ROOT = path.join(ROOT, 'blender-exporter', 'blender-mcp-converter')

async function pathExists(p) {
  try { await fs.access(p); return true } catch { return false }
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts })
  return { ok: r.status === 0, stdout: r.stdout || '', stderr: r.stderr || '' }
}

function checkMemuraiService() {
  if (process.platform !== 'win32') return false
  const { ok, stdout } = run('sc', ['query', 'Memurai'])
  if (!ok) return false
  if (!/STATE\s+:\s+\d+\s+RUNNING/i.test(stdout)) return false
  log.info('Redis (Memurai-Dienst): OK')
  return true
}

function checkRedisPort() {
  if (process.platform !== 'win32') return false
  const script =
    "try { $c = New-Object Net.Sockets.TcpClient('127.0.0.1',6379); $c.Close(); exit 0 } catch { exit 1 }"
  const { ok } = run('powershell', ['-NoProfile', '-Command', script])
  if (ok) {
    log.info('Redis (Port 6379): OK')
    return true
  }
  return false
}

async function checkRedis() {
  const { ok } = run('redis-cli', ['ping'])
  if (ok) {
    log.info('Redis: OK')
    return true
  }
  if (process.platform === 'win32') {
    if (checkMemuraiService()) return true
    if (checkRedisPort()) return true
    const { ok: dockerOk } = run('docker', ['exec', 'showroom-redis', 'redis-cli', 'ping'])
    if (dockerOk) {
      log.info('Redis (Docker): OK')
      return true
    }
    const { ok: dockerRedisOk } = run('docker', ['exec', 'redis', 'redis-cli', 'ping'])
    if (dockerRedisOk) {
      log.info('Redis (Docker): OK')
      return true
    }
    log.error(
      'Redis nicht erreichbar. Installiere Memurai (https://www.memurai.com/) oder starte den Dienst. Siehe docs/windows-it-rollout.md',
    )
  } else {
    log.error('Redis is not running. Start it with: brew services start redis')
  }
  return false
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
    if (process.platform === 'win32') {
      log.error('Python 3.10+ nicht gefunden. Lade es von https://www.python.org/downloads/ herunter.')
    } else {
      log.error('Python 3.10+ nicht gefunden. Installiere mit: brew install python@3.10')
    }
    return false
  }
  const { stdout, stderr } = run(py, ['--version'])
  log.info(`Python: OK  (${(stdout + stderr).trim()}, Befehl: ${py})`)
  process.env.PYTHON_BIN = py
  return true
}

async function ensureConverterExists() {
  const p = path.join(CONVERTER_ROOT, 'api-gateway', 'package.json')
  if (!(await pathExists(p))) {
    log.error(`Blender Converter not found at ${CONVERTER_ROOT}. Check blender-exporter symlink.`)
    return false
  }
  log.info('Blender Converter path: OK')
  return true
}

async function ensureApiDeps() {
  const apiDir = path.join(CONVERTER_ROOT, 'api-gateway')
  const nodeModules = path.join(apiDir, 'node_modules')
  if (!(await pathExists(nodeModules))) {
    log.info('Installing API Gateway dependencies...')
    // Windows: npm ist npm.cmd – spawnSync ohne shell wirft EINVAL (Node 20.12+).
    const { ok } = run('npm', ['install'], { cwd: apiDir, stdio: 'inherit', shell: process.platform === 'win32' })
    if (!ok) {
      log.error('API Gateway npm install failed.')
      return false
    }
  }
  log.info('API Gateway deps: OK')
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
      log.warn(`Vorhandenes venv nutzt Python ${vm[1]}.${vm[2]} – wird mit Python 3.10+ neu erstellt...`)
      rmSync(venvDir, { recursive: true, force: true })
      needsCreate = true
    }
  }
  if (needsCreate) {
    log.info('Creating MCP virtual environment...')
    const py = process.env.PYTHON_BIN || (isWin ? 'python' : 'python3')
    const { ok } = run(py, ['-m', 'venv', 'venv'], { cwd: mcpDir, stdio: 'inherit' })
    if (!ok) {
      log.error(`Failed to create MCP venv with ${py}.`)
      return false
    }
  }

  log.info('Installing/verifying MCP dependencies...')
  const { ok } = run(venvPython, ['-m', 'pip', 'install', '-r', 'requirements.txt'], {
    cwd: mcpDir,
    stdio: 'inherit',
  })
  if (!ok) {
    log.error('MCP pip install failed.')
    return false
  }
  log.info('MCP deps: OK')
  return true
}

async function main() {
  log.info('Blender Converter – pre-flight checks...\n')

  if (process.platform === 'win32') {
    const outDir = ensureDir(resolveBlenderOutputDir())
    const logDir = ensureDir(resolveLogDir())
    process.env.BLENDER_OUTPUT_DIR = outDir
    process.env.LOG_DIR = logDir
    log.info(`Windows User-Daten: outputs=${outDir}, logs=${logDir}`)
  }

  if (!(await ensureConverterExists())) process.exit(1)
  if (!(await checkRedis())) process.exit(1)
  if (!(await checkPython())) process.exit(1)
  if (!(await ensureApiDeps())) process.exit(1)
  if (!(await ensureMcpVenv())) process.exit(1)

  log.info('\nAll checks passed. Start: npm run dev:full  oder  start-showroom.cmd (Windows)')
}

main().catch((e) => {
  log.error(e.message)
  process.exit(1)
})
