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

/**
 * Eigenständiges, optionales Produktdatenfeld `shortText` (SAP-Kurztext).
 * Wird unverändert im Produktdatensatz gespeichert; die Anzeige kennt keine Datenquelle.
 * @param {{shortText?: string | null}} product
 */
export function formatProductShortText(product) {
  return typeof product.shortText === 'string' && product.shortText.trim()
    ? product.shortText
    : '–'
}

export function formatProductSapIdentifiers(product) {
  const ean = String(product.sapEan ?? '').trim()
  const article = String(product.sapArticleNumber ?? '').trim()
  return [ean && `EAN: ${ean}`, article && `Artikel: ${article}`].filter(Boolean).join(' · ') || String(product.id ?? '')
}

export function getProductNameIdentifierMismatch(product) {
  const name = String(product?.name ?? '')
  const match = name.match(/^(Produkt\s+)(\d+)(_)(\d+)(.*)$/)
  if (!match) return null

  const sapEan = String(product?.sapEan ?? '').trim()
  const sapArticle = String(product?.sapArticleNumber ?? '').trim()
  const eanMismatch = sapEan !== '' && match[2] !== sapEan
  const articleMismatch = sapArticle !== '' && match[4] !== sapArticle
  if (!eanMismatch && !articleMismatch) return null
  return { eanMismatch, articleMismatch, nameEan: match[2], nameArticle: match[4] }
}

/**
 * Markiert ausschließlich abweichende EAN-/Artikel-Segmente eines automatisch
 * aufgebauten Produktnamens. Der Produktdatensatz selbst bleibt unverändert.
 */
export function formatValidatedProductName(product) {
  const name = String(product?.name ?? '')
  const match = name.match(/^(Produkt\s+)(\d+)(_)(\d+)(.*)$/)
  if (!match) return esc(name)

  const [, prefix, nameEan, separator, nameArticle, suffix] = match
  const mismatch = getProductNameIdentifierMismatch(product)
  const eanMismatch = mismatch?.eanMismatch === true
  const articleMismatch = mismatch?.articleMismatch === true
  const segment = (value, mismatch) => mismatch
    ? `<span class="card-name-identifier-mismatch">${esc(value)}</span>`
    : esc(value)

  return `${esc(prefix)}${segment(nameEan, eanMismatch)}${esc(separator)}${segment(nameArticle, articleMismatch)}${esc(suffix)}`
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
