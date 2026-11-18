import test from 'node:test'
import assert from 'node:assert/strict'
import { AUTOMATIC_COLOR_RULE_SOURCE, buildAutomaticColorRulePlan, drawingNumberFromMeshName, eanFromMeshNames, hasVzkShortTextMarker, normalizeAutomaticColorMappings, ralCodeFromShortText } from '../src/lib/automaticColorAssignment.js'

test('automatic color assignment groups drawing-number instances and preserves unmatched meshes as galvanized', () => {
  const mappings = normalizeAutomaticColorMappings([
    { drawingNumber: '06-00763', ral: 'RAL 7035' },
    { drawingNumber: '06-00894', ral: '5010', always: true },
    { drawingNumber: 'invalid', ral: 'RAL 9007' },
  ])
  assert.deepEqual(mappings, [
    { drawingNumber: '06-00763', ral: 'RAL 7035', always: false },
    { drawingNumber: '06-00894', ral: 'RAL 5010', always: true },
  ])
  assert.equal(drawingNumberFromMeshName('4026212286489_177599_06-00763_2'), '06-00763')
  assert.equal(drawingNumberFromMeshName('coordinate-axis-X'), null)
  assert.equal(eanFromMeshNames(['4026212286489_177599_06-00763_1', '4026212286489_177599_06-00894_1']), '4026212286489')
  const plan = buildAutomaticColorRulePlan([
    '4026212286489_177599_06-00763_1',
    '4026212286489_177599_06-00763_2',
    '4026212286489_177599_06-00894_1',
    '4026212286489_177599_31-01434_1',
  ], mappings)
  assert.deepEqual(plan.counts, [
    { ral: 'RAL 7035', count: 2 },
    { ral: 'RAL 5010', count: 1 },
    { ral: 'RAL 9007', count: 1 },
  ])
  assert.equal(plan.rules.filter((rule) => rule.source === AUTOMATIC_COLOR_RULE_SOURCE).length, 3)
  assert.deepEqual(plan.rules[0], {
    target: 'mesh', pattern: '(?:^|_)4026212286489(?=_|$)', displayPattern: '4026212286489', matchMode: 'ean', ral: 'RAL 9007', finish: 'verzinkt', source: AUTOMATIC_COLOR_RULE_SOURCE,
  })
  const drawingRule = plan.rules.find((rule) => rule.pattern.includes('06-00763') && rule.ral === 'RAL 7035')
  assert.equal(drawingRule.displayPattern, '06-00763')
  assert.equal(drawingRule.matchMode, 'drawing-number')
  assert.equal(plan.rules[1].displayPattern, '06-00763')
  assert.equal(plan.rules[2].displayPattern, '06-00894')
  assert.ok(new RegExp(drawingRule.pattern).test('4026212286489_177599_06-00763_1'))
  assert.ok(new RegExp(drawingRule.pattern).test('4026212286489_177599_06-00763_2'))
  assert.equal(new RegExp(drawingRule.pattern).test('4026212286489_177599_06-007630_1'), false)
})

test('vzk in SAP short text overrides normal mappings but preserves always mappings as one drawing-number rule', () => {
  const names = ['fixture_06-01071_1', 'fixture_06-01071_2', 'fixture_31-01434_1']
  const mappings = [{ drawingNumber: '06-01071', ral: 'RAL 5010', always: true }]
  assert.equal(hasVzkShortTextMarker('MP SR85/20 2200 800 Vzk kpl'), true)
  assert.equal(hasVzkShortTextMarker('MP SR85/20 vzk123 kpl'), false)
  const vzkPlan = buildAutomaticColorRulePlan(names, mappings, 'MP SR85/20 2200 800 vzk kpl')
  assert.equal(vzkPlan.isVzkProduct, true)
  assert.deepEqual(vzkPlan.counts, [{ ral: 'RAL 5010', count: 2 }, { ral: 'RAL 9007', count: 1 }])
  assert.equal(vzkPlan.rules.length, 2)
  assert.equal(vzkPlan.rules[0].ral, 'RAL 9007')
  assert.equal(vzkPlan.alwaysMappingCount, 1)
  const alwaysRule = vzkPlan.rules.at(-1)
  assert.equal(alwaysRule.displayPattern, '06-01071')
  assert.equal(alwaysRule.ral, 'RAL 5010')
  assert.ok(new RegExp(alwaysRule.pattern).test('fixture_06-01071_1'))
  assert.ok(new RegExp(alwaysRule.pattern).test('fixture_06-01071_2'))
  const normalVzkPlan = buildAutomaticColorRulePlan(names, [{ drawingNumber: '06-01071', ral: 'RAL 5010' }], 'MP SR85/20 2200 800 vzk kpl')
  assert.equal(normalVzkPlan.rules.length, 1)
  assert.deepEqual(normalVzkPlan.counts, [{ ral: 'RAL 9007', count: 3 }])
  const ralPlan = buildAutomaticColorRulePlan(names, mappings, 'MP SR85/20 2200 800 R5010 kpl')
  assert.equal(ralPlan.isVzkProduct, false)
  assert.deepEqual(ralPlan.counts, [{ ral: 'RAL 5010', count: 2 }, { ral: 'RAL 9007', count: 1 }])
  assert.equal(ralPlan.rules.length, 2)
  assert.equal(ralPlan.rules.some((rule) => rule.displayPattern === '06-01071' && rule.ral === 'RAL 5010'), true)
})

test('matching SAP RAL activates only the matching non-always drawing mapping', () => {
  assert.equal(ralCodeFromShortText('MP DSS H 1825 LA100 R2001/vzk kpl'), 'RAL 2001')
  assert.equal(ralCodeFromShortText('R20012'), null)
  assert.equal(ralCodeFromShortText('RAL 2001, vzk'), 'RAL 2001')
  const names = ['product_31-01789_1', 'product_31-01789_2', 'product_31-01434_1']
  const plan = buildAutomaticColorRulePlan(names, [
    { drawingNumber: '31-01789', ral: 'RAL 2001' },
    { drawingNumber: '31-01434', ral: 'RAL 5010' },
  ], 'MP DSS H 1825 LA100 R2001/vzk kpl')
  assert.equal(plan.shortTextRal, 'RAL 2001')
  assert.equal(plan.shortTextRalMappingCount, 1)
  assert.deepEqual(plan.counts, [{ ral: 'RAL 2001', count: 2 }, { ral: 'RAL 9007', count: 1 }])
  assert.equal(plan.rules.some((rule) => rule.displayPattern === '31-01789' && rule.ral === 'RAL 2001'), true)
  assert.equal(plan.rules.some((rule) => rule.displayPattern === '31-01434'), false)
})
