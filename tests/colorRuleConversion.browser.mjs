import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'
import puppeteer from 'puppeteer-core'

const source = readFileSync(new URL('../src/dashboard/main.js', import.meta.url), 'utf8')
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))
const functions = [
  extract('function nameRuleMatches(', 'let cardColorRuleGeneration'),
  extract('function collectNameRulesFromContainer(', 'function bindDetailNameRules('),
  extract('function updateDetailMeshRowClasses(', 'function updateDetailMeshSelectionCount('),
].join('\n')
const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
  import { colorRulesAreConverted, colorRuleCoverageState, ruleMatchesMesh, colorRulesVersion, recordColorRuleConversion } from './src/lib/colorRuleConversion.js';
  const selectedProductId = 'fixture', productCache = new Map(), productGrid = document.getElementById('productGrid');
  let showMeshRal = true, detailMeshIsolateIndex = null;
  const detailMeshExcluded = new Set(), ColorService = { getRAL: () => ({hex:'#878581',name:'Test'}) };
  function updateDetailMeshSelectionCount() {}
  ${functions}
  colorRuleGlobals = [];
  const product = { id: 'fixture', glbFile: '/fixture.glb', conversionPreset: { nameColorRules: [] } };
  productCache.set('fixture', product);
  window.test = { product, update: updateDetailMeshRowClasses, record: recordColorRuleConversion, rules: () => collectNameRulesFromContainer(document.getElementById('detailNameRulesRows')) };
` }, bundle: true, format: 'iife', write: false })
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const page = await browser.newPage()
  await page.setContent(`<div id="detailNameRulesRows"><div class="detail-name-rule-row">
    <input class="name-rule-pattern" value="Teil"><input class="name-rule-flags" value=""><select class="name-rule-target"><option>mesh</option></select>
    <select class="name-rule-ral"><option>RAL 7035</option><option>RAL 9007</option></select><select class="name-rule-finish"><option>pulver</option><option>verzinkt</option></select>
    </div></div><div id="productGrid"><div class="product-card" data-id="fixture"><div class="card-color-rule-status"></div></div></div>
    <div id="detailMeshPartsList">${['Teil A','Teil B'].map((name,i) => `<div class="detail-mesh-row" data-mesh-idx="${i}"><span class="detail-mesh-name detail-mesh-name-trigger">${name}</span><span class="detail-mesh-ral"></span></div>`).join('')}</div>`)
  const css = readFileSync(new URL('../src/dashboard/dashboard.css', import.meta.url), 'utf8').replace(/^@(import|source).*$/gm, '')
  await page.addStyleTag({ content: css })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  const check = async (state, ral) => {
    await page.evaluate(() => test.update())
    assert.equal(await page.$eval('.card-color-rule-status', el => el.dataset.state), state)
    assert.equal(await page.$$eval('.detail-mesh-row', (rows, state) => rows.every(row => row.classList.contains(state === 'complete' ? 'is-rule-match' : 'is-rule-pending')), state), true)
    assert.equal(await page.$eval('.card-color-rule-status', el => el.textContent.endsWith('✓')), state === 'complete')
    if (ral) assert.equal(await page.$eval('.detail-mesh-ral', el => el.textContent), ral)
    await page.waitForFunction(expected => getComputedStyle(document.querySelector('.detail-mesh-row')).backgroundColor === expected, {}, state === 'complete' ? 'rgb(237, 248, 240)' : 'rgb(255, 247, 214)')
  }
  await check('pending', 'RAL 7035')
  await page.evaluate(() => { const rules = test.rules(); test.product.conversionPreset.nameColorRules = rules; test.record(test.product, rules, rules, {status:0}) })
  await check('complete', 'RAL 7035')
  await page.select('.name-rule-ral', 'RAL 9007')
  await page.select('.name-rule-finish', 'verzinkt')
  await check('pending', 'Verzinkt')
  await page.evaluate(() => { const rules = test.rules(); test.product.conversionPreset.nameColorRules = rules; test.record(test.product, rules, rules, {status:1}) })
  await check('pending', 'Verzinkt')
  await page.evaluate(() => { const rules = test.rules(); test.record(test.product, rules, rules, {status:0}); document.querySelector('.detail-name-rule-row').remove() })
  await check('pending')
  console.log('Passed: actual mesh/card UI yellow -> green/check -> yellow, unchanged RAL/galvanized display, failed bake stays yellow and deletion becomes yellow.')
} finally { await browser.close() }
