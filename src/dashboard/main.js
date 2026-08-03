import '../lib/loggerInit.js'
import { createLogger } from '../lib/logger.js'
import { resolveAssetUrl } from '../lib/resolveAssetUrl.js'
const log = createLogger('dashboard')

import './dashboard.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import ColorService from '../services/ColorService.js'
import { buildColorOverridesFromMapping } from '../lib/hexMapping.js'
import {
  DEFAULT_COLOR_FROM_MAPPING,
  isDefaultColorMappingAuto,
  usesProductDefaultSurfaceColor,
  resolveEffectiveDefaultColor,
  resolveEffectiveDefaultColorOrFallback,
} from '../lib/defaultColorMapping.js'
import { createEmptyMaterial } from '../lib/mtlParser.js'
import { collectMeshesFromGroup } from '../lib/materialUtils.js'
import {
  ISSUE_CATALOG,
  STATUS_LABELS,
  MAIN_PRODUCT_CATEGORIES,
  MAIN_PRODUCT_CATEGORY_SET,
  mergeMainCategoryOptions,
  PAGE_SIZES,
  CARD_PREVIEW_POOL_MAX,
} from './modules/constants.js'
import { parseJsonResponse, esc, formatDate, fmtNumOrDash, cssEscapeId } from './modules/helpers.js'
import {
  stripModelLights,
  createCardScene,
  createDetailScene,
  createCardRenderer,
  createDetailRenderer,
  enableShadowsOnModel,
  fitShadowCamera,
  addShadowGround,
  disposeSceneGpuResources,
} from './modules/previewThree.js'
import { applyDashboardModelAppearance } from './modules/previewAppearance.js'
import { classifyEmbeddedPbrFinish, glbHexVsPbrHint } from './modules/colorComparePbr.js'

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

/** Filter/Sortierung/Ansicht überleben einen Reload (localStorage) – Suche + Typ-/Status-Filter
 *  + Sortierung + Grid/Liste, analog zu Zielfarbe/Kategorie/Seitengröße weiter unten. */
let currentFilter = (typeof localStorage !== 'undefined' && localStorage.getItem('dash_filter')) || 'all'
let currentStatus = (typeof localStorage !== 'undefined' && localStorage.getItem('dash_status')) || 'all'
let currentSort = (typeof localStorage !== 'undefined' && localStorage.getItem('dash_sort')) || 'newest'
/** Filter: all | __none__ | RAL xxxx (MTL-dominant oder explizite Standard-Farbe) */
let mappingTargetFilter =
  (typeof localStorage !== 'undefined' && localStorage.getItem('dash_mappingTarget')) || 'all'
/** Filter: all | __none__ | exakter mainCategory-String */
let categoryFilter =
  (typeof localStorage !== 'undefined' && localStorage.getItem('dash_mainCategory')) || 'all'
/** Hauptkategorien: feste fünf + ggf. Legacy aus API; für Toolbar, Karten-Schnellwahl */
let productCategoriesCache = []
let currentView = (typeof localStorage !== 'undefined' && localStorage.getItem('dash_view')) || 'grid'
let selectedProductId = null
let searchQuery = (typeof localStorage !== 'undefined' && localStorage.getItem('dash_search')) || ''
let _searchDebounce = null
let dirty = false

let currentPage = 1
let pageSize = parseInt(localStorage.getItem('dash_pageSize')) || 24
let previewObserver = null

const previewRenderers = new Map()
/** Keys für Teile-Vorschauen im Detail-Panel (zusammengesetzte Produkte). */
let detailPartPreviewIds = []

/**
 * LRU-Pool für Card-Previews, um WebGL-Context-Limit (Chrome ~16, Safari ~8–16)
 * nicht zu überschreiten. Überzählige Previews, die aktuell NICHT im Viewport sind,
 * werden entsorgt und beim Zurückscrollen neu geladen.
 *
 * Gilt nur für das Produktgrid (Card-IDs = product.id), NICHT für Detail-Previews
 * oder Teile-Previews (die haben keine reinen product.id als Key).
 */
const cardPreviewExitQueue = []

const gltfLoader = new GLTFLoader()
const dracoLoader = new DRACOLoader()
dracoLoader.setDecoderPath('/draco/')
gltfLoader.setDRACOLoader(dracoLoader)

/* ═══════════════════════════════════════════════
   Maße (Auto-Messung aus GLB)
   ═══════════════════════════════════════════════ */

/** Versucht einen Millimeter-Wert aus einer Spec-Angabe zu lesen („1800 mm", „180 cm", „1.8 m"). */
function parseMmFromSpecValue(val) {
  if (val == null) return 0
  const s = String(val).trim().toLowerCase()
  if (!s || s === '–' || s === '-') return 0
  const num = parseFloat(s.replace(',', '.').replace(/[^\d.\-]/g, ''))
  if (!Number.isFinite(num) || num <= 0) return 0
  if (/\bmm\b/.test(s)) return Math.round(num)
  if (/\bcm\b/.test(s)) return Math.round(num * 10)
  if (/(^|\d\s*)m(\b|$)/.test(s)) return Math.round(num * 1000)
  return Math.round(num)
}

function formatMmSpec(mm) {
  if (!Number.isFinite(mm) || mm <= 0) return ''
  return `${Math.round(mm)} mm`
}

/** True, wenn mindestens eine der drei Dimensions-Specs einen echten Wert hat. */
function specsHaveDimensions(specs) {
  if (!specs) return false
  return ['height', 'width', 'depth'].some((k) => parseMmFromSpecValue(specs[k]) > 0)
}

/**
 * Misst Breite × Höhe × Tiefe (mm) per Axis-Aligned Bounding Box des GLB-Modells.
 * `rotationOffset` wird mitberücksichtigt, sodass die Maße der Ausrichtung im Showroom entsprechen.
 * @param {object} product - Produktdatensatz mit `glbFile` (+ optional `rotationOffset`).
 * @param {THREE.Object3D|null} [modelOverride] - Bereits geladenes Modell (z. B. Detail-Preview).
 * @returns {Promise<{width:number,height:number,depth:number}|null>}
 */
async function measureProductDimensionsMm(product, modelOverride = null) {
  const readBox = (root) => {
    root.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(root)
    if (!Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) return null
    const size = box.getSize(new THREE.Vector3())
    return {
      width: Math.round(size.x * 1000),
      height: Math.round(size.y * 1000),
      depth: Math.round(size.z * 1000),
    }
  }

  if (modelOverride) return readBox(modelOverride)
  if (!product?.glbFile) return null
  try {
    const gltf = await new Promise((resolve, reject) => {
      gltfLoader.load(resolveAssetUrl(product.glbFile), resolve, undefined, reject)
    })
    const model = gltf.scene
    const toRad = Math.PI / 180
    const ro = product.rotationOffset
    if (ro) {
      model.rotation.set(
        (ro.x ?? 0) * toRad,
        (ro.y ?? 0) * toRad,
        (ro.z ?? 0) * toRad,
      )
    }
    const dims = readBox(model)
    disposeSceneGpuResources(model)
    return dims
  } catch (err) {
        log.scoped("Dashboard").warn("Maße konnten nicht geladen werden:", product?.glbFile, err)
    return null
  }
}

/**
 * Misst die Maße und schreibt sie in `specs.{width,height,depth}` (PATCH).
 * Aktualisiert offene Detail-Inputs und die zugehörige Karte im Grid.
 * @param {object} product - Aktuelle Produktdaten (mindestens `id` und `glbFile`).
 * @param {{silent?:boolean, modelOverride?:THREE.Object3D|null}} [opts]
 * @returns {Promise<{width:number,height:number,depth:number}|null>}
 */
async function measureAndPersistDimensions(product, opts = {}) {
  const { silent = false, modelOverride = null } = opts
  const dims = await measureProductDimensionsMm(product, modelOverride)
  if (!dims || (!dims.width && !dims.height && !dims.depth)) {
    if (!silent) toast('Maße konnten nicht ermittelt werden.', 'error')
    return null
  }
  const specsPatch = {
    load: product.specs?.load || '–',
    ...(product.specs || {}),
    width: formatMmSpec(dims.width),
    height: formatMmSpec(dims.height),
    depth: formatMmSpec(dims.depth),
  }
  try {
    const updated = await patchProduct(product.id, { specs: specsPatch })
    updateDimensionsUi(updated || { ...product, specs: specsPatch })
    if (!silent) {
      toast(
        `Maße gemessen: ${dims.width} × ${dims.height} × ${dims.depth} mm (B × H × T)`,
        'success',
      )
    }
    return dims
  } catch (err) {
    if (!silent) toast(`Maße speichern fehlgeschlagen: ${err.message}`, 'error')
    return null
  }
}

/** Synct die Maß-Felder des Detail-Panels und die Card-Specs mit den aktuellen `product.specs`. */
function updateDimensionsUi(product) {
  const specs = product?.specs || {}
  if (selectedProductId === product?.id && detailContent) {
    for (const k of ['width', 'height', 'depth', 'load']) {
      const input = detailContent.querySelector(`[data-field="specs.${k}"]`)
      if (input) input.value = specs[k] || ''
    }
  }
  const card = productGrid?.querySelector(`.product-card[data-id="${cssEscapeId(product.id)}"]`)
  if (card) {
    const specsContainer = card.querySelector('.card-specs')
    if (specsContainer) {
      specsContainer.innerHTML =
        specBit('↕', specs.height) +
        specBit('↔', specs.width) +
        specBit('↗', specs.depth) +
        specBit('⚖', specs.load)
    }
  }
}

/** Farb-Gegenüberstellung Detail-Panel (MTL/OBJ ↔ GLB) */
let detailColorCompareState = null

async function fetchTextMaybe(url) {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return await res.text()
  } catch (_) {
    return null
  }
}

/** Wie scripts/resolve-ral-from-gtin.mjs – Antwort von GET /api/v1/gtin/filename */
function parseGtinStammRalFromApi(data) {
  if (!data?.success || !data.entry) return null
  const entry = data.entry
  const cc = entry.color_code
  if (cc != null && String(cc).trim() !== '' && String(cc).trim() !== '0') {
    const m = String(cc).match(/(\d{4})/)
    if (m) return { ralDigits: m[1], kind: 'ral' }
  }
  const suf = String(entry.finish_suffix || '').toUpperCase()
  if (suf && (suf.includes('VZK') || suf === 'VZ')) return { ralDigits: '9007', kind: 'verzinkt' }
  return null
}

function rgbTripletToHexMtl(r, g, b) {
  const to255 = (v) => Math.round(Math.max(0, Math.min(1, Number(v))) * 255)
  return (
    '#' +
    [to255(r), to255(g), to255(b)]
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  )
}

/** Hex (#RRGGBB) → MTL-RGB 0–1 */
function hexToRgb01(hex) {
  const n = ColorService.normalizeHex(hex)
  if (!n || n.length < 7) return { r: 0.8, g: 0.8, b: 0.8 }
  return {
    r: parseInt(n.slice(1, 3), 16) / 255,
    g: parseInt(n.slice(3, 5), 16) / 255,
    b: parseInt(n.slice(5, 7), 16) / 255,
  }
}

function rgb01ToHexForPicker(rgb) {
  if (!rgb || ![rgb.r, rgb.g, rgb.b].every((x) => Number.isFinite(Number(x)))) return '#CCCCCC'
  return rgbTripletToHexMtl(rgb.r, rgb.g, rgb.b)
}

function invalidateDetailMtlColorCompare(productId) {
  const p = productCache.get(productId)
  if (p && detailColorCompareState?.p?.id === productId) {
    void runDetailColorCompare(p)
  }
}

/** @returns {{ name: string, colors: { type: string, hex: string }[] }[]} */
function parseMtlMaterials(content) {
  const materials = []
  let current = null
  const typeMap = { Ka: 'ambient', Kd: 'diffuse', Ks: 'specular', Ke: 'emissive' }
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    if (t.startsWith('newmtl ')) {
      current = { name: t.slice(7).trim(), colors: [] }
      materials.push(current)
      continue
    }
    if (!current) continue
    for (const key of Object.keys(typeMap)) {
      if (t.startsWith(key + ' ')) {
        const parts = t.slice(key.length).trim().split(/\s+/).map(Number)
        if (parts.length >= 3) {
          current.colors.push({ type: typeMap[key], hex: rgbTripletToHexMtl(parts[0], parts[1], parts[2]) })
        }
        break
      }
    }
  }
  return materials
}

/** @returns {{ group: string, usemtl: string }[]} */
function parseObjUsemtlBlocks(content) {
  const lines = content.split(/\r?\n/)
  let currentGroup = '—'
  const out = []
  for (const line of lines) {
    const t = line.trim()
    if (t.startsWith('g ') || t.startsWith('o ')) {
      currentGroup = t.slice(2).trim() || currentGroup
    }
    if (t.startsWith('usemtl ')) {
      out.push({ group: currentGroup, usemtl: t.slice(7).trim() })
    }
  }
  return out
}

async function buildMergedColorOverridesForProduct(p) {
  let base = {}
  try {
    const res = await fetch('/mtl-ral-color-mapping.json')
    if (res.ok) {
      const data = await res.json()
      const getRalHex = (ralKey) => ColorService.getRAL(ralKey)?.hex ?? null
      base = buildColorOverridesFromMapping(data, getRalHex)
    }
  } catch (_) {}
  const pr = p?.conversionPreset?.colorOverrides
  if (pr && typeof pr === 'object' && !Array.isArray(pr)) {
    for (const [k, v] of Object.entries(pr)) {
      const nk = ColorService.normalizeHex(k)
      const nv = ColorService.normalizeHex(v)
      if (nk && nv) base[nk] = nv
    }
  }
  return base
}

function lookupOverrideTargetHex(sourceHex, overrides) {
  const n = ColorService.normalizeHex(sourceHex)
  if (!n || !overrides) return { hex: null, label: '—' }
  const to = overrides[n] ?? overrides[n.toLowerCase()]
  if (!to) return { hex: null, label: 'kein Mapping/Preset' }
  return { hex: ColorService.normalizeHex(to), label: 'Zielfarbe (Mapping/Preset)' }
}

function collectGlbMaterialRows(root) {
  const rows = []
  root.traverse((child) => {
    if (!child.isMesh || !child.material) return
    const mats = Array.isArray(child.material) ? child.material : [child.material]
    mats.forEach((mat, mi) => {
      if (!mat) return
      let hex = null
      if (mat.color?.isColor) {
        hex = '#' + mat.color.getHexString().padStart(6, '0').toUpperCase()
      }
      const metal = mat.metalness ?? mat.metallic
      const rough = mat.roughness
      const ralExact = hex ? ColorService.getRALCodeFromHex(hex) : null
      rows.push({
        mesh: child.name || '—',
        mat: mat.name || `Material[${mi}]`,
        hex,
        metallic: metal != null && Number.isFinite(Number(metal)) ? Number(metal) : null,
        roughness: rough != null && Number.isFinite(Number(rough)) ? Number(rough) : null,
        ralExact,
      })
    })
  })
  return rows
}

function buildDetailColorCompareHtml(state) {
  const { p, overrides, mtlRows, objRows, glbRows, gtinStamm } = state
  const ruleCount = overrides ? Object.keys(overrides).length : 0

  let html = `<div class="cc-summary"><span class="cc-summary-badge">${ruleCount}</span> Farb-Regeln aktiv (global <code>mtl-ral-color-mapping.json</code> + optional <code>conversionPreset</code> am Produkt).</div>`

  html += '<h4 class="cc-subtitle">GTIN-/Artikel-Stamm</h4>'
  if (gtinStamm?.queried) {
    if (gtinStamm.error) {
      html += `<p class="cc-muted">${esc(gtinStamm.error)}</p>`
    } else if (!gtinStamm.success) {
      html += `<p class="cc-muted">${esc(gtinStamm.reason || 'Kein Treffer in der Stammdaten-Liste (API).')}</p>`
    } else {
      const g = gtinStamm
      const ralDisp = g.ralCode || '—'
      const hx = g.hex
      const sw = hx
        ? `<span class="cc-swatch" style="background:${hx}"></span><code>${esc(hx)}</code>`
        : '—'
      html += '<div class="cc-table-wrap"><table class="color-compare-table"><thead><tr>'
      html += '<th>Dateiname (API)</th><th>RAL laut Stamm</th><th>Hex (Palette)</th><th>Hinweis</th></tr></thead><tbody>'
      html += `<tr><td class="cc-mono">${esc(g.filename || '–')}</td><td>${esc(ralDisp)}</td><td class="cc-cell-swatch">${sw}</td><td class="cc-muted">Konvertierung/Registrierung: Reihenfolge <code>defaultColor</code> → MTL-Mapping (<code>_mtlColors</code>) → GTIN-Stamm (nicht aus GLB-Dateinamen).</td></tr>`
      html += '</tbody></table></div>'
      if (g.productName) html += `<p class="cc-muted" style="margin-top:.35rem">Produkt: ${esc(g.productName)}</p>`
    }
  } else {
    html +=
      '<p class="cc-muted">Keine GTIN/Artikelnummer am Produkt – kein Abgleich mit der Liste. Felder unter Stammdaten ausfüllen.</p>'
  }

  html += '<h4 class="cc-subtitle">MTL – Diffus (Kd)</h4>'
  if (!mtlRows.length) {
    html += '<p class="cc-muted">Keine MTL-Datei in den CAD-Pfaden oder nicht per HTTP lesbar.</p>'
  } else {
    html += '<div class="cc-table-wrap"><table class="color-compare-table"><thead><tr>'
    html += '<th>Datei</th><th>Material</th><th>Kd</th><th>→ Ziel</th><th>Met./Rau. (RAL-Logik)</th></tr></thead><tbody>'
    for (const r of mtlRows) {
      const kd = r.kdHex || '–'
      const tgt = r.targetHex
      const swKd = kd.startsWith('#')
        ? `<span class="cc-swatch" style="background:${kd}"></span><code>${esc(kd)}</code>`
        : esc(kd)
      const swTgt = tgt
        ? `<span class="cc-swatch" style="background:${tgt}"></span><code>${esc(tgt)}</code>`
        : `<span class="cc-muted">${esc(r.targetLabel)}</span>`
      const fin = tgt ? ColorService.getMaterialFinishFromHex(tgt, p.surfaceFinish) : null
      const finStr = fin ? `M ${fmtNumOrDash(fin.metallic, 2)} / R ${fmtNumOrDash(fin.roughness, 2)}` : '–'
      const ralT = tgt ? ColorService.getRALCodeFromHex(tgt) : null
      html += `<tr><td class="cc-mono">${esc(r.file)}</td><td>${esc(r.name)}</td><td class="cc-cell-swatch">${swKd}</td><td class="cc-cell-swatch">${swTgt}</td><td class="cc-mono cc-muted">${esc(finStr)}${ralT ? `<br><span class="cc-ral">${esc(ralT)}</span>` : ''}</td></tr>`
    }
    html += '</tbody></table></div>'
  }

  if (objRows.length) {
    html += '<h4 class="cc-subtitle">OBJ – Objekt / usemtl</h4>'
    html += '<div class="cc-table-wrap"><table class="color-compare-table"><thead><tr><th>Datei</th><th>Gruppe (o/g)</th><th>usemtl</th></tr></thead><tbody>'
    for (const r of objRows) {
      html += `<tr><td class="cc-mono">${esc(r.file)}</td><td>${esc(r.group)}</td><td>${esc(r.usemtl)}</td></tr>`
    }
    html += '</tbody></table></div>'
  }

  html += '<h4 class="cc-subtitle">GLB – exportiertes Modell</h4>'
  if (!p.glbFile) {
    html += '<p class="cc-muted">Noch keine GLB-Datei.</p>'
  } else if (!glbRows || glbRows.length === 0) {
    html += '<p class="cc-muted">Keine Mesh-Materialien gefunden.</p>'
  } else {
    html += '<div class="cc-table-wrap"><table class="color-compare-table"><thead><tr>'
    html +=
      '<th>Mesh</th><th>Material</th><th>Base Color</th><th>Metall</th><th>Rauheit</th><th>RAL laut Hex*</th><th>Einordnung</th></tr></thead><tbody>'
    for (const r of glbRows) {
      const hx = r.hex || '–'
      const sw = r.hex ? `<span class="cc-swatch" style="background:${r.hex}"></span><code>${esc(hx)}</code>` : '–'
      const pbrKind = classifyEmbeddedPbrFinish(r.metallic, r.roughness)
      const pbrLine = pbrKind
        ? `<span class="cc-strong">In der GLB:</span> ${esc(pbrKind.label)}`
        : '<span class="cc-muted">PBR unklar</span>'
      const ralLine = r.ralExact
        ? `<span class="cc-strong">Hex in Palette:</span> ${esc(r.ralExact)}`
        : '<span class="cc-muted">Kein exakter Paletten-Treffer</span>'
      const hint = glbHexVsPbrHint(r.hex, r.ralExact, r.metallic, r.roughness)
      const hintHtml = hint ? `<div class="cc-conflict">${hint}</div>` : ''
      html += `<tr><td>${esc(r.mesh)}</td><td>${esc(r.mat)}</td><td class="cc-cell-swatch">${sw}</td><td class="cc-mono">${fmtNumOrDash(r.metallic)}</td><td class="cc-mono">${fmtNumOrDash(r.roughness)}</td><td class="cc-muted">${ralLine}</td><td class="cc-interpret">${pbrLine}${hintHtml}</td></tr>`
    }
    html += '</tbody></table></div>'
    html +=
      '<p class="cc-footnote">* Spalte „RAL laut Hex“: exakter Eintrag in <code>ralColors.json</code> zur Base Color (z. B. <code>#F4F4F4</code> = RAL 9007). Das ist <strong>nicht</strong> automatisch die gewünschte Artikel-Farbe – die steht unter Standard-Farbe / Konvertierung. Entscheidend fürs Erscheinungsbild sind die Spalten Metall/Rauheit in der Datei.</p>'
  }

  html += '<h4 class="cc-subtitle">Dashboard-Vorschau & Showroom</h4>'
  html += '<div class="cc-table-wrap"><table class="color-compare-table"><thead><tr><th>Modus</th><th>Farbe</th><th>Metall</th><th>Rauheit</th><th>Hinweis</th></tr></thead><tbody>'
  html +=
    '<tr><td>Dashboard (Karten &amp; Detail)</td><td colspan="3" class="cc-muted">Mesh-Materialien und Base Color wie in der GLB; bei manueller Oberfläche (Pulver/Verzinkt) werden nur Metall/Rauheit angepasst, nicht die eingebetteten Farben.</td><td class="cc-muted">Die 3D-Vorschau zeigt die Datei ohne Auflage der konfigurierten Produkt-Standardfarbe.</td></tr>'
  if (usesProductDefaultSurfaceColor(p)) {
    const hx = ColorService.ralToHex(resolveEffectiveDefaultColorOrFallback(p))
    const fin = ColorService.getMaterialFinishFromHex(hx, p.surfaceFinish)
    const sfNote = ColorService.getExplicitSurfaceFinish(p.surfaceFinish)
      ? ` Oberfläche: <strong>${esc(p.surfaceFinish === 'verzinkt' ? 'Verzinkt' : 'Pulver')}</strong> (manuell).`
      : ''
    const ralLabel = isDefaultColorMappingAuto(p.defaultColor)
      ? `Automatisch → ${esc(resolveEffectiveDefaultColorOrFallback(p))}`
      : esc(p.defaultColor)
    html += `<tr><td>Showroom (Standard-Farbe aktiv)</td><td class="cc-cell-swatch"><span class="cc-swatch" style="background:${hx}"></span><code>${esc(hx)}</code><br><span class="cc-muted">${ralLabel}</span></td><td class="cc-mono">${fmtNumOrDash(fin?.metallic, 2)}</td><td class="cc-mono">${fmtNumOrDash(fin?.roughness, 2)}</td><td class="cc-muted">Ersetzt die Farbe auf allen Meshes des Modells (MaterialManager).${sfNote}</td></tr>`
  } else {
    html +=
      '<tr><td>Showroom</td><td colspan="3" class="cc-muted">Es gelten die Materialien aus der GLB (wie Dashboard).</td><td class="cc-muted">Finish leitet sich aus Mesh-Farben ab (MaterialManager).</td></tr>'
  }
  html += '</tbody></table></div>'

  return html
}

function tryRenderDetailColorCompare() {
  const mount = document.getElementById('detailColorCompareMount')
  const state = detailColorCompareState
  if (!mount || !state) return
  if (state.err) {
    mount.innerHTML = `<p class="color-compare-error">${esc(state.err)}</p>`
    return
  }
  if (!state.mtlDone) return
  const needGlb = !!(state.p && state.p.glbFile)
  if (needGlb && state.glbRows === null) {
    mount.innerHTML =
      '<p class="color-compare-status color-compare-wait-glb">CAD-Daten geladen. Warte auf GLB-Analyse …</p>'
    return
  }
  mount.innerHTML = buildDetailColorCompareHtml(state)
}

function resolveCadSiblingUrl(baseUrl, relativeName) {
  const name = (relativeName || '').trim().split(/\s+/)[0]
  if (!name) return null
  const clean = name.split(/[/\\]/).pop()
  const i = baseUrl.lastIndexOf('/')
  if (i < 0) return `/${clean}`
  return `${baseUrl.slice(0, i + 1)}${clean}`
}

