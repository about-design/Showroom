import { cp, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../..')

/** Assets aus public/, die auch im Online-Build (ohne public/models) benötigt werden. */
const ONLINE_PUBLIC_PATHS = [
  'draco',
  'mtl-ral-color-mapping.json',
  'fonts',
  'img',
]

/**
 * Online-/Docker-Build: public/models (~GB) weglassen; Modelle kommen vom CDN.
 * Aktivierung: VITE_ONLINE_BUILD=1
 */
export function onlinePublicAssetsPlugin() {
  if (process.env.VITE_ONLINE_BUILD !== '1') {
    return { name: 'online-public-skip' }
  }
  return {
    name: 'online-public-assets',
    apply: 'build',
    async closeBundle() {
      const outDir = resolve(ROOT, 'dist')
      for (const rel of ONLINE_PUBLIC_PATHS) {
        const src = resolve(ROOT, 'public', rel)
        const dest = resolve(outDir, rel)
        if (!existsSync(src)) continue
        await mkdir(dirname(dest), { recursive: true }).catch(() => {})
        await cp(src, dest, { recursive: true })
      }
    },
  }
}
