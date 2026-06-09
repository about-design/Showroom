import * as THREE from 'three'
import ColorService from '../services/ColorService.js'
import { resolveEffectiveDefaultColorOrFallback } from '../lib/defaultColorMapping.js'
import { isPbrMaterial } from '../lib/materialUtils.js'

/**
 * Findet färbbare Meshes und wendet RAL/Hex auf MeshStandardMaterial an.
 * Politik: Die GLB ist die Wahrheit – die frühere heuristische Kappen-Erkennung
 * (Position + Namens-Hints + fixes Plastik-Material) wurde entfernt, weil
 * Kappen in der Bake-Pipeline explizit getaggt werden.
 */
class MaterialManager {
  constructor() {
    this.currentHex = ColorService.getDefaultHex()
    this.currentRAL = ColorService.getDefaultRAL()
    this.colorableMeshes = []
  }

  /**
   * Durchsucht ein Object3D nach Meshes und sammelt alle färbbaren Meshes.
   * @param {THREE.Object3D} object3D
   * @returns {THREE.Mesh[]}
   */
  traverseMeshes(object3D) {
    if (!object3D) return []
    const allMeshes = []
    object3D.traverse((o) => {
      if (o.isMesh) allMeshes.push(o)
    })
    this.colorableMeshes = allMeshes
    return this.colorableMeshes
  }

  /** Meshes wie applyRALColor / applyMaterialFinishOverride. */
  _colorableMeshesFor(object3D, forceTraverse) {
    if (forceTraverse && object3D) return this.traverseMeshes(object3D)
    return this.colorableMeshes.length ? this.colorableMeshes : this.traverseMeshes(object3D)
  }

  /**
   * @param {(mesh: THREE.Mesh, m: THREE.Material) => void} fn
   */
  _forEachColorableMaterial(object3D, forceTraverse, fn) {
    const meshes = this._colorableMeshesFor(object3D, forceTraverse)
    meshes.forEach((mesh) => {
      if (!mesh.material) return
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      mats.forEach((m) => fn(mesh, m))
    })
  }

  /**
   * Setzt Metallic/Roughness pro Material abhängig von der aktuellen Farbe:
   * nur exakt RAL 9007 = metallisch, alle anderen Farben = matt.
   * Wird genutzt wenn GLB-Originalfarben angezeigt werden (kein Override), damit keine falsch metallischen Flächen bleiben.
   * @param {THREE.Object3D} object3D - Gruppe/Mesh des Produkts
   */
  applyFinishFromMeshColors(object3D) {
    if (!object3D) return
    object3D.traverse((o) => {
      if (!o.isMesh || !o.material) return
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      mats.forEach((m) => this._applyFinishFromMeshSingleMaterial(m))
    })
  }

  /** Metallic/Roughness aus aktueller Mesh-Farbe (wie applyFinishFromMeshColors, nur ein Material). */
  _applyFinishFromMeshSingleMaterial(m) {
    if (!m || (m.metalness === undefined && m.metallic === undefined)) return
    const hex = m.color ? '#' + m.color.getHexString().padStart(6, '0') : null
    const finish = hex ? ColorService.getMaterialFinishFromHex(hex) : ColorService.getMaterialFinish(null)
    if (finish) {
      if (m.metalness !== undefined) m.metalness = finish.metallic
      if (m.metallic !== undefined) m.metallic = finish.metallic
      if (m.roughness !== undefined) m.roughness = finish.roughness
    }
  }

  /** Entfernt Base-Color-Map, damit Katalog-RAL/Regeln sichtbar werden (wie Bake ohne Textur-Override). */
  _stripBaseColorMapForRecolor(m) {
    if (!m || !isPbrMaterial(m)) return
    if (m.map) {
      m.map = null
      m.needsUpdate = true
    }
  }

  /**
   * Einheitlich: Base-Map-Handling, dann Vollfarbe (THREE.Color oder Hex-String), dann Finish.
   * @param {THREE.Material} m
   * @param {THREE.Color|string} fillColor
   * @param {{ metallic: number, roughness: number }|null} finish
   * @param {{ stripMaps: boolean }} opts
   */
  _recolorMaterial(m, fillColor, finish, opts) {
    const stripMaps = !!opts?.stripMaps
    if (stripMaps) this._stripBaseColorMapForRecolor(m)
    if (!stripMaps && m.map) {
      if (m.color) m.color.setRGB(1, 1, 1)
      else if (isPbrMaterial(m)) m.color = new THREE.Color(0xffffff)
    } else {
      const isColorObj = fillColor && typeof fillColor === 'object' && fillColor.isColor
      if (m.color) {
        if (isColorObj) m.color.copy(fillColor)
        else m.color.set(fillColor)
      } else if (isPbrMaterial(m)) {
        m.color = isColorObj ? fillColor.clone() : new THREE.Color(fillColor)
      }
    }
    if (finish) this._applyFinishToMaterial(m, finish)
    m.needsUpdate = true
  }

