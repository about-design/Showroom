import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { drawingNumberFromMeshName, normalizeAutomaticColorMappings } from '../src/lib/automaticColorAssignment.js'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const productsPath = resolve(ROOT, 'src/data/products.json')
const settingsPath = resolve(ROOT, 'dashboard-file-manager-settings.json')
const outputDir = resolve(ROOT, 'public/models/output')

function extractGlbNames(buffer) {
  if (!buffer || buffer.length < 20 || buffer.readUInt32LE(0) !== 0x46546c67) return []
  const jsonLength = buffer.readUInt32LE(12)
  if (buffer.readUInt32LE(16) !== 0x4e4f534a || jsonLength <= 0) return []
  try {
    const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'))
    return [...new Set([
      ...(json.meshes || []).map((entry) => entry?.name),
      ...(json.nodes || []).map((entry) => entry?.name),
    ].filter(Boolean).map(String))]
  } catch {
    return []
  }
}

const products = JSON.parse(await readFile(productsPath, 'utf8'))
const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
const descriptions = new Map(
  normalizeAutomaticColorMappings(settings.automaticColorMappings)
    .filter((mapping) => mapping.partName)
    .map((mapping) => [mapping.drawingNumber, mapping.partName]),
)

let changedProducts = 0
let changedDescriptions = 0
for (const product of products.products || []) {
  if (!product.glbFile || !descriptions.size) continue
  const fileName = String(product.glbFile).split('/').pop()
  if (!fileName) continue
  let names
  try {
    names = extractGlbNames(await readFile(resolve(outputDir, fileName)))
  } catch {
    continue
  }
  const next = { ...(product.partDescriptions || {}) }
  for (const name of names) {
    const drawingNumber = drawingNumberFromMeshName(name)
    const partName = drawingNumber && descriptions.get(drawingNumber)
    if (drawingNumber && partName && !String(next[drawingNumber] || '').trim()) {
      next[drawingNumber] = partName
      changedDescriptions += 1
    }
  }
  if (JSON.stringify(next) !== JSON.stringify(product.partDescriptions || {})) {
    product.partDescriptions = next
    changedProducts += 1
  }
}

if (changedProducts) await writeFile(productsPath, `${JSON.stringify(products, null, 2)}\n`, 'utf8')
console.log(`Bauteilbezeichnungen: ${changedDescriptions} Zuordnung(en) in ${changedProducts} Produkt(en) ergänzt.`)
