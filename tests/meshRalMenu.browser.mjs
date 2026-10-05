import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const source = readFileSync(new URL('../src/dashboard/main.js', import.meta.url), 'utf8')
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))
const functions = [
  extract('function applyMeshDisplaySettings(', 'async function loadMeshDisplaySettings('),
  extract('function renderNameRuleRowHtml(', 'function bindDetailNameRules('),
  extract('function appendDetailNameRule(', 'function getSelectedMeshNameText('),
  extract('function openMeshNameMenu(', 'function openGlobalNameRulesModal('),
  extract('function nameRuleMatches(', 'function colorRuleCoverage('),
].join('\n')
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
})
try {
  const page = await browser.newPage()
  const result = await page.evaluate(async (functions) => {
    document.body.innerHTML = '<div id="detailNameRulesRows"></div><div id="meshRow"><span class="detail-mesh-ral" hidden></span></div>'
    const rows = document.getElementById('detailNameRulesRows')
    const colors = [
      { code: 'RAL 2001', name: 'Rotorange', hex: '#BA481C' },
      { code: 'RAL 7035', name: 'Lichtgrau', hex: '#D7D7D7' },
      { code: 'RAL 9007', name: 'Verzinkt', hex: '#878581' },
    ]
    const AUTOMATIC_COLOR_RULE_SOURCE = 'automatic-color-assignment'
    const ColorService = { getAllColors: () => colors, getRAL: ral => colors.find(c => c.code === ral) }
    let showMeshRal = true
    const applyViewCubeSettings = () => {}
    const applyDetailSidebarPinnedSetting = () => {}
    let refreshBadge = () => {}
    const esc = text => String(text).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
    const selectedProductId = 'test'
    const productCache = new Map([['test', { id: 'test', conversionPreset: { nameColorRules: [] } }]])
    let savedRules
    let summaries = 0
    let markings = 0
    const refreshNameRuleSummaries = () => { summaries++ }
    const updateDetailMeshRowClasses = () => { markings++; refreshBadge() }
    const focusDetailNameRule = () => {}
    const toast = (message, type) => { if (type === 'error') throw new Error(message) }
    const patchProduct = async (id, changes) => {
      productCache.set(id, { id, ...structuredClone(changes) })
      savedRules = structuredClone(changes.conversionPreset.nameColorRules)
    }
    const { render, open, match, badge, settings } = eval(`(() => { ${functions}; return { render: renderNameRuleRowsHtml, open: openMeshNameMenu, match: getCurrentMatchingNameRules, badge: updateMeshRalBadge, settings: applyMeshDisplaySettings }; })()`)
    const check = (value, message) => { if (!value) throw new Error(message) }
    const name = '4026212347029_189675_RAL_35-00036_1'
    const meshRow = document.getElementById('meshRow')
    const ralBadge = meshRow.querySelector('.detail-mesh-ral')
    refreshBadge = () => badge(meshRow, match(name))
    const initial = { target: 'mesh', pattern: 'ral_35-00036_\\d+$', flags: 'i', ral: 'RAL 2001', finish: 'pulver' }
    rows.innerHTML = render([initial])
    refreshBadge()
    check(ralBadge.textContent === 'RAL 2001' && !ralBadge.hidden, 'Initial mesh RAL missing')
    check(ralBadge.querySelector('.detail-mesh-ral-chip').style.backgroundColor === 'rgb(186, 72, 28)', 'Wrong RAL chip color')
    const show = (meshName = name, selectedText = meshName) => {
      open({ clientX: 10, clientY: 10 }, selectedText, match(meshName), meshName, selectedText === meshName ? '' : selectedText)
      return document.querySelector('#meshNameContextMenu select')
    }
    check(show().selectedOptions[0].textContent === 'RAL 2001 Rotorange', 'Initial RAL not selected')
    async function change(ral, selectedText = name) {
      const select = show(name, selectedText)
      select.value = ral
      select.dispatchEvent(new Event('change'))
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    await change('RAL 7035', '35-00036')
    check(ralBadge.textContent === 'RAL 7035', 'Mesh badge did not update immediately')
    settings({ showMeshRal: false })
    check(ralBadge.hidden && !ralBadge.textContent, 'Disabled badge must be empty and hidden')
    settings({ showMeshRal: true })
    check(!ralBadge.hidden && ralBadge.textContent === 'RAL 7035', 'Re-enabled badge missing')
    check(savedRules.length === 2, 'Exact override rule was not added')
    check(savedRules[0].pattern === initial.pattern && savedRules[0].ral === 'RAL 2001', 'General rule was altered')
    check(savedRules[1].pattern === '(?:^|_)35-00036(?:_\\d+)?$' && savedRules[1].target === 'mesh', 'Selected drawing number was not converted to its technical pattern')
    check(savedRules[1].finish === 'pulver', 'Wrong powder finish')
    check(show().selectedOptions[0].textContent === 'RAL 7035 Lichtgrau', 'Updated RAL not selected')
    await change('RAL 9007', '35-00036')
    check(ralBadge.textContent === 'Verzinkt' && ralBadge.title.includes('RAL 9007'), 'Galvanized badge missing')
    check(savedRules.length === 2 && savedRules[1].finish === 'verzinkt', 'Existing exact rule was duplicated or has wrong finish')
    check(match('4026212347029_189675_RAL_35-00036_2').some(rule => rule.pattern === '35-00036'), 'Selected regex does not match sibling mesh')
    check(!match('4026212347029_189675_OTHER_2').some(rule => rule.pattern === '35-00036'), 'Selected regex matches unrelated mesh')
    rows.innerHTML = render([{ ...initial, ral: 'RAL 7035' }, initial, { ...initial, ral: '' }])
    check(show().value === 'RAL 2001', 'Last valid matching rule must win')
    await change('RAL 9007')
    check(savedRules.length === 3 && savedRules.at(-1).pattern === '^4026212347029_189675_RAL_35-00036_1$' && savedRules.at(-1).ral === 'RAL 9007', 'Exact override was not moved to highest priority')
    rows.innerHTML = render([{ ...initial, ral: '' }])
    refreshBadge()
    check(ralBadge.hidden && ralBadge.textContent === '', 'Unassigned badge must be empty')
    check(show().value === '', 'Missing RAL must show placeholder')
    await change('RAL 2001')
    check(rows.children.length === 2 && savedRules.length === 1 && savedRules.at(-1).pattern === '^4026212347029_189675_RAL_35-00036_1$', 'Unassigned general row must receive an exact override')
    check(show('unmatched').value === '', 'Unmatched mesh must show placeholder')
    const select = show('unmatched')
    select.value = 'RAL 7035'
    select.dispatchEvent(new Event('change'))
    await new Promise(resolve => setTimeout(resolve, 0))
    check(savedRules.length === 2 && savedRules.at(-1).pattern === '^unmatched$', 'New exact rule missing')
    check(summaries >= 5 && markings >= 5, 'Rule display/mesh marking not refreshed')
    return { passed: true, checks: ['general rule preserved', 'selected text adopted verbatim', 'selected rule updated without duplicate', 'fallback exact rule keeps last-wins priority', 'matching sibling and unrelated mesh', 'rule and mesh refresh'] }
  }, functions)
  assert.equal(result.passed, true)
  console.log(JSON.stringify(result, null, 2))
} finally {
  await browser.close()
}
