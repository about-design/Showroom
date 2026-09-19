const key = 'mara.viewCubeSettings'
const listeners = new Set()
let settings = { showViewCube: true, viewCubePosition: 'right' }
const normalize = value => ({
  showViewCube: value?.showViewCube !== false,
  viewCubePosition: ['left', 'center', 'right'].includes(value?.viewCubePosition) ? value.viewCubePosition : 'right',
})
try { settings = normalize(JSON.parse(localStorage.getItem(key)) || settings) } catch {}
export function getViewCubeSettings() { return { ...settings } }
export function applyViewCubeSettings(value) {
  settings = normalize(value)
  try { localStorage.setItem(key, JSON.stringify(settings)) } catch {}
  listeners.forEach(fn => fn(settings))
}
export function subscribeViewCubeSettings(fn) {
  listeners.add(fn)
  fn(settings)
  return () => listeners.delete(fn)
}
window.addEventListener('storage', event => {
  if (event.key !== key) return
  try {
    settings = normalize(JSON.parse(event.newValue))
    listeners.forEach(fn => fn(settings))
  } catch {}
})
export async function loadViewCubeSettings() {
  try {
    const response = await fetch('/__api/file-manager-settings')
    if (response.ok) applyViewCubeSettings(await response.json())
  } catch { /* Static showroom deployments retain the local preference. */ }
}
