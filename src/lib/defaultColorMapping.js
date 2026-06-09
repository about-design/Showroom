/**
 * Sentinel „Standardfarbe = Automatisch (MTL-Mapping)“ in products.defaultColor.
 * Effektive RAL-Farbe kommt aus _mtlColors.dominantRal (node scripts/sync-colors-from-mtl.mjs).
 */
import ColorService from '../services/ColorService.js'

export const DEFAULT_COLOR_FROM_MAPPING = '__mapping__'

export function isDefaultColorMappingAuto(value) {
  return String(value || '').trim() === DEFAULT_COLOR_FROM_MAPPING
}

/**
 * Showroom/Vorschau/Konverter: Produkt-Standardfarbe nutzen (statt nackter GLB-Materialien).
 * Entspricht dem früheren „Override an“, ohne separates Flag — sobald eine Standardfarbe gesetzt ist.
 */
export function usesProductDefaultSurfaceColor(product) {
  const dc = product?.defaultColor
  if (isDefaultColorMappingAuto(dc)) return true
  return !!(dc && String(dc).trim())
}

/**
 * Effektiver RAL-Code aus Stammdaten, wenn Mapping-Auto aktiv und Meta vorhanden.
 * @returns {string|null}
 */
export function resolveEffectiveDefaultColor(product) {
  if (!product?.defaultColor) return null
  if (isDefaultColorMappingAuto(product.defaultColor)) {
    const d = product._mtlColors?.dominantRal
    return d && ColorService.getRAL(d) ? d : null
  }
  return ColorService.getRAL(product.defaultColor) ? product.defaultColor : null
}

/**
 * Für Showroom/Vorschau: effektiver RAL oder Fallback, wenn Auto noch ohne Sync.
 * @returns {string}
 */
export function resolveEffectiveDefaultColorOrFallback(product) {
  const eff = resolveEffectiveDefaultColor(product)
  if (eff) return eff
  if (isDefaultColorMappingAuto(product?.defaultColor)) return ColorService.getDefaultRAL()
  return product?.defaultColor && ColorService.getRAL(product.defaultColor)
    ? product.defaultColor
    : ColorService.getDefaultRAL()
}

/**
 * Hex für Showroom/Dashboard-Vorschau ohne Sidebar-Farbe (wie selectProduct ohne explizites hex).
 * @param {object} product
 * @returns {string|null}
 */
export function resolveShowroomHexForProduct(product) {
  if (!usesProductDefaultSurfaceColor(product)) return null
  const effRal = resolveEffectiveDefaultColorOrFallback(product)
  if (effRal && ColorService.getRAL(effRal)) {
    return ColorService.ralToHex(effRal)
  }
  return null
}

/**
 * String für RAL-Regex in Vite (convert-product / register-converted).
 * Bei Auto: dominantRal oder leer → GTIN-Stamm (kein RAL aus GLB-Dateinamen).
 * @returns {string}
 */
export function resolveDefaultColorStringForPipeline(product) {
  if (!product?.defaultColor) return ''
  if (isDefaultColorMappingAuto(product.defaultColor)) {
    const d = product._mtlColors?.dominantRal
    return d && ColorService.getRAL(d) ? d : ''
  }
  return String(product.defaultColor).trim()
}
