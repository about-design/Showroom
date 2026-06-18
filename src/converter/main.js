import '../lib/loggerInit.js'
import { createLogger } from '../lib/logger.js'
const log = createLogger('converter')

import './converter.css'
import ColorService from '../services/ColorService.js'
import { usesProductDefaultSurfaceColor } from '../lib/defaultColorMapping.js'
import { resolveEffectiveDefaultColorOrFallback } from '../lib/defaultColorMapping.js'
import { buildColorOverridesFromMapping } from '../lib/hexMapping.js'
import { parseJsonResponse, parseApiResponse, escapeHtml, fmtSize } from './modules/helpers.js'
import { API_BASE, ACCEPT_EXT, MONITOR_JOB, PRODUCT_ID } from './modules/constants.js'
import { $, $$ } from './modules/dom.js'
import { checkHealth, checkAiHealth } from './modules/apiHealth.js'
import { loadGtinConfig, bindGtinSection } from './modules/gtin.js'

let selectedFiles = []
let jobsCache = []
let currentJobId = null
let pollInterval = null
let jobsFilterStatus = 'all'

/** Cache für Produktdaten (lazy geladen, vermeidet 500 bei großem products.json). */
let _productsData = null

/**
 * Liefert die Hex-Farbe der Produkt-Standard-Farbe (defaultColor), wenn productId in der URL steht.
 * Prefill, wenn in products.json eine Standardfarbe gesetzt ist (oder Automatik-Mapping).
 */
async function getProductDefaultHex() {
  if (!PRODUCT_ID) return null
  try {
    if (!_productsData) {
      _productsData = (await import('../data/products.json')).default
    }
    const product = (_productsData?.products || []).find((p) => p.id === PRODUCT_ID)
    if (!usesProductDefaultSurfaceColor(product)) return null
    const ralCode = resolveEffectiveDefaultColorOrFallback(product)
    if (!ralCode || !ColorService.getRAL(ralCode)) return null
    return ColorService.ralToHex(ralCode)
  } catch (_) {
    return null
  }
}

function getOption(id) {
  const el = $(id)
  if (!el) return null
  if (el.type === 'checkbox') return el.checked
  if (el.type === 'number') return parseFloat(el.value) || 0.1
  return el.value
}

function setOption(id, value) {
  const el = $(id)
  if (!el) return
  if (el.type === 'checkbox') el.checked = !!value
  else el.value = value
}

/** Material-Slider: aus Preflight-Modal, sonst aus zuletzt angewendetem `conversionPreset` (productId). */
let prefillSliderOverrides = null

function getMaterialSliders() {
  const pfS = $('pfSaturation')
  if (pfS) {
    return {
      colorSaturation: String($('pfSaturation')?.value || '1'),
      colorBrightness: String($('pfBrightness')?.value || '1'),
      roughnessMultiplier: String($('pfRoughness')?.value || '1'),
      metallicMultiplier: String($('pfMetallic')?.value || '1'),
    }
  }
  if (prefillSliderOverrides) return { ...prefillSliderOverrides }
  return {
    colorSaturation: '1',
    colorBrightness: '1',
    roughnessMultiplier: '1',
    metallicMultiplier: '1',
  }
}

function setCheckboxFromPreset(id, val) {
  if (val == null || val === '') return
  const el = $(id)
  if (!el || el.type !== 'checkbox') return
  el.checked = val === true || val === 'true'
}

/**
 * Wendet gespeichertes conversionPreset auf Formular + Mapping an (GET /__api/products/:id).
 */
function applyConversionPresetToForm(preset) {
  if (!preset || typeof preset !== 'object' || Array.isArray(preset)) return
  prefillSliderOverrides = null

  if (preset.outputFormat) setOption('optFormat', preset.outputFormat)
  if (preset.scale != null && preset.scale !== '') setOption('optScale', String(preset.scale))
  if (preset.importUpAxis) setOption('optUpAxis', preset.importUpAxis)
  if (preset.tessellationQuality != null && preset.tessellationQuality !== '') {
    setOption('optTessellation', String(preset.tessellationQuality))
  }
  if (preset.decimateRatio != null && preset.decimateRatio !== '') {
    setOption('optDecimate', String(preset.decimateRatio))
  }

  if (preset.bakeYUp === 'true' || preset.bakeYUp === true) setOption('optBakeYUp', true)
  else if (preset.bakeYUp === 'false' || preset.bakeYUp === false) setOption('optBakeYUp', false)

  const ax = (preset.rotateAxis || '').trim()
  if (ax === 'X' || ax === 'Y' || ax === 'Z') {
    setOption('optBakeYUp', false)
    setOption('optRotateAxis', ax)
    const d = String(preset.rotateDegrees || '90')
    if (['90', '180', '270'].includes(d)) setOption('optRotateDegrees', d)
  }

  setCheckboxFromPreset('optDraco', preset.useDraco)
  setCheckboxFromPreset('optEmbedTextures', preset.embedTextures)
  setCheckboxFromPreset('optStripLights', preset.stripCamerasLights)
  setCheckboxFromPreset('optOverwrite', preset.overwriteExisting)
  setCheckboxFromPreset('optAutoLabel', preset.autoLabelParts)
  setCheckboxFromPreset('optClaudeAI', preset.useClaudeAI)
  setCheckboxFromPreset('optUseGtin', preset.useGTINNaming)
  setCheckboxFromPreset('optSkipPreflight', preset.skipPreflight)
  setCheckboxFromPreset('optKeepOriginalColors', preset.keepOriginalColors)

  if (preset.materialFinish) setOption('optMaterialFinish', preset.materialFinish)
  if (preset.batchChunkSize != null && preset.batchChunkSize !== '') {
    setOption('optBatchChunk', String(preset.batchChunkSize))
  }
  if (preset.gtin != null && preset.gtin !== '') setOption('optGtin', String(preset.gtin))
  if (preset.articleNumber != null && preset.articleNumber !== '') {
    setOption('optArticleNumber', String(preset.articleNumber))
  }

  if (
    preset.colorSaturation != null ||
    preset.colorBrightness != null ||
    preset.roughnessMultiplier != null ||
    preset.metallicMultiplier != null
  ) {
    prefillSliderOverrides = {
      colorSaturation: String(preset.colorSaturation ?? '1'),
      colorBrightness: String(preset.colorBrightness ?? '1'),
      roughnessMultiplier: String(preset.roughnessMultiplier ?? '1'),
      metallicMultiplier: String(preset.metallicMultiplier ?? '1'),
    }
  }

  if (preset.colorOverrides && typeof preset.colorOverrides === 'object' && !Array.isArray(preset.colorOverrides)) {
    const n = Object.keys(preset.colorOverrides).length
    if (n > 0) {
      const base = loadedColorMapping?.colorOverrides || {}
      loadedColorMapping = {
        ...(loadedColorMapping || {}),
        colorOverrides: { ...base, ...preset.colorOverrides },
      }
      setColorMappingStatus(`Projekt + Preset: ${Object.keys(loadedColorMapping.colorOverrides).length} Farben`, true)
    }
  }

  $('optBakeYUp')?.dispatchEvent(new Event('change'))
  $('optRotateAxis')?.dispatchEvent(new Event('change'))
}

