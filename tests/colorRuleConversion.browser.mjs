import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'
import puppeteer from 'puppeteer-core'

const source = readFileSync(new URL('../src/dashboard/main.js', import.meta.url), 'utf8')
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))
const functions = [
  extract('function nameRuleMatches(', 'let cardColorRuleGeneration'),
  extract('function collectNameRulesFromContainer(', 'function appendDetailNameRule('),
  extract('function updateDetailMeshRowClasses(', 'function updateDetailMeshSelectionCount('),
].join('\n')
const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
  import { colorRulesAreConverted, colorRuleCoverageState, ruleMatchesMesh, colorRulesVersion, recordColorRuleConversion } from './src/lib/colorRuleConversion.js';
  const selectedProductId = 'fixture', productCache = new Map(), productGrid = document.getElementById('productGrid');
  let showMeshRal = true, detailMeshIsolateIndex = null;
  const detailMeshExcluded = new Set(), ColorService = { getRAL: () => ({hex:'#878581',name:'Test'}) };
  function updateDetailMeshSelectionCount() {}
  function attachNameRuleSummaryListeners() {}
  function refreshNameRuleSummaries() {}
  ${functions}
  colorRuleGlobals = [];
  const product = { id: 'fixture', glbFile: '/fixture.glb', conversionPreset: { nameColorRules: [] } };
  productCache.set('fixture', product);
  window.test = { product, update: updateDetailMeshRowClasses, bind: bindDetailNameRules, record: recordColorRuleConversion, rules: () => collectNameRulesFromContainer(document.getElementById('detailNameRulesRows')) };
` }, bundle: true, format: 'iife', write: false })
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const page = await browser.newPage()
  await page.setContent(`<div id="detailNameRulesRows"><div class="detail-name-rule-row">
    <input class="name-rule-pattern" value="Teil"><input class="name-rule-flags" value=""><select class="name-rule-target"><option>mesh</option></select>
    <select class="name-rule-ral"><option>RAL 7035</option><option>RAL 9007</option></select><select class="name-rule-finish"><option>pulver</option><option>verzinkt</option></select><button class="name-rule-remove">X</button>
    </div></div><div id="productGrid"><div class="product-card" data-id="fixture"><div class="card-color-rule-status"></div></div></div>
    <div id="detailMeshPartsList">${['Teil A','Teil B'].map((name,i) => `<div class="detail-mesh-row" data-mesh-idx="${i}"><span class="detail-mesh-name detail-mesh-name-trigger">${name}</span><span class="detail-mesh-ral"></span></div>`).join('')}</div>`)
  const css = readFileSync(new URL('../src/dashboard/dashboard.css', import.meta.url), 'utf8').replace(/^@(import|source).*$/gm, '')
  await page.addStyleTag({ content: css })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.evaluate(() => test.bind())
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
  await page.evaluate(() => { const rules = test.rules(); test.product.conversionPreset.nameColorRules = rules; test.record(test.product, rules, rules, {status:0}) })
  await page.click('.name-rule-remove')
  assert.equal(await page.$eval('.detail-mesh-ral', el => el.hidden && el.textContent === ''), true)
  assert.equal(await page.$eval('.detail-mesh-row', el => !el.classList.contains('is-rule-match') && !el.classList.contains('is-rule-pending')), true)
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.notEqual(await page.$eval('.detail-mesh-row', el => getComputedStyle(el).backgroundColor), 'rgb(255, 247, 214)')
  assert.equal(await page.$eval('.card-color-rule-status', el => el.dataset.state), 'pending')
  await page.evaluate(() => {
    document.getElementById('detailNameRulesRows').innerHTML = [
      ['RAL 7035', 'pulver'], ['RAL 9007', 'verzinkt'],
    ].map(([ral, finish]) => `<div class="detail-name-rule-row"><input class="name-rule-pattern" value="Teil"><input class="name-rule-flags" value=""><select class="name-rule-target"><option>mesh</option></select><select class="name-rule-ral"><option selected>${ral}</option></select><select class="name-rule-finish"><option selected>${finish}</option></select><button class="name-rule-remove">X</button></div>`).join('')
    test.update()
  })
  assert.equal(await page.$eval('.detail-mesh-ral', el => el.textContent), 'Verzinkt')
  await page.click('.detail-name-rule-row:last-child .name-rule-remove')
  assert.equal(await page.$eval('.detail-mesh-ral', el => el.textContent), 'RAL 7035')
  console.log('Passed: X removes galvanized/RAL display immediately and restores neutral mesh row while card remains pending for conversion.')
} finally { await browser.close() }
