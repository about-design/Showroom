import './dashboard.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

/* ═══════════════════════════════════════════════
   State
   ═══════════════════════════════════════════════ */
// currentPageProducts: nur die aktuell angezeigte Seite (max. pageSize Einträge)
let currentPageProducts = []
let totalProducts = 0
let totalPages = 0
let currentStats = {}

// productCache: einzelne Produkte (für Detail-Panel), befüllt on-demand
const productCache = new Map()

// Legacy-Alias damit interne Funktionen wie renderReviewSection(p) weiterhin funktionieren
let products = []          // wird NICHT mehr für das gesamte Laden genutzt
let filteredProducts = []  // nur noch als lokaler Hilfspuffer

let currentFilter = 'all'
let currentStatus = 'all'
let currentSort = 'default'
let currentView = 'grid'
let selectedProductId = null
let searchQuery = ''
let _searchDebounce = null
let dirty = false

let currentPage = 1
let pageSize = parseInt(localStorage.getItem('dash_pageSize')) || 24
const PAGE_SIZES = [12, 24, 48, 96]
let previewObserver = null

const ISSUE_CATALOG = [
  { id: 'wrong-color',       label: 'Falsche Farben' },
  { id: 'wrong-orientation', label: 'Falsche Ausrichtung' },
  { id: 'wrong-scale',       label: 'Falsche Skalierung' },
  { id: 'missing-parts',     label: 'Fehlende Teile' },
  { id: 'file-too-large',    label: 'Datei zu groß' },
  { id: 'mesh-errors',       label: 'Mesh-Fehler' },
  { id: 'texture-missing',   label: 'Texturen fehlen' },
  { id: 'other',             label: 'Sonstiges' },
]

const STATUS_LABELS = {
  open:     'Offen',
  review:   'In Prüfung',
  approved: 'Freigegeben',
  rejected: 'Abgelehnt',
}

const previewRenderers = new Map()

const RAL_HEX = {
  'RAL 7035': '#D7D7D7', 'RAL 7016': '#383E42', 'RAL 5010': '#0E4FA2',
  'RAL 9005': '#0A0A0A', 'RAL 3000': '#AB2524', 'RAL 6011': '#587246',
  'RAL 1003': '#F0A000', 'RAL 5015': '#0071B5', 'RAL 9010': '#F4F4F4',
}

const gltfLoader = new GLTFLoader()
const dracoLoader = new DRACOLoader()
dracoLoader.setDecoderPath('/draco/')
gltfLoader.setDRACOLoader(dracoLoader)

/* ═══════════════════════════════════════════════
   Studio Lighting
   ═══════════════════════════════════════════════ */
let envMapTexture = null

function getEnvMap(renderer) {
  if (envMapTexture) return envMapTexture
  const pmrem = new THREE.PMREMGenerator(renderer)
  pmrem.compileEquirectangularShader()
  envMapTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  pmrem.dispose()
  return envMapTexture
}

function stripModelLights(root) {
  const toRemove = []
  root.traverse(child => {
    if (child.isLight) toRemove.push(child)
  })
  toRemove.forEach(light => {
    if (light.parent) light.parent.remove(light)
    if (light.dispose) light.dispose()
  })
}

function createCardScene(renderer) {
  const env = getEnvMap(renderer)
  const scene = new THREE.Scene()
  scene.environment = env

  const hemi = new THREE.HemisphereLight(0xf0e9df, 0x2a2a35, 0.7)
  scene.add(hemi)

  const key = new THREE.DirectionalLight(0xfff5e8, 2.2)
  key.position.set(3, 6, 4)
  scene.add(key)

  const fill = new THREE.DirectionalLight(0xc8d8f0, 0.8)
  fill.position.set(-4, 3, -1)
  scene.add(fill)

  const rim = new THREE.DirectionalLight(0xffffff, 0.6)
  rim.position.set(0, 2, -5)
  scene.add(rim)

  return scene
}

function createDetailScene(renderer) {
  const env = getEnvMap(renderer)
  const scene = new THREE.Scene()
  scene.environment = env

  const hemi = new THREE.HemisphereLight(0xf0e9df, 0x2a2a35, 0.6)
  scene.add(hemi)

  const key = new THREE.DirectionalLight(0xfff5e8, 2.5)
  key.position.set(4, 8, 5)
  key.castShadow = true
  key.shadow.mapSize.set(1024, 1024)
  key.shadow.radius = 6
  key.shadow.blurSamples = 16
  key.shadow.bias = -0.0005
  key.shadow.normalBias = 0.02
  scene.add(key)

  const fill = new THREE.DirectionalLight(0xc8d8f0, 1.0)
  fill.position.set(-5, 4, -2)
  scene.add(fill)

  const rim = new THREE.DirectionalLight(0xffffff, 0.7)
  rim.position.set(1, 3, -6)
  scene.add(rim)

  const bottom = new THREE.DirectionalLight(0xe0e4f0, 0.3)
  bottom.position.set(0, -3, 2)
  scene.add(bottom)

  return { scene, keyLight: key }
}

function addShadowGround(scene, model) {
  const box = new THREE.Box3().setFromObject(model)
  const size = box.getSize(new THREE.Vector3())
  const groundSize = Math.max(size.x, size.z) * 3

  const groundGeo = new THREE.PlaneGeometry(groundSize, groundSize)
  const groundMat = new THREE.ShadowMaterial({ opacity: 0.25 })
  const ground = new THREE.Mesh(groundGeo, groundMat)
  ground.rotation.x = -Math.PI / 2
  ground.position.y = box.min.y
  ground.receiveShadow = true
  scene.add(ground)
  return ground
}

function enableShadowsOnModel(root) {
  root.traverse(child => {
    if (child.isMesh) {
      child.castShadow = true
      child.receiveShadow = true
    }
  })
}

function fitShadowCamera(light, box, margin = 1.2) {
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z) * margin
  light.shadow.camera.left = -maxDim
  light.shadow.camera.right = maxDim
  light.shadow.camera.top = maxDim
  light.shadow.camera.bottom = -maxDim
  light.shadow.camera.near = 0.1
  light.shadow.camera.far = maxDim * 4
  light.target.position.copy(center)
  light.target.updateMatrixWorld()
  light.shadow.camera.updateProjectionMatrix()
}

function createCardRenderer(w, h) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setSize(w, h)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(0x000000, 0)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.0
  renderer.outputColorSpace = THREE.SRGBColorSpace
  return renderer
}

function createDetailRenderer(w, h) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setSize(w, h)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(0x000000, 0)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.0
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.VSMShadowMap
  return renderer
}

/* ═══════════════════════════════════════════════
   DOM refs
   ═══════════════════════════════════════════════ */
