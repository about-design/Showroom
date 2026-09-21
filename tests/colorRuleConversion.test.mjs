import test from 'node:test'
import assert from 'node:assert/strict'
import { colorRuleCoverageState, colorRulesAreConverted, recordColorRuleConversion } from '../src/lib/colorRuleConversion.js'

const rule = { target: 'mesh', pattern: 'Teil', ral: 'RAL 7035', finish: 'pulver' }
const names = ['Teil A', 'Teil B']
test('new assignment, completed conversion, edits and failed/aborted conversions', () => {
  const product = { glbFile: '/test.glb' }
  const rules = [rule]
  assert.equal(colorRuleCoverageState(names, rules, product).state, 'pending')
  recordColorRuleConversion(product, rules, rules, { status: 0 })
  assert.equal(colorRuleCoverageState(names, rules, product).state, 'complete')
  assert.match(colorRuleCoverageState(names, rules, product).text, /✓$/)
  const changed = [{ ...rule, ral: 'RAL 9007', finish: 'verzinkt' }]
  assert.equal(colorRuleCoverageState(names, changed, product).state, 'pending')
  assert.doesNotMatch(colorRuleCoverageState(names, changed, product).text, /✓/)
  for (const result of [{ status: 1 }, { status: null, signal: 'SIGTERM' }, { status: 0, error: new Error('write failed') }]) {
    recordColorRuleConversion(product, changed, changed, result)
    assert.equal(colorRuleCoverageState(names, changed, product).state, 'pending')
  }
  recordColorRuleConversion(product, changed, changed, { status: 0 }, false)
  assert.equal(colorRuleCoverageState(names, changed, product).state, 'pending')
  recordColorRuleConversion(product, changed, changed, { status: 0 })
  assert.equal(colorRuleCoverageState(names, changed, product).state, 'complete')
  assert.equal(colorRuleCoverageState(names, [], product).state, 'pending', 'Deletion is pending even with zero assigned meshes')
  assert.equal(colorRuleCoverageState(names, [...changed, rule], product).state, 'pending')
})
test('snapshot survives JSON reload and does not certify a newer or global rule version', () => {
  const product = { glbFile: '/test.glb' }, rules = [rule], globals = [{ ...rule, pattern: 'global' }]
  recordColorRuleConversion(product, rules, [...globals, ...rules], { status: 0 })
  const reloaded = JSON.parse(JSON.stringify(product))
  assert.equal(colorRulesAreConverted(reloaded, rules, globals), true)
  assert.equal(colorRulesAreConverted(reloaded, rules, [{ ...globals[0], ral: 'RAL 2001' }]), false)
  assert.equal(colorRulesAreConverted(reloaded, [{ ...rule, pattern: 'changed during conversion' }], globals), false)
  assert.equal(colorRulesAreConverted({ ...reloaded, glbFile: '/replacement.glb' }, rules, globals), false)
  assert.equal(colorRulesAreConverted({ ...reloaded, conversionError: {} }, rules, globals), false)
  assert.equal(colorRulesAreConverted(reloaded, rules, null), false)
  assert.equal(colorRulesAreConverted(reloaded, [{ ...rule, flags: '' }], globals), true, 'Editor default fields are equivalent')
})