/** Optionen für products.json – Stand zum Start der Konvertierung (submit / Ordner-Konvertierung). */
let lastSubmittedConversionPreset = null

function buildConversionPresetForRegister() {
  const ms = getMaterialSliders()
  const ed = collectPreflightEdits()
  const preset = {
    colorSaturation: ms.colorSaturation,
    colorBrightness: ms.colorBrightness,
    roughnessMultiplier: ms.roughnessMultiplier,
    metallicMultiplier: ms.metallicMultiplier,
    materialFinishVerzinktMetallic: ed.materialFinishVerzinktMetallic,
    materialFinishVerzinktRoughness: ed.materialFinishVerzinktRoughness,
    materialFinishRalMetallic: ed.materialFinishRalMetallic,
    materialFinishRalRoughness: ed.materialFinishRalRoughness,
    outputFormat: ed.outputFormat,
    scale: ed.scale,
    importUpAxis: ed.importUpAxis,
    tessellationQuality: ed.tessellationQuality,
    decimateRatio: ed.decimateRatio,
    bakeYUp: ed.bakeYUp,
    useDraco: ed.useDraco,
    embedTextures: ed.embedTextures,
    stripCamerasLights: ed.stripCamerasLights,
    overwriteExisting: ed.overwriteExisting,
    materialFinish: ed.materialFinish,
    autoLabelParts: ed.autoLabelParts,
    useClaudeAI: ed.useClaudeAI,
    useGTINNaming: ed.useGTINNaming,
    batchChunkSize: ed.batchChunkSize,
    skipPreflight: getOption('optSkipPreflight') ? 'true' : 'false',
    keepOriginalColors: getOption('optKeepOriginalColors') ? 'true' : 'false',
  }
  const ra = (ed.rotateAxis || '').trim()
  if (ra === 'X' || ra === 'Y' || ra === 'Z') {
    preset.rotateAxis = ra
    const rd = String(ed.rotateDegrees || '').trim()
    if (['90', '180', '270'].includes(rd)) preset.rotateDegrees = rd
  }
  if (ed.gtin) preset.gtin = ed.gtin
  if (ed.articleNumber) preset.articleNumber = ed.articleNumber

  let co = {}
  if (!getOption('optKeepOriginalColors')) {
    if (ed.colorOverrides) {
      try {
        const parsed = JSON.parse(ed.colorOverrides)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) co = { ...parsed }
      } catch (_) {}
    }
    if (!Object.keys(co).length && loadedColorMapping?.colorOverrides) {
      co = { ...loadedColorMapping.colorOverrides }
    }
  }
  if (Object.keys(co).length) preset.colorOverrides = co

  Object.keys(preset).forEach((k) => {
    if (preset[k] === undefined) delete preset[k]
  })
  return preset
}

/* ═══════════════════════════════════════════════
   Upload: drag & drop, file list
   ═══════════════════════════════════════════════ */
function acceptFile(file) {
  const name = (file.name || '').toLowerCase()
  if (ACCEPT_EXT.some((ext) => name.endsWith(ext))) return true
  if (file.name?.toLowerCase().endsWith('.zip')) return true
  return false
}

function addFiles(files) {
  const added = Array.from(files).filter(acceptFile)
  selectedFiles = [...selectedFiles, ...added]
  renderFileList()
  const wrap = $('fileListWrap')
  const drop = $('uploadDrop')
  if (wrap && drop) {
    wrap.hidden = selectedFiles.length === 0
    if (selectedFiles.length > 0) drop.classList.add('has-files')
  }
  $('btnStartConvert').disabled = selectedFiles.length === 0
}

function clearFiles() {
  selectedFiles = []
  renderFileList()
  $('fileListWrap').hidden = true
  $('uploadDrop').classList.remove('has-files')
  $('btnStartConvert').disabled = true
}

function renderFileList() {
  const ul = $('fileList')
  if (!ul) return
  ul.innerHTML = selectedFiles
    .map(
      (f) =>
        `<li><span>${escapeHtml(f.name)}</span><span>${fmtSize(f.size)}</span></li>`
    )
    .join('')
}

function hasStepLikeInput(files) {
  return (files || []).some((f) => {
    const name = typeof f === 'string' ? f : f?.name
    return /\.(step|stp|p21)$/i.test(String(name || ''))
  })
}

function bindUpload() {
  const drop = $('uploadDrop')
  const input = $('fileInput')
  const btnClear = $('btnClearFiles')
  const btnStart = $('btnStartConvert')

  if (drop) {
    drop.addEventListener('click', () => input?.click())
    drop.addEventListener('dragover', (e) => {
      e.preventDefault()
      drop.classList.add('drag-over')
    })
    drop.addEventListener('dragleave', () => drop.classList.remove('drag-over'))
    drop.addEventListener('drop', (e) => {
      e.preventDefault()
      drop.classList.remove('drag-over')
      addFiles(e.dataTransfer.files)
    })
  }
  if (input) input.addEventListener('change', (e) => addFiles(e.target.files || []))
  if (btnClear) btnClear.addEventListener('click', clearFiles)
  if (btnStart) btnStart.addEventListener('click', startConversion)
}

/* ═══════════════════════════════════════════════
   Conversion: API call, progress, download
   ═══════════════════════════════════════════════ */
function buildFormData(extraFiles) {
  const form = new FormData()
  const filesForRequest = extraFiles || selectedFiles
  ;filesForRequest.forEach((f) => form.append('files', f))
  const disableExcelNamingForStep = hasStepLikeInput(filesForRequest)

  form.append('outputFormat',       getOption('optFormat') || 'glb')
  form.append('scale',              String(getOption('optScale') || '0.001'))
  form.append('importUpAxis',       getOption('optUpAxis') || 'AUTO')
  form.append('tessellationQuality',String(getOption('optTessellation') || '0.1'))
  form.append('decimateRatio',      String(getOption('optDecimate') || '1.0'))
  form.append('bakeYUp',            getOption('optBakeYUp') ? 'true' : 'false')
  const rotateAxis = (getOption('optRotateAxis') || '').trim()
  const rotateDegrees = (getOption('optRotateDegrees') || '').trim()
  if (rotateAxis === 'X' || rotateAxis === 'Y' || rotateAxis === 'Z') {
    form.append('rotateAxis', rotateAxis)
    if (['90', '180', '270'].includes(rotateDegrees)) form.append('rotateDegrees', rotateDegrees)
  }
  form.append('useDraco',           getOption('optDraco') ? 'true' : 'false')
  form.append('embedTextures',      getOption('optEmbedTextures') ? 'true' : 'false')
  form.append('stripCamerasLights', getOption('optStripLights') ? 'true' : 'false')
  form.append('overwriteExisting',  getOption('optOverwrite') ? 'true' : 'false')
  form.append('materialFinish',     getOption('optMaterialFinish') || 'auto')
  form.append('autoLabelParts',     getOption('optAutoLabel') ? 'true' : 'false')
  form.append('useClaudeAI',        getOption('optClaudeAI') ? 'true' : 'false')
  form.append('useGTINNaming',      getOption('optUseGtin') && !disableExcelNamingForStep ? 'true' : 'false')
  form.append('batchChunkSize',     String(getOption('optBatchChunk') || '20'))

  const ms = getMaterialSliders()
  form.append('colorSaturation',     ms.colorSaturation)
  form.append('colorBrightness',     ms.colorBrightness)
  form.append('roughnessMultiplier', ms.roughnessMultiplier)
  form.append('metallicMultiplier',  ms.metallicMultiplier)
  form.append('materialFinishVerzinktMetallic',  '0.75')
  form.append('materialFinishVerzinktRoughness', '0.25')
  form.append('materialFinishRalMetallic',  '0')
  form.append('materialFinishRalRoughness', '0.35')

  const gtin          = (getOption('optGtin') || '').trim()
  const articleNumber = (getOption('optArticleNumber') || '').trim()
  if (gtin)          form.append('gtin', gtin)
  if (articleNumber) form.append('articleNumber', articleNumber)

  const keepOriginalColors = getOption('optKeepOriginalColors')
  if (!keepOriginalColors && loadedColorMapping?.colorOverrides && Object.keys(loadedColorMapping.colorOverrides).length) {
    form.append('colorOverrides', JSON.stringify(loadedColorMapping.colorOverrides))
  }

  return form
}