const $ = (s) => document.querySelector(s)
const statsStrip = $('#statsStrip')
const productGrid = $('#productGrid')
const searchInput = $('#searchInput')
const filterGroup = $('#filterGroup')
const viewToggle = $('#viewToggle')
const resultCount = $('#resultCount')
const detailOverlay = $('#detailOverlay')
const detailPanel = $('#detailPanel')
const detailTitle = $('#detailTitle')
const detailContent = $('#detailContent')
const dropOverlay = $('#dropOverlay')
const glbFileInput = $('#glbFileInput')
const toastContainer = $('#toastContainer')
const statusFilterGroup = $('#statusFilterGroup')
const sortSelect = $('#sortSelect')

/* ═══════════════════════════════════════════════
   API – server-seitige Datenlast
   ═══════════════════════════════════════════════ */
function buildApiParams() {
  return new URLSearchParams({
    page:   String(currentPage),
    limit:  String(pageSize),
    search: searchQuery,
    filter: currentFilter,
    status: currentStatus,
    sort:   currentSort,
  })
}

async function fetchPage() {
  renderSkeleton()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  try {
    const res  = await fetch(`/__api/products?${buildApiParams()}`, { signal: controller.signal })
    clearTimeout(timeout)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    currentPageProducts = data.products || []
    totalProducts = data.total ?? currentPageProducts.length
    totalPages    = data.pages ?? 1
    currentStats  = data.stats ?? {}
    currentPageProducts.forEach(p => productCache.set(p.id, p))
    renderGrid()
    renderStats()
    renderPaginationBar()
  } catch (e) {
    clearTimeout(timeout)
    const msg = e.name === 'AbortError'
      ? 'Timeout – Server antwortet nicht. Bitte Vite neu starten.'
      : `Fehler beim Laden: ${e.message}`
    if (productGrid) productGrid.innerHTML = `<div style="grid-column:1/-1;padding:2rem;color:var(--danger);font-size:.9rem">${esc(msg)}</div>`
    toast(msg, 'error')
  }
}

async function fetchProductById(id) {
  if (productCache.has(id)) return productCache.get(id)
  try {
    const res = await fetch(`/__api/products/${encodeURIComponent(id)}`)
    if (!res.ok) return null
    const p = await res.json()
    productCache.set(id, p)
    return p
  } catch { return null }
}

async function patchProduct(id, changes) {
  const res = await fetch(`/__api/products/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  })
  if (!res.ok) throw new Error((await res.json()).error || res.status)
  const data = await res.json()
  productCache.set(id, data.product)
  // Seitenprodukt synchronisieren
  const idx = currentPageProducts.findIndex(p => p.id === id)
  if (idx !== -1) currentPageProducts[idx] = data.product
  return data.product
}

/* ═══════════════════════════════════════════════
   Init
   ═══════════════════════════════════════════════ */
async function init() {
  renderSkeletonStats()
  bindEvents()
  await fetchPage()

  // ?highlight=ID → Produkt direkt öffnen (kommt vom Converter nach Abschluss)
  const highlight = new URLSearchParams(location.search).get('highlight')
  if (highlight) {
    setTimeout(async () => {
      const p = await fetchProductById(highlight)
      if (p) {
        openDetail(highlight)
        toast(`Neu konvertiert: ${p.name}`, 'success')
      }
    }, 300)
  }
}

/* ═══════════════════════════════════════════════
   Events
   ═══════════════════════════════════════════════ */
function bindEvents() {
  searchInput.addEventListener('input', () => {
    clearTimeout(_searchDebounce)
    _searchDebounce = setTimeout(applyFilters, 280)
  })

  filterGroup.addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip')
    if (!chip) return
    currentFilter = chip.dataset.filter
    filterGroup.querySelectorAll('.filter-chip').forEach(c =>
      c.classList.toggle('active', c.dataset.filter === currentFilter))
    applyFilters()
  })

  statusFilterGroup.addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip')
    if (!chip) return
    currentStatus = chip.dataset.status
    statusFilterGroup.querySelectorAll('.filter-chip').forEach(c =>
      c.classList.toggle('active', c.dataset.status === currentStatus))
    applyFilters()
  })

  sortSelect.addEventListener('change', () => {
    currentSort = sortSelect.value
    currentPage = 1
    fetchPage()
  })

  viewToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.view-btn')
    if (!btn) return
    currentView = btn.dataset.view
    viewToggle.querySelectorAll('.view-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.view === currentView))
    productGrid.classList.toggle('list-view', currentView === 'list')
  })

  productGrid.addEventListener('click', (e) => {
    const convertBtn = e.target.closest('.btn-convert-cad')
    if (convertBtn) { startProductConversion(convertBtn.dataset.productId); return }
    const card = e.target.closest('.product-card')
    if (card) openDetail(card.dataset.id)
    const uploadCard = e.target.closest('.upload-card')
    if (uploadCard) glbFileInput.click()
  })

  detailOverlay.addEventListener('click', closeDetail)
  $('#detailClose').addEventListener('click', closeDetail)
  $('#btnCancelDetail').addEventListener('click', closeDetail)
  $('#btnSaveDetail').addEventListener('click', saveDetail)
  $('#btnDeleteProduct').addEventListener('click', deleteProduct)
  $('#btnSave').addEventListener('click', saveToServer)
  $('#btnExport').addEventListener('click', exportJSON)
  $('#btnAddGlb').addEventListener('click', () => glbFileInput.click())
  glbFileInput.addEventListener('change', onGlbFilesSelected)

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return
    if (detailPanel.classList.contains('open')) return
    if (e.key === 'ArrowLeft') { e.preventDefault(); goToPage(currentPage - 1) }
    if (e.key === 'ArrowRight') { e.preventDefault(); goToPage(currentPage + 1) }
  })

  // Page-level drag & drop
  let dragCounter = 0
  document.addEventListener('dragenter', (e) => {
    e.preventDefault()
    dragCounter++
    if (hasGlb(e)) dropOverlay.classList.add('active')
  })
  document.addEventListener('dragleave', () => {
    dragCounter--
    if (dragCounter <= 0) { dragCounter = 0; dropOverlay.classList.remove('active') }
  })
  document.addEventListener('dragover', (e) => e.preventDefault())
  document.addEventListener('drop', (e) => {
    e.preventDefault()
    dragCounter = 0
    dropOverlay.classList.remove('active')
    handleDroppedFiles(e.dataTransfer.files)
  })

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && selectedProductId) closeDetail()
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault()
      searchInput.focus()
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault()
      saveToServer()
    }
  })

  window.addEventListener('beforeunload', (e) => {
    if (dirty) { e.preventDefault(); e.returnValue = '' }
  })
}

function hasGlb(e) {
  if (!e.dataTransfer?.types?.includes('Files')) return false
  return true
}

/* ═══════════════════════════════════════════════
   GLB Upload
   ═══════════════════════════════════════════════ */
async function uploadGlbFile(file) {
  const res = await fetch('/__api/upload-glb', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) },
    body: file,
  })
  if (!res.ok) throw new Error(`Upload fehlgeschlagen: ${res.status}`)
  return res.json()
}

function makeProductFromFile(filename, glbPath) {
  const id = filename
    .replace(/\.glb$/i, '')
    .replace(/[/\\]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'product'
  if (productCache.has(id)) return null
  return {
    id,
    name: `Produkt ${id}`,
    glbFile: glbPath,
    colorableMeshes: [],
    defaultColor: 'RAL 7035',
    hotspots: [{
      id: 'info-1',
      position: { x: 0, y: 1, z: 0.5 },
      title: 'Info',
      content: `${id} – Infos in products.json anpassen.`,
      icon: 'info',
    }],
    specs: { load: '–', height: '–', width: '–', depth: '–' },
    shopwareProductId: '',
  }
}

async function handleDroppedFiles(fileList) {
  const glbFiles = [...fileList].filter(f => f.name.toLowerCase().endsWith('.glb'))
  if (!glbFiles.length) { toast('Keine GLB-Dateien gefunden', 'info'); return }
  await processGlbUploads(glbFiles)
}

function onGlbFilesSelected(e) {
  const files = [...e.target.files]
  if (files.length) processGlbUploads(files)
  e.target.value = ''
}

async function processGlbUploads(files) {
  let added = 0, skipped = 0
  for (const file of files) {
    try {
      const result = await uploadGlbFile(file)
      const product = makeProductFromFile(result.filename, result.path)
      if (product) {
        // Direkt über die PATCH-API anlegen (neues Produkt = PATCH erzeugt es wenn nicht vorhanden)
        await fetch(`/__api/products/${encodeURIComponent(product.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(product),
        })
        added++
      } else {
        skipped++
      }
    } catch (err) {
      toast(`Fehler bei ${file.name}: ${err.message}`, 'error')
    }
  }
  let msg = ''
  if (added) msg += `${added} Produkt${added > 1 ? 'e' : ''} hinzugefügt`
  if (skipped) msg += `${msg ? ', ' : ''}${skipped} übersprungen (existiert bereits)`
  if (msg) toast(msg, added ? 'success' : 'info')
  fetchPage()
}

