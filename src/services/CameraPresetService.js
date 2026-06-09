/**
 * Persistiert benutzerdefinierte Kamera-Ansichten (Position, Target, Brennweite)
 * im localStorage. Presets gelten global – sie können auf jedes Modell angewendet
 * werden, da Modelle alle in dieselbe Welt-Zone platziert werden.
 */
import { createLogger } from '../lib/logger.js'
const log = createLogger("CameraPresetService")


const STORAGE_KEY = 'showroom.cameraPresets.v1'
const MAX_PRESETS = 24

/**
 * @typedef {Object} CameraPreset
 * @property {string} id - eindeutige ID (z. B. timestamp-basiert)
 * @property {string} name - Anzeigename
 * @property {{x:number,y:number,z:number}} position - Welt-Position der Kamera
 * @property {{x:number,y:number,z:number}} target - Welt-Position des OrbitControls-Targets
 * @property {number} focalLength - Brennweite (mm, Kleinbild-Äquivalent)
 * @property {number} createdAt - Unix-Timestamp (ms)
 */

class CameraPresetService {
  constructor() {
    /** @type {CameraPreset[]} */
    this.presets = []
    this._load()
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const data = JSON.parse(raw)
      if (!Array.isArray(data)) return
      this.presets = data.filter((p) => this._isValid(p))
    } catch (err) {
            log.scoped("CameraPresetService").warn("Konnte Presets nicht laden:", err)
      this.presets = []
    }
  }

  _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.presets))
    } catch (err) {
            log.scoped("CameraPresetService").warn("Konnte Presets nicht speichern:", err)
    }
  }

  _isValid(p) {
    return (
      p &&
      typeof p.id === 'string' &&
      typeof p.name === 'string' &&
      p.position && Number.isFinite(p.position.x) && Number.isFinite(p.position.y) && Number.isFinite(p.position.z) &&
      p.target && Number.isFinite(p.target.x) && Number.isFinite(p.target.y) && Number.isFinite(p.target.z) &&
      Number.isFinite(p.focalLength) && p.focalLength > 0
    )
  }

  /** @returns {CameraPreset[]} Kopie der Liste, sortiert nach createdAt aufsteigend. */
  list() {
    return [...this.presets].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
  }

  /** @returns {CameraPreset|null} */
  get(id) {
    return this.presets.find((p) => p.id === id) || null
  }

  /**
   * Speichert eine neue Ansicht. Bei vorhandener ID wird ersetzt.
   * @param {{name:string, position:{x,y,z}, target:{x,y,z}, focalLength:number, id?:string}} view
   * @returns {CameraPreset|null}
   */
  add(view) {
    if (!view) return null
    const preset = {
      id: view.id || `cp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: (view.name || 'Ansicht').trim().slice(0, 64) || 'Ansicht',
      position: { x: +view.position.x, y: +view.position.y, z: +view.position.z },
      target: { x: +view.target.x, y: +view.target.y, z: +view.target.z },
      focalLength: +view.focalLength,
      createdAt: Date.now(),
    }
    if (!this._isValid(preset)) return null
    const existing = this.presets.findIndex((p) => p.id === preset.id)
    if (existing >= 0) this.presets[existing] = preset
    else this.presets.push(preset)
    if (this.presets.length > MAX_PRESETS) {
      this.presets = this.presets.slice(-MAX_PRESETS)
    }
    this._save()
    return preset
  }

  /** Benennt ein Preset um. */
  rename(id, name) {
    const p = this.presets.find((x) => x.id === id)
    if (!p) return false
    p.name = (name || '').trim().slice(0, 64) || p.name
    this._save()
    return true
  }

  /** Entfernt ein Preset. */
  remove(id) {
    const before = this.presets.length
    this.presets = this.presets.filter((p) => p.id !== id)
    if (this.presets.length !== before) {
      this._save()
      return true
    }
    return false
  }

  /** Entfernt alle Presets. */
  clear() {
    this.presets = []
    this._save()
  }
}

export default new CameraPresetService()