function showProgress(text) {
  const wrap = $('jobProgressWrap')
  if (wrap) wrap.hidden = false
  const s = $('progressStatus')
  if (s) s.textContent = text
  const f = $('progressFill')
  if (f) f.style.width = '5%'
  const l = $('progressLog')
  if (l) l.textContent = ''
  const b = $('btnDownloadResult')
  if (b) { b.hidden = true; b.innerHTML = 'GLB herunterladen' }
}

/* ─── Farb-Mapping (MTL → RAL aus Colormatching-Tool) ─── */
let loadedColorMapping = null  // { colorOverrides: { "#HEX": "#HEX", ... }, matchRal?: {...} }

/**
 * Baut colorOverrides aus Mapping-JSON (shared mit Vite convert-product).
 */
function loadColorMappingFromJson(data) {
  const getRalHex = (ralKey) => ColorService.getRAL(ralKey)?.hex ?? null
  const colorOverrides = buildColorOverridesFromMapping(data, getRalHex)
  return { colorOverrides, matchRal: data.matchRal || null }
}

const PROJECT_MAPPING_URL = '/mtl-ral-color-mapping.json'

async function loadProjectColorMapping() {
  const status = $('colorMappingStatus')
  try {
    const res = await fetch(PROJECT_MAPPING_URL)
    if (!res.ok) return
    const data = await res.json()
    const mapping = loadColorMappingFromJson(data)
    const n = Object.keys(mapping.colorOverrides).length
    if (n > 0) {
      const prevCo = loadedColorMapping?.colorOverrides
      if (prevCo && Object.keys(prevCo).length) {
        loadedColorMapping = {
          ...mapping,
          colorOverrides: { ...mapping.colorOverrides, ...prevCo },
        }
      } else {
        loadedColorMapping = mapping
      }
      const total = Object.keys(loadedColorMapping.colorOverrides).length
      if (status) {
        status.textContent = `Projekt-Mapping: ${total} Farben`
        status.className = 'color-mapping-status ok'
      }
    }
  } catch (_) {
    // Kein Projekt-Mapping oder ungültig – kein Fehler anzeigen
  }
}

function setColorMappingStatus(text, isOk = true) {
  const status = $('colorMappingStatus')
  if (status) {
    status.textContent = text || ''
    status.className = text ? `color-mapping-status ${isOk ? 'ok' : ''}` : 'color-mapping-status'
  }
}

function bindColorMapping() {
  const fileInput = $('colorMappingFile')
  const btn = $('btnLoadColorMapping')
  const status = $('colorMappingStatus')
  if (!btn || !fileInput) return
  btn.addEventListener('click', () => fileInput.click())
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0]
    if (!f) return
    const r = new FileReader()
    r.onload = async () => {
      try {
        const data = JSON.parse(r.result)
        loadedColorMapping = loadColorMappingFromJson(data)
        const n = Object.keys(loadedColorMapping.colorOverrides).length
        setColorMappingStatus(n ? `${n} Farben (geladen)` : 'Keine Zuordnungen', !!n)
        if (n === 0) loadedColorMapping = null
      } catch (e) {
        loadedColorMapping = null
        setColorMappingStatus('Ungültige JSON', false)
      }
    }
    r.readAsText(f)
  })
}

/* ─── Preflight + Color-Mapping ─── */
let preflightData = null  // stores preflight result for confirm step

async function startConversion() {
  if (selectedFiles.length === 0) return
  const skipPreflight = getOption('optSkipPreflight')
  const usePreflight = !skipPreflight && selectedFiles.length <= 10  // skip for large batches or if option set

  showProgress(usePreflight ? 'Preflight-Analyse läuft …' : 'Konvertierung wird gestartet …')
  const fallbackEl = $('progressPreflightFallback')
  if (fallbackEl) fallbackEl.hidden = true

  try {
    const form = buildFormData()
    form.set('enablePreflight', usePreflight ? 'true' : 'false')

    if (usePreflight) {
      // Step 1: preflight analysis
      const res = await fetch(`${API_BASE}/api/v1/preflight`, { method: 'POST', body: form })
      const data = await parseApiResponse(res)
      preflightData = data
      await openPreflightModal(data)
    } else {
      // Direct conversion for large batches or "skip preflight" option
      await submitConversion(form)
    }
  } catch (err) {
    const s = $('progressStatus')
    const l = $('progressLog')
    const msg = err.message || 'Unbekannt'
    if (s) s.textContent = 'Fehler: ' + msg
    let logText = err.stack || msg
    if (/failed to run preflight|failed to fetch|network error|connection refused|ECONNREFUSED/i.test(msg)) {
      logText += '\n\nHinweis: Läuft die Konverter-API? (z. B. npm run start:api und npm run start:mcp im Projektordner.)'
    }
    if (/exit code 1|no objects found|step conversion|freecad|generic_error/i.test(msg)) {
      logText += '\n\nHinweis STEP: Die Datei enthält vermutlich keine importierbare 3D-Geometrie. Bitte echte CAD-Datei (Solid) verwenden — nicht den Demo-Platzhalter test_cube.step. OBJ/ZIP mit Mesh funktionieren.'
    }
    // Bei Preflight-Fehler: Button zum direkten Konvertieren anbieten (wenn Preflight versucht wurde)
    if (usePreflight && fallbackEl && selectedFiles.length > 0) {
      fallbackEl.hidden = false
      const btn = $('btnConvertWithoutPreflight')
      if (btn && !btn.dataset.bound) {
        btn.dataset.bound = '1'
        btn.addEventListener('click', async () => {
          fallbackEl.hidden = true
          if (s) s.textContent = 'Konvertierung wird gestartet …'
          if (l) l.textContent = ''
          try {
            const formDirect = buildFormData()
            formDirect.set('enablePreflight', 'false')
            await submitConversion(formDirect)
          } catch (e) {
            if (s) s.textContent = 'Fehler: ' + (e.message || 'Unbekannt')
            if (l) l.textContent = e.stack || e.message
          }
        })
      }
    }
    if (l) l.textContent = logText
  }
}

