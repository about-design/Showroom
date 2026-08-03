/**
 * Löst relative Asset-Pfade (/models/..., /thumbnails/...) gegen VITE_ASSET_BASE_URL auf.
 * Absolute http(s)-URLs bleiben unverändert.
 *
 * @param {string | null | undefined} path
 * @returns {string}
 */
export function resolveAssetUrl(path) {
  if (!path || typeof path !== 'string') return path ?? ''
  const trimmed = path.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  const base = String(import.meta.env.VITE_ASSET_BASE_URL || '').trim().replace(/\/$/, '')
  const rel = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  if (!base) return rel
  return `${base}${rel}`
}

/** @returns {boolean} */
export function hasExternalAssetBase() {
  return !!String(import.meta.env.VITE_ASSET_BASE_URL || '').trim()
}