/* ═══════════════════════════════════════════════
   Save to server / Export
   ═══════════════════════════════════════════════ */
async function saveToServer() {
  // Wird nicht mehr für Bulk-Save genutzt; einzelne Produkte werden via patchProduct() gespeichert
  toast('Bitte einzelne Produkte über das Detail-Panel speichern', 'info')
}

function exportJSON() {
  // Exportiert nur den aktuell gecachten Seitenausschnitt – für Vollexport ist ein separater Download nötig
  const cached = Array.from(productCache.values())
  const json = JSON.stringify({ products: cached }, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'products-export.json'; a.click()
  URL.revokeObjectURL(url)
  toast('Gecachte Produkte exportiert', 'success')
}

/* ═══════════════════════════════════════════════
   Stats
   ═══════════════════════════════════════════════ */
function renderSkeletonStats() {
  if (!statsStrip) return
  statsStrip.innerHTML = Array(6).fill(0).map(() =>
    `<div class="stat-card"><span class="stat-label skeleton-line" style="width:60px"></span><span class="stat-value skeleton-line" style="width:40px"></span><span class="stat-sub skeleton-line" style="width:100px"></span></div>`
  ).join('')
}

function renderStats() {
  const s = currentStats
  if (!s || !statsStrip) return
  const total    = s.total ?? 0
  const approved = s.approved ?? 0
  const inReview = s.inReview ?? 0
  const rejected = s.rejected ?? 0
  const open     = total - approved - inReview - rejected
  const withIssues = s.withIssues ?? 0
  const withGlb  = s.withGlb ?? 0
  const withCad  = s.withCad ?? 0
  const approvedPct = total ? Math.round(approved / total * 100) : 0

  statsStrip.innerHTML = `
    <div class="stat-card"><span class="stat-label">Gesamt</span><span class="stat-value accent">${total}</span><span class="stat-sub">${withGlb} GLB · ${withCad} CAD</span></div>
    <div class="stat-card"><span class="stat-label">Freigegeben</span><span class="stat-value" style="color:var(--success)">${approved}</span><span class="stat-sub">${approvedPct}% aller Produkte</span></div>
    <div class="stat-card"><span class="stat-label">In Prüfung</span><span class="stat-value" style="color:#a78bfa">${inReview}</span><span class="stat-sub">werden gerade geprüft</span></div>
    <div class="stat-card"><span class="stat-label">Abgelehnt</span><span class="stat-value" style="color:${rejected ? 'var(--danger)' : 'var(--success)'}">${rejected}</span><span class="stat-sub">${rejected ? 'brauchen Korrektur' : 'keine Ablehnungen'}</span></div>
    <div class="stat-card"><span class="stat-label">Offen</span><span class="stat-value">${open}</span><span class="stat-sub">noch nicht geprüft</span></div>
    <div class="stat-card"><span class="stat-label">Mit Problemen</span><span class="stat-value" style="color:${withIssues ? 'var(--warning)' : 'var(--success)'}">${withIssues}</span><span class="stat-sub">${withIssues ? 'Issues gemeldet' : 'keine Issues'}</span></div>
  `
}

function isIncomplete(p) {
  if (p.type === 'composed') return false
  const noName = !p.name || p.name.startsWith('Produkt ')
  const noSpecs = !p.specs || Object.values(p.specs).every(v => !v || v === '–')
  const noShopware = !p.shopwareProductId
  return noName || noSpecs || noShopware
}

/* ═══════════════════════════════════════════════
   Filtering – nun vollständig server-seitig
   ═══════════════════════════════════════════════ */
function getReviewStatus(p) {
  return p._review?.status || 'open'
}

function applyFilters() {
  searchQuery = searchInput.value.toLowerCase().trim()
  currentPage = 1
  fetchPage()
}

function goToPage(page) {
  currentPage = Math.max(1, Math.min(page, totalPages))
  fetchPage()
  document.querySelector('.main-content')?.scrollTo({ top: 0, behavior: 'smooth' })
}

/* ═══════════════════════════════════════════════
   Render grid
   ═══════════════════════════════════════════════ */
function renderSkeleton() {
  disposeAllPreviews()
  destroyPreviewObserver()
  productGrid.classList.toggle('list-view', currentView === 'list')
  const count = Math.min(pageSize, 12)
  productGrid.innerHTML = Array(count).fill(0).map(() => `
    <div class="product-card skeleton-card">
      <div class="card-preview skeleton-preview"></div>
      <div class="card-body">
        <div class="skeleton-line" style="width:70%;height:14px;margin-bottom:6px"></div>
        <div class="skeleton-line" style="width:45%;height:11px"></div>
      </div>
    </div>`).join('')
}

function renderGrid() {
  disposeAllPreviews()
  destroyPreviewObserver()
  productGrid.classList.toggle('list-view', currentView === 'list')

  const paginationContainer = document.getElementById('paginationBar')
    || (() => { const d = document.createElement('div'); d.id = 'paginationBar'; productGrid.parentElement.appendChild(d); return d })()

  if (totalProducts === 0 && currentPageProducts.length === 0) {
    productGrid.innerHTML = `
      <div class="upload-card" title="GLB-Dateien hinzufügen">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        <span>GLB-Dateien hochladen</span>
        <span style="font-size:.75rem;color:var(--text-muted)">oder hierher ziehen</span>
      </div>`
    if (resultCount) resultCount.textContent = ''
    paginationContainer.innerHTML = ''
    return
  }

  if (currentPageProducts.length === 0) {
    productGrid.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
      <p>Keine Produkte gefunden</p></div>`
    if (resultCount) resultCount.textContent = ''
    paginationContainer.innerHTML = ''
    return
  }

  const startIdx = (currentPage - 1) * pageSize
  const endIdx = Math.min(startIdx + pageSize, totalProducts)
  if (resultCount) resultCount.textContent = `${startIdx + 1}–${endIdx} von ${totalProducts}`

  const pageProducts = currentPageProducts

  const uploadCardHtml = currentView === 'grid' ? `
    <div class="upload-card" title="Weitere GLB-Dateien hinzufügen">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      <span>Hinzufügen</span>
    </div>` : ''

  productGrid.innerHTML = pageProducts.map((p, i) => {
    const isComposed = p.type === 'composed'
    const badgeClass = isComposed ? 'badge-composed' : 'badge-single'
    const badgeLabel = isComposed ? 'Zusammengebaut' : 'Einzelteil'
    const color = RAL_HEX[p.defaultColor] || '#D7D7D7'
    const tags = buildTags(p)

    return `
    <div class="product-card" data-id="${p.id}" style="animation-delay:${Math.min(i, 12) * 25}ms">
      <div class="card-preview" data-glb="${p.glbFile || ''}" data-product-id="${p.id}">
        <div class="card-preview-placeholder">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            <polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
          </svg>
          <span>3D-Vorschau</span>
        </div>
        <span class="card-type-badge ${badgeClass}">${badgeLabel}</span>
        <span class="card-color-dot" style="background:${color}" title="${p.defaultColor}"></span>
      </div>
      <div class="card-body">
        <div class="card-name" title="${esc(p.name)}">${esc(p.name)}</div>
        <div class="card-id" title="${p.id}">${p.id}</div>
        ${p.createdAt ? `<div class="card-date" title="${new Date(p.createdAt).toLocaleString('de-DE')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          ${formatDate(p.createdAt)}
        </div>` : ''}
        <div class="card-specs">
          ${specBit('↕', p.specs?.height)}${specBit('↔', p.specs?.width)}
          ${specBit('↗', p.specs?.depth)}${specBit('⚖', p.specs?.load)}
        </div>
      </div>
      <div class="card-footer">
        <div class="card-tags">${tags}</div>
        <div class="card-actions">
          ${p.cadFiles?.length ? `<button class="card-action converter-link btn-convert-cad" data-product-id="${esc(p.id)}" onclick="event.stopPropagation()" title="${p.glbFile ? 'Neu konvertieren' : 'CAD → GLB konvertieren'}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
          </button>` : ''}
          ${p.glbFile ? `<a href="/?product=${encodeURIComponent(p.id)}" class="card-action showroom-link" onclick="event.stopPropagation()" title="Im Showroom öffnen" target="_blank">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </a>` : (!p.cadFiles?.length ? `<a href="/converter.html" class="card-action converter-link" onclick="event.stopPropagation()" title="GLB konvertieren">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          </a>` : '')}
        </div>
      </div>
      ${renderCardStatusBar(p)}
    </div>`
  }).join('') + uploadCardHtml

  renderPaginationBar(paginationContainer)
  initPreviewObserver()
}

function specBit(icon, val) {
  if (!val || val === '–') return ''
  return `<div class="card-spec"><span class="card-spec-label">${icon}</span>${esc(val)}</div>`
}

function getOrientationInfo(p) {
  const ori = p.orientation || p._detectedOrientation
  if (ori === 'z-up') return { key: 'z-up', label: 'Z-up', css: 'tag-zup' }
  if (ori === 'y-up-root') return { key: 'y-up-root', label: 'Y-up Root', css: 'tag-yup-root' }
  if (ori === 'y-up') return { key: 'y-up', label: 'Y-up', css: 'tag-yup' }
  const rot = p.rotationOffset
  if (rot && (rot.x || rot.y || rot.z)) return { key: 'z-up', label: 'Z-up', css: 'tag-zup' }
  if (p.glbFile) return { key: 'y-up', label: 'Y-up', css: 'tag-yup' }
  return null
}

function buildTags(p) {
  let t = ''
  if (p.glbFile) t += '<span class="card-tag tag-glb">GLB</span>'
  if (p.usdzFile) t += '<span class="card-tag tag-usdz">USDZ</span>'
  if (p.cadFiles?.length) t += `<span class="card-tag tag-cad">CAD ${p.cadFiles.length}</span>`
  const ori = getOrientationInfo(p)
  if (ori) t += `<span class="card-tag ${ori.css}">${ori.label}</span>`
  if (p.colorableMeshes?.length) t += '<span class="card-tag tag-colorable">Farben</span>'
  if (p.hotspots?.length > 1) t += `<span class="card-tag tag-hotspots">${p.hotspots.length} HS</span>`
  if (p.shopwareProductId) t += '<span class="card-tag tag-shopware">SW</span>'
  if (isIncomplete(p)) t += '<span class="card-tag tag-incomplete">Unvollständig</span>'
  return t
}

function renderCardStatusBar(p) {
  const status = getReviewStatus(p)
  const label = STATUS_LABELS[status]
  const issues = p._review?.issues || []
  const issuePips = issues.slice(0, 3).map(id => {
    const cat = ISSUE_CATALOG.find(c => c.id === id)
    return `<span class="card-issue-pip">${esc(cat?.label || id)}</span>`
  }).join('')
  const more = issues.length > 3 ? `<span class="card-issue-pip">+${issues.length - 3}</span>` : ''
  return `
    <div class="card-status-bar status-bar-${status}">
      <span class="status-dot dot-${status}"></span>
      <span class="card-status-label">${label}</span>
      <div class="card-issues">${issuePips}${more}</div>
    </div>`
}

/* ═══════════════════════════════════════════════
   Pagination UI
   ═══════════════════════════════════════════════ */
let _paginationBound = false

function renderPaginationBar(container) {
  container = container || document.getElementById('paginationBar')
  if (!container) return
  if (totalPages <= 1 && totalProducts <= PAGE_SIZES[0]) {
    container.innerHTML = ''
    return
  }

  const pages = buildPageNumbers(currentPage, totalPages)

  container.innerHTML = `
    <div class="pagination">
      <div class="pagination-left">
        <label class="pagination-size-label">Pro Seite</label>
        <select class="pagination-size-select" id="pageSizeSelect">
          ${PAGE_SIZES.map(s => `<option value="${s}" ${s === pageSize ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
      <div class="pagination-center">
        <button class="pagination-btn" data-page="prev" ${currentPage <= 1 ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        ${pages.map(p => {
          if (p === '...') return '<span class="pagination-ellipsis">…</span>'
          const active = p === currentPage ? ' active' : ''
          return `<button class="pagination-btn pagination-num${active}" data-page="${p}">${p}</button>`
        }).join('')}
        <button class="pagination-btn" data-page="next" ${currentPage >= totalPages ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>
      <div class="pagination-right">
        <span class="pagination-info">Seite ${currentPage} von ${totalPages}</span>
      </div>
    </div>`

  if (!_paginationBound) {
    _paginationBound = true
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-page]')
      if (!btn || btn.disabled) return
      const val = btn.dataset.page
      if (val === 'prev') goToPage(currentPage - 1)
      else if (val === 'next') goToPage(currentPage + 1)
      else goToPage(parseInt(val))
    })
    container.addEventListener('change', (e) => {
      if (e.target.id === 'pageSizeSelect') {
        pageSize = parseInt(e.target.value)
        localStorage.setItem('dash_pageSize', pageSize)
        currentPage = 1
        fetchPage()
      }
    })
  }
}

function buildPageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages = []
  pages.push(1)
  if (current > 3) pages.push('...')
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
    pages.push(i)
  }
  if (current < total - 2) pages.push('...')
  pages.push(total)
  return pages
}

