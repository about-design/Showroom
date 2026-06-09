/**
 * Einmalig laden: globale Fehlerhandler + Dev-Sink (POST /__api/log).
 * Import ganz oben in main.js, dashboard/main.js, converter/main.js, thumbnail.
 */

import { addSink, createLogger, redactSensitive } from './logger.js'

const LEVEL_NUM = { error: 0, warn: 1, info: 2, debug: 3, trace: 4 }
const LOG_ENDPOINT = '/__api/log'
const MAX_BODY = 16 * 1024
const THROTTLE_PER_SEC = 20

let _inited = false
let _tokens = THROTTLE_PER_SEC
let _lastRefill = Date.now()

function refill() {
  const now = Date.now()
  const elapsed = (now - _lastRefill) / 1000
  if (elapsed > 0) {
    _tokens = Math.min(THROTTLE_PER_SEC, _tokens + elapsed * THROTTLE_PER_SEC)
    _lastRefill = now
  }
}

function postPayload(bodyObj) {
  const body = JSON.stringify(redactSensitive(bodyObj))
  if (body.length > MAX_BODY) return false
  try {
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' })
      return navigator.sendBeacon(LOG_ENDPOINT, blob)
    }
  } catch {
    /* fall through */
  }
  try {
    void fetch(LOG_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {})
    return true
  } catch {
    return false
  }
}

function installGlobalHandlers() {
  const glog = createLogger('global')
  window.onerror = (message, source, lineno, colno, error) => {
    const msg = typeof message === 'string' ? message : 'window.onerror'
    glog.error(msg, {
      source: source ?? '',
      lineno: lineno ?? 0,
      colno: colno ?? 0,
      stack: error instanceof Error ? error.stack : undefined,
    })
    return false
  }
  window.addEventListener('unhandledrejection', (ev) => {
    const r = ev.reason
    const msg = r instanceof Error ? r.message : String(r)
    const stack = r instanceof Error ? r.stack : undefined
    glog.error(`unhandledrejection: ${msg}`, { stack })
  })
}

function installDevSink() {
  try {
    // @ts-ignore Vite
    if (!import.meta.env?.DEV) return
  } catch {
    return
  }
  addSink((ev) => {
    // Nur warn + error an den Server (nicht info/debug)
    if (LEVEL_NUM[ev.level] == null || LEVEL_NUM[ev.level] > LEVEL_NUM.warn) return
    refill()
    if (_tokens < 1) return
    _tokens -= 1
    postPayload({
      level: ev.level,
      scope: ev.scope,
      msg: ev.msg,
      data: ev.data,
      fields: ev.fields,
      ts: ev.ts,
      ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      url: typeof location !== 'undefined' ? location.href : '',
    })
  })
}

export function initLoggerRuntime() {
  if (_inited) return
  _inited = true
  if (typeof window === 'undefined') return
  installGlobalHandlers()
  installDevSink()
}

initLoggerRuntime()
