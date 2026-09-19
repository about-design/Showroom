import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'

const html = readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
  .replace(/<link\b[^>]*>/g, '')
const css = readFileSync(new URL('../src/dashboard/dashboard.css', import.meta.url), 'utf8')
  .replace(/^@(import|source).*$/gm, '')
const script = readFileSync(new URL('../src/dashboard/modules/controlsPanel.js', import.meta.url), 'utf8')
  .replace('export function', 'function')
const splitter = readFileSync(new URL('../src/dashboard/modules/detailSplitter.js', import.meta.url), 'utf8').replace('export function', 'function')
const main = readFileSync(new URL('../src/dashboard/main.js', import.meta.url), 'utf8')
const displayCode = main.slice(main.indexOf('function applyMeshDisplaySettings('), main.indexOf('async function loadMeshDisplaySettings('))
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1600, height: 1000 })
  await page.setRequestInterception(true)
  page.on('request', request => {
    if (request.isNavigationRequest()) request.respond({ contentType: 'text/html', body: html })
    else if (request.url().endsWith('/__api/file-manager-settings')) request.respond({ contentType: 'application/json', body: JSON.stringify({ sidebarWidthPercent: 55 }) })
    else request.abort()
  })
  const setup = async () => {
    await page.addStyleTag({ content: `* { box-sizing: border-box; } body { margin: 0; } ${css}` })
    await page.evaluate(() => {
      document.getElementById('statsStrip').innerHTML = ['Gesamt', 'Freigegeben', 'In Prüfung', 'Abgelehnt', 'Offen', 'Mit Problemen'].map(label => `<div class="stat-card"><span>${label}</span><strong>100</strong></div>`).join('')
      document.getElementById('productGrid').innerHTML = Array.from({ length: 60 }, (_, i) => `<div class="product-card" style="height:220px">Produkt ${i}</div>`).join('')
      document.getElementById('paginationBar').innerHTML = '<div class="pagination">Seite 1 von 3</div>'
      document.getElementById('btnShowroom').style.display = ''
      document.getElementById('detailTitle').textContent = 'Produkt mit langem Namen'
      document.getElementById('detailContent').innerHTML = `
        <div class="detail-mesh-drawer-content"><div class="detail-mesh-parts-list">
          <div class="detail-mesh-row">
            <label class="detail-mesh-inc"><input type="checkbox" checked></label>
            <span class="detail-mesh-name detail-mesh-name-trigger">LangerMeshNameOhneLeerzeichen_123456789012345678901234567890</span>
            <span class="detail-mesh-ral"><i class="detail-mesh-ral-chip"></i>RAL 9007</span>
            <span class="detail-mesh-v">12345678 V</span>
            <button class="detail-mesh-focus-btn">K</button>
            <div class="detail-mesh-full-name">LangerMeshNameOhneLeerzeichen_123456789012345678901234567890</div>
          </div>
        </div></div>
        <section class="detail-section"><div class="detail-section-title">Stammdaten</div>
          <div class="field-row"><label class="field-label">Artikelnummer</label><input class="field-value" value="12345678901234567890"></div>
          <div class="field-row"><label class="field-label">Kurztext</label><div class="field-value">LangerStammdatentextOhneLeerzeichen123456789012345678901234567890</div></div>
        </section>`
    })
    await page.addScriptTag({ content: script + '\ninitControlsPanel()' })
    await page.addScriptTag({ content: splitter + '\ninitDetailSplitter()' })
  }
  await page.goto('http://dashboard.test/')
  await setup()
  await page.addScriptTag({ content: 'let showMeshRal = true; function updateDetailMeshRowClasses() {}\n' + displayCode })
  for (const width of [25, 30, 34, 35, 45, 60]) {
    await page.evaluate(width => {

      document.getElementById('app').classList.add('detail-open')
      document.getElementById('detailPanel').classList.add('open')
      document.getElementById('detailPanel').style.transition = 'none'
    }, width)
    const handle = await page.$eval('.detail-splitter', el => { const b = el.getBoundingClientRect(); return { x: b.x + 5, y: 400 } })
    await page.mouse.move(handle.x, handle.y)
    await page.mouse.down()
    const currentWidth = await page.$eval('#detailPanel', el => el.getBoundingClientRect().width)
    await page.mouse.move(handle.x + currentWidth - 1600 * width / 100, handle.y, { steps: 8 })
    assert.equal(await page.$eval('html', el => el.classList.contains('detail-resizing')), true)
    const bounds = await page.evaluate(() => {
      const sidebar = document.getElementById('detailPanel').getBoundingClientRect()
      const content = document.querySelector('.main-content').getBoundingClientRect()
      return { width: sidebar.width, left: sidebar.left, right: content.right,
        cardsFit: [...document.querySelectorAll('.product-card')].every(card => card.getBoundingClientRect().right <= sidebar.left) }
    })
    await page.mouse.up()
    assert.equal(await page.$eval('html', el => el.classList.contains('detail-resizing')), false)
    assert.ok(Math.abs(bounds.width - 1600 * width / 100) < 1)
    assert.ok(bounds.right <= bounds.left && bounds.cardsFit)
    assert.deepEqual(await page.evaluate(() => {
      const panel = document.getElementById('detailPanel').getBoundingClientRect()
      return [...document.querySelectorAll('#detailContent *, .detail-footer, .detail-footer .btn')]
        .filter(el => {
          const box = el.getBoundingClientRect()
          return box.width && (box.right > panel.right + 1 || box.left < panel.left - 1 || el.scrollWidth > el.clientWidth + 1 && !el.matches('input') && getComputedStyle(el).overflowX !== 'hidden')
        }).map(el => el.className)
    }), [], 'Mesh, RAL, vertex count, fields and footer must fit the sidebar')
    await page.evaluate(() => {
      document.getElementById('detailPanel').classList.remove('open')
      document.getElementById('app').classList.remove('detail-open')
    })
    await page.reload()
    await setup()
    await page.evaluate(() => {
      document.getElementById('detailPanel').style.transition = 'none'
      document.getElementById('detailPanel').classList.add('open')
      document.getElementById('app').classList.add('detail-open')
    })
    assert.ok(Math.abs(await page.$eval('#detailPanel', el => el.getBoundingClientRect().width) - 1600 * width / 100) < 1, 'Saved width survives closing and reload')
  }
  await page.evaluate(() => {
    document.getElementById('app').classList.remove('detail-open')
    document.getElementById('detailPanel').classList.remove('open')
  })
  assert.ok(await page.$eval('.main-content', el => el.getBoundingClientRect().width >= 1590))
  await page.evaluate(() => {
    document.getElementById('searchInput').value = 'MP DSS'
    document.getElementById('sortSelect').value = 'shortTextDesc'
    window.scrollTo({ top: 900, behavior: 'instant' })
  })
  const geometry = () => page.evaluate(() => {
    const panel = document.getElementById('dashboardControls').getBoundingClientRect()
    const header = document.querySelector('.top-bar').getBoundingClientRect()
    const toggle = document.getElementById('dashboardControlsToggle').getBoundingClientRect()
    return { top: panel.top, headerBottom: header.bottom, height: panel.height, toggleBottom: toggle.bottom, toggleCenter: toggle.x + toggle.width / 2, panelCenter: panel.x + panel.width / 2 }
  })
  let box = await geometry()
  assert.ok(Math.abs(box.top - box.headerBottom) < 1)
  await page.click('#dashboardControlsToggle')
  await page.waitForFunction(() => document.getElementById('dashboardControls').getBoundingClientRect().height < 25)
  await page.evaluate(() => window.scrollTo({ top: 1600, behavior: 'instant' }))
  box = await geometry()
  assert.ok(Math.abs(box.top - box.headerBottom) < 1)
  assert.ok(box.height <= 24 && box.toggleBottom < 1000)
  assert.equal(box.toggleCenter, box.panelCenter)
  await page.click('#dashboardControlsToggle')
  await page.waitForFunction(() => document.getElementById('dashboardControls').getBoundingClientRect().height > 100)
  assert.deepEqual(await page.evaluate(() => [document.getElementById('searchInput').value, document.getElementById('sortSelect').value]), ['MP DSS', 'shortTextDesc'])
  await page.evaluate(() => document.getElementById('app').classList.add('detail-open'))
  box = await geometry()
  assert.ok(Math.abs(box.top - box.headerBottom) < 1)
  assert.equal(box.toggleCenter, box.panelCenter)
  await page.click('#dashboardControlsToggle')
  await page.reload()
  await setup()
  assert.equal(await page.$eval('#dashboardControlsToggle', el => el.getAttribute('aria-expanded')), 'false')
  await page.click('#dashboardControlsToggle')
  await page.reload()
  await setup()
  assert.equal(await page.$eval('#dashboardControlsToggle', el => el.getAttribute('aria-expanded')), 'true')
  await page.setViewport({ width: 900, height: 650 })
  await page.evaluate(() => document.getElementById('app').classList.add('detail-open'))
  await page.waitForFunction(() => document.getElementById('dashboardControlsToggle').getBoundingClientRect().bottom < innerHeight)
  assert.ok(await page.evaluate(() => {
    const main = document.querySelector('.main-content').getBoundingClientRect()
    return [...document.querySelectorAll('.product-card')].every(card => card.getBoundingClientRect().right <= main.right)
  }), 'Cards must fit the remaining width beside the sidebar')
  await page.setViewport({ width: 1600, height: 1000 })
  await page.reload()
  await setup()
  const loadStart = main.indexOf('async function loadMeshDisplaySettings(')
  const loader = main.slice(loadStart, main.indexOf('\n}', loadStart) + 2)
  await page.addScriptTag({ content: 'let showMeshRal = true; function updateDetailMeshRowClasses() {} const parseJsonResponse = res => res.json(); const log = console;\n' + displayCode + loader })
  await page.evaluate(async () => {
    await loadMeshDisplaySettings()
    document.getElementById('detailPanel').classList.add('open')
  })
  assert.ok(Math.abs(await page.$eval('#detailPanel', el => el.getBoundingClientRect().width) - 960) < 1, 'Reload must preserve local splitter width despite server settings')
  await page.$eval('#detailPanel', el => el.style.transition = 'none')
  const reset = await page.$eval('.detail-splitter', el => { const b = el.getBoundingClientRect(); return { x: b.x + 5, y: 400 } })
  await page.mouse.click(reset.x, reset.y, { clickCount: 2 })
  assert.ok(Math.abs(await page.$eval('#detailPanel', el => el.getBoundingClientRect().width) - 720) < 1)
  assert.equal(await page.evaluate(() => localStorage.getItem('mara.detailSidebarWidthPercent')), '45')
  await page.setViewport({ width: 1000, height: 800 })
  await page.focus('.detail-splitter')
  for (let i = 0; i < 25; i++) await page.keyboard.press('ArrowRight')
  assert.ok(Math.abs(await page.$eval('#detailPanel', el => el.getBoundingClientRect().width) - 250) < 1)
  for (const hideRal of [false, true]) {
    await page.$eval('#detailPanel', (el, hide) => el.classList.toggle('hide-mesh-ral', hide), hideRal)
    await page.$eval('.detail-mesh-ral', (el, hide) => { el.hidden = hide }, hideRal)
    assert.deepEqual(await page.evaluate(() => {
      const panel = document.getElementById('detailPanel').getBoundingClientRect()
      return [...document.querySelectorAll('#detailContent *, .detail-footer .btn')].filter(el => {
        const b = el.getBoundingClientRect()
        return b.width && (b.right > panel.right + 1 || b.left < panel.left || el.scrollWidth > el.clientWidth + 1 && !el.matches('input') && getComputedStyle(el).overflowX !== 'hidden')
      }).map(el => ({ cls: el.className, width: el.clientWidth, scroll: el.scrollWidth, grid: getComputedStyle(el).gridTemplateColumns, right: el.getBoundingClientRect().right }))
    }), [], '250px sidebar must fit with and without RAL display')
  }
  await page.reload()
  await setup()
  assert.equal(await page.$eval('.detail-splitter', el => el.getAttribute('aria-valuenow')), '25')
  console.log('Passed: six live splitter widths, cards fit, local persistence across reload, settings do not override width, double-click reset, sticky controls and small viewport.')
} finally { await browser.close() }