/* ═══════════════════════════════════════════════
   3D card previews (lazy via IntersectionObserver)
   ═══════════════════════════════════════════════ */
function initPreviewObserver() {
  destroyPreviewObserver()
  previewObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const container = entry.target
      const productId = container.dataset.productId
      const glbFile = container.dataset.glb
      if (!glbFile || !productId) return

      if (entry.isIntersecting && !previewRenderers.has(productId)) {
        const product = { id: productId, glbFile }
        loadPreview(product, container)
      }
    })
  }, { rootMargin: '100px 0px', threshold: 0.01 })

  productGrid.querySelectorAll('.card-preview[data-glb]').forEach(el => {
    if (el.dataset.glb) previewObserver.observe(el)
  })
}

function destroyPreviewObserver() {
  if (previewObserver) { previewObserver.disconnect(); previewObserver = null }
}

function loadPreview(product, container) {
  const w = container.clientWidth || 320
  const h = container.clientHeight || 200
  const renderer = createCardRenderer(w, h)
  const scene = createCardScene(renderer)
  const camera = new THREE.PerspectiveCamera(35, w / h, 0.01, 50)

  gltfLoader.load(product.glbFile, (gltf) => {
    const model = gltf.scene
    stripModelLights(model)
    scene.add(model)

    const box = new THREE.Box3().setFromObject(model)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)
    const dist = maxDim * 1.8

    camera.position.set(center.x + dist * 0.5, center.y + dist * 0.35, center.z + dist * 0.7)
    camera.lookAt(center)
    renderer.render(scene, camera)

    const ph = container.querySelector('.card-preview-placeholder')
    if (ph) ph.style.display = 'none'
    container.insertBefore(renderer.domElement, container.firstChild)
    previewRenderers.set(product.id, { renderer, scene, camera, center, dist, animId: null })

    let rot = 0
    function spin() {
      rot += 0.004
      camera.position.x = center.x + dist * 0.5 * Math.cos(rot) + dist * 0.7 * Math.sin(rot)
      camera.position.z = center.z + dist * 0.7 * Math.cos(rot) + dist * 0.5 * Math.sin(rot)
      camera.lookAt(center)
      renderer.render(scene, camera)
      const entry = previewRenderers.get(product.id)
      if (entry) entry.animId = requestAnimationFrame(spin)
    }

    container.addEventListener('mouseenter', () => {
      const e = previewRenderers.get(product.id)
      if (e && !e.animId) spin()
    })
    container.addEventListener('mouseleave', () => {
      const e = previewRenderers.get(product.id)
      if (e?.animId) { cancelAnimationFrame(e.animId); e.animId = null }
    })
  }, undefined, () => {
    const ph = container.querySelector('.card-preview-placeholder')
    if (ph) { ph.querySelector('span').textContent = 'Modell nicht gefunden'; ph.style.opacity = '.5' }
  })
}

