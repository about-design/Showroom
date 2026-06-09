/**
 * Node-Logger: Console + optional JSONL unter logs/ (oder LOG_DIR).
 * ENV: LOG_LEVEL, LOG_LEVEL_<SCOPE> (Scope mit _ statt :), LOG_FORMAT=jsonl|pretty, NO_COLOR=1
 */

import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const LEVEL_NUM = { error: 0, warn: 1, info: 2, debug: 3, trace: 4 }

const SENSITIVE_KEYS = new Set([
  'authorization',
  'cookie',
  'password',
  'token',
  'access_token',
  'refresh_token',
  'secret',
  'apikey',
  'api_key',
  'x-showroom-token',
])

const __dirname = typeof import.meta.dirname !== 'undefined'
  ? import.meta.dirname
  : dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..', '..')
const DEFAULT_LOG_DIR = join(PROJECT_ROOT, 'logs')

function resolveLogDir() {
  if (process.env.LOG_DIR) return resolve(process.env.LOG_DIR)
  return DEFAULT_LOG_DIR
}

let _dirEnsured = false
async function ensureLogDir() {
  if (_dirEnsured) return
  const dir = resolveLogDir()
  await mkdir(dir, { recursive: true })
  _dirEnsured = true
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10)
}

function safeScopeFilePart(scope) {
  return String(scope || 'app').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'app'
}

/**
 * @param {unknown} v
 * @param {number} depth
 * @returns {unknown}
 */
export function redactSensitive(v, depth = 0) {
  if (depth > 8) return '[max-depth]'
  if (v == null) return v
  if (typeof v === 'string') {
    if (v.length > 8000) return `${v.slice(0, 8000)}…[truncated]`
    return v
  }
  if (typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map((x) => redactSensitive(x, depth + 1))
  /** @type {Record<string, unknown>} */
  const o = {}
  for (const [k, val] of Object.entries(v)) {
    const lk = k.toLowerCase()
    if (SENSITIVE_KEYS.has(lk)) {
      o[k] = '[redacted]'
      continue
    }
    o[k] = redactSensitive(val, depth + 1)
  }
  return o
}

function envLevelForScope(scope) {
  const key = `LOG_LEVEL_${String(scope).replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase()}`
  const v = process.env[key]
  if (v && LEVEL_NUM[v.toLowerCase()] != null) return v.toLowerCase()
  const g = process.env.LOG_LEVEL
  if (g && LEVEL_NUM[g.toLowerCase()] != null) return g.toLowerCase()
  return process.env.NODE_ENV === 'production' ? 'warn' : 'info'
}

function shouldLog(scope, level) {
  return LEVEL_NUM[level] <= LEVEL_NUM[envLevelForScope(scope)]
}

const useColor = !process.env.NO_COLOR && process.stdout.isTTY

function color(level) {
  if (!useColor) return (s) => s
  const codes = {
    error: '\x1b[31m',
    warn: '\x1b[33m',
    info: '\x1b[36m',
    debug: '\x1b[90m',
    trace: '\x1b[90m',
  }
  const c = codes[level] || ''
  return (s) => `${c}${s}\x1b[0m`
}

function prettyLine(ts, level, scope, msg, data) {
  const lvl = color(level)(`[${level.toUpperCase()}]`)
  const sc = `[${scope}]`
  let line = `${ts} ${lvl} ${sc} ${msg}`
  if (data !== undefined) line += ` ${JSON.stringify(data)}`
  return line
}

async function appendJsonl(scope, record) {
  try {
    await ensureLogDir()
    const dir = resolveLogDir()
    const file = join(dir, `${safeScopeFilePart(scope)}-${todayStamp()}.log`)
    const line = JSON.stringify(record) + '\n'
    await appendFile(file, line, 'utf-8')
  } catch {
    /* ignore disk errors */
  }
}

/**
 * @param {string} scope
 * @param {Record<string, unknown>} [childFields]
 */
function createLoggerImpl(scope, childFields = {}) {
  /**
   * @param {string} level
   * @param {unknown[]} args
   */
  function logLine(level, args) {
    if (!shouldLog(scope, level)) return
    const ts = new Date().toISOString()
    const msgParts = []
    /** @type {unknown[]} */
    const dataParts = []
    for (const a of args) {
      if (typeof a === 'string') msgParts.push(a)
      else dataParts.push(a)
    }
    const msg = msgParts.join(' ') || level
    const data =
      dataParts.length === 0
        ? undefined
        : dataParts.length === 1
          ? redactSensitive(dataParts[0])
          : redactSensitive(dataParts)
    const record = {
      ts,
      level,
      scope,
      msg,
      ...(Object.keys(childFields).length ? { fields: { ...childFields } } : {}),
      ...(data !== undefined ? { data } : {}),
    }
    const fmt = (process.env.LOG_FORMAT || 'pretty').toLowerCase()
    if (fmt === 'jsonl') {
      const line = JSON.stringify(record)
      if (level === 'error') console.error(line)
      else if (level === 'warn') console.warn(line)
      else console.log(line)
    } else {
      const pretty = prettyLine(ts, level, scope, msg, data)
      if (level === 'error') console.error(pretty)
      else if (level === 'warn') console.warn(pretty)
      else console.log(pretty)
    }
    void appendJsonl(scope, record)
  }

  return {
    scope,
    error(...args) {
      logLine('error', args)
    },
    warn(...args) {
      logLine('warn', args)
    },
    info(...args) {
      logLine('info', args)
    },
    debug(...args) {
      logLine('debug', args)
    },
    trace(...args) {
      logLine('trace', args)
    },
    scoped(sub) {
      return createLoggerImpl(`${scope}:${sub}`, childFields)
    },
    child(fields) {
      return createLoggerImpl(scope, { ...childFields, ...fields })
    },
  }
}

const loggerCache = new Map()

/**
 * @param {string} scope
 */
export function createLogger(scope) {
  const s = String(scope || 'app')
  if (!loggerCache.has(s)) loggerCache.set(s, createLoggerImpl(s))
  return loggerCache.get(s)
}

/**
 * @param {string} scope
 */
export function getLogger(scope) {
  return createLogger(scope)
}

/**
 * Misst Request-Dauer und loggt Abschluss (Express-style req/res).
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {ReturnType<typeof createLogger>} baseLog
 * @param {string} [pathOverride]
 */
export function withRequestLogger(req, res, baseLog, pathOverride) {
  const id = randomUUID().slice(0, 8)
  const t0 = process.hrtime.bigint()
  res.setHeader('X-Request-Id', id)
  const url = pathOverride ?? req.url ?? ''
  res.on('finish', () => {
    const ms = Number((process.hrtime.bigint() - t0) / 1_000_000n)
    baseLog.info(`${req.method} ${url} -> ${res.statusCode} (${ms}ms)`, { id })
  })
  return id
}
