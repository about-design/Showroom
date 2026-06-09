import { defineConfig } from 'vite'
import { resolve, dirname, relative, isAbsolute, sep as pathSep } from 'path'
import { fileURLToPath } from 'url'
import { buildColorOverridesFromMapping, normalizeMappingHex } from '../../src/lib/hexMapping.js'
import { mergeNameColorRuleEntries } from '../../src/lib/nameColorRules.js'
import { mergeGeometryColorRuleEntries } from '../../src/lib/geometryColorRules.js'
import { mergeVertexReductionRuleEntries } from '../../src/lib/vertexReductionRules.js'
import { mergeVisibilityRuleEntries } from '../../src/lib/visibilityRules.js'
import { resolveRalCodeFromGtinStamm, resolveHexForRalDigits } from '../../scripts/resolve-ral-from-gtin.mjs'
import { resolveDefaultColorStringForPipeline, isDefaultColorMappingAuto } from '../../src/lib/defaultColorMapping.js'
import ColorService from '../../src/services/ColorService.js'
import { parseMtl, serializeMtl, createEmptyMaterial } from '../../src/lib/mtlParser.js'
import { getMtllibFromObjContent, setMtllibInObjContent } from '../../src/lib/objMtllib.js'

const __dirname = typeof import.meta.dirname !== 'undefined'
  ? import.meta.dirname
  : dirname(fileURLToPath(import.meta.url))
import { spawnSync } from 'child_process'
import { open, readdir, readFile, writeFile, mkdir, stat, copyFile, unlink, rename } from 'fs/promises'

/** @param {string} abs */
async function pathExists(abs) {
  try {
    await stat(abs)
    return true
  } catch {
    return false
  }
}