function disposeAllPreviews() {
  previewRenderers.forEach(e => {
    if (e.animId) cancelAnimationFrame(e.animId)
    e.renderer.dispose()
  })
  previewRenderers.clear()
}

/* ═══════════════════════════════════════════════
   Detail panel
   ═══════════════════════════════════════════════ */
let detailRenderer = null, detailControls = null, detailAnimId = null

async function openDetail(id) {
  let p = await fetchProductById(id)
  if (!p) return
  selectedProductId = id
  productGrid.querySelectorAll('.product-card').forEach(c => c.classList.toggle('selected', c.dataset.id === id))

  detailTitle.textContent = p.name
  detailOverlay.classList.add('open')
  detailPanel.classList.add('open')

  const showroomBtn = document.getElementById('btnShowroom')
  if (showroomBtn) {
    if (p.glbFile) {
      showroomBtn.style.display = ''
      showroomBtn.href = `/?product=${encodeURIComponent(p.id)}`
    } else {
      showroomBtn.style.display = 'none'
    }
  }

  const isComposed = p.type === 'composed'

  detailContent.innerHTML = `
    <div class="detail-preview" id="detailPreviewWrap">
      <div class="card-preview-placeholder">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:48px;height:48px;opacity:.3">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
          <polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
        </svg>
        <span>${p.glbFile ? '3D-Vorschau lädt …' : 'Kein 3D-Modell'}</span>
      </div>
    </div>
    ${!isComposed && !p.glbFile ? `
    <div class="glb-upload-zone" id="detailGlbUpload">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
      GLB-Datei hier ablegen oder klicken
    </div>
    ${p.cadFiles?.length
      ? `<button class="detail-converter-hint btn-convert-cad-detail" data-product-id="${esc(p.id)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
          ${p.cadFiles.length} CAD-Datei(en) jetzt konvertieren
        </button>`
      : `<p class="detail-converter-hint"><a href="/converter.html" onclick="event.stopPropagation()">OBJ/STEP in der Konvertierung zu GLB umwandeln</a></p>`
    }` : ''}

    <div class="detail-section">
      <div class="detail-section-title">Stammdaten</div>
      <div class="field-row"><label class="field-label">ID</label><input class="field-value" value="${esc(p.id)}" readonly></div>
      <div class="field-row"><label class="field-label">Name</label><input class="field-value" data-field="name" value="${esc(p.name)}"></div>
      <div class="field-row"><label class="field-label">Typ</label><input class="field-value" value="${isComposed ? 'Zusammengebaut' : 'Einzelteil'}" readonly></div>
      ${!isComposed && p.glbFile ? `
      <div class="field-row">
        <label class="field-label">Orientierung</label>
        <select class="field-value" data-field="orientation">
          <option value="y-up" ${(p.orientation || 'y-up') === 'y-up' ? 'selected' : ''}>Y-up</option>
          <option value="y-up-root" ${p.orientation === 'y-up-root' ? 'selected' : ''}>Y-up + Root-Anpassung</option>
          <option value="z-up" ${p.orientation === 'z-up' ? 'selected' : ''}>Z-up</option>
        </select>
      </div>` : ''}
      ${!isComposed ? `
      <div class="field-row"><label class="field-label">GLB-Datei</label><input class="field-value" data-field="glbFile" value="${esc(p.glbFile || '')}"></div>
      <div class="field-row"><label class="field-label">USDZ-Datei</label><input class="field-value" data-field="usdzFile" value="${esc(p.usdzFile || '')}"></div>
      ` : ''}
      <div class="field-row"><label class="field-label">Erstellt</label><input class="field-value" value="${p.createdAt ? new Date(p.createdAt).toLocaleString('de-DE') : '–'}" readonly></div>
      <div class="field-row"><label class="field-label">Standard-Farbe</label><input class="field-value" data-field="defaultColor" value="${esc(p.defaultColor || '')}"></div>
      <div class="field-row"><label class="field-label">Shopware-ID</label><input class="field-value" data-field="shopwareProductId" value="${esc(p.shopwareProductId || '')}"></div>
      ${p.colorableMeshes?.length ? `
      <div class="field-row"><label class="field-label">Färbbar</label><input class="field-value" data-field="colorableMeshes" value="${esc(p.colorableMeshes.join(', '))}"></div>` : ''}
    </div>

    <div class="detail-section">
      <div class="detail-section-title">CAD-Dateien</div>
      <div class="cad-file-list" id="detailCadList">${renderCadFileList(p)}</div>
      ${p.cadFiles?.length ? `<button class="cad-convert-btn btn-convert-cad-detail" data-product-id="${esc(p.id)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
        ${p.glbFile ? 'Neu konvertieren' : 'Jetzt konvertieren'}
      </button>` : ''}
      <div class="cad-upload-zone" id="detailCadUpload">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        OBJ · MTL · STEP · FBX · STL · DAE · IGES · 3DS · PNG · JPG
      </div>
    </div>

    ${!isComposed ? `
    <div class="detail-section">
      <div class="detail-section-title">Spezifikationen</div>
      <div class="field-row"><label class="field-label">Traglast</label><input class="field-value" data-field="specs.load" value="${esc(p.specs?.load || '')}"></div>
      <div class="field-row"><label class="field-label">Höhe</label><input class="field-value" data-field="specs.height" value="${esc(p.specs?.height || '')}"></div>
      <div class="field-row"><label class="field-label">Breite</label><input class="field-value" data-field="specs.width" value="${esc(p.specs?.width || '')}"></div>
      <div class="field-row"><label class="field-label">Tiefe</label><input class="field-value" data-field="specs.depth" value="${esc(p.specs?.depth || '')}"></div>
    </div>` : ''}

    ${p.hotspots?.length ? `
    <div class="detail-section">
      <div class="detail-section-title">Hotspots (${p.hotspots.length})</div>
      <div class="hotspot-list">
        ${p.hotspots.map((h, i) => `
          <div class="hotspot-item">
            <div class="hotspot-icon">${i + 1}</div>
            <div>
              <div class="hotspot-title">${esc(h.title)}</div>
              <div class="hotspot-content">${esc(h.content)}</div>
            </div>
          </div>`).join('')}
      </div>
    </div>` : ''}

    ${isComposed && p.parts?.length ? `
    <div class="detail-section">
      <div class="detail-section-title">Teile (${p.parts.reduce((s, pt) => s + pt.count, 0)} Stück)</div>
      <div class="parts-list">
        ${p.parts.map(pt => {
          const pp = productCache.get(pt.productId)
          return `<div class="part-item"><span class="part-count">${pt.count}×</span><span>${esc(pp?.name || pt.productId)}</span></div>`
        }).join('')}
      </div>
    </div>
    ${p.shelves ? `
    <div class="detail-section">
      <div class="detail-section-title">Regalböden</div>
      <div class="field-row"><label class="field-label">Boden-Produkt</label><input class="field-value" value="${esc(p.shelves.productId)}" readonly></div>
      <div class="field-row"><label class="field-label">Breite (mm)</label><input class="field-value" value="${p.shelves.shelfWidthMm}" readonly></div>
      <div class="field-row"><label class="field-label">Tiefe (mm)</label><input class="field-value" value="${p.shelves.shelfDepthMm}" readonly></div>
    </div>` : ''}` : ''}

    ${renderReviewSection(p)}
  `

  // Review status buttons
  detailContent.querySelectorAll('.review-status-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const newStatus = btn.dataset.status
      if (!p._review) p._review = {}
      p._review.status = newStatus
      // lokalen Cache sofort aktualisieren, gespeichert wird bei saveDetail()
      detailContent.querySelectorAll('.review-status-btn').forEach(b => {
        b.className = 'review-status-btn'
        if (b.dataset.status === newStatus) b.classList.add(`active-${newStatus}`)
      })
    })
  })

  // Issue checkboxes
  detailContent.querySelectorAll('.issue-check').forEach(label => {
    label.addEventListener('click', () => {
      const input = label.querySelector('input')
      input.checked = !input.checked
      label.classList.toggle('checked', input.checked)
    })
  })

  // GLB upload zone in detail
  const uploadZone = document.getElementById('detailGlbUpload')
  if (uploadZone) {
    uploadZone.addEventListener('click', () => {
      const inp = document.createElement('input')
      inp.type = 'file'
      inp.accept = '.glb'
      inp.onchange = async () => {
        const file = inp.files[0]
        if (!file) return
        try {
          const result = await uploadGlbFile(file)
          await patchProduct(id, { glbFile: result.path })
          toast(`GLB hochgeladen: ${result.filename}`, 'success')
          openDetail(id)
        } catch (err) {
          toast(`Upload fehlgeschlagen: ${err.message}`, 'error')
        }
      }
      inp.click()
    })
    uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.style.borderColor = 'var(--accent)' })
    uploadZone.addEventListener('dragleave', () => { uploadZone.style.borderColor = '' })
    uploadZone.addEventListener('drop', async (e) => {
      e.preventDefault(); e.stopPropagation()
      uploadZone.style.borderColor = ''
      const file = [...e.dataTransfer.files].find(f => f.name.toLowerCase().endsWith('.glb'))
      if (!file) return
      try {
        const result = await uploadGlbFile(file)
        await patchProduct(id, { glbFile: result.path })
        toast(`GLB hochgeladen: ${result.filename}`, 'success')
        openDetail(id)
      } catch (err) {
        toast(`Upload fehlgeschlagen: ${err.message}`, 'error')
      }
    })
  }

  bindCadSection(p)

  // Detail-Panel: Konvertier-Button
  const convertDetailBtn = detailContent.querySelector('.btn-convert-cad-detail')
  if (convertDetailBtn) {
    convertDetailBtn.addEventListener('click', () => startProductConversion(p.id))
  }

  if (p.glbFile) loadDetailPreview(p)
}

