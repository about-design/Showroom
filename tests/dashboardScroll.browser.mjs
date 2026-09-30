import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'

const html = readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
  .replace(/<link\b[^>]*>/g, '')
const css = readFileSync(new URL('../src/dashboard/dashboard.css', import.meta.url), 'utf8')
  .replace(/^@(import|source).*$/gm, '')
const controls = readFileSync(new URL('../src/dashboard/modules/controlsPanel.js', import.meta.url), 'utf8')
  .replace('export function', 'function')
const splitter = readFileSync(new URL('../src/dashboard/modules/detailSplitter.js', import.meta.url), 'utf8')
  .replace('export function', 'function')

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  await page.setContent(html)
  await page.addStyleTag({ content: css })
  await page.evaluate(() => {
    document.querySelector('#app').classList.add('detail-open')
    document.querySelector('#detailPanel').classList.add('open')
    document.querySelector('#detailPanel').style.transition = 'none'
    document.querySelector('#productGrid').innerHTML = Array.from({ length: 48 }, (_, i) =>
      `<div class="product-card" style="height:180px">Produkt ${i}</div>`).join('')
    document.querySelector('#detailContent').innerHTML = `<div style="height:180px;background:#ddd">3D-Vorschau</div>${
      Array.from({ length: 35 }, (_, i) => `<section class="detail-section" style="height:90px">Detail ${i}</section>`).join('')}`
  })
  await page.addScriptTag({ content: controls + '\ninitControlsPanel()' })
  await page.addScriptTag({ content: splitter + '\ninitDetailSplitter()' })

  async function check(label) {
    const state = await page.evaluate(() => {
      const get = selector => document.querySelector(selector)
      const box = selector => { const r = get(selector).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom } }
      const rootScroll = document.scrollingElement
      const active = [document.documentElement, document.body, ...document.querySelectorAll('#app, .main-content, #productScroll, #detailPanel, #detailContent')]
        .filter(el => el.scrollHeight > el.clientHeight + 1 && ['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
        .map(el => el.id || el.className || el.tagName)
      return { active, rootHeight: rootScroll.scrollHeight, viewportHeight: innerHeight,
        cards: box('#productScroll'), main: box('.main-content'), sidebar: box('#detailPanel'), details: box('#detailContent'),
        splitter: box('.detail-splitter') }
    })
    console.log(label, state)
    assert.deepEqual(state.active, ['productScroll', 'detailContent'], `${label}: actual scroll elements`)
    assert.ok(state.rootHeight <= state.viewportHeight + 1, `${label}: page must not scroll`)
    assert.ok(Math.abs(state.cards.right - state.main.right) < 1, `${label}: cards reach splitter`)
    assert.ok(Math.abs(state.cards.right - state.sidebar.left) < 2, `${label}: cards and sidebar adjacent`)
    assert.ok(Math.abs(state.details.right - 1440) < 1, `${label}: sidebar scrollbar at viewport edge`)
    assert.ok(state.splitter.left >= state.cards.right - 1 && state.splitter.right <= state.sidebar.left + 11, `${label}: splitter geometry`)
  }

  await check('initial')
  const cards = await page.$('#productScroll')
  const details = await page.$('#detailContent')
  await cards.hover()
  await page.mouse.wheel({ deltaY: 440 })
  await new Promise(resolve => setTimeout(resolve, 150))
  let positions = await page.evaluate(() => [document.querySelector('#productScroll').scrollTop, document.querySelector('#detailContent').scrollTop])
  assert.ok(positions[0] > 0 && positions[1] === 0, 'wheel over cards scrolls only cards')
  const cardPosition = positions[0]
  await details.hover()
  await page.mouse.wheel({ deltaY: 440 })
  await new Promise(resolve => setTimeout(resolve, 150))
  positions = await page.evaluate(() => [document.querySelector('#productScroll').scrollTop, document.querySelector('#detailContent').scrollTop])
  assert.ok(positions[0] === cardPosition && positions[1] > 0, 'wheel over sidebar scrolls only sidebar')
  await page.evaluate(() => document.querySelector('#dashboardControlsToggle').click())
  await new Promise(resolve => setTimeout(resolve, 220))
  await check('controls collapsed')
  await page.evaluate(() => document.querySelector('#dashboardControlsToggle').click())
  await new Promise(resolve => setTimeout(resolve, 220))
  await check('controls expanded')
  await page.focus('.detail-splitter')
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowLeft')
  await check('sidebar resized')
  console.log('Dashboard scroll layout: OK')
} finally {
  await browser.close()
}
