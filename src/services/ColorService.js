/**
 * Zentraler ColorService: Single Source of Truth für RAL-Palette und alle Farbkonvertierungen.
 * Konsumiert ralColors.json, bietet Lookups, Konvertierungen (hex/rgb/norm) und nearestRAL (Delta-E CIE76).
 */
import ralPalette from '../data/ralColors.json'
import { normalizeMappingHex } from '../lib/hexMapping.js'

const META_KEY = '_meta'
const DEFAULT_RAL = 'RAL 7035'
const DEFAULT_HEX = '#D7D7D7'

/** RAL 9007 = Verzinkt – bekommt metallisch/matt; alle anderen RAL = Pulverbeschichtet (matt, nicht metallisch). */
export const RAL_VERZINKT = 'RAL 9007'
const FINISH_VERZINKT = { metallic: 0.75, roughness: 0.25 }
const FINISH_RAL = { metallic: 0, roughness: 0.35 }

class ColorService {
  constructor() {
    this.palette = new Map()
    this.loadPalette(ralPalette)
  }

  /**
   * Lädt Palette aus JSON (Keys wie "RAL 7035", Werte { hex, name, popular }).
   * _meta wird ignoriert.
   */
  loadPalette(data) {
    this.palette.clear()
    if (!data || typeof data !== 'object') return
    for (const [key, val] of Object.entries(data)) {
      if (key === META_KEY || !val || typeof val !== 'object') continue
      if (val.hex) {
        this.palette.set(key, {
          hex: normalizeMappingHex(val.hex) || val.hex,
          name: val.name ?? key,
          popular: Boolean(val.popular),
        })
      }
    }
  }

  /** Einheitlicher Fallback-Hex (RAL 7035). */
  getDefaultHex() {
    return this.getRAL(DEFAULT_RAL)?.hex ?? DEFAULT_HEX
  }

  /** Einheitlicher Fallback-RAL-Code. */
  getDefaultRAL() {
    return DEFAULT_RAL
  }

  // --- Lookups ---

  ralToHex(ralCode, fallback = null) {
    const c = this.getRAL(ralCode)
    return (c && c.hex) ? c.hex : (fallback ?? this.getDefaultHex())
  }

  getRAL(ralCode) {
    if (!ralCode || typeof ralCode !== 'string') return null
    return this.palette.get(ralCode.trim()) ?? null
  }

  /** Findet RAL-Code zu einer Hex-Farbe (exakter Treffer in der Palette). Für Export von MTL→RAL-Mapping. */
  getRALCodeFromHex(hex) {
    const n = this.normalizeHex(hex)
    if (!n) return null
    const codes = []
    for (const [code, v] of this.palette) {
      if (this.normalizeHex(v.hex) === n) codes.push(code)
    }
    if (codes.length === 0) return null
    codes.sort((a, b) => a.localeCompare(b, 'en'))
    return codes[0]
  }

  /**
   * Material-Finish für Blender/Showroom: Verzinkt (RAL 9007) = 0,75 metallisch / 0,25 rau;
   * alle anderen RAL = 0 metallisch / 0,35 rau.
   * @param {string} ralCode - z. B. "RAL 9007" oder "RAL 7035"
   * @returns {{ metallic: number, roughness: number }}
   */
  getMaterialFinish(ralCode) {
    if (ralCode && String(ralCode).trim() === RAL_VERZINKT) return { ...FINISH_VERZINKT }
    return { ...FINISH_RAL }
  }

  /**
   * Explizite Oberfläche aus products.json (`surfaceFinish`), unabhängig von RAL/Hex.
   * @param {string} [surfaceFinish] - "verzinkt" | "pulver" | "auto" | ""
   * @returns {{ metallic: number, roughness: number } | null} null = automatisch per RAL
   */
  getExplicitSurfaceFinish(surfaceFinish) {
    const s = String(surfaceFinish || '').trim().toLowerCase()
    if (s === 'verzinkt') return { ...FINISH_VERZINKT }
    if (s === 'pulver') return { ...FINISH_RAL }
    return null
  }

  /**
   * Finish mit optionaler Produkt-Vorgabe: bei verzinkt/pulver diese Werte, sonst RAL-Logik.
   * @param {string} ralCode
   * @param {string} [surfaceFinish]
   */
  getMaterialFinishWithSurface(ralCode, surfaceFinish) {
    const rc = ralCode && String(ralCode).trim()
    const sf = String(surfaceFinish || '').trim().toLowerCase()
    // Verzinkt-Finish nur sinnvoll mit RAL 9007; sonst Pulver-Logik zur Zielfarbe (kein Metall bei RAL 7035 o. Ä.)
    if (sf === 'verzinkt') {
      if (rc === RAL_VERZINKT) return { ...FINISH_VERZINKT }
      if (rc) return this.getMaterialFinish(rc)
    }
    const ex = this.getExplicitSurfaceFinish(surfaceFinish)
    if (ex) return ex
    return this.getMaterialFinish(ralCode)
  }