/* ═══════════════════════════════════════════════
   CAD files
   ═══════════════════════════════════════════════ */
const CAD_ACCEPT = '.obj,.mtl,.step,.stp,.fbx,.stl,.dae,.iges,.igs,.3ds,.png,.jpg,.jpeg,.tiff,.tga,.bmp'
const CAD_BADGE_COLORS = {
  obj:  '#f59e0b', mtl:  '#a16207',
  step: '#3b82f6', stp:  '#3b82f6',
  fbx:  '#a855f7', stl:  '#22c55e',
  dae:  '#14b8a6', iges: '#ec4899', igs: '#ec4899',
  '3ds': '#6366f1',
  png:  '#06b6d4', jpg:  '#06b6d4', jpeg: '#06b6d4',
  tiff: '#06b6d4', tga:  '#06b6d4', bmp:  '#06b6d4',
}

function cadExt(filePath) {
  return filePath.split('.').pop().toLowerCase()
}

function renderCadFileList(p) {
  const files = p.cadFiles || []
  if (!files.length) return '<p class="cad-empty">Noch keine CAD-Dateien</p>'
  return files.map(fp => {
    const filename = fp.split('/').pop()
    const ext = cadExt(fp)
    const color = CAD_BADGE_COLORS[ext] || '#71717a'
    return `
      <div class="cad-file-item">
        <span class="cad-badge" style="background:${color}22;color:${color};border-color:${color}44">${ext.toUpperCase()}</span>
        <span class="cad-filename" title="${esc(fp)}">${esc(filename)}</span>
        <a class="cad-btn" href="${esc(fp)}" download="${esc(filename)}" title="Herunterladen" onclick="event.stopPropagation()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </a>
        <button class="cad-btn cad-delete-btn" data-cad-path="${esc(fp)}" title="Entfernen">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`
  }).join('')
}