async function runDetailColorCompare(p) {
  const mount = document.getElementById('detailColorCompareMount')
  if (!mount) return
  detailColorCompareState = {
    p,
    overrides: {},
    mtlRows: [],
    objRows: [],
    glbRows: p.glbFile ? null : [],
    mtlDone: false,
    err: null,
    gtinStamm: null,
  }
  try {
    const gtinQ = String(p.gtin || '').replace(/\D/g, '')
    const artQ = String(p.articleNumber || p.shopwareProductId || '').trim()
    if (gtinQ || artQ) {
      const params = new URLSearchParams()
      if (gtinQ) params.set('gtin', gtinQ)
      if (artQ) params.set('articleNumber', artQ)
      try {
        const gr = await fetch(`/api/v1/gtin/filename?${params}`)
        const gd = await parseJsonResponse(gr)
        const pr = parseGtinStammRalFromApi(gd)
        const ralCode = pr ? `RAL ${pr.ralDigits}` : null
        const hex =
          ralCode && ColorService.getRAL(ralCode) ? ColorService.ralToHex(ralCode) : null
        detailColorCompareState.gtinStamm = {
          queried: true,
          success: !!gd.success,
          filename: gd.filename || null,
          ralCode,
          hex,
          productName: gd.entry?.product_name || null,
          reason: gd.reason || gd.error || null,
        }
      } catch (e) {
        detailColorCompareState.gtinStamm = { queried: true, error: e.message || String(e) }
      }
    } else {
      detailColorCompareState.gtinStamm = { queried: false }
    }

    detailColorCompareState.overrides = await buildMergedColorOverridesForProduct(p)
    const cad = p.cadFiles || []
    const mtlUrls = [...new Set(cad.filter((f) => f.toLowerCase().endsWith('.mtl')))]
    const objUrls = cad.filter((f) => f.toLowerCase().endsWith('.obj'))
    const mtlFetched = new Set(mtlUrls)

    for (const objUrl of objUrls) {
      const text = await fetchTextMaybe(objUrl)
      if (!text) continue
      const mtlLine = text.match(/^\s*mtllib\s+(.+)$/im)
      if (!mtlLine) continue
      const sibling = resolveCadSiblingUrl(objUrl, mtlLine[1])
      if (sibling && !mtlFetched.has(sibling)) {
        mtlUrls.push(sibling)
        mtlFetched.add(sibling)
      }
    }

    for (const url of mtlUrls) {
      const text = await fetchTextMaybe(url)
      const fn = url.split('/').pop() || url
      if (!text) continue
      const mats = parseMtlMaterials(text)
      for (const m of mats) {
        const kd = m.colors.find((c) => c.type === 'diffuse') || m.colors[0]
        const kdHex = kd ? ColorService.normalizeHex(kd.hex) : null
        const { hex: targetHex, label: targetLabel } = kdHex
          ? lookupOverrideTargetHex(kdHex, detailColorCompareState.overrides)
          : { hex: null, label: '—' }
        detailColorCompareState.mtlRows.push({
          file: fn,
          name: m.name,
          kdHex,
          targetHex,
          targetLabel,
        })
      }
    }

    for (const url of objUrls) {
      const text = await fetchTextMaybe(url)
      const fn = url.split('/').pop() || url
      if (!text) continue
      for (const row of parseObjUsemtlBlocks(text)) {
        detailColorCompareState.objRows.push({ file: fn, ...row })
      }
    }

    detailColorCompareState.mtlDone = true
    tryRenderDetailColorCompare()
  } catch (e) {
    detailColorCompareState.err = e.message || String(e)
    detailColorCompareState.mtlDone = true
    tryRenderDetailColorCompare()
  }
}

function fillDetailColorCompareGlb(p, root) {
  if (!detailColorCompareState || detailColorCompareState.p?.id !== p.id) return
  detailColorCompareState.glbRows = collectGlbMaterialRows(root)
  tryRenderDetailColorCompare()
}

/* Studio-Preview-Three: ./modules/previewThree.js */

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
const mappingTargetSelect = $('#mappingTargetSelect')
const categorySelect = $('#categorySelect')

/* ═══════════════════════════════════════════════
   API – server-seitige Datenlast
   ═══════════════════════════════════════════════ */
function buildApiParams() {
  const p = new URLSearchParams({
    page: String(currentPage),
    limit: String(pageSize),
    search: searchQuery,
    filter: currentFilter,
    status: currentStatus,
    sort: currentSort,
  })
  p.set('targetRal', mappingTargetFilter)
  p.set('category', categoryFilter)
  return p
}

function fillCategoryToolbarSelect() {
  if (!categorySelect) return
  const saved = categoryFilter
  categorySelect.innerHTML = `
    <option value="all">Alle Kategorien</option>
    <option value="__none__">Ohne Kategorie</option>
    ${productCategoriesCache.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
  `
  const ok = [...categorySelect.options].some((o) => o.value === saved)
  categorySelect.value = ok ? saved : 'all'
  if (!ok) categoryFilter = 'all'
}

async function loadCategoryOptions() {
  try {
    const res = await fetch('/__api/product-categories')
    const data = await parseJsonResponse(res)
    if (!res.ok) throw new Error(data.error || 'Kategorien')
    productCategoriesCache = mergeMainCategoryOptions(data.categories || [])
  } catch {
    productCategoriesCache = mergeMainCategoryOptions([])
  }
  fillCategoryToolbarSelect()
}

function renderMainCategoryFieldRowHtml(p) {
  const cur = String(p.mainCategory || '').trim()
  const legacy = Boolean(cur && !MAIN_PRODUCT_CATEGORY_SET.has(cur))
  return `
      <div class="field-row">
        <label class="field-label">Hauptkategorie</label>
        <select class="field-value field-select" data-field="mainCategory" title="Fachboden-, Paletten-, Kragarm-, Weitspannregale oder Zubehör">
          <option value=""${!cur ? ' selected' : ''}>— Keine —</option>
          ${MAIN_PRODUCT_CATEGORIES.map(
            (c) => `<option value="${esc(c)}"${c === cur ? ' selected' : ''}>${esc(c)}</option>`,
          ).join('')}
          ${legacy ? `<option value="${esc(cur)}" selected>${esc(cur)} (Legacy)</option>` : ''}
        </select>
      </div>`
}

function renderCategoryQuickSelect(p) {
  const cur = String(p.mainCategory || '').trim()
  let opts = `<option value=""${!cur ? ' selected' : ''}>— Keine —</option>`
  for (const c of productCategoriesCache) {
    opts += `<option value="${esc(c)}"${c === cur ? ' selected' : ''}>${esc(c)}</option>`
  }
  if (cur && !productCategoriesCache.includes(cur)) {
    opts += `<option value="${esc(cur)}" selected>${esc(cur)} (Legacy)</option>`
  }
  return `<select class="card-cat-quick sort-select" data-product-id="${esc(p.id)}" title="Hauptkategorie (Schnellwahl)" onclick="event.stopPropagation()" onkeydown="event.stopPropagation()">${opts}</select>`
}

async function loadMappingTargetOptions() {
  if (!mappingTargetSelect) return
  try {
    const res = await fetch('/__api/mapping-target-options')
    const data = await parseJsonResponse(res)
    if (!res.ok) throw new Error(data.error || 'Optionen')
    const rals = data.rals || []
    const saved = mappingTargetFilter
    mappingTargetSelect.innerHTML = `
      <option value="all">Alle Zielfarben</option>
      <option value="__none__">Ohne Zuordnung</option>
      ${rals.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}
    `
    const ok = [...mappingTargetSelect.options].some((o) => o.value === saved)
    mappingTargetSelect.value = ok ? saved : 'all'
    if (!ok) mappingTargetFilter = 'all'
  } catch {
    mappingTargetSelect.innerHTML = `
      <option value="all">Alle</option>
      <option value="__none__">Ohne Zuordnung</option>
    `
  }
}

async function fetchPage() {
  renderSkeleton()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  try {
    const res  = await fetch(`/__api/products?${buildApiParams()}`, { signal: controller.signal })
    clearTimeout(timeout)
    const data = await parseJsonResponse(res)
    if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`)
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
  const fromCache = productCache.has(id)
  if (fromCache) return productCache.get(id)
  try {
    const res = await fetch(`/__api/products/${encodeURIComponent(id)}`)
    const p = await parseJsonResponse(res)
    if (!res.ok) return null
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
  const data = await parseJsonResponse(res)
  if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`)
  productCache.set(id, data.product)
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
  bindGlobalNameRulesModal()
  bindGlobalReductionRulesModal()
  await Promise.all([loadMappingTargetOptions(), loadCategoryOptions()])
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

/** Spiegelt die aus localStorage wiederhergestellten Filter/Sort/Ansicht-Werte in die Toolbar-UI. */
function syncToolbarUiFromState() {
  searchInput.value = searchQuery
  filterGroup.querySelectorAll('.filter-chip').forEach(c =>
    c.classList.toggle('active', c.dataset.filter === currentFilter))
  statusFilterGroup.querySelectorAll('.filter-chip').forEach(c =>
    c.classList.toggle('active', c.dataset.status === currentStatus))
  sortSelect.value = currentSort
  viewToggle.querySelectorAll('.view-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.view === currentView))
  productGrid.classList.toggle('list-view', currentView === 'list')
}

/* ═══════════════════════════════════════════════
   Events
   ═══════════════════════════════════════════════ */
function bindEvents() {
  syncToolbarUiFromState()
  if (glbFileInput) {
    glbFileInput.accept = `.glb,.GLB,${CAD_ACCEPT_PICKER}`
  }

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
    try { localStorage.setItem('dash_filter', currentFilter) } catch (_) {}
    applyFilters()
  })

  statusFilterGroup.addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip')
    if (!chip) return
    currentStatus = chip.dataset.status
    statusFilterGroup.querySelectorAll('.filter-chip').forEach(c =>
      c.classList.toggle('active', c.dataset.status === currentStatus))
    try { localStorage.setItem('dash_status', currentStatus) } catch (_) {}
    applyFilters()
  })

  sortSelect.addEventListener('change', () => {
    currentSort = sortSelect.value
    try { localStorage.setItem('dash_sort', currentSort) } catch (_) {}
    currentPage = 1
    fetchPage()
  })

  if (mappingTargetSelect) {
    mappingTargetSelect.addEventListener('change', () => {
      mappingTargetFilter = mappingTargetSelect.value
      try {
        localStorage.setItem('dash_mappingTarget', mappingTargetFilter)
      } catch (_) {}
      applyFilters()
    })
  }

  if (categorySelect) {
    categorySelect.addEventListener('change', () => {
      categoryFilter = categorySelect.value
      try {
        localStorage.setItem('dash_mainCategory', categoryFilter)
      } catch (_) {}
      applyFilters()
    })
  }

  viewToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.view-btn')
    if (!btn) return
    currentView = btn.dataset.view
    viewToggle.querySelectorAll('.view-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.view === currentView))
    productGrid.classList.toggle('list-view', currentView === 'list')
    try { localStorage.setItem('dash_view', currentView) } catch (_) {}
  })

  productGrid.addEventListener('click', (e) => {
    if (e.target.closest('.card-cat-quick')) return
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
  $('#detailPrev').addEventListener('click', () => navigateDetail(-1))
  $('#detailNext').addEventListener('click', () => navigateDetail(1))
  $('#btnSaveDetail').addEventListener('click', saveDetail)
  $('#btnDeleteProduct').addEventListener('click', deleteProduct)
  $('#btnSave').addEventListener('click', saveToServer)
  $('#btnExport').addEventListener('click', exportJSON)
  $('#btnAddGlb').addEventListener('click', () => glbFileInput.click())
  const btnConvertSelected = $('#btnConvertSelected')
  if (btnConvertSelected) btnConvertSelected.addEventListener('click', startSelectedConversions)
  const btnSelectAllPage = $('#btnSelectAllPage')
  if (btnSelectAllPage) btnSelectAllPage.addEventListener('click', toggleSelectAllOnPage)
  const btnConvertAll = $('#btnConvertAll')
  if (btnConvertAll) btnConvertAll.addEventListener('click', startAllConversions)
  const btnClearQueue = $('#btnClearQueue')
  if (btnClearQueue) btnClearQueue.addEventListener('click', clearConversionQueue)

  const btnToggleUsdz = $('#btnToggleUsdz')
  if (btnToggleUsdz) btnToggleUsdz.addEventListener('click', toggleExportUsdz)
  updateUsdzToggleUI()

  const btnAssignCategory = $('#btnAssignCategory')
  if (btnAssignCategory) {
    btnAssignCategory.addEventListener('click', (e) => {
      e.stopPropagation()
      const pop = document.getElementById('catAssignPopover')
      if (pop && !pop.hidden) closeCategoryAssignPopover()
      else openCategoryAssignPopover()
    })
  }
  const catAssignItems = $('#catAssignItems')
  if (catAssignItems) {
    catAssignItems.addEventListener('click', (e) => {
      const item = e.target.closest('.cat-assign-item')
      if (!item) return
      assignCategoryToSelected(item.dataset.cat || '')
    })
  }
  const catAssignClear = $('#catAssignClear')
  if (catAssignClear) catAssignClear.addEventListener('click', () => assignCategoryToSelected(''))
  const catAssignCancel = $('#catAssignCancel')
  if (catAssignCancel) catAssignCancel.addEventListener('click', closeCategoryAssignPopover)
  updateAssignCategoryButton()

  productGrid.addEventListener('change', async (e) => {
    const quick = e.target.closest('.card-cat-quick')
    if (quick) {
      const id = quick.dataset.productId
      if (!id) return
      const val = quick.value.trim()
      const prev = String(productCache.get(id)?.mainCategory || '').trim()
      try {
        await patchProduct(id, { mainCategory: val })
        toast('Hauptkategorie gespeichert', 'success')
        await loadCategoryOptions()
        await fetchPage()
      } catch (err) {
        toast(err.message, 'error')
        quick.value = prev || ''
      }
      return
    }
    if (!e.target.classList.contains('convert-checkbox')) return
    const id = e.target.dataset.productId
    if (!id) return
    if (e.target.checked) selectedForConversion.add(id)
    else selectedForConversion.delete(id)
    updateConvertSelectedButton()
  })
  const dashRotateAxis = document.getElementById('dashRotateAxis')
  const dashRotateDegrees = document.getElementById('dashRotateDegrees')
  if (dashRotateAxis && dashRotateDegrees) {
    const propagateToDetail = () => {
      dashRotateDegrees.disabled = dashRotateAxis.value !== 'X' && dashRotateAxis.value !== 'Y' && dashRotateAxis.value !== 'Z'
      // Header und Detail teilen sich denselben State – Live-Preview ggf. mitziehen.
      setDetailRotationFromHeader(dashRotateAxis.value, dashRotateDegrees.value)
    }
    dashRotateAxis.addEventListener('change', propagateToDetail)
    dashRotateDegrees.addEventListener('change', propagateToDetail)
  }
  glbFileInput.addEventListener('change', (e) => void onTileUploadFilesSelected(e))

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
    void handleDroppedFiles(e.dataTransfer.files)
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
    if (selectedProductId && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return
      e.preventDefault()
      navigateDetail(e.key === 'ArrowLeft' ? -1 : 1)
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
const UPLOAD_OVERWRITE_CANCELLED = 'UPLOAD_OVERWRITE_CANCELLED'

/**
 * POST mit Body; bei 409 (Datei existiert) einmal confirm, dann mit X-Overwrite erneut.
 * @param {string} apiPath z. B. /__api/upload-glb
 * @param {File} file
 * @param {string} xFilenameHeaderValue für X-Filename (encodeURIComponent)
 */
async function uploadBinaryWithOverwritePrompt(apiPath, file, xFilenameHeaderValue) {
  const baseHeaders = {
    'Content-Type': 'application/octet-stream',
    'X-Filename': encodeURIComponent(xFilenameHeaderValue),
  }
  const post = (overwrite) =>
    fetch(apiPath, {
      method: 'POST',
      headers: { ...baseHeaders, ...(overwrite ? { 'X-Overwrite': '1' } : {}) },
      body: file,
    })

  let res = await post(false)
  let data = await parseJsonResponse(res)
  if (res.status === 409 && data?.conflict) {
    const hint = data.path ? ` (${data.path})` : ''
    const msg = `Die Datei „${file.name}“ existiert bereits im Projekt${hint}.\n\nVorhandene Datei überschreiben?`
    if (!window.confirm(msg)) {
      const err = new Error('Upload abgebrochen')
      err.code = UPLOAD_OVERWRITE_CANCELLED
      throw err
    }
    res = await post(true)
    data = await parseJsonResponse(res)
  }
  if (!res.ok) throw new Error(data.error || data.message || `Upload fehlgeschlagen: ${res.status}`)
  return data
}

async function uploadGlbFile(file) {
  return uploadBinaryWithOverwritePrompt('/__api/upload-glb', file, file.name)
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
    defaultColor: '',
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

/** Produkt-ID aus Upload-Dateiname (ohne letzte Extension), gleiche Sanitisierung wie bei GLB. */
function deriveProductIdFromUploadFilename(fileName) {
  const base = fileName.split(/[/\\]/).pop() || fileName
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  return stem
    .replace(/[/\\]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'product'
}

/** Neues Produkt nur mit CAD (z. B. STEP) – wie GLB-Upload per PATCH anlegen. */
function makeProductFromCadFile(id, cadPath) {
  return {
    id,
    name: `Produkt ${id}`,
    cadFiles: [cadPath],
    colorableMeshes: [],
    defaultColor: '',
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
  const files = [...fileList]
  const glbFiles = files.filter((f) => f.name.toLowerCase().endsWith('.glb'))
  const cadFiles = files.filter((f) => isAllowedCadFile(f) && !f.name.toLowerCase().endsWith('.glb'))

  if (detailPanel.classList.contains('open') && selectedProductId && cadFiles.length) {
    const p = productCache.get(selectedProductId)
    const listEl = document.getElementById('detailCadList')
    if (p && listEl) {
      for (const file of cadFiles) await doUploadCad(file, p, listEl)
      if (!glbFiles.length) return
    }
  }

  if (glbFiles.length) {
    await processGlbUploads(glbFiles)
    return
  }

  if (cadFiles.length) {
    await processCadUploadsNewProducts(cadFiles)
    return
  }
  toast('Keine GLB- oder unterstützten CAD-Dateien gefunden', 'info')
}

async function onTileUploadFilesSelected(e) {
  const files = [...e.target.files]
  e.target.value = ''
  if (!files.length) return
  const glbFiles = files.filter((f) => f.name.toLowerCase().endsWith('.glb'))
  const cadFiles = files.filter((f) => isAllowedCadFile(f) && !f.name.toLowerCase().endsWith('.glb'))
  if (!glbFiles.length && !cadFiles.length) {
    toast('Keine GLB- oder unterstützten CAD-Dateien (z. B. STEP/STP).', 'error')
    return
  }
  await Promise.all([
    glbFiles.length ? processGlbUploads(glbFiles) : Promise.resolve(),
    cadFiles.length ? processCadUploadsNewProducts(cadFiles) : Promise.resolve(),
  ])
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
      if (err.code === UPLOAD_OVERWRITE_CANCELLED) {
        skipped++
        continue
      }
      toast(`Fehler bei ${file.name}: ${err.message}`, 'error')
    }
  }
  let msg = ''
  if (added) msg += `${added} Produkt${added > 1 ? 'e' : ''} hinzugefügt`
  if (skipped) msg += `${msg ? ', ' : ''}${skipped} übersprungen (bereits vorhanden oder abgebrochen)`
  if (msg) toast(msg, added ? 'success' : 'info')
  fetchPage()
}

/** Kachel „Hinzufügen“ / Seiten-Drop: neue Produkte mit CAD (ohne GLB) anlegen oder CAD an bestehendes Produkt anhängen. */
async function processCadUploadsNewProducts(files) {
  let added = 0
  let appended = 0
  for (const file of files) {
    if (!isAllowedCadFile(file)) continue
    try {
      const id = deriveProductIdFromUploadFilename(file.name)
      const existing = await fetchProductById(id)
      const up = await uploadCadFile(file, id)
      if (existing) {
        const base = [...(existing.cadFiles || [])]
        const next = mergeCadFilesReplaceFamily(base, up.path)
        const removed = base.filter((x) => !next.includes(x))
        await patchProduct(id, { cadFiles: next })
        await deleteUploadedCadFilesSilently(removed)
        appended++
      } else {
        await patchProduct(id, makeProductFromCadFile(id, up.path))
        added++
      }
    } catch (err) {
      if (err.code === UPLOAD_OVERWRITE_CANCELLED) continue
      toast(`Fehler bei ${file.name}: ${err.message}`, 'error')
    }
  }
  const parts = []
  if (added) parts.push(`${added} Produkt${added > 1 ? 'e' : ''} mit CAD neu`)
  if (appended) parts.push(`${appended}× CAD aktualisiert`)
  if (parts.length) toast(parts.join(', '), added || appended ? 'success' : 'info')
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
  try { localStorage.setItem('dash_search', searchQuery) } catch (_) {}
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

  const catalogTotal = currentStats?.total ?? 0
  if (catalogTotal === 0 && currentPageProducts.length === 0) {
    productGrid.innerHTML = `
      <div class="upload-card" title="GLB- oder CAD-Dateien hinzufügen (z. B. STEP)">
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
    const targetFilterActive = mappingTargetFilter && mappingTargetFilter !== 'all'
    const categoryFilterActive = categoryFilter && categoryFilter !== 'all'
    const hintZielfarbe = (catalogTotal > 0 && targetFilterActive)
      ? `<p class="empty-state-hint">Zielfarben-Filter: Keine Treffer mit dieser Zuordnung. MTL-basierte Ziele kommen aus <code>_mtlColors.dominantRal</code> – bei Bedarf <code>npm run sync:colors</code> ausführen. Produkte mit <strong>expliziter</strong> Standard-Farbe (nicht „Automatisch“) werden nach dieser RAL gefiltert.</p>`
      : ''
    const hintKategorie = (catalogTotal > 0 && categoryFilterActive)
      ? `<p class="empty-state-hint">Hauptkategorie-Filter: Keine Treffer. „Alle Kategorien“ wählen oder im Produkt eine Kategorie setzen (Fachboden-, Paletten-, Kragarm-, Weitspannregale, Zubehör).</p>`
      : ''
    productGrid.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
      <p>Keine Produkte gefunden</p>${hintZielfarbe}${hintKategorie}</div>`
    if (resultCount) resultCount.textContent = ''
    paginationContainer.innerHTML = ''
    return
  }

  const startIdx = (currentPage - 1) * pageSize
  const endIdx = Math.min(startIdx + pageSize, totalProducts)
  if (resultCount) resultCount.textContent = `${startIdx + 1}–${endIdx} von ${totalProducts}`

  const pageProducts = currentPageProducts

  const uploadCardHtml = currentView === 'grid' ? `
    <div class="upload-card" title="Weitere GLB- oder CAD-Dateien hinzufügen (z. B. STEP)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      <span>Hinzufügen</span>
    </div>` : ''

  productGrid.innerHTML = pageProducts.map((p, i) => {
    const isComposed = p.type === 'composed'
    const badgeClass = isComposed ? 'badge-composed' : 'badge-single'
    const badgeLabel = isComposed ? 'Zusammengebaut' : 'Einzelteil'
    const effRalCard = resolveEffectiveDefaultColorOrFallback(p)
    const color = ColorService.ralToHex(effRalCard)
    const tags = buildTags(p)
    const mainCat = String(p.mainCategory || '').trim()
    const hasThumb = !!(p.previewImage && String(p.previewImage).trim())

    return `
    <div class="product-card" data-id="${p.id}" style="animation-delay:${Math.min(i, 12) * 25}ms">
      <div class="card-preview${hasThumb ? ' has-thumb' : ''}"${hasThumb ? '' : ` data-glb="${p.glbFile || ''}"`} data-product-id="${p.id}" data-default-color="${esc(p.defaultColor || '')}" data-surface-finish="${esc(p.surfaceFinish || 'auto')}">
        ${hasThumb
          ? `<img class="card-preview-img" src="${esc(resolveAssetUrl(p.previewImage))}" loading="lazy" decoding="async" alt="" width="640" height="400">`
          : `<div class="card-preview-placeholder">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            <polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
          </svg>
          <span>3D-Vorschau</span>
        </div>`}
        <span class="card-type-badge ${badgeClass}">${badgeLabel}</span>
        <span class="card-color-dot" style="background:${color}" title="${isDefaultColorMappingAuto(p.defaultColor) ? 'Automatisch (MTL-Mapping)' : esc(p.defaultColor)}"></span>
      </div>
      <div class="card-body">
        <div class="card-name" title="${esc(p.name)}">${esc(p.name)}</div>
        <div class="card-cat-row">
          ${mainCat ? `<span class="card-main-cat-badge" title="Hauptkategorie">${esc(mainCat)}</span>` : ''}
          ${renderCategoryQuickSelect(p)}
        </div>
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
          ${p.cadFiles?.length ? `<label class="card-action card-convert-select" onclick="event.stopPropagation()" title="Für Konvertierung auswählen"><input type="checkbox" class="convert-checkbox" data-product-id="${esc(p.id)}"><span class="convert-check-label">Auswählen</span></label>
          <button class="card-action converter-link btn-convert-cad" data-product-id="${esc(p.id)}" title="${p.glbFile ? 'Neu konvertieren' : 'CAD → GLB konvertieren'}">
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

  productGrid.querySelectorAll('.convert-checkbox').forEach((cb) => {
    cb.checked = selectedForConversion.has(cb.dataset.productId)
  })
  updateConvertSelectedButton()
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

/** z. B. "X+90°" / "Z-90°" / "Y+180°" – null, wenn die Achse nicht gedreht ist. */
function formatAxisRotationTag(axis, deg) {
  const v = Number(deg) || 0
  if (!v) return null
  const sign = v > 0 ? '+' : ''
  return `${axis}${sign}${v}°`
}

/** Ein Tag pro Achse mit Live-Drehungs-Offset (rotationOffset) – zeigt Achse + Winkel direkt in der Karte. */
function buildRotationTags(p) {
  const ro = p?.rotationOffset
  if (!ro) return ''
  return ['x', 'y', 'z']
    .map((axis) => formatAxisRotationTag(axis.toUpperCase(), ro[axis]))
    .filter(Boolean)
    .map((label) => `<span class="card-tag tag-rotation" title="Live-Drehungs-Offset – wird beim nächsten Konvertieren in die GLB eingebrannt">${label}</span>`)
    .join('')
}

function buildTags(p) {
  let t = ''
  if (p.glbFile) t += '<span class="card-tag tag-glb">GLB</span>'
  if (p.usdzFile) t += '<span class="card-tag tag-usdz">USDZ</span>'
  if (p.cadFiles?.length) t += `<span class="card-tag tag-cad">CAD ${p.cadFiles.length}</span>`
  const ori = getOrientationInfo(p)
  if (ori) t += `<span class="card-tag ${ori.css}">${ori.label}</span>`
  t += buildRotationTags(p)
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

      if (entry.isIntersecting) {
        // Karte wieder sichtbar → aus Exit-Queue nehmen
        const qi = cardPreviewExitQueue.indexOf(productId)
        if (qi !== -1) cardPreviewExitQueue.splice(qi, 1)

        if (!previewRenderers.has(productId)) {
          if (!ensureFreeCardPreviewSlot()) return
          const cached = productCache.get(productId) || {}
          const product = {
            ...cached,
            id: productId,
            glbFile: glbFile || cached.glbFile,
            defaultColor: container.dataset.defaultColor ?? cached.defaultColor ?? '',
            surfaceFinish: container.dataset.surfaceFinish ?? cached.surfaceFinish ?? 'auto',
          }
          loadPreview(product, container)
        }
      } else {
        // Karte außerhalb des Viewports → in Exit-Queue (LRU-Kandidat)
        if (previewRenderers.has(productId) && !cardPreviewExitQueue.includes(productId)) {
          cardPreviewExitQueue.push(productId)
        }
      }
    })
  }, { rootMargin: '200px 0px', threshold: 0.01 })

  productGrid.querySelectorAll('.card-preview[data-glb]:not(.has-thumb)').forEach(el => {
    if (el.dataset.glb) previewObserver.observe(el)
  })
}

function destroyPreviewObserver() {
  if (previewObserver) { previewObserver.disconnect(); previewObserver = null }
  cardPreviewExitQueue.length = 0
}

/**
 * Pool-Kapazität für `previewRenderers` halten. Erst Off-Screen-Kandidaten (LRU-Exit-Queue),
 * dann – falls immer noch voll – älteste Einträge (Map-Insertion-Order) entsorgen.
 * Browser-Limit ~8–16 WebGL-Kontexte; Detail-Panel + Karten sollen sich darunter halten.
 */
function ensureFreeCardPreviewSlot() {
  while (previewRenderers.size >= CARD_PREVIEW_POOL_MAX && cardPreviewExitQueue.length > 0) {
    const victimId = cardPreviewExitQueue.shift()
    disposeCardPreviewById(victimId)
  }
  while (previewRenderers.size >= CARD_PREVIEW_POOL_MAX) {
    // Älteste Karten-Vorschau (nicht Teil-Preview) evakuieren.
    let oldestCardId = null
    for (const id of previewRenderers.keys()) {
      if (detailPartPreviewIds.includes(id)) continue
      oldestCardId = id
      break
    }
    if (!oldestCardId) break
    disposeCardPreviewById(oldestCardId)
  }
  return previewRenderers.size < CARD_PREVIEW_POOL_MAX
}

/** Ohne WEBGL_lose_context ruft Three.js `forceContextLoss` nur warnend ins Leere — dann überspringen. */
function safeForceWebGLContextLoss(renderer) {
  if (!renderer || typeof renderer.forceContextLoss !== 'function') return
  try {
    const gl = renderer.getContext?.()
    if (!gl || !gl.getExtension('WEBGL_lose_context')) return
    renderer.forceContextLoss()
  } catch {
    /* ignore */
  }
}

/**
 * Entsorgt eine Card-Preview und stellt den Placeholder im Container wieder her.
 * Wird vom LRU-Pool verwendet, wenn beim Scrollen Platz gebraucht wird.
 */
function disposeCardPreviewById(productId) {
  const entry = previewRenderers.get(productId)
  if (!entry) return
  if (entry.animId) cancelAnimationFrame(entry.animId)
  if (entry.resizeObs) entry.resizeObs.disconnect()
  if (entry.hoverTarget) {
    if (entry.onEnter) entry.hoverTarget.removeEventListener('mouseenter', entry.onEnter)
    if (entry.onLeave) entry.hoverTarget.removeEventListener('mouseleave', entry.onLeave)
  }
  if (entry.scene) disposeSceneGpuResources(entry.scene)
  if (entry.renderer) {
    const canvas = entry.renderer.domElement
    try { canvas?.parentElement?.removeChild(canvas) } catch {}
    entry.renderer.dispose()
    safeForceWebGLContextLoss(entry.renderer)
  }
  previewRenderers.delete(productId)

  // Placeholder wieder sichtbar machen – Container findet sich im Grid per data-product-id
  const container = productGrid?.querySelector(
    `.card-preview[data-product-id="${cssEscapeId(productId)}"]`,
  )
  if (container) {
    const ph = container.querySelector('.card-preview-placeholder')
    if (ph) ph.style.display = ''
  }
}

/**
 * Ersten gerenderten Frame als PNG speichern (falls noch kein previewImage) und
 * Karte auf statisches Bild umstellen — funktioniert ohne serverseitigen Puppeteer.
 */
async function persistCardThumbnailFromRenderer(product, renderer, container) {
  if (!product?.id || !container || product.previewImage) return
  if (container.dataset.thumbPersist === '1' || container.dataset.thumbPersist === 'done') return
  container.dataset.thumbPersist = '1'

  try {
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    })
    let dataUrl
    try {
      dataUrl = renderer.domElement.toDataURL('image/png')
    } catch (e) {
            log.scoped("Dashboard").warn("Thumbnail dataURL:", e)
      container.dataset.thumbPersist = ''
      return
    }
    if (!dataUrl || dataUrl.length < 200) {
      container.dataset.thumbPersist = ''
      return
    }

    const res = await fetch(`/__api/products/${encodeURIComponent(product.id)}/preview-png`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl }),
    })
    let data = {}
    try {
      data = await parseJsonResponse(res)
    } catch {
      data = {}
    }
    if (!res.ok || !data.previewImage) {
      container.dataset.thumbPersist = ''
      return
    }

    const entry = previewRenderers.get(product.id)
    if (!entry || entry.renderer !== renderer) {
      container.dataset.thumbPersist = ''
      return
    }

    const qi = cardPreviewExitQueue.indexOf(product.id)
    if (qi !== -1) cardPreviewExitQueue.splice(qi, 1)
    if (previewObserver && container) previewObserver.unobserve(container)

    if (entry.animId) cancelAnimationFrame(entry.animId)
    if (entry.resizeObs) entry.resizeObs.disconnect()
    if (entry.hoverTarget) {
      if (entry.onEnter) entry.hoverTarget.removeEventListener('mouseenter', entry.onEnter)
      if (entry.onLeave) entry.hoverTarget.removeEventListener('mouseleave', entry.onLeave)
    }
    if (entry.scene) disposeSceneGpuResources(entry.scene)
    if (entry.renderer?.domElement?.parentElement) {
      try { entry.renderer.domElement.parentElement.removeChild(entry.renderer.domElement) } catch { /* ignore */ }
    }
    if (entry.renderer) {
      entry.renderer.dispose()
      safeForceWebGLContextLoss(entry.renderer)
    }
    previewRenderers.delete(product.id)

    container.classList.add('has-thumb')
    container.removeAttribute('data-glb')
    const img = document.createElement('img')
    img.className = 'card-preview-img'
    img.src = resolveAssetUrl(data.previewImage)
    img.loading = 'lazy'
    img.decoding = 'async'
    img.alt = ''
    img.width = 640
    img.height = 400
    container.insertBefore(img, container.firstChild)

    const ph = container.querySelector('.card-preview-placeholder')
    if (ph) ph.style.display = 'none'

    const cpIdx = currentPageProducts.findIndex((x) => x.id === product.id)
    if (cpIdx >= 0) {
      currentPageProducts[cpIdx].previewImage = data.previewImage
      if (data.previewImageGeneratedAt) {
        currentPageProducts[cpIdx].previewImageGeneratedAt = data.previewImageGeneratedAt
      }
    }
    const cached = productCache.get(product.id)
    if (cached) {
      cached.previewImage = data.previewImage
      if (data.previewImageGeneratedAt) cached.previewImageGeneratedAt = data.previewImageGeneratedAt
    }
    product.previewImage = data.previewImage

    container.dataset.thumbPersist = 'done'
  } catch (e) {
        log.scoped("Dashboard").warn("Thumbnail speichern:", e)
    container.dataset.thumbPersist = ''
  }
}

