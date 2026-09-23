import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import connect from 'connect'
import { registerHooks } from 'node:module'
const hooks = registerHooks({ load(url, context, next) {
  return next(url, url.endsWith('.json') ? { ...context, importAttributes: { type: 'json' } } : context)
} })
const { registerDashboardApi } = await import('../scripts/vite-plugin/dashboardApi.mjs')
hooks.deregister()

test('STEP HTTP upload archives, persists references, confirms collision and blocks old delete endpoint', async t => {
  const root = await fs.mkdtemp(join(tmpdir(), 'showroom-step-api-'))
  const archiveRoot = join(root, 'archive')
  await fs.mkdir(join(root, 'src/data'), { recursive: true })
  await fs.mkdir(join(root, 'public'), { recursive: true })
  await fs.writeFile(join(root, 'src/data/products.json'), JSON.stringify({ products: [] }))
  await fs.writeFile(join(root, 'src/data/cad-index.json'), JSON.stringify({ objDir: '/models/legacy', productCadFiles: { fixture: ['old.stp'] } }))
  const app = connect()
  registerDashboardApi(app, { root, watchProducts: false, stepArchiveRoot: archiveRoot })
  const server = createServer(app)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    await fs.rm(root, { recursive: true, force: true })
  })
  const origin = `http://127.0.0.1:${server.address().port}`
  const upload = (name, body, overwrite = false) => fetch(`${origin}/__api/upload-cad`, {
    method: 'POST', headers: { Origin: origin, 'X-Filename': `fixture/${name}`, 'X-Product-Id': 'fixture',
      'X-Product-Template': encodeURIComponent(JSON.stringify({ name: 'Produkt fixture', glbFile: '/unchanged.glb', previewImage: '/unchanged.png' })),
      ...(overwrite ? { 'X-Overwrite': '1' } : {}) }, body,
  })
  let response = await upload('old.stp', 'FIRST')
  assert.equal(response.status, 200, await response.clone().text())
  assert.equal((await response.json()).archived, 0)
  response = await upload('new.step', 'SECOND')
  assert.equal(response.status, 200, await response.clone().text())
  assert.equal((await response.json()).archived, 1)
  assert.equal(await fs.readFile(join(archiveRoot, 'fixture/old.stp'), 'utf8'), 'FIRST')
  response = await upload('new.step', 'THIRD')
  assert.equal(response.status, 409)
  assert.equal(await fs.readFile(join(root, 'public/models/products/fixture/new.step'), 'utf8'), 'SECOND')
  response = await upload('new.step', 'THIRD', true)
  assert.equal(response.status, 200, await response.clone().text())
  assert.equal(await fs.readFile(join(archiveRoot, 'fixture/new.step'), 'utf8'), 'SECOND')
  const product = JSON.parse(await fs.readFile(join(root, 'src/data/products.json'), 'utf8')).products[0]
  assert.deepEqual(product.cadFiles, ['/models/products/fixture/new.step'])
  assert.equal(product.glbFile, '/unchanged.glb')
  assert.equal(product.previewImage, '/unchanged.png')
  const loaded = await (await fetch(`${origin}/__api/products/fixture`)).json()
  assert.deepEqual(loaded.cadFiles, ['/models/products/fixture/new.step'])
  response = await fetch(`${origin}/__api/delete-uploaded-cad`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ path: product.cadFiles[0] }) })
  assert.equal(response.status, 400)
  assert.equal(await fs.readFile(join(root, 'public/models/products/fixture/new.step'), 'utf8'), 'THIRD')
  const log = await fs.readFile(join(root, 'logs/step-replacements.jsonl'), 'utf8')
  assert.ok(log.includes('erfolgreich'))
})
