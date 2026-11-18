import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'
import puppeteer from 'puppeteer-core'

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
const start = main.indexOf('    fitView(event) {')
const method = main.slice(start, main.indexOf('\n    },', start) + 7)
const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
  import * as THREE from 'three';
  import CameraController from './src/showroom/CameraController.js';
  import { isFitViewShortcut, getVisibleProductBounds } from './src/showroom/fitToView.js';
  const root = new THREE.Group(); root.position.set(4, 2, -3); root.rotation.y = .7;
  const part = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 1), new THREE.MeshBasicMaterial());
  root.add(part);
  const other = part.clone(); other.position.x = 15; root.add(other);
  const PRIMARY_ZONE = 'zone-2';
  const ProductPlacement = { getPlacement: () => ({ group: root }) };
  const app = { selectedCameraId: 'test', ${method} };
  window.addEventListener('keydown', event => app.fitView(event));
  function tick() { CameraController.update(); requestAnimationFrame(tick) } tick();
  window.test = { root, part, other, controller: CameraController, app, getVisibleProductBounds };
` }, bundle: true, format: 'iife', outfile: 'fit-view-test.js', write: false })
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1200, height: 800 })
  await page.setRequestInterception(true)
  page.on('request', req => req.respond({ contentType: req.url().includes('__api') ? 'application/json' : 'text/html', body: req.url().includes('__api') ? '{}' : '<div id="canvas-container" style="position:absolute;left:300px;top:0;width:800px;height:700px"></div><input id="search"><textarea id="text"></textarea><div id="editor" contenteditable>Text</div>' }))
  await page.goto('http://fit-view.test/')
  await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.css')).text })
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text })
  const original = await page.evaluate(() => ({ position: test.root.position.toArray(), quaternion: test.root.quaternion.toArray(), scale: test.root.scale.toArray(), vertices: [...test.part.geometry.attributes.position.array] }))
  for (const isolated of [false, true]) {
    await page.evaluate(isolated => {
      test.other.visible = !isolated
      test.controller.camera.position.set(-12, 13, 17)
      test.controller.controls.target.set(10, 7, -9)
      test.controller.controls.update()
    }, isolated)
    await page.keyboard.press('f')
    await page.waitForFunction(() => test.app.selectedCameraId === 'orbit' && !test.controller._fitting)
    assert.ok(await page.evaluate(() => {
      const c = test.controller, box = test.getVisibleProductBounds(test.root, c.camera)
      c.camera.updateMatrixWorld(true)
      const center = box.getCenter(c.controls.target.clone())
      if (center.distanceTo(c.controls.target) > 1e-6) return false
      for (const x of [box.min.x,box.max.x]) for (const y of [box.min.y,box.max.y]) for (const z of [box.min.z,box.max.z]) {
        const point = center.clone().set(x,y,z).project(c.camera)
        if (Math.abs(point.x) > .9 || Math.abs(point.y) > .9 || Math.abs(point.z) > 1) return false
      }
      return true
    }))
  }
  for (const selector of ['#search', '#text', '#editor']) {
    await page.focus(selector)
    await page.evaluate(() => { test.app.selectedCameraId = 'editing' })
    await page.keyboard.press('f')
    assert.equal(await page.evaluate(() => test.app.selectedCameraId), 'editing')
  }
  await page.evaluate(() => document.activeElement.blur())
  await page.$eval('[aria-label="Unten"]', el => el.click())
  await page.waitForFunction(() => test.controller.camera.position.clone().sub(test.controller.controls.target).normalize().y < -.9999)
  await page.keyboard.press('f')
  await page.waitForFunction(() => !test.controller._fitting && test.app.selectedCameraId === 'orbit')
  assert.ok(await page.evaluate(() => test.controller.camera.position.clone().sub(test.controller.controls.target).normalize().y < -.9999))
  await page.$eval('[aria-label="Vorne"]', el => el.click())
  await page.waitForFunction(() => test.controller.camera.position.clone().sub(test.controller.controls.target).normalize().z > .9999)
  const after = await page.evaluate(() => ({ position: test.root.position.toArray(), quaternion: test.root.quaternion.toArray(), scale: test.root.scale.toArray(), vertices: [...test.part.geometry.attributes.position.array] }))
  assert.deepEqual(after, original)
  console.log('Passed: real CameraController + F handler, whole/isolated product, edited view, text fields, ViewCube bottom/F/front and unchanged model.')
} finally { await browser.close() }