function loadPreview(product, container) {
  const w = container.clientWidth || 320
  const h = container.clientHeight || 200
  const renderer = createCardRenderer(w, h)
  const scene = createCardScene(renderer)
  const camera = new THREE.PerspectiveCamera(35, w / h, 0.01, 50)
  // Pool-Zähler sofort erhöhen – damit parallele IntersectionObserver-Bursts nicht erneut laden.
  previewRenderers.set(product.id, { renderer, scene, camera, animId: null, resizeObs: null, pending: true })

  gltfLoader.load(resolveAssetUrl(product.glbFile), async (gltf) => {
    const current = previewRenderers.get(product.id)
    if (!current || current.renderer !== renderer) {
      // Inzwischen via LRU evakuiert oder durch neuen Load ersetzt → alles verwerfen.
      disposeSceneGpuResources(scene)
      renderer.dispose()
      safeForceWebGLContextLoss(renderer)
      return
    }
    const model = gltf.scene
    stripModelLights(model)
    try {
      await applyDashboardModelAppearance(model, product)
    } catch (e) {
            log.scoped("Dashboard").warn("Karten-Vorschau Farben:", e)
    }
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

    if (!product.previewImage) {
      void persistCardThumbnailFromRenderer(product, renderer, container)
    }

    function resizeCardPreview() {
      const cw = Math.max(1, container.clientWidth || 320)
      const ch = Math.max(1, container.clientHeight || 200)
      renderer.setSize(cw, ch)
      camera.aspect = cw / ch
      camera.updateProjectionMatrix()
      renderer.render(scene, camera)
    }

    const resizeObs = new ResizeObserver(() => {
      resizeCardPreview()
    })
    resizeObs.observe(container)

    previewRenderers.set(product.id, { renderer, scene, camera, center, dist, animId: null, resizeObs })

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

    const onEnter = () => {
      const e = previewRenderers.get(product.id)
      if (e && e.renderer === renderer && !e.animId) spin()
    }
    const onLeave = () => {
      const e = previewRenderers.get(product.id)
      if (!e || e.renderer !== renderer) return
      if (e.animId) { cancelAnimationFrame(e.animId); e.animId = null }
      try { renderer.render(scene, camera) } catch { /* disposed during transition */ }
    }
    container.addEventListener('mouseenter', onEnter)
    container.addEventListener('mouseleave', onLeave)
    const entry = previewRenderers.get(product.id)
    if (entry) {
      entry.hoverTarget = container
      entry.onEnter = onEnter
      entry.onLeave = onLeave
    }
  }, undefined, (err) => {
    // On error: Slot freigeben, damit der Pool nicht voll mit Pending-Einträgen steht.
    const pending = previewRenderers.get(product.id)
    if (pending?.pending) {
      previewRenderers.delete(product.id)
      disposeSceneGpuResources(scene)
      renderer.dispose()
      safeForceWebGLContextLoss(renderer)
    }
        log.scoped("Dashboard").warn("Preview fehlgeschlagen:", product.glbFile, err)
    const ph = container.querySelector('.card-preview-placeholder')
    if (ph) {
      const msg = err?.message || ''
      const hint = msg.includes('404') || msg.includes('Not Found')
        ? ' (Datei unter public' + product.glbFile + ' fehlt?)'
        : ''
      ph.querySelector('span').textContent = 'Modell nicht geladen' + hint
      ph.style.opacity = '.5'
    }
  })
}

function disposeAllPreviews() {
  previewRenderers.forEach((e) => {
    if (e.animId) cancelAnimationFrame(e.animId)
    if (e.resizeObs) e.resizeObs.disconnect()
    if (e.hoverTarget) {
      if (e.onEnter) e.hoverTarget.removeEventListener('mouseenter', e.onEnter)
      if (e.onLeave) e.hoverTarget.removeEventListener('mouseleave', e.onLeave)
    }
    if (e.scene) disposeSceneGpuResources(e.scene)
    if (e.renderer) {
      e.renderer.dispose()
      safeForceWebGLContextLoss(e.renderer)
    }
  })
  previewRenderers.clear()
}

function disposeDetailPartPreviews() {
  for (const rid of detailPartPreviewIds) {
    const e = previewRenderers.get(rid)
    if (e?.animId) cancelAnimationFrame(e.animId)
    if (e?.resizeObs) e.resizeObs.disconnect()
    if (e?.hoverTarget) {
      if (e.onEnter) e.hoverTarget.removeEventListener('mouseenter', e.onEnter)
      if (e.onLeave) e.hoverTarget.removeEventListener('mouseleave', e.onLeave)
    }
    if (e?.scene) disposeSceneGpuResources(e.scene)
    if (e?.renderer) {
      e.renderer.dispose()
      safeForceWebGLContextLoss(e.renderer)
    }
    previewRenderers.delete(rid)
  }
  detailPartPreviewIds = []
}

/**
 * Kleine 3D-Vorschau je Teile-GLB bei type === 'composed' (Kind-Produkte müssen im Cache sein).
 */
function mountPartShapePreviews(composedP) {
  disposeDetailPartPreviews()
  if (composedP.type !== 'composed' || !composedP.parts?.length) return
  const nodes = detailContent.querySelectorAll('.part-shape-preview[data-glb]')
  composedP.parts.forEach((pt, i) => {
    const container = nodes[i]
    const glb = container?.dataset?.glb
    if (!container || !glb) return
    const pp = productCache.get(pt.productId)
    const previewId = `${composedP.id}__part__${i}__${pt.productId}`
    if (previewRenderers.has(previewId)) return
    const product = {
      ...(pp || {}),
      id: previewId,
      glbFile: glb,
      defaultColor: pp?.defaultColor || '',
      surfaceFinish: pp?.surfaceFinish || 'auto',
    }
    loadPreview(product, container)
    detailPartPreviewIds.push(previewId)
  })
}

/** Kurzlabels für Live-Zusammenfassung in Regel-Karten */
const RULE_SUMMARY_TARGET_LABEL = Object.freeze({
  material: 'MTL',
  node: 'Knoten',
  mesh: 'Mesh',
  nodePath: 'Pfad',
  extras: 'Extras',
})

function updateNameRuleCardSummary(card) {
  const el = card?.querySelector?.('.name-rule-card-summary')
  if (!el) return
  const tv = (card.querySelector('.name-rule-target')?.value || 'material').trim()
  const target = RULE_SUMMARY_TARGET_LABEL[tv] || tv
  const pattern = (card.querySelector('.name-rule-pattern')?.value || '').trim()
  const flags = (card.querySelector('.name-rule-flags')?.value || '').trim()
  const ral = (card.querySelector('.name-rule-ral')?.value || '').trim()
  const finish = (card.querySelector('.name-rule-finish')?.value || 'auto').trim()
  const bits = [target]
  if (pattern) bits.push(flags ? `/${pattern}/${flags}` : `/${pattern}/`)
  if (ral) bits.push(ral)
  if (finish && finish !== 'auto') bits.push(finish === 'verzinkt' ? 'Verzinkt' : 'Pulver')
  el.textContent = bits.length > 1 || ral ? bits.join(' · ') : 'Ziel, Regex und RAL setzen …'
}

function updateReductionRuleCardSummary(card) {
  const el = card?.querySelector?.('.reduction-rule-card-summary')
  if (!el) return
  const tv = (card.querySelector('.reduction-rule-target')?.value || 'mesh').trim()
  const target = RULE_SUMMARY_TARGET_LABEL[tv] || tv
  const pattern = (card.querySelector('.reduction-rule-pattern')?.value || '').trim()
  const flags = (card.querySelector('.reduction-rule-flags')?.value || '').trim()
  const vMin = (card.querySelector('.reduction-rule-vmin')?.value || '').trim()
  const vMax = (card.querySelector('.reduction-rule-vmax')?.value || '').trim()
  const ratioRaw = (card.querySelector('.reduction-rule-ratio')?.value || '').trim().replace(',', '.')
  const targetVRaw = (card.querySelector('.reduction-rule-target-v')?.value || '').trim().replace(/\s/g, '')
  const errRaw = (card.querySelector('.reduction-rule-error')?.value || '').trim().replace(',', '.')
  const lock = !!card.querySelector('.reduction-rule-lock-border')?.checked
  const bits = [target]
  if (pattern) bits.push(flags ? `/${pattern}/${flags}` : `/${pattern}/`)
  if (vMin || vMax) bits.push(`V ${vMin || '–'}…${vMax || '∞'}`)
  const targetV = targetVRaw === '' ? NaN : Number(targetVRaw)
  const ratio = ratioRaw === '' ? NaN : Number(ratioRaw)
  let red = ''
  if (Number.isFinite(targetV) && targetV > 0) red = `→ ${Math.round(targetV)} V`
  else if (Number.isFinite(ratio)) red = `→ ${Math.round(ratio * 100)}% behalten`
  else red = '→ 50% behalten (Standard)'
  if (errRaw !== '' && Number.isFinite(Number(errRaw))) red += ` · ε ${errRaw}`
  if (lock) red += ' · Rand fix'
  el.textContent = `${bits.join(' · ')} ${red}`.trim()
}

/** Live-Zusammenfassung für eine Sichtbarkeits-Regel-Karte (analog Reduktion). */
function updateVisibilityRuleCardSummary(card) {
  const el = card?.querySelector?.('.visibility-rule-card-summary')
  if (!el) return
  const action = (card.querySelector('.visibility-rule-action')?.value || 'hide').trim()
  const tv = (card.querySelector('.visibility-rule-target')?.value || 'mesh').trim()
  const target = RULE_SUMMARY_TARGET_LABEL[tv] || tv
  const pattern = (card.querySelector('.visibility-rule-pattern')?.value || '').trim()
  const flags = (card.querySelector('.visibility-rule-flags')?.value || '').trim()
  const actionLabel = action === 'keep' ? 'Behalten' : 'Ausblenden'
  const bits = [actionLabel, target]
  if (pattern) bits.push(flags ? `/${pattern}/${flags}` : `/${pattern}/`)
  else bits.push('— Regex fehlt')
  el.textContent = bits.join(' · ')
}

function refreshNameRuleSummaries(container) {
  container?.querySelectorAll('.detail-name-rule-row').forEach((c) => updateNameRuleCardSummary(c))
}

function refreshReductionRuleSummaries(container) {
  container?.querySelectorAll('.detail-reduction-rule-row').forEach((c) => updateReductionRuleCardSummary(c))
}

function refreshVisibilityRuleSummaries(container) {
  container?.querySelectorAll('.detail-visibility-rule-row').forEach((c) => updateVisibilityRuleCardSummary(c))
}

function attachNameRuleSummaryListeners(container) {
  if (!container) return
  if (container._nameSummaryHandler) {
    container.removeEventListener('input', container._nameSummaryHandler)
    container.removeEventListener('change', container._nameSummaryHandler)
  }
  const handler = (e) => {
    const c = e.target.closest('.detail-name-rule-row')
    if (c) updateNameRuleCardSummary(c)
  }
  container._nameSummaryHandler = handler
  container.addEventListener('input', handler)
  container.addEventListener('change', handler)
}

function attachReductionRuleSummaryListeners(container) {
  if (!container) return
  if (container._reductionSummaryHandler) {
    container.removeEventListener('input', container._reductionSummaryHandler)
    container.removeEventListener('change', container._reductionSummaryHandler)
  }
  const handler = (e) => {
    const c = e.target.closest('.detail-reduction-rule-row')
    if (c) updateReductionRuleCardSummary(c)
  }
  container._reductionSummaryHandler = handler
  container.addEventListener('input', handler)
  container.addEventListener('change', handler)
}

function attachVisibilityRuleSummaryListeners(container) {
  if (!container) return
  if (container._visibilitySummaryHandler) {
    container.removeEventListener('input', container._visibilitySummaryHandler)
    container.removeEventListener('change', container._visibilitySummaryHandler)
  }
  const handler = (e) => {
    const c = e.target.closest('.detail-visibility-rule-row')
    if (c) updateVisibilityRuleCardSummary(c)
  }
  container._visibilitySummaryHandler = handler
  container.addEventListener('input', handler)
  container.addEventListener('change', handler)
}

/** Eine Zeile Namens-Regel (Material/Node → Regex → RAL). */
function renderNameRuleRowHtml(rule = {}) {
  const t = String(rule.target || 'material').trim()
  const target = ['material', 'node', 'mesh', 'nodePath', 'extras'].includes(t) ? t : 'material'
  const pattern = esc(rule.pattern || '')
  const flags = esc(rule.flags || '')
  const ral = (rule.ral && String(rule.ral).trim()) || ''
  const fRaw = String(rule.finish || '').trim().toLowerCase()
  const finish = fRaw === 'verzinkt' || fRaw === 'pulver' ? fRaw : 'auto'
  const ralOptions = ColorService.getAllColors()
    .map((c) => `<option value="${esc(c.code)}" ${ral === c.code ? 'selected' : ''}>${esc(c.code)} ${esc(c.name)}</option>`)
    .join('')
  return `<article class="detail-name-rule-row rule-card rule-card--name">
  <header class="rule-card-head">
    <div class="rule-card-summary name-rule-card-summary" aria-live="polite"></div>
    <button type="button" class="name-rule-remove btn-icon" title="Zeile entfernen">×</button>
  </header>
  <div class="rule-card-grid">
    <fieldset class="rule-group">
      <legend>Match</legend>
      <div class="rule-field-row">
        <span class="rule-field-label">Ziel</span>
        <select class="field-value name-rule-target" aria-label="Ziel">
      <option value="material" ${target === 'material' ? 'selected' : ''}>Material (MTL)</option>
      <option value="node" ${target === 'node' ? 'selected' : ''}>Knoten (Szene)</option>
      <option value="mesh" ${target === 'mesh' ? 'selected' : ''}>Mesh (Geometrie)</option>
      <option value="nodePath" ${target === 'nodePath' ? 'selected' : ''}>Hierarchiepfad</option>
      <option value="extras" ${target === 'extras' ? 'selected' : ''}>Extras (JSON)</option>
    </select>
      </div>
      <div class="rule-field-row">
        <span class="rule-field-label">Regex</span>
    <input type="text" class="field-value name-rule-pattern" placeholder="z. B. Pfad:.*/Rahmen/.* oder Extras:&quot;shapeId&quot;" value="${pattern}" title="JavaScript Regular Expression" spellcheck="false" autocomplete="off">
      </div>
      <div class="rule-field-row">
        <span class="rule-field-label">Flags</span>
    <input type="text" class="field-value name-rule-flags" placeholder="i" value="${flags}" maxlength="8" title="Regex-Flags (z. B. i = ignorieren Groß/Klein)" spellcheck="false">
      </div>
    </fieldset>
    <fieldset class="rule-group">
      <legend>Ziel-Farbe</legend>
      <div class="rule-field-row">
        <span class="rule-field-label">RAL</span>
    <select class="field-value field-select name-rule-ral" aria-label="RAL">
      <option value="">— RAL —</option>
      ${ralOptions}
    </select>
      </div>
      <div class="rule-field-row">
        <span class="rule-field-label">Oberfläche</span>
    <select class="field-value field-select name-rule-finish" aria-label="Oberfläche" title="Oberfläche für diese Regel. Automatisch = RAL 9007 → Verzinkt, sonst Pulver.">
      <option value="auto" ${finish === 'auto' ? 'selected' : ''}>Automatisch</option>
      <option value="verzinkt" ${finish === 'verzinkt' ? 'selected' : ''}>Verzinkt</option>
      <option value="pulver" ${finish === 'pulver' ? 'selected' : ''}>Pulver</option>
    </select>
      </div>
    </fieldset>
  </div>
</article>`
}

function renderNameRuleRowsHtml(rules) {
  if (!Array.isArray(rules) || rules.length === 0) return ''
  return rules.map((r) => renderNameRuleRowHtml(r)).join('')
}

function collectNameRulesFromContainer(containerEl) {
  if (!containerEl) return []
  const out = []
  containerEl.querySelectorAll('.detail-name-rule-row').forEach((row) => {
    const tv = (row.querySelector('.name-rule-target')?.value || 'material').trim()
    const target = ['material', 'node', 'mesh', 'nodePath', 'extras'].includes(tv) ? tv : 'material'
    const pattern = (row.querySelector('.name-rule-pattern')?.value || '').trim()
    const flags = (row.querySelector('.name-rule-flags')?.value || '').trim()
    const ral = (row.querySelector('.name-rule-ral')?.value || '').trim()
    const finishRaw = (row.querySelector('.name-rule-finish')?.value || 'auto').trim().toLowerCase()
    const finish = finishRaw === 'verzinkt' || finishRaw === 'pulver' ? finishRaw : null
    if (!pattern || !ral) return
    try {
      new RegExp(pattern, flags)
    } catch {
      return
    }
    const o = { target, pattern, ral }
    if (flags) o.flags = flags
    if (finish) o.finish = finish
    out.push(o)
  })
  return out
}

function bindDetailNameRules() {
  const rows = document.getElementById('detailNameRulesRows')
  document.getElementById('detailNameRuleAdd')?.addEventListener('click', () => {
    if (!rows) return
    rows.insertAdjacentHTML('beforeend', renderNameRuleRowHtml({}))
    refreshNameRuleSummaries(rows)
  })
  rows?.addEventListener('click', (e) => {
    const btn = e.target.closest('.name-rule-remove')
    if (!btn) return
    btn.closest('.detail-name-rule-row')?.remove()
  })
  document.getElementById('linkOpenGlobalNameRules')?.addEventListener('click', (e) => {
    e.preventDefault()
    openGlobalNameRulesModal()
  })
  attachNameRuleSummaryListeners(rows)
  refreshNameRuleSummaries(rows)
}

function openGlobalNameRulesModal() {
  const modal = document.getElementById('globalNameRulesModal')
  const rows = document.getElementById('globalNameRulesRows')
  if (!modal || !rows) return
  fetch('/mtl-ral-color-mapping.json')
    .then((r) => r.json())
    .then((data) => {
      const list = Array.isArray(data.nameColorRules) ? data.nameColorRules : []
      rows.innerHTML = list.length ? renderNameRuleRowsHtml(list) : ''
      attachNameRuleSummaryListeners(rows)
      refreshNameRuleSummaries(rows)
      modal.classList.add('open')
      modal.setAttribute('aria-hidden', 'false')
    })
    .catch(() => {
      rows.innerHTML = ''
      attachNameRuleSummaryListeners(rows)
      refreshNameRuleSummaries(rows)
      modal.classList.add('open')
      modal.setAttribute('aria-hidden', 'false')
    })
}

function closeGlobalNameRulesModal() {
  const modal = document.getElementById('globalNameRulesModal')
  if (!modal) return
  modal.classList.remove('open')
  modal.setAttribute('aria-hidden', 'true')
}

