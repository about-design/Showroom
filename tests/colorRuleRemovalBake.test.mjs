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
const linear = value => {
  const n = value / 255
  return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4
}

async function createFixture(path) {
  const doc = new Document(), buffer = doc.createBuffer()
  const position = doc.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buffer)
  const material = doc.createMaterial('OldRuleMaterial').setBaseColorFactor([1, 0, 0, 1]).setMetallicFactor(0.75).setRoughnessFactor(0.1)
  const primitive = doc.createPrimitive().setAttribute('POSITION', position).setMaterial(material)
  const mesh = doc.createMesh('RuleTargetMesh').addPrimitive(primitive)
  doc.createScene().addChild(doc.createNode('RuleTargetNode').setMesh(mesh))
  await io.write(path, doc)
}

async function bake(t, currentRules) {
  const dir = await mkdtemp(join(tmpdir(), 'showroom-rule-removal-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const glb = join(dir, 'fixture.glb'), rules = join(dir, 'rules.json')
  await createFixture(glb)
  await writeFile(rules, JSON.stringify({
    removedNameColorRules: [{ target: 'mesh', pattern: '^RuleTargetMesh$', ral: 'RAL 3000' }],
    nameColorRules: currentRules,
  }))
  const result = spawnSync(process.execPath, ['scripts/bake-glb-yup.js', '--file', glb, '--write', '--no-registry', '--name-rules', rules], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8',
  })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  const baked = await io.read(glb)
  return baked.getRoot().listMaterials()[0]
}

test('deleted rule restores unmatched mesh to standard gray RAL 7035', async t => {
  const material = await bake(t, [])
  const actual = material.getBaseColorFactor(), expected = linear(0xD7)
  assert.ok(Math.abs(actual[0] - expected) < 0.002)
  assert.ok(Math.abs(actual[1] - expected) < 0.002)
  assert.ok(Math.abs(actual[2] - expected) < 0.002)
  assert.equal(material.getMetallicFactor(), 0)
  assert.equal(material.getRoughnessFactor(), 0.35)
})

test('remaining matching rule still wins after an older rule was deleted', async t => {
  const material = await bake(t, [{ target: 'mesh', pattern: '^RuleTargetMesh$', ral: 'RAL 5010' }])
  const actual = material.getBaseColorFactor()
  assert.ok(actual[2] > actual[0] * 5)
  assert.ok(actual[2] > actual[1] * 5)
})
