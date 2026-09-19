import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { readShortTextIndex, lookupShortText } from './lib/sapShortText.mjs'

// Vor dem Schreiben vollständig lesen: Bei einem Excel-Fehler bleibt der Bestand unverändert.
const index = await readShortTextIndex()
const filename = fileURLToPath(new URL('../src/data/products.json', import.meta.url))
const raw = await readFile(filename, 'utf8')
const data = JSON.parse(raw)
let found = 0, changed = 0
for (const product of data.products) {
  const shortText = lookupShortText(product, index)
  if (shortText) found++
  if (product.shortText !== shortText) { product.shortText = shortText; changed++ }
}
// Der Abgleich darf ausschließlich shortText verändern.
const original = JSON.parse(raw)
data.products.forEach((p, i) => {
  const { shortText, ...rest } = p
  const { shortText: oldText, ...oldRest } = original.products[i]
  if (JSON.stringify(rest) !== JSON.stringify(oldRest)) throw new Error('Unerwartete Datenänderung')
})
if (changed) await writeFile(filename, JSON.stringify(data, null, 2) + '\n', 'utf8')
console.log(JSON.stringify({ products: data.products.length, found, changed }))
