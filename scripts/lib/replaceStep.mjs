import * as fs from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

export const isStepFile = path => /\.(step|stp|stpz|p21)$/i.test(String(path))

// Exclusive copies also support archives on a different volume. Never replace a destination.
export async function replaceStep({ productId, target, body, sources, archiveRoot, commit, rollback, audit, io = fs }) {
  const token = randomUUID()
  const temporary = `${target}.${token}.upload`
  const moved = []
  let installed = false
  let committing = false
  const report = (result, error) => audit({ time: new Date().toISOString(), productId,
    oldFiles: sources, archives: moved.map(x => ({ oldFile: x.source, archivePath: x.archive })),
    newFile: target, result, ...(error ? { error } : {}) })
  const copyVerified = async (source, destination) => {
    const size = (await io.stat(source)).size
    await io.copyFile(source, destination, constants.COPYFILE_EXCL)
    if ((await io.stat(destination)).size !== size) throw new Error(`Dateigröße stimmt nicht: ${destination}`)
  }
  try {
    await io.mkdir(dirname(target), { recursive: true })
    await io.writeFile(temporary, body, { flag: 'wx' })
    if ((await io.stat(temporary)).size !== body.length) throw new Error('Temporärer Upload ist unvollständig')
    const folder = join(archiveRoot, productId)
    if (sources.length) await io.mkdir(folder, { recursive: true })
    for (const source of [...new Set(sources)]) {
      const name = basename(source)
      let archive = join(folder, name)
      for (;;) {
        try { await copyVerified(source, archive); break }
        catch (error) {
          if (error.code !== 'EEXIST') throw error
          const extension = extname(name)
          archive = join(folder, `${name.slice(0, -extension.length)}_${new Date().toISOString().replace(/[^0-9]/g, '')}_${randomUUID()}${extension}`)
        }
      }
      const entry = { source, archive, removed: false }
      moved.push(entry)
      await report('archiviert, Übernahme ausstehend')
      await io.unlink(source)
      entry.removed = true
    }
    await io.copyFile(temporary, target, constants.COPYFILE_EXCL)
    installed = true
    if ((await io.stat(target)).size !== body.length) throw new Error('Neue STEP-Datei ist unvollständig')
    committing = true
    const product = await commit()
    await report('erfolgreich')
    await io.unlink(temporary)
    return { product, archived: moved.length }
  } catch (error) {
    const failures = []
    if (installed) { try { await io.unlink(target) } catch (e) { failures.push(e.message) } }
    for (const entry of moved.slice().reverse()) {
      if (!entry.removed) continue
      try { await copyVerified(entry.archive, entry.source) }
      catch (e) { failures.push(`Wiederherstellung ${entry.source}; Sicherung ${entry.archive}: ${e.message}`) }
    }
    if (committing) { try { await rollback() } catch (e) { failures.push(`Produktverweise: ${e.message}`) } }
    try { await io.unlink(temporary) } catch (e) { if (e.code !== 'ENOENT') failures.push(e.message) }
    const message = `${error.message}${failures.length ? `; Rollback unvollständig: ${failures.join('; ')}` : '; ursprünglicher Zustand erhalten/wiederhergestellt'}`
    try { await report('fehlgeschlagen', message) } catch (e) { throw new Error(`${message}; Protokollierung fehlgeschlagen: ${e.message}`) }
    throw new Error(message)
  }
}
