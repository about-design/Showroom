import { createLogger } from '../lib/logger.js'
const log = createLogger("LightingManager")

import * as THREE from 'three'
import { PMREMGenerator } from 'three'
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js'
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js'
import SceneManager from './SceneManager.js'
import { GLB_LAB_PRESETS, GLB_LAB_FILL_COLOR } from './glbLabLightingPresets.js'
import { EURIS } from './eurisConstants.js'
import { BASE } from './lighting/lightConstants.js'
import { applyFreeLightState } from './lighting/FreeAreaLight.js'
import { createShowroomRig } from './lighting/ShowroomRig.js'
import { createGlbLabRig } from './lighting/GlbLabRig.js'
import { createEurisRig } from './lighting/EurisRig.js'

/**
 * HDRI Environment (wenn vorhanden) + Spotlights / Ambient für den Lagerraum.
 * Koordinator: delegiert Rig-Aufbau an ./lighting/*.
 */
class LightingManager {
  constructor() {
    this.scene = SceneManager.getScene()
    this.lights = {}
    this.intensity = 1
    /** Gruppe für alle Lichter – wird bewusst nie gedreht/verschoben, damit Lichter fest im Weltraum bleiben. */
    this.lightsRoot = null
    this.showroomRig = null
    this.labRig = null
    this.eurisRig = null
    this._labActive = false
    /** @type {object|null} */
    this._labPreset = null
    this._labEnvTexture = null
    this._pmremGenerator = null
    /** scene.environment vor Lab (z. B. späteres HDRI) */
    this._environmentBeforeLab = null
    this._eurisActive = false
    this._eurisHdriTexture = null
    this._eurisEnvLoading = false
    /** @type {object|null} */
    this._freeLight = null
  }

  /**
   * Setzt Standard-Beleuchtung (ohne HDRI): weich für metallische Oberflächen inkl. Seitenlicht.
   */
  init() {
    RectAreaLightUniformsLib.init()

    const lightsRoot = new THREE.Group()
    lightsRoot.name = 'fixed-lights-root'
    lightsRoot.position.set(0, 0, 0)
    lightsRoot.quaternion.identity()
    lightsRoot.scale.set(1, 1, 1)
    lightsRoot.updateMatrixWorld = function (force) {
      this.matrix.identity()
      this.matrixWorld.identity()
      for (let i = 0; i < this.children.length; i++) {
        this.children[i].updateMatrixWorld(force)
      }
    }
    this.scene.add(lightsRoot)
    this.lightsRoot = lightsRoot

    const sr = createShowroomRig(lightsRoot)
    this.showroomRig = sr.showroomRig
    Object.assign(this.lights, sr.lights)
    this._freeLight = { ...sr.initialFreeLightState }

    const lab = createGlbLabRig(lightsRoot)
    this.labRig = lab.labRig
    Object.assign(this.lights, lab.lights)

    const er = createEurisRig(lightsRoot)
    this.eurisRig = er.eurisRig
    Object.assign(this.lights, er.lights)
  }

  _ensureLabEnvironmentMap() {
    if (this._labEnvTexture) return
    const renderer = SceneManager.getRenderer()
    if (!renderer) return
    if (!this._pmremGenerator) this._pmremGenerator = new PMREMGenerator(renderer)
    const envScene = new THREE.Scene()
    envScene.background = new THREE.Color(0xcccccc)
    this._labEnvTexture = this._pmremGenerator.fromScene(envScene, 0).texture
  }

  _disposeEurisHdri() {
    if (this._eurisHdriTexture) {
      this._eurisHdriTexture.dispose()
      this._eurisHdriTexture = null
    }
  }

  _deactivateLab() {
    if (!this._labActive) return
    this._labActive = false
    this._labPreset = null
    if (this.labRig) this.labRig.visible = false
    if (this.scene) {
      this.scene.environment = this._environmentBeforeLab
      this._environmentBeforeLab = null
    }
  }

  _tryLoadEurisHdri() {
    if (this._eurisEnvLoading || this._eurisHdriTexture) return
    this._eurisEnvLoading = true
    const loader = new RGBELoader()
    loader.load(
      EURIS.hdriPath,
      (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping
        this._eurisEnvLoading = false
        if (!this._eurisActive) {
          texture.dispose()
          return
        }
        this._disposeEurisHdri()
        this._eurisHdriTexture = texture
        if (this.scene) this.scene.environment = texture
      },
      undefined,
      () => {
        this._eurisEnvLoading = false
        if (!this._eurisActive || !this.scene) return
        if (import.meta.env.DEV) {
                    log.scoped("LightingManager").warn("Euris HDRI nicht geladen (", + EURIS.hdriPath + '), neutraler Fallback.')
        }
        this._ensureLabEnvironmentMap()
        if (this._labEnvTexture) {
          this._labEnvTexture.mapping = THREE.EquirectangularReflectionMapping
          this.scene.environment = this._labEnvTexture
        }
      },
    )
  }

