#!/usr/bin/env node
/**
 * Erzeugt src/data/products.public.json (ohne interne Dashboard/Konverter-Felder)
 * aus src/data/products.json – muss vor `vite build` laufen, da src/main.js die
 * öffentliche Datei statisch importiert.
 */
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { writePublicProducts } from './lib/publicProducts.mjs'
import { createLogger } from './lib/logger.mjs'

const log = createLogger('generate-public-products')
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const count = await writePublicProducts(ROOT)
log.info(`products.public.json geschrieben (${count} Produkte).`)