async function uploadCadFile(file, productId) {
  const p = productCache.get(productId)
  if (!p) throw new Error('Produkt nicht gefunden')
  const subFolder = p.glbFile
    ? p.glbFile.replace(/^\/models\/products\//, '').split('/').slice(0, -1).join('/')
    : productId
  const filename = subFolder ? `${subFolder}/${file.name}` : file.name
  const res = await fetch('/__api/upload-cad', {
    method: 'POST',
    headers: { 'x-filename': encodeURIComponent(filename), 'content-type': 'application/octet-stream' },
    body: file,
  })
  if (!res.ok) throw new Error((await res.json()).error || res.status)
  return await res.json()
}

function bindCadSection(p) {
  const listEl = document.getElementById('detailCadList')
  const uploadZone = document.getElementById('detailCadUpload')
  if (!listEl || !uploadZone) return

  // Delete buttons
  listEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('.cad-delete-btn')
    if (!btn) return
    const fp = btn.dataset.cadPath
    p.cadFiles = (p.cadFiles || []).filter(x => x !== fp)
    listEl.innerHTML = renderCadFileList(p)
    try {
      await patchProduct(p.id, { cadFiles: p.cadFiles })
      toast(`Datei entfernt`, 'info')
    } catch (err) {
      toast(`Fehler: ${err.message}`, 'error')
    }
  })

  // Click to open file picker
  uploadZone.addEventListener('click', () => {
    const inp = document.createElement('input')
    inp.type = 'file'
    inp.accept = CAD_ACCEPT
    inp.multiple = true
    inp.onchange = async () => {
      for (const file of [...inp.files]) await doUploadCad(file, p, listEl)
    }
    inp.click()
  })

  // Drag & drop
  uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('drag-over') })
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'))
  uploadZone.addEventListener('drop', async (e) => {
    e.preventDefault(); e.stopPropagation()
    uploadZone.classList.remove('drag-over')
    const files = [...e.dataTransfer.files].filter(f => {
      const ext = f.name.split('.').pop().toLowerCase()
      return CAD_ACCEPT.split(',').map(x => x.replace('.', '')).includes(ext)
    })
    if (!files.length) { toast('Ungültiger Dateityp', 'error'); return }
    for (const file of files) await doUploadCad(file, p, listEl)
  })
}

async function doUploadCad(file, p, listEl) {
  try {
    const result = await uploadCadFile(file, p.id)
    if (!p.cadFiles) p.cadFiles = []
    if (!p.cadFiles.includes(result.path)) p.cadFiles.push(result.path)
    await patchProduct(p.id, { cadFiles: p.cadFiles })
    listEl.innerHTML = renderCadFileList(p)
    toast(`${file.name} hochgeladen`, 'success')
  } catch (err) {
    toast(`Upload fehlgeschlagen: ${err.message}`, 'error')
  }
}

function renderReviewSection(p) {
  const review = p._review || {}
  const status = review.status || 'open'
  const issues = review.issues || []
  const notes = review.notes || ''
  const reviewedAt = review.reviewedAt || ''

  const statusBtns = ['open', 'review', 'approved', 'rejected'].map(s => {
    const active = s === status ? ` active-${s}` : ''
    return `<button class="review-status-btn${active}" data-status="${s}">
      <span class="status-dot dot-${s}"></span>${STATUS_LABELS[s]}
    </button>`
  }).join('')

  const issueChecks = ISSUE_CATALOG.map(ic => {
    const checked = issues.includes(ic.id)
    return `<label class="issue-check${checked ? ' checked' : ''}">
      <input type="checkbox" data-issue="${ic.id}" ${checked ? 'checked' : ''}>
      <span class="issue-check-box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></span>
      ${esc(ic.label)}
    </label>`
  }).join('')

  return `
    <div class="detail-section">
      <div class="detail-section-title">Freigabe & Qualität</div>
      <div class="field-row" style="grid-template-columns:120px 1fr;margin-bottom:.8rem">
        <label class="field-label">Status</label>
        <div class="review-status-group">${statusBtns}</div>
      </div>
      <div style="margin-bottom:.8rem">
        <label class="field-label" style="display:block;margin-bottom:.5rem">Probleme</label>
        <div class="issue-checks">${issueChecks}</div>
      </div>
      <div style="margin-bottom:.4rem">
        <label class="field-label" style="display:block;margin-bottom:.4rem">Notizen</label>
        <textarea class="review-notes" data-field="_review.notes" placeholder="Freitext-Notizen zu diesem Produkt …">${esc(notes)}</textarea>
      </div>
      ${reviewedAt ? `<div class="review-meta">Zuletzt geprüft: ${new Date(reviewedAt).toLocaleString('de-DE')}</div>` : ''}
    </div>`
}