function headerAllowsOverwrite(req) {
  const v = String(req.headers['x-overwrite'] ?? '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}
import { watch as fsWatch } from 'node:fs'
import tailwindcss from '@tailwindcss/vite'
import { createBlenderRenderMiddleware } from '../render/blenderRenderRoute.mjs'
import { createLogger, withRequestLogger } from '../lib/logger.mjs'
import {
  measureGlbDimensionsMm,
  applyDimensionsToProductSpecs,
} from '../lib/measureGlbDimensions.mjs'

/** RAL-Vergleich für Mapping-Zielfilter (z. B. "RAL 7035", "ral7035"). */
function normalizeRalFilterKey(s) {
  if (s == null || s === '') return ''
  const t = String(s).trim().toUpperCase().replace(/\s+/g, ' ')
  const m = t.match(/^RAL\s*0*(\d{4})$/) || t.match(/^0*(\d{4})$/)
  return m ? `RAL ${m[1]}` : ''
}

/** Extrahiert eindeutige RGB-Farben aus STEP `COLOUR_RGB`-Einträgen (0..1 → 0..255). */
function extractStepRgbColors(stepText) {
  const colors = new Set()
  if (!stepText || typeof stepText !== 'string') return colors
  const rx =
    /COLOUR_RGB\s*\(\s*'[^']*'\s*,\s*([0-9eE+\-.]+)\s*,\s*([0-9eE+\-.]+)\s*,\s*([0-9eE+\-.]+)\s*\)/g
  let m
  while ((m = rx.exec(stepText))) {
    const rgb = m.slice(1, 4).map((v) => {
      const n = Number(v)
      const c = Number.isFinite(n) ? n : 0
      return Math.max(0, Math.min(255, Math.round(c * 255)))
    })
    colors.add(rgb.join(','))
  }
  return colors
}

/**
 * Liest Material-Basisfarben aus GLB (materials[].pbrMetallicRoughness.baseColorFactor).
 * Rückgabe: Set mit "r,g,b" in 0..255.
 */
function extractGlbMaterialRgbColors(glbBuffer) {
  const colors = new Set()
  if (!glbBuffer || glbBuffer.length < 20) return colors
  // glTF binary magic "glTF"
  if (glbBuffer.readUInt32LE(0) !== 0x46546c67) return colors
  const jsonLen = glbBuffer.readUInt32LE(12)
  const jsonType = glbBuffer.readUInt32LE(16)
  // JSON chunk type "JSON"
  if (jsonType !== 0x4e4f534a || !Number.isFinite(jsonLen) || jsonLen <= 0) return colors
  const end = 20 + jsonLen
  if (end > glbBuffer.length) return colors
  let doc
  try {
    doc = JSON.parse(glbBuffer.subarray(20, end).toString('utf-8'))
  } catch {
    return colors
  }
  const mats = Array.isArray(doc?.materials) ? doc.materials : []
  for (const m of mats) {
    const f = m?.pbrMetallicRoughness?.baseColorFactor
    if (!Array.isArray(f) || f.length < 3) continue
    const rgb = f.slice(0, 3).map((v) => {
      const n = Number(v)
      const c = Number.isFinite(n) ? n : 0
      return Math.max(0, Math.min(255, Math.round(c * 255)))
    })
    colors.add(rgb.join(','))
  }
  return colors
}

/**
 * Zielfarben-Filter: zuerst MTL-Sync-Ziel (_mtlColors.dominantRal), sonst explizite Standard-Farbe.
 * Für `defaultColor: "__mapping__"` ohne _mtlColors → '' (bis `npm run sync:colors` gelaufen ist).
 */
function getProductTargetRalForFilter(p) {
  const domRaw = p?._mtlColors?.dominantRal
  if (domRaw) {
    const k = normalizeRalFilterKey(String(domRaw))
    if (k && ColorService.getRAL(k)) return k
  }
  const dc = p?.defaultColor
  if (!dc || isDefaultColorMappingAuto(dc)) return ''
  const k = normalizeRalFilterKey(String(dc))
  if (!k || !ColorService.getRAL(k)) return ''
  return k
}

/**
 * Konverter-API (Joi) erwartet viele Felder als Strings 'true'|'false' und feste Enums.
 * Presets aus JSON können boolean/number oder deutsche Oberflächenbegriffe enthalten → hier angleichen.
 */
function sanitizeConvertMultipartForJoi(merged, prodSf) {
  if (!merged || typeof merged !== 'object') return
  const boolKeys = [
    'embedTextures', 'useAI', 'useDraco', 'autoLabelParts', 'useClaudeAI', 'useGTINNaming',
    'optimizeGlb', 'overwriteExisting', 'rotateYUp', 'bakeYUp', 'stripCamerasLights',
    'keepCamerasLights', 'enablePreflight', 'preserveMtlColors', 'defaultColorOverride',
  ]
  for (const k of boolKeys) {
    if (typeof merged[k] === 'boolean') merged[k] = merged[k] ? 'true' : 'false'
  }
  const numStrKeys = [
    'scale', 'decimateRatio', 'batchChunkSize', 'colorSaturation', 'colorBrightness',
    'roughnessMultiplier', 'metallicMultiplier', 'tessellationQuality', 'targetMeshMatchThreshold',
  ]
  for (const k of numStrKeys) {
    if (typeof merged[k] === 'number' && Number.isFinite(merged[k])) merged[k] = String(merged[k])
  }
  if (typeof merged.importUpAxis === 'string') {
    const u = merged.importUpAxis.trim().toUpperCase()
    if (['AUTO', 'X', 'Y', 'Z'].includes(u)) merged.importUpAxis = u
  }
  const validMf = new Set(['standard', 'galvanized', 'powder-coated', 'auto'])
  if (merged.materialFinish != null && merged.materialFinish !== '') {
    const key = String(merged.materialFinish).trim().toLowerCase()
    const mapDe = {
      verzinkt: 'galvanized',
      pulver: 'powder-coated',
      pulverbeschichtet: 'powder-coated',
      powder: 'powder-coated',
      'powder-coated': 'powder-coated',
      galvanized: 'galvanized',
      standard: 'standard',
      auto: 'auto',
    }
    if (mapDe[key]) merged.materialFinish = mapDe[key]
    else     if (!validMf.has(key)) {
      merged.materialFinish =
        prodSf === 'verzinkt' ? 'galvanized' : prodSf === 'pulver' ? 'powder-coated' : 'auto'
    }
  }
}

/** `cadFiles`-URL wie `/models/obj/a.mtl` → absolute Pfad unter `public/`. */
function cadUrlToAbsPublic(ROOT, cadUrl) {
  const parts = String(cadUrl || '').replace(/^\//, '').split('/').filter(Boolean)
  if (!parts.length) return null
  return resolve(ROOT, 'public', ...parts)
}

/**
 * Zusätzliche spawn-Argumente für bake-glb-yup: MTL mit map_Kd auf GLB anwenden (nach externem Konvert).
 * Erste lesbare `.mtl` aus cadFiles; optionale Suchpfade aus vorhandenen Bild-URLs im Produkt.
 * `conversionPreset.mtlBaseTextureRepeat` nur bei Kachelung (>1); sonst Textur 1× über UV (kein Flag).
 */
async function bakeSpawnArgsMtlTextures(product, ROOT) {
  const urls = product?.cadFiles
  if (!Array.isArray(urls)) return []
  const extraDirs = new Set()
  let mtlAbs = null
  for (const u of urls) {
    if (/\.mtl$/i.test(u) && !mtlAbs) {
      const p = cadUrlToAbsPublic(ROOT, u)
      if (!p) continue
      try {
        await stat(p)
        mtlAbs = p
      } catch (_) {}
    }
    if (/\.(png|jpe?g|webp)$/i.test(u)) {
      const p = cadUrlToAbsPublic(ROOT, u)
      if (!p) continue
      try {
        await stat(p)
        extraDirs.add(dirname(p))
      } catch (_) {}
    }
  }
  if (!mtlAbs) return []
  const args = ['--mtl-for-textures', mtlAbs]
  if (extraDirs.size > 0) args.push('--mtl-texture-extra-dirs', [...extraDirs].join(','))
  const rep = product?.conversionPreset?.mtlBaseTextureRepeat
  if (rep != null && String(rep).trim() !== '') {
    args.push('--mtl-base-texture-repeat', String(rep).trim())
  }
  return args
}

export function dashboardApi() {
  const httpLog = createLogger('http')
  const frontendIngestLog = createLogger('frontend')
  const log = createLogger('dashboard-api')
  const ROOT = process.cwd()
  const PRODUCTS_PATH = resolve(ROOT, 'src/data/products.json')
  const MODELS_BASE = resolve(ROOT, 'public/models')
  const MODELS_UPLOAD_DIR = resolve(ROOT, 'public/models/products')

  const CAD_INDEX_PATH = resolve(ROOT, 'src/data/cad-index.json')
  const MAX_UPLOAD_BYTES = 512 * 1024 * 1024 // 512 MB

  let _cadIndex = null
  let _cadIndexMtime = 0

  async function getCadIndex() {
    try {
      const s = await stat(CAD_INDEX_PATH)
      const mtime = s.mtimeMs
      if (_cadIndex && mtime === _cadIndexMtime) return _cadIndex
      const raw = JSON.parse(await readFile(CAD_INDEX_PATH, 'utf-8'))
      const objDir = raw.objDir || '/models/obj'
      const map = new Map()
      for (const [pid, files] of Object.entries(raw.productCadFiles || {})) {
        map.set(pid, files.map(f => `${objDir}/${f}`))
      }
      _cadIndex = map
      _cadIndexMtime = mtime
            log.info(`[dashboard-api] CAD-Index geladen: ${map.size} Produkt-Zuordnungen.`)
      return map
    } catch { return new Map() }
  }

  function enrichProductCadFiles(product, cadIndex) {
    const discovered = cadIndex.get(product.id) || []
    if (!discovered.length) return product
    const existing = new Set(product.cadFiles || [])
    const merged = [...existing]
    for (const f of discovered) {
      if (!existing.has(f)) merged.push(f)
    }
    return { ...product, cadFiles: merged }
  }

  // ── GLB Orientierungs-Erkennung ──────────────────────────────────────
  const _oriCache = new Map()

  function isIdQuat(x, y, z, w) {
    return Math.abs(x) < .01 && Math.abs(y) < .01 && Math.abs(z) < .01 && Math.abs(Math.abs(w) - 1) < .01
  }
  function isZupCorrQuat(x, y, z, w) {
    return Math.abs(Math.abs(x) - .7071) < .02 && Math.abs(y) < .02 && Math.abs(z) < .02 && Math.abs(Math.abs(w) - .7071) < .02
  }
  function isZupCorrMatrix(m) {
    const a = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1]
    const b = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]
    const cl = r => r.every((v, i) => Math.abs(m[i] - v) < .02)
    return cl(a) || cl(b)
  }

  async function detectGlbOrientation(glbUrl) {
    if (!glbUrl) return null
    if (_oriCache.has(glbUrl)) return _oriCache.get(glbUrl)
    try {
      const absPath = resolve(ROOT, 'public', ...glbUrl.replace(/^\//, '').split('/'))
      const fh = await open(absPath, 'r')
      try {
        // Header: 12 bytes (magic + version + length), then chunk header: 8 bytes
        const headerBuf = Buffer.alloc(20)
        await fh.read(headerBuf, 0, 20, 0)
        const magic = headerBuf.readUInt32LE(0)
        if (magic !== 0x46546C67) { _oriCache.set(glbUrl, null); return null }
        const jsonLen = headerBuf.readUInt32LE(12)
        // Schutz gegen manipulierte/korrupte GLBs: unbegrenztes Buffer.alloc vermeiden
        const MAX_GLB_JSON_BYTES = 64 * 1024 * 1024 // 64 MB reicht für realistische Szenen
        if (!Number.isFinite(jsonLen) || jsonLen <= 0 || jsonLen > MAX_GLB_JSON_BYTES) {
          _oriCache.set(glbUrl, null)
          return null
        }
        const jsonBuf = Buffer.alloc(jsonLen)
        await fh.read(jsonBuf, 0, jsonLen, 20)
        const json = JSON.parse(jsonBuf.toString('utf-8'))
        const rootIndices = json.scenes?.[json.scene ?? 0]?.nodes || []
        let hasZup = false, hasRot = false
        for (const idx of rootIndices) {
          const node = json.nodes?.[idx]
          if (!node) continue
          if (node.rotation) {
            const [qx, qy, qz, qw] = node.rotation
            if (isZupCorrQuat(qx, qy, qz, qw)) hasZup = true
            else if (!isIdQuat(qx, qy, qz, qw)) hasRot = true
          }
          if (node.matrix) {
            const m = node.matrix
            const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
            if (!m.every((v, i) => Math.abs(v - id[i]) < 0.001)) {
              if (isZupCorrMatrix(m)) hasZup = true
              else hasRot = true
            }
          }
        }
        const result = hasZup ? 'z-up' : hasRot ? 'y-up-root' : 'y-up'
        _oriCache.set(glbUrl, result)
        return result
      } finally { await fh.close() }
    } catch {
      _oriCache.set(glbUrl, null)
      return null
    }
  }

  async function enrichProductOrientation(product) {
    if (product.orientation) return product
    if (!product.glbFile) return product
    const detected = await detectGlbOrientation(product.glbFile)
    if (!detected) return product
    return { ...product, _detectedOrientation: detected }
  }

  function readBody(req, maxBytes = MAX_UPLOAD_BYTES) {
    return new Promise((res, rej) => {
      const chunks = []
      let total = 0
      req.on('data', c => {
        total += c.length
        if (total > maxBytes) { req.destroy(); rej(new Error(`Upload zu groß (max ${Math.round(maxBytes / 1024 / 1024)} MB)`)); return }
        chunks.push(c)
      })
      req.on('end', () => res(Buffer.concat(chunks)))
      req.on('error', rej)
    })
  }

  // Prüft, ob resolvedPath innerhalb basePath liegt. Robust gegen /a vs /a-evil
  // und plattform-neutral (Windows-Backslashes via path.relative/sep).
  function isSafePath(basePath, resolvedPath) {
    const base = resolve(basePath)
    const target = resolve(resolvedPath)
    if (target === base) return true
    const rel = relative(base, target)
    if (!rel || rel === '') return true
    if (rel.startsWith('..')) return false
    if (isAbsolute(rel)) return false
    // Sicherheitshalber gegen mögliche Separator-Tricks
    if (rel.split(pathSep).some(seg => seg === '..')) return false
    return true
  }

  async function walkGlb(dir, rel = '') {
    const entries = await readdir(dir, { withFileTypes: true })
    const results = []
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name
      const fullPath = resolve(dir, e.name)
      const isDir = e.isDirectory() || (e.isSymbolicLink() && (await stat(fullPath)).isDirectory())
      if (isDir) {
        results.push(...await walkGlb(fullPath, childRel))
      } else if ((e.isFile() || e.isSymbolicLink()) && e.name.toLowerCase().endsWith('.glb')) {
        results.push(childRel)
      }
    }
    return results
  }

  return {
    name: 'dashboard-api',
    configureServer(server) {
      /** Basis-URL für Puppeteer-Thumbnails (muss mit Vite-Host/Port übereinstimmen). */
      let viteServerOrigin = `http://127.0.0.1:${server.config?.server?.port ?? 5050}`
      server.httpServer?.once('listening', () => {
        const addr = server.httpServer?.address()
        if (addr && typeof addr === 'object') {
          const rawHost = addr.address
          const host =
            rawHost === '::' || rawHost === '0.0.0.0' || rawHost === '::1' ? '127.0.0.1' : rawHost
          viteServerOrigin = `http://${host}:${addr.port}`
        }
      })
      server.httpServer?.on('close', () => {
        import('../thumbnail/headlessThumbnail.mjs')
          .then((m) => m.closeThumbnailBrowser?.())
          .catch(() => {})
      })

      // ── Request-Logging (alle /__api/*, inkl. 403) ─────────────────────
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith('/__api/')) return next()
        withRequestLogger(req, res, httpLog)
        next()
      })

      // ── CSRF-/Origin-Guard für alle /__api/*-Endpunkte ────────────────
      // Der Dev-Server bindet zwar standardmäßig auf 127.0.0.1, aber ohne
      // Origin-Check könnte eine beliebige im Browser geöffnete Seite per
      // JS Cross-Origin-Requests auf die unauthentifizierten __api-Endpoints
      // schicken und Produktdaten / Uploads manipulieren. Wir lassen nur
      // Requests mit passendem Origin/Referer oder gültigem Shared-Secret zu.
      const ALLOWED_ORIGINS = new Set([
        `http://127.0.0.1:${server.config?.server?.port ?? 5050}`,
        `http://localhost:${server.config?.server?.port ?? 5050}`,
        'http://127.0.0.1:5050',
        'http://localhost:5050',
      ])
      if (process.env.SHOWROOM_ORIGIN) {
        for (const o of process.env.SHOWROOM_ORIGIN.split(',')) {
          const t = o.trim()
          if (t) ALLOWED_ORIGINS.add(t)
        }
      }
      const SHARED_SECRET = process.env.SHOWROOM_API_TOKEN || ''
      const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

      function originOf(url) {
        try { const u = new URL(url); return `${u.protocol}//${u.host}` } catch { return '' }
      }
      function originMatchesRequestHost(origin, hostHeader) {
        const host = String(hostHeader || '').trim()
        if (!host || !origin) return false
        const o = origin.toLowerCase()
        const h = host.toLowerCase()
        return o === `http://${h}` || o === `https://${h}`
      }

      function isTrustedOrigin(req) {
        if (SHARED_SECRET && req.headers['x-showroom-token'] === SHARED_SECRET) return true
        const origin = req.headers.origin || (req.headers.referer ? originOf(req.headers.referer) : '')
        if (!origin) {
          // Same-origin Browser-Requests haben je nach Kontext keinen Origin-Header
          // (z.B. GET-Navigationen). Wir erlauben das nur für lesende Methoden.
          return !UNSAFE_METHODS.has(String(req.method || '').toUpperCase())
        }
        if (ALLOWED_ORIGINS.has(origin)) return true
        // z. B. vite --host, LAN-IP, anderer Port (strictPort): Seite und API teilen sich Host
        if (originMatchesRequestHost(origin, req.headers.host)) return true
        return false
      }

      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith('/__api/')) return next()
        if (isTrustedOrigin(req)) return next()
        res.statusCode = 403
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'Origin nicht vertrauenswürdig' }))
      })

      // ── Browser-Logs (nur Dev-Client; nach Origin-Guard) ───────────────
      const FRONTEND_LOG_MAX = 16 * 1024
      const FRONTEND_LOG_RATE = 50
      /** @type {Map<string, { windowStart: number, count: number }>} */
      const _frontendLogRate = new Map()
      function clientIp(req) {
        const a = req.socket?.remoteAddress
        return typeof a === 'string' && a ? a : 'unknown'
      }
      function allowFrontendLog(ip) {
        const now = Date.now()
        let b = _frontendLogRate.get(ip)
        if (!b || now - b.windowStart >= 1000) {
          b = { windowStart: now, count: 0 }
        }
        b.count += 1
        _frontendLogRate.set(ip, b)
        if (b.count > FRONTEND_LOG_RATE) return false
        return true
      }

      server.middlewares.use(async (req, res, next) => {
        const pathOnly = req.url ? req.url.split('?')[0] : ''
        if (pathOnly !== '/__api/log' || req.method !== 'POST') return next()
        res.setHeader('Cache-Control', 'no-store')
        if (!allowFrontendLog(clientIp(req))) {
          res.statusCode = 429
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: false, error: 'Zu viele Log-Events' }))
          return
        }
        try {
          const buf = await readBody(req, FRONTEND_LOG_MAX)
          let body
          try {
            body = JSON.parse(buf.toString('utf-8'))
          } catch (e) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: false, error: `Ungültiges JSON: ${e.message}` }))
            return
          }
          const level = String(body?.level || 'info').toLowerCase()
          if (!['error', 'warn', 'info'].includes(level)) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: false, error: 'Ungültiges level' }))
            return
          }
          const clientScope = String(body?.scope || 'client').slice(0, 200)
          const msg = String(body?.msg || '').slice(0, 4000)
          const payload = {
            clientScope,
            ua: String(body?.ua || '').slice(0, 512),
            url: String(body?.url || '').slice(0, 1024),
            ts: body?.ts,
            data: body?.data,
            fields: body?.fields,
          }
          if (level === 'error') frontendIngestLog.error(msg, payload)
          else if (level === 'warn') frontendIngestLog.warn(msg, payload)
          else frontendIngestLog.info(msg, payload)
          res.statusCode = 204
          res.end()
        } catch (e) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: false, error: String(e?.message || e).slice(0, 500) }))
        }
      })

      const blenderRenderMw = createBlenderRenderMiddleware({ ROOT, readBody, isSafePath })
      server.middlewares.use('/__api/blender-render', blenderRenderMw)

      // ── Produkte: Cache + Mutex + atomares Schreiben ────────────────────
      let _productsCache = null
      let _loadPromise = null
      let _saveQueue = Promise.resolve()

      function cloneProductsData(data) {
        try {
          const d = data && typeof data === 'object' ? data : { products: [] }
          return JSON.parse(JSON.stringify(d))
        } catch {
          return { products: [] }
        }
      }

      /** Liefert immer eine tiefe Kopie – verhindert Mutationen am gecachten Graphen durch parallele Handler. */
      async function loadProducts() {
        if (_loadPromise) await _loadPromise
        if (!_productsCache) {
          _loadPromise = (async () => {
            try {
              const raw = await readFile(PRODUCTS_PATH, 'utf-8')
              const parsed = JSON.parse(raw)
              _productsCache =
                parsed && typeof parsed === 'object' && Array.isArray(parsed.products)
                  ? parsed
                  : { products: [] }
            } catch {
              _productsCache = { products: [] }
            } finally {
              _loadPromise = null
            }
          })()
          await _loadPromise
        }
        return cloneProductsData(_productsCache)
      }

      // Atomares Write + Serialisierung: verhindert Race-Conditions bei
      // parallelen PATCH/POST-Requests und teil-geschriebene products.json
      // bei Crash/Abbruch. Cache erst nach erfolgreichem rename aktualisieren.
      async function saveProducts(data) {
        const task = _saveQueue.then(async () => {
          const tmp = `${PRODUCTS_PATH}.tmp-${process.pid}-${Date.now()}`
          const json = JSON.stringify(data, null, 2) + '\n'
          await writeFile(tmp, json, 'utf-8')
          try {
            await rename(tmp, PRODUCTS_PATH)
          } catch (err) {
            try { await unlink(tmp) } catch {}
            throw err
          }
          _productsCache = cloneProductsData(data)
        })
        _saveQueue = task.catch(() => {}) // Queue darf nicht brechen
        return task
      }

      loadProducts().then((d) => {
                log.info(`[dashboard-api] ${d?.products?.length ?? 0} Produkte geladen.`)
      }).catch(() => {})

      // Invalidierung, wenn products.json extern (z.B. durch Scripts) geändert wurde
      try {
        fsWatch(PRODUCTS_PATH, { persistent: false }, () => { _productsCache = null })
      } catch {}

      // RAL-Palette unter /ralColors.json (für MTL-Colormatching-Tool)
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== 'GET' || (req.url && req.url.split('?')[0] !== '/ralColors.json')) return next()
        try {
          const ralPath = resolve(ROOT, 'src/data/ralColors.json')
          const body = await readFile(ralPath, 'utf-8')
          res.setHeader('Content-Type', 'application/json')
          res.end(body)
        } catch {
          next()
        }
      })

      const PRODUCTS_SAVE_MAX_BYTES = 10 * 1024 * 1024 // 10 MB reicht für tausende Produkte
      server.middlewares.use('/__api/save-products', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
        res.setHeader('Content-Type', 'application/json')
        try {
          const body = await readBody(req, PRODUCTS_SAVE_MAX_BYTES)
          let parsed
          try {
            parsed = JSON.parse(body.toString('utf-8'))
          } catch (err) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: `Ungültiges JSON: ${err.message}` }))
            return
          }
          // Schema-Mini-Validierung: Array mit id-bewehrten Einträgen
          if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.products)) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'Ungültige Struktur: products-Array fehlt' }))
            return
          }
          const ids = new Set()
          for (const p of parsed.products) {
            if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !p.id) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'Jedes Produkt braucht eine string-id' }))
              return
            }
            if (ids.has(p.id)) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: `Duplizierte Produkt-id: ${p.id}` }))
              return
            }
            ids.add(p.id)
          }
          await saveProducts(parsed)
          res.end(JSON.stringify({ ok: true, count: parsed.products.length }))
        } catch (e) {
          res.statusCode = e.message?.includes('zu groß') ? 413 : 500
          res.end(JSON.stringify({ error: e.message }))
        }
      })

      server.middlewares.use('/__api/upload-glb', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
        try {
          const rawName = decodeURIComponent(req.headers['x-filename'] || 'upload.glb')
          const parts = rawName.split('/')
          const safeParts = parts.filter(p => p && p !== '..' && p !== '.').map(p => p.replace(/[^a-zA-Z0-9_\-. ]/g, '_'))
          const safePath = safeParts.join('/')
          const targetFile = resolve(MODELS_UPLOAD_DIR, ...safeParts)
          if (!isSafePath(MODELS_UPLOAD_DIR, targetFile)) {
            res.statusCode = 400; res.end(JSON.stringify({ error: 'Ungültiger Dateipfad' })); return
          }
          const targetDir = resolve(MODELS_UPLOAD_DIR, ...safeParts.slice(0, -1))
          await mkdir(targetDir, { recursive: true })
          if (await pathExists(targetFile) && !headerAllowsOverwrite(req)) {
            res.statusCode = 409
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({
              ok: false,
              conflict: true,
              exists: true,
              path: `/models/products/${safePath}`,
              message: 'Datei existiert bereits',
            }))
            return
          }
          const body = await readBody(req)
          await writeFile(targetFile, body)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, filename: safePath, path: `/models/products/${safePath}` }))
        } catch (e) {
          res.statusCode = e.message?.includes('zu groß') ? 413 : 500
          res.end(JSON.stringify({ error: e.message }))
        }
      })

      server.middlewares.use('/__api/upload-cad', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
        try {
          const rawName = decodeURIComponent(req.headers['x-filename'] || 'upload.obj')
          const parts = rawName.split('/')
          const safeParts = parts.filter(p => p && p !== '..' && p !== '.').map(p => p.replace(/[^a-zA-Z0-9_\-. ]/g, '_'))
          const safePath = safeParts.join('/')
          const targetFile = resolve(MODELS_UPLOAD_DIR, ...safeParts)
          if (!isSafePath(MODELS_UPLOAD_DIR, targetFile)) {
            res.statusCode = 400; res.end(JSON.stringify({ error: 'Ungültiger Dateipfad' })); return
          }
          const targetDir = resolve(MODELS_UPLOAD_DIR, ...safeParts.slice(0, -1))
          await mkdir(targetDir, { recursive: true })
          if (await pathExists(targetFile) && !headerAllowsOverwrite(req)) {
            res.statusCode = 409
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({
              ok: false,
              conflict: true,
              exists: true,
              path: `/models/products/${safePath}`,
              message: 'Datei existiert bereits',
            }))
            return
          }
          const body = await readBody(req)
          await writeFile(targetFile, body)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, filename: safePath, path: `/models/products/${safePath}` }))
        } catch (e) {
          res.statusCode = e.message?.includes('zu groß') ? 413 : 500
          res.end(JSON.stringify({ error: e.message }))
        }
      })

      // POST /__api/delete-uploaded-cad  Body: { path: "/models/products/…" } — nur unter public/models/products
      server.middlewares.use('/__api/delete-uploaded-cad', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        res.setHeader('Content-Type', 'application/json')
        try {
          const body = JSON.parse((await readBody(req, 16 * 1024)).toString('utf-8'))
          const rel = String(body?.path || '').trim()
          if (!rel.startsWith('/models/products/')) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'Nur Pfade unter /models/products/ dürfen gelöscht werden' }))
            return
          }
          const parts = rel.replace(/^\/+/, '').split('/').filter(Boolean)
          const abs = resolve(ROOT, 'public', ...parts)
          if (!isSafePath(MODELS_UPLOAD_DIR, abs)) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'Ungültiger Dateipfad' }))
            return
          }
          try {
            await unlink(abs)
          } catch (e) {
            if (e?.code !== 'ENOENT') {
              res.statusCode = 500
              res.end(JSON.stringify({ error: e.message || 'Löschen fehlgeschlagen' }))
              return
            }
          }
          res.statusCode = 200
          res.end(JSON.stringify({ ok: true }))
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: e.message || 'Löschen fehlgeschlagen' }))
        }
      })

      // ── Projekt-Mapping (MTL→RAL) speichern ─────────────────────────────
      // POST /__api/save-mapping  Body: Mapping-JSON (sourcePalette, matchPalette, matchRal, …)
      // Speichert unter public/mtl-ral-color-mapping.json – sofort für Konverter und Massenexport nutzbar.
      const MAPPING_FILE = resolve(ROOT, 'public', 'mtl-ral-color-mapping.json')
      const MAPPING_SAVE_MAX_BYTES = 1024 * 1024 // 1 MB
      server.middlewares.use('/__api/save-mapping', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
        res.setHeader('Content-Type', 'application/json')
        try {
          const body = await readBody(req, MAPPING_SAVE_MAX_BYTES)
          const raw = body.toString('utf-8')
          if (raw.length > MAPPING_SAVE_MAX_BYTES) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: `Mapping zu groß (max ${MAPPING_SAVE_MAX_BYTES / 1024} KB). Nur Farb-Mapping speichern, nicht pro Datei.` }))
            return
          }
          const data = JSON.parse(raw)
          if (!data || typeof data !== 'object') {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'Ungültiges JSON' }))
            return
          }
          if (!Array.isArray(data.sourcePalette) && !Array.isArray(data.matchPalette)) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'Mapping muss sourcePalette oder matchPalette enthalten' }))
            return
          }
          await writeFile(MAPPING_FILE, JSON.stringify(data, null, 2) + '\n', 'utf-8')
          res.statusCode = 200
          res.end(JSON.stringify({ ok: true, path: '/mtl-ral-color-mapping.json' }))
        } catch (e) {
          if (e.message && e.message.includes('zu groß')) {
            res.statusCode = 413
            res.end(JSON.stringify({ error: e.message }))
          } else {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message || 'Speichern fehlgeschlagen' }))
          }
        }
      })

      // POST /__api/save-vertex-reduction-rules  Body: { vertexReductionRules: [...] } — merged in public/mtl-ral-color-mapping.json
      server.middlewares.use('/__api/save-vertex-reduction-rules', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        res.setHeader('Content-Type', 'application/json')
        try {
          const body = JSON.parse((await readBody(req, MAPPING_SAVE_MAX_BYTES)).toString('utf-8'))
          if (!body || typeof body !== 'object' || !Array.isArray(body.vertexReductionRules)) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'vertexReductionRules[] erwartet' }))
            return
          }
          let existing
          try {
            existing = JSON.parse(await readFile(MAPPING_FILE, 'utf-8'))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: `Mapping-Datei nicht lesbar: ${e.message}` }))
            return
          }
          if (!existing || typeof existing !== 'object') existing = {}
          existing.vertexReductionRules = body.vertexReductionRules
          await writeFile(MAPPING_FILE, JSON.stringify(existing, null, 2) + '\n', 'utf-8')
          res.statusCode = 200
          res.end(JSON.stringify({ ok: true, path: '/mtl-ral-color-mapping.json' }))
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: e.message || 'Speichern fehlgeschlagen' }))
        }
      })

      // POST /__api/save-name-color-rules  Body: { nameColorRules: [...] } — merged in public/mtl-ral-color-mapping.json
      server.middlewares.use('/__api/save-name-color-rules', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        res.setHeader('Content-Type', 'application/json')
        try {
          const body = JSON.parse((await readBody(req, MAPPING_SAVE_MAX_BYTES)).toString('utf-8'))
          if (!body || typeof body !== 'object' || !Array.isArray(body.nameColorRules)) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'nameColorRules[] erwartet' }))
            return
          }
          let existing
          try {
            existing = JSON.parse(await readFile(MAPPING_FILE, 'utf-8'))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: `Mapping-Datei nicht lesbar: ${e.message}` }))
            return
          }
          if (!existing || typeof existing !== 'object') existing = {}
          existing.nameColorRules = body.nameColorRules
          await writeFile(MAPPING_FILE, JSON.stringify(existing, null, 2) + '\n', 'utf-8')
          res.statusCode = 200
          res.end(JSON.stringify({ ok: true, path: '/mtl-ral-color-mapping.json' }))
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: e.message || 'Speichern fehlgeschlagen' }))
        }
      })

      // ── MTL lesen/schreiben (Dashboard-Editor) ───────────────────────────
      const MODELS_PUBLIC = resolve(ROOT, 'public', 'models')
      const MTL_API_MAX_BYTES = 1024 * 1024 // 1 MB

      function resolvePublicMtlPath(relPath) {
        const raw = String(relPath || '').trim()
        if (!raw || !raw.toLowerCase().endsWith('.mtl')) return null
        const clean = raw.startsWith('/') ? raw.slice(1) : raw
        if (!clean.toLowerCase().startsWith('models/')) return null
        const abs = resolve(ROOT, 'public', ...clean.split('/'))
        if (!isSafePath(MODELS_PUBLIC, abs)) return null
        return abs
      }

      function normalizeMtlMaterialsPayload(arr) {
        if (!Array.isArray(arr)) return null
        return arr.map((m) => {
          const base = createEmptyMaterial(typeof m?.name === 'string' ? m.name : 'Material')
          for (const k of ['Ka', 'Kd', 'Ks', 'Ke', 'Tf']) {
            if (m[k] && typeof m[k] === 'object' && [m[k].r, m[k].g, m[k].b].every((x) => Number.isFinite(Number(x)))) {
              base[k] = { r: Number(m[k].r), g: Number(m[k].g), b: Number(m[k].b) }
            }
          }
          for (const k of ['Ns', 'Ni', 'd', 'Tr', 'illum']) {
            if (m[k] != null && m[k] !== '' && Number.isFinite(Number(m[k]))) base[k] = Number(m[k])
            else if (m[k] === null) base[k] = null
          }
          if (m.maps && typeof m.maps === 'object') {
            for (const key of Object.keys(base.maps)) {
              if (Object.prototype.hasOwnProperty.call(m.maps, key)) {
                const v = m.maps[key]
                base.maps[key] = v == null || v === '' ? null : String(v)
              }
            }
          }
          base.unknown = Array.isArray(m.unknown) ? m.unknown.map((l) => (typeof l === 'string' ? l : String(l))) : []
          return base
        })
      }

      server.middlewares.use('/__api/mtl', async (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        const method = String(req.method || '').toUpperCase()
        if (method !== 'GET' && method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ error: 'Nur GET oder POST' }))
          return
        }
        try {
          let relPath = ''
          /** @type {object | null} */
          let postBody = null
          if (method === 'GET') {
            const q = (req.url && req.url.includes('?')) ? req.url.split('?')[1] : ''
            relPath = new URLSearchParams(q).get('path') || ''
          } else {
            const raw = (await readBody(req, MTL_API_MAX_BYTES)).toString('utf-8')
            if (raw.length > MTL_API_MAX_BYTES) {
              res.statusCode = 413
              res.end(JSON.stringify({ error: 'MTL-Payload zu groß (max 1 MB)' }))
              return
            }
            postBody = JSON.parse(raw)
            relPath = postBody.path || postBody.relPath || ''
          }

          const abs = resolvePublicMtlPath(relPath)
          if (!abs) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'Ungültiger oder unsicherer MTL-Pfad (erwartet z. B. /models/obj/… .mtl)' }))
            return
          }

          if (method === 'GET') {
            let text
            try {
              text = await readFile(abs, 'utf-8')
            } catch (e) {
              res.statusCode = 404
              res.end(JSON.stringify({ error: 'Datei nicht gefunden' }))
              return
            }
            const parsed = parseMtl(text)
            res.statusCode = 200
            res.end(JSON.stringify({
              ok: true,
              path: relPath.startsWith('/') ? relPath : `/${relPath}`,
              header: parsed.header,
              materials: parsed.materials,
            }))
            return
          }

          const body = postBody
          if (!body || typeof body !== 'object') {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'Ungültiger JSON-Body' }))
            return
          }
          const materials = normalizeMtlMaterialsPayload(body.materials)
          if (!materials || materials.length === 0) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'materials[] mit mindestens einem Eintrag erwartet' }))
            return
          }
          const header = Array.isArray(body.header) ? body.header.map((l) => (typeof l === 'string' ? l : String(l))) : []
          const text = serializeMtl({ header, materials })
          await copyFile(abs, `${abs}.bak`)
          await writeFile(abs, text, 'utf-8')
          res.statusCode = 200
          res.end(JSON.stringify({ ok: true, path: relPath.startsWith('/') ? relPath : `/${relPath}` }))
        } catch (e) {
          if (e.message && e.message.includes('zu groß')) {
            res.statusCode = 413
            res.end(JSON.stringify({ error: e.message }))
            return
          }
          res.statusCode = 500
          res.end(JSON.stringify({ error: e.message || 'MTL-API-Fehler' }))
        }
      })

      // ── OBJ: mtllib-Zeile lesen/setzen (Dashboard) ───────────────────────
      const OBJ_MTLLIB_MAX_BYTES = 50 * 1024 * 1024

      function resolvePublicObjPath(relPath) {
        const raw = String(relPath || '').trim()
        if (!raw || !raw.toLowerCase().endsWith('.obj')) return null
        const clean = raw.startsWith('/') ? raw.slice(1) : raw
        if (!clean.toLowerCase().startsWith('models/')) return null
        const abs = resolve(ROOT, 'public', ...clean.split('/'))
        if (!isSafePath(MODELS_PUBLIC, abs)) return null
        return abs
      }

      server.middlewares.use('/__api/obj-mtllib', async (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        const method = String(req.method || '').toUpperCase()
        if (method !== 'GET' && method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ error: 'Nur GET oder POST' }))
          return
        }
        const MTLLIB_POST_MAX = 65536
        try {
          let relPath = ''
          let postBody = null
          if (method === 'GET') {
            const q = (req.url && req.url.includes('?')) ? req.url.split('?')[1] : ''
            relPath = new URLSearchParams(q).get('path') || ''
          } else {
            const raw = (await readBody(req, MTLLIB_POST_MAX)).toString('utf-8')
            postBody = JSON.parse(raw)
            relPath = postBody.path || postBody.relPath || ''
          }

          const abs = resolvePublicObjPath(relPath)
          if (!abs) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'Ungültiger oder unsicherer OBJ-Pfad (erwartet z. B. /models/obj/… .obj)' }))
            return
          }

          const st = await stat(abs)
          if (st.size > OBJ_MTLLIB_MAX_BYTES) {
            res.statusCode = 413
            res.end(JSON.stringify({ error: `OBJ zu groß (max ${Math.round(OBJ_MTLLIB_MAX_BYTES / 1024 / 1024)} MB)` }))
            return
          }

          if (method === 'GET') {
            let text
            try {
              text = await readFile(abs, 'utf-8')
            } catch (e) {
              res.statusCode = 404
              res.end(JSON.stringify({ error: 'Datei nicht gefunden' }))
              return
            }
            const mtllib = getMtllibFromObjContent(text)
            res.statusCode = 200
            res.end(JSON.stringify({
              ok: true,
              path: relPath.startsWith('/') ? relPath : `/${relPath}`,
              mtllib: mtllib ?? '',
            }))
            return
          }

          const body = postBody
          if (!body || typeof body !== 'object' || typeof body.mtllib !== 'string') {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'JSON mit path und mtllib (string) erwartet' }))
            return
          }
          if (!String(body.mtllib).trim()) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'mtllib darf nicht leer sein' }))
            return
          }
          const text = await readFile(abs, 'utf-8')
          let next
          try {
            next = setMtllibInObjContent(text, body.mtllib)
          } catch (err) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: err.message || 'Ungültige mtllib-Angabe' }))
            return
          }
          await copyFile(abs, `${abs}.bak`)
          await writeFile(abs, next, 'utf-8')
          res.statusCode = 200
          res.end(JSON.stringify({
            ok: true,
            path: relPath.startsWith('/') ? relPath : `/${relPath}`,
            mtllib: getMtllibFromObjContent(next) ?? '',
          }))
        } catch (e) {
          res.statusCode = e.message && e.message.includes('zu groß') ? 413 : 500
          res.end(JSON.stringify({ error: e.message || 'OBJ-mtllib-API-Fehler' }))
        }
      })

      // ── Konvertiertes GLB registrieren ──────────────────────────────────
      // POST /__api/register-converted
      // Body: { outputPaths: string[], cadFileUrls?: string[], productId?: string, conversionPreset?: object }
      server.middlewares.use('/__api/register-converted', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
        try {
          const body = JSON.parse((await readBody(req)).toString('utf-8'))
          const { outputPaths = [], cadFileUrls = [], productId, conversionPreset } = body
          const data = await loadProducts()
          const warnings = []

          /** Einheitlicher Dateiname für public/models/output (muss mit glbFile übereinstimmen). */
          const safeFilenameFromPath = (raw) => {
            const name = String(raw || '').split(/[/\\]/).pop() || ''
            return name.replace(/[^a-zA-Z0-9_\-. ]/g, '_')
          }

          const outputDir = resolve(ROOT, 'public/models/output')
          const bakeScript = resolve(ROOT, 'scripts/bake-glb-yup.js')
          const productForRal = productId ? data.products.find((x) => x.id === productId) : null
          const converterApiBase = process.env.CONVERTER_API_URL || 'http://localhost:3000'

          await mkdir(outputDir, { recursive: true })

          const added = []
          /** @type {{ absPath: string, safe: string, rawBasename: string, glbUrl: string, localPath: string, p: object }[]} */
          const glbRows = []

          for (const absPath of outputPaths) {
            if (!/\.glb$/i.test(absPath)) continue
            const rawBasename = String(absPath).split(/[/\\]/).pop() || ''
            const safe = safeFilenameFromPath(absPath)
            if (!safe) continue
            const glbUrl = `/models/output/${safe}`
            _oriCache.delete(glbUrl)
            const id = safe.replace(/\.glb$/i, '').replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-')
            const rawGlbUrl = `/models/output/${rawBasename}`

            let usdzUrl = null
            const usdzSafePath = resolve(outputDir, safe.replace(/\.glb$/i, '.usdz'))
            const usdzRawPath = resolve(outputDir, rawBasename.replace(/\.glb$/i, '.usdz'))
            try {
              await stat(usdzSafePath)
              usdzUrl = glbUrl.replace(/\.glb$/i, '.usdz')
            } catch {
              if (
                rawBasename !== safe &&
                isSafePath(outputDir, usdzRawPath)
              ) {
                try {
                  await stat(usdzRawPath)
                  await copyFile(usdzRawPath, usdzSafePath)
                  usdzUrl = glbUrl.replace(/\.glb$/i, '.usdz')
                                    log.info(`[register-converted] USDZ von Roh-Dateiname nach safe kopiert → ${safe.replace(/\.glb$/i, '.usdz')}`)
                } catch (_) {}
              }
            }

            let p = (productId && data.products.find((x) => x.id === productId))
              || data.products.find((x) => x.glbFile === glbUrl)
              || data.products.find((x) => x.glbFile === rawGlbUrl)
              || data.products.find((x) => x.id === id)

            const previousGlbFile = p?.glbFile || null
            const previousUsdzFile = p?.usdzFile || null
            let isNewProduct = false

            if (p) {
              p.glbFile = glbUrl
              if (usdzUrl) p.usdzFile = usdzUrl
              delete p.orientation
              if (cadFileUrls.length) {
                const set = new Set(p.cadFiles || [])
                cadFileUrls.forEach((f) => set.add(f))
                p.cadFiles = [...set]
              }
            } else {
              isNewProduct = true
              p = {
                id,
                name: `Produkt ${id}`,
                glbFile: glbUrl,
                cadFiles: cadFileUrls,
                colorableMeshes: [],
                defaultColor: '',
                specs: { load: '–', height: '–', width: '–', depth: '–' },
                shopwareProductId: '',
                createdAt: new Date().toISOString(),
              }
              if (usdzUrl) p.usdzFile = usdzUrl
              data.products.push(p)
            }
            added.push(p.id)
            glbRows.push({
              absPath,
              safe,
              rawBasename,
              glbUrl,
              localPath: resolve(outputDir, safe),
              p,
              previousGlbFile,
              previousUsdzFile,
              isNewProduct,
            })
          }

          if (conversionPreset && typeof conversionPreset === 'object' && !Array.isArray(conversionPreset)) {
            const targetId = productId || (added.length === 1 ? added[0] : null)
            if (targetId) {
              const tgt = data.products.find((x) => x.id === targetId)
              if (tgt) tgt.conversionPreset = conversionPreset
            }
          }

          let ralCode = null
          let ralSource = null
          {
            const dcStr = resolveDefaultColorStringForPipeline(productForRal)
            if (dcStr) {
              const m = String(dcStr).match(/RAL\s*(\d{4})/i)
              if (m) {
                ralCode = m[1]
                ralSource = 'defaultColor'
              }
            }
          }
          if (!ralCode && productForRal?._mtlColors?.dominantRal) {
            const d = String(productForRal._mtlColors.dominantRal).trim()
            const mDom = d.match(/^RAL\s*(\d{4})$/i)
            if (mDom) {
              ralCode = mDom[1]
              ralSource = 'mtlMapping'
            }
          }
          if (!ralCode && productForRal) {
            try {
              const gtinRal = await resolveRalCodeFromGtinStamm(converterApiBase, productForRal)
              if (gtinRal?.ralCode) {
                ralCode = gtinRal.ralCode
                ralSource = 'gtin'
              }
            } catch (_) {}
          }
          if (productId && !ralCode && productForRal) {
            log.scoped('register-converted').info(
              `Hinweis: Produkt "${productForRal.name}" – kein RAL (weder Stammdaten/Mapping noch GTIN-Stamm).`,
            )
          } else if (ralCode) {
                        log.info(`[register-converted] Bake-RAL ${ralCode} (Quelle: ${ralSource})`)
          }
          try {
            await mkdir(outputDir, { recursive: true })
            await stat(bakeScript)
          } catch (e) {
                        log.scoped("register-converted").warn("Output-Verzeichnis/Bake-Skript:", e.message)
          }

          let mergedBakeOverrides = null
          let mergedNameColorRuleEntries = []
          let mergedGeometryColorRuleEntries = []
          let mergedVertexReductionRuleEntries = []
          let mergedVisibilityRuleEntries = []
          if (productForRal) {
            try {
              const mappingPath = resolve(ROOT, 'public', 'mtl-ral-color-mapping.json')
              const mappingRaw = await readFile(mappingPath, 'utf-8').catch(() => null)
              if (mappingRaw) {
                const mapping = JSON.parse(mappingRaw)
                mergedNameColorRuleEntries = mergeNameColorRuleEntries(mapping, productForRal.conversionPreset)
                mergedGeometryColorRuleEntries = mergeGeometryColorRuleEntries(mapping, productForRal.conversionPreset)
                mergedVertexReductionRuleEntries = mergeVertexReductionRuleEntries(mapping, productForRal.conversionPreset)
                mergedVisibilityRuleEntries = mergeVisibilityRuleEntries(mapping, productForRal.conversionPreset)
                const ralRaw = await readFile(resolve(ROOT, 'src/data/ralColors.json'), 'utf-8')
                const ralPalette = JSON.parse(ralRaw)
                const getRalHex = (ralKey) => {
                  if (!ralKey || !ralPalette[ralKey]?.hex) return null
                  return normalizeMappingHex(ralPalette[ralKey].hex)
                }
                mergedBakeOverrides = buildColorOverridesFromMapping(mapping, getRalHex)
                const presetCo = productForRal.conversionPreset?.colorOverrides
                if (presetCo && typeof presetCo === 'object' && !Array.isArray(presetCo)) {
                  mergedBakeOverrides = { ...mergedBakeOverrides, ...presetCo }
                }
                if (!mergedBakeOverrides || Object.keys(mergedBakeOverrides).length === 0) {
                  mergedBakeOverrides = null
                } else {
                  log.scoped('register-converted').info(
                    `Bake-Overrides aus Mapping/Preset: ${Object.keys(mergedBakeOverrides).length} Hex-Regel(n)`,
                  )
                }
              } else {
                mergedNameColorRuleEntries = mergeNameColorRuleEntries(null, productForRal.conversionPreset)
                mergedGeometryColorRuleEntries = mergeGeometryColorRuleEntries(null, productForRal.conversionPreset)
                mergedVertexReductionRuleEntries = mergeVertexReductionRuleEntries(null, productForRal.conversionPreset)
                mergedVisibilityRuleEntries = mergeVisibilityRuleEntries(null, productForRal.conversionPreset)
              }
            } catch (e) {
                            log.scoped("register-converted").warn("Mapping-Overrides für Bake:", e.message)
              mergedBakeOverrides = null
              mergedNameColorRuleEntries = mergeNameColorRuleEntries(null, productForRal?.conversionPreset)
              mergedGeometryColorRuleEntries = mergeGeometryColorRuleEntries(null, productForRal?.conversionPreset)
              mergedVertexReductionRuleEntries = mergeVertexReductionRuleEntries(null, productForRal?.conversionPreset)
              mergedVisibilityRuleEntries = mergeVisibilityRuleEntries(null, productForRal?.conversionPreset)
            }
          }
          if (mergedNameColorRuleEntries.length) {
                        log.info(`[register-converted] nameColorRules: ${mergedNameColorRuleEntries.length} Regel(n)`)
          }
          if (mergedGeometryColorRuleEntries.length) {
                        log.info(`[register-converted] geometryColorRules: ${mergedGeometryColorRuleEntries.length} Regel(n)`)
          }
          if (mergedVertexReductionRuleEntries.length) {
            log.scoped('register-converted').info(
              `vertexReductionRules: ${mergedVertexReductionRuleEntries.length} Regel(n) (global + Preset, last-wins)`,
            )
            // Detail-Dump der gemergten Regeln, damit im Bake-Log nachvollziehbar ist,
            // mit welchen Schranken (vMin/vMax/ratio/targetV/error) die Regeln tatsächlich
            // an `bake-glb-yup.js --name-rules` gehen.
            mergedVertexReductionRuleEntries.forEach((r, idx) => {
              const fields = [
                `target=${r.target ?? 'mesh'}`,
                r.pattern ? `pattern=/${r.pattern}/${r.flags || ''}` : null,
                r.vertexCountMin != null ? `vMin=${r.vertexCountMin}` : null,
                r.vertexCountMax != null ? `vMax=${r.vertexCountMax}` : null,
                r.ratio != null ? `ratio=${r.ratio}` : null,
                r.targetVertexCount != null ? `targetV=${r.targetVertexCount}` : null,
                r.error != null ? `error=${r.error}` : null,
                r.lockBorder ? 'lockBorder' : null,
              ].filter(Boolean)
                            log.info(`  [#${idx + 1}] ${fields.join(' · ')}`)
            })
          }
          if (mergedVisibilityRuleEntries.length) {
            log.scoped('register-converted').info(
              `visibilityRules: ${mergedVisibilityRuleEntries.length} Regel(n) (Preset, last-wins)`,
            )
            mergedVisibilityRuleEntries.forEach((r, idx) => {
              const fields = [
                `action=${r.action ?? 'hide'}`,
                `target=${r.target ?? 'mesh'}`,
                r.pattern ? `pattern=/${r.pattern}/${r.flags || ''}` : null,
              ].filter(Boolean)
                            log.info(`  [#${idx + 1}] ${fields.join(' · ')}`)
            })
          }

          const CONVERTER_BASE = process.env.CONVERTER_API_URL || 'http://localhost:3000'
          const converterOrigin = (() => {
            try {
              return new URL(CONVERTER_BASE).origin
            } catch {
              return 'http://localhost:3000'
            }
          })()

          for (const row of glbRows) {
            const { safe, rawBasename, glbUrl, localPath, p, absPath, previousGlbFile, previousUsdzFile, isNewProduct } = row
            if (!isSafePath(outputDir, localPath)) {
                            log.warn(`[register-converted] Ungültiger Dateipfad abgewiesen: ${absPath}`)
              warnings.push({
                productId: p?.id || productId || '',
                reason: 'invalid-path',
                expected: glbUrl,
              })
              continue
            }
            let needBake = false
            try {
              await stat(localPath)
              needBake = true
            } catch {
              const localRawPath = resolve(outputDir, rawBasename)
              if (
                rawBasename &&
                rawBasename !== safe &&
                isSafePath(outputDir, localRawPath)
              ) {
                try {
                  await stat(localRawPath)
                  await copyFile(localRawPath, localPath)
                                    log.info(`[register-converted] GLB von Roh-Dateiname nach safe kopiert: ${rawBasename} → ${safe}`)
                  needBake = true
                } catch (_) {}
              }
              // Direkter Kopier-Fallback: Konverter gibt absoluten Pfad zurück, symlink zeigt eventuell woanders hin.
              if (!needBake && typeof absPath === 'string' && absPath.startsWith('/')) {
                try {
                  const st = await stat(absPath)
                  if (st.isFile()) {
                    await copyFile(absPath, localPath)
                                        log.info(`[register-converted] GLB von absolutem Pfad kopiert: ${absPath} → ${safe}`)
                    needBake = true
                  }
                } catch (_) {}
              }
              if (!needBake) {
                const stem = safe.replace(/\.glb$/i, '')
                const rawStem = rawBasename.replace(/\.glb$/i, '')
                const tryUrls = [
                  `${converterOrigin}/outputs/${encodeURIComponent(safe)}`,
                  `${converterOrigin}/outputs/${encodeURIComponent(stem)}/${encodeURIComponent(safe)}`,
                ]
                if (rawBasename && rawBasename !== safe) {
                  tryUrls.push(
                    `${converterOrigin}/outputs/${encodeURIComponent(rawBasename)}`,
                    `${converterOrigin}/outputs/${encodeURIComponent(rawStem)}/${encodeURIComponent(rawBasename)}`,
                  )
                }
                for (const url of tryUrls) {
                  try {
                    const ctrl = new AbortController()
                    const timer = setTimeout(() => ctrl.abort(), 30000)
                    const fetchRes = await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer))
                    if (fetchRes.ok && fetchRes.body) {
                      const buf = Buffer.from(await fetchRes.arrayBuffer())
                      await writeFile(localPath, buf)
                                            log.info(`[register-converted] GLB vom Konverter geholt: ${safe}`)
                      needBake = true
                      break
                    }
                  } catch (_) {}
                }
              }
              if (!needBake) {
                log.scoped('register-converted').warn(
                  `GLB nicht gefunden (nicht gebacken): ${safe} – erwartet: ${absPath}. Rollback glbFile="${previousGlbFile || '(neu)'}".`,
                )
                warnings.push({
                  productId: p?.id || productId || '',
                  reason: 'glb-not-found',
                  expected: glbUrl,
                  absPath,
                })
                // Rollback: bei fehlender Datei nicht auf kaputten Pfad zeigen.
                if (isNewProduct) {
                  const idx = data.products.indexOf(p)
                  if (idx >= 0) data.products.splice(idx, 1)
                  const addedIdx = added.indexOf(p.id)
                  if (addedIdx >= 0) added.splice(addedIdx, 1)
                } else {
                  if (previousGlbFile) p.glbFile = previousGlbFile
                  else delete p.glbFile
                  if (previousUsdzFile) p.usdzFile = previousUsdzFile
                  else delete p.usdzFile
                  p.conversionError = {
                    reason: 'glb-not-found',
                    expected: glbUrl,
                    absPath,
                    at: new Date().toISOString(),
                  }
                }
              }
            }
            if (needBake) {
              if (p && p.conversionError) delete p.conversionError
              const usdzSafePath = resolve(outputDir, safe.replace(/\.glb$/i, '.usdz'))
              const usdzRawPath = resolve(outputDir, rawBasename.replace(/\.glb$/i, '.usdz'))
              try {
                await stat(usdzSafePath)
                p.usdzFile = glbUrl.replace(/\.glb$/i, '.usdz')
              } catch {
                if (
                  rawBasename !== safe &&
                  isSafePath(outputDir, usdzRawPath)
                ) {
                  try {
                    await stat(usdzRawPath)
                    await copyFile(usdzRawPath, usdzSafePath)
                    p.usdzFile = glbUrl.replace(/\.glb$/i, '.usdz')
                                        log.info(`[register-converted] USDZ nach GLB-Fetch kopiert → ${safe.replace(/\.glb$/i, '.usdz')}`)
                  } catch (_) {}
                }
              }

              const sf = String(productForRal?.surfaceFinish || '').trim().toLowerCase()
              const surfaceArgs = sf === 'verzinkt' || sf === 'pulver' ? ['--surface', sf] : []
              let overridesFile = null
              if (mergedBakeOverrides && Object.keys(mergedBakeOverrides).length > 0) {
                overridesFile = `${localPath}.color-overrides.json`
                await writeFile(overridesFile, JSON.stringify(mergedBakeOverrides), 'utf-8')
              }
              let nameRulesFile = null
              if (
                mergedNameColorRuleEntries.length > 0 ||
                mergedGeometryColorRuleEntries.length > 0 ||
                mergedVertexReductionRuleEntries.length > 0 ||
                mergedVisibilityRuleEntries.length > 0
              ) {
                nameRulesFile = `${localPath}.name-rules.json`
                const rulesPayload = {}
                if (mergedNameColorRuleEntries.length > 0) rulesPayload.nameColorRules = mergedNameColorRuleEntries
                if (mergedGeometryColorRuleEntries.length > 0) {
                  rulesPayload.geometryColorRules = mergedGeometryColorRuleEntries
                }
                if (mergedVertexReductionRuleEntries.length > 0) {
                  rulesPayload.vertexReductionRules = mergedVertexReductionRuleEntries
                }
                if (mergedVisibilityRuleEntries.length > 0) {
                  rulesPayload.visibilityRules = mergedVisibilityRuleEntries
                }
                await writeFile(nameRulesFile, JSON.stringify(rulesPayload), 'utf-8')
              }
              log.scoped('register-converted').info(
                `Bake: ${localPath}${ralCode ? ` (RAL ${ralCode})` : ''}${surfaceArgs.length ? ` [Oberfläche: ${sf}]` : ''}${overridesFile ? ' [Hex-Mapping]' : ''}${nameRulesFile ? ' [name-rules]' : ''}${mergedVertexReductionRuleEntries.length ? ' [vertex-reduction]' : ''}${mergedVisibilityRuleEntries.length ? ' [visibility]' : ''}`,
              )
              const mtlTexBakeArgs = await bakeSpawnArgsMtlTextures(productForRal, ROOT)
              if (mtlTexBakeArgs.length) {
                                log.scoped("register-converted").info("MTL map_Kd → GLB-Texturen (bake-glb-yup)")
              }
              const bakeArgs = [
                bakeScript,
                '--file',
                localPath,
                '--write',
                ...mtlTexBakeArgs,
                ...(overridesFile ? ['--color-overrides', overridesFile] : []),
                ...(nameRulesFile ? ['--name-rules', nameRulesFile] : []),
                ...(ralCode ? ['--ral', ralCode] : []),
                ...surfaceArgs,
              ]
              const result = spawnSync(process.execPath, bakeArgs, { cwd: ROOT, stdio: 'pipe', encoding: 'utf-8' })
              if (overridesFile) {
                await unlink(overridesFile).catch(() => {})
              }
              if (nameRulesFile) {
                await unlink(nameRulesFile).catch(() => {})
              }
              if (result.stdout) log.scoped("register-converted").info("STDOUT:n", + result.stdout)
              if (result.stderr) log.scoped("register-converted").warn("STDERR:n", + result.stderr)
              if (result.status !== 0) log.scoped("register-converted").warn("Bake EXIT:", result.status)

              // Prozessschutz: Farb-Kollaps früh sichtbar machen (STEP mehrfarbig, GLB einfarbig).
              try {
                const stepCad = (Array.isArray(p?.cadFiles) ? p.cadFiles : []).find((u) =>
                  /\.(step|stp|p21)$/i.test(String(u || '')),
                )
                if (stepCad) {
                  const stepAbs = resolve(ROOT, 'public', ...String(stepCad).replace(/^\//, '').split('/'))
                  if (isSafePath(resolve(ROOT, 'public'), stepAbs)) {
                    const [stepRaw, glbRaw] = await Promise.all([
                      readFile(stepAbs, 'utf-8').catch(() => null),
                      readFile(localPath).catch(() => null),
                    ])
                    const stepColors = stepRaw ? extractStepRgbColors(stepRaw) : new Set()
                    const glbColors = glbRaw ? extractGlbMaterialRgbColors(glbRaw) : new Set()
                    const looksCollapsed =
                      stepColors.size >= 2 &&
                      glbColors.size > 0 &&
                      glbColors.size < stepColors.size &&
                      glbColors.size <= 1
                    if (looksCollapsed) {
                      const msg =
                        `Farb-Kollaps erkannt: STEP hat ${stepColors.size} Farben, ` +
                        `GLB-Materiale nur ${glbColors.size}.`
                                            log.warn(`[register-converted] ${msg} Produkt=${p?.id || 'unknown'} Datei=${safe}`)
                      warnings.push({
                        productId: p?.id || productId || '',
                        reason: 'color-collapse',
                        expected: glbUrl,
                        detail: msg,
                      })
                    }
                  }
                }
              } catch (e) {
                                log.scoped("register-converted").warn("color-parity-check:", e?.message || e)
              }
            }
          }

          if (productForRal && ralCode) {
            const ralStr = `RAL ${ralCode}`
            if (!String(productForRal.defaultColor || '').trim()) {
              productForRal.defaultColor = ralStr
                            log.info(`[register-converted] defaultColor gesetzt: ${ralStr}`)
            }
            const sfFromRal = String(ralCode) === '9007' ? 'verzinkt' : 'pulver'
            const curSf = String(productForRal.surfaceFinish || '').trim().toLowerCase()
            if (!curSf || curSf === 'auto') {
              productForRal.surfaceFinish = sfFromRal
                            log.info(`[register-converted] surfaceFinish gesetzt: ${sfFromRal}`)
            } else if (curSf === 'verzinkt' && String(ralCode) !== '9007') {
              productForRal.surfaceFinish = 'pulver'
              log.scoped('register-converted').info(
                `surfaceFinish: verzinkt → pulver (RAL ${ralCode} ist nicht 9007; Zielfarbe/Mapping)`,
              )
            }
          }

          try {
            const { refreshProductThumbnailsAfterConvert } = await import('../thumbnail/registerThumbnailHook.mjs')
            await refreshProductThumbnailsAfterConvert({
              ROOT,
              viteServerOrigin,
              glbRows,
              outputDir,
            })
          } catch (e) {
                        log.scoped("register-converted").warn("Thumbnails:", e?.message || e)
          }

          // Maße nach jeder erfolgreichen Konvertierung aus der (gebackenen) GLB neu messen
          for (const row of glbRows) {
            const { localPath, p } = row
            if (!p || p.type === 'composed') continue
            try {
              await stat(localPath)
            } catch {
              continue
            }
            try {
              const dims = await measureGlbDimensionsMm(localPath, p.rotationOffset)
              if (dims) {
                applyDimensionsToProductSpecs(p, dims)
                log.scoped('register-converted').info(
                  `Maße aktualisiert: ${dims.width} × ${dims.height} × ${dims.depth} mm (B × H × T)`,
                  { productId: p.id, glb: p.glbFile },
                )
              } else {
                log.scoped('register-converted').warn('Maße konnten nicht ermittelt werden', {
                  productId: p.id,
                  glb: p.glbFile,
                })
              }
            } catch (e) {
              log.scoped('register-converted').warn('Maße messen fehlgeschlagen:', e?.message || e)
            }
          }

          await saveProducts(data)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, added, warnings }))
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: e.message }))
        }
      })

      // ── Produkt direkt aus Dashboard konvertieren ────────────────────────
      // POST /__api/convert-product
      // Body: { productId: string, options?: object }
      server.middlewares.use('/__api/convert-product', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
        let debugProductId = ''
        try {
          const body = JSON.parse((await readBody(req)).toString('utf-8'))
          const { productId, options = {}, defaultColorHex } = body
          debugProductId = typeof productId === 'string' ? productId : ''
          const debugTargetToken = '4026212095937_20068997'
          const debugEnabled = typeof productId === 'string' && productId.includes(debugTargetToken)
          const debugRunId = 'initial'
          // #region agent log
          if (debugEnabled) fetch('http://127.0.0.1:7616/ingest/17b72368-3f2f-4773-9ae3-6cdbf2000fca',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'96177d'},body:JSON.stringify({sessionId:'96177d',runId:debugRunId,hypothesisId:'H1',location:'scripts/vite-plugin/dashboardApi.mjs:convert-product:request',message:'convert-product request received',data:{productId,hasDefaultColorHex:Boolean(defaultColorHex),optionKeys:Object.keys(options||{})},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          const data = await loadProducts()
          const rawProduct = data.products.find(x => x.id === productId)
          if (!rawProduct) {
            // #region agent log
            if (debugEnabled) fetch('http://127.0.0.1:7616/ingest/17b72368-3f2f-4773-9ae3-6cdbf2000fca',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'96177d'},body:JSON.stringify({sessionId:'96177d',runId:debugRunId,hypothesisId:'H1',location:'scripts/vite-plugin/dashboardApi.mjs:convert-product:rawProduct',message:'product lookup failed',data:{productId,productsCount:Array.isArray(data?.products)?data.products.length:null},timestamp:Date.now()})}).catch(()=>{});
            // #endregion
            res.statusCode = 404
            res.end(JSON.stringify({ error: 'Produkt nicht gefunden' }))
            return
          }

          const bodyHasExplicitColor =
            defaultColorHex &&
            typeof defaultColorHex === 'string' &&
            /^#?[0-9A-Fa-f]{6}$/i.test(defaultColorHex.trim())

          let effDefaultColorOverride = bodyHasExplicitColor
          let effDefaultColorHex = bodyHasExplicitColor
            ? defaultColorHex.replace(/^#?/, '#').toUpperCase()
            : null

          const converterApiBaseCp = process.env.CONVERTER_API_URL || 'http://localhost:3000'
          // 1) Produkt-Stammdaten (defaultColor in products.json) vor GTIN: sonst überschreibt z. B. Oberfläche 7035 im Stamm ein gesetztes RAL 2001.
          if (!bodyHasExplicitColor && !effDefaultColorHex && rawProduct?.defaultColor) {
            const dcStr = resolveDefaultColorStringForPipeline(rawProduct)
            const mProd = dcStr ? String(dcStr).match(/RAL\s*(\d{4})/i) : null
            if (mProd) {
              const hex = await resolveHexForRalDigits(ROOT, mProd[1])
              if (hex) {
                effDefaultColorOverride = true
                effDefaultColorHex = hex
                                log.info(`[convert-product] Farbziel aus products.json defaultColor: RAL ${mProd[1]} → ${hex}`)
              }
            }
          }
          // 1b) Dominante RAL aus MTL+Mapping (_mtlColors) vor GTIN — gleiche Priorität wie register-converted
          if (!bodyHasExplicitColor && !effDefaultColorHex && rawProduct?._mtlColors?.dominantRal) {
            const d = String(rawProduct._mtlColors.dominantRal).trim()
            const mDom = d.match(/^RAL\s*(\d{4})$/i)
            if (mDom) {
              const hex = await resolveHexForRalDigits(ROOT, mDom[1])
              if (hex) {
                effDefaultColorOverride = true
                effDefaultColorHex = hex
                                log.info(`[convert-product] Farbziel aus _mtlColors (MTL-Mapping): RAL ${mDom[1]} → ${hex}`)
              }
            }
          }
          // 2) GTIN-Stamm nur wenn noch kein Ziel aus Body/Produkt
          if (!bodyHasExplicitColor && !effDefaultColorHex) {
            try {
              const gtinRal = await resolveRalCodeFromGtinStamm(converterApiBaseCp, rawProduct)
              if (gtinRal?.ralCode) {
                const hex = await resolveHexForRalDigits(ROOT, gtinRal.ralCode)
                if (hex) {
                  effDefaultColorOverride = true
                  effDefaultColorHex = hex
                                    log.info(`[convert-product] Farbziel aus GTIN-Stamm: RAL ${gtinRal.ralCode} → ${hex}`)
                }
              }
            } catch (_) {}
          }

          // CAD-Dateien aus Index
          const cadIdx = await getCadIndex()
          const p = enrichProductCadFiles(rawProduct, cadIdx)

          if (!p.cadFiles?.length) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'Keine CAD-Dateien für dieses Produkt' }))
            return
          }

          const CAD_MAIN_EXT = ['.obj', '.step', '.stp', '.stpz', '.p21', '.fbx', '.dae', '.stl', '.iges', '.igs', '.3ds']
          const convertible = p.cadFiles.filter((f) => {
            const fn = f.split('/').pop() || f
            const dot = fn.lastIndexOf('.')
            const ext = dot > 0 ? fn.slice(dot + 1).toLowerCase() : ''
            return CAD_MAIN_EXT.includes(`.${ext}`)
          })
          const allCad = p.cadFiles
          // #region agent log
          if (debugEnabled) fetch('http://127.0.0.1:7616/ingest/17b72368-3f2f-4773-9ae3-6cdbf2000fca',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'96177d'},body:JSON.stringify({sessionId:'96177d',runId:debugRunId,hypothesisId:'H2',location:'scripts/vite-plugin/dashboardApi.mjs:convert-product:cad-scan',message:'cad files analyzed',data:{productId,cadCount:Array.isArray(allCad)?allCad.length:0,convertibleCount:Array.isArray(convertible)?convertible.length:0,sampleCad:Array.isArray(allCad)?allCad.slice(0,5):[]},timestamp:Date.now()})}).catch(()=>{});
          // #endregion

          if (!convertible.length) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'Keine konvertierbaren CAD-Dateien gefunden (OBJ, STEP, FBX …)' }))
            return
          }

          const filesToAppend = []
          for (const cadUrl of allCad) {
            const filePath = resolve(ROOT, 'public', ...cadUrl.replace(/^\//, '').split('/'))
            try {
              const buf = await readFile(filePath)
              filesToAppend.push({ cadUrl, buf })
            } catch (e) {
                            log.warn(`[convert-product] Datei nicht lesbar: ${filePath}: ${e.message}`)
            }
          }
          if (filesToAppend.length === 0) {
            // #region agent log
            if (debugEnabled) fetch('http://127.0.0.1:7616/ingest/17b72368-3f2f-4773-9ae3-6cdbf2000fca',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'96177d'},body:JSON.stringify({sessionId:'96177d',runId:debugRunId,hypothesisId:'H3',location:'scripts/vite-plugin/dashboardApi.mjs:convert-product:filesToAppend',message:'no readable CAD files',data:{productId,cadCount:Array.isArray(allCad)?allCad.length:0},timestamp:Date.now()})}).catch(()=>{});
            // #endregion
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'Keine CAD-Dateien lesbar (Pfad prüfen: public/…)' }))
            return
          }

          const presetConvForUv =
            rawProduct?.conversionPreset &&
            typeof rawProduct.conversionPreset === 'object' &&
            !Array.isArray(rawProduct.conversionPreset)
              ? rawProduct.conversionPreset
              : {}
          const wantsAutoUvBlender =
            String(process.env.AUTO_UV_BLENDER || '').trim() === '1' ||
            String(presetConvForUv.autoUvObj || '').toLowerCase() === 'true' ||
            options.autoUv === true ||
            String(options.autoUv || '').toLowerCase() === 'true'
          if (wantsAutoUvBlender && filesToAppend.length) {
            try {
              const { runBlenderAutoUvOnObjBuffers } = await import('./scripts/autoUvBlender.mjs')
              await runBlenderAutoUvOnObjBuffers(ROOT, filesToAppend)
            } catch (e) {
                            log.scoped("convert-product").warn("auto-UV:", e.message)
            }
          }

          const MAPPING_MAX_BYTES = 2 * 1024 * 1024 // 2 MB – größere Dateien führen zu „invalid request“
          let colorOverridesFromMapping = null
          try {
            const mappingPath = resolve(ROOT, 'public', 'mtl-ral-color-mapping.json')
            const mappingRaw = await readFile(mappingPath, 'utf-8').catch(() => null)
            if (mappingRaw && mappingRaw.length <= MAPPING_MAX_BYTES) {
              const mapping = JSON.parse(mappingRaw)
              let ralPalette = null
              try {
                const ralRaw = await readFile(resolve(ROOT, 'src/data/ralColors.json'), 'utf-8')
                ralPalette = JSON.parse(ralRaw)
              } catch (_) {}
              const getRalHex = ralPalette
                ? (ralKey) => {
                    if (!ralKey || !ralPalette[ralKey]?.hex) return null
                    return normalizeMappingHex(ralPalette[ralKey].hex)
                  }
                : null
              const overrides = buildColorOverridesFromMapping(mapping, getRalHex)
              if (Object.keys(overrides).length > 0) colorOverridesFromMapping = overrides
            } else if (mappingRaw && mappingRaw.length > MAPPING_MAX_BYTES) {
                            log.warn(`[convert-product] mtl-ral-color-mapping.json zu groß (${(mappingRaw.length / 1024 / 1024).toFixed(1)} MB), wird ignoriert. Bitte nur die nötigen Farben mappen (typisch < 100).`)
            }
          } catch (_) {}

          const presetFull =
            rawProduct.conversionPreset && typeof rawProduct.conversionPreset === 'object' && !Array.isArray(rawProduct.conversionPreset)
              ? rawProduct.conversionPreset
              : {}
          let mergedNameColorRuleEntries = mergeNameColorRuleEntries(null, presetFull)
          let mergedGeometryColorRuleEntries = mergeGeometryColorRuleEntries(null, presetFull)
          let mergedVertexReductionRuleEntries = mergeVertexReductionRuleEntries(null, presetFull)
          let mergedVisibilityRuleEntries = mergeVisibilityRuleEntries(null, presetFull)
          try {
            const mappingPathRules = resolve(ROOT, 'public', 'mtl-ral-color-mapping.json')
            const mappingRawRules = await readFile(mappingPathRules, 'utf-8').catch(() => null)
            if (mappingRawRules && mappingRawRules.length <= MAPPING_MAX_BYTES) {
              const mapRules = JSON.parse(mappingRawRules)
              mergedNameColorRuleEntries = mergeNameColorRuleEntries(mapRules, presetFull)
              mergedGeometryColorRuleEntries = mergeGeometryColorRuleEntries(mapRules, presetFull)
              mergedVertexReductionRuleEntries = mergeVertexReductionRuleEntries(mapRules, presetFull)
              mergedVisibilityRuleEntries = mergeVisibilityRuleEntries(mapRules, presetFull)
            }
          } catch (_) {
            mergedNameColorRuleEntries = mergeNameColorRuleEntries(null, presetFull)
            mergedGeometryColorRuleEntries = mergeGeometryColorRuleEntries(null, presetFull)
            mergedVertexReductionRuleEntries = mergeVertexReductionRuleEntries(null, presetFull)
            mergedVisibilityRuleEntries = mergeVisibilityRuleEntries(null, presetFull)
          }
          if (mergedNameColorRuleEntries.length) {
            log.scoped('convert-product').info(
              `nameColorRules: ${mergedNameColorRuleEntries.length} Eintrag/Einträge (global + Preset; Bake bei Registrierung)`,
            )
          }
          if (mergedGeometryColorRuleEntries.length) {
            log.scoped('convert-product').info(
              `geometryColorRules: ${mergedGeometryColorRuleEntries.length} Eintrag/Einträge (global + Preset; Bake bei Registrierung)`,
            )
          }
          if (mergedVertexReductionRuleEntries.length) {
            log.scoped('convert-product').info(
              `vertexReductionRules: ${mergedVertexReductionRuleEntries.length} Eintrag/Einträge (global + Preset; Bake bei Registrierung)`,
            )
          }
          if (mergedVisibilityRuleEntries.length) {
            log.scoped('convert-product').info(
              `visibilityRules: ${mergedVisibilityRuleEntries.length} Eintrag/Einträge (Preset; Bake bei Registrierung)`,
            )
          }
          const presetRest = { ...presetFull }
          delete presetRest.autoUvObj
          // Rotations-Felder aus dem gespeicherten Preset entfernen: Die aktuelle Drehung
          // wird ausschließlich von `optionsRest` (Frontend UI-State + Header) definiert.
          // Sonst kollidiert ein altes `rotateAxis`/`rotateDegrees` aus products.json mit
          // einem neu gesendeten `rotateYUp: 'true'` und Joi rejected wegen mutually exclusive.
          delete presetRest.rotateAxis
          delete presetRest.rotateDegrees
          delete presetRest.rotateYUp
          delete presetRest.bakeYUp
          let presetColorOverrides = null
          if (
            presetFull.colorOverrides &&
            typeof presetFull.colorOverrides === 'object' &&
            !Array.isArray(presetFull.colorOverrides)
          ) {
            presetColorOverrides = presetFull.colorOverrides
            delete presetRest.colorOverrides
          }

          /** Preflight: alle im CAD vorkommenden Quellfarben → Ziel-Hex (z. B. RAL 2001). Liegt übers MTL-Mapping, damit globale Mappings Orangetöne nicht falsch auf z. B. 7035 zeigen. */
          let colorOverridesFromPreflight = null
          if (
            effDefaultColorOverride &&
            effDefaultColorHex &&
            typeof effDefaultColorHex === 'string' &&
            effDefaultColorHex.length >= 7
          ) {
            const formPreflight = new FormData()
            for (const { cadUrl, buf } of filesToAppend) {
              formPreflight.append('files', new Blob([buf], { type: 'application/octet-stream' }), cadUrl.split('/').pop())
            }
            formPreflight.append('enablePreflight', 'true')
            try {
              const preflightRes = await fetch('http://localhost:3000/api/v1/preflight', { method: 'POST', body: formPreflight })
              const preflightData = await preflightRes.json()
              if (preflightRes.ok && preflightData.preflight && Array.isArray(preflightData.preflight.colorUsage)) {
                const rgbToHex = (rgb) => {
                  if (!rgb || rgb.length < 3) return null
                  const [r, g, b] = rgb.map(c => Math.round(Math.min(1, Math.max(0, Number(c))) * 255))
                  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase()
                }
                colorOverridesFromPreflight = {}
                preflightData.preflight.colorUsage.forEach((e) => {
                  const hex = rgbToHex(e.rgb)
                  if (hex) colorOverridesFromPreflight[hex] = effDefaultColorHex
                })
                if (Object.keys(colorOverridesFromPreflight).length) {
                                    log.info(`[convert-product] Preflight: ${Object.keys(colorOverridesFromPreflight).length} Quellfarbe(n) → ${effDefaultColorHex}`)
                }
              }
            } catch (e) {
                            log.scoped("convert-product").warn("Preflight für Override-Farben fehlgeschlagen:", e.message)
            }
          }

          // Hex-Overrides für Konverter: (1) Mapping aus Dateifarben, (2) Preflight = Dashboard-Ziel auf erkannte Quellfarben,
          // danach (4) Preset/UI colorOverrides — spätere Keys überschreiben frühere (wie Bake-Schichten).
          let mergedColorOverrides = {
            ...(colorOverridesFromMapping && typeof colorOverridesFromMapping === 'object' ? colorOverridesFromMapping : {}),
            ...(colorOverridesFromPreflight && typeof colorOverridesFromPreflight === 'object' ? colorOverridesFromPreflight : {}),
          }
          if (presetColorOverrides) mergedColorOverrides = { ...mergedColorOverrides, ...presetColorOverrides }
          let optColorRaw = options.colorOverrides
          if (typeof optColorRaw === 'string') {
            try {
              optColorRaw = JSON.parse(optColorRaw)
            } catch (_) {
              optColorRaw = null
            }
          }
          if (optColorRaw && typeof optColorRaw === 'object' && !Array.isArray(optColorRaw)) {
            mergedColorOverrides = { ...mergedColorOverrides, ...optColorRaw }
          }

          const form = new FormData()
          for (const { cadUrl, buf } of filesToAppend) {
            form.append('files', new Blob([buf], { type: 'application/octet-stream' }), cadUrl.split('/').pop())
          }

          const hasStepCadInput = filesToAppend.some(({ cadUrl }) => /\.(step|stp|p21)$/i.test(String(cadUrl || '')))

          // Benennung nach CSV: GTIN_Artikelnummer_RAL_xxxx oder GTIN_Artikelnummer_vzk
          // Fallback: Wenn die Nummer zu kurz für GTIN ist, wird "200" vorangestellt.
          const rawId = (rawProduct.id || '').trim()
          const outputBasename = rawId.replace(/^output-/, '').trim() || null
          const useGTINNaming = !!outputBasename && !hasStepCadInput
          let gtin = rawProduct.gtin || ''
          let articleNumber = rawProduct.articleNumber || rawProduct.shopwareProductId || ''
          if (!gtin || !articleNumber) {
            const parts = (outputBasename || '').split('_')
            if (parts.length >= 1 && /^\d+$/.test(parts[0])) {
              let candidate = parts[0]
              if (candidate.length < 8) candidate = '200' + candidate
              if (/^\d{8,14}$/.test(candidate)) gtin = gtin || candidate
            }
            if (parts.length >= 2 && /^[A-Za-z0-9 _.-]{1,80}$/.test(parts[1])) articleNumber = articleNumber || parts[1]
          }

          const defaults = {
            bakeYUp: 'true', outputFormat: 'glb', scale: '0.001',
            importUpAxis: 'AUTO', useDraco: 'true', embedTextures: 'true',
            stripCamerasLights: 'true', overwriteExisting: 'true', materialFinish: 'auto',
            autoLabelParts: 'false', useClaudeAI: 'false',
            useGTINNaming: useGTINNaming ? 'true' : 'false',
            tessellationQuality: '0.1',
            decimateRatio: '1.0',
            colorSaturation: '1', colorBrightness: '1',
            roughnessMultiplier: '1', metallicMultiplier: '1',
            preserveMtlColors: 'true',
            exportUsdz: 'true',
            materialFinishVerzinktMetallic: '0.75',
            materialFinishVerzinktRoughness: '0.25',
            materialFinishRalMetallic: '0',
            materialFinishRalRoughness: '0.35',
          }
          const optionsRest = { ...options }
          delete optionsRest.colorOverrides
          const merged = { ...defaults, ...presetRest, ...optionsRest }
          const prodSf = String(rawProduct.surfaceFinish || '').trim().toLowerCase()
          if (prodSf === 'verzinkt') merged.materialFinish = 'galvanized'
          else if (prodSf === 'pulver') merged.materialFinish = 'powder-coated'
          if (gtin && /^[0-9]{8,14}$/.test(gtin)) merged.gtin = gtin
          if (articleNumber && /^[A-Za-z0-9 _.\-]{1,80}$/.test(articleNumber)) merged.articleNumber = articleNumber
          if (Object.keys(mergedColorOverrides).length > 0) {
            merged.colorOverrides = mergedColorOverrides
          }
          if (effDefaultColorOverride && effDefaultColorHex) {
            merged.defaultColorHex = effDefaultColorHex
          }
          // Externe Konverter-API (FormData-Feldname): steht NICHT für products.json / gelöschte UI-Checkbox.
          // Ohne dieses Flag ignorieren manche Builds colorOverrides bzw. defaultColorHex.
          if (Object.keys(mergedColorOverrides).length > 0 || (effDefaultColorOverride && effDefaultColorHex)) {
            merged.defaultColorOverride = 'true'
          }
          sanitizeConvertMultipartForJoi(merged, prodSf)
          Object.entries(merged).forEach(([k, v]) => {
            if (v === undefined || v === null) return
            const str = typeof v === 'object' ? JSON.stringify(v) : String(v)
            form.append(k, str)
          })
          // #region agent log
          if (debugEnabled) fetch('http://127.0.0.1:7616/ingest/17b72368-3f2f-4773-9ae3-6cdbf2000fca',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'96177d'},body:JSON.stringify({sessionId:'96177d',runId:debugRunId,hypothesisId:'H4',location:'scripts/vite-plugin/dashboardApi.mjs:convert-product:before-converter',message:'requesting converter API',data:{productId,filesToAppend:filesToAppend.length,hasStepCadInput,useGTINNaming,hasColorOverrides:Object.keys(mergedColorOverrides).length>0,defaultColorOverride:merged.defaultColorOverride==='true'},timestamp:Date.now()})}).catch(()=>{});
          // #endregion

          const apiRes = await fetch('http://localhost:3000/api/v1/convert', { method: 'POST', body: form })
          const raw = await apiRes.text()
          let apiData = {}
          try {
            apiData = raw ? JSON.parse(raw) : {}
          } catch (_) {
            if (!apiRes.ok) throw new Error(raw || `Converter HTTP ${apiRes.status}`)
            throw new Error('Ungültige Antwort vom Konverter')
          }
          // #region agent log
          if (debugEnabled) fetch('http://127.0.0.1:7616/ingest/17b72368-3f2f-4773-9ae3-6cdbf2000fca',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'96177d'},body:JSON.stringify({sessionId:'96177d',runId:debugRunId,hypothesisId:'H5',location:'scripts/vite-plugin/dashboardApi.mjs:convert-product:converter-response',message:'converter API responded',data:{productId,ok:apiRes.ok,status:apiRes.status,hasJobId:Boolean(apiData?.jobId||apiData?.job_id||apiData?.id),error:apiData?.error||apiData?.message||null,rawLength:typeof raw==='string'?raw.length:0},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          if (!apiRes.ok) throw new Error(apiData.error || apiData.message || raw || `Converter HTTP ${apiRes.status}`)
          const jobId = apiData.jobId ?? apiData.job_id ?? apiData.id
          // Karten-Thumbnails (PNG) werden in POST /__api/register-converted erzeugt,
          // sobald die Konvertierung fertig ist und das Dashboard die GLBs registriert.
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, jobId, productId }))
        } catch (e) {
          // #region agent log
          if (debugProductId.includes('4026212095937_20068997')) fetch('http://127.0.0.1:7616/ingest/17b72368-3f2f-4773-9ae3-6cdbf2000fca',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'96177d'},body:JSON.stringify({sessionId:'96177d',runId:'initial',hypothesisId:'H5',location:'scripts/vite-plugin/dashboardApi.mjs:convert-product:catch',message:'convert-product failed',data:{productId:debugProductId,error:e?.message||String(e)},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          res.statusCode = 500
          res.end(JSON.stringify({ error: e.message }))
        }
      })

      // ── Warteschlange leeren ───────────────────────────────────────────────
      // POST /__api/clear-queue
      server.middlewares.use('/__api/clear-queue', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
        try {
          const Redis = (await import('ioredis')).default
          const redis = new Redis({ host: 'localhost', port: 6379, maxRetriesPerRequest: 1 })
          const bullKeys = await redis.keys('bull:blender-conversion:*')
          const jobKeys = await redis.keys('job:*')
          const allKeys = [...bullKeys, ...jobKeys]
          let deleted = 0
          if (allKeys.length > 0) {
            deleted = await redis.del(...allKeys)
          }
          redis.disconnect()
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, deleted }))
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: e.message }))
        }
      })

      // GET /__api/mapping-target-options → sortierte RAL-Liste (Produkte + Mapping-JSON)
      server.middlewares.use('/__api/mapping-target-options', async (req, res) => {
        if (req.method !== 'GET') { res.statusCode = 405; res.end(); return }
        try {
          const data = await loadProducts()
          const set = new Set()
          for (const p of data.products || []) {
            const k = getProductTargetRalForFilter(p)
            if (k) set.add(k)
          }
          try {
            const raw = await readFile(resolve(ROOT, 'public/mtl-ral-color-mapping.json'), 'utf-8')
            const m = JSON.parse(raw)
            if (m.matchRal && Array.isArray(m.sourcePalette)) {
              for (const c of m.sourcePalette) {
                const ral = m.matchRal[String(c.id)]
                if (ral) {
                  const k = normalizeRalFilterKey(ral)
                  if (k) set.add(k)
                }
              }
            }
            if (m.matchPalette && Array.isArray(m.matchPalette)) {
              const ralRaw = await readFile(resolve(ROOT, 'src/data/ralColors.json'), 'utf-8')
              const palette = JSON.parse(ralRaw)
              for (const row of m.matchPalette) {
                const mh = normalizeMappingHex(row.matchHex)
                if (!mh) continue
                for (const [code, v] of Object.entries(palette)) {
                  if (code === '_meta' || !v?.hex) continue
                  if (normalizeMappingHex(v.hex) === mh) {
                    const k = normalizeRalFilterKey(code)
                    if (k) set.add(k)
                    break
                  }
                }
              }
            }
          } catch (e) {
                        log.scoped("dashboard-api").warn("mtl-ral-color-mapping.json:", e?.message || e)
          }
          const rals = [...set].sort((a, b) => a.localeCompare(b, 'de'))
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ rals }))
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: e.message, rals: [] }))
        }
      })

      // GET /__api/product-categories → distinct mainCategory (trimmed, non-empty)
      server.middlewares.use('/__api/product-categories', async (req, res) => {
        if (req.method !== 'GET') { res.statusCode = 405; res.end(); return }
        try {
          const data = await loadProducts()
          const set = new Set()
          for (const p of data.products || []) {
            const c = String(p.mainCategory || '').trim()
            if (c) set.add(c)
          }
          const categories = [...set].sort((a, b) => a.localeCompare(b, 'de'))
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ categories }))
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: e.message, categories: [] }))
        }
      })

      // ── Paginierte Produkt-API ────────────────────────────────────────────
      // GET /__api/products?page=1&limit=24&search=&filter=all&status=all&targetRal=all&category=all
      server.middlewares.use('/__api/products', async (req, res) => {
        if (req.method === 'PATCH') {
          // PATCH /__api/products/ID  (URL endet auf /ID)
          try {
            const id = req.url.replace(/^\//, '').split('?')[0]
            if (!id) { res.statusCode = 400; res.end(JSON.stringify({ error: 'Keine ID' })); return }
            const patch = JSON.parse((await readBody(req)).toString('utf-8'))
            const data = await loadProducts()
            const idx = data.products.findIndex(p => p.id === id)
            if (idx === -1) {
              data.products.push({ ...patch, id, createdAt: patch.createdAt || new Date().toISOString() })
            } else {
              data.products[idx] = { ...data.products[idx], ...patch, id }
            }
            await saveProducts(data)
            const saved = data.products.find(p => p.id === id)
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true, product: saved }))
          } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })) }
          return
        }

        if (req.method === 'DELETE') {
          try {
            const id = req.url.replace(/^\//, '').split('?')[0]
            const data = await loadProducts()
            const before = data.products.length
            data.products = data.products.filter(p => p.id !== id)
            if (data.products.length === before) { res.statusCode = 404; res.end(JSON.stringify({ error: 'Nicht gefunden' })); return }
            await saveProducts(data)
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true }))
          } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })) }
          return
        }

        // POST /__api/products/:id/preview-png — PNG aus Dashboard-WebGL (data-URL) persistieren
        if (req.method === 'POST') {
          try {
            const rawPath = req.url.replace(/^\//, '').split('?')[0]
            const m = rawPath.match(/^([^/]+)\/preview-png$/)
            if (!m) {
              res.statusCode = 404
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'Nicht gefunden' }))
              return
            }
            const id = decodeURIComponent(m[1])
            const PREVIEW_PNG_BODY_MAX = 12 * 1024 * 1024
            const raw = (await readBody(req, PREVIEW_PNG_BODY_MAX)).toString('utf-8')
            const body = JSON.parse(raw)
            const { dataUrl } = body
            if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'Erwartet: { dataUrl: "data:image/png;base64,..." }' }))
              return
            }
            const b64 = dataUrl.slice('data:image/png;base64,'.length)
            const buf = Buffer.from(b64, 'base64')
            if (buf.length < 80 || buf.length > 8 * 1024 * 1024) {
              res.statusCode = 413
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'PNG ungültig oder zu groß' }))
              return
            }
            const data = await loadProducts()
            const idx = data.products.findIndex((p) => p.id === id)
            if (idx === -1) {
              res.statusCode = 404
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'Produkt nicht gefunden' }))
              return
            }
            const p = data.products[idx]
            if (!p.glbFile) {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'Kein glbFile' }))
              return
            }
            const glbBasename = String(p.glbFile).split('/').pop() || ''
            if (!/\.glb$/i.test(glbBasename)) {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'glbFile ohne .glb' }))
              return
            }
            const pngName = glbBasename.replace(/\.glb$/i, '.png').replace(/[^a-zA-Z0-9_\-. ]/g, '_')
            const thumbDir = resolve(ROOT, 'public/models/output/thumbnails')
            await mkdir(thumbDir, { recursive: true })
            const outAbs = resolve(thumbDir, pngName)
            const publicRoot = resolve(ROOT, 'public')
            if (!isSafePath(publicRoot, outAbs)) {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'Ungültiger Zielpfad' }))
              return
            }
            await writeFile(outAbs, buf)
            const st = await stat(outAbs)
            const v = Math.round(st.mtimeMs)
            p.previewImage = `/models/output/thumbnails/${pngName}?v=${v}`
            p.previewImageGeneratedAt = new Date().toISOString()
            await saveProducts(data)
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({
              ok: true,
              previewImage: p.previewImage,
              previewImageGeneratedAt: p.previewImageGeneratedAt,
            }))
          } catch (e) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: e.message }))
          }
          return
        }

        if (req.method !== 'GET') { res.statusCode = 405; res.end(); return }

        try {
          const qs = new URLSearchParams(req.url.includes('?') ? req.url.split('?')[1] : '')
          const idParam = req.url.replace(/^\//, '').split('?')[0]

          // GET /__api/products/ID  →  einzelnes Produkt
          if (idParam && idParam !== '') {
            const data = await loadProducts()
            const p = data.products.find(x => x.id === idParam)
            if (!p) { res.statusCode = 404; res.end(JSON.stringify({ error: 'Nicht gefunden' })); return }
            const cadIdx = await getCadIndex()
            let enriched = enrichProductCadFiles(p, cadIdx)
            enriched = await enrichProductOrientation(enriched)
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(enriched))
            return
          }

          // GET /__api/products  →  paginierte Liste
          const page   = Math.max(1, parseInt(qs.get('page')  || '1'))
          const limit  = Math.min(200, Math.max(1, parseInt(qs.get('limit') || '24')))
          const search = (qs.get('search') || '').toLowerCase().trim()
          const filter = qs.get('filter') || 'all'
          const status = qs.get('status') || 'all'
          const sort   = qs.get('sort')   || 'default'
          const targetRalParam = (qs.get('targetRal') || 'all').trim()
          const categoryParam = (qs.get('category') || 'all').trim()

          const data = await loadProducts()

          // CAD-Index + Orientierungs-Erkennung
          const cadIdx = await getCadIndex()
          const allProducts = await Promise.all(
            (data.products || []).map(async p => {
              let enriched = enrichProductCadFiles(p, cadIdx)
              enriched = await enrichProductOrientation(enriched)
              return enriched
            })
          )

          let list = allProducts
          if (search) {
            // Kommagetrennte Tokens → OR-Suche (mehrere Artikel gleichzeitig finden)
            const tokens = search
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
            if (tokens.length) {
              list = list.filter((p) => {
                const name = (p.name || '').toLowerCase()
                const id = (p.id || '').toLowerCase()
                const sw = (p.shopwareProductId || '').toLowerCase()
                const cat = String(p.mainCategory || '').toLowerCase()
                const dom = String(p._mtlColors?.dominantRal || '').toLowerCase()
                return tokens.some((t) =>
                  name.includes(t) ||
                  id.includes(t) ||
                  sw.includes(t) ||
                  cat.includes(t) ||
                  (dom && dom.includes(t))
                )
              })
            }
          }
          if (categoryParam && categoryParam !== 'all') {
            if (categoryParam === '__none__') {
              list = list.filter((p) => !String(p.mainCategory || '').trim())
            } else {
              list = list.filter((p) => String(p.mainCategory || '').trim() === categoryParam)
            }
          }
          if (targetRalParam && targetRalParam !== 'all') {
            if (targetRalParam === '__none__') {
              list = list.filter((p) => !getProductTargetRalForFilter(p))
            } else {
              const needle = normalizeRalFilterKey(targetRalParam)
              if (needle) {
                list = list.filter((p) => getProductTargetRalForFilter(p) === needle)
              }
            }
          }
          if (filter === 'single')     list = list.filter(p => p.type !== 'composed')
          if (filter === 'composed')   list = list.filter(p => p.type === 'composed')
          if (filter === 'incomplete') list = list.filter(p => {
            if (p.type === 'composed') return false
            const noName = !p.name || p.name.startsWith('Produkt ')
            const noSpecs = !p.specs || Object.values(p.specs).every(v => !v || v === '–')
            const noShopware = !p.shopwareProductId
            return noName || noSpecs || noShopware
          })
          if (filter === 'glb')        list = list.filter(p => p.glbFile)
          if (filter === 'missing')    list = list.filter(p => !p.glbFile)
          if (filter === 'cad')        list = list.filter(p => p.cadFiles?.length)
          if (filter === 'issues')     list = list.filter(p => p._review?.issues?.length)
          if (status !== 'all')        list = list.filter(p => (p._review?.status || 'open') === status)

          if (sort === 'newest') {
            list = [...list].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
          } else if (sort === 'oldest') {
            list = [...list].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
          } else if (sort === 'name') {
            list = [...list].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de'))
          }

          const total = list.length
          const pages = Math.max(1, Math.ceil(total / limit))
          const safePage = Math.min(page, pages)
          const items = list.slice((safePage - 1) * limit, safePage * limit)
          const stats = {
            total:      allProducts.length,
            withGlb:    allProducts.filter(p => p.glbFile).length,
            withoutGlb: allProducts.filter(p => !p.glbFile).length,
            withCad:    allProducts.filter(p => p.cadFiles?.length).length,
            approved:   allProducts.filter(p => p._review?.status === 'approved').length,
            rejected:   allProducts.filter(p => p._review?.status === 'rejected').length,
            inReview:   allProducts.filter(p => p._review?.status === 'review').length,
            withIssues: allProducts.filter(p => p._review?.issues?.length).length,
          }

          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ products: items, total, page: safePage, pages, stats }))
        } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })) }
      })

      server.middlewares.use('/__api/list-models', async (req, res) => {
        if (req.method !== 'GET') { res.statusCode = 405; res.end(); return }
        try {
          await mkdir(MODELS_BASE, { recursive: true })
          const glbs = await walkGlb(MODELS_BASE)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ files: glbs }))
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: e.message }))
        }
      })
    },
    async closeBundle() {
      const ROOT = process.cwd()
      const outDir = resolve(ROOT, 'dist')
      try {
        await copyFile(
          resolve(ROOT, 'src/data/ralColors.json'),
          resolve(outDir, 'ralColors.json')
        )
      } catch (_) {}
    },
  }
}
