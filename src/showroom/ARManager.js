/**
 * Zeigt auf Mobile ein model-viewer mit aktuellem Modell und RAL-Farbe.
 * Nur auf Touch-Geräten sichtbar; Farbübergabe via model-viewer Materials API.
 */
class ARManager {
  constructor() {
    this.container = document.getElementById('ar-container')
    this.viewer = document.getElementById('model-viewer')
    this.closeBtn = document.getElementById('ar-close')
    this.currentGlbUrl = null
    this.currentHex = '#D7D7D7'

    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', () => this.hide())
    }
  }

  /**
   * Prüft ob Touch-Gerät (einfache Heuristik).
   * @returns {boolean}
   */
  isTouchDevice() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0
  }

  /**
   * Zeigt die AR-Ansicht mit model-viewer.
   * @param {string} glbUrl - URL zum GLB (z.B. /models/products/regal-classic.glb)
   * @param {string} hexColor - z.B. "#D7D7D7"
   * @param {string} [usdzUrl] - optional: USDZ für iOS Quick Look
   */
  showAR(glbUrl, hexColor = '#D7D7D7', usdzUrl = '') {
    this.currentGlbUrl = glbUrl
    this.currentHex = hexColor

    if (!this.container || !this.viewer) {
      console.warn('[ARManager] ar-container oder model-viewer nicht gefunden')
      return
    }

    // Wenn keine echte GLB-URL (Placeholder), nutze einen Platzhalter-Hinweis
    const usePlaceholder = !glbUrl || glbUrl.includes('placeholder')
    if (usePlaceholder && !usdzUrl) {
      this.viewer.src = ''
      this.viewer.removeAttribute('ios-src')
      this.viewer.alt = 'AR-Vorschau – echte GLB- oder USDZ-Datei für AR erforderlich'
      this.container.classList.remove('hidden')
      return
    }

    this.viewer.src = glbUrl || usdzUrl
    if (usdzUrl) this.viewer.setAttribute('ios-src', usdzUrl)
    else this.viewer.removeAttribute('ios-src')
    this.viewer.alt = '3D-Modell in AR ansehen'
    this.container.classList.remove('hidden')

    // model-viewer Materials API: Farbe setzen sobald geladen
    this.viewer.addEventListener('load', () => {
      try {
        const model = this.viewer.model
        if (model && model.materials && model.materials.length) {
          model.materials.forEach((mat) => {
            if (mat.pbrMetallicRoughness && mat.pbrMetallicRoughness.baseColorFactor) {
              const c = hexToRgb(hexColor)
              mat.pbrMetallicRoughness.baseColorFactor = [c.r, c.g, c.b, 1]
            }
          })
        }
      } catch (e) {
        if (import.meta.env.DEV) console.warn('[ARManager] Materials API:', e)
      }
    })
  }

  /**
   * Versteckt die AR-Overlay.
   */
  hide() {
    if (this.container) this.container.classList.add('hidden')
  }
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? {
        r: parseInt(result[1], 16) / 255,
        g: parseInt(result[2], 16) / 255,
        b: parseInt(result[3], 16) / 255,
      }
    : { r: 0.84, g: 0.84, b: 0.84 }
}

export default new ARManager()
