import { cp, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { resolve, dirname, relative, extname, basename, sep } from 'path'
import { fileURLToPath } from 'url'
import { createLogger } from '../lib/logger.mjs'

const log = createLogger('vite')
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../..')

/**
 * CAD-Quelldateien. Sie werden ausschließlich serverseitig gelesen — vom
 * Dashboard-API-Plugin (MTL-Editor, `/__api/mtl`) und vom Konverter, beide
 * direkt aus `public/`. Der Browser fragt sie nie an, und der Electron-Server
 * (electron/main.cjs) kennt für sie nicht einmal einen MIME-Typ.
 */
const CAD_SOURCE_EXTS = new Set(['.step', '.stp', '.p21', '.obj', '.mtl', '.bak'])

/**
 * Verzeichnisse unter public/, die nie in den Build gehören.
 * `models/obj` ist ein Symlink auf das externe CAD-Archiv — Vite folgt ihm beim
 * Spiegeln von publicDir und zieht damit mehrere Gigabyte Roh-OBJ nach dist.
 */
const EXCLUDED_DIRS = ['models/obj']

/**
 * `models/products` ist der Ablage- und Arbeitsordner für CAD-Uploads, Textur-Eingaben
 * und historische Rohdateien — alles nur serverseitig gebraucht. Ausgeliefert werden
 * Modelle aus `models/output`. Damit ein Alt-Produkt, dessen `glbFile` noch nach
 * `models/products/…` zeigt, trotzdem funktioniert, wird genau das durchgelassen,
 * was products.json referenziert.
 *
 * @returns {Promise<Set<string>>} referenzierte Pfade relativ zu public/ (z. B. "models/products/x.glb")
 */
async function referencedProductAssets() {
  const out = new Set()
  try {
    const raw = await readFile(resolve(ROOT, 'src/data/products.json'), 'utf-8')
    const data = JSON.parse(raw)
    for (const p of Array.isArray(data?.products) ? data.products : []) {
      for (const key of ['glbFile', 'usdzFile', 'previewImage']) {
        const v = typeof p?.[key] === 'string' ? p[key].split('?')[0].replace(/^\//, '') : ''
        if (v) out.add(v)
      }
    }
  } catch (e) {
    log.warn(`[vite] products.json für Asset-Filter nicht lesbar (${e.message}) – models/products wird ausgelassen`)
  }
  return out
}

/**
 * @param {string} rel Pfad relativ zu public/, immer mit "/" als Trenner
 * @param {Set<string>} referenced referenzierte Asset-Pfade aus products.json
 */
function isExcluded(rel, referenced) {
  if (!rel) return false
  if (basename(rel) === '.DS_Store') return true
  if (EXCLUDED_DIRS.some((d) => rel === d || rel.startsWith(`${d}/`))) return true
  if (CAD_SOURCE_EXTS.has(extname(rel).toLowerCase())) return true
  if (rel.startsWith('models/products/')) {
    // Verzeichnisse müssen passierbar bleiben, sonst werden referenzierte
    // Dateien darunter nie erreicht (cp bricht den Teilbaum sonst ab).
    if (!extname(rel)) return false
    return !referenced.has(rel)
  }
  return false
}

/**
 * Lokaler Build: public/ nach dist/ kopieren, aber ohne CAD-Quellen.
 *
 * Vites eigenes publicDir-Spiegeln kann nicht filtern, deshalb wird es für den
 * Build abgeschaltet und hier gefiltert kopiert. Im Dev-Server bleibt publicDir
 * unangetastet (`apply: 'build'`), dort wird weiterhin alles aus public/ bedient.
 *
 * Ohne diesen Filter enthält dist die kompletten CAD-Bestände (Roh-OBJ über den
 * `models/obj`-Symlink plus alle STEP-Dateien unter `models/products`) — die auch
 * im Electron-Installer landen würden, der dist mitpackt (siehe package.json → build.files).
 */
export function localPublicAssetsPlugin() {
  // Online-/Docker-Build lässt public/models ohnehin komplett weg.
  if (process.env.VITE_ONLINE_BUILD === '1') {
    return { name: 'local-public-assets-skip' }
  }
  return {
    name: 'local-public-assets',
    apply: 'build',
    config() {
      return { publicDir: false }
    },
    async closeBundle() {
      const publicDir = resolve(ROOT, 'public')
      const outDir = resolve(ROOT, 'dist')
      if (!existsSync(publicDir)) return
      const referenced = await referencedProductAssets()
      let copied = 0
      let skipped = 0
      await cp(publicDir, outDir, {
        recursive: true,
        force: true,
        filter: (src) => {
          const rel = relative(publicDir, src).split(sep).join('/')
          if (isExcluded(rel, referenced)) {
            skipped++
            return false
          }
          copied++
          return true
        },
      })
      log.info(
        `[vite] public/ → dist/: ${copied} Einträge kopiert, ${skipped} CAD-Quellen/Symlinks übersprungen`,
      )
    },
  }
}
