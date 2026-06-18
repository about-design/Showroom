/** Antwort als Text lesen und als JSON parsen; bei Nicht-JSON (z. B. "Too many requests") Fehler mit dem Text werfen. */
export async function parseJsonResponse(res) {
  const raw = await res.text()
  try {
    return raw ? JSON.parse(raw) : {}
  } catch (_) {
    const msg = (raw || res.statusText || `HTTP ${res.status}`).trim()
    if (/^\s*<!DOCTYPE/i.test(msg) || /^\s*<html/i.test(msg)) {
      throw new Error('Server lieferte HTML statt JSON — bitte Showroom neu starten (stop-showroom.cmd, dann start-showroom.cmd) und Seite mit Strg+F5 laden.')
    }
    if (/too many requests|try again later/i.test(msg)) {
      throw new Error('Zu viele Anfragen von dieser Adresse. Bitte in einigen Minuten erneut versuchen.')
    }
    throw new Error(msg)
  }
}

// Escaped HTML-kritische Zeichen inkl. Quotes – sicher für Attribut-Kontexte (title="…", value="…")
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now - d
  const diffH = diffMs / 3600000
  if (diffH < 1) return 'gerade eben'
  if (diffH < 24) return `vor ${Math.floor(diffH)} Std.`
  const diffD = Math.floor(diffH / 24)
  if (diffD === 1) return 'gestern'
  if (diffD < 7) return `vor ${diffD} Tagen`
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function fmtNumOrDash(v, digits = 3) {
  if (v == null || !Number.isFinite(v)) return '–'
  return v.toFixed(digits)
}

export function cssEscapeId(id) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(String(id))
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '\\$&')
}
