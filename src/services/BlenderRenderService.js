/**
 * Ruft den lokalen Vite-/Dashboard-Endpoint auf, der Blender headless rendert.
 * Nur in Dev mit `npm run dev` (Plugin aktiv) bzw. gleicher Origin wie die App.
 */

const DEFAULT_API = '/__api/blender-render'

/**
 * @param {object} payload - siehe README (glbPath, camera, resolution, engine, …)
 * @returns {Promise<Blob>}
 */
export async function requestBlenderRender(payload, apiPath = DEFAULT_API) {
  const r = await fetch(apiPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const ct = r.headers.get('content-type') || ''
  if (!r.ok) {
    let msg = r.statusText || `HTTP ${r.status}`
    try {
      if (ct.includes('application/json')) {
        const j = await r.json()
        if (j?.error) msg = j.error
      } else {
        const t = await r.text()
        if (t) msg = t.slice(0, 500)
      }
    } catch {
      /* ignore */
    }
    const err = new Error(msg)
    err.status = r.status
    throw err
  }
  if (
    !ct.includes('image/png') &&
    !ct.includes('image/jpeg') &&
    !ct.includes('application/octet-stream')
  ) {
    try {
      const j = await r.json()
      if (j?.error) throw new Error(j.error)
    } catch (e) {
      if (e.message && e.message !== '[object Object]') throw e
    }
    throw new Error('Unerwartete Antwort (kein Bild)')
  }
  return r.blob()
}