  /**
   * Setzt Farbe und Finish (nur RAL 9007 = metallisch, sonst matt) auf alle colorable Meshes.
   * @param {THREE.Object3D} object3D - Gruppe/Mesh des Produkts
   * @param {string} hexColor - z.B. "#D7D7D7"
   * @param {boolean} forceTraverse - wenn true, immer object3D durchsuchen (für Klone/zusammengesetzte Produkte)
   */
  /**
   * @param {object} [finishContext] - Optional: exakter RAL + Oberfläche (wie in products.json), damit Finish nicht nur aus Hex geraten wird.
   * @param {string} [finishContext.ralCode] - z. B. "RAL 2001"
   * @param {string} [finishContext.surfaceFinish] - "auto" | "verzinkt" | "pulver"
   */
  applyRALColor(object3D, hexColor, forceTraverse = false, finishContext = null, opts = null) {
    if (!object3D && !this.colorableMeshes.length) return
    const stripMaps = !!(opts && opts.stripColorMaps)
    this.currentHex = hexColor || ColorService.getDefaultHex()
    const color = new THREE.Color(hexColor)
    const finish = (() => {
      if (!finishContext) return ColorService.getMaterialFinishFromHex(hexColor)
      const rc = finishContext.ralCode != null ? String(finishContext.ralCode).trim() : ''
      const sf = finishContext.surfaceFinish
      if (rc && ColorService.getRAL(rc)) {
        return ColorService.getMaterialFinishWithSurface(rc, sf ?? 'auto')
      }
      return ColorService.getMaterialFinishFromHex(hexColor, sf ?? null)
    })()
    this._forEachColorableMaterial(object3D, forceTraverse, (_mesh, m) => {
      this._recolorMaterial(m, color, finish, { stripMaps })
    })
  }

  /** Setzt metallic/metalness und roughness auf ein Material (einheitlich für Showroom/Dashboard). */
  _applyFinishToMaterial(m, finish) {
    if (m.metalness !== undefined) m.metalness = finish.metallic
    if (m.metallic !== undefined) m.metallic = finish.metallic
    if (m.roughness !== undefined) m.roughness = finish.roughness
  }

  /**
   * Explizite PBR-Werte wie in Blender (Farbtests / Referenz), unabhängig von RAL-Logik.
   * Gilt für dieselben Meshes wie applyRALColor.
   * @param {THREE.Object3D} object3D
   * @param {{
   *   hex?: string,
   *   metalness?: number,
   *   metallic?: number,
   *   roughness?: number,
   *   ior?: number,
   * }} ov
   */
  applyMaterialFinishOverride(object3D, ov) {
    if (!object3D || !ov || typeof ov !== 'object') return
    const hex = ov.hex
    const metal = ov.metalness ?? ov.metallic
    const rough = ov.roughness
    const ior = ov.ior
    const hasHex = typeof hex === 'string' && hex.length >= 4
    let color = null
    if (hasHex) {
      try {
        color = new THREE.Color(hex)
      } catch {
        color = null
      }
    }
    this._forEachColorableMaterial(object3D, false, (_mesh, m) => {
      if (color && m.color) m.color.copy(color)
      const pbr = isPbrMaterial(m)
      if (pbr) {
        if (typeof metal === 'number' && Number.isFinite(metal)) m.metalness = metal
        if (typeof rough === 'number' && Number.isFinite(rough)) m.roughness = rough
        if (typeof ior === 'number' && Number.isFinite(ior) && m.isMeshPhysicalMaterial) m.ior = ior
      }
    })
  }

  /**
   * Setzt die aktuelle RAL-Bezeichnung (für UI). Hex wird aus ColorService abgeleitet.
   * @param {string} ralCode
   */
  setCurrentRAL(ralCode) {
    this.currentRAL = ralCode || ColorService.getDefaultRAL()
    this.currentHex = ColorService.ralToHex(this.currentRAL)
  }

