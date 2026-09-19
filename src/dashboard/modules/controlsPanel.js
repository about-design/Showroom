export function initControlsPanel() {
  const panel = document.getElementById('dashboardControls')
  const body = document.getElementById('dashboardControlsBody')
  const toggle = document.getElementById('dashboardControlsToggle')
  const header = document.querySelector('.top-bar')
  if (!panel || !body || !toggle || !header) return

  const key = 'dash_controlsCollapsed'
  const setCollapsed = (collapsed) => {
    panel.classList.toggle('is-collapsed', collapsed)
    body.inert = collapsed
    body.setAttribute('aria-hidden', String(collapsed))
    toggle.setAttribute('aria-expanded', String(!collapsed))
    toggle.textContent = collapsed ? '▼' : '▲'
    toggle.title = collapsed ? 'Steuerbereich ausklappen' : 'Steuerbereich einklappen'
    toggle.setAttribute('aria-label', toggle.title)
  }
  let collapsed = false
  try { collapsed = localStorage.getItem(key) === 'true' } catch {}
  setCollapsed(collapsed)
  toggle.addEventListener('click', () => {
    collapsed = !collapsed
    setCollapsed(collapsed)
    try { localStorage.setItem(key, String(collapsed)) } catch {}
  })

  const updateHeaderHeight = () => {
    panel.style.setProperty('--dashboard-header-height', `${header.getBoundingClientRect().height}px`)
  }
  updateHeaderHeight()
  new ResizeObserver(updateHeaderHeight).observe(header)
}
