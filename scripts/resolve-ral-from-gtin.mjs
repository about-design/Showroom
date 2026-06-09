/**
 * RAL-Code aus GTIN-/Artikel-Stammdaten (Konverter-API → MCP gtin_naming).
 * Genutzt von Vite register-converted / convert-product.
 */

import { readFile } from 'fs/promises'
import { resolve } from 'path'

/**
 * @param {string} baseUrl – z. B. http://localhost:3000 (ohne trailing slash)
 * @param {{ gtin?: string, articleNumber?: string, shopwareProductId?: string }} product
 * @returns {Promise<{ ralCode: string, source: 'gtin', entry?: object } | null>}
 */
export async function resolveRalCodeFromGtinStamm(baseUrl, product, timeoutMs = 4500) {
  const gtin = String(product?.gtin || '').replace(/\D/g, '')
  const articleNumber = String(product?.articleNumber || product?.shopwareProductId || '').trim()
  if (!gtin && !articleNumber) return null

  const params = new URLSearchParams()
  if (gtin) params.set('gtin', gtin)
  if (articleNumber) params.set('articleNumber', articleNumber)

  const url = `${String(baseUrl).replace(/\/$/, '')}/api/v1/gtin/filename?${params}`
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  let res
  try {
    res = await fetch(url, { signal: ac.signal })
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }

  if (!res.ok) return null

  let data = {}
  try {
    data = await res.json()
  } catch {
    return null
  }

  if (!data.success || !data.entry) return null

  const entry = data.entry
  const cc = entry.color_code
  if (cc != null && String(cc).trim() !== '' && String(cc).trim() !== '0') {
    const m = String(cc).match(/(\d{4})/)
    if (m) return { ralCode: m[1], source: 'gtin', entry }
  }

  const suf = String(entry.finish_suffix || '').toUpperCase()
  if (suf && (suf.includes('VZK') || suf === 'VZ')) {
    return { ralCode: '9007', source: 'gtin', entry }
  }

  return null
}

/**
 * Hex aus src/data/ralColors.json für vierstelligen RAL-Code (Key „RAL 7035“).
 * @param {string} projectRoot – Repo-Root
 * @param {string} ralDigits – z. B. „7035“
 */
export async function resolveHexForRalDigits(projectRoot, ralDigits) {
  if (!/^\d{4}$/.test(String(ralDigits || ''))) return null
  const p = resolve(projectRoot, 'src/data/ralColors.json')
  let raw
  try {
    raw = await readFile(p, 'utf-8')
  } catch {
    return null
  }
  let palette = {}
  try {
    palette = JSON.parse(raw)
  } catch {
    return null
  }
  const key = `RAL ${ralDigits}`
  const hex = palette[key]?.hex
  if (!hex || typeof hex !== 'string') return null
  const h = hex.replace(/^#?/, '').toUpperCase()
  if (!/^[0-9A-F]{6}$/.test(h)) return null
  return `#${h}`
}
