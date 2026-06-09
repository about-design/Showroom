/**
 * Namensbasierte Farbregeln (Material/Node) für MTL-Mapping-Erweiterung.
 *
 * Gewichtung (Konvertierung / Bake / Showroom): zuerst globale Regeln, dann Produktregeln —
 * bei mehreren Treffern gewinnt die **letzte** passende Regel (Produkt überschreibt Global).
 */

/**
 * @param {string} ral
 * @returns {string|null} Normalisierter Schlüssel wie in ralColors.json, z. B. "RAL 7035"
 */
export function normalizeNameRuleRalKey(ral) {
  const s = String(ral ?? '').trim()
  if (!s) return null
  const m = s.match(/(\d{4})/)
  if (m) return `RAL ${m[1]}`
  return null
}

/**
 * Roh-Einträge aus Mapping + optional conversionPreset zusammenführen (serialisierbar).
 * Reihenfolge: **global**, dann **Produkt** — Auswertung mit „letzte passende Regel gewinnt“.
 *
 * @param {object|null} globalMapping - z. B. public/mtl-ral-color-mapping.json
 * @param {object|null} productPreset - z. B. products[].conversionPreset
 * @returns {Array<{ target?: string, pattern: string, ral: string, flags?: string }>}
 */
export function mergeNameColorRuleEntries(globalMapping = null, productPreset = null) {
  const product = productPreset?.nameColorRules
  const global = globalMapping?.nameColorRules
  return [...(Array.isArray(global) ? global : []), ...(Array.isArray(product) ? product : [])]
}

/** Ziele für Szenen-Regeln (nicht material): Reihenfolge in der JSON-Datei bleibt erhalten. */
const SCENE_TARGETS = new Set(['node', 'mesh', 'nodePath', 'extras'])

/**
 * Normalisiert den optionalen Oberflächen-Override einer Regel.
 * @param {unknown} v
 * @returns {'verzinkt'|'pulver'|null}
 */
export function normalizeNameRuleFinish(v) {
  const s = String(v ?? '').trim().toLowerCase()
  if (s === 'verzinkt') return 'verzinkt'
  if (s === 'pulver' || s === 'pulverbeschichtet') return 'pulver'
  return null
}

/**
 * Kompiliert Regeln für die Bake-Pipeline (Regex + normalisierter RAL-Key).
 *
 * @param {Array<object>} rules
 * @returns {Array<{ target: 'material'|'node'|'mesh'|'nodePath'|'extras', regex: RegExp, ralKey: string, finish: 'verzinkt'|'pulver'|null }>}
 */
export function compileNameColorRules(rules) {
  const out = []
  if (!Array.isArray(rules)) return out
  for (const r of rules) {
    if (!r || typeof r !== 'object') continue
    const raw = String(r.target ?? 'material').trim()
    const target =
      raw === 'node' ||
      raw === 'mesh' ||
      raw === 'nodePath' ||
      raw === 'extras'
        ? raw
        : 'material'
    const pattern = String(r.pattern ?? '').trim()
    const ralKey = normalizeNameRuleRalKey(r.ral)
    if (!pattern || !ralKey) continue
    let regex
    try {
      const fl = typeof r.flags === 'string' ? r.flags : ''
      regex = new RegExp(pattern, fl)
    } catch {
      continue
    }
    const finish = normalizeNameRuleFinish(r.finish)
    out.push({ target, regex, ralKey, finish })
  }
  return out
}

/** Szenen-Regeln in Dokumentreihenfolge (node, mesh, nodePath, extras — gemischt). */
export function sceneNameColorRulesInOrder(rules) {
  if (!Array.isArray(rules)) return []
  return rules.filter((r) => r && SCENE_TARGETS.has(r.target))
}
