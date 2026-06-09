import './converter.css'

const API_BASE = '' // use Vite proxy: /api -> localhost:3000

const $ = (id) => document.getElementById(id)
const $$ = (sel) => document.querySelectorAll(sel)

let selectedFiles = []
let jobsCache = []
let currentJobId = null
let pollInterval = null
let jobsFilterStatus = 'all'

// URL-Parameter
const URL_PARAMS  = new URLSearchParams(location.search)
const MONITOR_JOB = URL_PARAMS.get('monitor')   // direkt Job beobachten
const PRODUCT_ID  = URL_PARAMS.get('productId') // Produkt-Kontext für Registrierung

const ACCEPT_EXT = ['.obj', '.mtl', '.step', '.stp', '.zip', '.jpg', '.jpeg', '.png', '.tiff', '.tga', '.bmp']

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
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

/* ═══════════════════════════════════════════════
   Health checks
   ═══════════════════════════════════════════════ */
async function checkHealth() {
  let apiOk = false
  let mcpOk = false
  try {
    const r = await fetch(`${API_BASE}/api/health`)
    apiOk = r.ok
  } catch (_) {}
  try {
    const r = await fetch(`${API_BASE}/api/health/mcp`)
    mcpOk = r.ok
  } catch (_) {}
  const apiEl = $('healthApi')
  const mcpEl = $('healthMcp')
  if (apiEl) {
    apiEl.classList.remove('ok', 'fail')
    apiEl.classList.add(apiOk ? 'ok' : 'fail')
  }
  if (mcpEl) {
    mcpEl.classList.remove('ok', 'fail')
    mcpEl.classList.add(mcpOk ? 'ok' : 'fail')
  }
  return { apiOk, mcpOk }
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

function escapeHtml(s) {
  const div = document.createElement('div')
  div.textContent = s
  return div.innerHTML
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
  ;(extraFiles || selectedFiles).forEach((f) => form.append('files', f))

  form.append('outputFormat',       getOption('optFormat') || 'glb')
  form.append('scale',              String(getOption('optScale') || '0.001'))
  form.append('importUpAxis',       getOption('optUpAxis') || 'AUTO')
  form.append('tessellationQuality',String(getOption('optTessellation') || '0.1'))
  form.append('decimateRatio',      String(getOption('optDecimate') || '1.0'))
  form.append('bakeYUp',            getOption('optBakeYUp') ? 'true' : 'false')
  form.append('useDraco',           getOption('optDraco') ? 'true' : 'false')
  form.append('embedTextures',      getOption('optEmbedTextures') ? 'true' : 'false')
  form.append('stripCamerasLights', getOption('optStripLights') ? 'true' : 'false')
  form.append('overwriteExisting',  getOption('optOverwrite') ? 'true' : 'false')
  form.append('materialFinish',     getOption('optMaterialFinish') || 'auto')
  form.append('autoLabelParts',     getOption('optAutoLabel') ? 'true' : 'false')
  form.append('useClaudeAI',        getOption('optClaudeAI') ? 'true' : 'false')
  form.append('useGTINNaming',      getOption('optUseGtin') ? 'true' : 'false')
  form.append('batchChunkSize',     String(getOption('optBatchChunk') || '20'))

  form.append('colorSaturation',     '1')
  form.append('colorBrightness',     '1')
  form.append('roughnessMultiplier', '1')
  form.append('metallicMultiplier',  '1')

  const gtin          = (getOption('optGtin') || '').trim()
  const articleNumber = (getOption('optArticleNumber') || '').trim()
  if (gtin)          form.append('gtin', gtin)
  if (articleNumber) form.append('articleNumber', articleNumber)

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

/* ─── Preflight + Color-Mapping ─── */
let preflightData = null  // stores preflight result for confirm step

async function startConversion() {
  if (selectedFiles.length === 0) return
  const usePreflight = selectedFiles.length <= 10  // skip preflight for large batches

  showProgress(usePreflight ? 'Preflight-Analyse läuft …' : 'Konvertierung wird gestartet …')

  try {
    const form = buildFormData()
    form.set('enablePreflight', usePreflight ? 'true' : 'false')

    if (usePreflight) {
      // Step 1: preflight analysis
      const res = await fetch(`${API_BASE}/api/v1/preflight`, { method: 'POST', body: form })
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`)
      const data = await res.json()
      preflightData = data
      openPreflightModal(data)
    } else {
      // Direct conversion for large batches
      await submitConversion(form)
    }
  } catch (err) {
    const s = $('progressStatus')
    const l = $('progressLog')
    if (s) s.textContent = 'Fehler: ' + (err.message || 'Unbekannt')
    if (l) l.textContent = err.stack || err.message
  }
}

async function submitConversion(formOrJobId) {
  let jobId
  if (typeof formOrJobId === 'string') {
    // Confirm existing preflight job
    const opts = collectPreflightEdits()
    const res = await fetch(`${API_BASE}/api/v1/convert/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: formOrJobId, ...opts }),
    })
    if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`)
    const data = await res.json()
    jobId = data.jobId || formOrJobId
  } else {
    const res = await fetch(`${API_BASE}/api/v1/convert`, { method: 'POST', body: formOrJobId })
    if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`)
    const data = await res.json()
    jobId = data.jobId
  }
  if (jobId) {
    currentJobId = jobId
    jobsCache.unshift({ jobId, status: 'queued' })
    renderJobs()
    pollJobProgress(jobId)
  }
}

