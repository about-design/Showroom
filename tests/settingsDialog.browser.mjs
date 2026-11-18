import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'

const html = readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
  .replace(/<link\b[^>]*>/g, '')
const css = readFileSync(new URL('../src/dashboard/dashboard.css', import.meta.url), 'utf8')
  .replace(/^@(import|source).*$/gm, '')
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const page = await browser.newPage()
  await page.setContent(html)
  await page.addStyleTag({ content: `* { box-sizing: border-box; } body { margin: 0; } ${css}` })
  await page.evaluate(() => {
    const modal = document.getElementById('fileManagerSettingsModal')
    modal.classList.add('open')
    modal.setAttribute('aria-hidden', 'false')
    document.getElementById('freeCommanderPathRow').hidden = false
    window.clicked = []
    for (const id of ['fileManagerSettingsCancel', 'fileManagerSettingsSave']) {
      document.getElementById(id).addEventListener('click', () => window.clicked.push(id))
    }
  })
  const measure = () => page.evaluate(() => {
    const rect = selector => {
      const el = document.querySelector(selector), b = el.getBoundingClientRect()
      return { top: b.top, bottom: b.bottom, height: b.height, scrollTop: el.scrollTop }
    }
    return {
      panel: rect('.file-manager-settings-panel'),
      header: rect('#fileManagerSettingsModal .name-rules-modal-header'),
      body: rect('.file-manager-settings-body'),
      footer: rect('#fileManagerSettingsModal .name-rules-modal-actions'),
      buttonsReachable: ['fileManagerSettingsCancel', 'fileManagerSettingsSave'].every(id => {
        const el = document.getElementById(id), b = el.getBoundingClientRect()
        return b.top >= 0 && b.bottom <= innerHeight && el.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2))
      }),
    }
  })
  for (const extraSections of [false, true]) {
    if (extraSections) await page.evaluate(() => {
      const body = document.querySelector('.file-manager-settings-body')
      for (let i = 0; i < 15; i++) {
        const section = document.createElement('section')
        section.className = 'file-manager-settings-section'
        section.innerHTML = `<h3>Weitere Einstellungen ${i}</h3><label>Option <input type="text"></label>`
        body.append(section)
      }
    })
    for (const [width, height] of [[1440, 1000], [1440, 400], [800, 320], [390, 500], [700, 240]]) {
      await page.setViewport({ width, height })
      await page.$eval('.file-manager-settings-body', el => { el.scrollTop = 0 })
      const before = await measure()
      assert.ok(before.panel.top >= 0 && before.panel.bottom <= height, `Dialog fits ${width}x${height}`)
      assert.ok(before.body.height > 0 && before.header.bottom <= before.body.top + 1 && before.body.bottom <= before.footer.top + 1)
      assert.ok(before.buttonsReachable)
      await page.$eval('.file-manager-settings-body', el => { el.scrollTop = el.scrollHeight })
      const after = await measure()
      if (extraSections || height <= 500) assert.ok(after.body.scrollTop > 0)
      assert.deepEqual(after.header, before.header, 'Header stays fixed')
      assert.deepEqual(after.footer, before.footer, 'Footer stays fixed')
      assert.equal(after.panel.scrollTop, 0, 'Only the body scrolls')
      assert.ok(after.buttonsReachable)
      assert.ok(await page.$eval('.file-manager-settings-body', el => {
        const body = el.getBoundingClientRect(), last = el.lastElementChild.getBoundingClientRect()
        return last.bottom <= body.bottom + 1
      }), 'Last settings section is reachable')
      await page.click('#fileManagerSettingsCancel')
      await page.click('#fileManagerSettingsSave')
    }
  }
  assert.equal(await page.evaluate(() => window.clicked.length), 20)
  console.log('Passed: normal/reduced/mobile heights down to 240px, fixed header/footer, scrolling body, future sections and reachable action buttons.')
} finally { await browser.close() }