async function saveGlobalNameRules() {
  const rows = document.getElementById('globalNameRulesRows')
  if (!rows) return
  const nameColorRules = collectNameRulesFromContainer(rows)
  try {
    const res = await fetch('/__api/save-name-color-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nameColorRules }),
    })
    const data = await parseJsonResponse(res)
    if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`)
    toast('Globale Namens-Regeln gespeichert', 'success')
    closeGlobalNameRulesModal()
  } catch (e) {
    toast(`Speichern fehlgeschlagen: ${e.message}`, 'error')
  }
}

function bindGlobalNameRulesModal() {
  document.getElementById('btnGlobalNameRules')?.addEventListener('click', () => openGlobalNameRulesModal())
  document.getElementById('globalNameRulesBackdrop')?.addEventListener('click', closeGlobalNameRulesModal)
  document.getElementById('globalNameRulesClose')?.addEventListener('click', closeGlobalNameRulesModal)
  document.getElementById('globalNameRuleAdd')?.addEventListener('click', () => {
    const rows = document.getElementById('globalNameRulesRows')
    rows?.insertAdjacentHTML('beforeend', renderNameRuleRowHtml({}))
    refreshNameRuleSummaries(rows)
  })
  document.getElementById('globalNameRulesRows')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.name-rule-remove')
    if (!btn) return
    btn.closest('.detail-name-rule-row')?.remove()
  })
  document.getElementById('globalNameRulesSave')?.addEventListener('click', () => saveGlobalNameRules())
}

/* ─── Vertex-Reduktion (analog zu Namens-Regeln) ───────────────────────────── */

/**
 * Defaults für eine neue (leere) Vertex-Reduktions-Regelzeile im UI.
 * - `ratio = 0.5` entspricht dem impliziten Fallback in `effectiveRatioForRule`
 *   (siehe `src/lib/vertexReductionRules.js`).
 * - `error = 0.001` entspricht dem Default der Bake-Pipeline.
 * - `target = 'mesh'` ist der etablierte Default im Render/Validator.
 *
 * Verhindert, dass eine frisch hinzugefügte Zeile beim Speichern verworfen wird,
 * weil weder `ratio` noch `targetVertexCount` explizit gesetzt ist.
 */
const NEW_REDUCTION_RULE_DEFAULTS = Object.freeze({
  target: 'mesh',
  ratio: 0.5,
  error: 0.001,
})

/**
 * Eine Zeile einer Vertex-Reduktions-Regel.
 * Felder: target, pattern, flags, vertexCountMin/Max, ratio, targetVertexCount, error, lockBorder.
 *
 * Wird ein leeres Regelobjekt übergeben (z. B. neue Zeile per „+ Regel"), greifen die
 * Defaults aus `NEW_REDUCTION_RULE_DEFAULTS`. Bestehende Werte werden unverändert angezeigt.
 */
function renderReductionRuleRowHtml(rule = {}) {
  const isNewEmpty = !rule || (typeof rule === 'object' && Object.keys(rule).length === 0)
  const r = isNewEmpty ? NEW_REDUCTION_RULE_DEFAULTS : rule
  const tRaw = String(r.target || 'mesh').trim()
  const target = ['material', 'node', 'mesh', 'nodePath', 'extras'].includes(tRaw) ? tRaw : 'mesh'
  const pattern = esc(r.pattern || '')
  const flags = esc(r.flags || '')
  const vMin = r.vertexCountMin != null && Number.isFinite(r.vertexCountMin) ? String(r.vertexCountMin) : ''
  const vMax = r.vertexCountMax != null && Number.isFinite(r.vertexCountMax) ? String(r.vertexCountMax) : ''
  const ratio = r.ratio != null && Number.isFinite(r.ratio) ? String(r.ratio) : ''
  const targetV = r.targetVertexCount != null && Number.isFinite(r.targetVertexCount) ? String(r.targetVertexCount) : ''
  const errorVal = r.error != null && Number.isFinite(r.error) ? String(r.error) : ''
  const lockBorder = !!r.lockBorder
  return `<article class="detail-reduction-rule-row rule-card rule-card--reduction">
  <header class="rule-card-head">
    <div class="rule-card-summary reduction-rule-card-summary" aria-live="polite"></div>
    <button type="button" class="reduction-rule-remove btn-icon" title="Zeile entfernen">×</button>
  </header>
  <div class="rule-card-grid">
    <fieldset class="rule-group">
      <legend>Match</legend>
      <div class="rule-field-row">
        <span class="rule-field-label">Ziel</span>
        <select class="field-value reduction-rule-target" aria-label="Ziel">
      <option value="material" ${target === 'material' ? 'selected' : ''}>Material</option>
      <option value="node" ${target === 'node' ? 'selected' : ''}>Knoten</option>
      <option value="mesh" ${target === 'mesh' ? 'selected' : ''}>Mesh</option>
      <option value="nodePath" ${target === 'nodePath' ? 'selected' : ''}>Hierarchiepfad</option>
      <option value="extras" ${target === 'extras' ? 'selected' : ''}>Extras (JSON)</option>
    </select>
      </div>
      <div class="rule-field-row">
        <span class="rule-field-label">Regex</span>
    <input type="text" class="field-value reduction-rule-pattern" placeholder="optional — leer = nur Vertex-Filter" value="${pattern}" title="JavaScript Regular Expression — leer lassen, um nur per Vertex-Filter zu matchen" spellcheck="false" autocomplete="off">
      </div>
      <div class="rule-field-row">
        <span class="rule-field-label">Flags</span>
    <input type="text" class="field-value reduction-rule-flags" placeholder="i" value="${flags}" maxlength="8" title="Regex-Flags" spellcheck="false">
      </div>
    </fieldset>
    <fieldset class="rule-group">
      <legend>Vertex-Filter</legend>
      <p class="rule-group-hint">Leer = kein Limit. Nur Primitive in diesem V-Bereich werden reduziert.</p>
      <div class="rule-field-vminmax">
        <div class="rule-field-row">
          <span class="rule-field-label">V min</span>
    <input type="number" class="field-value reduction-rule-vmin" placeholder="leer = unbegrenzt" value="${vMin}" min="0" step="1" title="Untere Vertex-Schranke (inklusiv). Leer lassen heißt: kein Mindestwert. Beispiel: 50000, um nur große Primitive zu treffen." inputmode="numeric">
        </div>
        <div class="rule-field-row">
          <span class="rule-field-label">V max</span>
    <input type="number" class="field-value reduction-rule-vmax" placeholder="leer = unbegrenzt" value="${vMax}" min="0" step="1" title="Obere Vertex-Schranke (inklusiv). Leer lassen heißt: kein Höchstwert. Achtung: hochauflösende Schrauben/Bauteile können mehrere Hunderttausend Vertices haben — V max nicht zu niedrig wählen, sonst greift die Regel nicht." inputmode="numeric">
        </div>
      </div>
    </fieldset>
    <fieldset class="rule-group">
      <legend>Reduktion</legend>
      <div class="rule-field-row">
        <span class="rule-field-label">Ratio (0–1)</span>
    <input type="number" class="field-value reduction-rule-ratio" placeholder="0.10" value="${ratio}" min="0" max="1" step="0.01" title="Anteil zu erhaltender Vertices (0…1). Leer = aus Ziel-V berechnen, sonst 0.5" inputmode="decimal">
      </div>
      <div class="rule-field-row">
        <span class="rule-field-label">Ziel-V</span>
    <input type="number" class="field-value reduction-rule-target-v" placeholder="2000" value="${targetV}" min="0" step="1" title="Absoluter Ziel-Vertexwert. Hat Vorrang vor Ratio." inputmode="numeric">
      </div>
    </fieldset>
    <fieldset class="rule-group">
      <legend>Qualität</legend>
      <div class="rule-field-row">
        <span class="rule-field-label">Fehler (ε)</span>
    <input type="number" class="field-value reduction-rule-error" placeholder="0.001" value="${errorVal}" min="0" max="1" step="0.0001" title="Max. relativer Fehler (0…1). Default 0.001 ≈ 0.1 % Modell-Radius." inputmode="decimal">
      </div>
      <label class="rule-field-label rule-field-label--toggle" title="Offene Kanten/Ränder beim Vereinfachen festhalten">
        <span>Rand fixieren</span>
      <input type="checkbox" class="reduction-rule-lock-border toggle-glass-input" ${lockBorder ? 'checked' : ''}>
    </label>
    </fieldset>
  </div>
</article>`
}

function renderReductionRuleRowsHtml(rules) {
  if (!Array.isArray(rules) || rules.length === 0) return ''
  return rules.map((r) => renderReductionRuleRowHtml(r)).join('')
}

function collectReductionRulesFromContainer(containerEl) {
  if (!containerEl) return []
  const out = []
  containerEl.querySelectorAll('.detail-reduction-rule-row').forEach((row) => {
    const tv = (row.querySelector('.reduction-rule-target')?.value || 'mesh').trim()
    const target = ['material', 'node', 'mesh', 'nodePath', 'extras'].includes(tv) ? tv : 'mesh'
    const pattern = (row.querySelector('.reduction-rule-pattern')?.value || '').trim()
    const flags = (row.querySelector('.reduction-rule-flags')?.value || '').trim()
    if (pattern) {
      try {
        new RegExp(pattern, flags)
      } catch {
        return
      }
    }
    const vMinRaw = (row.querySelector('.reduction-rule-vmin')?.value || '').trim()
    const vMaxRaw = (row.querySelector('.reduction-rule-vmax')?.value || '').trim()
    const ratioRaw = (row.querySelector('.reduction-rule-ratio')?.value || '').trim().replace(',', '.')
    const targetVRaw = (row.querySelector('.reduction-rule-target-v')?.value || '').trim().replace(/\s/g, '').replace(',', '.')
    const errorRaw = (row.querySelector('.reduction-rule-error')?.value || '').trim().replace(',', '.')
    const lockBorder = !!row.querySelector('.reduction-rule-lock-border')?.checked

    const ratio = ratioRaw === '' ? null : Number(ratioRaw)
    const targetVertexCount = targetVRaw === '' ? null : Number(targetVRaw)
    const ratioMissing = ratio == null || !Number.isFinite(ratio)
    const targetVMissing = targetVertexCount == null || !Number.isFinite(targetVertexCount) || targetVertexCount <= 0
    // Statt die Zeile stillschweigend zu verwerfen, wenn weder ratio noch targetVertexCount
    // gesetzt ist, fällt ratio auf 0.5 zurück (entspricht dem impliziten Fallback in
    // `effectiveRatioForRule`). So gehen Eingaben des Nutzers nie verloren.
    const effectiveRatio = ratioMissing && targetVMissing ? 0.5 : (ratioMissing ? null : ratio)
    const o = { target }
    if (pattern) o.pattern = pattern
    if (flags) o.flags = flags
    if (vMinRaw !== '' && Number.isFinite(Number(vMinRaw))) o.vertexCountMin = Math.max(0, Math.floor(Number(vMinRaw)))
    if (vMaxRaw !== '' && Number.isFinite(Number(vMaxRaw))) o.vertexCountMax = Math.max(0, Math.floor(Number(vMaxRaw)))
    if (effectiveRatio != null && Number.isFinite(effectiveRatio)) {
      o.ratio = Math.max(0, Math.min(1, effectiveRatio))
    }
    if (!targetVMissing) {
      o.targetVertexCount = Math.max(3, Math.floor(targetVertexCount))
    }
    if (errorRaw !== '' && Number.isFinite(Number(errorRaw))) o.error = Math.max(0, Math.min(1, Number(errorRaw)))
    if (lockBorder) o.lockBorder = true
    out.push(o)
  })
  return out
}

function bindDetailReductionRules() {
  const rows = document.getElementById('detailReductionRulesRows')
  document.getElementById('detailReductionRuleAdd')?.addEventListener('click', () => {
    if (!rows) return
    rows.insertAdjacentHTML('beforeend', renderReductionRuleRowHtml(NEW_REDUCTION_RULE_DEFAULTS))
    refreshReductionRuleSummaries(rows)
  })
  rows?.addEventListener('click', (e) => {
    const btn = e.target.closest('.reduction-rule-remove')
    if (!btn) return
    btn.closest('.detail-reduction-rule-row')?.remove()
  })
  document.getElementById('linkOpenGlobalReductionRules')?.addEventListener('click', (e) => {
    e.preventDefault()
    openGlobalReductionRulesModal()
  })
  attachReductionRuleSummaryListeners(rows)
  refreshReductionRuleSummaries(rows)
}

function openGlobalReductionRulesModal() {
  const modal = document.getElementById('globalReductionRulesModal')
  const rows = document.getElementById('globalReductionRulesRows')
  if (!modal || !rows) return
  fetch('/mtl-ral-color-mapping.json')
    .then((r) => r.json())
    .then((data) => {
      const list = Array.isArray(data.vertexReductionRules) ? data.vertexReductionRules : []
      rows.innerHTML = list.length ? renderReductionRuleRowsHtml(list) : ''
      attachReductionRuleSummaryListeners(rows)
      refreshReductionRuleSummaries(rows)
      modal.classList.add('open')
      modal.setAttribute('aria-hidden', 'false')
    })
    .catch(() => {
      rows.innerHTML = ''
      attachReductionRuleSummaryListeners(rows)
      refreshReductionRuleSummaries(rows)
      modal.classList.add('open')
      modal.setAttribute('aria-hidden', 'false')
    })
}

function closeGlobalReductionRulesModal() {
  const modal = document.getElementById('globalReductionRulesModal')
  if (!modal) return
  modal.classList.remove('open')
  modal.setAttribute('aria-hidden', 'true')
}

async function saveGlobalReductionRules() {
  const rows = document.getElementById('globalReductionRulesRows')
  if (!rows) return
  const vertexReductionRules = collectReductionRulesFromContainer(rows)
  try {
    const res = await fetch('/__api/save-vertex-reduction-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertexReductionRules }),
    })
    const data = await parseJsonResponse(res)
    if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`)
    toast('Globale Vertex-Reduktion gespeichert', 'success')
    closeGlobalReductionRulesModal()
  } catch (e) {
    toast(`Speichern fehlgeschlagen: ${e.message}`, 'error')
  }
}

function bindGlobalReductionRulesModal() {
  document.getElementById('btnGlobalReductionRules')?.addEventListener('click', () => openGlobalReductionRulesModal())
  document.getElementById('globalReductionRulesBackdrop')?.addEventListener('click', closeGlobalReductionRulesModal)
  document.getElementById('globalReductionRulesClose')?.addEventListener('click', closeGlobalReductionRulesModal)
  document.getElementById('globalReductionRuleAdd')?.addEventListener('click', () => {
    const rows = document.getElementById('globalReductionRulesRows')
    rows?.insertAdjacentHTML('beforeend', renderReductionRuleRowHtml(NEW_REDUCTION_RULE_DEFAULTS))
    refreshReductionRuleSummaries(rows)
  })
  document.getElementById('globalReductionRulesRows')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.reduction-rule-remove')
    if (!btn) return
    btn.closest('.detail-reduction-rule-row')?.remove()
  })
  document.getElementById('globalReductionRulesSave')?.addEventListener('click', () => saveGlobalReductionRules())
}

/* ─── Sichtbarkeit beim Export (Pro Produkt) ───────────────────────────────
 *
 * Analog zu Vertex-Reduktion, aber:
 *   - Nur Name/Regex-Match (kein Geometrie-Filter)
 *   - Nur pro Produkt (kein globales Modal)
 *   - Aktion `hide` entfernt Treffer beim Baken, `keep` neutralisiert eine
 *     vorherige `hide`-Regel — Reihenfolge entscheidet (last-wins).
 */

const NEW_VISIBILITY_RULE_DEFAULTS = Object.freeze({
  action: 'hide',
  target: 'mesh',
})

/**
 * Eine Zeile einer Sichtbarkeits-Regel.
 * Felder: action (hide|keep), target, pattern, flags.
 */
function renderVisibilityRuleRowHtml(rule = {}) {
  const isNewEmpty = !rule || (typeof rule === 'object' && Object.keys(rule).length === 0)
  const r = isNewEmpty ? NEW_VISIBILITY_RULE_DEFAULTS : rule
  const aRaw = String(r.action || 'hide').trim().toLowerCase()
  const action = aRaw === 'keep' ? 'keep' : 'hide'
  const tRaw = String(r.target || 'mesh').trim()
  const target = ['material', 'node', 'mesh', 'nodePath', 'extras'].includes(tRaw) ? tRaw : 'mesh'
  const pattern = esc(r.pattern || '')
  const flags = esc(r.flags || '')
  return `<article class="detail-visibility-rule-row rule-card rule-card--visibility">
  <header class="rule-card-head">
    <div class="rule-card-summary visibility-rule-card-summary" aria-live="polite"></div>
    <button type="button" class="visibility-rule-remove btn-icon" title="Zeile entfernen">×</button>
  </header>
  <div class="rule-card-grid">
    <fieldset class="rule-group">
      <legend>Aktion</legend>
      <div class="rule-field-row">
        <span class="rule-field-label">Aktion</span>
        <select class="field-value visibility-rule-action" aria-label="Aktion" title="Ausblenden = Treffer werden beim Baken aus dem GLB entfernt. Behalten = neutralisiert eine vorhergehende Ausblenden-Regel (last-wins, Reihenfolge zählt).">
          <option value="hide" ${action === 'hide' ? 'selected' : ''}>Ausblenden (entfernen)</option>
          <option value="keep" ${action === 'keep' ? 'selected' : ''}>Behalten (schützt vor Ausblenden)</option>
        </select>
      </div>
    </fieldset>
    <fieldset class="rule-group">
      <legend>Match</legend>
      <div class="rule-field-row">
        <span class="rule-field-label">Ziel</span>
        <select class="field-value visibility-rule-target" aria-label="Ziel">
          <option value="material" ${target === 'material' ? 'selected' : ''}>Material (MTL)</option>
          <option value="node" ${target === 'node' ? 'selected' : ''}>Knoten (Szene)</option>
          <option value="mesh" ${target === 'mesh' ? 'selected' : ''}>Mesh (Geometrie)</option>
          <option value="nodePath" ${target === 'nodePath' ? 'selected' : ''}>Hierarchiepfad</option>
          <option value="extras" ${target === 'extras' ? 'selected' : ''}>Extras (JSON)</option>
        </select>
      </div>
      <div class="rule-field-row">
        <span class="rule-field-label">Regex</span>
        <input type="text" class="field-value visibility-rule-pattern" placeholder="z. B. ^Schraube_ oder Diagonalstrebe" value="${pattern}" title="JavaScript Regular Expression — Pflicht, sonst greift die Regel nicht." spellcheck="false" autocomplete="off">
      </div>
      <div class="rule-field-row">
        <span class="rule-field-label">Flags</span>
        <input type="text" class="field-value visibility-rule-flags" placeholder="i" value="${flags}" maxlength="8" title="Regex-Flags (z. B. i = Groß/Klein ignorieren)" spellcheck="false">
      </div>
    </fieldset>
  </div>
</article>`
}

function renderVisibilityRuleRowsHtml(rules) {
  if (!Array.isArray(rules) || rules.length === 0) return ''
  return rules.map((r) => renderVisibilityRuleRowHtml(r)).join('')
}

function collectVisibilityRulesFromContainer(containerEl) {
  if (!containerEl) return []
  const out = []
  containerEl.querySelectorAll('.detail-visibility-rule-row').forEach((row) => {
    const aRaw = (row.querySelector('.visibility-rule-action')?.value || 'hide').trim().toLowerCase()
    const action = aRaw === 'keep' ? 'keep' : 'hide'
    const tv = (row.querySelector('.visibility-rule-target')?.value || 'mesh').trim()
    const target = ['material', 'node', 'mesh', 'nodePath', 'extras'].includes(tv) ? tv : 'mesh'
    const pattern = (row.querySelector('.visibility-rule-pattern')?.value || '').trim()
    const flags = (row.querySelector('.visibility-rule-flags')?.value || '').trim()
    if (!pattern) return
    try {
      new RegExp(pattern, flags)
    } catch {
      return
    }
    const o = { action, target, pattern }
    if (flags) o.flags = flags
    out.push(o)
  })
  return out
}

function bindDetailVisibilityRules() {
  const rows = document.getElementById('detailVisibilityRulesRows')
  document.getElementById('detailVisibilityRuleAdd')?.addEventListener('click', () => {
    if (!rows) return
    rows.insertAdjacentHTML('beforeend', renderVisibilityRuleRowHtml(NEW_VISIBILITY_RULE_DEFAULTS))
    refreshVisibilityRuleSummaries(rows)
  })
  rows?.addEventListener('click', (e) => {
    const btn = e.target.closest('.visibility-rule-remove')
    if (!btn) return
    btn.closest('.detail-visibility-rule-row')?.remove()
  })
  attachVisibilityRuleSummaryListeners(rows)
  refreshVisibilityRuleSummaries(rows)
}

/* ═══════════════════════════════════════════════
   Detail panel
   ═══════════════════════════════════════════════ */
let detailRenderer = null, detailPreviewScene = null, detailControls = null, detailAnimId = null, detailResizeObs = null
/** Detail-GLB: Kamera/Root für Einzelteil-Isolation (Meshes) */
let detailPreviewCamera = null
let detailPreviewModelRoot = null
let detailMeshIsolateIndex = null
/**
 * Einzelteil-Auswahl (Meshes → GLB): Indizes der Meshes, die NICHT ins GLB
 * exportiert werden sollen. Wird beim Speichern in Sichtbarkeits-Regeln mit
 * `source: 'meshSelect'` übersetzt (analog zu manuell getippten Regex-Regeln,
 * nur schneller per Checkbox).
 */
let detailMeshExcluded = new Set()
/** true, sobald die Mesh-Checkbox-UI aus der geladenen Vorschau gebaut wurde. */
let detailMeshSelectionReady = false

/** Marker, der Checkbox-generierte Sichtbarkeits-Regeln von manuellen trennt. */
const MESH_SELECT_RULE_SOURCE = 'meshSelect'

/** Escaped einen String für die Verwendung als exakter Regex-Literal. */
function escapeRegExpLiteral(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Exaktes `^Name$`-Pattern für eine Mesh-Auswahl-Regel. */
function meshSelectPattern(name) {
  return '^' + escapeRegExpLiteral(name) + '$'
}

/**
 * Trennt gespeicherte Sichtbarkeits-Regeln in manuell getippte (Regex-Editor)
 * und Checkbox-generierte (`source: 'meshSelect'`).
 */
function splitVisibilityRules(rules) {
  const manual = []
  const meshSelect = []
  ;(Array.isArray(rules) ? rules : []).forEach((r) => {
    if (r && typeof r === 'object' && r.source === MESH_SELECT_RULE_SOURCE) meshSelect.push(r)
    else if (r) manual.push(r)
  })
  return { manual, meshSelect }
}

/**
 * Baut die Sichtbarkeits-Regeln aus der aktuellen Mesh-Checkbox-Auswahl.
 * Ist die Vorschau nicht geladen, bleiben die zuvor gespeicherten
 * meshSelect-Regeln unverändert erhalten (nicht verwerfen!).
 */
function collectMeshSelectVisibilityRules() {
  const prod = productCache.get(selectedProductId)
  const existing = splitVisibilityRules(prod?.conversionPreset?.visibilityRules).meshSelect
  if (!detailMeshSelectionReady || !detailPreviewModelRoot) return existing
  const meshes = collectMeshesFromGroup(detailPreviewModelRoot)
  const seen = new Set()
  const out = []
  meshes.forEach((m, i) => {
    if (!detailMeshExcluded.has(i)) return
    const name = (m.name || '').trim()
    if (!name || seen.has(name)) return
    seen.add(name)
    out.push({
      action: 'hide',
      target: 'mesh',
      pattern: meshSelectPattern(name),
      source: MESH_SELECT_RULE_SOURCE,
      name,
    })
  })
  return out
}
/**
 * Live-Drehung im Detail (Grad) – zentrale Quelle. Wird auch im Header gespiegelt
 * und beim nächsten Konvertieren als rotateAxis/rotateDegrees in die GLB eingebrannt.
 * Während der Übergangsphase (vor dem Konvertieren) wird sie weiterhin als
 * `rotationOffset` persistiert, damit Showroom/Detail/Maße sie live anwenden.
 */
let detailRotationOffsetDeg = { x: 0, y: 0, z: 0 }
/** Merkt sich die zuletzt vom User über Header oder Detail gewählte Bake-Achse. */
let lastBakeAxis = ''

function normalizeDetailRotationDeg(n) {
  let v = Number(n) || 0
  v = ((v % 360) + 360) % 360
  if (v > 180) v -= 360
  return v
}

function seedDetailRotationFromProduct(p) {
  const ro = p?.rotationOffset
  const hasRotationOffset = ro && (
    Number(ro.x) !== 0 || Number(ro.y) !== 0 || Number(ro.z) !== 0
  )
  if (hasRotationOffset) {
    // Produkt hat einen gespeicherten rotationOffset → übernimm den (Header wird gespiegelt).
    detailRotationOffsetDeg = {
      x: normalizeDetailRotationDeg(ro.x ?? 0),
      y: normalizeDetailRotationDeg(ro.y ?? 0),
      z: normalizeDetailRotationDeg(ro.z ?? 0),
    }
    syncRotationHeaderFromState()
    return
  }
  // Kein rotationOffset im Produkt: wenn der User im Header bereits eine Achse + Winkel
  // ausgewählt hat, übernimm DIESEN Wert in den Detail-State (statt ihn zu überschreiben).
  const axisSel = document.getElementById('dashRotateAxis')
  const degSel = document.getElementById('dashRotateDegrees')
  const axis = (axisSel?.value || '').trim()
  const degrees = (degSel?.value || '').trim()
  if ((axis === 'X' || axis === 'Y' || axis === 'Z') && ['90', '180', '270'].includes(degrees)) {
    setDetailRotationFromHeader(axis, degrees)
  } else {
    detailRotationOffsetDeg = { x: 0, y: 0, z: 0 }
    lastBakeAxis = ''
    syncRotationHeaderFromState()
  }
}

function updateDetailRotationLabels() {
  const map = { x: 'rotValX', y: 'rotValY', z: 'rotValZ' }
  for (const ax of ['x', 'y', 'z']) {
    const el = document.getElementById(map[ax])
    if (el) el.textContent = `${detailRotationOffsetDeg[ax]}°`
  }
}

function applyDetailRotationLive() {
  if (!detailPreviewModelRoot) return
  const toRad = Math.PI / 180
  const r = detailRotationOffsetDeg
  detailPreviewModelRoot.rotation.set(
    (r.x ?? 0) * toRad,
    (r.y ?? 0) * toRad,
    (r.z ?? 0) * toRad,
  )
}

/**
 * Wandelt den 3-Achsen-State in ein Header-konformes (rotateAxis, rotateDegrees)
 * Paar um. Header kennt nur 90/180/270 (positive Winkel), Detail erlaubt ±90/±180/0
 * pro Achse → eine Achse mit Wert ≠ 0 wird auf [0..360) normalisiert und in die
 * passende Stufe gerundet.
 *
 * @returns {{ axis: ''|'X'|'Y'|'Z', degrees: ''|'90'|'180'|'270' }}
 */
function deriveBakeRotationFromState() {
  const r = detailRotationOffsetDeg
  const candidates = [
    { axis: 'X', deg: r.x ?? 0 },
    { axis: 'Y', deg: r.y ?? 0 },
    { axis: 'Z', deg: r.z ?? 0 },
  ].filter((c) => Number(c.deg) !== 0)
  if (!candidates.length) return { axis: '', degrees: '' }
  // Bevorzuge die zuletzt vom User explizit gewählte Achse, sonst die erste.
  const preferred = candidates.find((c) => c.axis === lastBakeAxis) || candidates[0]
  let d = ((Number(preferred.deg) % 360) + 360) % 360
  // Nur diskrete Stufen sind einbrennbar; ausrichten an nächster 90er-Stufe.
  d = Math.round(d / 90) * 90
  if (d === 0 || d === 360) return { axis: '', degrees: '' }
  return { axis: preferred.axis, degrees: String(d) }
}

/** Spiegelt den aktuellen detailRotationOffsetDeg-State in die Header-Dropdowns. */
function syncRotationHeaderFromState() {
  const axisSel = document.getElementById('dashRotateAxis')
  const degSel = document.getElementById('dashRotateDegrees')
  if (!axisSel || !degSel) return
  const { axis, degrees } = deriveBakeRotationFromState()
  axisSel.value = axis
  if (degrees) degSel.value = degrees
  degSel.disabled = !(axis === 'X' || axis === 'Y' || axis === 'Z')
}

/**
 * Setzt detailRotationOffsetDeg auf genau eine Achse + Winkel (alle anderen Achsen = 0).
 * Wird vom Header-Dropdown aufgerufen, damit Header und Detail symmetrisch sind.
 */
function setDetailRotationFromHeader(axis, degrees) {
  detailRotationOffsetDeg = { x: 0, y: 0, z: 0 }
  if ((axis === 'X' || axis === 'Y' || axis === 'Z') && ['90', '180', '270'].includes(String(degrees))) {
    lastBakeAxis = axis
    const ax = axis.toLowerCase()
    detailRotationOffsetDeg[ax] = normalizeDetailRotationDeg(Number(degrees))
  } else {
    lastBakeAxis = ''
  }
  updateDetailRotationLabels()
  applyDetailRotationLive()
}

function bindDetailRotationControls() {
  const sec = detailContent.querySelector('.detail-rotation-section')
  if (!sec) return
  sec.querySelectorAll('.rot-row').forEach((row) => {
    row.querySelectorAll('button[data-rot]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const axis = row.dataset.axis
        if (!axis || !['x', 'y', 'z'].includes(axis)) return
        const act = btn.dataset.rot
        if (act === 'reset') {
          detailRotationOffsetDeg[axis] = 0
        } else if (act === '180') {
          detailRotationOffsetDeg[axis] = normalizeDetailRotationDeg(detailRotationOffsetDeg[axis] + 180)
        } else if (act === '+90') {
          detailRotationOffsetDeg[axis] = normalizeDetailRotationDeg(detailRotationOffsetDeg[axis] + 90)
        } else if (act === '-90') {
          detailRotationOffsetDeg[axis] = normalizeDetailRotationDeg(detailRotationOffsetDeg[axis] - 90)
        }
        // Achse merken, damit der Header bei Mehrfach-Drehung die richtige zeigt.
        if (detailRotationOffsetDeg[axis] !== 0) lastBakeAxis = axis.toUpperCase()
        updateDetailRotationLabels()
        applyDetailRotationLive()
        syncRotationHeaderFromState()
      })
    })
  })
  document.getElementById('rotResetAll')?.addEventListener('click', () => {
    detailRotationOffsetDeg = { x: 0, y: 0, z: 0 }
    lastBakeAxis = ''
    updateDetailRotationLabels()
    applyDetailRotationLive()
    syncRotationHeaderFromState()
  })
}

