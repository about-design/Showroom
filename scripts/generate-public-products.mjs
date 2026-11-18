#!/usr/bin/env node
/**
 * Erzeugt src/data/products.public.json (ohne interne Dashboard/Konverter-Felder)
 * aus src/data/products.json – muss vor `vite build` laufen, da src/main.js die
 * öffentliche Datei statisch importiert.
 */
import { existsSync, writeFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { writePublicProducts } from './lib/publicProducts.mjs'
import { createLogger } from './lib/logger.mjs'

const log = createLogger('generate-public-products')
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

// products.json ist gitignored und fehlt in frischen Checkouts (GitHub Actions,
// Docker-Build). src/converter/main.js importiert sie dynamisch – ohne Datei
// bricht `vite build` ab. Daher leeren Platzhalter anlegen; vorhandene Daten
// werden nie überschrieben.
const productsPath = resolve(ROOT, 'src/data/products.json')
if (!existsSync(productsPath)) {
  writeFileSync(productsPath, JSON.stringify({ products: [] }, null, 2) + '\n', 'utf-8')
  log.warn('src/data/products.json fehlt – leerer Platzhalter angelegt (Build ohne Produktdaten).')
}

const count = await writePublicProducts(ROOT)
log.info(`products.public.json geschrieben (${count} Produkte).`)