/* ─── Preflight Modal ─── */
function rgbToHex(rgb) {
  if (!rgb || rgb.length < 3) return '#888888'
  const r = Math.round(Math.min(1, Math.max(0, rgb[0])) * 255)
  const g = Math.round(Math.min(1, Math.max(0, rgb[1])) * 255)
  const b = Math.round(Math.min(1, Math.max(0, rgb[2])) * 255)
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
}

function openPreflightModal(data) {
  const pf = data.preflight || {}
  const summary = pf.summary || {}

  const meshCount = summary.totalObjects ?? pf.meshCount ?? pf.mesh_count ?? '?'
  const matCount = summary.totalMaterials ?? pf.materialCount ?? pf.material_count ?? '?'
  const warnings = pf.warnings || []
  const jobId = data.jobId

  // Build color list from colorUsage (preferred), materials, or legacy uniqueColors/colors
  let colors = pf.uniqueColors || pf.colors || []
  if (!colors.length && pf.colorUsage?.length) {
    colors = pf.colorUsage.map((cu, i) => ({
      hex: rgbToHex(cu.rgb),
      name: cu.materials?.[0] || `Farbe ${i + 1}`,
      objects: cu.objects || [],
    }))
  } else if (!colors.length && pf.materials?.length) {
    const seen = new Set()
    for (const m of pf.materials) {
      if (m.baseColor && !m.baseColorLinked) {
        const hex = rgbToHex(m.baseColor)
        if (!seen.has(hex)) {
          seen.add(hex)
          colors.push({ hex, name: m.name })
        }
      }
    }
  }

  let colorRows = ''
  if (colors.length) {
    colorRows = colors.slice(0, 40).map((c, i) => {
      const hex = c.hex || c.color || (typeof c === 'string' ? c : rgbToHex(c.rgb || c))
      const name = c.name || c.materialName || `Farbe ${i+1}`
      const objHint = c.objects?.length ? ` (${c.objects.length} Objekte)` : ''
      return `
        <div class="pf-color-row" data-idx="${i}">
          <span class="pf-color-swatch" style="background:${escapeHtml(hex)}" title="${escapeHtml(hex)}"></span>
          <span class="pf-color-name">${escapeHtml(name)}${escapeHtml(objHint)}</span>
          <code class="pf-color-hex">${escapeHtml(hex)}</code>
          <input type="color" class="pf-color-override" data-color-idx="${i}" value="${escapeHtml(hex)}" title="Farbe überschreiben">
        </div>`
    }).join('')
    if (colors.length > 40) colorRows += `<div class="pf-color-more">… und ${colors.length - 40} weitere</div>`
  } else {
    colorRows = '<p class="pf-none">Keine Farbdaten verfügbar</p>'
  }

  const warnHtml = warnings.length
    ? `<div class="pf-warnings">${warnings.map(w => `<div class="pf-warn-item">⚠ ${escapeHtml(String(w))}</div>`).join('')}</div>`
    : ''

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
      <div class="pf-section-title">Farbkorrekturen</div>
      <div class="pf-sliders">
        <label class="pf-slider-row"><span>Sättigung</span><input type="range" class="pf-range" id="pfSaturation" min="0.5" max="2" step="0.05" value="1"><span id="pfSaturationVal">1.00</span></label>
        <label class="pf-slider-row"><span>Helligkeit</span><input type="range" class="pf-range" id="pfBrightness" min="0.5" max="2" step="0.05" value="1"><span id="pfBrightnessVal">1.00</span></label>
        <label class="pf-slider-row"><span>Rauheit ×</span><input type="range" class="pf-range" id="pfRoughness" min="0.1" max="3" step="0.05" value="1"><span id="pfRoughnessVal">1.00</span></label>
        <label class="pf-slider-row"><span>Metallic ×</span><input type="range" class="pf-range" id="pfMetallic" min="0" max="2" step="0.05" value="1"><span id="pfMetallicVal">1.00</span></label>
      </div>
      ${colors.length ? `<div class="pf-section-title">Farben (${colors.length})</div><div class="pf-color-list">${colorRows}</div>` : ''}
      <div class="pf-modal-footer">
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

  $('pfCloseBtn')?.addEventListener('click', closePreflightModal)
  $('pfCancelBtn')?.addEventListener('click', closePreflightModal)
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

function closePreflightModal() {
  const m = $('preflightModal')
  if (m) m.remove()
}

function collectPreflightEdits() {
  const colorOverrides = {}
  document.querySelectorAll('.pf-color-override').forEach(inp => {
    const idx = inp.dataset.colorIdx
    colorOverrides[idx] = inp.value
  })

  const bool = v => v ? 'true' : 'false'

  return {
    colorSaturation:     String($('pfSaturation')?.value || '1'),
    colorBrightness:     String($('pfBrightness')?.value || '1'),
    roughnessMultiplier: String($('pfRoughness')?.value  || '1'),
    metallicMultiplier:  String($('pfMetallic')?.value   || '1'),
    colorOverrides:      Object.keys(colorOverrides).length ? JSON.stringify(colorOverrides) : undefined,
    outputFormat:        getOption('optFormat') || 'glb',
    scale:               String(getOption('optScale') || '0.001'),
    importUpAxis:        getOption('optUpAxis') || 'AUTO',
    tessellationQuality: String(getOption('optTessellation') || '0.1'),
    decimateRatio:       String(getOption('optDecimate') || '1.0'),
    bakeYUp:             bool(getOption('optBakeYUp')),
    useDraco:            bool(getOption('optDraco')),
    embedTextures:       bool(getOption('optEmbedTextures')),
    stripCamerasLights:  bool(getOption('optStripLights')),
    overwriteExisting:   bool(getOption('optOverwrite')),
    materialFinish:      getOption('optMaterialFinish') || 'auto',
    autoLabelParts:      bool(getOption('optAutoLabel')),
    useClaudeAI:         bool(getOption('optClaudeAI')),
    useGTINNaming:       bool(getOption('optUseGtin')),
    batchChunkSize:      String(getOption('optBatchChunk') || '20'),
    gtin:                (getOption('optGtin') || '').trim() || undefined,
    articleNumber:       (getOption('optArticleNumber') || '').trim() || undefined,
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
      const data = await res.json()
      const pct = Math.min(100, Number(data.progress) ?? 0)
      progressFill.style.width = pct + '%'
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
      }
      if (data.status === 'failed') {
        clearInterval(pollInterval)
        pollInterval = null
        progressStatus.textContent = 'Fehlgeschlagen'
        if (data.error) progressLog.textContent = (progressLog.textContent || '') + '\n' + data.error
        renderJobs()
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
    if (!res.ok) return
    const data = await res.json()
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
    const opts = collectPreflightEdits()
    const res = await fetch(`${API_BASE}/api/v1/convert/from-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: folderName, ...opts }),
    })
    if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`)
    const data = await res.json()
    const jobId = data.jobId || folderName
    currentJobId = jobId
    jobsCache.unshift({ jobId, status: 'queued' })
    renderJobs()
    pollJobProgress(jobId)
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
    if (!res.ok) return
    const data = await res.json()
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
      if (r.ok) {
        const p = await r.json()
        if (p?.cadFiles) cadFileUrls = p.cadFiles
      }
    } catch (_) {}
  }

  try {
    const res = await fetch('/__api/register-converted', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outputPaths, cadFileUrls, productId: PRODUCT_ID || undefined }),
    })
    const data = await res.json()
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
    if (!r.ok) return
    const p = await r.json()
    if (!p) return

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
   GTIN / Artikelstammdaten
   ═══════════════════════════════════════════════ */