  /**
   * Zentrale Umschaltung: Showroom | Euris | GLB-Lab-Preset.
   * @param {string} profileId - 'showroom' | 'euris' | verzinkt | studio | …
   */
  applyLightingProfile(profileId) {
    const labPreset = profileId && GLB_LAB_PRESETS[profileId] ? GLB_LAB_PRESETS[profileId] : null

    if (profileId === 'euris') {
      this._deactivateLab()
      this._disposeEurisHdri()
      if (this.showroomRig) this.showroomRig.visible = false
      if (this.labRig) this.labRig.visible = false
      if (this.eurisRig) this.eurisRig.visible = true
      this._eurisActive = true
      if (this.scene) {
        this.scene.environment = null
        this._tryLoadEurisHdri()
      }
      this.setIntensity(this.intensity)
      return
    }

    this._eurisActive = false
    if (this.eurisRig) this.eurisRig.visible = false
    this._disposeEurisHdri()

    if (labPreset) {
      if (!this._labActive) {
        this._environmentBeforeLab = this.scene?.environment ?? null
      }
      this._labActive = true
      this._labPreset = labPreset
      if (this.showroomRig) this.showroomRig.visible = false
      if (this.labRig) this.labRig.visible = true

      this._ensureLabEnvironmentMap()
      if (this.scene && this._labEnvTexture) {
        this._labEnvTexture.mapping = THREE.EquirectangularReflectionMapping
        this.scene.environment = this._labEnvTexture
      }

      const k = this.lights.labKey
      const f = this.lights.labFill
      const h = this.lights.labHemi
      if (k) {
        k.position.set(labPreset.dX, labPreset.dY, labPreset.dZ)
        k.color.set(labPreset.dC)
      }
      if (f) f.color.setHex(GLB_LAB_FILL_COLOR)
      if (h) {
        h.color.set(labPreset.hS)
        h.groundColor.set(labPreset.hG)
      }
      this.setIntensity(this.intensity)
      return
    }

    this._deactivateLab()
    if (this.showroomRig) this.showroomRig.visible = true
    if (this.scene) this.scene.environment = null
    this.setIntensity(this.intensity)
  }

  /**
   * @param {string|null} presetId - GLB-Lab-Key oder null (= Showroom)
   */
  setGlbLabPreset(presetId) {
    if (!presetId) this.applyLightingProfile('showroom')
    else this.applyLightingProfile(presetId)
  }

  /** @returns {boolean} */
  isGlbLabActive() {
    return this._labActive
  }

  /** @returns {boolean} */
  isEurisActive() {
    return this._eurisActive
  }

  /** Aktuelles Lab-Preset (nur wenn aktiv), sonst null */
  getGlbLabPreset() {
    return this._labActive ? this._labPreset : null
  }

  _syncLabLightIntensities() {
    const p = this._labPreset
    const s = this.intensity
    if (!p || !this._labActive) return
    if (this.lights.labKey) this.lights.labKey.intensity = p.dI * s
    if (this.lights.labFill) this.lights.labFill.intensity = p.fI * s
    if (this.lights.labHemi) this.lights.labHemi.intensity = p.hI * s
  }

  _syncEurisLightIntensities() {
    const s = this.intensity
    if (!this._eurisActive) return
    if (this.lights.eurisHemi) this.lights.eurisHemi.intensity = EURIS.hemiIntensity * s
    if (this.lights.eurisPoint) this.lights.eurisPoint.intensity = EURIS.pointIntensity * s
    if (this.lights.eurisAmbient) this.lights.eurisAmbient.intensity = EURIS.ambientIntensity * s
  }

  /**
   * Freies Flächenlicht: Position, Größe, Richtung (Yaw/Pitch), Stärke (0…1) – unabhängig vom globalen Regler.
   */
  setFreeLight(opts) {
    applyFreeLightState(
      {
        freeArea: this.lights.freeArea,
        freeAreaGroup: this.lights.freeAreaGroup,
        freeAreaHelper: this.lights.freeAreaHelper,
      },
      this._freeLight,
      opts,
    )
  }

  /**
   * Setzt die Lichtstärke (0 = dunkel, 1 = 100 % der Basis-Werte). Gilt für alle Lichter inkl. Seitenlicht.
   * @param {number} value - 0 … 1
   */
  setIntensity(value) {
    this.intensity = Math.max(0, Math.min(1, value))
    if (this._labActive && this._labPreset) {
      this._syncLabLightIntensities()
      return
    }
    if (this._eurisActive) {
      this._syncEurisLightIntensities()
      return
    }
    if (this.lights.ambient) this.lights.ambient.intensity = BASE.ambient * this.intensity
    if (this.lights.main) this.lights.main.intensity = BASE.main * this.intensity
    if (this.lights.fill) this.lights.fill.intensity = BASE.fill * this.intensity
    if (this.lights.sideLeft) this.lights.sideLeft.intensity = BASE.sideLeft * this.intensity
    if (this.lights.sideRight) this.lights.sideRight.intensity = BASE.sideRight * this.intensity
    if (this.lights.frontPanel) this.lights.frontPanel.intensity = BASE.frontPanel * this.intensity
    if (this.lights.frontKey) this.lights.frontKey.intensity = BASE.frontKey * this.intensity
    if (this.lights.backKey) this.lights.backKey.intensity = BASE.backKey * this.intensity
    if (this.lights.backLeft) this.lights.backLeft.intensity = BASE.backLeft * this.intensity
    if (this.lights.backRight) this.lights.backRight.intensity = BASE.backRight * this.intensity
    if (this.lights.topDown) this.lights.topDown.intensity = BASE.topDown * this.intensity
  }

  /**
   * Optional: HDRI als Environment setzen (wenn RoomEnvironment/SceneManager es lädt).
   * @param {THREE.Texture} envMap
   */
  setEnvironmentMap(envMap) {
    if (!envMap) return
    envMap.mapping = THREE.EquirectangularReflectionMapping
    this.scene.environment = envMap
  }
}

export default new LightingManager()
