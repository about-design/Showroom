import { parseJsonResponse, escapeHtml } from './helpers.js'
import { API_BASE } from './constants.js'
import { $ } from './dom.js'

export async function loadGtinConfig() {
  const dot = $('gtinStatusDot')
  const text = $('gtinStatusText')
  if (!dot || !text) return
  try {
    const res = await fetch(`${API_BASE}/api/v1/gtin/config`)
    const cfg = await parseJsonResponse(res)
    if (!res.ok) throw new Error(cfg.error || cfg.message || `HTTP ${res.status}`)

    if (cfg.enabled && cfg.rowCount > 0) {
      dot.className = 'gtin-status-dot ok'
      const name = cfg.databasePath ? cfg.databasePath.split(/[/\\]/).pop() : '–'
      text.textContent = `${cfg.rowCount} Einträge · ${name}`
    } else if (cfg.enabled && cfg.rowCount === 0) {
      dot.className = 'gtin-status-dot warn'
      text.textContent = 'Aktiviert – keine Daten geladen'
    } else {
      dot.className = 'gtin-status-dot off'
      text.textContent = 'Deaktiviert (GTIN_ENABLED=false)'
    }
  } catch (_) {
    if (dot) {
      dot.className = 'gtin-status-dot fail'
    }
    if (text) text.textContent = 'Status nicht abrufbar'
  }
}

export async function uploadGtinDatabase(file) {
  const statusEl = $('gtinUploadStatus')
  if (statusEl) {
    statusEl.hidden = false
    statusEl.className = 'gtin-upload-status loading'
    statusEl.textContent = `„${file.name}" wird hochgeladen …`
  }

  const form = new FormData()
  form.append('file', file)
  try {
    const res = await fetch(`${API_BASE}/api/v1/gtin/upload`, { method: 'POST', body: form })
    const data = await parseJsonResponse(res)
    if (res.ok && data.success) {
      if (statusEl) {
        statusEl.className = 'gtin-upload-status ok'
        statusEl.textContent = `✓ ${data.rowCount} Einträge importiert`
      }
    } else if (statusEl) {
      statusEl.className = 'gtin-upload-status fail'
      statusEl.textContent = `Fehler: ${data.error || res.status}`
    }
    await loadGtinConfig()
  } catch (err) {
    if (statusEl) {
      statusEl.className = 'gtin-upload-status fail'
      statusEl.textContent = `Upload fehlgeschlagen: ${err.message}`
    }
  }
}

export async function lookupGtin() {
  const input = $('gtinLookupInput')
  const result = $('gtinLookupResult')
  if (!input || !result) return
  const q = input.value.trim()
  if (!q) return

  result.hidden = false
  result.className = 'gtin-lookup-result loading'
  result.textContent = 'Suche …'

  const isGtin = /^\d{8,14}$/.test(q)
  const param = isGtin ? `gtin=${encodeURIComponent(q)}` : `articleNumber=${encodeURIComponent(q)}`
  try {
    const res = await fetch(`${API_BASE}/api/v1/gtin/filename?${param}`)
    const data = await parseJsonResponse(res)
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

export function bindGtinSection() {
  const uploadZone = $('gtinDbUpload')
  const fileInput = $('gtinFileInput')
  const lookupBtn = $('btnGtinLookup')
  const lookupInput = $('gtinLookupInput')

  if (uploadZone) {
    uploadZone.addEventListener('click', () => fileInput?.click())
    uploadZone.addEventListener('dragover', (e) => {
      e.preventDefault()
      uploadZone.classList.add('drag-over')
    })
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'))
    uploadZone.addEventListener('drop', (e) => {
      e.preventDefault()
      uploadZone.classList.remove('drag-over')
      const file = [...e.dataTransfer.files].find((f) => /\.(csv|xlsx)$/i.test(f.name))
      if (file) uploadGtinDatabase(file)
    })
  }
  if (fileInput)
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0]
      if (file) uploadGtinDatabase(file)
      fileInput.value = ''
    })
  if (lookupBtn) lookupBtn.addEventListener('click', lookupGtin)
  if (lookupInput) lookupInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') lookupGtin()
  })
}
