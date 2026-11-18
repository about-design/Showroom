export function initDetailSplitter() {
  const panel = document.getElementById('detailPanel')
  const handle = document.createElement('div')
  const storageKey = 'mara.detailSidebarWidthPercent'
  const defaultWidth = 35
  let width = defaultWidth
  let drag = null
  try {
    const saved = Number(localStorage.getItem(storageKey))
    if (Number.isFinite(saved) && saved >= 25 && saved <= 60) width = saved
  } catch {}
  handle.className = 'detail-splitter'
  handle.tabIndex = 0
  handle.setAttribute('role', 'separator')
  handle.setAttribute('aria-orientation', 'vertical')
  handle.setAttribute('aria-label', 'Breite der Produktdetail-Sidebar')
  handle.setAttribute('aria-controls', 'detailPanel')
  handle.setAttribute('aria-valuemin', '25')
  handle.setAttribute('aria-valuemax', '60')
  handle.title = `Ziehen: Breite ändern · Doppelklick: ${defaultWidth} %`
  panel.prepend(handle)
  const apply = () => {
    document.documentElement.style.setProperty('--detail-panel-preferred-width', `${width}vw`)
    handle.setAttribute('aria-valuenow', String(Math.round(width)))
    handle.setAttribute('aria-valuetext', `${Math.round(width)} Prozent`)
  }
  const save = () => {
    try { localStorage.setItem(storageKey, String(width)) } catch {}
  }
  const finish = () => {
    if (!drag) return
    const { id } = drag
    drag = null
    document.documentElement.classList.remove('detail-resizing')
    if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id)
    save()
  }
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary || drag) return
    event.preventDefault()
    event.stopPropagation()
    drag = { id: event.pointerId, x: event.clientX, width: panel.getBoundingClientRect().width }
    handle.setPointerCapture(event.pointerId)
    document.documentElement.classList.add('detail-resizing')
  })
  handle.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return
    event.preventDefault()
    width = Math.max(25, Math.min(60, (drag.width + drag.x - event.clientX) / innerWidth * 100))
    apply()
  })
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(type, finish)
  window.addEventListener('blur', finish)
  window.addEventListener('pagehide', finish)
  new MutationObserver(() => { if (!panel.classList.contains('open')) finish() }).observe(panel, { attributes: true, attributeFilter: ['class'] })
  handle.addEventListener('click', event => event.stopPropagation())
  handle.addEventListener('dblclick', event => {
    event.preventDefault()
    event.stopPropagation()
    width = defaultWidth
    apply()
    save()
  })
  handle.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return
    event.preventDefault()
    width = event.key === 'Home' ? defaultWidth : Math.max(25, Math.min(60, width + (event.key === 'ArrowLeft' ? 1 : -1)))
    apply()
    save()
  })
  apply()
}
