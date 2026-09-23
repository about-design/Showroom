import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { replaceStep, isStepFile } from '../scripts/lib/replaceStep.mjs'

async function fixture(t, { oldName, newName = 'new.step', failCommit = false, archiveFailure = false, collision = false } = {}) {
  const root = await fs.mkdtemp(join(tmpdir(), 'showroom-step-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const source = oldName && join(root, 'product', oldName)
  const target = join(root, 'product', newName)
  const archiveRoot = join(root, 'archive')
  await fs.mkdir(join(root, 'product'))
  if (source) await fs.writeFile(source, 'OLD STEP CONTENT')
  await fs.writeFile(join(root, 'product', 'unchanged.glb'), 'GLB')
  if (collision) {
    await fs.mkdir(join(archiveRoot, 'product'), { recursive: true })
    await fs.writeFile(join(archiveRoot, 'product', oldName), 'EARLIER ARCHIVE')
  }
  if (archiveFailure) await fs.writeFile(archiveRoot, 'not a directory')
  let references = source ? [source] : []
  const previous = [...references]
  const records = []
  const run = () => replaceStep({ productId: 'product', target, body: Buffer.from('NEW STEP CONTENT'),
    sources: source ? [source] : [], archiveRoot,
    commit: async () => { references = [target]; if (failCommit) throw new Error('simulated persistence failure'); return { cadFiles: references } },
    rollback: async () => { references = previous }, audit: async record => records.push(record),
  })
  return { root, source, target, archiveRoot, run, records, references: () => references }
}

test('STEP family includes all four extensions only', () => {
  for (const ext of ['step', 'STP', 'stpz', 'p21']) assert.ok(isStepFile(`part.${ext}`))
  for (const ext of ['glb', 'usdz', 'png', 'obj', 'mtl']) assert.equal(isStepFile(`part.${ext}`), false)
})

test('no previous STEP: install and associate', async t => {
  const f = await fixture(t)
  assert.equal((await f.run()).archived, 0)
  assert.equal(await fs.readFile(f.target, 'utf8'), 'NEW STEP CONTENT')
  assert.deepEqual(f.references(), [f.target])
})

test('STP replaced by STEP: move previous version into archive', async t => {
  const f = await fixture(t, { oldName: 'old.stp' })
  assert.equal((await f.run()).archived, 1)
  await assert.rejects(fs.stat(f.source), { code: 'ENOENT' })
  assert.equal(await fs.readFile(join(f.archiveRoot, 'product', 'old.stp'), 'utf8'), 'OLD STEP CONTENT')
  assert.equal(await fs.readFile(f.target, 'utf8'), 'NEW STEP CONTENT')
  assert.equal(await fs.readFile(join(f.root, 'product', 'unchanged.glb'), 'utf8'), 'GLB')
  assert.equal(f.records.at(-1).result, 'erfolgreich')
})

test('same filename: archive contains old bytes, target new bytes', async t => {
  const f = await fixture(t, { oldName: 'same.step', newName: 'same.step' })
  await f.run()
  assert.equal(await fs.readFile(join(f.archiveRoot, 'product', 'same.step'), 'utf8'), 'OLD STEP CONTENT')
  assert.equal(await fs.readFile(f.target, 'utf8'), 'NEW STEP CONTENT')
})

test('archive collision preserves both versions', async t => {
  const f = await fixture(t, { oldName: 'same.step', collision: true })
  await f.run()
  const files = await fs.readdir(join(f.archiveRoot, 'product'))
  assert.equal(files.length, 2)
  const contents = await Promise.all(files.map(file => fs.readFile(join(f.archiveRoot, 'product', file), 'utf8')))
  assert.deepEqual(contents.sort(), ['EARLIER ARCHIVE', 'OLD STEP CONTENT'])
})

test('archive failure leaves original file and references untouched', async t => {
  const f = await fixture(t, { oldName: 'old.p21', archiveFailure: true })
  await assert.rejects(f.run())
  assert.equal(await fs.readFile(f.source, 'utf8'), 'OLD STEP CONTENT')
  assert.deepEqual(f.references(), [f.source])
  await assert.rejects(fs.stat(f.target), { code: 'ENOENT' })
})

test('persistence failure after archive restores original and references', async t => {
  const f = await fixture(t, { oldName: 'same.stpz', newName: 'same.stpz', failCommit: true })
  await assert.rejects(f.run(), /simulated persistence failure/)
  assert.equal(await fs.readFile(f.source, 'utf8'), 'OLD STEP CONTENT')
  assert.deepEqual(f.references(), [f.source])
  assert.equal(await fs.readFile(join(f.archiveRoot, 'product', 'same.stpz'), 'utf8'), 'OLD STEP CONTENT')
  assert.equal(f.records.at(-1).result, 'fehlgeschlagen')
})
