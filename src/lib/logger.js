/**
 * Browser-Logger: Levels, Scopes, Sinks, Secret-Redaction.
 * Konfig: localStorage `metaLog` (JSON), URL `?log=debug` oder `?log=Scope:debug,Other:warn`.
 */

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

/** @type {Set<(e: LogEvent) => void>} */
const sinks = new Set()

/** @typedef {{ ts: string, level: string, scope: string, msg: string, data?: unknown, fields?: Record<string, unknown> }} LogEvent */

function nowIso() {
  return new Date().toISOString()
}

function parseUrlLogOverrides() {
  /** @type {Record<string, string>} */
  const out = {}
  try {
    const q = new URLSearchParams(window.location.search).get('log')
    if (!q) return out
    for (const part of q.split(',')) {
      const s = part.trim()
      if (!s) continue
      if (s.includes(':')) {
        const [scope, lev] = s.split(':').map((x) => x.trim())
        if (scope && lev && LEVEL_NUM[lev] != null) out[scope] = lev
      } else if (LEVEL_NUM[s] != null) {
        out['*'] = s
      }
    }
  } catch {
    /* ignore */
  }
  return out
}

function readLocalStorageConfig() {
  try {
    const raw = localStorage.getItem('metaLog')
    if (!raw) return {}
    const o = JSON.parse(raw)
    return o && typeof o === 'object' ? o : {}
  } catch {
    return {}
  }
}

function defaultGlobalLevel() {
  try {
    // @ts-ignore Vite
    if (import.meta.env?.DEV) return 'info'
  } catch {
    /* ignore */
  }
  return 'warn'
}

function effectiveLevelForScope(scope) {
  const url = parseUrlLogOverrides()
  if (url[scope] && LEVEL_NUM[url[scope]] != null) return url[scope]
  if (url['*'] && LEVEL_NUM[url['*']] != null) return url['*']
  const cfg = readLocalStorageConfig()
  if (cfg.levels && typeof cfg.levels === 'object' && cfg.levels[scope]) {
    const l = String(cfg.levels[scope])
    if (LEVEL_NUM[l] != null) return l
  }
  if (cfg.level && LEVEL_NUM[String(cfg.level)]) return String(cfg.level)
  return defaultGlobalLevel()
}

/**
 * Entfernt sensitive Keys rekursiv (flach genug für Log-Payloads).
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

/**
 * @param {(e: LogEvent) => void} fn
 * @returns {() => void}
 */
export function addSink(fn) {
  sinks.add(fn)
  return () => sinks.delete(fn)
}

function emitSinks(ev) {
  for (const fn of sinks) {
    try {
      fn(ev)
    } catch {
      /* ignore */
    }
  }
}

function consoleMethod(level) {
  if (level === 'error') return 'error'
  if (level === 'warn') return 'warn'
  if (level === 'trace' || level === 'debug') return 'debug'
  return 'log'
}

function styleFor(level) {
  const base = 'font-weight:600;padding:2px 6px;border-radius:3px;'
  switch (level) {
    case 'error':
      return base + 'background:#b91c1c;color:#fff;'
    case 'warn':
      return base + 'background:#ca8a04;color:#111;'
    case 'info':
      return base + 'background:#2563eb;color:#fff;'
    case 'debug':
    case 'trace':
      return base + 'background:#475569;color:#fff;'
    default:
      return base
  }
}

/**
 * @param {string} scope
 * @param {Record<string, unknown>} [childFields]
 */
function createLoggerImpl(scope, childFields = {}) {
  const shouldLog = (level) => {
    const th = LEVEL_NUM[effectiveLevelForScope(scope)]
    return LEVEL_NUM[level] <= th
  }

  /**
   * @param {string} level
   * @param {unknown[]} args
   */
  function logLine(level, args) {
    if (!shouldLog(level)) return
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
    /** @type {LogEvent} */
    const ev = {
      ts: nowIso(),
      level,
      scope,
      msg,
      ...(Object.keys(childFields).length ? { fields: { ...childFields } } : {}),
      ...(data !== undefined ? { data } : {}),
    }
    const method = consoleMethod(level)
    const label = `%c${scope}%c ${msg}`
    const styles = [styleFor(level), 'color:inherit;font-weight:normal;']
    if (data !== undefined) {
      // eslint-disable-next-line no-console
      console[method](label, ...styles, data)
    } else {
      // eslint-disable-next-line no-console
      console[method](label, ...styles)
    }
    emitSinks(ev)
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
    /**
     * @param {string} sub
     */
    scoped(sub) {
      const subScope = `${scope}:${sub}`
      return createLoggerImpl(subScope, childFields)
    },
    /**
     * @param {Record<string, unknown>} fields
     */
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