async function openDetail(id) {
  disposeDetailPartPreviews()
  // Gleiche Karte: Grid-WebGL freigeben, sonst Detail + Karte = zwei Kontexte pro Produkt (GPU-Limit).
  if (previewRenderers.has(id)) disposeCardPreviewById(id)
  let p = await fetchProductById(id)
  if (!p) return
  if (p.type === 'composed' && p.parts?.length) {
    await Promise.all(p.parts.map((pt) => fetchProductById(pt.productId)))
  }
  selectedProductId = id
  productGrid.querySelectorAll('.product-card').forEach(c => c.classList.toggle('selected', c.dataset.id === id))

  detailTitle.textContent = p.name
  updateDetailNavState()
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
  seedDetailRotationFromProduct(p)

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
    ${!isComposed && p.glbFile ? `
    <div class="detail-preview-toolbar">
      <button type="button" class="btn btn-ghost btn-sm" id="btnRegenerateThumbnail" title="PNG für die Karten-Vorschau aus der aktuellen 3D-Ansicht neu speichern">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;vertical-align:middle;margin-right:.25rem"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        Vorschaubild neu erzeugen
      </button>
    </div>
    <div class="detail-section detail-mesh-parts" id="detailMeshPartsSection" hidden>
      <div class="detail-section-title">Einzelteile (Meshes)</div>
      <p class="cc-muted" style="font-size:.72rem;margin:0 0 .5rem;line-height:1.4">
        <strong>Häkchen</strong> = Teil kommt beim nächsten <strong>Neu konvertieren</strong> ins GLB. Häkchen entfernen = Teil wird aus dem Export entfernt
        (schneller Weg für die <em>Sichtbarkeit beim Export</em> unten – erzeugt beim Speichern automatisch die passenden Regeln).<br>
        Zeile anklicken: nur dieses Teil anzeigen · Kamera-Symbol: Ansicht · erneut: alle Teile.
      </p>
      <div class="detail-mesh-toolbar">
        <span class="detail-mesh-sel-count" id="detailMeshSelCount"></span>
        <span class="detail-mesh-toolbar-spacer"></span>
        <button type="button" class="btn btn-ghost btn-sm" id="detailMeshSelectAll">Alle</button>
        <button type="button" class="btn btn-ghost btn-sm" id="detailMeshSelectNone">Keine</button>
      </div>
      <div id="detailMeshPartsList" class="detail-mesh-parts-list"></div>
      <button type="button" class="detail-mesh-clear-btn" id="detailMeshClearBtn" hidden>Alle Teile anzeigen</button>
    </div>
    ` : ''}
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
      ${renderMainCategoryFieldRowHtml(p)}
      <div class="field-row"><label class="field-label">Typ</label><input class="field-value" value="${isComposed ? 'Zusammengebaut' : 'Einzelteil'}" readonly></div>
      ${!isComposed && p.glbFile ? `
      <div class="field-row">
        <label class="field-label">Orientierung</label>
        <select class="field-value" data-field="orientation">
          <option value="y-up" ${(p.orientation || 'y-up') === 'y-up' ? 'selected' : ''}>Y-up</option>
          <option value="y-up-root" ${p.orientation === 'y-up-root' ? 'selected' : ''}>Y-up + Root-Anpassung</option>
          <option value="z-up" ${p.orientation === 'z-up' ? 'selected' : ''}>Z-up</option>
        </select>
      </div>
      <div class="detail-rotation-section">
        <div class="detail-section-title" style="margin-top:.6rem">Drehung (wird beim nächsten Konvertieren eingebrannt)</div>
        <p class="cc-muted" style="font-size:.72rem;margin:0 0 .5rem">
          Korrektur der Ausrichtung pro Achse (Grad). Live-Vorschau ist sofort sichtbar.
          Bei der nächsten Konvertierung wird die Drehung in die GLB übernommen und der temporäre Offset zurückgesetzt –
          synchron mit der Achsen-Auswahl im Header.
        </p>
        <div class="rot-row" data-axis="x">
          <span class="rot-axis-label">X</span>
          <span class="rot-value" id="rotValX">${detailRotationOffsetDeg.x}°</span>
          <button type="button" class="btn btn-ghost btn-sm" data-rot="-90">-90°</button>
          <button type="button" class="btn btn-ghost btn-sm" data-rot="+90">+90°</button>
          <button type="button" class="btn btn-ghost btn-sm" data-rot="180">180°</button>
          <button type="button" class="btn btn-ghost btn-sm" data-rot="reset">Reset</button>
        </div>
        <div class="rot-row" data-axis="y">
          <span class="rot-axis-label">Y</span>
          <span class="rot-value" id="rotValY">${detailRotationOffsetDeg.y}°</span>
          <button type="button" class="btn btn-ghost btn-sm" data-rot="-90">-90°</button>
          <button type="button" class="btn btn-ghost btn-sm" data-rot="+90">+90°</button>
          <button type="button" class="btn btn-ghost btn-sm" data-rot="180">180°</button>
          <button type="button" class="btn btn-ghost btn-sm" data-rot="reset">Reset</button>
        </div>
        <div class="rot-row" data-axis="z">
          <span class="rot-axis-label">Z</span>
          <span class="rot-value" id="rotValZ">${detailRotationOffsetDeg.z}°</span>
          <button type="button" class="btn btn-ghost btn-sm" data-rot="-90">-90°</button>
          <button type="button" class="btn btn-ghost btn-sm" data-rot="+90">+90°</button>
          <button type="button" class="btn btn-ghost btn-sm" data-rot="180">180°</button>
          <button type="button" class="btn btn-ghost btn-sm" data-rot="reset">Reset</button>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="rotResetAll">Alle Achsen zurücksetzen</button>
      </div>` : ''}
      ${!isComposed ? `
      <div class="field-row"><label class="field-label">GLB-Datei</label><input class="field-value" data-field="glbFile" value="${esc(p.glbFile || '')}"></div>
      <div class="field-row"><label class="field-label">USDZ-Datei</label><input class="field-value" data-field="usdzFile" value="${esc(p.usdzFile || '')}"></div>
      ` : ''}
      <div class="field-row"><label class="field-label">Erstellt</label><input class="field-value" value="${p.createdAt ? new Date(p.createdAt).toLocaleString('de-DE') : '–'}" readonly></div>
      <div class="field-row field-row-default-color">
        <label class="field-label">Standard-Farbe</label>
        <div class="field-default-color-inputs">
          <select class="field-value field-select" data-field="defaultColor">
            <option value="">— Keine (GLB-Materialien)</option>
            <option value="${esc(DEFAULT_COLOR_FROM_MAPPING)}" ${(p.defaultColor || '') === DEFAULT_COLOR_FROM_MAPPING ? 'selected' : ''}>Automatisch (MTL-Mapping)</option>
            ${ColorService.getAllColors().map((c) => `<option value="${esc(c.code)}" ${(p.defaultColor || '') === c.code ? 'selected' : ''}>${esc(c.code)} ${esc(c.name)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field-row">
        <label class="field-label">Oberfläche</label>
        <select class="field-value field-select" data-field="surfaceFinish" title="Metallisch/Rauheit: Automatisch = RAL 9007 verzinkt, sonst Pulver. Sonst erzwingen.">
          <option value="auto" ${(!p.surfaceFinish || p.surfaceFinish === 'auto') ? 'selected' : ''}>Automatisch (RAL 9007 = Verzinkt)</option>
          <option value="verzinkt" ${p.surfaceFinish === 'verzinkt' ? 'selected' : ''}>Verzinkt</option>
          <option value="pulver" ${p.surfaceFinish === 'pulver' ? 'selected' : ''}>Pulverbeschichtet</option>
        </select>
      </div>
      <div class="field-row"><label class="field-label">Shopware-ID</label><input class="field-value" data-field="shopwareProductId" value="${esc(p.shopwareProductId || '')}"></div>
      <div class="field-row"><label class="field-label">GTIN</label><input class="field-value" data-field="gtin" value="${esc(p.gtin || '')}" placeholder="8–14 Ziffern" inputmode="numeric"></div>
      <div class="field-row"><label class="field-label">Artikelnummer</label><input class="field-value" data-field="articleNumber" value="${esc(p.articleNumber || '')}" placeholder="Stammdaten / Benennung"></div>
      <div class="field-row">
        <label class="field-label">Stammdaten</label>
        <div>
          <button type="button" class="btn btn-ghost btn-sm" id="btnGtinApplyDefaultColor">Standard-Farbe aus GTIN-Liste</button>
          <p class="cc-muted" style="font-size:.72rem;margin:.35rem 0 0">RAL bzw. Verzinkt aus der Konverter-Stammdaten-API.</p>
        </div>
      </div>
      ${p.colorableMeshes?.length ? `
      <div class="field-row"><label class="field-label">Färbbar</label><input class="field-value" data-field="colorableMeshes" value="${esc(p.colorableMeshes.join(', '))}"></div>` : ''}
    </div>

    <div class="detail-section">
      <div class="detail-section-title">Namens-Farbregeln (dieses Produkt)</div>
      <p class="cc-muted" style="font-size:.72rem;margin:0 0 .5rem;line-height:1.4">
        Beim Baken per <strong>Regex</strong> auf Ziel-RAL: nicht nur Material/Knoten, sondern auch <strong>glTF-Mesh-Name</strong>,
        <strong>Hierarchiepfad</strong> (Eltern/…/Kind, hilft bei generischen <code>shape-…</code>-Knoten) und <strong>Extras</strong> (JSON aus Node/Mesh/Primitive, z. B. CAD-Metadaten).
        <strong>Showroom und Dashboard-Vorschau</strong> wenden nur Regeln mit Ziel <strong>„Material (MTL)“</strong> an (Regex auf den <strong>glTF-Materialnamen</strong>), zusammen mit den globalen Einträgen aus <code>mtl-ral-color-mapping.json</code>.
        Ziele <strong>Knoten</strong>, <strong>Mesh</strong>, <strong>Hierarchiepfad</strong> und <strong>Extras</strong> gelten nur beim <strong>Neu konvertieren</strong> / Baken.
        Bei <strong>STEP</strong> sind Materialnamen oft generisch — prüfen Sie die Liste <strong>„Teile (Meshes)“</strong> unten; Begriffe wie <code>link</code> in der Hierarchie erfordern Ziel <strong>Mesh</strong> oder <strong>Hierarchiepfad</strong> plus erneute Konvertierung.
        <button type="button" class="btn-link-inline" id="linkOpenGlobalNameRules">Globale Regeln bearbeiten …</button>
      </p>
      <div id="detailNameRulesRows" class="detail-name-rules-rows">${renderNameRuleRowsHtml(p.conversionPreset?.nameColorRules)}</div>
      <button type="button" class="btn btn-ghost btn-sm" id="detailNameRuleAdd">+ Regel hinzufügen</button>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">Vertex-Reduktion (dieses Produkt)</div>
      <p class="cc-muted" style="font-size:.72rem;margin:0 0 .5rem;line-height:1.4">
        Reduziert hochauflösende Primitives beim <strong>Baken</strong> per <code>weld + simplify</code> (Meshoptimizer).
        Match per <strong>Regex</strong> auf Material/Knoten/Mesh/Hierarchiepfad/Extras <strong>und/oder</strong> Geometrie-Filter
        (z. B. <em>Vertices ≥ 100&nbsp;000</em> für Schrauben). <strong>Ratio</strong> = Anteil zu erhaltender Vertices,
        alternativ <strong>Ziel-V</strong>. <strong>Letzte passende Regel</strong> gewinnt (Produkt überschreibt Global).
        Die Reduktion wirkt nur beim <strong>Neu konvertieren</strong>.<br>
        <strong>V min / V max</strong> sind <strong>optionale</strong> Schranken: leer lassen = kein Limit.
        Bauteile mit deutlich mehr Vertices als <em>V max</em> werden <strong>nicht</strong> reduziert
        (typischer Fehler: <em>V max</em> zu niedrig, z. B. 25 000 — Schrauben können 500 000+ Vertices haben).
        Konvertierungs-Log zeigt pro Regel die Trefferquote und sample-mäßig die Gründe für Nicht-Treffer.
        <button type="button" class="btn-link-inline" id="linkOpenGlobalReductionRules">Globale Reduktions-Regeln bearbeiten …</button>
      </p>
      <div id="detailReductionRulesRows" class="detail-reduction-rules-rows">${renderReductionRuleRowsHtml(p.conversionPreset?.vertexReductionRules)}</div>
      <button type="button" class="btn btn-ghost btn-sm" id="detailReductionRuleAdd">+ Regel hinzufügen</button>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">Sichtbarkeit beim Export (dieses Produkt)</div>
      <p class="cc-muted" style="font-size:.72rem;margin:0 0 .5rem;line-height:1.4">
        Blendet Teile beim <strong>Baken</strong> aus dem GLB aus (per Regex auf Material/Knoten/Mesh/Hierarchiepfad/Extras).
        <strong>Ausblenden</strong> entfernt die Treffer dauerhaft aus der exportierten Datei — gut, um Schrauben,
        Hilfsgeometrie oder unsichtbare Innenteile rauszuschmeißen. <strong>Behalten</strong> macht das Gegenteil und
        schützt eine Auswahl gegen eine vorhergehende Ausblenden-Regel (z. B. <em>„alles ausblenden außer Rahmen"</em>:
        zuerst eine Hide-Regel mit Pattern <code>.*</code>, danach eine Keep-Regel mit dem Rahmen-Pattern).
        <strong>Letzte passende Regel</strong> gewinnt. Die Regel wirkt nur beim <strong>Neu konvertieren</strong>.
        <br>
        <strong>Unabhängig</strong> von <em>Namens-Farbregeln</em> und <em>Vertex-Reduktion</em>: alle drei Systeme
        sind isoliert. Namens-Farbregeln werden auf das gelaufen, was nach dem Ausblenden/Reduzieren noch übrig ist —
        und werden auch dann angewandt, wenn Sichtbarkeit oder Reduktion (z. B. wegen Konfigurationsfehler) übersprungen werden.
        <br>
        <strong>Tipp:</strong> Zum reinen Ein-/Ausschließen einzelner Teile ist die Liste <strong>„Einzelteile (Meshes)"</strong> oben schneller –
        deren Häkchen erzeugen beim Speichern automatisch die passenden Regeln. Hier bleiben nur die von Hand getippten Regex-Regeln.
      </p>
      <div id="detailVisibilityRulesRows" class="detail-visibility-rules-rows">${renderVisibilityRuleRowsHtml(splitVisibilityRules(p.conversionPreset?.visibilityRules).manual)}</div>
      <button type="button" class="btn btn-ghost btn-sm" id="detailVisibilityRuleAdd">+ Regel hinzufügen</button>
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
        OBJ · MTL · STEP/STP/STPZ/P21 · FBX · STL · DAE · IGES · 3DS · PNG · JPG
      </div>
    </div>

    ${!isComposed ? `
    <div class="detail-section detail-color-compare-section">
      <div class="detail-section-title">Farben: CAD ↔ GLB</div>
      <p class="cc-intro">Gegenüberstellung der MTL-Diffusfarben (<code>Kd</code>), der erwarteten Zielfarbe nach globalem Mapping und <code>conversionPreset</code>, der Materialien in der exportierten GLB (inkl. Metall/Rauheit) sowie der Dashboard-Vorschau.</p>
      <div id="detailColorCompareMount"><p class="color-compare-status">Analyse wird gestartet …</p></div>
    </div>` : ''}

    ${!isComposed ? `
    <div class="detail-section">
      <div class="detail-section-title detail-section-title-row">
        <span>Spezifikationen</span>
        ${p.glbFile ? `<button type="button" class="btn btn-ghost btn-sm" id="btnMeasureDimensions" title="Breite/Höhe/Tiefe aus GLB neu berechnen">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;vertical-align:-2px;margin-right:.25rem"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
          Maße neu berechnen
        </button>` : ''}
      </div>
      ${p.glbFile ? `<p class="cc-muted" style="font-size:.72rem;margin:0 0 .6rem;line-height:1.4">Maße aus der GLB-Bounding-Box (inkl. <code>rotationOffset</code>). Nach jeder Konvertierung automatisch aktualisiert; manuell per Klick oder beim ersten Öffnen, wenn noch leer.</p>` : ''}
      <div class="field-row"><label class="field-label">Traglast</label><input class="field-value" data-field="specs.load" value="${esc(p.specs?.load || '')}"></div>
      <div class="field-row"><label class="field-label">Höhe</label><input class="field-value" data-field="specs.height" value="${esc(p.specs?.height || '')}" placeholder="z. B. 1800 mm"></div>
      <div class="field-row"><label class="field-label">Breite</label><input class="field-value" data-field="specs.width" value="${esc(p.specs?.width || '')}" placeholder="z. B. 1000 mm"></div>
      <div class="field-row"><label class="field-label">Tiefe</label><input class="field-value" data-field="specs.depth" value="${esc(p.specs?.depth || '')}" placeholder="z. B. 500 mm"></div>
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
          const glb = pp?.glbFile || ''
          const previewBlock = glb
            ? `<div class="part-shape-preview card-preview" data-glb="${esc(glb)}" aria-hidden="true">
                <div class="card-preview-placeholder">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
                  <span>lädt …</span>
                </div>
              </div>`
            : `<div class="part-no-glb" title="Kein GLB beim Kind-Produkt">—</div>`
          return `<div class="part-item">
            ${previewBlock}
            <div class="part-item-text">
              <span class="part-count">${pt.count}×</span>
              <span class="part-name">${esc(pp?.name || pt.productId)}</span>
              <span class="part-id cc-muted">${esc(pt.productId)}</span>
            </div>
          </div>`
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

  bindDetailRotationControls()

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
          if (err.code === UPLOAD_OVERWRITE_CANCELLED) toast('GLB-Upload abgebrochen', 'info')
          else toast(`Upload fehlgeschlagen: ${err.message}`, 'error')
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
        if (err.code === UPLOAD_OVERWRITE_CANCELLED) toast('GLB-Upload abgebrochen', 'info')
        else toast(`Upload fehlgeschlagen: ${err.message}`, 'error')
      }
    })
  }

  bindCadSection(p)

  const btnGtinApply = detailContent.querySelector('#btnGtinApplyDefaultColor')
  if (btnGtinApply) {
    btnGtinApply.addEventListener('click', async () => {
      const gtinEl = detailContent.querySelector('[data-field="gtin"]')
      const artEl = detailContent.querySelector('[data-field="articleNumber"]')
      const shopEl = detailContent.querySelector('[data-field="shopwareProductId"]')
      const gtin = (gtinEl?.value || '').replace(/\D/g, '')
      const articleNumber = (artEl?.value || '').trim()
      const shopwareProductId = (shopEl?.value || '').trim()
      const artQ = articleNumber || shopwareProductId
      if (!gtin && !artQ) {
        toast('GTIN oder Artikelnummer (bzw. Shopware-ID) eintragen.', 'error')
        return
      }
      btnGtinApply.disabled = true
      try {
        const params = new URLSearchParams()
        if (gtin) params.set('gtin', gtin)
        if (artQ) params.set('articleNumber', artQ)
        const gr = await fetch(`/api/v1/gtin/filename?${params}`)
        const gd = await parseJsonResponse(gr)
        const pr = parseGtinStammRalFromApi(gd)
        if (!pr) {
          const msg =
            gd?.success === false
              ? gd.reason || gd.error || 'Kein Stammeintrag'
              : 'Kein RAL / VZK in den Stammdaten.'
          toast(msg, 'error')
          return
        }
        const defaultColor = `RAL ${pr.ralDigits}`
        const patch = {
          defaultColor,
        }
        if (gtin) patch.gtin = gtin
        if (articleNumber) patch.articleNumber = articleNumber
        if (shopwareProductId) patch.shopwareProductId = shopwareProductId
        await patchProduct(p.id, patch)
        toast(`Standard-Farbe übernommen: ${defaultColor}`, 'success')
        openDetail(p.id)
      } catch (err) {
        toast(err.message || String(err), 'error')
      } finally {
        btnGtinApply.disabled = false
      }
    })
  }

  if (!isComposed) {
    void runDetailColorCompare(p)
  }

  // Detail-Panel: Konvertier-Button
  const convertDetailBtn = detailContent.querySelector('.btn-convert-cad-detail')
  if (convertDetailBtn) {
    convertDetailBtn.addEventListener('click', () => startProductConversion(p.id))
  }

  // Maße: manuelle Neu-Berechnung
  const btnMeasure = detailContent.querySelector('#btnMeasureDimensions')
  if (btnMeasure) {
    btnMeasure.addEventListener('click', async () => {
      btnMeasure.disabled = true
      const originalLabel = btnMeasure.innerHTML
      btnMeasure.innerHTML = 'Messe …'
      try {
        const current = productCache.get(p.id) || p
        const model = (selectedProductId === p.id && detailPreviewModelRoot) || null
        await measureAndPersistDimensions(current, { modelOverride: model })
      } finally {
        btnMeasure.disabled = false
        btnMeasure.innerHTML = originalLabel
      }
    })
  }

  const btnRegenThumb = detailContent.querySelector('#btnRegenerateThumbnail')
  if (btnRegenThumb) {
    btnRegenThumb.addEventListener('click', () => void regenerateDashboardThumbnail())
  }

  if (p.glbFile) loadDetailPreview(p)
  if (isComposed && p.parts?.length) mountPartShapePreviews(p)
  bindDetailNameRules()
  bindDetailReductionRules()
  bindDetailVisibilityRules()
}

/* ═══════════════════════════════════════════════
   MTL-Editor (Produkt-Detail)
   ═══════════════════════════════════════════════ */

const MTL_COLOR_KEYS = [
  { key: 'Ka', label: 'Ka (ambient)' },
  { key: 'Kd', label: 'Kd (diffus)' },
  { key: 'Ks', label: 'Ks (specular)' },
  { key: 'Ke', label: 'Ke (emissive)' },
]