  /** Wie getMaterialFinish, aber aus Hex: RAL-Code wird über getRALCodeFromHex ermittelt. */
  getMaterialFinishFromHex(hex, surfaceFinish = null) {
    const code = this.getRALCodeFromHex(hex)
    const sf = String(surfaceFinish || '').trim().toLowerCase()
    if (sf === 'verzinkt') {
      if (code === RAL_VERZINKT) return { ...FINISH_VERZINKT }
      if (code) return this.getMaterialFinish(code)
    }
    const ex = this.getExplicitSurfaceFinish(surfaceFinish)
    if (ex) return ex
    return this.getMaterialFinish(code)
  }

  /** Alle Farben als Array von { code, hex, name, popular }. */
  getAllColors() {
    return Array.from(this.palette.entries()).map(([code, v]) => ({
      code,
      hex: v.hex,
      name: v.name,
      popular: v.popular,
    }))
  }

  /** Nur Einträge mit popular: true. */
  getPopularColors() {
    return this.getAllColors().filter((c) => c.popular)
  }

  /** Objekt für Alpine/UI: { "RAL 7035": { hex, name, popular }, ... } */
  getPaletteObject() {
    const o = {}
    for (const [code, v] of this.palette) {
      o[code] = { hex: v.hex, name: v.name, popular: v.popular }
    }
    return o
  }

  // --- Konvertierungen ---

  /** Hex -> { r, g, b } 0–255. */
  hexToRgb(hex) {
    const n = this.hexToRgbNorm(hex)
    return n
      ? {
          r: Math.round(n.r * 255),
          g: Math.round(n.g * 255),
          b: Math.round(n.b * 255),
        }
      : null
  }

  /** Hex -> { r, g, b } 0–1 (für Three.js / model-viewer). */
  hexToRgbNorm(hex) {
    if (!hex || typeof hex !== 'string') return null
    const h = hex.replace(/^#/, '')
    if (h.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(h)) return null
    return {
      r: parseInt(h.slice(0, 2), 16) / 255,
      g: parseInt(h.slice(2, 4), 16) / 255,
      b: parseInt(h.slice(4, 6), 16) / 255,
    }
  }

  /** r,g,b in 0–1 oder 0–255 -> #RRGGBB. */
  rgbToHex(r, g, b) {
    const to255 = (v) => {
      if (typeof v !== 'number') return 0
      if (v >= 0 && v <= 1) return Math.round(v * 255)
      return Math.max(0, Math.min(255, Math.round(v)))
    }
    const rr = to255(r)
    const gg = to255(g)
    const bb = to255(b)
    return '#' + [rr, gg, bb].map((v) => v.toString(16).padStart(2, '0')).join('')
  }

  /** Normalisiert Hex zu #RRGGBB (uppercase). */
  normalizeHex(hex) {
    return normalizeMappingHex(hex)
  }

  // --- Delta-E CIE76 (RGB/Hex -> nächster RAL) ---

  /** sRGB (0–1) -> linear. */
  _srgbToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }

  /** RGB 0–255 -> CIE XYZ (D65). */
  _rgbToXyz(r, g, b) {
    const rl = this._srgbToLinear(r / 255)
    const gl = this._srgbToLinear(g / 255)
    const bl = this._srgbToLinear(b / 255)
    const x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375
    const y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750
    const z = rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041
    return { x, y, z }
  }

  /** CIE XYZ (D65) -> CIE Lab. */
  _xyzToLab(x, y, z) {
    const d65 = { x: 0.95047, y: 1, z: 1.08883 }
    const f = (t) => (t > 0.008856 ? Math.pow(t, 1 / 3) : t / 0.1284 + 0.1379)
    const l = 116 * f(y / d65.y) - 16
    const a = 500 * (f(x / d65.x) - f(y / d65.y))
    const b_ = 200 * (f(y / d65.y) - f(z / d65.z))
    return { l, a, b: b_ }
  }

  /** Delta-E CIE76 zwischen zwei Lab-Farben. */
  _deltaE76(lab1, lab2) {
    return Math.sqrt(
      Math.pow(lab1.l - lab2.l, 2) +
        Math.pow(lab1.a - lab2.a, 2) +
        Math.pow(lab1.b - lab2.b, 2)
    )
  }

