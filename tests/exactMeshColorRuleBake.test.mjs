import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import draco from 'draco3dgltf'

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco.createDecoderModule(),
  'draco3d.encoder': await draco.createEncoderModule(),
})

test('exact last mesh rule overrides a general galvanized rule for one mesh only', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'showroom-exact-mesh-rule-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const glb = join(dir, 'fixture.glb'), rules = join(dir, 'rules.json')
  const doc = new Document(), buffer = doc.createBuffer()
  const scene = doc.createScene()
  for (const [name, materialName] of [['GeneralMesh', 'GeneralMaterial'], ['ExactMesh', 'ExactMaterial']]) {
    const position = doc.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buffer)
    const material = doc.createMaterial(materialName).setBaseColorFactor([1, 0, 0, 1])
    const primitive = doc.createPrimitive().setAttribute('POSITION', position).setMaterial(material)
    scene.addChild(doc.createNode(`${name}Node`).setMesh(doc.createMesh(name).addPrimitive(primitive)))
  }
  await io.write(glb, doc)
  await writeFile(rules, JSON.stringify({ nameColorRules: [
    { target: 'mesh', pattern: 'Mesh$', ral: 'RAL 9007', finish: 'verzinkt' },
    { target: 'mesh', pattern: '^ExactMesh$', ral: 'RAL 7035', finish: 'pulver' },
  ] }))
  const result = spawnSync(process.execPath, ['scripts/bake-glb-yup.js', '--file', glb, '--write', '--no-registry', '--name-rules', rules], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8',
  })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  const baked = await io.read(glb)
  const materials = new Map(baked.getRoot().listMaterials().map(material => [material.getName(), material]))
  assert.equal(materials.get('GeneralMaterial').getMetallicFactor(), 0.75)
  assert.equal(materials.get('GeneralMaterial').getRoughnessFactor(), 0.25)
  assert.equal(materials.get('ExactMaterial').getMetallicFactor(), 0)
  assert.equal(materials.get('ExactMaterial').getRoughnessFactor(), 0.35)
  assert.notDeepEqual(materials.get('GeneralMaterial').getBaseColorFactor().slice(0, 3), materials.get('ExactMaterial').getBaseColorFactor().slice(0, 3))
})
