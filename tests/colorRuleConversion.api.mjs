import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { Readable } from 'node:stream'
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import { Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import draco from 'draco3dgltf'
import { colorRulesAreConverted } from '../src/lib/colorRuleConversion.js'

const root = await mkdtemp(join(tmpdir(), 'mara-color-conversion-'))
process.env.LOG_DIR = join(root, 'logs')
try {
  // Match Vite's JSON imports when exercising the real API directly under Node.
  const hooks = registerHooks({ load(url, context, next) {
    if (url.includes('/src/data/') && url.endsWith('.json')) return { format: 'module', source: `export default ${readFileSync(new URL(url), 'utf8')}`, shortCircuit: true }
    return next(url, context)
  } })
  const { registerDashboardApi } = await import('../scripts/vite-plugin/dashboardApi.mjs')
  hooks.deregister()
  for (const dir of ['src/data', 'scripts', 'public/models/output']) await mkdir(join(root, dir), { recursive: true })
  const productsPath = join(root, 'src/data/products.json')
  await writeFile(productsPath, JSON.stringify({ products: [{ id: 'fixture', name: 'Fixture', shortText: 'Fixture', defaultColor: 'RAL 7035', glbFile: '/models/output/fixture.glb', conversionPreset: { nameColorRules: [] } }] }))
  await writeFile(join(root, 'public/mtl-ral-color-mapping.json'), JSON.stringify({ nameColorRules: [] }))
  await writeFile(join(root, 'src/data/ralColors.json'), await readFile(new URL('../src/data/ralColors.json', import.meta.url)))
  const bakeWrapper = join(root, 'scripts/bake-glb-yup.js')
  const actualBake = new URL('../scripts/bake-glb-yup.js', import.meta.url).href
  await writeFile(bakeWrapper, `import(${JSON.stringify(actualBake)})`)
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco.createDecoderModule() })
  const doc = new Document(), buffer = doc.createBuffer()
  const positions = doc.createAccessor().setType('VEC3').setArray(new Float32Array([0,0,0, 1,0,0, 0,1,0])).setBuffer(buffer)
  const material = doc.createMaterial('original').setBaseColorFactor([1,0,0,1])
  const mesh = doc.createMesh('Teil').addPrimitive(doc.createPrimitive().setAttribute('POSITION', positions).setMaterial(material))
  doc.createScene().addChild(doc.createNode('Teil').setMesh(mesh))
  const glb = join(root, 'public/models/output/fixture.glb')
  await io.write(glb, doc)
  const routes = new Map()
  registerDashboardApi({ use: (path, handler) => { if (typeof path === 'string') routes.set(path, handler) } }, { root, serverOrigin: 'invalid-origin', watchProducts: false })
  const call = (path, method, body, url = '/') => new Promise((resolve, reject) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))])
    Object.assign(req, { method, url, headers: {} })
    const res = { statusCode: 200, setHeader() {}, end(text) { resolve({ status: this.statusCode, data: JSON.parse(text) }) } }
    Promise.resolve(routes.get(path)(req, res)).catch(reject)
  })
  const load = async () => JSON.parse(await readFile(productsPath, 'utf8')).products[0]
  const rule = { target: 'mesh', pattern: 'Teil', ral: 'RAL 7035', finish: 'pulver' }
  const patch = rules => call('/__api/products', 'PATCH', { conversionPreset: { nameColorRules: rules } }, '/fixture')
  const register = rules => call('/__api/register-converted', 'POST', { productId: 'fixture', outputPaths: [glb], conversionPreset: { nameColorRules: rules }, conversionStatus: 'completed' })
  await patch([rule])
  assert.equal(colorRulesAreConverted(await load(), [rule]), false)
  const success = await register([rule])
  assert.equal(success.status, 200, JSON.stringify(success.data))
  assert.equal(colorRulesAreConverted(await load(), [rule]), true)
  const baked = await io.read(glb)
  assert.notDeepEqual(baked.getRoot().listMaterials()[0].getBaseColorFactor(), [1,0,0,1], 'Real bake must update GLB color')
  const changed = { ...rule, ral: 'RAL 9007', finish: 'verzinkt' }
  await patch([changed])
  assert.equal(colorRulesAreConverted(await load(), [changed]), false)
  // Simulate an old running conversion completing after a newer edit was saved.
  await register([rule])
  assert.deepEqual((await load()).conversionPreset.nameColorRules, [changed])
  assert.equal(colorRulesAreConverted(await load(), [changed]), false)
  await writeFile(bakeWrapper, 'process.exit(1)')
  const failure = await register([changed])
  assert.ok(failure.data.warnings.some(w => w.reason === 'color-rule-bake-failed'))
  assert.equal(colorRulesAreConverted(await load(), [changed]), false)
  await patch([])
  assert.equal((await load())._colorRulesDirty, true)
  // Clients cannot certify themselves through the normal product PATCH endpoint.
  const previousReceipt = (await load())._colorRuleConversion
  await call('/__api/products', 'PATCH', { _colorRuleConversion: { productRules: [] }, _colorRulesDirty: false }, '/fixture')
  assert.deepEqual((await load())._colorRuleConversion, previousReceipt)
  assert.equal((await load())._colorRulesDirty, true)
  console.log('Passed: isolated API fixture, actual GLB bake, persisted receipt, edit/newer-version race, failed bake, deletion and protected server receipt.')
} finally {
  if (!resolve(root).startsWith(resolve(tmpdir()) + '\\')) throw new Error('Unsafe fixture cleanup path')
  await rm(root, { recursive: true, force: true })
}