async function loadGtinConfig() {
  const dot  = $('gtinStatusDot')
  const text = $('gtinStatusText')
  if (!dot || !text) return
  try {
    const res = await fetch(`${API_BASE}/api/v1/gtin/config`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const cfg = await res.json()

    if (cfg.enabled && cfg.rowCount > 0) {
      dot.className  = 'gtin-status-dot ok'
      const name = cfg.databasePath ? cfg.databasePath.split(/[/\\]/).pop() : '–'
      text.textContent = `${cfg.rowCount} Einträge · ${name}`
    } else if (cfg.enabled && cfg.rowCount === 0) {
      dot.className  = 'gtin-status-dot warn'
      text.textContent = 'Aktiviert – keine Daten geladen'
    } else {
      dot.className  = 'gtin-status-dot off'
      text.textContent = 'Deaktiviert (GTIN_ENABLED=false)'
    }
  } catch (_) {
    if (dot) { dot.className = 'gtin-status-dot fail'; }
    if (text) text.textContent = 'Status nicht abrufbar'
  }
}

async function uploadGtinDatabase(file) {
  const statusEl = $('gtinUploadStatus')
  if (statusEl) { statusEl.hidden = false; statusEl.className = 'gtin-upload-status loading'; statusEl.textContent = `„${file.name}" wird hochgeladen …` }

  const form = new FormData()
  form.append('file', file)
  try {
    const res = await fetch(`${API_BASE}/api/v1/gtin/upload`, { method: 'POST', body: form })
    const data = await res.json()
    if (res.ok && data.success) {
      if (statusEl) { statusEl.className = 'gtin-upload-status ok'; statusEl.textContent = `✓ ${data.rowCount} Einträge importiert` }
    } else {
      if (statusEl) { statusEl.className = 'gtin-upload-status fail'; statusEl.textContent = `Fehler: ${data.error || res.status}` }
    }
    await loadGtinConfig()
  } catch (err) {
    if (statusEl) { statusEl.className = 'gtin-upload-status fail'; statusEl.textContent = `Upload fehlgeschlagen: ${err.message}` }
  }
}

async function lookupGtin() {
  const input  = $('gtinLookupInput')
  const result = $('gtinLookupResult')
  if (!input || !result) return
  const q = input.value.trim()
  if (!q) return

  result.hidden = false
  result.className = 'gtin-lookup-result loading'
  result.textContent = 'Suche …'

  const isGtin = /^\d{8,14}$/.test(q)
  const param  = isGtin ? `gtin=${encodeURIComponent(q)}` : `articleNumber=${encodeURIComponent(q)}`
  try {
    const res  = await fetch(`${API_BASE}/api/v1/gtin/filename?${param}`)
    const data = await res.json()
    if (res.ok && data.filename) {
      result.className = 'gtin-lookup-result ok'
      result.innerHTML = `
        <span class="gtin-result-label">Dateiname:</span>
        <code class="gtin-result-filename">${escapeHtml(data.filename)}</code>
        ${data.productName ? `<span class="gtin-result-meta">${escapeHtml(data.productName)}</span>` : ''}
        ${data.source === 'fallback' ? `<span class="gtin-result-warn">Kein Eintrag gefunden – Fallback</span>` : ''}
      `
    } else {
      result.className = 'gtin-lookup-result fail'
      result.textContent = data.error || 'Nicht gefunden'
    }
  } catch (err) {
    result.className = 'gtin-lookup-result fail'
    result.textContent = `Fehler: ${err.message}`
  }
}

function bindGtinSection() {
  const uploadZone = $('gtinDbUpload')
  const fileInput  = $('gtinFileInput')
  const lookupBtn  = $('btnGtinLookup')
  const lookupInput = $('gtinLookupInput')

  if (uploadZone) {
    uploadZone.addEventListener('click', () => fileInput?.click())
    uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('drag-over') })
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'))
    uploadZone.addEventListener('drop', (e) => {
      e.preventDefault(); uploadZone.classList.remove('drag-over')
      const file = [...e.dataTransfer.files].find(f => /\.(csv|xlsx)$/i.test(f.name))
      if (file) uploadGtinDatabase(file)
    })
  }
  if (fileInput) fileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0]
    if (file) uploadGtinDatabase(file)
    fileInput.value = ''
  })
  if (lookupBtn) lookupBtn.addEventListener('click', lookupGtin)
  if (lookupInput) lookupInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') lookupGtin() })
}

