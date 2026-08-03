import { readFile, writeFile } from 'fs/promises'
import { resolve } from 'path'
import { createLogger } from './logger.mjs'

const log = createLogger('publicProducts')

/**
 * Interne, nur für Dashboard/Konverter relevante Felder – nicht Teil des
 * öffentlichen Showroom-Bundles. Reduziert die an jeden Showroom-Besucher
 * statisch ausgelieferte products.json spürbar (siehe src/main.js Import).
 */
const INTERNAL_ONLY_FIELDS = [
  '_review',
  '_mtlColors',
  '_detectedOrientation',
  'cadFiles',
  'shopwareProductId',
  'previewImage',
  'previewImageGeneratedAt',
  'conversionPreset',
]

/** @param {{ products?: object[] }} data */
export function buildPublicProductsData(data) {
  const products = Array.isArray(data?.products) ? data.products : []
  return {
    products: products.map((p) => {
      const clone = { ...p }
      for (const key of INTERNAL_ONLY_FIELDS) delete clone[key]
      return clone
    }),
  }
}

/**
 * Liest src/data/products.json, entfernt interne Felder und schreibt das
 * Ergebnis nach src/data/products.public.json (von src/main.js importiert).
 * @param {string} root Projektroot
 */
export async function writePublicProducts(root) {
  const productsPath = resolve(root, 'src/data/products.json')
  const outPath = resolve(root, 'src/data/products.public.json')
  let publicData = { products: [] }
  try {
    const raw = await readFile(productsPath, 'utf-8')
    publicData = buildPublicProductsData(JSON.parse(raw))
  } catch (e) {
    log.warn('products.json nicht lesbar, schreibe leeres products.public.json:', e?.message || e)
  }
  // Datei muss immer existieren – src/main.js importiert sie statisch (Vite-Build bricht sonst ab).
  await writeFile(outPath, JSON.stringify(publicData) + '\n', 'utf-8')
  return publicData.products.length
}