async function submitConversion(formOrJobId) {
  lastSubmittedConversionPreset = buildConversionPresetForRegister()
  let jobId
  if (typeof formOrJobId === 'string') {
    // Confirm existing preflight job
    const opts = collectPreflightEdits()
    const res = await fetch(`${API_BASE}/api/v1/convert/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: formOrJobId, ...opts }),
    })
    const data = await parseJsonResponse(res)
    if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`)
    jobId = data.jobId || formOrJobId
  } else {
    const res = await fetch(`${API_BASE}/api/v1/convert`, { method: 'POST', body: formOrJobId })
    const data = await parseJsonResponse(res)
    if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`)
    jobId = data.jobId
  }
  if (jobId) {
    currentJobId = jobId
    jobsCache.unshift({ jobId, status: 'queued' })
    renderJobs()
    pollJobProgress(jobId)
    void ensureNotificationPermission()
    setConvIndicator('running')
  }
}

/* ─── Preflight Modal ─── */
function rgbToHex(rgb) {
  if (!rgb || !Array.isArray(rgb) || rgb.length < 3) return '#888888'
  return ColorService.rgbToHex(rgb[0], rgb[1], rgb[2])
}

async function openPreflightModal(data) {
  const pf = data.preflight || {}
  const summary = pf.summary || {}

  const meshCount = summary.totalObjects ?? pf.meshCount ?? pf.mesh_count ?? '?'
  const matCount = summary.totalMaterials ?? pf.materialCount ?? pf.material_count ?? '?'
  const warnings = pf.warnings || []
  const jobId = data.jobId

  // Build color list from colorUsage (preferred), materials, or legacy uniqueColors/colors; ensure each has r255,g255,b255 for auto-match
  let colors = pf.uniqueColors || pf.colors || []
  if (!colors.length && pf.colorUsage?.length) {
    colors = pf.colorUsage.map((cu, i) => {
      const rgb = cu.rgb || [0.5, 0.5, 0.5]
      const r255 = Math.round(Math.max(0, Math.min(1, Number(rgb[0]))) * 255)
      const g255 = Math.round(Math.max(0, Math.min(1, Number(rgb[1]))) * 255)
      const b255 = Math.round(Math.max(0, Math.min(1, Number(rgb[2]))) * 255)
      return {
        hex: rgbToHex(cu.rgb),
        r255, g255, b255,
        name: cu.materials?.[0] || `Farbe ${i + 1}`,
        objects: cu.objects || [],
      }
    })
  } else if (!colors.length && pf.materials?.length) {
    const seen = new Set()
    for (const m of pf.materials) {
      if (m.baseColor && !m.baseColorLinked) {
        const hex = rgbToHex(m.baseColor)
        if (!seen.has(hex)) {
          seen.add(hex)
          const bc = m.baseColor
          const r255 = Math.round((bc[0] ?? 0.5) * 255)
          const g255 = Math.round((bc[1] ?? 0.5) * 255)
          const b255 = Math.round((bc[2] ?? 0.5) * 255)
          colors.push({ hex, name: m.name, r255, g255, b255 })
        }
      }
    }
  } else {
    colors = colors.map((c) => {
      const hex = c.hex || c.color || (typeof c === 'string' ? c : rgbToHex(c.rgb || c))
      let r255 = c.r255 ?? c.r
      let g255 = c.g255 ?? c.g
      let b255 = c.b255 ?? c.b
      if (typeof r255 !== 'number' || typeof g255 !== 'number' || typeof b255 !== 'number') {
        const rgb = ColorService.hexToRgb(hex)
        if (rgb) {
          r255 = rgb.r
          g255 = rgb.g
          b255 = rgb.b
        } else {
          r255 = 128
          g255 = 128
          b255 = 128
        }
      }
      return { ...c, hex, r255, g255, b255 }
    })
  }

  const keepOriginalColors = getOption('optKeepOriginalColors')
  const autoColorMatch = localStorage.getItem('converter_autoColorMatch') !== 'false'
  const applyProductDefaultFirstRow = localStorage.getItem('converter_preflightProductDefaultFirstRow') !== 'false'
  const productDefaultHex = await getProductDefaultHex()
  let colorRows = ''
  if (colors.length) {
    colorRows = colors.slice(0, 40).map((c, i) => {
      const hex = c.hex || c.color || (typeof c === 'string' ? c : rgbToHex(c.rgb || c))
      const name = c.name || c.materialName || `Farbe ${i+1}`
      const objHint = c.objects?.length ? ` (${c.objects.length} Objekte)` : ''
      let initialHex = hex
      if (!keepOriginalColors) {
        if (loadedColorMapping?.colorOverrides) {
          const normalized = ColorService.normalizeHex(hex)
          if (loadedColorMapping.colorOverrides[normalized]) initialHex = loadedColorMapping.colorOverrides[normalized]
        } else if (autoColorMatch && c.r255 != null && c.g255 != null && c.b255 != null) {
          const matched = ColorService.nearestRALFromRgbRgb(c.r255, c.g255, c.b255)
          if (matched) initialHex = matched.hex
        }
        if (i === 0 && productDefaultHex && applyProductDefaultFirstRow) initialHex = productDefaultHex
      }
      const originalHex = (hex || '').replace(/^#?/, '#').toUpperCase()
      if (originalHex.length !== 7 || !/^#[0-9A-F]{6}$/.test(originalHex)) return ''
      return `
        <div class="pf-color-row" data-idx="${i}" data-original-hex="${escapeHtml(originalHex)}">
          <span class="pf-color-swatch" style="background:${escapeHtml(initialHex)}" title="${escapeHtml(initialHex)}"></span>
          <span class="pf-color-name">${escapeHtml(name)}${escapeHtml(objHint)}</span>
          <code class="pf-color-hex">${escapeHtml(initialHex)}</code>
          <input type="color" class="pf-color-override" data-color-idx="${i}" value="${escapeHtml(initialHex)}" title="Farbe überschreiben">
        </div>`
    }).join('')
    if (colors.length > 40) colorRows += `<div class="pf-color-more">… und ${colors.length - 40} weitere</div>`
  } else {
    colorRows = '<p class="pf-none">Keine Farbdaten verfügbar</p>'
  }

  const warnHtml = warnings.length
    ? `<div class="pf-warnings">${warnings.map(w => `<div class="pf-warn-item">⚠ ${escapeHtml(String(w))}</div>`).join('')}</div>`
    : ''

  const pfSl = getMaterialSliders()
  const pfLbl = (v) => {
    const x = parseFloat(String(v))
    return Number.isFinite(x) ? x.toFixed(2) : '1.00'
  }

  const modal = document.createElement('div')
  modal.id = 'preflightModal'
  modal.className = 'pf-modal-backdrop'
  modal.innerHTML = `
    <div class="pf-modal">
      <div class="pf-modal-header">
        <h2 class="pf-modal-title">Preflight-Analyse</h2>
        <button type="button" class="pf-close-btn" id="pfCloseBtn">✕</button>
      </div>
      <div class="pf-stats-row">
        <div class="pf-stat"><span class="pf-stat-val">${meshCount}</span><span class="pf-stat-label">Meshes</span></div>
        <div class="pf-stat"><span class="pf-stat-val">${matCount}</span><span class="pf-stat-label">Materialien</span></div>
        <div class="pf-stat"><span class="pf-stat-val">${colors.length}</span><span class="pf-stat-label">Farben</span></div>
      </div>
      ${warnHtml}
      <p class="pf-order-hint">Farben aus MTL/OBJ werden bei Auto-Matching auf RAL gemappt. „Mapping speichern“ speichert die Zuordnung für spätere Exporte.</p>
      <div class="pf-section-title">Farbkorrekturen</div>
      <label class="pf-slider-row pf-auto-match-row">
        <input type="checkbox" id="pfAutoColorMatch" ${autoColorMatch ? 'checked' : ''} title="Quellfarben automatisch auf nächste RAL-Farbe mappen (für gleiche Farben im GLB)">
        <span>Auto-Matching: Quellfarben auf nächste RAL-Farbe mappen</span>
      </label>
      ${productDefaultHex ? `<label class="pf-slider-row pf-auto-match-row">
        <input type="checkbox" id="pfProductDefaultFirstRow" ${applyProductDefaultFirstRow ? 'checked' : ''} title="Wenn deaktiviert: erste Farbe folgt nur Projekt-Mapping bzw. Auto-Matching (reproduzierbar mit Mapping)">
        <span>Produkt-Standard (RAL) für erste Farbe verwenden</span>
      </label>` : ''}
      <div class="pf-sliders">
        <label class="pf-slider-row"><span>Sättigung</span><input type="range" class="pf-range" id="pfSaturation" min="0.5" max="2" step="0.05" value="${escapeHtml(String(pfSl.colorSaturation))}"><span id="pfSaturationVal">${pfLbl(pfSl.colorSaturation)}</span></label>
        <label class="pf-slider-row"><span>Helligkeit</span><input type="range" class="pf-range" id="pfBrightness" min="0.5" max="2" step="0.05" value="${escapeHtml(String(pfSl.colorBrightness))}"><span id="pfBrightnessVal">${pfLbl(pfSl.colorBrightness)}</span></label>
        <label class="pf-slider-row"><span>Rauheit ×</span><input type="range" class="pf-range" id="pfRoughness" min="0.1" max="3" step="0.05" value="${escapeHtml(String(pfSl.roughnessMultiplier))}"><span id="pfRoughnessVal">${pfLbl(pfSl.roughnessMultiplier)}</span></label>
        <label class="pf-slider-row"><span>Metallic ×</span><input type="range" class="pf-range" id="pfMetallic" min="0" max="2" step="0.05" value="${escapeHtml(String(pfSl.metallicMultiplier))}"><span id="pfMetallicVal">${pfLbl(pfSl.metallicMultiplier)}</span></label>
      </div>
      ${colors.length ? `<div class="pf-section-title">Farben (${colors.length})${productDefaultHex && applyProductDefaultFirstRow ? ' – erste Farbe = Produkt-Standard (RAL)' : ''}</div><div class="pf-color-list">${colorRows}</div>` : ''}
      <div class="pf-modal-footer">
        <button type="button" class="btn btn-ghost" id="pfExportMappingBtn" title="Aktuelles MTL→RAL-Mapping als JSON speichern, für zukünftige Exporte laden">Mapping speichern</button>
        <button type="button" class="btn btn-ghost" id="pfCancelBtn">Abbrechen</button>
        <button type="button" class="btn btn-primary" id="pfConfirmBtn">Konvertierung starten</button>
      </div>
    </div>`

  document.body.appendChild(modal)

  // Slider labels
  ;['Saturation','Brightness','Roughness','Metallic'].forEach(key => {
    const el = $(`pf${key}`)
    const lbl = $(`pf${key}Val`)
    if (el && lbl) el.addEventListener('input', () => { lbl.textContent = parseFloat(el.value).toFixed(2) })
  })

  const pfAutoColorMatchEl = $('pfAutoColorMatch')
  if (pfAutoColorMatchEl) {
    pfAutoColorMatchEl.addEventListener('change', () => {
      localStorage.setItem('converter_autoColorMatch', pfAutoColorMatchEl.checked ? 'true' : 'false')
    })
  }
  const pfProductDefaultFirstRowEl = $('pfProductDefaultFirstRow')
  if (pfProductDefaultFirstRowEl) {
    pfProductDefaultFirstRowEl.addEventListener('change', () => {
      localStorage.setItem('converter_preflightProductDefaultFirstRow', pfProductDefaultFirstRowEl.checked ? 'true' : 'false')
    })
  }

  $('pfCloseBtn')?.addEventListener('click', closePreflightModal)
  $('pfCancelBtn')?.addEventListener('click', closePreflightModal)
  $('pfExportMappingBtn')?.addEventListener('click', exportPreflightMapping)
  $('pfConfirmBtn')?.addEventListener('click', async () => {
    closePreflightModal()
    showProgress('Konvertierung wird gestartet …')
    try {
      await submitConversion(jobId)
    } catch (err) {
      const s = $('progressStatus')
      if (s) s.textContent = 'Fehler: ' + err.message
    }
  })
}

/** Exportiert das aktuelle Preflight-Mapping (MTL-Farben → RAL) als JSON zum Laden bei zukünftigen Exporten. */
function exportPreflightMapping() {
  const rows = document.querySelectorAll('.pf-color-row')
  const matchPalette = []
  const sourcePalette = []
  const matchRal = {}
  rows.forEach((row, i) => {
    const originalHex = row?.dataset?.originalHex
    const inp = row?.querySelector('.pf-color-override')
    const matchHex = (inp?.value || '').replace(/^#?/, '#').toUpperCase()
    if (originalHex && matchHex.length === 7) {
      matchPalette.push({ originalHex, matchHex })
      const id = i + 1
      sourcePalette.push({ id, hex: originalHex })
      const ralCode = ColorService.getRALCodeFromHex(matchHex)
      if (ralCode) matchRal[String(id)] = ralCode
    }
  })
  const out = {
    sourcePalette,
    matchPalette,
    ...(Object.keys(matchRal).length ? { matchRal } : {}),
    _comment: 'MTL→RAL-Mapping aus Preflight. In Konvertierung unter „Farb-Mapping laden“ verwenden.',
  }
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'mtl-ral-color-mapping.json'
  a.click()
  URL.revokeObjectURL(a.href)
}

function closePreflightModal() {
  const m = $('preflightModal')
  if (m) m.remove()
}

function collectPreflightEdits() {
  const disableExcelNamingForStep = hasStepLikeInput(selectedFiles)
  const keepOriginalColors = getOption('optKeepOriginalColors')
  const colorOverrides = {}
  if (!keepOriginalColors) {
    document.querySelectorAll('.pf-color-override').forEach(inp => {
      const row = inp.closest('.pf-color-row')
      const originalHex = row?.dataset?.originalHex
      const targetHex = (inp.value || '').replace(/^#?/, '#').toUpperCase()
      if (originalHex && targetHex.length === 7) {
        const key = ColorService.normalizeHex(originalHex)
        const value = ColorService.normalizeHex(targetHex)
        if (key && value) colorOverrides[key] = value
      }
    })
    // Case-robust: Backend kann MTL-Hex lowercase vergleichen
    for (const [key, value] of Object.entries(colorOverrides)) {
      if (key && key.toLowerCase() !== key) colorOverrides[key.toLowerCase()] = value
    }
  }

  const bool = v => v ? 'true' : 'false'
  const ms = getMaterialSliders()

  return {
    colorSaturation:     ms.colorSaturation,
    colorBrightness:     ms.colorBrightness,
    roughnessMultiplier: ms.roughnessMultiplier,
    metallicMultiplier:  ms.metallicMultiplier,
    materialFinishVerzinktMetallic:  '0.75',
    materialFinishVerzinktRoughness: '0.25',
    materialFinishRalMetallic:  '0',
    materialFinishRalRoughness: '0.35',
    colorOverrides:      keepOriginalColors ? undefined : (Object.keys(colorOverrides).length ? JSON.stringify(colorOverrides) : undefined),
    outputFormat:        getOption('optFormat') || 'glb',
    scale:               String(getOption('optScale') || '0.001'),
    importUpAxis:        getOption('optUpAxis') || 'AUTO',
    tessellationQuality: String(getOption('optTessellation') || '0.1'),
    decimateRatio:       String(getOption('optDecimate') || '1.0'),
    bakeYUp:             bool(getOption('optBakeYUp')),
    rotateAxis:          (getOption('optRotateAxis') || '').trim() || undefined,
    rotateDegrees:      (getOption('optRotateDegrees') || '').trim() || undefined,
    useDraco:            bool(getOption('optDraco')),
    embedTextures:       bool(getOption('optEmbedTextures')),
    stripCamerasLights:  bool(getOption('optStripLights')),
    overwriteExisting:   bool(getOption('optOverwrite')),
    materialFinish:      getOption('optMaterialFinish') || 'auto',
    autoLabelParts:      bool(getOption('optAutoLabel')),
    useClaudeAI:         bool(getOption('optClaudeAI')),
    useGTINNaming:       bool(getOption('optUseGtin') && !disableExcelNamingForStep),
    batchChunkSize:      String(getOption('optBatchChunk') || '20'),
    gtin:                (getOption('optGtin') || '').trim() || undefined,
    articleNumber:       (getOption('optArticleNumber') || '').trim() || undefined,
  }
}

/* ─── Top-Bar: Konvertierung läuft + Desktop-Benachrichtigung ─── */
let convIndicatorStartedAt = null
let convIndicatorTimer = null
let convIndicatorHideTimer = null

function formatElapsedMs(ms) {
  const s = Math.floor(Math.max(0, ms) / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}

function updateConvIndicatorElapsed() {
  const el = $('convIndicatorElapsed')
  if (!el || convIndicatorStartedAt == null) return
  el.textContent = formatElapsedMs(Date.now() - convIndicatorStartedAt)
}

function clearConvIndicatorTimers() {
  if (convIndicatorTimer) {
    clearInterval(convIndicatorTimer)
    convIndicatorTimer = null
  }
  if (convIndicatorHideTimer) {
    clearTimeout(convIndicatorHideTimer)
    convIndicatorHideTimer = null
  }
}

/**
 * @param {'idle'|'running'|'completed'|'failed'} state
 * @param {{ partial?: boolean }} [opts]
 */
function setConvIndicator(state, opts = {}) {
  const wrap = $('convIndicator')
  const label = $('convIndicatorLabel')
  if (!wrap) return

  if (state === 'idle') {
    clearConvIndicatorTimers()
    wrap.hidden = true
    wrap.classList.remove('is-running', 'is-completed', 'is-failed')
    convIndicatorStartedAt = null
    return
  }

  if (state === 'running') {
    clearConvIndicatorTimers()
    convIndicatorStartedAt = Date.now()
    wrap.hidden = false
    wrap.classList.remove('is-completed', 'is-failed')
    wrap.classList.add('is-running')
    if (label) label.textContent = 'Konvertierung läuft'
    updateConvIndicatorElapsed()
    convIndicatorTimer = setInterval(updateConvIndicatorElapsed, 1000)
    return
  }

  if (state === 'completed' || state === 'failed') {
    clearConvIndicatorTimers()
    const durationMs = convIndicatorStartedAt != null ? Date.now() - convIndicatorStartedAt : 0
    const elapsedEl = $('convIndicatorElapsed')
    if (elapsedEl) elapsedEl.textContent = formatElapsedMs(durationMs)

    wrap.hidden = false
    wrap.classList.remove('is-running')
    if (state === 'completed') {
      wrap.classList.remove('is-failed')
      wrap.classList.add('is-completed')
      if (label) label.textContent = opts.partial ? 'Teilweise fertig' : 'Konvertierung fertig'
    } else {
      wrap.classList.remove('is-completed')
      wrap.classList.add('is-failed')
      if (label) label.textContent = 'Konvertierung fehlgeschlagen'
    }

    const hideMs = state === 'failed' ? 5000 : 3000
    convIndicatorHideTimer = setTimeout(() => setConvIndicator('idle'), hideMs)
  }
}

function notifyConversionDone(jobId, kind, outputs, errorText) {
  if (!('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  try {
    const idStr = jobId != null ? String(jobId) : ''
    const jobShort = idStr.length > 14 ? `${idStr.slice(0, 12)}…` : idStr
    let title = 'META – Konvertierung'
    let body = ''
    if (kind === 'completed') {
      title = 'META – Konvertierung fertig'
      const n = Array.isArray(outputs) ? outputs.length : 0
      if (n > 1) body = `${n} Ausgabe-Dateien bereit.`
      else if (n === 1) body = `Datei: ${outputs[0].split(/[/\\]/).pop()}`
      else body = 'Job abgeschlossen.'
      if (jobShort) body += ` Job: ${jobShort}`
    } else if (kind === 'partial') {
      title = 'META – Konvertierung teilweise fertig'
      const n = Array.isArray(outputs) ? outputs.length : 0
      body = n ? `${n} Datei(en) fertig.` : 'Teilweise abgeschlossen.'
      if (jobShort) body += ` Job: ${jobShort}`
    } else {
      title = 'META – Konvertierung fehlgeschlagen'
      body = jobShort ? `Job ${jobShort}. ` : ''
      const err = errorText && String(errorText).trim()
      body += err ? err.slice(0, 200) : 'Bitte Konverter-Log prüfen.'
    }
    new Notification(title, { body, tag: idStr || 'meta-conv', silent: false })
  } catch (_) {}
}

async function ensureNotificationPermission() {
  if (!('Notification' in window)) return
  if (Notification.permission === 'default') {
    try {
      await Notification.requestPermission()
    } catch (_) {}
  }
}

function pollJobProgress(jobId) {
  if (pollInterval) clearInterval(pollInterval)
  const progressFill = $('progressFill')
  const progressStatus = $('progressStatus')
  const progressLog = $('progressLog')
  const btnDownload = $('btnDownloadResult')

  const poll = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/status/${jobId}`)
      if (!res.ok) return
      let data
      try {
        data = await parseJsonResponse(res)
      } catch (_) {
        return
      }
      const rawProgress = Number(data.progress)
      const pct = Number.isFinite(rawProgress)
        ? Math.min(100, Math.max(0, rawProgress))
        : 0
      if (progressFill) progressFill.style.width = pct + '%'
      progressStatus.textContent = data.status || 'Verarbeite …'
      const logLines = Array.isArray(data.logs) ? data.logs : (data.log ? [data.log] : [])
      if (logLines.length) progressLog.textContent = logLines.join('\n')
      const entry = jobsCache.find((j) => (j.jobId || j.id) === jobId)
      if (entry) entry.status = data.status
      renderJobs()

      if (data.status === 'completed' || data.status === 'partially_completed') {
        clearInterval(pollInterval)
        pollInterval = null
        const outputs = Array.isArray(data.outputPaths) && data.outputPaths.length
          ? data.outputPaths
          : (data.outputPath ? [data.outputPath] : [])

        if (outputs.length <= 1) {
          // Single download
          btnDownload.href = `${API_BASE}/api/v1/download/${jobId}`
          const name = (outputs[0] || '').split(/[/\\]/).pop() || 'output.glb'
          btnDownload.download = name
          btnDownload.textContent = `GLB herunterladen (${name})`
          btnDownload.hidden = false
        } else {
          // Multi download
          const actionsEl = btnDownload.parentElement
          outputs.forEach((p, idx) => {
            const a = document.createElement('a')
            a.href = `${API_BASE}/api/v1/download/${jobId}?index=${idx}`
            a.download = p.split(/[/\\]/).pop() || `output_${idx}.glb`
            a.className = 'btn btn-ghost'
            a.textContent = a.download
            actionsEl.appendChild(a)
          })
          if (outputs.length > 4) {
            const allBtn = document.createElement('button')
            allBtn.className = 'btn btn-primary'
            allBtn.textContent = `Alle ${outputs.length} herunterladen`
            allBtn.addEventListener('click', async () => {
              allBtn.disabled = true
              for (let i = 0; i < outputs.length; i++) {
                const a = document.createElement('a')
                a.href = `${API_BASE}/api/v1/download/${jobId}?index=${i}`
                a.download = outputs[i].split(/[/\\]/).pop()
                a.click()
                await new Promise(r => setTimeout(r, 300))
              }
              allBtn.disabled = false
            })
            actionsEl.appendChild(allBtn)
          }
        }
        if (data.status === 'partially_completed') {
          progressStatus.textContent = `Teilweise abgeschlossen (${outputs.length} Dateien)`
        }
        const entry = jobsCache.find(j => (j.jobId || j.id) === jobId)
        if (entry) entry.outputPaths = outputs
        renderJobs()

        // ── Automatisch in Produktverwaltung registrieren ──
        if (outputs.length) {
          await registerConverted(outputs, jobId)
        }

        const partial = data.status === 'partially_completed'
        setConvIndicator('completed', { partial })
        notifyConversionDone(jobId, partial ? 'partial' : 'completed', outputs)
      }
      if (data.status === 'failed') {
        const errMsg = data.error || data.message || 'Unbekannter Fehler'
        log.scoped('Converter').error('Job fehlgeschlagen (API/MCP/Blender)', {
          jobId,
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
        const prog = data.progress != null ? String(data.progress) : ''
        log.scoped('Converter').warn(
          'Diagnose: Status-API liefert meist keine Blender-Logs — Terminal von MCP (8001) + API (3000) prüfen.',
          '\n· BLENDER_PATH, BLENDER_OUTPUT_DIR, freier Speicher, Pfadlänge (externe Platte), STEP-Import in Blender.',
          prog ? `\n· Fortschritt zuletzt: ${prog}%.` : '',
        )
        clearInterval(pollInterval)
        pollInterval = null
        progressStatus.textContent = 'Fehlgeschlagen'
        if (errMsg) progressLog.textContent = (progressLog.textContent || '') + '\n' + errMsg
        renderJobs()
        setConvIndicator('failed')
        notifyConversionDone(jobId, 'failed', [], errMsg)
      }
    } catch (_) {}
  }

  poll()
  pollInterval = setInterval(poll, 2000)
}

