import yauzl from 'yauzl'
import { DOMParser } from '@xmldom/xmldom'
import { stat, readFile } from 'node:fs/promises'
import path from 'node:path'

export const SAP_EXCEL_PATH = 'D:/Showroom Datei Move/SAP_Artnr.xlsx'
const key = (value) => String(value ?? '').trim()
const elements = (node, tag) => Array.from(node.getElementsByTagName(tag))

function parseXml(xml) {
  return new DOMParser({ errorHandler: {
    warning() {}, error(message) { throw new Error(message) }, fatalError(message) { throw new Error(message) },
  } }).parseFromString(xml, 'application/xml')
}

async function readWorkbookFiles(filename) {
  const buffer = await readFile(filename)
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error)
      const files = new Map()
      const fail = (err) => { zip.close(); reject(err) }
      zip.on('error', fail)
      zip.on('end', () => resolve(files))
      zip.on('entry', (entry) => {
        if (!/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(entry.fileName)) {
          zip.readEntry(); return
        }
        zip.openReadStream(entry, (err, stream) => {
          if (err) return fail(err)
          const chunks = []
          stream.on('error', fail)
          stream.on('data', (chunk) => chunks.push(chunk))
          stream.on('end', () => {
            files.set(entry.fileName, Buffer.concat(chunks).toString('utf8'))
            zip.readEntry()
          })
        })
      })
      zip.readEntry()
    })
  })
}

export function createShortTextIndex(rows) {
  const ean = new Map(), article = new Map()
  for (const row of rows) {
    const record = { shortText: key(row.E), sapEan: key(row.A), sapArticleNumber: key(row.B) }
    if (key(row.A) && !ean.has(key(row.A))) ean.set(key(row.A), record)
    if (key(row.B) && !article.has(key(row.B))) article.set(key(row.B), record)
  }
  return { ean, article }
}

export async function readShortTextIndex(filename = SAP_EXCEL_PATH) {
  const files = await readWorkbookFiles(filename)
  const workbook = parseXml(files.get('xl/workbook.xml') || '')
  const sheet = elements(workbook, 'sheet')[0]
  const relationships = parseXml(files.get('xl/_rels/workbook.xml.rels') || '')
  const relation = elements(relationships, 'Relationship').find((r) => r.getAttribute('Id') === sheet?.getAttribute('r:id'))
  const target = relation?.getAttribute('Target')
  if (!target) throw new Error('Kein Excel-Arbeitsblatt gefunden')
  const sheetPath = target.startsWith('/') ? target.slice(1) : path.posix.normalize('xl/' + target)
  if (!files.has(sheetPath)) throw new Error('Excel-Arbeitsblatt nicht lesbar')
  const strings = files.has('xl/sharedStrings.xml')
    ? elements(parseXml(files.get('xl/sharedStrings.xml')), 'si').map((si) => elements(si, 't').map((t) => t.textContent).join(''))
    : []
  const rows = elements(parseXml(files.get(sheetPath)), 'row').map((row) => {
    const values = {}
    for (const cell of elements(row, 'c')) {
      const column = cell.getAttribute('r').replace(/\d+$/, '')
      if (!['A', 'B', 'E'].includes(column)) continue
      const raw = elements(cell, 'v')[0]?.textContent || ''
      values[column] = cell.getAttribute('t') === 's' ? strings[Number(raw)]
        : cell.getAttribute('t') === 'inlineStr' ? elements(cell, 't').map((t) => t.textContent).join('')
          : /^[0-9]+(?:\.[0-9]+)?[eE][+-]?[0-9]+$/.test(raw) ? String(Number(raw)) : raw
    }
    return values
  })
  return createShortTextIndex(rows)
}

export function productIdentifiers(product) {
  const parts = key(product.id).replace(/^output-/, '').split('_')
  return {
    ean: key(product.ean || product.gtin) || (/^\d{8,14}$/.test(parts[0]) ? parts[0] : ''),
    article: key(product.articleNumber || product.shopwareProductId) || key(parts[1]),
  }
}

export function lookupSapRecord(product, index) {
  const { ean, article } = productIdentifiers(product)
  if (ean && index.ean.has(ean)) return index.ean.get(ean)
  return (article && index.article.get(article)) || { shortText: '', sapEan: '', sapArticleNumber: '' }
}

export function lookupShortText(product, index) {
  return lookupSapRecord(product, index).shortText
}

let cachedIndex
let cachedStamp
/** Ein Treffer liefert Kurztext und Kennungen gemeinsam, ohne weiteren Lookup. */
export async function resolveProductSapRecord(product, filename = SAP_EXCEL_PATH) {
  try {
    const info = await stat(filename)
    const stamp = `${filename}:${info.mtimeMs}:${info.size}`
    if (stamp !== cachedStamp) {
      cachedIndex = await readShortTextIndex(filename)
      cachedStamp = stamp
    }
    return lookupSapRecord(product, cachedIndex)
  } catch {
    return { shortText: '', sapEan: '', sapArticleNumber: '' }
  }
}

export async function resolveProductShortText(product, filename = SAP_EXCEL_PATH) {
  return (await resolveProductSapRecord(product, filename)).shortText
}
