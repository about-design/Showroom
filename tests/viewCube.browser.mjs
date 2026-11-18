import assert from 'node:assert/strict'
import { build } from 'esbuild'
import puppeteer from 'puppeteer-core'

const bundle = await build({
  stdin: { resolveDir: process.cwd(), contents: `
    import * as THREE from 'three';
    import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
    import { createViewCube } from './src/showroom/ViewCube.js';
    import { applyViewCubeSettings, getViewCubeSettings } from './src/lib/viewCubeSettings.js';
    const wrap = document.getElementById('preview');
    const canvas = wrap.querySelector('canvas');
    const camera = new THREE.PerspectiveCamera(35, 1, .01, 100);
    camera.position.set(3, 2, 5);
    const controls = new OrbitControls(camera, canvas);
    controls.target.set(.2, .4, .1);
    controls.maxPolarAngle = Math.PI / 2 - .1;
    controls.update();
    const cube = createViewCube(wrap, camera, controls);
    window.test = { camera, controls, cube, applyViewCubeSettings, getViewCubeSettings };
  ` },
  bundle: true, format: 'iife', outfile: 'viewcube-test.js', write: false,
})
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text
const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1200, height: 800 })
  await page.setRequestInterception(true)
  page.on('request', request => request.respond({ contentType: 'text/html', body: '<div id="preview" style="position:relative;width:300px;height:280px"><canvas width="300" height="280" style="width:100%;height:100%"></canvas></div>' }))
  const setup = async () => {
    await page.addStyleTag({ content: css })
    await page.addScriptTag({ content: js })
  }
  await page.goto('http://viewcube.test/')
  await setup()
  assert.deepEqual(await page.evaluate(() => test.getViewCubeSettings()), { showViewCube: true, viewCubePosition: 'right' })
  assert.equal(await page.$$eval('[data-direction]', buttons => new Set(buttons.map(b => b.dataset.direction)).size), 26)
  const baseline = await page.evaluate(() => ({ target: test.controls.target.toArray(), radius: test.camera.position.distanceTo(test.controls.target), fov: test.camera.fov }))
  for (const [name, direction] of [['Vorne', [0,0,1]], ['Hinten', [0,0,-1]], ['Links', [-1,0,0]], ['Rechts', [1,0,0]], ['Oben', [0,1,0]], ['Unten', [0,-1,0]]]) {
    await page.$eval(`[aria-label="${name}"]`, el => el.click())
    await page.waitForFunction(direction => {
      const v = test.camera.position.clone().sub(test.controls.target).normalize().toArray()
      return v.every((x, i) => Math.abs(x - direction[i]) < .001)
    }, {}, direction)
    const actual = await page.evaluate(() => ({ target: test.controls.target.toArray(), radius: test.camera.position.distanceTo(test.controls.target), fov: test.camera.fov }))
    assert.deepEqual(actual.target, baseline.target)
    assert.ok(Math.abs(actual.radius - baseline.radius) < 1e-6)
    assert.equal(actual.fov, baseline.fov)
  }
  for (const direction of ['1,1,1', '1,0,1']) {
    await page.$eval(`[data-direction="${direction}"]`, el => el.click())
    await page.waitForFunction(direction => {
      const goal = direction.split(',').map(Number), length = Math.hypot(...goal)
      return test.camera.position.clone().sub(test.controls.target).normalize().toArray().every((x, i) => Math.abs(x - goal[i] / length) < .001)
    }, {}, direction)
  }
  const before = await page.$eval('.view-cube-solid', el => el.style.transform)
  await page.mouse.move(140, 170)
  await page.mouse.down()
  await page.mouse.move(200, 210, { steps: 8 })
  await page.mouse.up()
  assert.notEqual(await page.$eval('.view-cube-solid', el => el.style.transform), before)
  assert.equal(await page.evaluate(() => test.controls.maxPolarAngle), Math.PI / 2 - .1)
  for (const width of [250, 350, 450, 600]) for (const position of ['left', 'center', 'right']) {
    await page.evaluate(({ width, position }) => {
      document.getElementById('preview').style.width = width + 'px'
      test.applyViewCubeSettings({ showViewCube: true, viewCubePosition: position })
    }, { width, position })
    const box = await page.evaluate(() => {
      const p = document.getElementById('preview').getBoundingClientRect(), c = document.querySelector('.view-cube').getBoundingClientRect()
      return { left: c.left - p.left, right: p.right - c.right, center: c.left + c.width / 2 - p.left - p.width / 2, width: c.width, height: c.height, top: c.top - p.top, bottom: p.bottom - c.bottom }
    })
    assert.ok(box.left >= 0 && box.right >= 0)
    assert.equal(box.width, 110)
    assert.equal(box.height, 110)
    assert.equal(box.top, 8)
    assert.ok(box.bottom >= 0)
    assert.ok(Math.abs(position === 'center' ? box.center : box[position] - 8) < 1)
  }
  await page.evaluate(() => test.applyViewCubeSettings({ showViewCube: false, viewCubePosition: 'left' }))
  assert.equal(await page.$eval('.view-cube', el => el.hidden), true)
  await page.reload(); await setup()
  assert.deepEqual(await page.evaluate(() => test.getViewCubeSettings()), { showViewCube: false, viewCubePosition: 'left' })
  await page.evaluate(() => test.applyViewCubeSettings({ showViewCube: true, viewCubePosition: 'center' }))
  assert.equal(await page.$eval('.view-cube', el => el.hidden), false)
  const sibling = await browser.newPage()
  await sibling.setRequestInterception(true)
  sibling.on('request', request => request.respond({ contentType: 'text/html', body: '<p>Settings</p>' }))
  await sibling.goto('http://viewcube.test/settings')
  await sibling.evaluate(() => localStorage.setItem('mara.viewCubeSettings', JSON.stringify({ showViewCube: false, viewCubePosition: 'right' })))
  await page.waitForFunction(() => document.querySelector('.view-cube').hidden)
  await sibling.close()
  await page.evaluate(() => test.applyViewCubeSettings({ showViewCube: true, viewCubePosition: 'right' }))
  // A real pointer click must hit the visible front face, without starting the model orbit.
  await page.$eval('[aria-label="Vorne"]', el => el.click())
  await page.waitForFunction(() => Math.abs(test.camera.position.clone().sub(test.controls.target).normalize().z - 1) < .00001)
  await page.click('[aria-label="Vorne"]')
  assert.equal(await page.evaluate(() => test.controls.maxPolarAngle), Math.PI)
  const ratios = await page.evaluate(() => {
    const root = document.querySelector('.view-cube')
    const selectors = ['.view-cube-solid', '[aria-label="Vorne"]', '[aria-label="Vorne: oben links"]']
    const sizes = () => selectors.map(s => { const b = document.querySelector(s).getBoundingClientRect(); return [b.width, b.height] })
    const enlarged = sizes()
    root.style.setProperty('--view-cube-scale', '1')
    const original = sizes()
    root.style.removeProperty('--view-cube-scale')
    return enlarged.flatMap((size, i) => size.map((v, axis) => v / original[i][axis]))
  })
  assert.ok(ratios.every(ratio => Math.abs(ratio - 1.25) < .001), 'Cube, label and corner hit area scale together')
  for (const direction of ['1,1,1', '1,0,1']) {
    await page.$eval('[aria-label="Vorne"]', el => el.click())
    await page.waitForFunction(() => test.camera.position.clone().sub(test.controls.target).normalize().z > .999999)
    await page.click(`[data-direction="${direction}"]`)
    await page.waitForFunction(direction => {
      const goal = direction.split(',').map(Number), length = Math.hypot(...goal)
      return test.camera.position.clone().sub(test.controls.target).normalize().toArray().every((v, i) => Math.abs(v - goal[i] / length) < .001)
    }, {}, direction)
  }
  await page.$eval('[data-direction="1,1,1"]', el => el.click())
  await page.waitForFunction(() => Math.abs(test.camera.position.clone().sub(test.controls.target).normalize().y - 1 / Math.sqrt(3)) < .00001)
  if (process.env.VIEWCUBE_SCREENSHOT) await page.screenshot({ path: process.env.VIEWCUBE_SCREENSHOT })
  await page.evaluate(() => test.cube.dispose())
  assert.equal(await page.$('.view-cube'), null)
  console.log('Passed: 26 directions, six main views, corner/edge, camera invariants, manual orbit sync, limits restored, positions/resizing, visibility, persistence and disposal.')
} finally { await browser.close() }