  /** @returns {string} Aktuelle Hex-Farbe */
  getCurrentColor() {
    return this.currentHex
  }

  /** @returns {string} Aktueller RAL-Code */
  getCurrentRAL() {
    return this.currentRAL
  }

  /**
   * Standard: Base-Color-Maps beim RAL-Einfärben entfernen.
   * Mit `conversionPreset.keepBaseColorTexture === true` bleibt die Textur (z. B. Lochraster) sichtbar und wird nur mit `color` getönt.
   */
  shouldStripColorMapsForProduct(productData) {
    return productData?.conversionPreset?.keepBaseColorTexture !== true
  }

  /**
   * GLB Lighting Lab: PBR aus Preset (Metalness, Roughness, envMapIntensity).
   * Basisfarbe preset.mC nur wenn opts.tintBaseColor (Showroom: false, damit RAL/GLB z. B. Blau-Verzinkt bleibt).
   * @param {THREE.Object3D} root
   * @param {{ mM?: number, mR?: number, mC?: string, eI?: number }} preset
   * @param {{ tintBaseColor?: boolean }} opts
   */
  applyGlbLabPreset(root, preset, opts = {}) {
    if (!root || !preset) return
    const tintBaseColor = !!opts.tintBaseColor

    root.traverse((o) => {
      if (!o.isMesh || !o.material) return
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      if (!o.userData._showroomLabBackup) {
        o.userData._showroomLabBackup = mats.map((m) => {
          if (!isPbrMaterial(m)) return null
          return {
            metalness: m.metalness,
            roughness: m.roughness,
            envMapIntensity: m.envMapIntensity,
            color: m.color ? m.color.clone() : null,
          }
        })
      }
      mats.forEach((m) => {
        if (!isPbrMaterial(m)) return
        if (typeof preset.mM === 'number' && Number.isFinite(preset.mM)) m.metalness = preset.mM
        if (typeof preset.mR === 'number' && Number.isFinite(preset.mR)) m.roughness = preset.mR
        if (typeof preset.eI === 'number' && Number.isFinite(preset.eI) && m.envMapIntensity !== undefined) {
          m.envMapIntensity = preset.eI
        }
        if (tintBaseColor && preset.mC && m.color) {
          try {
            m.color.set(preset.mC)
          } catch {
            /* ignore */
          }
        }
        m.needsUpdate = true
      })
    })
  }

  /** Stellt Materialien nach GLB-Lab-Modus wieder her und entfernt Backups. */
  restoreAfterGlbLab(root) {
    if (!root) return
    root.traverse((o) => {
      const b = o.userData._showroomLabBackup
      if (!b || !o.material) return
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      mats.forEach((m, i) => {
        const snap = b[i]
        if (!m || !snap) return
        if (snap.metalness !== undefined) m.metalness = snap.metalness
        if (snap.roughness !== undefined) m.roughness = snap.roughness
        if (snap.envMapIntensity !== undefined && m.envMapIntensity !== undefined) {
          m.envMapIntensity = snap.envMapIntensity
        }
        if (snap.color && m.color) m.color.copy(snap.color)
        m.needsUpdate = true
      })
      delete o.userData._showroomLabBackup
    })
  }

  /**
   * Showroom / Platzierung: GLB wie nach Konvertierung (Bake). Keine Live-Overrides
   * aus Stammdaten (surfaceFinish, materialFinishOverride, Namensregeln/Mapping).
   * Ausnahme: wird eine nicht-leere `hexColor` übergeben, wird nur für die Vorschau
   * eingefärbt (z. B. nach erstem RAL-Klick oder wenn der Aufrufer explizit eine Farbe mitgibt).
   */
  applyProductAppearance(object3D, productData, hexColor) {
    if (!object3D) return
    const hasExplicitHex =
      hexColor != null && typeof hexColor === 'string' && String(hexColor).trim() !== ''
    if (!hasExplicitHex) return

    this.traverseMeshes(object3D)
    const stripColorMaps = this.shouldStripColorMapsForProduct(productData)
    const effRal = resolveEffectiveDefaultColorOrFallback(productData || {})
    const finishCtx = effRal && ColorService.getRAL(effRal)
      ? { ralCode: effRal, surfaceFinish: productData?.surfaceFinish }
      : { ralCode: null, surfaceFinish: productData?.surfaceFinish }
    this.applyRALColor(object3D, hexColor, false, finishCtx, { stripColorMaps })
  }
}

export default new MaterialManager()
