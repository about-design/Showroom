import { subscribeViewCubeSettings } from '../lib/viewCubeSettings.js'

export function initColorControls() {
  const panel = document.querySelector('.sr-color-controls')
  const button = panel?.querySelector('.sr-color-toggle')
  const viewport = document.getElementById('canvas-container')
  if (!panel || !button || !viewport) return () => {}
  const key = 'mara.colorControlsCollapsed'
  let collapsed = false
  let frame = 0
  let cube = null
  try { collapsed = localStorage.getItem(key) === 'true' } catch {}
  const update = () => {
    frame = 0
    const bounds = viewport.getBoundingClientRect()
    const header = document.querySelector('.sr-topbar')?.getBoundingClientRect()
    const sidebar = document.querySelector('.sr-sidebar')?.getBoundingClientRect()
    let top = Math.max(bounds.top + 8, (header?.bottom || 0) + 8)
    let bottom = bounds.bottom - 20
    // The mobile product drawer occupies the bottom of the preview.
    if (sidebar && sidebar.width >= bounds.width * .9 && sidebar.top > top && sidebar.top < bottom) bottom = sidebar.top - 10
    if (cube && !cube.hidden) top = Math.max(top, cube.getBoundingClientRect().bottom + 8)
    panel.style.left = `${bounds.left + bounds.width / 2}px`
    panel.style.maxWidth = `${Math.max(0, bounds.width - 16)}px`
    panel.style.maxHeight = `${Math.max(36, bottom - top)}px`
    panel.style.top = 'auto'
    panel.style.bottom = `${innerHeight - bottom}px`
    panel.dataset.collapsed = String(collapsed)
    panel.querySelector('.sr-color-controls-body').hidden = collapsed
    button.setAttribute('aria-expanded', String(!collapsed))
    button.textContent = collapsed ? '▲' : '▼'
    const label = collapsed ? 'Farbauswahl aufklappen' : 'Farbauswahl einklappen'
    button.title = label
    button.setAttribute('aria-label', label)
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }
  const cubeObserver = new MutationObserver(schedule)
  const observeCube = () => {
    const next = viewport.querySelector('.view-cube')
    if (next !== cube) {
      cubeObserver.disconnect()
      cube = next
      if (cube) cubeObserver.observe(cube, { attributes: true })
    }
    schedule()
  }
  const childrenObserver = new MutationObserver(observeCube)
  childrenObserver.observe(viewport, { childList: true })
  const resizeObserver = new ResizeObserver(schedule)
  for (const el of [viewport, document.querySelector('.sr-topbar'), document.querySelector('.sr-sidebar')]) if (el) resizeObserver.observe(el)
  const toggle = () => {
    collapsed = !collapsed
    try { localStorage.setItem(key, String(collapsed)) } catch {}
    update()
  }
  button.addEventListener('click', toggle)
  window.addEventListener('resize', schedule)
  const unsubscribe = subscribeViewCubeSettings(schedule)
  observeCube()
  update()
  return () => {
    cancelAnimationFrame(frame)
    resizeObserver.disconnect()
    childrenObserver.disconnect()
    cubeObserver.disconnect()
    unsubscribe()
    button.removeEventListener('click', toggle)
    window.removeEventListener('resize', schedule)
  }
}