const MTL_MAP_ROWS = [
  { key: 'Kd', label: 'map_Kd' },
  { key: 'Ka', label: 'map_Ka' },
  { key: 'Ks', label: 'map_Ks' },
  { key: 'Ke', label: 'map_Ke' },
  { key: 'Ns', label: 'map_Ns' },
  { key: 'd', label: 'map_d' },
  { key: 'bump', label: 'map_bump' },
  { key: 'disp', label: 'disp' },
  { key: 'decal', label: 'decal' },
  { key: 'refl', label: 'refl' },
]

function buildRalSelectOptions(ralMeta, ralCodes, selectedCode) {
  let html = '<option value="">— Manuell / keine RAL-Zuordnung</option>'
  for (const code of ralCodes) {
    const meta = ralMeta[code]
    const label = meta?.name ? `${esc(code)} — ${esc(meta.name)}` : esc(code)
    const sel = code === selectedCode ? ' selected' : ''
    html += `<option value="${esc(code)}"${sel}>${label}</option>`
  }
  return html
}

function ralCodeForHexInPalette(ralMeta, ralCodes, hexNorm) {
  if (!hexNorm) return ''
  const n = ColorService.normalizeHex(hexNorm)
  if (!n) return ''
  for (const code of ralCodes) {
    const hx = ralMeta[code]?.hex
    if (hx && ColorService.normalizeHex(hx) === n) return code
  }
  const near = ColorService.nearestRAL(n)
  return near?.code || ''
}

function buildMtlEditorMaterialsHtml(state) {
  const { materials, ralMeta, ralCodes } = state
  return materials
    .map((m, mi) => {
      const maps = m.maps || {}
      const mapInputs = MTL_MAP_ROWS.map(
        ({ key, label }) => `
        <label class="mtl-editor-map-row">
          <span class="mtl-editor-map-label">${esc(label)}</span>
          <input type="text" class="mtl-editor-text" data-mi="${mi}" data-map-key="${esc(key)}" value="${esc(maps[key] || '')}" placeholder="Dateiname oder Pfad" autocomplete="off">
        </label>`,
      ).join('')

      const colorRows = MTL_COLOR_KEYS.map(({ key, label }) => {
        const rgb = m[key]
        const hx = rgb01ToHexForPicker(rgb)
        const ralSel = ralCodeForHexInPalette(ralMeta, ralCodes, hx)
        return `
        <div class="mtl-editor-color-row" data-mi="${mi}">
          <span class="mtl-editor-color-label">${esc(label)}</span>
          <input type="color" class="mtl-editor-color" data-mi="${mi}" data-color-key="${esc(key)}" value="${esc(hx)}" title="${esc(label)}">
          <input type="text" class="mtl-editor-hex" data-mi="${mi}" data-color-key="${esc(key)}" data-role="hex" value="${esc(hx)}" maxlength="9" placeholder="#RRGGBB" autocomplete="off">
          <select class="mtl-editor-ral" data-mi="${mi}" data-color-key="${esc(key)}" data-role="ral" aria-label="RAL ${esc(key)}">
            ${buildRalSelectOptions(ralMeta, ralCodes, ralSel)}
          </select>
        </div>`
      }).join('')

      const Ns = m.Ns != null && Number.isFinite(m.Ns) ? String(m.Ns) : ''
      const Ni = m.Ni != null && Number.isFinite(m.Ni) ? String(m.Ni) : ''
      const d = m.d != null && Number.isFinite(m.d) ? String(m.d) : ''
      const Tr = m.Tr != null && Number.isFinite(m.Tr) ? String(m.Tr) : ''
      const illum = m.illum != null && Number.isFinite(m.illum) ? String(m.illum) : ''

      return `
      <div class="mtl-editor-mat" data-mi="${mi}">
        <div class="mtl-editor-mat-head">
          <label class="mtl-editor-name-wrap">Materialname (newmtl)
            <input type="text" class="mtl-editor-text mtl-editor-name" data-mi="${mi}" data-field="name" value="${esc(m.name || '')}" spellcheck="false">
          </label>
          <button type="button" class="btn btn-ghost mtl-editor-del-mat" data-mi="${mi}" title="Material entfernen">Löschen</button>
        </div>
        <div class="mtl-editor-scalars">
          <label>Ns <input type="text" class="mtl-editor-num" data-mi="${mi}" data-scalar="Ns" value="${esc(Ns)}" inputmode="decimal"></label>
          <label>Ni <input type="text" class="mtl-editor-num" data-mi="${mi}" data-scalar="Ni" value="${esc(Ni)}" inputmode="decimal"></label>
          <label>d <input type="text" class="mtl-editor-num" data-mi="${mi}" data-scalar="d" value="${esc(d)}" inputmode="decimal"></label>
          <label>Tr <input type="text" class="mtl-editor-num" data-mi="${mi}" data-scalar="Tr" value="${esc(Tr)}" inputmode="decimal"></label>
          <label>illum <input type="text" class="mtl-editor-num" data-mi="${mi}" data-scalar="illum" value="${esc(illum)}" inputmode="numeric"></label>
        </div>
        <div class="mtl-editor-colors">${colorRows}</div>
        <details class="mtl-editor-maps-details">
          <summary>Texturpfade &amp; Maps</summary>
          <div class="mtl-editor-maps">${mapInputs}</div>
        </details>
      </div>`
    })
    .join('')
}

/**
 * @param {string} relPath z. B. /models/obj/10018.mtl
 * @param {string} productId
 */
async function openMtlEditor(relPath, productId) {
  document.getElementById('mtlEditorOverlay')?.remove()
  document.getElementById('objMtllibOverlay')?.remove()

  /** @type {{ path: string, productId: string, header: string[], materials: object[], ralMeta: object, ralCodes: string[] }} */
  const state = {
    path: relPath,
    productId,
    header: [],
    materials: [],
    ralMeta: {},
    ralCodes: [],
  }

  try {
    const [mtlRes, ralRes] = await Promise.all([
      fetch(`/__api/mtl?path=${encodeURIComponent(relPath)}`),
      fetch('/ralColors.json'),
    ])
    const mtlData = await parseJsonResponse(mtlRes)
    if (!mtlRes.ok) throw new Error(mtlData.error || mtlData.message || `HTTP ${mtlRes.status}`)
    let ralRaw = {}
    if (ralRes.ok) ralRaw = await ralRes.json().catch(() => ({}))
    state.header = Array.isArray(mtlData.header) ? [...mtlData.header] : []
    state.materials = JSON.parse(JSON.stringify(mtlData.materials || []))
    state.ralMeta = ralRaw && typeof ralRaw === 'object' ? ralRaw : {}
    state.ralCodes = Object.keys(state.ralMeta)
      .filter((k) => k !== '_meta')
      .sort((a, b) => a.localeCompare(b, 'en'))
  } catch (e) {
    toast(e.message || 'MTL konnte nicht geladen werden.', 'error')
    return
  }

  const overlay = document.createElement('div')
  overlay.id = 'mtlEditorOverlay'
  overlay.className = 'mtl-editor-overlay'
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-labelledby', 'mtlEditorTitle')
  overlay.innerHTML = `
    <div class="mtl-editor-dialog">
      <header class="mtl-editor-header">
        <div>
          <h2 id="mtlEditorTitle" class="mtl-editor-title">MTL bearbeiten</h2>
          <p class="mtl-editor-path"><code>${esc(relPath)}</code></p>
        </div>
        <button type="button" class="mtl-editor-close" data-mtl-action="close" aria-label="Schließen">×</button>
      </header>
      <div class="mtl-editor-toolbar">
        <button type="button" class="btn btn-ghost" data-mtl-action="add-mat">Neues Material</button>
        <span class="mtl-editor-hint">Speichern legt <code>.bak</code> an und überschreibt die MTL. Anschließend Produkt neu konvertieren.</span>
      </div>
      <div class="mtl-editor-body" id="mtlEditorBody"></div>
      <footer class="mtl-editor-footer">
        <button type="button" class="btn btn-ghost" data-mtl-action="close">Abbrechen</button>
        <button type="button" class="btn btn-primary" data-mtl-action="save">Speichern</button>
      </footer>
    </div>`

  document.body.appendChild(overlay)
  const bodyEl = overlay.querySelector('#mtlEditorBody')
  const btnSave = overlay.querySelector('[data-mtl-action="save"]')

  function reRenderMaterials() {
    if (!bodyEl) return
    bodyEl.innerHTML =
      state.materials.length === 0
        ? '<p class="mtl-editor-empty">Keine Materialien – „Neues Material“ anlegen.</p>'
        : buildMtlEditorMaterialsHtml(state)
  }

  function closeMtlEditor() {
    overlay.remove()
    document.removeEventListener('keydown', onKey)
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeMtlEditor()
    }
  }
  document.addEventListener('keydown', onKey)

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeMtlEditor()
  })

  overlay.addEventListener('click', (e) => {
    const a = e.target.closest('[data-mtl-action]')
    if (!a) return
    const act = a.dataset.mtlAction
    if (act === 'close') {
      e.preventDefault()
      closeMtlEditor()
      return
    }
    if (act === 'add-mat') {
      e.preventDefault()
      const nm = createEmptyMaterial(`Material_${Date.now()}`)
      state.materials.push(nm)
      reRenderMaterials()
      return
    }
    if (act === 'save') {
      e.preventDefault()
      void (async () => {
        if (!state.materials.length) {
          toast('Mindestens ein Material erforderlich.', 'error')
          return
        }
        btnSave.disabled = true
        try {
          const res = await fetch('/__api/mtl', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              path: state.path,
              header: state.header,
              materials: state.materials,
            }),
          })
          const data = await parseJsonResponse(res)
          if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`)
          toast('MTL gespeichert. Produkt neu konvertieren, damit die GLB die Änderungen übernimmt.', 'success')
          invalidateDetailMtlColorCompare(productId)
          closeMtlEditor()
        } catch (err) {
          toast(err.message || 'Speichern fehlgeschlagen.', 'error')
        } finally {
          btnSave.disabled = false
        }
      })()
      return
    }
    const delBtn = e.target.closest('.mtl-editor-del-mat')
    if (delBtn) {
      e.preventDefault()
      const mi = parseInt(delBtn.dataset.mi, 10)
      if (!Number.isFinite(mi)) return
      state.materials.splice(mi, 1)
      reRenderMaterials()
    }
  })

  overlay.addEventListener('input', (e) => {
    const el = /** @type {HTMLInputElement} */ (e.target)
    const mi = parseInt(el.dataset.mi ?? '', 10)
    if (!Number.isFinite(mi) || !state.materials[mi]) return
    const mat = state.materials[mi]
    if (el.dataset.field === 'name') {
      mat.name = el.value
      return
    }
    if (el.dataset.mapKey) {
      const k = el.dataset.mapKey
      if (!mat.maps) mat.maps = {}
      const v = el.value.trim()
      mat.maps[k] = v === '' ? null : el.value
      return
    }
    if (el.dataset.scalar) {
      const k = el.dataset.scalar
      const raw = el.value.trim()
      if (raw === '') {
        mat[k] = null
        return
      }
      const n = parseFloat(raw)
      mat[k] = Number.isFinite(n) ? n : null
      return
    }
  })

  overlay.addEventListener('change', (e) => {
    const el = /** @type {HTMLInputElement|HTMLSelectElement} */ (e.target)
    const mi = parseInt(el.dataset.mi ?? '', 10)
    if (!Number.isFinite(mi) || !state.materials[mi]) return
    const mat = state.materials[mi]
    const row = el.closest('.mtl-editor-color-row')
    if (el.matches('input[type="color"][data-color-key]')) {
      const key = el.dataset.colorKey
      if (!key) return
      mat[key] = hexToRgb01(el.value)
      const hx = rgb01ToHexForPicker(mat[key])
      if (row) {
        const hexIn = row.querySelector('input[data-role="hex"]')
        const sel = row.querySelector('select[data-role="ral"]')
        if (hexIn) hexIn.value = hx
        if (sel) {
          const code = ralCodeForHexInPalette(state.ralMeta, state.ralCodes, hx)
          sel.value = code || ''
        }
      }
      return
    }
    if (el.matches('select[data-role="ral"]')) {
      const key = el.dataset.colorKey
      if (!key) return
      const code = el.value
      if (!code) return
      const hx = state.ralMeta[code]?.hex
      if (!hx) return
      mat[key] = hexToRgb01(hx)
      if (row) {
        const colIn = row.querySelector('input[type="color"]')
        const hexIn = row.querySelector('input[data-role="hex"]')
        const pick = ColorService.normalizeHex(hx) || hx
        if (colIn) colIn.value = pick
        if (hexIn) hexIn.value = pick
      }
    }
  })

  overlay.addEventListener('input', (e) => {
    const el = /** @type {HTMLInputElement} */ (e.target)
    if (!el.matches?.('input[data-role="hex"]')) return
    const mi = parseInt(el.dataset.mi ?? '', 10)
    const key = el.dataset.colorKey
    if (!Number.isFinite(mi) || !key || !state.materials[mi]) return
    let v = el.value.trim()
    if (!v.startsWith('#')) v = `#${v}`
    if (!/^#[0-9A-Fa-f]{6}$/.test(v)) return
    const mat = state.materials[mi]
    mat[key] = hexToRgb01(v)
    const row = el.closest('.mtl-editor-color-row')
    if (row) {
      const colIn = row.querySelector('input[type="color"]')
      const sel = row.querySelector('select[data-role="ral"]')
      if (colIn) colIn.value = v.toUpperCase()
      if (sel) {
        const code = ralCodeForHexInPalette(state.ralMeta, state.ralCodes, v)
        sel.value = code || ''
      }
    }
  })

  reRenderMaterials()
}

/**
 * Kleiner Dialog: erste `mtllib`-Zeile der OBJ anpassen (Materialbibliothek).
 * @param {string} relPath z. B. /models/obj/200170830.obj
 * @param {string} productId
 */
async function openObjMtllibEditor(relPath, productId) {
  document.getElementById('mtlEditorOverlay')?.remove()
  document.getElementById('objMtllibOverlay')?.remove()

  let current = ''
  try {
    const res = await fetch(`/__api/obj-mtllib?path=${encodeURIComponent(relPath)}`)
    const data = await parseJsonResponse(res)
    if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`)
    current = data.mtllib ?? ''
  } catch (e) {
    toast(e.message || 'OBJ konnte nicht geladen werden.', 'error')
    return
  }

  const overlay = document.createElement('div')
  overlay.id = 'objMtllibOverlay'
  overlay.className = 'mtl-editor-overlay'
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-labelledby', 'objMtllibTitle')
  overlay.innerHTML = `
    <div class="mtl-editor-dialog" style="max-width:32rem">
      <header class="mtl-editor-header">
        <div>
          <h2 id="objMtllibTitle" class="mtl-editor-title">OBJ – mtllib</h2>
          <p class="mtl-editor-path"><code>${esc(relPath)}</code></p>
        </div>
        <button type="button" class="mtl-editor-close" data-obj-action="close" aria-label="Schließen">×</button>
      </header>
      <div class="mtl-editor-body">
        <p class="mtl-editor-hint" style="margin:0 0 .75rem">Materialbibliothek laut Wavefront (oft ein Dateiname, z. B. <code>170830.mtl</code>). Muss zu einer <strong>hochgeladenen</strong> MTL in den CAD-Dateien passen.</p>
        <label class="mtl-editor-name-wrap">mtllib
          <input type="text" class="mtl-editor-text" id="objMtllibInput" value="${esc(current)}" placeholder="z. B. 170830.mtl" spellcheck="false" autocomplete="off">
        </label>
      </div>
      <footer class="mtl-editor-footer">
        <button type="button" class="btn btn-ghost" data-obj-action="close">Abbrechen</button>
        <button type="button" class="btn btn-primary" data-obj-action="save">Speichern</button>
      </footer>
    </div>`

  document.body.appendChild(overlay)
  const inp = /** @type {HTMLInputElement | null} */ (overlay.querySelector('#objMtllibInput'))
  inp?.focus()
  inp?.select()

  function closeObjMtllib() {
    overlay.remove()
    document.removeEventListener('keydown', onObjKey)
  }
  function onObjKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeObjMtllib()
    }
  }
  document.addEventListener('keydown', onObjKey)

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeObjMtllib()
  })
  overlay.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-obj-action]')
    if (!btn) return
    const act = btn.dataset.objAction
    if (act === 'close') {
      e.preventDefault()
      closeObjMtllib()
      return
    }
    if (act === 'save') {
      e.preventDefault()
      const v = (inp?.value || '').trim()
      if (!v) {
        toast('mtllib darf nicht leer sein.', 'error')
        return
      }
      btn.disabled = true
      try {
        const res = await fetch('/__api/obj-mtllib', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: relPath, mtllib: v }),
        })
        const data = await parseJsonResponse(res)
        if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`)
        toast('OBJ gespeichert (mtllib). Neu konvertieren, damit die GLB passt.', 'success')
        invalidateDetailMtlColorCompare(productId)
        closeObjMtllib()
      } catch (err) {
        toast(err.message || 'Speichern fehlgeschlagen.', 'error')
      } finally {
        btn.disabled = false
      }
    }
  })
}

/* ═══════════════════════════════════════════════
   CAD files
   ═══════════════════════════════════════════════ */
/** Dateiauswahl + Filter; MIME-Zusätze helfen macOS/Chrome bei .step/.stp. */
const CAD_ACCEPT =
  '.obj,.mtl,.step,.stp,.stpz,.p21,.fbx,.stl,.dae,.iges,.igs,.3ds,.png,.jpg,.jpeg,.tiff,.tga,.bmp,model/step,application/step,application/p21'
const CAD_ACCEPT_PICKER = `${CAD_ACCEPT},.STEP,.STP,.STPZ,.P21`
const CAD_ALLOWED_EXTS = new Set(
  CAD_ACCEPT.split(',').map((x) => x.trim().toLowerCase().replace(/^\./, '')).filter(Boolean)
)
const CAD_BADGE_COLORS = {
  obj:  '#f59e0b', mtl:  '#a16207',
  step: '#3b82f6', stp:  '#3b82f6', stpz: '#3b82f6', p21: '#3b82f6',
  fbx:  '#a855f7', stl:  '#22c55e',
  dae:  '#14b8a6', iges: '#ec4899', igs: '#ec4899',
  '3ds': '#6366f1',
  png:  '#06b6d4', jpg:  '#06b6d4', jpeg: '#06b6d4',
  tiff: '#06b6d4', tga:  '#06b6d4',   bmp:  '#06b6d4',
}

/** @param {File} file */
function isAllowedCadFile(file) {
  const base = (file?.name || '').split(/[/\\]/).pop().trim()
  const dot = base.lastIndexOf('.')
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
  if (ext && CAD_ALLOWED_EXTS.has(ext)) return true
  const t = (file.type || '').toLowerCase()
  if (!t) return false
  if (t.includes('step') || t.includes('p21') || t === 'model/step' || t === 'application/step') return true
  return false
}

function cadExt(filePath) {
  const fn = filePath.split('/').pop() || filePath
  const dot = fn.lastIndexOf('.')
  return dot > 0 ? fn.slice(dot + 1).toLowerCase() : fn.toLowerCase()
}

/** step | obj | mtl — gleiche Familie wird beim Neu-Upload ersetzt (wie erwartet bei STEP/OBJ/MTL vor Re-Konvertierung). */
function cadReplaceFamilyFromPath(urlPath) {
  const ext = cadExt(urlPath)
  if (['step', 'stp', 'stpz', 'p21'].includes(ext)) return 'step'
  if (ext === 'obj') return 'obj'
  if (ext === 'mtl') return 'mtl'
  return null
}

/** Entfernt alle bisherigen Dateien derselben Familie (STEP vs. OBJ vs. MTL), hängt newPath an. */
function mergeCadFilesReplaceFamily(existingList, newPath) {
  const fam = cadReplaceFamilyFromPath(newPath)
  const prev = [...(existingList || [])]
  if (!fam) {
    const s = new Set(prev)
    s.add(newPath)
    return [...s]
  }
  const kept = prev.filter((u) => cadReplaceFamilyFromPath(u) !== fam)
  if (!kept.includes(newPath)) kept.push(newPath)
  return kept
}