/* ═══════════════════════════════════════════════
   Init
   ═══════════════════════════════════════════════ */
async function checkAiHealth() {
  try {
    const res = await fetch(`${API_BASE}/api/v1/ai/health`)
    const ok = res.ok && (await res.json())?.available !== false
    const row = $('optClaudeRow')
    const cb  = $('optClaudeAI')
    const hint = $('optClaudeHint')
    if (row) row.style.opacity = ok ? '1' : '0.4'
    if (cb)  cb.disabled = !ok
    if (hint) hint.textContent = ok ? 'verfügbar' : 'nicht verfügbar'
  } catch (_) {
    const row = $('optClaudeRow')
    if (row) row.style.opacity = '0.4'
  }
}

function bindOptions() {
  $('optAutoLabel')?.addEventListener('change', (e) => {
    const row = $('optClaudeRow')
    if (row) row.style.opacity = e.target.checked ? '1' : '0.4'
    const cb = $('optClaudeAI')
    if (cb && !e.target.checked) cb.checked = false
  })
}

function init() {
  bindUpload()
  bindJobsFilters()
  bindGtinSection()
  bindOptions()
  checkHealth()
  loadGtinConfig()
  checkAiHealth()
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
  }
  if (PRODUCT_ID) {
    showProductContext()
  }
}

init()
