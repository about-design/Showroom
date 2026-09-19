import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp, unlink, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('central mesh display setting defaults on and survives file reloads', async () => {
  const source = await readFile(new URL('../scripts/vite-plugin/dashboardApi.mjs', import.meta.url), 'utf8')
  const getterStart = source.indexOf('  async function getFileManagerSettings()')
  const getter = source.slice(getterStart, source.indexOf('  async function buildProductArchivePlan', getterStart))
  const routeStart = source.indexOf("      middlewares.use('/__api/file-manager-settings'")
  const route = source.slice(routeStart, source.indexOf("      middlewares.use('/__api/list-models'", routeStart))
  const dir = await mkdtemp(join(tmpdir(), 'mesh-display-settings-'))
  const path = join(dir, 'settings.json')
  const create = () => {
    let handler
    new Function('readFile', 'writeFile', 'FILE_MANAGER_SETTINGS_PATH', 'middlewares', 'readBody',
      getter + route)(readFile, writeFile, path, { use: (_url, fn) => { handler = fn } }, async req => Buffer.from(JSON.stringify(req.body)))
    return async (method, body) => {
      let result
      await handler({ method, body }, { setHeader() {}, end(value) { result = JSON.parse(value) } })
      return result
    }
  }
  try {
    assert.equal((await create()('GET')).showMeshRal, true)
    assert.equal((await create()('GET')).showViewCube, true)
    assert.equal((await create()('GET')).viewCubePosition, 'right')
    for (const viewCubePosition of ['left', 'center', 'right']) {
      await create()('PUT', { showViewCube: false, viewCubePosition })
      const saved = await create()('GET')
      assert.equal(saved.showViewCube, false)
      assert.equal(saved.viewCubePosition, viewCubePosition)
    }
    await create()('PUT', { showViewCube: true, viewCubePosition: 'left' })
    await create()('PUT', { viewCubePosition: 'invalid' })
    assert.equal((await create()('GET')).showViewCube, true)
    assert.equal((await create()('GET')).viewCubePosition, 'left')
    assert.equal((await create()('GET')).sidebarWidthPercent, 45)
    for (const sidebarWidthPercent of [35, 40, 45, 50, 55]) {
      assert.equal((await create()('PUT', { sidebarWidthPercent })).sidebarWidthPercent, sidebarWidthPercent)
      assert.equal((await create()('GET')).sidebarWidthPercent, sidebarWidthPercent)
    }
    await create()('PUT', { sidebarWidthPercent: 99 })
    assert.equal((await create()('GET')).sidebarWidthPercent, 55)
    for (const showMeshRal of [false, true]) {
      const body = { fileManager: 'explorer', autoConvertOnDrop: true, maxParallelConversions: 4, showMeshRal }
      assert.equal((await create()('PUT', body)).showMeshRal, showMeshRal)
      const reloaded = await create()('GET')
      assert.equal(reloaded.showMeshRal, showMeshRal)
      assert.equal(reloaded.autoConvertOnDrop, true)
      assert.equal(reloaded.maxParallelConversions, 4)
    }
    await create()('PUT', { showMeshRal: false })
    await create()('PUT', { fileManager: 'explorer' })
    assert.equal((await create()('GET')).showMeshRal, false, 'Older clients must preserve the display setting')
  } finally {
    await unlink(path).catch(() => {})
    await rmdir(dir)
  }
})