  /**
   * Gültige Paletteinträge als RGB 0–255 (überspringt fehlerhafte Hex-Werte).
   * @param {(code: string, v: { hex: string, name: string, popular: boolean }, r: number, g: number, b: number) => void} cb
   */
  _forEachPaletteRgb255(cb) {
    for (const [code, v] of this.palette) {
      const m = (v.hex || '').replace(/^#/, '').match(/^([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/)
      if (!m) continue
      const pr = parseInt(m[1], 16)
      const pg = parseInt(m[2], 16)
      const pb = parseInt(m[3], 16)
      cb(code, v, pr, pg, pb)
    }
  }

  /** Nächster RAL-Code zu Hex (CIE76). Gibt { code, hex, name, deltaE } oder null zurück. */
  nearestRAL(hex) {
    const rgb = this.hexToRgb(hex)
    if (!rgb) return null
    return this.nearestRALFromRgb(rgb.r, rgb.g, rgb.b)
  }

  /** Nächster RAL-Code zu RGB 0–255 (Delta-E CIE76). */
  nearestRALFromRgb(r, g, b) {
    const lab = this._xyzToLab(this._rgbToXyz(r, g, b))
    let best = null
    let bestDe = Infinity
    this._forEachPaletteRgb255((code, v, pr, pg, pb) => {
      const plab = this._xyzToLab(this._rgbToXyz(pr, pg, pb))
      const de = this._deltaE76(lab, plab)
      if (de < bestDe) {
        bestDe = de
        best = { code, hex: v.hex, name: v.name, deltaE: de }
      }
    })
    return best
  }

  /**
   * Nächster RAL-Code zu RGB 0–255 nach quadriertem euklidischem Abstand im RGB-Raum.
   * Gleichstand: lexikographisch kleinster RAL-Code (wie tools/mtl-color-matching.html). Ausnahme: (132,126,120) → RAL 9007.
   * @returns {{ code: string, hex: string, name: string, distanceSq?: number } | null}
   */
  nearestRALFromRgbRgb(r, g, b) {
    const r1 = Math.max(0, Math.min(255, Math.round(Number(r)) || 0))
    const g1 = Math.max(0, Math.min(255, Math.round(Number(g)) || 0))
    const b1 = Math.max(0, Math.min(255, Math.round(Number(b)) || 0))
    // Häufiges Blender-MTL-Taupe (#847E78) → Verzinkt; RGB-„Nächster“ wäre sonst eher RAL 7035
    if (r1 === 132 && g1 === 126 && b1 === 120) {
      const vzk = this.getRAL('RAL 9007')
      if (vzk?.hex) {
        return { code: 'RAL 9007', hex: vzk.hex, name: vzk.name, distanceSq: 0 }
      }
    }
    const tied = []
    let bestD = Infinity
    this._forEachPaletteRgb255((code, v, r2, g2, b2) => {
      const d = (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2
      if (d < bestD) {
        bestD = d
        tied.length = 0
        tied.push({ code, hex: v.hex, name: v.name })
      } else if (d === bestD) {
        tied.push({ code, hex: v.hex, name: v.name })
      }
    })
    if (!tied.length) return null
    tied.sort((a, b) => a.code.localeCompare(b.code, 'en'))
    const best = tied[0]
    return { code: best.code, hex: best.hex, name: best.name, distanceSq: bestD }
  }

  // --- Palette-Verwaltung ---

  addColor(ralCode, hex, name, popular = false) {
    const key = (ralCode || '').trim()
    if (!key) return false
    const normalized = this.normalizeHex(hex) || hex
    this.palette.set(key, { hex: normalized, name: name ?? key, popular: Boolean(popular) })
    return true
  }

  removeColor(ralCode) {
    return this.palette.delete((ralCode || '').trim())
  }

  updateColor(ralCode, changes) {
    const key = (ralCode || '').trim()
    const cur = this.palette.get(key)
    if (!cur) return false
    if (changes.hex != null) cur.hex = this.normalizeHex(changes.hex) || cur.hex
    if (changes.name != null) cur.name = changes.name
    if (changes.popular != null) cur.popular = Boolean(changes.popular)
    this.palette.set(key, cur)
    return true
  }

  /** Gibt die Palette als JSON-kompatibles Objekt zurück (ohne _meta). */
  exportPalette() {
    const o = {}
    for (const [code, v] of this.palette) {
      o[code] = { hex: v.hex, name: v.name, popular: v.popular }
    }
    return o
  }
}

const instance = new ColorService()
export default instance
