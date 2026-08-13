/**
 * Headless PNG der Dashboard-Karten-Vorschau (Puppeteer + Vite-Seite
 * /src/thumbnail/dashboardThumbCapture.html).
 */
import { createLogger } from '../lib/logger.mjs'
const log = createLogger("headlessThumbnail")


import { writeFile } from 'fs/promises'

let browser = null
let page = null

const CAPTURE_PATH = '/src/thumbnail/dashboardThumbCapture.html'

/** Rennt gegen ein Timeout, damit ein hängender page.close()/browser.close() (z. B. nach
 *  kaputter CDP-Verbindung) einen Batch-Lauf nicht für immer blockiert. */
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ])
}

async function resolveChromePath() {
  const fromEnv = String(process.env.PUPPETEER_EXECUTABLE_PATH || '').trim()
  if (fromEnv) return fromEnv
  try {
    const { getChromePath } = await import('chrome-launcher')
    if (typeof getChromePath === 'function') return getChromePath()
  } catch {
    /* Chrome nicht installiert / nicht gefunden */
  }
  return null
}

export async function closeThumbnailBrowser() {
  try {
    if (page) {
      await withTimeout(page.close(), 5000)
    }
  } catch {
    /* ignore */
  }
  page = null
  try {
    if (browser) {
      await withTimeout(browser.close(), 5000)
    }
  } catch {
    /* ignore */
  }
  browser = null
}

/**
 * @param {object} opts
 * @param {string} opts.serverOrigin z. B. http://127.0.0.1:5050
 * @param {string} opts.glbUrl vollständige URL zum GLB (gleicher Host wie serverOrigin)
 * @param {object} opts.product products.json-Eintrag (wird serialisiert)
 * @param {string} opts.outAbsPath absoluter Pfad zur PNG-Datei
 * @param {number} [opts.width]
 * @param {number} [opts.height]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<boolean>}
 */
export async function captureDashboardThumbnailPng({
  serverOrigin,
  glbUrl,
  product,
  outAbsPath,
  width = 640,
  height = 400,
  timeoutMs = 25000,
}) {
  try {
    const executablePath = await resolveChromePath()
    if (!executablePath) {
      log.warn(
        'Kein Chrome/Chromium (PUPPETEER_EXECUTABLE_PATH oder chrome-launcher). PNG übersprungen.',
      )
      return false
    }

    const origin = String(serverOrigin || '').replace(/\/$/, '')
    if (!origin || !/^https?:\/\//i.test(origin)) {
            log.scoped("thumbnail").warn("Ungültiger serverOrigin:", serverOrigin)
      return false
    }

    const puppeteer = await import('puppeteer-core')

    if (!browser) {
      browser = await puppeteer.default.launch({
        headless: true,
        executablePath,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--enable-webgl',
          '--ignore-gpu-blocklist',
          '--use-angle=swiftshader',
          '--window-size=1280,800',
        ],
      })
    }
    if (!page) {
      page = await browser.newPage()
      await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 })
    }

    const captureUrl = `${origin}${CAPTURE_PATH}`
    await page.goto(captureUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
    await page.waitForFunction(() => window.__thumbReady === true, { timeout: 15000 })

    const productJson = JSON.stringify(product ?? {})
    const dataUrl = await page.evaluate(
      async ({ glbUrl: u, productJson: pj, width: ww, height: hh }) => {
        if (typeof window.renderDashboardThumbnail !== 'function') return null
        return await window.renderDashboardThumbnail({
          glbUrl: u,
          productJson: pj,
          width: ww,
          height: hh,
        })
      },
      { glbUrl, productJson, width, height },
    )

    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png')) {
      return false
    }
    const b64 = dataUrl.replace(/^data:image\/png;base64,/, '')
    await writeFile(outAbsPath, Buffer.from(b64, 'base64'))
    return true
  } catch (e) {
        log.scoped("thumbnail").warn("captureDashboardThumbnailPng:", e?.message || e)
    // Browser/Seite können nach einem Navigations-/Kontextfehler in einem kaputten
    // Zustand hängen bleiben (z. B. "Execution context was destroyed") — sonst würden
    // alle Folgeaufrufe im selben Prozess kaskadierend fehlschlagen oder sogar hängen
    // (close() selbst kann blockieren, daher mit Timeout).
    await closeThumbnailBrowser()
    return false
  }
}
