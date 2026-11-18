let expandedName = null
let outsideController = null

export function closeMeshNameExpansion() {
  outsideController?.abort()
  outsideController = null
  if (expandedName) {
    expandedName.label.setAttribute('aria-expanded', 'false')
    expandedName.full.remove()
    expandedName = null
  }
}

export function toggleMeshNameExpansion(label, forceOpen = false) {
  if (expandedName?.label === label) {
    if (!forceOpen) closeMeshNameExpansion()
    return
  }
  closeMeshNameExpansion()
  // Nur tatsächlich abgeschnittene Namen öffnen; die verfügbare Breite zählt.
  if (label.scrollWidth <= label.clientWidth) return
  const row = label.closest('.detail-mesh-row')
  if (!row) return
  const full = document.createElement('span')
  full.className = 'detail-mesh-name detail-mesh-full-name'
  full.id = label.getAttribute('aria-controls')
  full.textContent = label.textContent
  row.append(full)
  label.setAttribute('aria-expanded', 'true')
  expandedName = { label, full }
  outsideController = new AbortController()
  const options = { capture: true, signal: outsideController.signal }
  document.addEventListener('pointerdown', (event) => {
    if (!row.contains(event.target) && !event.target.closest('#meshNameContextMenu')) closeMeshNameExpansion()
  }, options)
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !document.getElementById('meshNameContextMenu')) closeMeshNameExpansion()
  }, options)
}
