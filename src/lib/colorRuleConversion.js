import { normalizeNameRuleRalKey, normalizeNameRuleFinish } from './nameColorRules.js'

// Stable, ordered snapshots: changing, adding, removing or reordering a rule invalidates the receipt.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}
export function colorRulesVersion(rules = []) {
  return JSON.stringify(canonical((Array.isArray(rules) ? rules : []).map(rule => ({
    target: rule.target || 'material',
    pattern: String(rule.pattern || '').trim(),
    flags: String(rule.flags || '').trim(),
    ral: normalizeNameRuleRalKey(rule.ral) || '',
    finish: normalizeNameRuleFinish(rule.finish),
  }))))
}
export function recordColorRuleConversion(product, productRules, mergedRules, result, completed = true) {
  product._colorRulesDirty = true
  if (!completed || result?.status !== 0 || result.error || result.signal) return false
  product._colorRuleConversion = {
    productRules: JSON.parse(colorRulesVersion(productRules)),
    mergedRules: JSON.parse(colorRulesVersion(mergedRules)),
    glbFile: product.glbFile,
    convertedAt: new Date().toISOString(),
  }
  delete product._colorRulesDirty
  return true
}
export function colorRulesAreConverted(product, rules, globalRules = []) {
  const receipt = product?._colorRuleConversion
  return Array.isArray(globalRules) && !!receipt && !product._colorRulesDirty && !product.conversionError && receipt.glbFile === product.glbFile &&
    colorRulesVersion(receipt.productRules) === colorRulesVersion(rules) &&
    colorRulesVersion(receipt.mergedRules) === colorRulesVersion([...globalRules, ...rules])
}
export function ruleMatchesMesh(name, rule) {
  try { return !!rule?.pattern && new RegExp(String(rule.pattern).trim(), String(rule.flags || '').trim()).test(name) } catch { return false }
}
export function colorRuleCoverageState(names, rules, product, globalRules = []) {
  const assigned = names.filter(name => rules.some(rule => ruleMatchesMesh(name, rule))).length
  const converted = colorRulesAreConverted(product, rules, globalRules)
  const complete = names.length > 0 && assigned === names.length && converted
  const changedSinceBake = (!!product?._colorRuleConversion || product?._colorRulesDirty) && !converted
  return {
    text: `Farbregeln: ${assigned}/${names.length} Einzelteile zugeordnet${complete ? ' ✓' : ''}`,
    state: complete ? 'complete' : (assigned > 0 || changedSinceBake) && !converted ? 'pending' : assigned > 0 ? 'partial' : 'none',
    title: !converted && (assigned > 0 || changedSinceBake) ? 'Regelstand noch nicht im GLB übernommen – Neu-Konvertierung erforderlich.' : converted ? 'Aktueller Regelstand erfolgreich im GLB übernommen.' : '',
  }
}
