/**
 * Relative /api-URLs nutzen, wenn der Showroom über Vite (Dev oder Preview auf :5050) läuft –
 * dort leitet der Proxy an das API-Gateway (:3000) weiter.
 * Electron oder anderer Static-Server ohne Proxy: direkt :3000.
 */
function resolveApiBase() {
  if (import.meta.env.DEV) return ''
  if (typeof location !== 'undefined') {
    const port = location.port || (location.protocol === 'https:' ? '443' : '80')
    if (port === '5050') return ''
  }
  return 'http://localhost:3000'
}

export const API_BASE = resolveApiBase()

export const ACCEPT_EXT = ['.obj', '.mtl', '.step', '.stp', '.zip', '.jpg', '.jpeg', '.png', '.tiff', '.tga', '.bmp']

const URL_PARAMS = new URLSearchParams(typeof location !== 'undefined' ? location.search : '')
export const MONITOR_JOB = URL_PARAMS.get('monitor')
export const PRODUCT_ID = URL_PARAMS.get('productId')
