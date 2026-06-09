/**
 * Lädt public/mtl-ral-color-mapping.json einmal (Namens-Farbregeln + Overrides).
 * Für Laufzeit-Merge wie in der Bake-Pipeline (Produktregeln zuerst, dann global).
 */

let cached = null
let inflight = null

export function getCachedMtlRalMappingSync() {
  return cached
}

export async function loadMtlRalColorMapping() {
  if (cached) return cached
  if (!inflight) {
    inflight = fetch('/mtl-ral-color-mapping.json')
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}))
      .then((data) => {
        cached = data && typeof data === 'object' ? data : {}
        return cached
      })
  }
  return inflight
}