/* ─── Batch aus Upload-Ordner ─── */
async function loadUploadFolders() {
  const section = $('batchFolderSection')
  const list = $('batchFolderList')
  if (!section || !list) return
  try {
    const res = await fetch(`${API_BASE}/api/v1/uploads`)
    let data
    try {
      data = await parseJsonResponse(res)
    } catch (_) {
      return
    }
    if (!res.ok) return
    const folders = data.uploads || data.jobs || []
    if (!folders.length) { section.hidden = true; return }
    section.hidden = false
    list.innerHTML = folders.slice(0, 20).map(f => {
      const name = f.name || f.jobId || f.id || String(f)
      const count = f.fileCount || f.files?.length || '?'
      return `<div class="batch-folder-item">
        <span class="batch-folder-name">${escapeHtml(name)}</span>
        <span class="batch-folder-meta">${count} Datei(en)</span>
        <button type="button" class="btn btn-ghost btn-sm btn-folder-convert" data-folder="${escapeHtml(name)}">Konvertieren</button>
      </div>`
    }).join('')
    list.querySelectorAll('.btn-folder-convert').forEach(btn => {
      btn.addEventListener('click', () => startFolderConversion(btn.dataset.folder))
    })
  } catch (_) {}
}

async function startFolderConversion(folderName) {
  showProgress(`Konvertierung aus Ordner: ${folderName} …`)
  try {
    lastSubmittedConversionPreset = buildConversionPresetForRegister()
    const opts = collectPreflightEdits()
    const res = await fetch(`${API_BASE}/api/v1/convert/from-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: folderName, ...opts }),
    })
    const data = await parseJsonResponse(res)
    if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`)
    const jobId = data.jobId || folderName
    currentJobId = jobId
    jobsCache.unshift({ jobId, status: 'queued' })
    renderJobs()
    pollJobProgress(jobId)
    void ensureNotificationPermission()
    setConvIndicator('running')
  } catch (err) {
    const s = $('progressStatus')
    if (s) s.textContent = 'Fehler: ' + err.message
  }
}

