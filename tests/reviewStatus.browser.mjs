import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'
import { STATUS_LABELS, ISSUE_CATALOG } from '../src/dashboard/modules/constants.js'

const source = readFileSync(new URL('../src/dashboard/main.js', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/dashboard/dashboard.css', import.meta.url), 'utf8')
function extract(start, end) {
  return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))
}
const functions = [
  extract('function getReviewStatus(p)', '\nfunction applyFilters'),
  extract('function renderCardStatusBar(p)', '\n/*'),
  extract('async function saveDetail()', '\nlet archiveRemovalPlan'),
].join('\n')
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
})
try {
  const page = await browser.newPage()
  const saved = await page.evaluate(async ({ functions, css, labels, issues }) => {
    document.head.innerHTML = `<style>${css}</style>`
    document.body.innerHTML = '<div id="grid"></div><div id="detail"></div>'
    const productGrid = document.getElementById('grid')
    const detailContent = document.getElementById('detail')
    const STATUS_LABELS = labels
    const ISSUE_CATALOG = issues
    const esc = value => String(value)
    let selectedProductId = 'a'
    let stored = [{ id: 'a', name: 'A', _review: { status: 'open' } }, { id: 'b', name: 'B', _review: { status: 'approved' } }]
    let currentPageProducts = structuredClone(stored)
    const productCache = new Map(currentPageProducts.map(p => [p.id, p]))
    const previewRenderers = new Map()
    const detailPreviewModelRoot = null
    const updateCardColorRuleStatuses = () => {}
    const loadCategoryOptions = async () => {}
    const toast = (message, type) => { if (type === 'error') throw new Error(message) }
    const openDetail = () => {}
    let refreshes = 0
    const patchProduct = async (id, changes) => {
      const saved = structuredClone(changes)
      stored = stored.map(p => p.id === id ? saved : p)
      productCache.set(id, saved)
      currentPageProducts = structuredClone(stored)
      return saved
    }
    // Execute the real save handler and renderer against a browser DOM.
    const { save, render } = eval(`(() => { ${functions}; return { save: saveDetail, render: renderCardStatusBar }; })()`)
    function draw() {
      productGrid.innerHTML = stored.map(p => `<div data-id="${p.id}">${render(p)}</div>`).join('')
    }
    const fetchPage = async () => {
      const bar = productGrid.querySelector('[data-id="a"] .card-status-bar')
      if (!bar || !bar.classList.contains(`status-bar-${stored[0]._review.status}`)) throw new Error('Immediate card update missing')
      refreshes++
      draw()
    }
    draw()
    const results = []
    for (const status of ['review', 'approved', 'rejected', 'open']) {
      // Cache deliberately retains the previous status: the active control must win.
      detailContent.innerHTML = `<button class="review-status-btn active-${status}" data-status="${status}"><span class="status-dot dot-${status}"></span></button>`
      if (!await save()) throw new Error('Save failed')
      const card = productGrid.querySelector('[data-id="a"]')
      const label = card.querySelector('.card-status-label').textContent
      const dotColor = getComputedStyle(card.querySelector('.status-dot')).backgroundColor
      const detailColor = getComputedStyle(detailContent.querySelector('.status-dot')).backgroundColor
      if (label !== labels[status] || dotColor !== detailColor) throw new Error(`Wrong label/color for ${status}`)
      if (productGrid.querySelector('[data-id="b"] .card-status-label').textContent !== labels.approved) throw new Error('Other product changed')
      results.push({ status, label, dotColor })
    }
    return { stored, results, refreshes }
  }, { functions, css, labels: STATUS_LABELS, issues: ISSUE_CATALOG })
  assert.equal(saved.refreshes, 4)
  await page.reload()
  const reloaded = await page.evaluate(({ functions, stored, labels, issues }) => {
    const STATUS_LABELS = labels
    const ISSUE_CATALOG = issues
    const esc = String
    const render = eval(`(() => { ${functions}; return renderCardStatusBar; })()`)
    document.body.innerHTML = stored.map(render).join('')
    return [...document.querySelectorAll('.card-status-label')].map(el => el.textContent)
  }, { functions, stored: saved.stored, labels: STATUS_LABELS, issues: ISSUE_CATALOG })
  assert.deepEqual(reloaded, [STATUS_LABELS.open, STATUS_LABELS.approved])
  console.log(JSON.stringify({ passed: true, transitions: saved.results, reload: reloaded }, null, 2))
} finally {
  await browser.close()
}