function loadDetailPreview(product) {
  disposeDetailPreview()
  const wrap = document.getElementById('detailPreviewWrap')
  if (!wrap) return
  const w = wrap.clientWidth || 580
  const h = wrap.clientHeight || 280

  const renderer = createDetailRenderer(w, h)
  detailRenderer = renderer

  const { scene, keyLight } = createDetailScene(renderer)
  const camera = new THREE.PerspectiveCamera(35, w / h, 0.01, 100)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.enablePan = false
  controls.autoRotate = true
  controls.autoRotateSpeed = 1.2
  detailControls = controls

  gltfLoader.load(product.glbFile, (gltf) => {
    const model = gltf.scene
    stripModelLights(model)
    enableShadowsOnModel(model)
    scene.add(model)

    const box = new THREE.Box3().setFromObject(model)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)

    fitShadowCamera(keyLight, box)
    scene.add(keyLight.target)
    addShadowGround(scene, model)

    controls.target.copy(center)
    camera.position.set(center.x + maxDim, center.y + maxDim * 0.6, center.z + maxDim * 1.2)
    controls.update()

    const ph = wrap.querySelector('.card-preview-placeholder')
    if (ph) ph.style.display = 'none'
    wrap.insertBefore(renderer.domElement, wrap.firstChild)
    renderer.domElement.style.borderRadius = 'var(--radius-md)'

    function animate() {
      detailAnimId = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()
  }, undefined, () => {
    const ph = wrap.querySelector('.card-preview-placeholder')
    if (ph) ph.querySelector('span').textContent = 'Modell nicht gefunden'
  })
}

function disposeDetailPreview() {
  if (detailAnimId) cancelAnimationFrame(detailAnimId)
  detailAnimId = null
  if (detailControls) detailControls.dispose()
  detailControls = null
  if (detailRenderer) detailRenderer.dispose()
  detailRenderer = null
}

function closeDetail() {
  disposeDetailPreview()
  detailOverlay.classList.remove('open')
  detailPanel.classList.remove('open')
  productGrid.querySelectorAll('.product-card.selected').forEach(c => c.classList.remove('selected'))
  selectedProductId = null
}

async function saveDetail() {
  if (!selectedProductId) return
  const p = productCache.get(selectedProductId)
  if (!p) return

  const changes = structuredClone(p)

  detailContent.querySelectorAll('[data-field]').forEach(input => {
    const path = input.dataset.field
    const val = input.value.trim()

    if (path === 'colorableMeshes') {
      changes.colorableMeshes = val ? val.split(',').map(s => s.trim()).filter(Boolean) : []
    } else if (path === '_review.notes') {
      if (!changes._review) changes._review = {}
      changes._review.notes = val
    } else if (path.startsWith('specs.')) {
      const key = path.split('.')[1]
      if (!changes.specs) changes.specs = {}
      changes.specs[key] = val
    } else {
      changes[path] = val
    }
  })

  if (!changes._review) changes._review = {}
  const checkedIssues = []
  detailContent.querySelectorAll('.issue-check input:checked').forEach(cb => {
    checkedIssues.push(cb.dataset.issue)
  })
  changes._review.issues = checkedIssues
  changes._review.reviewedAt = new Date().toISOString()

  try {
    await patchProduct(selectedProductId, changes)
    toast(`Produkt „${changes.name}" gespeichert`, 'success')
    // Karte auf der aktuellen Seite sofort aktualisieren
    const card = productGrid.querySelector(`[data-id="${selectedProductId}"]`)
    if (card) {
      const updated = productCache.get(selectedProductId)
      const newBar = document.createElement('div')
      newBar.innerHTML = renderCardStatusBar(updated)
      const oldBar = card.querySelector('.card-status-bar')
      if (oldBar) oldBar.replaceWith(newBar.firstChild)
    }
    openDetail(selectedProductId)
  } catch (err) {
    toast(`Speichern fehlgeschlagen: ${err.message}`, 'error')
  }
}

async function deleteProduct() {
  if (!selectedProductId) return
  const p = productCache.get(selectedProductId)
  if (!p) return
  if (!confirm(`Produkt „${p.name}" wirklich löschen?`)) return

  try {
    const res = await fetch(`/__api/products/${encodeURIComponent(selectedProductId)}`, { method: 'DELETE' })
    if (!res.ok) throw new Error((await res.json()).error || res.status)
    productCache.delete(selectedProductId)
    closeDetail()
    toast(`Produkt „${p.name}" gelöscht`, 'info')
    fetchPage()
  } catch (err) {
    toast(`Löschen fehlgeschlagen: ${err.message}`, 'error')
  }
}

/* ═══════════════════════════════════════════════
   Konvertierung aus dem Dashboard starten
   ═══════════════════════════════════════════════ */
async function startProductConversion(productId) {
  const p = await fetchProductById(productId)
  if (!p) return

  // Ladeindikator auf dem Button
  const btns = document.querySelectorAll(`[data-product-id="${productId}"]`)
  btns.forEach(b => { b.disabled = true; b.style.opacity = '.5' })

  try {
    toast(`Konvertierung wird gestartet für „${p.name}" …`, 'info')
    const res = await fetch('/__api/convert-product', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId }),
    })
    const data = await res.json()
    if (!res.ok || !data.jobId) throw new Error(data.error || 'Kein Job-ID erhalten')

    toast(`Job gestartet – öffne Converter …`, 'success')
    setTimeout(() => {
      window.location.href = `/converter.html?monitor=${encodeURIComponent(data.jobId)}&productId=${encodeURIComponent(productId)}`
    }, 800)
  } catch (err) {
    toast(`Fehler: ${err.message}`, 'error')
    btns.forEach(b => { b.disabled = false; b.style.opacity = '' })
  }
}

/* ═══════════════════════════════════════════════
   Render all
   ═══════════════════════════════════════════════ */
function renderAll() {
  // Legacy-Wrapper – löst jetzt einen neuen API-Fetch aus
  fetchPage()
}

/* ═══════════════════════════════════════════════
   Toast
   ═══════════════════════════════════════════════ */
function toast(msg, type = 'info') {
  const el = document.createElement('div')
  el.className = `toast toast-${type}`
  el.textContent = msg
  toastContainer.appendChild(el)
  setTimeout(() => {
    el.classList.add('removing')
    setTimeout(() => el.remove(), 200)
  }, 3000)
}

/* ═══════════════════════════════════════════════
   Utilities
   ═══════════════════════════════════════════════ */
function esc(s) {
  const d = document.createElement('div')
  d.textContent = s || ''
  return d.innerHTML
}

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now - d
  const diffH = diffMs / 3600000
  if (diffH < 1) return 'gerade eben'
  if (diffH < 24) return `vor ${Math.floor(diffH)} Std.`
  const diffD = Math.floor(diffH / 24)
  if (diffD === 1) return 'gestern'
  if (diffD < 7) return `vor ${diffD} Tagen`
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/* ═══════════════════════════════════════════════
   Boot
   ═══════════════════════════════════════════════ */
init()