/* ═══════════════════════════════════════════════
   Jobs: list, filter, refresh, delete
   ═══════════════════════════════════════════════ */
async function loadJobs() {
  try {
    const res = await fetch(`${API_BASE}/api/v1/uploads`)
    let data
    try {
      data = await parseJsonResponse(res)
    } catch (_) {
      return
    }
    if (!res.ok) return
    jobsCache = data.jobs || data.uploads || []
  } catch (_) {
    jobsCache = []
  }
  renderJobs()
}

function renderJobs() {
  const list = $('jobsList')
  const countEl = $('jobsCount')
  if (!list) return

  let items = jobsCache
  if (jobsFilterStatus !== 'all') {
    items = items.filter((j) => (j.status || j.state || '').toLowerCase() === jobsFilterStatus)
  }

  if (countEl) countEl.textContent = `${items.length} Jobs`

  list.innerHTML = items
    .map((j) => {
      const id = j.jobId || j.id || j.name || '–'
      const status = (j.status || j.state || 'unknown').toLowerCase()
      let downloadBtn = ''
      if (status === 'completed' && id) {
        downloadBtn = `<a href="${API_BASE}/api/v1/download/${id}" class="btn btn-ghost btn-sm" download>Download</a>`
      }
      const deleteBtn = `<button type="button" class="btn btn-ghost btn-sm btn-delete-job" data-id="${escapeHtml(id)}">Löschen</button>`
      return `
        <div class="job-card" data-job-id="${escapeHtml(id)}">
          <span class="job-card-id">${escapeHtml(id)}</span>
          <span class="job-card-status ${status}">${status}</span>
          <div class="job-card-actions">${downloadBtn}${deleteBtn}</div>
        </div>
      `
    })
    .join('')

  list.querySelectorAll('.btn-delete-job').forEach((btn) => {
    btn.addEventListener('click', () => deleteJob(btn.dataset.id))
  })
}

