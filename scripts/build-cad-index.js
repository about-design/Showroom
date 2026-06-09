#!/usr/bin/env node
import { createLogger } from './lib/logger.mjs'
const log = createLogger("build-cad-index")

/**
 * Baut einen CAD-Index: Scannt alle OBJ-Dateien im obj-Ordner,
 * liest mtllib-Referenzen, findet Texturen in MTL-Dateien,
 * und erstellt ein Mapping von Nummern → {obj, mtl, textures}.
 *
 * Speichert: src/data/cad-index.json
 *
 * Matching-Strategie:
 *  1. OBJ-Dateiname (z.B. "20010018.obj" → Nummer "20010018")
 *  2. mtllib-Referenz (z.B. "10018.mtl" → Nummer "10018")
 *  3. Beide Nummern werden als Lookup-Keys gespeichert
 *  4. Textur-Referenzen aus MTL (map_Ka, map_Kd etc.)
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const objDir = path.join(root, 'public', 'models', 'obj')
const indexPath = path.join(root, 'src', 'data', 'cad-index.json')
const productsJsonPath = path.join(root, 'src', 'data', 'products.json')

if (!fs.existsSync(objDir)) {
    log.error(`OBJ-Verzeichnis nicht gefunden: ${objDir}`)
  process.exit(1)
}

const entries = fs.readdirSync(objDir)
const objFiles = entries.filter(f => f.toLowerCase().endsWith('.obj'))
const mtlFiles = new Set(entries.filter(f => f.toLowerCase().endsWith('.mtl')).map(f => f))
const textureFiles = new Set(entries.filter(f => /\.(png|jpg|jpeg|tiff|tga|bmp)$/i.test(f)))
const stepFiles = entries.filter(f => /\.(step|stp)$/i.test(f))

log.info(`Gefunden: ${objFiles.length} OBJ, ${mtlFiles.size} MTL, ${textureFiles.size} Texturen, ${stepFiles.length} STEP`)

// Phase 1: OBJ-Dateien scannen → mtllib-Referenzen extrahieren
const objEntries = []
let scanned = 0

for (const objFile of objFiles) {
  const objPath = path.join(objDir, objFile)
  const objBase = objFile.replace(/\.obj$/i, '')

  // Nur die ersten 1KB lesen (mtllib steht immer am Anfang)
  const fd = fs.openSync(objPath, 'r')
  const buf = Buffer.alloc(1024)
  const bytesRead = fs.readSync(fd, buf, 0, 1024, 0)
  fs.closeSync(fd)
  const header = buf.toString('utf-8', 0, bytesRead)

  const mtlMatch = header.match(/^mtllib\s+(.+)$/m)
  const mtlRef = mtlMatch ? mtlMatch[1].trim() : null
  const mtlBase = mtlRef ? mtlRef.replace(/\.mtl$/i, '') : null

  // Textur-Referenzen aus der MTL-Datei
  const textures = []
  if (mtlRef && mtlFiles.has(mtlRef)) {
    try {
      const mtlContent = fs.readFileSync(path.join(objDir, mtlRef), 'utf-8')
      const texMatches = mtlContent.matchAll(/^map_\w+\s+(.+)$/gm)
      for (const m of texMatches) {
        const tex = m[1].trim()
        if (textureFiles.has(tex) && !textures.includes(tex)) textures.push(tex)
      }
    } catch {}
  }

  objEntries.push({
    obj: objFile,
    objBase,
    mtlRef,
    mtlBase,
    textures,
  })

  scanned++
  if (scanned % 500 === 0) process.stdout.write(`  ${scanned}/${objFiles.length} gescannt\r`)
}

log.info(`  ${scanned}/${objFiles.length} OBJ-Dateien gescannt`)

// Phase 2: Index aufbauen – verschiedene Lookup-Keys pro Eintrag
// Key = Nummer (als String), Value = { obj, mtl, textures }
const groups = new Map()

function getOrCreateGroup(key) {
  if (!groups.has(key)) groups.set(key, { files: [] })
  return groups.get(key)
}

for (const entry of objEntries) {
  const fileSet = [entry.obj]
  if (entry.mtlRef && mtlFiles.has(entry.mtlRef)) fileSet.push(entry.mtlRef)
  for (const tex of entry.textures) fileSet.push(tex)

  // Alle möglichen Lookup-Nummern für diese Dateigruppe
  const keys = new Set()
  keys.add(entry.objBase)
  if (entry.mtlBase) keys.add(entry.mtlBase)

  for (const key of keys) {
    const group = getOrCreateGroup(key)
    for (const f of fileSet) {
      if (!group.files.includes(f)) group.files.push(f)
    }
  }
}

// STEP-Dateien: Nach Basisname (Nummer) in Gruppen aufnehmen (wie OBJ), auch rein STEP-only
for (const stepFile of stepFiles) {
  const stepBase = stepFile.replace(/\.(step|stp)$/i, '')
  const group = getOrCreateGroup(stepBase)
  if (!group.files.includes(stepFile)) group.files.push(stepFile)
}

// Phase 3: Produkte → CAD-Dateien matchen
// Aus Produkten verschiedene Nummern extrahieren
function extractMatchKeys(product) {
  const keys = new Set()
  const glb = (product.glbFile || '').split('/').pop().replace(/\.glb$/i, '')
  if (!glb) return keys

  // "4026212000054_20010018_VZK" → ["4026212000054", "20010018"]
  // "10023_VZK" → ["10023"]
  // "4026212003260_200109307_RAL_2001" → ["4026212003260", "200109307"]
  const parts = glb.split('_')
  for (const part of parts) {
    if (/^\d{3,}$/.test(part)) keys.add(part)
  }

  // Auch die Produkt-ID parsen
  const idParts = (product.id || '').split(/[-_]/)
  for (const part of idParts) {
    if (/^\d{3,}$/.test(part)) keys.add(part)
  }

  return keys
}

// Lade products.json und baue das endgültige Mapping
const productsData = JSON.parse(fs.readFileSync(productsJsonPath, 'utf-8'))
const productCadMap = {}
let matched = 0, unmatched = 0

for (const p of productsData.products) {
  const keys = extractMatchKeys(p)
  const foundFiles = new Set()

  for (const key of keys) {
    const group = groups.get(key)
    if (group) {
      for (const f of group.files) foundFiles.add(f)
    }
  }

  if (foundFiles.size > 0) {
    productCadMap[p.id] = [...foundFiles].sort()
    matched++
  } else {
    unmatched++
  }
}

// Alleinstehende MTL-Dateien (ohne OBJ) die nur über Nummern matchen
let orphanMtlMatched = 0
for (const mtlFile of mtlFiles) {
  const mtlBase = mtlFile.replace(/\.mtl$/i, '')
  // Prüfe ob diese MTL schon einer Gruppe zugeordnet ist
  const group = groups.get(mtlBase)
  if (group) continue
  // Neue Gruppe für alleinstehende MTL
  getOrCreateGroup(mtlBase).files.push(mtlFile)
  orphanMtlMatched++
}

// Nochmal matchen mit den neuen alleinstehenden MTLs
for (const p of productsData.products) {
  if (productCadMap[p.id]) continue
  const keys = extractMatchKeys(p)
  const foundFiles = new Set()
  for (const key of keys) {
    const group = groups.get(key)
    if (group) {
      for (const f of group.files) foundFiles.add(f)
    }
  }
  if (foundFiles.size > 0) {
    productCadMap[p.id] = [...foundFiles].sort()
    matched++
    unmatched--
  }
}

// Index speichern
const index = {
  generated: new Date().toISOString(),
  objDir: '/models/obj',
  totalObjFiles: objFiles.length,
  totalMtlFiles: mtlFiles.size,
  totalTextureFiles: textureFiles.size,
  totalStepFiles: stepFiles.length,
  totalGroups: groups.size,
  matchedProducts: matched,
  unmatchedProducts: unmatched,
  orphanMtls: orphanMtlMatched,
  productCadFiles: productCadMap,
}

fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n', 'utf-8')

log.info(`\nIndex erstellt: ${indexPath}`)
log.info(`  Gruppen: ${groups.size}`)
log.info(`  Produkte mit CAD-Match: ${matched}`)
log.info(`  Produkte ohne CAD-Match: ${unmatched}`)
log.info(`  Alleinstehende MTLs: ${orphanMtlMatched}`)

// Zeige ein paar Beispiele
log.info('\nBeispiele:')
let shown = 0
for (const [pid, files] of Object.entries(productCadMap)) {
  if (shown >= 5) break
    log.info(`  ${pid}: ${files.join(', ')}`)
  shown++
}
