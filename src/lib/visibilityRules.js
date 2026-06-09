/**
 * Regeln zum Ein-/Ausblenden von Teilen beim **GLB-Export (Bake)**.
 *
 * Match-Quellen (genau eine pro Regel, wie bei Reduktion):
 *   - `target`: `material | node | mesh | nodePath | extras`
 *   - `pattern` (JavaScript-Regex) + optionale `flags`
 *
 * Aktion:
 *   - `action: 'hide'` → matchende Primitive/Knoten werden beim Baken entfernt.
 *   - `action: 'keep'` → markiert Treffer explizit als „bleibt sichtbar" und
 *     überschreibt damit eine zuvor passende `hide`-Regel (last-wins).
 *
 * Auswertung im Bake (siehe scripts/bake-glb-yup.js → applyVisibilityRules):
 *   global → Produkt; bei mehreren Treffern gewinnt die **letzte** passende Regel.
 *   Standard ohne Treffer: Primitive bleibt sichtbar.
 *
 * Pro-Produkt-Konzept: konfiguriert wird nur im `conversionPreset` des Produkts
 *   (keine globale Regeldatei). `globalMapping` wird nur aus Konsistenz mit den
 *   anderen merge-Funktionen angenommen, aktuell aber nicht aus dem Mapping
 *   gelesen — siehe `mergeVisibilityRuleEntries`.
 */

const TARGETS = new Set(['material', 'node', 'mesh', 'nodePath', 'extras'])
const ACTIONS = new Set(['hide', 'keep'])

/**
 * @param {object|null} globalMapping  — aktuell ignoriert (pro Produkt definiert)
 * @param {object|null} productPreset
 * @returns {Array<object>}
 */
export function mergeVisibilityRuleEntries(globalMapping = null, productPreset = null) {
  const product = productPreset?.visibilityRules
  const global = globalMapping?.visibilityRules
  return [...(Array.isArray(global) ? global : []), ...(Array.isArray(product) ? product : [])]
}

/**
 * @param {Array<object>} rules
 * @returns {Array<object>} — kompilierte Regeln (mit `regex`-Instanz)
 */
export function compileVisibilityRules(rules) {
  const out = []
  if (!Array.isArray(rules)) return out
  for (const r of rules) {
    if (!r || typeof r !== 'object') continue

    const tRaw = String(r.target ?? 'mesh').trim()
    const target = TARGETS.has(tRaw) ? tRaw : 'mesh'

    const aRaw = String(r.action ?? 'hide').trim().toLowerCase()
    const action = ACTIONS.has(aRaw) ? aRaw : 'hide'

    const pattern = String(r.pattern ?? '').trim()
    const flags = typeof r.flags === 'string' ? r.flags : ''

    if (!pattern) continue

    let regex = null
    try {
      regex = new RegExp(pattern, flags)
    } catch {
      continue
    }

    out.push({ target, action, pattern, flags, regex })
  }
  return out
}