async function deleteJob(jobId) {
  try {
    await fetch(`${API_BASE}/api/v1/jobs/${jobId}`, { method: 'DELETE' })
    jobsCache = jobsCache.filter((j) => (j.jobId || j.id) !== jobId)
    renderJobs()
  } catch (_) {}
}

function bindJobsFilters() {
  $('jobsFilters')?.addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip[data-status]')
    if (!chip) return
    $$('.jobs-filters .filter-chip').forEach((c) => c.classList.remove('active'))
    chip.classList.add('active')
    jobsFilterStatus = chip.dataset.status
    renderJobs()
  })
}

/* ═══════════════════════════════════════════════
   Produktverwaltung – Registrierung + Context
   ═══════════════════════════════════════════════ */
async function registerConverted(outputPaths, jobId) {
  // CAD-Dateien des aktuellen Produkts (falls aus Dashboard gestartet)
  let cadFileUrls = []
  if (PRODUCT_ID) {
    try {
      const r = await fetch(`/__api/products/${encodeURIComponent(PRODUCT_ID)}`)
      const p = await parseJsonResponse(r)
      if (r.ok && p?.cadFiles) cadFileUrls = p.cadFiles
    } catch (_) {}
  }

  const conversionPreset =
    PRODUCT_ID && lastSubmittedConversionPreset && Object.keys(lastSubmittedConversionPreset).length
      ? lastSubmittedConversionPreset
      : undefined

  try {
    const res = await fetch('/__api/register-converted', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        outputPaths,
        cadFileUrls,
        productId: PRODUCT_ID || undefined,
        ...(conversionPreset ? { conversionPreset } : {}),
      }),
    })
    const data = await parseJsonResponse(res)
    if (data.ok && data.added?.length) {
      showDashboardLink(data.added)
    }
  } catch (_) {}
}

