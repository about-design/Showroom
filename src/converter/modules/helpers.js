/** Antwort als Text lesen und als JSON parsen; bei Nicht-JSON Fehler mit dem Text werfen. */
export async function parseJsonResponse(res) {
  const raw = await res.text()
  try {
    return raw ? JSON.parse(raw) : {}
  } catch (_) {
    const msg = (raw || res.statusText || `HTTP ${res.status}`).trim()
    if (/too many requests|try again later/i.test(msg)) {
      throw new Error('Zu viele Anfragen von dieser Adresse. Bitte in einigen Minuten erneut versuchen.')
    }
    throw new Error(msg)
  }
}

/** Preflight/Convert: Response lesen, bei Fehler einheitlichen Fehlertext aus JSON oder Body werfen. */
export async function parseApiResponse(res) {
  const raw = await res.text()
  let data = {}
  try {
    data = raw ? JSON.parse(raw) : {}
  } catch (_) {
    if (!res.ok) throw new Error((raw && raw.trim()) || res.statusText || `HTTP ${res.status}`)
    return data
  }
  if (!res.ok) {
    const msg = data.error || data.message || (raw && raw.trim()) || res.statusText || `HTTP ${res.status}`
    throw new Error(msg)
  }
  return data
}

export function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
