/**
 * Gemeinsame Hex-Normalisierung und MTL→RAL-Mapping → colorOverrides.
 * Von Konverter (Browser), Vite (Node) und optional Skripten genutzt – eine Logik, kein Drift.
 */

/** Wie ColorService.normalizeHex: #RRGGBB uppercase. */
export function normalizeMappingHex(hex) {
  if (!hex || typeof hex !== 'string') return ''
  const h = hex.trim().replace(/^#/, '')
  if (h.length === 6 && /^[0-9a-fA-F]{6}$/.test(h)) return '#' + h.toUpperCase()
  return hex
}

/**
 * Baut colorOverrides aus Projekt-Mapping-JSON.
 * Priorität: matchRal + sourcePalette (Ziel-Hex: **matches[id]** falls gesetzt, sonst RAL-Palette) → matchPalette → matches + sourcePalette.
 *
 * @param {object} data - Mapping JSON
 * @param {(ralKey: string) => string | null | undefined} | null [getRalHex] - Ziel-Hex für RAL-Code; **null** = RAL-Zweig komplett überspringen (wie fehlende ralColors.json)
 * @returns {Record<string, string>}
 */
export function buildColorOverridesFromMapping(data, getRalHex) {
  const norm = normalizeMappingHex
  const colorOverrides = {}
  const hasRal =
    getRalHex != null &&
    typeof getRalHex === 'function' &&
    data.matchRal &&
    data.sourcePalette &&
    Array.isArray(data.sourcePalette)

  if (hasRal) {
    for (const c of data.sourcePalette) {
      const id = String(c.id)
      const ralKey = data.matchRal[id]
      const orig = norm(c.hex)
      let match = ''
      if (data.matches && data.matches[id]) {
        match = norm(data.matches[id])
      }
      if (!match && ralKey) {
        const ralHex = getRalHex(ralKey)
        match = ralHex ? norm(ralHex) : ''
      }
      if (orig && match) colorOverrides[orig] = match
    }
  }
  if (Object.keys(colorOverrides).length === 0 && data.matchPalette && Array.isArray(data.matchPalette)) {
    for (const p of data.matchPalette) {
      const orig = norm(p.originalHex)
      const match = norm(p.matchHex)
      if (orig && match) colorOverrides[orig] = match
    }
  }
  if (Object.keys(colorOverrides).length === 0 && data.matches && data.sourcePalette && Array.isArray(data.sourcePalette)) {
    for (const c of data.sourcePalette) {
      const orig = norm(c.hex)
      const match = data.matches[String(c.id)] && norm(data.matches[String(c.id)])
      if (orig && match) colorOverrides[orig] = match
    }
  }
  const excludeSet = new Set((data.overrideExcludeHex || []).map((h) => norm(h)).filter(Boolean))
  for (const k of Object.keys(colorOverrides)) {
    if (excludeSet.has(k)) delete colorOverrides[k]
  }
  let out = { ...colorOverrides }
  out = expandMtlHexAliasKeys(out)
  for (const [key, value] of Object.entries(out)) {
    if (key && key.toLowerCase() !== key) out[key.toLowerCase()] = value
  }
  return out
}

/** RGB-Zentren, für die ±1 pro Kanal dieselbe Override-Zielfarbe erhalten (Pipeline-Rundung vs. #847E78). */
const MTL_ALIAS_RGB_CENTERS = [[132, 126, 120]]

/**
 * Dupliziert Overrides auf Nachbar-Hexwerte im RGB-Würfel, wenn das Zentrum bereits gemappt ist.
 */
function expandMtlHexAliasKeys(overrides) {
  const norm = normalizeMappingHex
  const out = { ...overrides }
  for (const [r0, g0, b0] of MTL_ALIAS_RGB_CENTERS) {
    const center =
      '#' +
      [r0, g0, b0]
        .map((x) => x.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase()
    const centerKey = norm(center)
    let target = centerKey ? out[centerKey] : ''
    if (!target && centerKey) target = out[centerKey.toLowerCase()] || ''
    if (!target) continue
    for (let dr = -1; dr <= 1; dr++) {
      for (let dg = -1; dg <= 1; dg++) {
        for (let db = -1; db <= 1; db++) {
          const r = Math.max(0, Math.min(255, r0 + dr))
          const g = Math.max(0, Math.min(255, g0 + dg))
          const b = Math.max(0, Math.min(255, b0 + db))
          const h =
            '#' +
            [r, g, b]
              .map((x) => x.toString(16).padStart(2, '0'))
              .join('')
              .toUpperCase()
          const nk = norm(h)
          if (nk) out[nk] = target
        }
      }
    }
  }
  return out
}
