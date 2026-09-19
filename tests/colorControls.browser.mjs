import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewport({ width: 1440, height: 900 })
  const url = process.env.SHOWROOM_TEST_URL || 'http://localhost:5050/'
  await page.goto(url, { waitUntil: 'networkidle2' })
  const ready = () => page.waitForFunction(() => document.querySelector('.sr-color-controls')?.style.bottom && document.querySelectorAll('.sr-color-btn').length > 0 && document.querySelector('#ui-layer')?._x_dataStack?.[0]?.isLoading === false && getComputedStyle(document.querySelector('.sr-loading')).display === 'none')
  await ready()
  const initial = await page.evaluate(() => {
    const app = document.querySelector('#ui-layer')._x_dataStack[0]
    return { color: app.currentColor, filter: app.colorFilter, buttons: document.querySelectorAll('.sr-color-btn').length }
  })
  for (const [width, height] of [[1440,900], [1000,600], [390,700], [700,500]]) {
    await page.setViewport({width, height})
    await page.waitForFunction(() => {
      const p = document.querySelector('.sr-color-controls').getBoundingClientRect(), v = document.getElementById('canvas-container').getBoundingClientRect()
      return p.left >= v.left - 1 && p.right <= v.right + 1 && p.bottom <= v.bottom + 1
    })
    const bottom = await page.$eval('.sr-color-controls', el => el.getBoundingClientRect().bottom)
    assert.equal(await page.$eval('.sr-color-toggle', el => el.textContent), '▼')
    await page.click('.sr-color-toggle')
    assert.equal(await page.$eval('.sr-color-toggle', el => el.textContent), '▲')
    assert.equal(await page.$eval('.sr-color-toggle', el => el.getAttribute('aria-expanded')), 'false')
    const compact = await page.$eval('.sr-color-controls', el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height, bottom: el.getBoundingClientRect().bottom, hidden: el.querySelector('.sr-color-controls-body').hidden }))
    assert.ok(compact.hidden && compact.width <= 42 && compact.height <= 30)
    assert.ok(Math.abs(compact.bottom - bottom) < 1)
    await page.reload({waitUntil:'networkidle2'}); await ready()
    assert.equal(await page.$eval('.sr-color-toggle', el => el.textContent), '▲')
    await page.click('.sr-color-toggle')
    assert.equal(await page.$eval('.sr-color-toggle', el => el.getAttribute('aria-expanded')), 'true')
    assert.equal(await page.$eval('.sr-color-controls-body', el => el.hidden), false)
    await page.reload({waitUntil:'networkidle2'}); await ready()
    assert.equal(await page.$eval('.sr-color-toggle', el => el.textContent), '▼')
  }
  // A legacy top preference no longer moves the controls.
  await page.evaluate(() => localStorage.setItem('mara.colorControlsPosition', 'top'))
  await page.setViewport({width:1440,height:900})
  await page.reload({waitUntil:'networkidle2'}); await ready()
  assert.ok(await page.$eval('.sr-color-controls', el => Math.abs(el.getBoundingClientRect().bottom - (innerHeight - 20)) < 1))
  assert.ok(await page.evaluate(() => document.elementFromPoint(850,500)?.tagName === 'CANVAS'))
  const after = await page.evaluate(() => {
    const app = document.querySelector('#ui-layer')._x_dataStack[0]
    return { color: app.currentColor, filter: app.colorFilter, buttons: document.querySelectorAll('.sr-color-btn').length }
  })
  assert.deepEqual(after, initial)
  assert.deepEqual(errors, [])
  console.log('Passed: collapse/expand, compact handle, stable bottom anchor, four viewport sizes, both persisted states, legacy top preference ignored, unchanged colors and canvas hit testing.')
} finally { await browser.close() }