function showDashboardLink(productIds) {
  const actionsEl = $('btnDownloadResult')?.parentElement
  if (!actionsEl) return
  const existing = actionsEl.querySelector('.btn-dashboard-link')
  if (existing) return
  const a = document.createElement('a')
  a.className = 'btn btn-ghost btn-dashboard-link'
  a.href = productIds.length === 1
    ? `/dashboard.html?highlight=${encodeURIComponent(productIds[0])}`
    : '/dashboard.html'
  a.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg> In Produktverwaltung ansehen`
  actionsEl.appendChild(a)
}

async function showProductContext() {
  if (!PRODUCT_ID) return
  try {
    const r = await fetch(`/__api/products/${encodeURIComponent(PRODUCT_ID)}`)
    const p = await parseJsonResponse(r)
    if (!r.ok) return
    if (!p) return

    if (p.conversionPreset && typeof p.conversionPreset === 'object' && !Array.isArray(p.conversionPreset)) {
      applyConversionPresetToForm(p.conversionPreset)
    }

    const banner = document.createElement('div')
    banner.className = 'product-context-banner'
    banner.innerHTML = `
      <div class="pcb-inner">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
        <div>
          <strong>${escapeHtml(p.name)}</strong>
          <span class="pcb-meta">ID: ${escapeHtml(p.id)}</span>
          ${p.cadFiles?.length ? `<span class="pcb-meta">${p.cadFiles.length} CAD-Datei(en) werden konvertiert</span>` : ''}
        </div>
        <a href="/dashboard.html" class="btn btn-ghost btn-sm">← Dashboard</a>
      </div>`
    const main = document.querySelector('.converter-main')
    if (main) main.prepend(banner)

    // CAD-Dateien als "bereits ausgewählt" im Upload-Bereich anzeigen
    if (p.cadFiles?.length) {
      const drop = $('uploadDrop')
      const hint = drop?.querySelector('.upload-hint')
      if (hint) hint.textContent = `${p.cadFiles.length} Server-Dateien bereit: ${p.cadFiles.map(f => f.split('/').pop()).join(', ')}`
      if (drop) drop.classList.add('has-product')
    }
  } catch (_) {}
}

/* ═══════════════════════════════════════════════
   Init
   ═══════════════════════════════════════════════ */
function bindOptions() {
  $('optAutoLabel')?.addEventListener('change', (e) => {
    const row = $('optClaudeRow')
    if (row) row.style.opacity = e.target.checked ? '1' : '0.4'
    const cb = $('optClaudeAI')
    if (cb && !e.target.checked) cb.checked = false
  })

  // Export rotation vs Y-up: mutually exclusive
  function syncExportRotationVsYUp() {
    const bakeYUp = $('optBakeYUp')
    const rotateAxis = $('optRotateAxis')
    const rotateDegrees = $('optRotateDegrees')
    if (!bakeYUp || !rotateAxis) return
    if (bakeYUp.checked) {
      rotateAxis.value = ''
      if (rotateDegrees) rotateDegrees.disabled = true
    } else {
      if (rotateDegrees) rotateDegrees.disabled = !(rotateAxis.value === 'X' || rotateAxis.value === 'Y' || rotateAxis.value === 'Z')
    }
  }
  function onYUpChange() {
    const bakeYUp = $('optBakeYUp')
    const rotateAxis = $('optRotateAxis')
    if (bakeYUp?.checked && rotateAxis) {
      rotateAxis.value = ''
      const rd = $('optRotateDegrees')
      if (rd) rd.disabled = true
    }
  }
  function onRotateAxisChange() {
    const bakeYUp = $('optBakeYUp')
    const axis = $('optRotateAxis')
    const rd = $('optRotateDegrees')
    if (axis?.value === 'X' || axis?.value === 'Y' || axis?.value === 'Z') {
      if (bakeYUp) bakeYUp.checked = false
      if (rd) rd.disabled = false
    } else if (rd) rd.disabled = true
  }
  $('optBakeYUp')?.addEventListener('change', onYUpChange)
  $('optRotateAxis')?.addEventListener('change', onRotateAxisChange)
  syncExportRotationVsYUp()
}

function init() {
  bindUpload()
  bindColorMapping()
  bindJobsFilters()
  bindGtinSection()
  bindOptions()
  checkHealth()
  loadGtinConfig()
  checkAiHealth()
  const mappingLoaded = loadProjectColorMapping()
  loadUploadFolders()
  setInterval(checkHealth, 30000)
  renderJobs()

  // URL-gesteuerte Aktionen
  if (MONITOR_JOB) {
    showProgress(`Job ${MONITOR_JOB} wird verfolgt …`)
    currentJobId = MONITOR_JOB
    jobsCache.unshift({ jobId: MONITOR_JOB, status: 'processing' })
    renderJobs()
    pollJobProgress(MONITOR_JOB)
    void ensureNotificationPermission()
    setConvIndicator('running')
  }
  if (PRODUCT_ID) {
    void mappingLoaded.then(() => showProductContext())
  }
}

init()