async function deleteUploadedCadFilesSilently(paths) {
  for (const rel of paths) {
    if (!rel || !String(rel).startsWith('/models/products/')) continue
    try {
      await fetch('/__api/delete-uploaded-cad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: rel }),
      })
    } catch { /* ignore */ }
  }
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
        ${ext === 'mtl'
          ? `<button type="button" class="cad-btn cad-edit-mtl-btn" data-cad-path="${esc(fp)}" title="MTL bearbeiten">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        </button>`
          : ''}
        ${ext === 'obj'
          ? `<button type="button" class="cad-btn cad-edit-obj-mtllib-btn" data-cad-path="${esc(fp)}" title="mtllib (Materialbibliothek)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        </button>`
          : ''}
        <button class="cad-btn cad-delete-btn" data-cad-path="${esc(fp)}" title="Entfernen">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`
  }).join('')
}

/**
 * Zielordner unter public/models/products/… für CAD-Uploads.
 * Nur wenn die GLB noch unter /models/products/… liegt, dort den Elternordner nutzen.
 * GLBs unter /models/output/… (Standard nach Konvertierung) würden sonst fälschlich
 * …/products/models/output/ erzeugen — neue STEP-Dateien wären dann „verschoben“ und die Pipeline bricht leicht.
 */
function cadUploadSubFolder(product, productId) {
  const glb = product?.glbFile && String(product.glbFile).replace(/^\//, '')
  if (!glb || !glb.startsWith('models/products/')) return productId
  const rest = glb.slice('models/products/'.length)
  const segs = rest.split('/').filter(Boolean)
  if (segs.length < 2) return productId
  return segs.slice(0, -1).join('/')
}

async function uploadCadFile(file, productId) {
  const p = productCache.get(productId)
  const subFolder = cadUploadSubFolder(p, productId)
  const filename = subFolder ? `${subFolder}/${file.name}` : file.name
  return uploadBinaryWithOverwritePrompt('/__api/upload-cad', file, filename)
}

function bindCadSection(p) {
  const listEl = document.getElementById('detailCadList')
  const uploadZone = document.getElementById('detailCadUpload')
  if (!listEl || !uploadZone) return

  // MTL bearbeiten / löschen
  listEl.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('.cad-edit-mtl-btn')
    if (editBtn) {
      e.preventDefault()
      const fp = editBtn.dataset.cadPath
      if (fp) openMtlEditor(fp, p.id)
      return
    }
    const objMtllibBtn = e.target.closest('.cad-edit-obj-mtllib-btn')
    if (objMtllibBtn) {
      e.preventDefault()
      const fp = objMtllibBtn.dataset.cadPath
      if (fp) openObjMtllibEditor(fp, p.id)
      return
    }
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
    inp.accept = CAD_ACCEPT_PICKER
    inp.multiple = true
    inp.onchange = async () => {
      for (const file of [...inp.files]) {
        if (!isAllowedCadFile(file)) {
          toast(`${file.name}: Dateityp nicht unterstützt`, 'error')
          continue
        }
        await doUploadCad(file, p, listEl)
      }
    }
    inp.click()
  })

  // Drag & drop
  uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('drag-over') })
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'))
  uploadZone.addEventListener('drop', async (e) => {
    e.preventDefault(); e.stopPropagation()
    uploadZone.classList.remove('drag-over')
    const files = [...e.dataTransfer.files].filter((f) => isAllowedCadFile(f))
    if (!files.length) { toast('Ungültiger Dateityp (z. B. STEP/STP/OBJ/MTL …)', 'error'); return }
    for (const file of files) await doUploadCad(file, p, listEl)
  })
}

async function doUploadCad(file, p, listEl) {
  if (!isAllowedCadFile(file)) {
    toast(`${file.name}: Dateityp nicht unterstützt`, 'error')
    return
  }
  try {
    const before = [...(p.cadFiles || [])]
    const result = await uploadCadFile(file, p.id)
    p.cadFiles = mergeCadFilesReplaceFamily(before, result.path)
    const removed = before.filter((x) => !p.cadFiles.includes(x))
    await patchProduct(p.id, { cadFiles: p.cadFiles })
    await deleteUploadedCadFilesSilently(removed)
    listEl.innerHTML = renderCadFileList(p)
    toast(`${file.name} hochgeladen${removed.length ? ' (ältere gleiche Art ersetzt)' : ''}`, 'success')
  } catch (err) {
    if (err.code === UPLOAD_OVERWRITE_CANCELLED) toast('CAD-Upload abgebrochen', 'info')
    else toast(`Upload fehlgeschlagen: ${err.message}`, 'error')
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

function applyDetailMeshVisibility() {
  if (!detailPreviewModelRoot) return
  const meshes = collectMeshesFromGroup(detailPreviewModelRoot)
  const idx = detailMeshIsolateIndex
  meshes.forEach((m, i) => {
    // Isolation (Klick auf Zeile) hat Vorrang, damit man auch ausgeschlossene
    // Teile inspizieren kann. Sonst: sichtbar = ins GLB aufgenommen.
    m.visible = idx === null ? !detailMeshExcluded.has(i) : i === idx
  })
}

function updateDetailMeshRowClasses() {
  const list = document.getElementById('detailMeshPartsList')
  if (!list) return
  list.querySelectorAll('.detail-mesh-row').forEach((row) => {
    const i = parseInt(row.dataset.meshIdx, 10)
    row.classList.toggle('is-active', detailMeshIsolateIndex === i)
    row.classList.toggle('is-excluded', detailMeshExcluded.has(i))
  })
  const clearBtn = document.getElementById('detailMeshClearBtn')
  if (clearBtn) clearBtn.hidden = detailMeshIsolateIndex === null
  updateDetailMeshSelectionCount()
}

function updateDetailMeshSelectionCount() {
  const el = document.getElementById('detailMeshSelCount')
  if (!el || !detailPreviewModelRoot) return
  const total = collectMeshesFromGroup(detailPreviewModelRoot).length
  const included = total - detailMeshExcluded.size
  el.textContent = `${included}/${total} im GLB`
}

function clearDetailMeshIsolate() {
  detailMeshIsolateIndex = null
  applyDetailMeshVisibility()
  updateDetailMeshRowClasses()
}

function toggleDetailMeshIsolate(index) {
  if (detailMeshIsolateIndex === index) detailMeshIsolateIndex = null
  else detailMeshIsolateIndex = index
  applyDetailMeshVisibility()
  updateDetailMeshRowClasses()
}

function focusDetailMeshPart(index) {
  if (!detailPreviewModelRoot || !detailPreviewCamera || !detailControls) return
  const meshes = collectMeshesFromGroup(detailPreviewModelRoot)
  const mesh = meshes[index]
  if (!mesh) return
  mesh.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(mesh)
  if (box.isEmpty()) return
  const center = box.getCenter(new THREE.Vector3())
  const cam = detailPreviewCamera
  const controls = detailControls
  const sphere = new THREE.Sphere()
  box.getBoundingSphere(sphere)
  const aspect = cam.aspect || 1
  const vFov = (cam.fov * Math.PI) / 180
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect)
  const margin = 1.35
  const distV = sphere.radius / Math.tan(vFov / 2) * margin
  const distH = sphere.radius / Math.tan(hFov / 2) * margin
  const distance = Math.max(distV, distH, 0.05)
  const dir = new THREE.Vector3(0.55, 0.35, 0.75).normalize()
  const desiredPos = center.clone().add(dir.multiplyScalar(distance))
  cam.position.copy(desiredPos)
  controls.target.copy(center)
  controls.autoRotate = false
  controls.update()
}

function buildDetailMeshPartsUI() {
  const section = document.getElementById('detailMeshPartsSection')
  const listEl = document.getElementById('detailMeshPartsList')
  const clearBtn = document.getElementById('detailMeshClearBtn')
  if (!detailPreviewModelRoot || !listEl) return
  detailMeshIsolateIndex = null
  detailMeshExcluded = new Set()
  detailMeshSelectionReady = false
  const meshes = collectMeshesFromGroup(detailPreviewModelRoot)
  if (section) section.hidden = meshes.length === 0
  if (!meshes.length) {
    listEl.innerHTML = ''
    if (clearBtn) clearBtn.hidden = true
    return
  }

  // Vorauswahl aus gespeicherten Checkbox-Regeln (source: meshSelect) ableiten.
  const prod = productCache.get(selectedProductId)
  const savedMeshSelect = splitVisibilityRules(prod?.conversionPreset?.visibilityRules).meshSelect
  const excludedNames = new Set(
    savedMeshSelect
      .map((r) => (typeof r?.name === 'string' ? r.name.trim() : ''))
      .filter(Boolean),
  )
  meshes.forEach((mesh, i) => {
    const name = (mesh.name || '').trim()
    if (name && excludedNames.has(name)) detailMeshExcluded.add(i)
  })

  listEl.innerHTML = meshes
    .map((mesh, i) => {
      const name = mesh.name || '(ohne Namen)'
      const vc = mesh.geometry?.attributes?.position?.count ?? 0
      const checked = detailMeshExcluded.has(i) ? '' : 'checked'
      return `<div class="detail-mesh-row${detailMeshExcluded.has(i) ? ' is-excluded' : ''}" data-mesh-idx="${i}">
        <label class="detail-mesh-inc" title="Ins GLB aufnehmen" data-mesh-inc-wrap>
          <input type="checkbox" class="detail-mesh-inc-cb" data-mesh-inc="${i}" ${checked}>
        </label>
        <span class="detail-mesh-name" title="${esc(name)}">${esc(name)}</span>
        <span class="detail-mesh-v">${vc.toLocaleString('de-DE')} V</span>
        <button type="button" class="detail-mesh-focus-btn" data-mesh-focus="${i}" title="Kamera auf dieses Teil">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M3 7V5a2 2 0 0 1 2-2h2M3 17v2a2 2 0 0 0 2 2h2m10-16h2a2 2 0 0 1 2 2v2m0 10v2a2 2 0 0 1-2 2h-2"/></svg>
        </button>
      </div>`
    })
    .join('')
  if (clearBtn) clearBtn.hidden = true
  detailMeshSelectionReady = true
  applyDetailMeshVisibility()
  updateDetailMeshRowClasses()

  listEl.onclick = (e) => {
    const focusBtn = e.target.closest('[data-mesh-focus]')
    if (focusBtn) {
      e.stopPropagation()
      focusDetailMeshPart(parseInt(focusBtn.getAttribute('data-mesh-focus'), 10))
      return
    }
    // Klicks auf die Checkbox nicht als Zeilen-Isolation behandeln.
    if (e.target.closest('[data-mesh-inc-wrap]')) return
    const row = e.target.closest('.detail-mesh-row')
    if (row) toggleDetailMeshIsolate(parseInt(row.dataset.meshIdx, 10))
  }
  listEl.onchange = (e) => {
    const cb = e.target.closest('.detail-mesh-inc-cb')
    if (!cb) return
    const i = parseInt(cb.getAttribute('data-mesh-inc'), 10)
    if (cb.checked) detailMeshExcluded.delete(i)
    else detailMeshExcluded.add(i)
    applyDetailMeshVisibility()
    updateDetailMeshRowClasses()
  }
  if (clearBtn) {
    clearBtn.onclick = () => clearDetailMeshIsolate()
  }

  const allBtn = document.getElementById('detailMeshSelectAll')
  const noneBtn = document.getElementById('detailMeshSelectNone')
  if (allBtn) allBtn.onclick = () => setAllDetailMeshIncluded(true)
  if (noneBtn) noneBtn.onclick = () => setAllDetailMeshIncluded(false)
}

/** Alle Meshes ins GLB aufnehmen (true) oder ausschließen (false). */
function setAllDetailMeshIncluded(included) {
  if (!detailPreviewModelRoot) return
  const meshes = collectMeshesFromGroup(detailPreviewModelRoot)
  detailMeshExcluded = new Set()
  if (!included) meshes.forEach((_, i) => detailMeshExcluded.add(i))
  const listEl = document.getElementById('detailMeshPartsList')
  if (listEl) {
    listEl.querySelectorAll('.detail-mesh-inc-cb').forEach((cb) => {
      const i = parseInt(cb.getAttribute('data-mesh-inc'), 10)
      cb.checked = !detailMeshExcluded.has(i)
    })
  }
  applyDetailMeshVisibility()
  updateDetailMeshRowClasses()
}

function applyPreviewImageToProductCard(productId, previewImageUrl) {
  if (!previewImageUrl || !productId) return
  if (previewRenderers.has(productId)) disposeCardPreviewById(productId)
  const wrap = productGrid?.querySelector(
    `.card-preview[data-product-id="${cssEscapeId(productId)}"]`,
  )
  if (!wrap) return
  const qi = cardPreviewExitQueue.indexOf(productId)
  if (qi !== -1) cardPreviewExitQueue.splice(qi, 1)
  if (previewObserver) previewObserver.unobserve(wrap)
  wrap.classList.add('has-thumb')
  wrap.removeAttribute('data-glb')
  const oldCanvas = wrap.querySelector('canvas')
  if (oldCanvas) {
    try { oldCanvas.remove() } catch { /* ignore */ }
  }
  let img = wrap.querySelector('.card-preview-img')
  if (!img) {
    img = document.createElement('img')
    img.className = 'card-preview-img'
    img.loading = 'lazy'
    img.decoding = 'async'
    img.alt = ''
    img.width = 640
    img.height = 400
    wrap.insertBefore(img, wrap.firstChild)
  }
  img.src = resolveAssetUrl(previewImageUrl)
  const ph = wrap.querySelector('.card-preview-placeholder')
  if (ph) ph.style.display = 'none'
}

async function regenerateDashboardThumbnail() {
  const id = selectedProductId
  if (!id) return
  const btn = document.getElementById('btnRegenerateThumbnail')
  const p = productCache.get(id)
  if (!p?.glbFile) {
    toast('Kein GLB für dieses Produkt.', 'error')
    return
  }
  if (!detailRenderer || !detailPreviewModelRoot) {
    toast('3D-Vorschau ist noch nicht geladen. Kurz warten und erneut versuchen.', 'error')
    return
  }
  const orig = btn?.innerHTML
  if (btn) {
    btn.disabled = true
    btn.innerHTML = '…'
  }
  try {
    if (detailControls) detailControls.update()
    detailRenderer.render(detailPreviewScene, detailPreviewCamera)
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    })
    const dataUrl = detailRenderer.domElement.toDataURL('image/png')
    if (!dataUrl || dataUrl.length < 200) {
      throw new Error('Screenshot leer')
    }
    const res = await fetch(`/__api/products/${encodeURIComponent(id)}/preview-png`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl }),
    })
    let data = {}
    try {
      data = await parseJsonResponse(res)
    } catch {
      data = {}
    }
    if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`)
    if (!data.previewImage) throw new Error('Keine previewImage in der Antwort')
    p.previewImage = data.previewImage
    if (data.previewImageGeneratedAt) p.previewImageGeneratedAt = data.previewImageGeneratedAt
    const idx = currentPageProducts.findIndex((x) => x.id === id)
    if (idx >= 0) {
      currentPageProducts[idx].previewImage = data.previewImage
      if (data.previewImageGeneratedAt) {
        currentPageProducts[idx].previewImageGeneratedAt = data.previewImageGeneratedAt
      }
    }
    applyPreviewImageToProductCard(id, data.previewImage)
    toast('Vorschaubild gespeichert.', 'success')
  } catch (e) {
    toast(`Vorschaubild: ${e.message || e}`, 'error')
  } finally {
    if (btn) {
      btn.disabled = false
      if (orig) btn.innerHTML = orig
    }
  }
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
  detailPreviewScene = scene
  const camera = new THREE.PerspectiveCamera(35, w / h, 0.01, 100)
  detailPreviewCamera = camera

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.enablePan = false
  controls.autoRotate = true
  controls.autoRotateSpeed = 1.2
  detailControls = controls

  gltfLoader.load(resolveAssetUrl(product.glbFile), async (gltf) => {
    const model = gltf.scene
    stripModelLights(model)
    enableShadowsOnModel(model)
    fillDetailColorCompareGlb(product, model)
    try {
      await applyDashboardModelAppearance(model, product)
    } catch (e) {
            log.scoped("Dashboard").warn("Detail-Vorschau Farben:", e)
    }
    scene.add(model)
    detailPreviewModelRoot = model

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

    applyDetailRotationLive()

    const ph = wrap.querySelector('.card-preview-placeholder')
    if (ph) ph.style.display = 'none'
    wrap.insertBefore(renderer.domElement, wrap.firstChild)
    renderer.domElement.style.borderRadius = 'var(--radius-md)'

    function resizeDetailPreview() {
      const rw = Math.max(1, wrap.clientWidth || 580)
      const rh = Math.max(1, wrap.clientHeight || 280)
      renderer.setSize(rw, rh)
      camera.aspect = rw / rh
      camera.updateProjectionMatrix()
    }

    detailResizeObs = new ResizeObserver(() => {
      resizeDetailPreview()
    })
    detailResizeObs.observe(wrap)

    function animate() {
      detailAnimId = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()
    buildDetailMeshPartsUI()

    // Erstmessung: Maße einmalig aus der geladenen GLB ermitteln, wenn noch keine vorhanden sind.
    if (product.type !== 'composed' && !specsHaveDimensions(product.specs)) {
      const current = productCache.get(product.id) || product
      if (!specsHaveDimensions(current.specs)) {
        measureAndPersistDimensions(current, { silent: true, modelOverride: model })
      }
    }
  }, undefined, (err) => {
        log.scoped("Dashboard").warn("Detail-Preview fehlgeschlagen:", product.glbFile, err)
    if (detailColorCompareState?.p?.id === product.id) {
      detailColorCompareState.glbRows = []
      tryRenderDetailColorCompare()
    }
    const ph = wrap.querySelector('.card-preview-placeholder')
    if (ph) {
      const msg = err?.message || ''
      const hint = msg.includes('404') || msg.includes('Not Found')
        ? ' Datei unter public' + product.glbFile + ' vorhanden?'
        : ''
      ph.querySelector('span').textContent = 'Modell nicht geladen.' + (hint ? ' ' + hint : '')
    }
    const meshSec = document.getElementById('detailMeshPartsSection')
    if (meshSec) meshSec.hidden = true
    const meshList = document.getElementById('detailMeshPartsList')
    if (meshList) meshList.innerHTML = ''
    detailPreviewModelRoot = null
  })
}

function disposeDetailPreview() {
  detailMeshIsolateIndex = null
  detailMeshExcluded = new Set()
  detailMeshSelectionReady = false
  detailPreviewModelRoot = null
  detailPreviewCamera = null
  if (detailPreviewScene) {
    disposeSceneGpuResources(detailPreviewScene)
    detailPreviewScene = null
  }
  const meshSec = document.getElementById('detailMeshPartsSection')
  if (meshSec) meshSec.hidden = true
  const meshList = document.getElementById('detailMeshPartsList')
  if (meshList) {
    meshList.innerHTML = ''
    meshList.onclick = null
  }
  const meshClear = document.getElementById('detailMeshClearBtn')
  if (meshClear) {
    meshClear.hidden = true
    meshClear.onclick = null
  }
  if (detailResizeObs) {
    detailResizeObs.disconnect()
    detailResizeObs = null
  }
  if (detailAnimId) cancelAnimationFrame(detailAnimId)
  detailAnimId = null
  if (detailControls) detailControls.dispose()
  detailControls = null
  if (detailRenderer) {
    detailRenderer.dispose()
    safeForceWebGLContextLoss(detailRenderer)
  }
  detailRenderer = null
}

/** Wechselt im offenen Detail-Panel zum vorherigen (-1) / nächsten (+1) Produkt der aktuellen Seite. */
function navigateDetail(delta) {
  if (!selectedProductId || !currentPageProducts.length) return
  const idx = currentPageProducts.findIndex((p) => p.id === selectedProductId)
  if (idx === -1) return
  const nextIdx = idx + delta
  if (nextIdx < 0 || nextIdx >= currentPageProducts.length) return
  void openDetail(currentPageProducts[nextIdx].id)
}

/** Aktualisiert Vor/Zurück-Buttons + Positionsanzeige ("12 / 24") im Detail-Header. */
function updateDetailNavState() {
  const prevBtn = document.getElementById('detailPrev')
  const nextBtn = document.getElementById('detailNext')
  const posEl = document.getElementById('detailPosition')
  if (!prevBtn || !nextBtn) return
  const idx = currentPageProducts.findIndex((p) => p.id === selectedProductId)
  if (idx === -1) {
    prevBtn.disabled = true
    nextBtn.disabled = true
    if (posEl) posEl.textContent = ''
    return
  }
  prevBtn.disabled = idx <= 0
  nextBtn.disabled = idx >= currentPageProducts.length - 1
  if (posEl) posEl.textContent = `${idx + 1} / ${currentPageProducts.length}`
}

function closeDetail() {
  disposeDetailPreview()
  disposeDetailPartPreviews()
  detailColorCompareState = null
  detailOverlay.classList.remove('open')
  detailPanel.classList.remove('open')
  productGrid.querySelectorAll('.product-card.selected').forEach(c => c.classList.remove('selected'))
  selectedProductId = null
  // Header-Bake-Drehung bleibt erhalten: Wenn der User vorher manuell einen Override gewählt hat,
  // soll der für die nächste Karten-/Bulk-Konvertierung verfügbar bleiben. Beim Öffnen eines
  // anderen Produkts wird der Detail-State über seedDetailRotationFromProduct korrekt neu gesetzt.
}

