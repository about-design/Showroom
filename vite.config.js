import { defineConfig } from 'vite'
import { resolve } from 'path'
import { open, readdir, readFile, writeFile, mkdir, stat } from 'fs/promises'
import tailwindcss from '@tailwindcss/vite'

function dashboardApi() {
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
      console.log(`[dashboard-api] CAD-Index geladen: ${map.size} Produkt-Zuordnungen.`)
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

  function isSafePath(basePath, resolvedPath) {
    const normalBase = resolve(basePath) + '/'
    const normalResolved = resolve(resolvedPath)
    return normalResolved.startsWith(normalBase) || normalResolved === resolve(basePath)
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

      server.middlewares.use('/__api/save-products', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
        try {
          const body = await readBody(req)
          // Validierung: nur gültiges JSON mit products-Array akzeptieren
          const parsed = JSON.parse(body.toString('utf-8'))
          if (!Array.isArray(parsed?.products)) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'Ungültige Struktur: products-Array fehlt' }))
            return
          }
          _productsCache = parsed  // Cache invalidieren
          await writeFile(PRODUCTS_PATH, JSON.stringify(parsed, null, 2) + '\n', 'utf-8')
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true }))
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: e.message }))
        }
      })

      server.middlewares.use('/__api/upload-glb', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
        try {
          const rawName = decodeURIComponent(req.headers['x-filename'] || 'upload.glb')
          const parts = rawName.split('/')
          const safeParts = parts.filter(p => p !== '..' && p !== '.').map(p => p.replace(/[^a-zA-Z0-9_\-. ]/g, '_'))
          const safePath = safeParts.join('/')
          const targetFile = resolve(MODELS_UPLOAD_DIR, ...safeParts)
          if (!isSafePath(MODELS_UPLOAD_DIR, targetFile)) {
            res.statusCode = 400; res.end(JSON.stringify({ error: 'Ungültiger Dateipfad' })); return
          }
          const targetDir = resolve(MODELS_UPLOAD_DIR, ...safeParts.slice(0, -1))
          await mkdir(targetDir, { recursive: true })
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
          const safeParts = parts.filter(p => p !== '..' && p !== '.').map(p => p.replace(/[^a-zA-Z0-9_\-. ]/g, '_'))
          const safePath = safeParts.join('/')
          const targetFile = resolve(MODELS_UPLOAD_DIR, ...safeParts)
          if (!isSafePath(MODELS_UPLOAD_DIR, targetFile)) {
            res.statusCode = 400; res.end(JSON.stringify({ error: 'Ungültiger Dateipfad' })); return
          }
          const targetDir = resolve(MODELS_UPLOAD_DIR, ...safeParts.slice(0, -1))
          await mkdir(targetDir, { recursive: true })
          const body = await readBody(req)
          await writeFile(targetFile, body)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, filename: safePath, path: `/models/products/${safePath}` }))
        } catch (e) {
          res.statusCode = e.message?.includes('zu groß') ? 413 : 500
          res.end(JSON.stringify({ error: e.message }))
        }
      })

      // Hilfsfunktion: products.json lesen/schreiben (mit In-Memory-Cache)
      let _productsCache = null
      // Ladeversprechen – verhindert parallele Lesevorgänge bei gleichzeitigen Requests
      let _loadPromise = null

      async function loadProducts() {
        if (_productsCache) return _productsCache
        if (_loadPromise) return _loadPromise
        _loadPromise = (async () => {
          try {
            const raw = await readFile(PRODUCTS_PATH, 'utf-8')
            _productsCache = JSON.parse(raw)
            return _productsCache
          } catch { return { products: [] } }
          finally { _loadPromise = null }
        })()
        return _loadPromise
      }
      async function saveProducts(data) {
        _productsCache = data
        await writeFile(PRODUCTS_PATH, JSON.stringify(data, null, 2) + '\n', 'utf-8')
      }

      // Produkte beim Server-Start sofort im Hintergrund laden (Warm-Up)
      loadProducts().then(d => {
        console.log(`[dashboard-api] ${d?.products?.length ?? 0} Produkte geladen.`)
      }).catch(() => {})

      // ── Konvertiertes GLB registrieren ──────────────────────────────────
      // POST /__api/register-converted
      // Body: { outputPaths: string[], cadFileUrls?: string[], productId?: string }
      server.middlewares.use('/__api/register-converted', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
        try {
          const body = JSON.parse((await readBody(req)).toString('utf-8'))
          const { outputPaths = [], cadFileUrls = [], productId } = body
          const data = await loadProducts()

          const added = []
          for (const absPath of outputPaths) {
            // Dateiname → öffentliche URL via Symlink public/models/output/
            const filename = absPath.split(/[/\\]/).pop()
            const glbUrl   = `/models/output/${filename}`
            const id       = filename.replace(/\.glb$/i, '').replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-')

            // USDZ-Datei neben dem GLB prüfen
            const usdzAbsPath = absPath.replace(/\.glb$/i, '.usdz')
            let usdzUrl = null
            try {
              await stat(usdzAbsPath)
              usdzUrl = glbUrl.replace(/\.glb$/i, '.usdz')
            } catch {}

            // Bestehendes Produkt anhand productId, glbUrl oder ID suchen
            let p = (productId && data.products.find(x => x.id === productId))
                  || data.products.find(x => x.glbFile === glbUrl)
                  || data.products.find(x => x.id === id)

            if (p) {
              p.glbFile = glbUrl
              if (usdzUrl) p.usdzFile = usdzUrl
              if (cadFileUrls.length) {
                const set = new Set(p.cadFiles || [])
                cadFileUrls.forEach(f => set.add(f))
                p.cadFiles = [...set]
              }
            } else {
              p = {
                id, name: `Produkt ${id}`, glbFile: glbUrl,
                cadFiles: cadFileUrls,
                colorableMeshes: [], defaultColor: 'RAL 7035',
                specs: { load: '–', height: '–', width: '–', depth: '–' },
                shopwareProductId: '',
                createdAt: new Date().toISOString(),
              }
              if (usdzUrl) p.usdzFile = usdzUrl
              data.products.push(p)
            }
            added.push(p.id)
          }

          await saveProducts(data)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, added }))
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
        try {
          const body = JSON.parse((await readBody(req)).toString('utf-8'))
          const { productId, options = {} } = body
          const data = await loadProducts()
          const rawProduct = data.products.find(x => x.id === productId)
          if (!rawProduct) { res.statusCode = 404; res.end(JSON.stringify({ error: 'Produkt nicht gefunden' })); return }

          // CAD-Dateien aus Index
          const cadIdx = await getCadIndex()
          const p = enrichProductCadFiles(rawProduct, cadIdx)

          if (!p.cadFiles?.length) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'Keine CAD-Dateien für dieses Produkt' }))
            return
          }

          const CAD_MAIN_EXT = ['.obj', '.step', '.stp', '.fbx', '.dae', '.stl', '.iges', '.igs', '.3ds']
          const convertible = p.cadFiles.filter(f => CAD_MAIN_EXT.includes(`.${f.split('.').pop().toLowerCase()}`))
          const allCad = p.cadFiles

          if (!convertible.length) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'Keine konvertierbaren CAD-Dateien gefunden (OBJ, STEP, FBX …)' }))
            return
          }

          // FormData zusammenbauen und an den Converter-API schicken
          const form = new FormData()
          for (const cadUrl of allCad) {
            const filePath = resolve(ROOT, 'public', ...cadUrl.replace(/^\//, '').split('/'))
            try {
              const buf = await readFile(filePath)
              form.append('files', new Blob([buf], { type: 'application/octet-stream' }), cadUrl.split('/').pop())
            } catch (e) {
              console.warn(`[convert-product] Datei nicht lesbar: ${filePath}: ${e.message}`)
            }
          }

          // Standard-Optionen (überschreibbar)
          const defaults = {
            bakeYUp: 'true', outputFormat: 'glb', scale: '0.001',
            importUpAxis: 'AUTO', useDraco: 'true', embedTextures: 'true',
            stripCamerasLights: 'true', overwriteExisting: 'true', materialFinish: 'auto',
            autoLabelParts: 'false', useClaudeAI: 'false', useGTINNaming: 'false',
            colorSaturation: '1', colorBrightness: '1',
            roughnessMultiplier: '1', metallicMultiplier: '1',
          }
          Object.entries({ ...defaults, ...options }).forEach(([k, v]) => form.append(k, String(v)))

          const apiRes  = await fetch('http://localhost:3000/api/v1/convert', { method: 'POST', body: form })
          const apiData = await apiRes.json()
          if (!apiRes.ok) throw new Error(apiData.error || `Converter HTTP ${apiRes.status}`)

          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, jobId: apiData.jobId, productId }))
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: e.message }))
        }
      })

      // ── Paginierte Produkt-API ────────────────────────────────────────────
      // GET /__api/products?page=1&limit=24&search=&filter=all&status=all
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
            list = list.filter(p =>
              (p.name || '').toLowerCase().includes(search) ||
              (p.id   || '').toLowerCase().includes(search) ||
              (p.shopwareProductId || '').toLowerCase().includes(search)
            )
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
    }
  }
}

export default defineConfig({
  plugins: [tailwindcss(), dashboardApi()],
  publicDir: 'public',
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/outputs': { target: 'http://localhost:3000', changeOrigin: true },
    },
    watch: {
      // public/ enthält nur statische Assets (GLBs, Bilder) – kein Hot-Reload nötig.
      // Ohne diesen Ausschluss beobachtet Vite alle 5000+ Dateien im outputs-Symlink,
      // was mehrere GB RAM verbraucht.
      ignored: ['**/public/**'],
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        dashboard: resolve(import.meta.dirname, 'dashboard.html'),
        converter: resolve(import.meta.dirname, 'converter.html'),
      },
    },
  },
})
