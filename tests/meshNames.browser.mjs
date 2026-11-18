import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const source = readFileSync(new URL('../src/dashboard/main.js', import.meta.url), 'utf8')
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))
const expansion = readFileSync(new URL('../src/dashboard/modules/meshNameExpansion.js', import.meta.url), 'utf8').replaceAll('export function', 'function')
const css = readFileSync(new URL('../src/dashboard/dashboard.css', import.meta.url), 'utf8').replace(/^@(import|source).*$/gm, '')
const functions = [expansion,
  extract('function getSelectedMeshNameText(', 'function closeDetailMeshDrawer('),
  extract("document.addEventListener('selectionchange'", 'function openGlobalNameRulesModal('),
  extract('function escapeNameRulePattern(', 'async function saveMeshNameRule('),
  extract('function buildDetailMeshPartsUI()', '/** Alle Meshes ins GLB aufnehmen'),
].join('\n')
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1000, height: 800 })
  await page.setContent('<div id="detailMeshPartsSection" style="width:570px"><div id="detailMeshPartsList"></div></div><button id="outside">Außerhalb</button>')
  await page.addStyleTag({ content: css })
  await page.evaluate(functions => {
    const names = ['Kurz', 'KeineEAN_KeineArtikelnummer_KeineZeichnungsnummer_10', 'Anderer_Name', 'Ohne_Farbe']
    const meshes = names.map((name, i) => ({ name, geometry: { attributes: { position: { count: [19604, 1234567, 5, 98765][i] } } } }))
    const detailPreviewModelRoot = {}
    let detailMeshIsolateIndex = null, detailMeshExcluded = new Set(), detailMeshSelectionReady = false
    const selectedProductId = 'test'
    const productCache = new Map([['test', {}]])
    const collectMeshesFromGroup = () => meshes
    const splitVisibilityRules = () => ({ meshSelect: [] })
    const applyDetailMeshVisibility = () => {}
    const updateDetailMeshRowClasses = () => {
      document.querySelectorAll('.detail-mesh-ral').forEach((badge, i) => {
        badge.textContent = ['RAL 1003', 'RAL 3000', 'Verzinkt', ''][i]
        badge.hidden = i === 3
      })
    }
    let camera = null, isolated = null, adopted = null
    const focusDetailMeshPart = i => { camera = i }
    const toggleDetailMeshIsolate = i => { isolated = i }
    const getCurrentMatchingNameRules = () => []
    const getMatchingMeshColorRule = () => undefined
    const ColorService = { getAllColors: () => [] }
    const esc = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')
    let selectedMeshNameLabel = null, selectedMeshNameText = '', meshNameMenuController = null
    const closeMeshNameMenu = () => { meshNameMenuController?.abort(); document.getElementById('meshNameContextMenu')?.remove() }
    const appendDetailNameRule = pattern => { adopted = pattern; return null }
    const focusDetailNameRule = () => {}
    const build = eval(`(() => { ${functions}; return buildDetailMeshPartsUI; })()`)
    build()
    window.meshTest = { state: () => ({ names: meshes.map(m => m.name), camera, isolated, adopted }) }
  }, functions)
  const alignment = await page.evaluate(() => [...document.querySelectorAll('.detail-mesh-row')].map(row => {
    const style = getComputedStyle(row)
    const v = row.querySelector('.detail-mesh-v').getBoundingClientRect()
    const camera = row.querySelector('.detail-mesh-focus-btn').getBoundingClientRect()
    const ral = row.querySelector('.detail-mesh-ral')
    return { columns: style.gridTemplateColumns, v: v.x, camera: camera.x, ral: ral.hidden ? null : ral.getBoundingClientRect().x }
  }))
  for (const item of alignment) {
    assert.equal(item.columns, alignment[0].columns)
    assert.equal(item.v, alignment[0].v)
    assert.equal(item.camera, alignment[0].camera)
    if (item.ral !== null) assert.equal(item.ral, alignment[0].ral)
  }
  const trigger = '[data-mesh-idx="1"] .detail-mesh-name-trigger'
  await page.click('[data-mesh-idx="0"] .detail-mesh-name-trigger')
  assert.equal(await page.$('.detail-mesh-full-name'), null, 'Short names must stay in their row')
  await page.click('[data-mesh-idx="0"] .detail-mesh-name-trigger', { clickCount: 2 })
  assert.equal(await page.$('.detail-mesh-full-name'), null, 'Double click must not expand short names')
  await page.click(trigger, { clickCount: 2 })
  assert.equal(await page.$eval('.detail-mesh-full-name', el => el.textContent), 'KeineEAN_KeineArtikelnummer_KeineZeichnungsnummer_10')
  // Drag over the tail using real pointer events, then right-click the selected text.
  const points = await page.$eval('.detail-mesh-full-name', el => {
    const text = el.firstChild
    const start = text.textContent.indexOf('KeineZeichnungsnummer')
    const range = document.createRange()
    range.setStart(text, start); range.setEnd(text, start + 1)
    const first = range.getBoundingClientRect()
    range.setStart(text, text.length - 1); range.setEnd(text, text.length)
    const last = range.getBoundingClientRect()
    return { x: first.left + .1, y: first.top + first.height / 2, endX: last.right + .1, endY: last.top + last.height / 2 }
  })
  await page.mouse.move(points.x, points.y)
  await page.mouse.down()
  await page.mouse.move(points.endX, points.endY, { steps: 15 })
  await page.mouse.up()
  assert.equal(await page.evaluate(() => getSelection().toString()), 'KeineZeichnungsnummer_10')
  await page.mouse.click(points.endX - 3, points.endY, { button: 'right' })
  await page.click('#meshNameContextMenu button')
  assert.equal((await page.evaluate(() => window.meshTest.state())).adopted, 'KeineZeichnungsnummer_10')
  await page.click(trigger)
  assert.equal(await page.$('.detail-mesh-full-name'), null)
  await page.click(trigger)
  await page.click('#outside')
  assert.equal(await page.$('.detail-mesh-full-name'), null)
  await page.click('[data-mesh-focus="2"]')
  const state = await page.evaluate(() => window.meshTest.state())
  assert.equal(state.camera, 2)
  assert.equal(state.isolated, null)
  assert.equal(state.names[1], 'KeineEAN_KeineArtikelnummer_KeineZeichnungsnummer_10')
  const widths = await page.evaluate(() => {
    const list = document.getElementById('detailMeshPartsList')
    const name = list.querySelector('.detail-mesh-name-trigger')
    const before = name.getBoundingClientRect().width
    list.classList.add('hide-mesh-ral')
    list.querySelectorAll('.detail-mesh-ral').forEach(el => { el.hidden = true })
    return [before, name.getBoundingClientRect().width]
  })
  assert.ok(widths[1] > widths[0])
  await page.evaluate(() => {
    document.getElementById('detailMeshPartsSection').style.width = '950px'
    getSelection().removeAllRanges()
  })
  assert.ok(await page.$eval(trigger, el => el.scrollWidth <= el.clientWidth))
  await page.click(trigger)
  assert.equal(await page.$('.detail-mesh-full-name'), null, 'A name that fits after resizing must not expand')
  console.log('Passed: fixed columns, full name via double click, mouse-select tail and adopt via real context menu, close/reopen/outside, camera, unchanged names, released RAL column.')
} finally { await browser.close() }
