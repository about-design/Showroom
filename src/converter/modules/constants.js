/** Relativ zu Vite-Proxy: /api → Backend */
export const API_BASE = ''

export const ACCEPT_EXT = ['.obj', '.mtl', '.step', '.stp', '.zip', '.jpg', '.jpeg', '.png', '.tiff', '.tga', '.bmp']

const URL_PARAMS = new URLSearchParams(typeof location !== 'undefined' ? location.search : '')
export const MONITOR_JOB = URL_PARAMS.get('monitor')
export const PRODUCT_ID = URL_PARAMS.get('productId')