async function saveDetail() {
  if (!selectedProductId) return
  const p = productCache.get(selectedProductId)
  if (!p) return

  const changes = structuredClone(p)

  detailContent.querySelectorAll('[data-field]').forEach(input => {
    const path = input.dataset.field
    if (input.type === 'checkbox') {
      changes[path] = input.checked
      return
    }
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
  // Legacy aus products.json entfernen (Feld gibt es in der UI nicht mehr; PATCH ohne Key = Feld kann im Server-Merge bestehen bleiben)
  delete changes.defaultColorOverride

  if (detailContent.querySelector('.detail-rotation-section')) {
    const rot = detailRotationOffsetDeg
    if (rot && (rot.x || rot.y || rot.z)) {
      changes.rotationOffset = { x: rot.x, y: rot.y, z: rot.z }
    } else {
      changes.rotationOffset = null
    }
  }

  if (!changes._review) changes._review = {}
  const checkedIssues = []
  detailContent.querySelectorAll('.issue-check input:checked').forEach(cb => {
    checkedIssues.push(cb.dataset.issue)
  })
  changes._review.issues = checkedIssues
  changes._review.reviewedAt = new Date().toISOString()

  const nrContainer = document.getElementById('detailNameRulesRows')
  const vrContainer = document.getElementById('detailReductionRulesRows')
  const visContainer = document.getElementById('detailVisibilityRulesRows')
  if (nrContainer || vrContainer || visContainer) {
    const prev = p.conversionPreset && typeof p.conversionPreset === 'object' && !Array.isArray(p.conversionPreset)
      ? { ...p.conversionPreset }
      : {}
    const next = { ...prev }
    if (nrContainer) {
      next.nameColorRules = collectNameRulesFromContainer(nrContainer)
    }
    if (vrContainer) {
      next.vertexReductionRules = collectReductionRulesFromContainer(vrContainer)
    }
    if (visContainer) {
      // Manuelle Regex-Regeln aus dem Editor + Checkbox-Auswahl (meshSelect).
      // meshSelect-Regeln stehen danach, damit sie bei last-wins gewinnen.
      const manualRules = collectVisibilityRulesFromContainer(visContainer)
      const meshSelectRules = collectMeshSelectVisibilityRules()
      next.visibilityRules = [...manualRules, ...meshSelectRules]
    }
    changes.conversionPreset = next
  }

  try {
    await patchProduct(selectedProductId, changes)
    toast(`Produkt „${changes.name}" gespeichert`, 'success')
    await loadCategoryOptions()
    // Karte auf der aktuellen Seite sofort aktualisieren (inkl. Standard-Farbe)
    const card = productGrid.querySelector(`[data-id="${selectedProductId}"]`)
    if (card) {
      const previewEl = card.querySelector('.card-preview')
      if (previewEl) {
        previewEl.dataset.defaultColor = changes.defaultColor || ''
        previewEl.dataset.surfaceFinish = changes.surfaceFinish || 'auto'
        // Vorschau neu laden, wenn bereits gerendert, damit Farbe sofort sichtbar ist
        if (previewRenderers.has(selectedProductId)) {
          const entry = previewRenderers.get(selectedProductId)
          if (entry?.animId) cancelAnimationFrame(entry.animId)
          if (entry?.resizeObs) entry.resizeObs.disconnect()
          if (entry?.scene) disposeSceneGpuResources(entry.scene)
          if (entry?.renderer) {
            entry.renderer.dispose()
            safeForceWebGLContextLoss(entry.renderer)
          }
          previewRenderers.delete(selectedProductId)
          const updatedP = productCache.get(selectedProductId) || {}
          const product = {
            ...updatedP,
            id: selectedProductId,
            glbFile: changes.glbFile || previewEl.dataset.glb,
            defaultColor: changes.defaultColor || '',
            surfaceFinish: changes.surfaceFinish || 'auto',
          }
          loadPreview(product, previewEl)
        }
      }
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

/** productId → { timeoutId, cardEl } – Löschungen, die noch per Toast rückgängig gemacht werden können. */
const pendingDeletes = new Map()
const DELETE_UNDO_MS = 6000

/**
 * Löschen ohne blockierenden Browser-Dialog: Karte wird sofort deaktiviert/abgeblendet
 * ("Wird gelöscht …"), der eigentliche DELETE-Request läuft erst nach einem Zeitfenster
 * mit Undo-Toast. Klick auf „Rückgängig" storniert ihn vollständig, es wurde nie etwas
 * an den Server geschickt.
 */
function deleteProduct() {
  if (!selectedProductId) return
  const p = productCache.get(selectedProductId)
  if (!p) return
  const id = selectedProductId
  closeDetail()

  const cardEl = productGrid.querySelector(`.product-card[data-id="${cssEscapeId(id)}"]`)
  if (cardEl) cardEl.classList.add('pending-delete')

  const timeoutId = setTimeout(() => void finalizeDelete(id), DELETE_UNDO_MS)
  pendingDeletes.set(id, { timeoutId, cardEl })

  undoToast(`Produkt „${p.name}" wird gelöscht …`, () => cancelPendingDelete(id), DELETE_UNDO_MS)
}

function cancelPendingDelete(id) {
  const pending = pendingDeletes.get(id)
  if (!pending) return
  clearTimeout(pending.timeoutId)
  pendingDeletes.delete(id)
  pending.cardEl?.classList.remove('pending-delete')
}

async function finalizeDelete(id) {
  const pending = pendingDeletes.get(id)
  pendingDeletes.delete(id)
  const p = productCache.get(id)
  try {
    const res = await fetch(`/__api/products/${encodeURIComponent(id)}`, { method: 'DELETE' })
    const data = await parseJsonResponse(res)
    if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`)
    productCache.delete(id)
    pending?.cardEl?.remove()
    toast(`Produkt „${p?.name || id}" gelöscht`, 'info')
  } catch (err) {
    pending?.cardEl?.classList.remove('pending-delete')
    toast(`Löschen fehlgeschlagen: ${err.message}`, 'error')
  }
}

/* ═══════════════════════════════════════════════
   Konvertierung aus dem Dashboard starten (Hintergrund)
   ═══════════════════════════════════════════════ */
const CONVERT_POLL_INTERVAL = 2500
const CONVERT_POLL_MAX = 600 // ~25 Min
const CONVERT_ALL_DELAY_MS = 1500 // Abstand zwischen Konvertierungs-Starts

/** jobId → { productName, startedAt } – parallele Dashboard-Konvertierungen */
const dashConvJobs = new Map()
let dashConvElapseTimer = null
let dashConvHideTimer = null

function formatDashConvElapsedMs(ms) {
  const s = Math.floor(Math.max(0, ms) / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}

function clearDashConvIndicatorTimers() {
  if (dashConvElapseTimer) {
    clearInterval(dashConvElapseTimer)
    dashConvElapseTimer = null
  }
  if (dashConvHideTimer) {
    clearTimeout(dashConvHideTimer)
    dashConvHideTimer = null
  }
}

function setDashConvIndicatorIdle() {
  clearDashConvIndicatorTimers()
  const wrap = document.getElementById('convIndicator')
  if (wrap) {
    wrap.hidden = true
    wrap.classList.remove('is-running', 'is-completed', 'is-failed')
  }
}

function updateDashConvElapsedTick() {
  const el = document.getElementById('convIndicatorElapsed')
  if (!el || dashConvJobs.size === 0) return
  let minT = Infinity
  for (const v of dashConvJobs.values()) {
    if (v.startedAt < minT) minT = v.startedAt
  }
  if (minT === Infinity) return
  el.textContent = formatDashConvElapsedMs(Date.now() - minT)
}

function refreshDashConvRunningUI() {
  const wrap = document.getElementById('convIndicator')
  const label = document.getElementById('convIndicatorLabel')
  if (!wrap || dashConvJobs.size === 0) return
  wrap.hidden = false
  wrap.classList.remove('is-completed', 'is-failed')
  wrap.classList.add('is-running')
  if (label) {
    if (dashConvJobs.size === 1) {
      const only = dashConvJobs.values().next().value
      const name = only?.productName || 'Konvertierung'
      label.textContent = name.length > 32 ? `${name.slice(0, 30)}…` : name
    } else {
      label.textContent = `${dashConvJobs.size} Konvertierungen laufen`
    }
  }
  updateDashConvElapsedTick()
}

function dashConvRegister(jobId, productName) {
  if (!jobId) return
  clearDashConvIndicatorTimers()
  dashConvJobs.set(jobId, { productName: productName || 'Konvertierung', startedAt: Date.now() })
  void ensureDashConvNotificationPermission()
  refreshDashConvRunningUI()
  dashConvElapseTimer = setInterval(updateDashConvElapsedTick, 1000)
}

/**
 * @param {'ok'|'fail'|'aborted'} outcome
 * @param {{ partial?: boolean }} [meta]
 */
function dashConvUnregister(jobId, outcome, meta = {}) {
  const entry = jobId ? dashConvJobs.get(jobId) : null
  const startedAt = entry?.startedAt
  if (jobId) dashConvJobs.delete(jobId)

  if (dashConvJobs.size > 0) {
    clearDashConvIndicatorTimers()
    refreshDashConvRunningUI()
    dashConvElapseTimer = setInterval(updateDashConvElapsedTick, 1000)
    return
  }

  clearDashConvIndicatorTimers()
  const wrap = document.getElementById('convIndicator')
  const label = document.getElementById('convIndicatorLabel')
  const elapsedEl = document.getElementById('convIndicatorElapsed')
  if (!wrap) return

  const dur = startedAt ? Date.now() - startedAt : 0
  if (elapsedEl) elapsedEl.textContent = formatDashConvElapsedMs(dur)

  if (outcome === 'aborted') {
    wrap.hidden = true
    wrap.classList.remove('is-running', 'is-completed', 'is-failed')
    return
  }

  wrap.hidden = false
  wrap.classList.remove('is-running')
  if (outcome === 'fail') {
    wrap.classList.remove('is-completed')
    wrap.classList.add('is-failed')
    if (label) label.textContent = 'Konvertierung fehlgeschlagen'
    dashConvHideTimer = setTimeout(setDashConvIndicatorIdle, 5000)
  } else {
    wrap.classList.remove('is-failed')
    wrap.classList.add('is-completed')
    if (label) label.textContent = meta.partial ? 'Teilweise fertig' : 'Konvertierung fertig'
    dashConvHideTimer = setTimeout(setDashConvIndicatorIdle, 3000)
  }
}

function notifyDashConvDone(jobId, kind, productName, outputs, errorText) {
  if (!('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  try {
    const idStr = jobId != null ? String(jobId) : ''
    const jobShort = idStr.length > 14 ? `${idStr.slice(0, 12)}…` : idStr
    const pn = (productName && String(productName).trim()) || 'Produkt'
    let title = 'META – Konvertierung'
    let body = ''
    if (kind === 'ok') {
      title = 'META – Konvertierung fertig'
      const n = Array.isArray(outputs) ? outputs.length : 0
      body = `${pn}. `
      if (n > 1) body += `${n} Dateien.`
      else if (n === 1) body += `${outputs[0].split(/[/\\]/).pop()}`
      else body += 'Fertig.'
      if (jobShort) body += ` Job: ${jobShort}`
    } else if (kind === 'partial') {
      title = 'META – Konvertierung teilweise fertig'
      const n = Array.isArray(outputs) ? outputs.length : 0
      body = `${pn}. ${n ? `${n} Datei(en).` : ''}`
      if (jobShort) body += ` Job: ${jobShort}`
    } else {
      title = 'META – Konvertierung fehlgeschlagen'
      body = `${pn}. `
      const err = errorText && String(errorText).trim()
      body += err ? err.slice(0, 200) : 'Bitte Log prüfen.'
    }
    new Notification(title, { body, tag: idStr || 'meta-dash-conv', silent: false })
  } catch (_) {}
}

async function ensureDashConvNotificationPermission() {
  if (!('Notification' in window)) return
  if (Notification.permission === 'default') {
    try {
      await Notification.requestPermission()
    } catch (_) {}
  }
}

/** Produkt-IDs, die für "Ausgewählte konvertieren" markiert sind. */
const selectedForConversion = new Set()

/** USDZ-Begleitdatei beim Konvertieren miterzeugen (für iOS AR Quick Look). Persistent in localStorage. */
let exportUsdzEnabled = (() => {
  try {
    const v = localStorage.getItem('dash_exportUsdz')
    if (v === '0' || v === 'false') return false
  } catch (_) { /* ignore */ }
  return true
})()

function updateUsdzToggleUI() {
  const btn = document.getElementById('btnToggleUsdz')
  const label = document.getElementById('btnToggleUsdzLabel')
  if (!btn || !label) return
  btn.classList.toggle('is-active', exportUsdzEnabled)
  btn.classList.toggle('is-off', !exportUsdzEnabled)
  label.textContent = exportUsdzEnabled ? 'USDZ: an' : 'USDZ: aus'
  btn.title = exportUsdzEnabled
    ? 'USDZ wird beim Konvertieren zusätzlich zur .glb erzeugt (iOS AR Quick Look). Klick = ausschalten.'
    : 'USDZ wird aktuell NICHT erzeugt (nur .glb). Klick = einschalten.'
}

function toggleExportUsdz() {
  exportUsdzEnabled = !exportUsdzEnabled
  try { localStorage.setItem('dash_exportUsdz', exportUsdzEnabled ? '1' : '0') } catch (_) { /* ignore */ }
  updateUsdzToggleUI()
  toast(exportUsdzEnabled ? 'USDZ-Export aktiviert.' : 'USDZ-Export deaktiviert (nur GLB).', 'info')
}

/** Label und Enabled-Zustand des „Kategorie zuweisen"-Buttons aktualisieren. */
function updateAssignCategoryButton() {
  const btn = document.getElementById('btnAssignCategory')
  const label = document.getElementById('btnAssignCategoryLabel')
  if (!btn || !label) return
  const n = selectedForConversion.size
  btn.disabled = n === 0
  label.textContent = n > 0 ? `Kategorie zuweisen (${n})` : 'Kategorie zuweisen'
}

function renderCategoryAssignItems() {
  const wrap = document.getElementById('catAssignItems')
  if (!wrap) return
  const known = Array.isArray(productCategoriesCache) && productCategoriesCache.length
    ? productCategoriesCache
    : MAIN_PRODUCT_CATEGORIES
  wrap.innerHTML = known
    .map((c) => `<button type="button" class="cat-assign-item" data-cat="${esc(c)}">${esc(c)}</button>`)
    .join('')
}

function openCategoryAssignPopover() {
  const pop = document.getElementById('catAssignPopover')
  if (!pop) return
  if (selectedForConversion.size === 0) {
    toast('Bitte zuerst Produkte per Checkbox „Auswählen" markieren.', 'info')
    return
  }
  renderCategoryAssignItems()
  pop.hidden = false
  pop.setAttribute('aria-hidden', 'false')
  setTimeout(() => document.addEventListener('click', onCategoryAssignOutsideClick, { once: true }), 0)
}

function closeCategoryAssignPopover() {
  const pop = document.getElementById('catAssignPopover')
  if (!pop) return
  pop.hidden = true
  pop.setAttribute('aria-hidden', 'true')
}

function onCategoryAssignOutsideClick(e) {
  const wrap = document.getElementById('catAssignWrap')
  if (wrap && !wrap.contains(e.target)) closeCategoryAssignPopover()
  else setTimeout(() => document.addEventListener('click', onCategoryAssignOutsideClick, { once: true }), 0)
}

/** Weist allen selektierten Produkten die angegebene Hauptkategorie zu (leer = entfernen). */
async function assignCategoryToSelected(category) {
  const ids = Array.from(selectedForConversion)
  if (ids.length === 0) {
    toast('Keine Produkte ausgewählt.', 'info')
    return
  }
  const val = String(category || '').trim()
  const btn = document.getElementById('btnAssignCategory')
  if (btn) { btn.disabled = true; btn.style.opacity = '0.6' }
  let ok = 0
  let fail = 0
  try {
    for (const id of ids) {
      try {
        await patchProduct(id, { mainCategory: val })
        const cached = productCache.get(id)
        if (cached) cached.mainCategory = val
        ok++
      } catch (err) {
        fail++
                log.scoped("assignCategory").warn("fehlgeschlagen für", id, err?.message || err)
      }
    }
    const labelVal = val || '— Keine —'
    if (fail === 0) toast(`Kategorie "${labelVal}" für ${ok} Produkt(e) gesetzt.`, 'success')
    else toast(`Kategorie "${labelVal}": ${ok} ok, ${fail} Fehler.`, ok > 0 ? 'info' : 'error')
    await loadCategoryOptions()
    await fetchPage()
  } finally {
    if (btn) { btn.style.opacity = '' }
    updateAssignCategoryButton()
    closeCategoryAssignPopover()
  }
}

/** Lädt alle Produkte (paginiert) und gibt sie zurück. */
async function fetchAllProducts() {
  const limit = 200
  let page = 1
  let totalPages = 1
  const all = []
  do {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      search: '',
      filter: 'all',
      status: 'all',
      sort: 'default',
      targetRal: 'all',
      category: 'all',
    })
    const res = await fetch(`/__api/products?${params}`)
    const data = await parseJsonResponse(res)
    if (!res.ok) throw new Error(data.error || data.message || 'Laden fehlgeschlagen')
    const list = data.products || []
    all.push(...list)
    totalPages = data.pages ?? 1
    page++
  } while (page <= totalPages)
  return all
}

async function clearConversionQueue() {
  if (!confirm('Alle wartenden Konvertierungsjobs aus der Queue entfernen?')) return
  const btn = $('#btnClearQueue')
  if (btn) { btn.disabled = true; btn.style.opacity = '0.6' }
  try {
    const res = await fetch('/__api/clear-queue', { method: 'POST' })
    const data = await parseJsonResponse(res)
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    toast(`Queue geleert: ${data.deleted} Eintr\u00e4ge entfernt`, 'success')
  } catch (e) {
    toast(`Queue leeren fehlgeschlagen: ${e.message}`, 'error')
  } finally {
    if (btn) { btn.disabled = false; btn.style.opacity = '' }
  }
}

function updateConvertSelectedButton() {
  const btn = $('#btnConvertSelected')
  const label = $('#btnConvertSelectedLabel')
  if (btn && label) {
    const n = selectedForConversion.size
    btn.disabled = n === 0
    label.textContent = n > 0 ? `Ausgewählte konvertieren (${n})` : 'Ausgewählte konvertieren'
  }
  updateSelectAllPageButton()
  updateAssignCategoryButton()
}

/** IDs der Produkte auf der aktuellen Seite, die eine Konvertierungs-Checkbox haben (also CAD-Dateien). */
function getSelectablePageIds() {
  return (currentPageProducts || [])
    .filter((p) => Array.isArray(p.cadFiles) && p.cadFiles.length > 0)
    .map((p) => p.id)
}

/** Aktualisiert Label & Zustand des "Seite auswählen"-Buttons. */
function updateSelectAllPageButton() {
  const btn = $('#btnSelectAllPage')
  const label = $('#btnSelectAllPageLabel')
  if (!btn || !label) return
  const ids = getSelectablePageIds()
  const total = ids.length
  btn.disabled = total === 0
  if (total === 0) {
    label.textContent = 'Seite auswählen'
    btn.classList.remove('is-active')
    btn.title = 'Auf dieser Seite gibt es keine Produkte mit CAD-Dateien'
    return
  }
  const selectedOnPage = ids.filter((id) => selectedForConversion.has(id)).length
  const allSelected = selectedOnPage === total
  btn.classList.toggle('is-active', allSelected)
  label.textContent = allSelected
    ? `Seite abwählen (${total})`
    : `Seite auswählen (${total}${selectedOnPage ? ` · ${selectedOnPage} aktiv` : ''})`
  btn.title = allSelected
    ? `Alle ${total} Produkte dieser Seite abwählen`
    : `Alle ${total} Produkte dieser Seite mit CAD für die Konvertierung auswählen`
}

/** Toggle: selektiert bzw. deselektiert alle CAD-Produkte der aktuellen Seite. */
function toggleSelectAllOnPage() {
  const ids = getSelectablePageIds()
  if (ids.length === 0) {
    toast('Auf dieser Seite gibt es keine Produkte mit CAD-Dateien.', 'info')
    return
  }
  const allSelected = ids.every((id) => selectedForConversion.has(id))
  if (allSelected) {
    ids.forEach((id) => selectedForConversion.delete(id))
  } else {
    ids.forEach((id) => selectedForConversion.add(id))
  }
  if (productGrid) {
    productGrid.querySelectorAll('.convert-checkbox').forEach((cb) => {
      cb.checked = selectedForConversion.has(cb.dataset.productId)
    })
  }
  updateConvertSelectedButton()
}

/** Startet nur für die ausgewählten Produkte die Konvertierung (mit Verzögerung). */
async function startSelectedConversions() {
  const ids = Array.from(selectedForConversion)
  if (ids.length === 0) {
    toast('Bitte zuerst Produkte per Checkbox „Auswählen“ markieren.', 'info')
    return
  }
  const btn = $('#btnConvertSelected')
  if (btn) {
    btn.disabled = true
    btn.style.opacity = '0.6'
  }
  try {
    toast(`${ids.length} ausgewählte Produkt(e) werden nacheinander konvertiert …`, 'info')
    for (let i = 0; i < ids.length; i++) {
      await startProductConversion(ids[i])
      selectedForConversion.delete(ids[i])
      if (i < ids.length - 1) await new Promise((r) => setTimeout(r, CONVERT_ALL_DELAY_MS))
    }
    updateConvertSelectedButton()
    productGrid.querySelectorAll('.convert-checkbox').forEach((cb) => {
      cb.checked = selectedForConversion.has(cb.dataset.productId)
    })
    toast(`Konvertierung für ${ids.length} Produkt(e) gestartet – Jobs laufen im Hintergrund.`, 'success')
  } catch (err) {
    toast(`Fehler: ${err.message}`, 'error')
  } finally {
    if (btn) {
      btn.disabled = selectedForConversion.size === 0
      btn.style.opacity = ''
    }
    updateConvertSelectedButton()
  }
}

/** Startet für alle Produkte mit CAD-Dateien nacheinander die Konvertierung (mit Verzögerung). */
async function startAllConversions() {
  const btn = $('#btnConvertAll')
  if (btn) {
    btn.disabled = true
    btn.style.opacity = '0.6'
  }
  try {
    toast('Lade Produktliste …', 'info')
    const all = await fetchAllProducts()
    const withCad = all.filter(p => p.cadFiles?.length)
    if (withCad.length === 0) {
      toast('Keine Produkte mit CAD-Dateien gefunden.', 'info')
      return
    }
    toast(`${withCad.length} Produkt(e) werden nacheinander konvertiert …`, 'info')
    for (let i = 0; i < withCad.length; i++) {
      await startProductConversion(withCad[i].id)
      if (i < withCad.length - 1) {
        await new Promise(r => setTimeout(r, CONVERT_ALL_DELAY_MS))
      }
    }
    toast(`Konvertierung für ${withCad.length} Produkt(e) gestartet – Jobs laufen im Hintergrund.`, 'success')
  } catch (err) {
    toast(`Fehler: ${err.message}`, 'error')
  } finally {
    if (btn) {
      btn.disabled = false
      btn.style.opacity = ''
    }
  }
}

/**
 * Bestimmt die einzubrennende Drehung für eine Konvertierung.
 * Priorität:
 *   1. Header-Dropdown-Override (wenn vom User explizit gesetzt).
 *   2. Aktueller Detail-State, **wenn** das Produkt gerade im Detail-Panel offen ist
 *      (so wirken Reset/+90/-90-Klicks sofort – auch ohne vorher zu "Übernehmen").
 *   3. Gespeicherter `rotationOffset` aus products.json (Migrationspfad).
 *   4. Sonst keine Override → der Konverter wendet seine Standard-Defaults an
 *      (rotateYUp + bakeYUp), die Datei wird so exportiert wie in STEP/OBJ.
 * @param {object} p Produktdatensatz
 * @returns {{ axis: ''|'X'|'Y'|'Z', degrees: ''|'90'|'180'|'270' }}
 */
function resolveBakeRotationForProduct(p) {
  const pickFirstNonZero = (xDeg, yDeg, zDeg) => {
    const candidate = [
      { axis: 'X', deg: Number(xDeg) || 0 },
      { axis: 'Y', deg: Number(yDeg) || 0 },
      { axis: 'Z', deg: Number(zDeg) || 0 },
    ].find((c) => c.deg !== 0)
    if (!candidate) return { axis: '', degrees: '' }
    let d = ((candidate.deg % 360) + 360) % 360
    d = Math.round(d / 90) * 90
    if (d <= 0 || d >= 360) return { axis: '', degrees: '' }
    return { axis: candidate.axis, degrees: String(d) }
  }

  // 1. Header-Override
  const dashAxis = (document.getElementById('dashRotateAxis')?.value || '').trim()
  const dashDegrees = (document.getElementById('dashRotateDegrees')?.value || '').trim()
  if ((dashAxis === 'X' || dashAxis === 'Y' || dashAxis === 'Z') && ['90', '180', '270'].includes(dashDegrees)) {
    return { axis: dashAxis, degrees: dashDegrees }
  }
  // 2. Aktueller Detail-State (nur für das aktuell offene Produkt)
  if (p?.id && selectedProductId === p.id) {
    const r = detailRotationOffsetDeg
    return pickFirstNonZero(r.x, r.y, r.z) // bei Reset → { axis:'', degrees:'' } → keine Override
  }
  // 3. Gespeicherter rotationOffset
  const ro = p?.rotationOffset
  if (!ro) return { axis: '', degrees: '' }
  return pickFirstNonZero(ro.x, ro.y, ro.z)
}

async function startProductConversion(productId) {
  const p = await fetchProductById(productId)
  if (!p) return

  const btns = document.querySelectorAll(`[data-product-id="${productId}"]`)
  btns.forEach(b => { b.disabled = true; b.style.opacity = '.5' })

  try {
    toast(`Konvertierung wird gestartet für „${p.name}" …`, 'info')
    const payload = { productId }
    if (usesProductDefaultSurfaceColor(p)) {
      payload.defaultColorHex = ColorService.ralToHex(resolveEffectiveDefaultColorOrFallback(p))
    }
    const rawPreset =
      p.conversionPreset && typeof p.conversionPreset === 'object' && !Array.isArray(p.conversionPreset)
        ? p.conversionPreset
        : {}
    // Drehungs-Felder aus dem Preset filtern, damit weder ein alter rotateAxis/rotateDegrees-Wert
    // beim Reset durchschlägt, noch eine ungültige Kombination (Joi-Validation lehnt leere
    // Strings ab → siehe api-gateway/middleware/validation.js Z. 25–26).
    const preset = { ...rawPreset }
    delete preset.rotateAxis
    delete preset.rotateDegrees
    delete preset.rotateYUp
    delete preset.bakeYUp

    const localOverrides = {}
    const { axis: bakeAxis, degrees: bakeDegrees } = resolveBakeRotationForProduct(p)
    if (bakeAxis && bakeDegrees) {
      // Blender-Konvention: rotateAxis und rotateYUp sind mutually exclusive
      // (siehe blender-mcp-converter/convert_to_glb.py Z. 2743). Mit rotateYUp=false
      // macht der GLTF-Exporter trotzdem export_yup=True → die GLB bleibt Y-up.
      localOverrides.rotateAxis = bakeAxis
      localOverrides.rotateDegrees = bakeDegrees
      localOverrides.rotateYUp = 'false'
      // bakeYUp aktiv lassen: der nachgelagerte Vertex-Bake (siehe
      // api-gateway/services/conversionService.js Z. 1418) schreibt die finale
      // Root-Rotation in die Vertex-Daten, damit Babylon.js die GLB als echtes
      // Y-up ohne Restrotation rendert.
      localOverrides.bakeYUp = 'true'
    } else {
      // Reset-Pfad: keine manuelle Rotation → Standard-Y-up-Konvertierung greift, die
      // Datei wird so exportiert wie in STEP/OBJ. Server-Default ist rotateYUp=true,
      // bakeYUp wird im Dashboard-Default-Set ohnehin auf 'true' gesetzt
      // (scripts/vite-plugin/dashboardApi.mjs Z. 1940).
      localOverrides.rotateYUp = 'true'
      localOverrides.bakeYUp = 'true'
    }
    const usedOptions = { ...preset, ...localOverrides }
    usedOptions.exportUsdz = exportUsdzEnabled ? 'true' : 'false'
    payload.options = usedOptions
    const res = await fetch('/__api/convert-product', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    let data = {}
    try {
      data = await parseJsonResponse(res)
    } catch (parseErr) {
      throw new Error(res.ok ? parseErr.message : `Konvertierung: ${parseErr.message}`)
    }
    const jobId = data.jobId ?? data.job_id ?? data.id
    if (!res.ok || !jobId) throw new Error(data.error || data.message || 'Kein Job-ID erhalten')

    toast(`Konvertierung läuft im Hintergrund – Sie können weiterarbeiten.`, 'success')
    btns.forEach(b => { b.disabled = false; b.style.opacity = '' })

    pollConversionInBackground(jobId, productId, p.name, usedOptions)
  } catch (err) {
    toast(`Fehler: ${err.message}`, 'error')
    btns.forEach(b => { b.disabled = false; b.style.opacity = '' })
  }
}

async function pollConversionInBackground(jobId, productId, productName, conversionPresetUsed) {
  dashConvRegister(jobId, productName)
  let count = 0
  const poll = async () => {
    count++
    if (count > CONVERT_POLL_MAX) {
      toast(`Konvertierung für „${productName}" läuft noch – Status im Converter prüfen.`, 'info')
      dashConvUnregister(jobId, 'aborted')
      return true
    }
    try {
      const res = await fetch(`/api/v1/status/${jobId}`)
      if (!res.ok) return
      let data = {}
      try {
        data = await parseJsonResponse(res)
      } catch (_) {
        return
      }
      const status = data.status

      if (status === 'completed' || status === 'partially_completed') {
        const outputPaths = Array.isArray(data.outputPaths) && data.outputPaths.length
          ? data.outputPaths
          : (data.outputPath ? [data.outputPath] : [])
        const partial = status === 'partially_completed'
        if (outputPaths.length) {
          const regBody = { outputPaths, productId }
          if (
            conversionPresetUsed &&
            typeof conversionPresetUsed === 'object' &&
            !Array.isArray(conversionPresetUsed) &&
            Object.keys(conversionPresetUsed).length
          ) {
            regBody.conversionPreset = conversionPresetUsed
          }
          const regRes = await fetch('/__api/register-converted', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(regBody),
          })
          let regData = {}
          try {
            regData = await parseJsonResponse(regRes)
          } catch (_) {
            regData = {}
          }
          if (regData.ok) {
            // Nach erfolgreicher Konvertierung ist die GLB jetzt die "Wahrheit" – egal ob mit
            // gebackener Drehung oder ohne. Den Live-Offset (rotationOffset) immer löschen,
            // damit Showroom/Detail/Maße keine alte Korrektur mehr obendrauf legen.
            try {
              await patchProduct(productId, { rotationOffset: null })
            } catch (e) {
              log.scoped('Dashboard').warn('rotationOffset konnte nach Konvertierung nicht zurückgesetzt werden:', e)
            }
            // Maße werden serverseitig in register-converted gesetzt; bei offenem Detail-Panel
            // Detail-State + Header zurücksetzen und das Preview mit der frischen GLB neu laden.
            if (productId && selectedProductId === productId) {
              try {
                const pr = await fetch(`/__api/products/${encodeURIComponent(productId)}`)
                if (pr.ok) {
                  const fresh = await parseJsonResponse(pr)
                  if (fresh?.specs) updateDimensionsUi(fresh)
                  if (fresh) {
                    detailRotationOffsetDeg = { x: 0, y: 0, z: 0 }
                    lastBakeAxis = ''
                    updateDetailRotationLabels()
                    syncRotationHeaderFromState()
                    // Cache-Buster anhängen, damit der Browser die NEUE GLB lädt und nicht die alte
                    // aus dem Cache – sonst sieht es so aus, als hätte die Konvertierung nichts bewirkt.
                    const reloadProduct = fresh.glbFile
                      ? { ...fresh, glbFile: `${fresh.glbFile}${fresh.glbFile.includes('?') ? '&' : '?'}t=${Date.now()}` }
                      : fresh
                    loadDetailPreview(reloadProduct)
                  }
                }
              } catch (_) {}
            }
            const w = Array.isArray(regData.warnings) ? regData.warnings : []
            if (w.length) {
              const first = w[0]
              let hint
              if (first?.reason === 'glb-not-found') {
                const absHint = first?.absPath ? ` (Konverter meldete: ${first.absPath})` : ''
                hint = `GLB fehlt unter public${first?.expected || ''}${absHint} – Blender-Pipeline prüfen; vorherige Vorschau bleibt erhalten.`
              } else if (first?.reason === 'invalid-path') {
                hint = `Ungültiger Dateipfad (${first?.expected || 'unbekannt'}) – Registrierung übersprungen.`
              } else {
                hint = first?.message || first?.reason || 'Registrierung mit Hinweisen abgeschlossen.'
              }
              toast(`Konvertierung abgeschlossen: „${productName}" – ${hint}`, 'warning', 8000)
            } else {
              toast(`Konvertierung abgeschlossen: „${productName}" – GLB/USDZ in der Übersicht.`, 'success')
            }
            fetchPage()
          } else {
            toast(`Konvertierung fertig, Registrierung fehlgeschlagen: ${regData.error || 'Unbekannt'}`, 'error')
          }
        } else {
          toast(`Konvertierung abgeschlossen: „${productName}" (keine Ausgabedateien).`, 'info')
        }
        notifyDashConvDone(jobId, partial ? 'partial' : 'ok', productName, outputPaths)
        dashConvUnregister(jobId, 'ok', { partial })
        return true
      }
      if (status === 'failed') {
        const errMsg = data.error || data.message || 'Unbekannter Fehler'
        log.scoped('Dashboard').error('Konvertierung fehlgeschlagen (Konverter/MCP)', {
          jobId,
          productId,
          productName,
          error: errMsg,
          status: data.status,
          progress: data.progress,
          outputPaths: data.outputPaths,
          outputPath: data.outputPath,
          logs: data.logs,
          log: data.log,
          detail: data.detail,
          stderr: data.stderr,
          stdout: data.stdout,
        })
        // Die Status-API liefert hier meist keine logs/stderr — Ursache steht im MCP-/API-Terminal.
        const prog = data.progress != null ? String(data.progress) : ''
        log.scoped('Dashboard').warn(
          'Diagnose (Konverter liefert keine Blender-Logs in dieser Antwort):',
          '\n· Parallel das Terminal prüfen, in dem `npm run start:mcp` und die API (Port 3000) laufen — dort steht die eigentliche Blender-/Python-Meldung.',
          '\n· Häufig: BLENDER_PATH / Blender-Version, BLENDER_OUTPUT_DIR nicht beschreibbar oder voll, sehr lange Pfade (z. B. externe Festplatte), STEP-Import in Blender schlägt vor dem GLB-Export fehl.',
          prog ? `\n· Zuletzt gemeldeter Fortschritt: ${prog}% — bei hohem Wert oft die Export-/Schreibphase der GLB.` : '',
        )
        if (/Output file was not created|MCP server error/i.test(errMsg)) {
          log.scoped('Dashboard').warn(
            'Dieser Fehlertext kommt vom MCP/Blender-Stack (nicht vom Showroom). ' +
              'Ohne Erweiterung der Konverter-API bleiben stderr/Logs nur im Server-Terminal sichtbar.',
          )
        }
        toast(`Konvertierung fehlgeschlagen: „${productName}" – ${errMsg}`, 'error')
        notifyDashConvDone(jobId, 'fail', productName, [], errMsg)
        dashConvUnregister(jobId, 'fail')
        return true
      }
    } catch (_) {}
    return false
  }

  const run = async () => {
    const done = await poll()
    if (!done) setTimeout(run, CONVERT_POLL_INTERVAL)
  }
  setTimeout(run, CONVERT_POLL_INTERVAL)
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
function toast(msg, type = 'info', duration = 3000) {
  const el = document.createElement('div')
  el.className = `toast toast-${type}`
  el.textContent = msg
  toastContainer.appendChild(el)
  const ms = Number.isFinite(duration) && duration > 0 ? duration : 3000
  setTimeout(() => {
    el.classList.add('removing')
    setTimeout(() => el.remove(), 200)
  }, ms)
}

/**
 * Toast mit "Rückgängig"-Aktion (z. B. für Löschen). `onUndo` wird beim Klick
 * aufgerufen und der Toast sofort entfernt; ohne Klick verschwindet er nach `duration`.
 * @returns {() => void} Schließt den Toast programmatisch (z. B. wenn das Zeitfenster anderweitig endet).
 */
function undoToast(msg, onUndo, duration = 6000) {
  const el = document.createElement('div')
  el.className = 'toast toast-info'
  const label = document.createElement('span')
  label.textContent = msg
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'toast-undo-btn'
  btn.textContent = 'Rückgängig'
  el.append(label, btn)
  toastContainer.appendChild(el)

  const remove = () => {
    el.classList.add('removing')
    setTimeout(() => el.remove(), 200)
  }
  const timeoutId = setTimeout(remove, duration)
  btn.addEventListener('click', () => {
    clearTimeout(timeoutId)
    onUndo()
    remove()
  })
  return remove
}

/* esc, formatDate: ./modules/helpers.js */

/* ═══════════════════════════════════════════════
   Boot
   ═══════════════════════════════════════════════ */
init()
