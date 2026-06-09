import { parseJsonResponse } from './helpers.js'
import { API_BASE } from './constants.js'
import { $ } from './dom.js'

export async function checkHealth() {
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

export async function checkAiHealth() {
  try {
    const res = await fetch(`${API_BASE}/api/v1/ai/health`)
    let data = {}
    try {
      data = await parseJsonResponse(res)
    } catch (_) {}
    const ok = res.ok && data?.available !== false
    const row = $('optClaudeRow')
    const cb = $('optClaudeAI')
    const hint = $('optClaudeHint')
    if (row) row.style.opacity = ok ? '1' : '0.4'
    if (cb) cb.disabled = !ok
    if (hint) hint.textContent = ok ? 'verfügbar' : 'nicht verfügbar'
  } catch (_) {
    const row = $('optClaudeRow')
    if (row) row.style.opacity = '0.4'
  }
}
