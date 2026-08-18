import './lib/loggerInit.js'
import { createLogger } from './lib/logger.js'
import { resolveAssetUrl } from './lib/resolveAssetUrl.js'
const log = createLogger('showroom')

import './styles/main.css'
import * as THREE from 'three'
import Alpine from 'alpinejs'
import SceneManager from './showroom/SceneManager.js'
import LightingManager from './showroom/LightingManager.js'
import RoomEnvironment from './showroom/RoomEnvironment.js'
import ProductLoader from './showroom/ProductLoader.js'
import ProductPlacement from './showroom/ProductPlacement.js'
import MaterialManager from './showroom/MaterialManager.js'
import HotspotManager from './showroom/HotspotManager.js'
import CameraController from './showroom/CameraController.js'
import ARManager from './showroom/ARManager.js'
import LightDebugView from './showroom/LightDebugView.js'
import PivotDebugView from './showroom/PivotDebugView.js'
import performanceMonitor from './showroom/PerformanceMonitor.js'

// products.public.json = products.json ohne interne Dashboard/Konverter-Felder
// (_review, _mtlColors, cadFiles, …) – wird von scripts/lib/publicProducts.mjs
// generiert (Dev-Server-Start + bei jedem Speichern; Build: npm run build/check).
import productsData from './data/products.public.json'
import roomsData from './data/rooms.json'
import ColorService from './services/ColorService.js'
import CameraPresetService from './services/CameraPresetService.js'
import { requestBlenderRender } from './services/BlenderRenderService.js'
import {
  usesProductDefaultSurfaceColor,
  resolveEffectiveDefaultColorOrFallback,
  resolveShowroomHexForProduct,
} from './lib/defaultColorMapping.js'
import { GLB_LAB_PRESETS } from './showroom/glbLabLightingPresets.js'
import { EURIS } from './showroom/eurisConstants.js'
import {
  collectMeshesFromGroup,
  getColorFromMaterial,
  getMetalnessRoughness,
} from './lib/materialUtils.js'

const PRIMARY_ZONE = 'zone-2'
/** Anbau-Kette: Basis → +1 → +2 → +3 (jeweils ein Ständer rechts mehr). Button "Regal anbauen" wählt die nächste Stufe. */
const ANBAU_CHAIN = ['regal-zusammengebaut', 'regal-mit-anbau', 'regal-mit-2-anbau', 'regal-mit-3-anbau']
const room = roomsData.rooms[0] || {}
const placementZones = room.placementZones || [
  { id: 'zone-1', position: { x: -2, y: 0, z: 0 }, rotation: 0 },
  { id: 'zone-2', position: { x: 0, y: 0, z: 0 }, rotation: 0 },
  { id: 'zone-3', position: { x: 2, y: 0, z: 0 }, rotation: 0 },
]

function showroomApp() {
  return {
    products: productsData.products,
    ralColors: ColorService.getPaletteObject(),
    currentProduct: null,
    currentColor: ColorService.getDefaultRAL(),
    activeHotspot: null,
    isLoading: true,
    loadProgress: 0,
    loadStatus: 'Initialisiere …',
    isMobile: false,
    mobileMenuClosed: false,
    lightIntensity: 100,
    /** 'showroom' | 'euris' | GLB-Lab-Preset-ID (verzinkt, studio, …) */
    lightingProfile: 'showroom',
    /** Vorheriges Profil (für Material-Logik beim Profilwechsel) */
    _prevLightingProfile: 'showroom',
    /** true = GLB-Originalfarben (kein RAL-Override auf dem Produkt) */
    usesGlbOriginalColors: false,
    /** Freies Flächenlicht (RectArea): eigene Intensität, Größe, Richtung */
    freeLightEnabled: false,
    freeLightIntensity: 45,
    freeLightX: 3,
    freeLightY: 2.8,
    freeLightZ: 2.5,
    freeLightWidth: 2.6,
    freeLightHeight: 1.8,
    /** Horizontal (°): 0 → Emission +Z, 90° → +X */
    freeLightYaw: -130,
    /** Neigung (°): 0 = horizontal */
    freeLightPitch: -27,
    showLightDebug: false,
    showPivotDebug: false,
    showMeshInfo: false,
    /** Performance-Test-Overlay (Geometrie, GPU-Schätzung, Stresstest) */
    perfPanelOpen: false,
    perfStats: null,
    perfStressRunning: false,
    perfStressResult: null,
    perfStressN: 4,
    /** Liste { name, color, vertices, … } für das aktuelle Produktmodell */
    meshInfoList: [],
    /** null = alle Meshes sichtbar; sonst nur der Eintrag mit diesem Index */
    meshIsolateIndex: null,
    productCameras: [],
    selectedCameraId: 'orbit',
    /** Verfügbare Brennweiten (Kleinbild-Äquivalent, mm) für die Objektivauswahl. */
    focalLengths: [16, 24, 50, 100, 200],
    /** Aktuell gewählte Brennweite (mm). Initial: 24 mm (Weitwinkel, nahe am Three.js-Default 60° FOV). */
    focalLength: 24,
    /** Gespeicherte Kameraansichten (Position + Target + Brennweite, persistiert via localStorage). */
    cameraPresets: [],
    /** Eingabewert für den Namen einer neu zu speichernden Kameraansicht. */
    newCameraPresetName: '',
    /** Blender-Render (lokal, /__api/blender-render) */
    blenderEngine: 'eevee',
    blenderResId: 'hd',
    /** 'landscape' (16:9 wie bisher) oder 'square' (1:1, kürzere Kante). */
    blenderAspectId: 'landscape',
    /** 'png' (transparent + Shadow-Catcher-Alpha) oder 'jpg' (weißer Hintergrund, kein Alpha). */
    blenderFormat: 'png',
    isBlenderRendering: false,
    blenderRenderError: '',
    showOriginalOrientation: false,
    sidebarClosed: false,
    sidebarPeek: false,
    settingsOpen: false,
    /** RAL-Code oder null = alle Farben. Filtert die Produktliste nach defaultColor. */
    colorFilter: null,

    /** Produkte, gefiltert nach colorFilter (defaultColor). */
    get filteredProducts() {
      if (!this.colorFilter) return this.products
      return this.products.filter(
        (p) => resolveEffectiveDefaultColorOrFallback(p) === this.colorFilter,
      )
    },

    setColorFilter(ralCode) {
      this.colorFilter = ralCode || null
      const list = this.filteredProducts
      const stillVisible = this.currentProduct && list.some((p) => p.id === this.currentProduct.id)
      if (!stillVisible && list.length) {
        this.selectProduct(list[0])
      }
    },

    init() {
      this.isMobile = ARManager.isTouchDevice()
      ProductLoader.on('load-progress', (e) => {
        this.loadProgress = e.detail.progress
        this.loadStatus = e.detail.path ? `Lade ${e.detail.path} …` : 'Lade …'
      })
      ProductLoader.on('load-complete', () => {
        this.isLoading = false
        this.loadStatus = 'Fertig'
      })
      ProductLoader.on('load-error', () => {
        this.isLoading = false
        this.loadStatus = 'Fehler beim Laden'
      })

      HotspotManager.onHotspotClick((e) => {
        this.activeHotspot = {
          id: e.detail.id,
          title: e.detail.title,
          content: e.detail.content,
        }
      })

      RoomEnvironment.init(placementZones)
      LightingManager.init()
      LightDebugView.init()
      PivotDebugView.init()
      SceneManager.onTick = (delta) => {
        CameraController.update()
        HotspotManager.updatePositions()
        LightDebugView.updatePositions()
        PivotDebugView.updatePositions(PRIMARY_ZONE)
      }
      SceneManager.start()
      this.setLightIntensity()
      this.syncFreeLight()
      CameraController.setFocalLength(this.focalLength)
      this.cameraPresets = CameraPresetService.list()

      const urlProduct = new URLSearchParams(window.location.search).get('product')
      this._resolveInitialProduct(urlProduct).then((initial) => {
        if (initial) {
          this.selectProduct(initial)
        } else {
          this.isLoading = false
          this.loadStatus = this.products.length
            ? 'Kein Startprodukt gefunden'
            : 'Keine Produkte – GLB-Dateien nach public/models/ legen und npm run products:update'
        }
      })
    },

    /**
     * Ermittelt das Start-Produkt. Hintergrund: Vite ignoriert `src/data/products.json`
     * beim Watchen (siehe vite.config.js), deshalb enthält der statisch importierte
     * Array frisch im Dashboard angelegte Produkte noch nicht. Fällt der Lookup im
     * Array fehl, laden wir das Produkt zur Laufzeit aus `/__api/products/:id`
     * nach und hängen es an `this.products`. In Prod-Builds ohne API gibt es
     * weiterhin den Fallback auf `this.products[0]`.
     * @param {string|null} urlProductId
     * @returns {Promise<object|null>}
     */
    async _resolveInitialProduct(urlProductId) {
      if (!urlProductId) return this.products[0] || null
      const fromArray = this.products.find((p) => p.id === urlProductId)
      if (fromArray) return fromArray
      try {
        const res = await fetch(`/__api/products/${encodeURIComponent(urlProductId)}`, {
          headers: { Accept: 'application/json' },
        })
        if (res.ok) {
          const fresh = await res.json()
          if (fresh && fresh.id) {
            this.products = [...this.products, fresh]
            return fresh
          }
        }
      } catch (_) {
        // API nicht erreichbar (z. B. Prod-Build ohne Dashboard-API) – unten Fallback.
      }
      if (import.meta.env.DEV) {
                log.warn(`[Showroom] Produkt "${urlProductId}" nicht in products.json, Fallback auf erstes Produkt.`)
      }
      return this.products[0] || null
    },

    setLightIntensity() {
      const p = this.lightIntensity / 100
      const factor = p * p
      LightingManager.setIntensity(factor)
      if (LightingManager.isGlbLabActive()) {
        const preset = LightingManager.getGlbLabPreset()
        if (preset) SceneManager.setLabExposure(preset.sE, factor)
      } else if (LightingManager.isEurisActive()) {
        SceneManager.setToneMappingExposureAbsolute(factor)
      } else {
        SceneManager.setExposure(factor)
        RoomEnvironment.setCeilingIntensity(factor)
      }
    },

    onLightingProfileChange() {
      const id = this.lightingProfile
      const prev = this._prevLightingProfile ?? 'showroom'
      const wasLab = !!GLB_LAB_PRESETS[prev]
      const isLab = !!GLB_LAB_PRESETS[id]
      /** Nur beim Verlassen von GLB Lab: Preset-PBR zurücksetzen, sonst bleibt die Produktfarbe unverändert. */
      const leavingLab = wasLab && !isLab

      const placement = ProductPlacement.getPlacement(PRIMARY_ZONE)
      const group = placement?.group
      const model = placement?.model || group

      const restoreMaterialsAfterLeavingLab = () => {
        if (!leavingLab) return
        // restoreAfterGlbLab bringt Metalness/Roughness/envMap + Color Pixel-genau
        // aus dem Snapshot zurück – damit ist die GLB wieder im Originalzustand.
        if (group) MaterialManager.restoreAfterGlbLab(group)
        // Nur wenn der User eine explizite Farbe gewählt hatte, wird sie neu aufgebracht.
        // GLB-1:1-Fall (usesGlbOriginalColors): nichts drauflegen, der Snapshot war bereits korrekt.
        if (this.currentProduct && model && !this.usesGlbOriginalColors) {
          const hex = ColorService.ralToHex(this.currentColor)
          const fc = ColorService.getRAL(this.currentColor)
            ? { ralCode: this.currentColor, surfaceFinish: this.currentProduct?.surfaceFinish }
            : null
          MaterialManager.applyRALColor(model, hex, false, fc, {
            stripColorMaps: MaterialManager.shouldStripColorMapsForProduct(this.currentProduct),
          })
        }
        this.updateMeshInfo()
      }

      try {
        if (id === 'showroom') {
          LightingManager.applyLightingProfile('showroom')
          CameraController.setEurisMode(false)
          RoomEnvironment.setEurisMode(false)
          SceneManager.setBackgroundColor(0xfafafa)
          RoomEnvironment.setFloorColor(0xfafafa)
          restoreMaterialsAfterLeavingLab()
          this.setLightIntensity()
          return
        }

        if (id === 'euris') {
          LightingManager.applyLightingProfile('euris')
          CameraController.setEurisMode(true)
          RoomEnvironment.setEurisMode(true)
          SceneManager.setBackgroundColor(EURIS.background)
          RoomEnvironment.setFloorColor(EURIS.floor)
          restoreMaterialsAfterLeavingLab()
          this.setLightIntensity()
          return
        }

        LightingManager.applyLightingProfile(id)
        CameraController.setEurisMode(false)
        RoomEnvironment.setEurisMode(false)
        const preset = GLB_LAB_PRESETS[id]
        if (preset) {
          SceneManager.setBackgroundColor(preset.sB)
          RoomEnvironment.setFloorColor(preset.sB)
        }
        this.setLightIntensity()
        this.syncGlbLabMaterials()
      } finally {
        this._prevLightingProfile = id
      }
    },

    syncGlbLabMaterials() {
      if (!LightingManager.isGlbLabActive()) return
      const preset = LightingManager.getGlbLabPreset()
      const group = ProductPlacement.getPlacement(PRIMARY_ZONE)?.group
      if (!preset || !group) return
      // Kein preset.mC: sonst würde z. B. „Verzinkt“-Grau Blau-Verzinkt / RAL aus dem GLB überschreiben.
      MaterialManager.applyGlbLabPreset(group, preset, { tintBaseColor: false })
    },

    syncFreeLight() {
      LightingManager.setFreeLight({
        enabled: this.freeLightEnabled,
        intensity: this.freeLightIntensity / 100,
        x: this.freeLightX,
        y: this.freeLightY,
        z: this.freeLightZ,
        width: this.freeLightWidth,
        height: this.freeLightHeight,
        yawDeg: this.freeLightYaw,
        pitchDeg: this.freeLightPitch,
      })
    },

    selectProductById(productId, hexColor) {
      const product = this.products.find((p) => p.id === productId)
      if (product) this.selectProduct(product, hexColor)
    },

    /** Nächste Anbau-Stufe (ein Ständer rechts mehr). Sichtbar, wenn aktuelles Regal in der Kette ist und es eine nächste Stufe gibt. */
    addAnbau() {
      if (!this.currentProduct) return
      const idx = ANBAU_CHAIN.indexOf(this.currentProduct.id)
      if (idx < 0 || idx >= ANBAU_CHAIN.length - 1) return
      this.selectProductById(ANBAU_CHAIN[idx + 1])
    },
    get canAddAnbau() {
      if (!this.currentProduct) return false
      const idx = ANBAU_CHAIN.indexOf(this.currentProduct.id)
      return idx >= 0 && idx < ANBAU_CHAIN.length - 1
    },

    selectProduct(product, hexColor) {
      if (!product) return
      this.meshIsolateIndex = null
      this.perfStats = null
      this.perfStressResult = null
      performanceMonitor.clearStress(SceneManager.getScene())
      this.currentProduct = product
      // Politik (Stand 2026-04-18): Die GLB ist die Wahrheit.
      //   1) Explizit übergebene hexColor (z. B. RAL-Klick in der Sidebar) übermalt.
      //   2) Ohne explizite Farbe wird die GLB 1:1 angezeigt – die Standardfarbe
      //      wurde bereits in die GLB gebacken und wird nicht mehr live übergepinselt.
      // `currentColor` wird für die Sidebar-Anzeige weiterhin auf den RAL-Code
      // aus den Stammdaten gesetzt.
      const useProductColor = usesProductDefaultSurfaceColor(product)
      let hex
      if (hexColor !== undefined && hexColor !== null) {
        hex = hexColor || ColorService.ralToHex(this.currentColor)
      } else if (useProductColor) {
        hex = null
        this.currentColor = resolveEffectiveDefaultColorOrFallback(product) || ColorService.getDefaultRAL()
      } else {
        hex = null
        this.currentColor = ColorService.getDefaultRAL()
      }
      this.usesGlbOriginalColors = hex === null
      MaterialManager.setCurrentRAL(this.currentColor)

      this.loadStatus = `Lade ${product.name} …`
      this.isLoading = true
      this.loadProgress = 0

      ProductPlacement.placeProduct(PRIMARY_ZONE, product.id, product, hex, this.products).then((group) => {
        this.isLoading = false
        this.showOriginalOrientation = false
        if (group) {
          HotspotManager.setProductHotspots(group, product.hotspots)
          this.productCameras = ProductPlacement.getProductCameras(PRIMARY_ZONE)
          this.selectedCameraId = 'orbit'
          const center = ProductPlacement.getProductCenter(PRIMARY_ZONE)
          const worldBox = ProductPlacement.getProductBoundingBox(PRIMARY_ZONE)
          if (center) CameraController.focusProduct(center, 0.8, worldBox)
          this.syncGlbLabMaterials()
          this.updateMeshInfo()
          if (this.perfPanelOpen) this.refreshPerfStats()
        }
      }).catch((err) => {
        this.isLoading = false
        this.loadStatus = 'Fehler beim Laden'
        if (import.meta.env.DEV) log.scoped("Showroom").error("placeProduct fehlgeschlagen:", err)
      })
    },

    selectModelCamera(cam) {
      if (!cam || cam.id === 'orbit') return
      this.selectedCameraId = cam.id
      CameraController.setToView(cam, 0.6)
    },

    onCameraSelect(value) {
      this.selectedCameraId = value
      if (value !== 'orbit') {
        const c = this.productCameras.find((p) => p.id === value)
        if (c) this.selectModelCamera(c)
      }
    },

    selectColor(ralCode) {
      this.currentColor = ralCode
      this.usesGlbOriginalColors = false
      this.perfStats = null
      const hex = ColorService.ralToHex(ralCode)
      MaterialManager.setCurrentRAL(ralCode)
      if (this.currentProduct) {
        ProductPlacement.updateColor(PRIMARY_ZONE, hex, ralCode)
        this.syncGlbLabMaterials()
        this.updateMeshInfo()
        if (this.perfPanelOpen) this.refreshPerfStats()
      }
    },

    /** Sammelt Meshes aus dem platzierten Modell: Name, Farbe, Vertices, Metallisch, Rauheit. */
    updateMeshInfo() {
      const placement = ProductPlacement.getPlacement(PRIMARY_ZONE)
      if (!placement?.group) {
        this.meshInfoList = []
        this.meshIsolateIndex = null
        return
      }
      const list = []
      placement.group.traverse((obj) => {
        if (!obj.isMesh) return
        const geom = obj.geometry
        const mat = obj.material
        const vertices = geom?.attributes?.position?.count ?? 0
        const color = getColorFromMaterial(mat)
        const { metalness, roughness, hasMRMap } = getMetalnessRoughness(mat)
        list.push({
          name: obj.name || '(ohne Namen)',
          color: color || '#888',
          vertices,
          metalness,
          roughness,
          hasMRMap,
        })
      })
      this.meshInfoList = list
      if (this.meshIsolateIndex != null && this.meshIsolateIndex >= list.length) {
        this.meshIsolateIndex = null
      }
      this._applyMeshPartVisibility()
    },

    _applyMeshPartVisibility() {
      const placement = ProductPlacement.getPlacement(PRIMARY_ZONE)
      if (!placement?.group) return
      const meshes = collectMeshesFromGroup(placement.group)
      const idx = this.meshIsolateIndex
      meshes.forEach((m, i) => {
        m.visible = idx === null || i === idx
      })
    },

    toggleMeshPartIsolate(index) {
      if (this.meshIsolateIndex === index) this.meshIsolateIndex = null
      else this.meshIsolateIndex = index
      this._applyMeshPartVisibility()
    },

    clearMeshPartIsolate() {
      this.meshIsolateIndex = null
      this._applyMeshPartVisibility()
    },

    /** Kamera auf Bounding-Box eines Mesh-Teils (Weltkoordinaten). */
    focusMeshPart(index) {
      const placement = ProductPlacement.getPlacement(PRIMARY_ZONE)
      if (!placement?.group) return
      const meshes = collectMeshesFromGroup(placement.group)
      const mesh = meshes[index]
      if (!mesh) return
      mesh.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(mesh)
      if (box.isEmpty()) return
      const center = box.getCenter(new THREE.Vector3())
      CameraController.focusProduct(center, 0.65, box)
      this.selectedCameraId = 'orbit'
    },

    openAR() {
      const glb = resolveAssetUrl(this.currentProduct?.glbFile || '')
      const usdz = resolveAssetUrl(this.currentProduct?.usdzFile || '')
      const hex = ColorService.ralToHex(this.currentColor)
      ARManager.showAR(glb, hex, usdz)
    },

    resetCamera() {
      this.selectedCameraId = 'orbit'
      CameraController.resetCamera()
    },

    /** Wechselt die virtuelle Objektiv-Brennweite (Kleinbild-Äquivalent, mm). */
    setFocalLength(mm) {
      const f = Number(mm)
      if (!Number.isFinite(f) || f <= 0) return
      this.focalLength = f
      CameraController.setFocalLength(f)
    },

    /** Speichert die aktuelle Kameraansicht (Position, Target, Brennweite) als Preset. */
    saveCameraPreset() {
      const view = CameraController.getCurrentView()
      const fallbackName = `Ansicht ${this.cameraPresets.length + 1}`
      const name = (this.newCameraPresetName || '').trim() || fallbackName
      const preset = CameraPresetService.add({ ...view, name })
      if (!preset) return
      this.cameraPresets = CameraPresetService.list()
      this.newCameraPresetName = ''
    },

    /** Wendet ein gespeichertes Preset auf die aktuelle Kamera an. */
    applyCameraPreset(id) {
      const preset = CameraPresetService.get(id)
      if (!preset) return
      this.selectedCameraId = 'orbit'
      this.focalLength = preset.focalLength
      CameraController.setToView(preset, 0.6)
    },

    /** Entfernt ein gespeichertes Preset. */
    deleteCameraPreset(id) {
      if (!CameraPresetService.remove(id)) return
      this.cameraPresets = CameraPresetService.list()
    },

    /** Triggert einen Browser-Download des übergebenen Blobs. */
    _downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    },

    /** Erzeugt einen kleinbuchstaben-/bindestrich-sicheren Dateinamen. */
    _slugify(str) {
      return String(str || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'modell'
    },

    /** Erzeugt einen Dateinamen "<produkt>_<farbe>_<suffix>_<zeitstempel>.png". */
    _buildCaptureFilename(suffix) {
      const productSlug = this._slugify(this.currentProduct?.name || this.currentProduct?.id)
      const colorSlug = this.currentColor ? this._slugify(this.currentColor) : 'original'
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      return `${productSlug}_${colorSlug}_${suffix}_${ts}.png`
    },

    /**
     * Speichert die aktuelle Ansicht als PNG mit transparentem Hintergrund:
     * Boden, Wände und Hintergrundfarbe werden temporär entfernt, sodass nur
     * das Modell sichtbar ist. Danach wird der ursprüngliche Zustand wiederhergestellt.
     */
    async captureProductImage() {
      if (this._isCapturing) return
      this._isCapturing = true
      RoomEnvironment.setEnvironmentVisible(false)
      try {
        const blob = await SceneManager.captureScreenshot({ transparent: true })
        this._downloadBlob(blob, this._buildCaptureFilename('freigestellt'))
      } catch (err) {
                log.scoped("Showroom").error("Freigestellt-Screenshot fehlgeschlagen:", err)
      } finally {
        RoomEnvironment.setEnvironmentVisible(true)
        this._isCapturing = false
      }
    },

    /**
     * Speichert die aktuelle Ansicht 1:1 als PNG – inklusive Boden, Wände und
     * Hintergrundfarbe des aktiven Lighting-Profils.
     */
    async captureSceneImage() {
      if (this._isCapturing) return
      this._isCapturing = true
      try {
        const blob = await SceneManager.captureScreenshot({ transparent: false })
        this._downloadBlob(blob, this._buildCaptureFilename('szene'))
      } catch (err) {
                log.scoped("Showroom").error("Szenen-Screenshot fehlgeschlagen:", err)
      } finally {
        this._isCapturing = false
      }
    },

    /**
     * Auflösung für Blender-Render (PNG). Bei Seitenverhältnis "square" wird die kürzere
     * Kante als Quadrat-Seite verwendet (entspricht dem im Showroom angezeigten Ausschnitt).
     */
    getBlenderResolutionPixels() {
      const map = {
        hd: { width: 1920, height: 1080 },
        '2k': { width: 2560, height: 1440 },
        '4k': { width: 3840, height: 2160 },
      }
      const base = map[this.blenderResId] || map.hd
      if (this.blenderAspectId === 'square') {
        const side = Math.min(base.width, base.height)
        return { width: side, height: side }
      }
      return base
    },

    /**
     * Headless-Render via Blender (Cycles/Eevee), transparent + Shadow-Catcher.
     * Erfordert `npm run dev` und gesetztes BLENDER_PATH (siehe README).
     */
    async renderInBlender() {
      if (this.isBlenderRendering || !this.currentProduct?.glbFile) return
      this.isBlenderRendering = true
      this.blenderRenderError = ''
      try {
        let hex = '#D7D7D7'
        if (!this.usesGlbOriginalColors) {
          const h = ColorService.ralToHex(this.currentColor)
          hex = h && h.startsWith('#') ? h : `#${String(h || '').replace(/^#/, '')}`
        }
        const glbPath = resolveAssetUrl(this.currentProduct.glbFile)

        const col16 = (m) => (m && m.matrixWorld ? Array.from(m.matrixWorld.elements) : null)
        const IDENTITY_COL = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
        const placement = ProductPlacement.getPlacement(PRIMARY_ZONE)
        const placementGroup = placement?.group || null
        if (placementGroup) placementGroup.updateMatrixWorld(true)
        // Das GLB-Root (`model`) trägt den rotationOffset (z.B. Z-up → Y-up-Korrektur),
        // der NICHT in group.matrixWorld steckt. Für Blender die volle Welt-Matrix des Modells
        // senden, sonst rendert das Regal gekippt/auf der Seite.
        const placementTarget = placement?.model || placementGroup
        const payloadPlacementMatrix = col16(placementTarget) || IDENTITY_COL

        CameraController.update()
        const cam = CameraController.getCamera()
        cam.updateMatrixWorld(true)
        if (typeof cam.updateWorldMatrix === 'function') {
          cam.updateWorldMatrix(true, false)
        }

        // Shadow-Catcher erzwingt Cycles im Backend (Eevee liefert keinen sauberen Catcher).
        // Damit der Download-Filename die tatsächlich verwendete Engine zeigt, setzen wir sie
        // auch im Payload und verwenden sie unten für den Filename-Slug.
        const requestedEngine = this.blenderEngine === 'cycles' ? 'cycles' : 'eevee'
        const effectiveEngine = 'cycles'
        const payload = {
          glbPath,
          usesGlbOriginalColors: !!this.usesGlbOriginalColors,
          hex,
          ralCode: this.currentColor || '',
          surfaceFinish: String(this.currentProduct.surfaceFinish || '').trim().toLowerCase(),
          /** Volle Welt-Matrix des Modell-Roots (inkl. rotationOffset); Blender: C @ M @ C⁻¹. */
          placementMatrixWorld: payloadPlacementMatrix,
          /** Blender: M_cam_bl = C · M_cam_th (nur links, lokale Achsen gleich); Fallback pos/tgt. */
          cameraMatrixWorld: col16(cam),
          fovDeg: cam.fov,
          aspect: cam.aspect,
          near: cam.near,
          far: cam.far,
          camera: CameraController.getCurrentView(),
          resolution: this.getBlenderResolutionPixels(),
          engine: effectiveEngine,
          // JPG unterstützt kein Alpha → Compositor wird im Python-Skript auf weiß compositen.
          // transparentBackground bleibt True, damit der Shadow-Catcher-Alpha erhalten bleibt und
          // weich auf den weißen Hintergrund übergeblendet werden kann.
          format: this.blenderFormat === 'jpg' ? 'jpg' : 'png',
          transparentBackground: true,
          shadowCatcher: true,
        }
        const hdriRel = (EURIS.hdriPath || '').replace(/^\//, '')
        if (hdriRel) payload.hdriPath = hdriRel

        const blob = await requestBlenderRender(payload)
        const eng = this._slugify(effectiveEngine)
        // requestedEngine ist nur zur Diagnose – falls das UI Eevee wählte, loggen wir den Switch.
        if (requestedEngine !== effectiveEngine) {
                    log.info(`[Showroom] Shadow-Catcher erzwingt Cycles (UI-Wahl: ${requestedEngine}).`)
        }
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        const base = this._slugify(this.currentProduct?.name || this.currentProduct?.id)
        const col = this._slugify(this.currentColor || 'original')
        const ext = payload.format === 'jpg' ? 'jpg' : 'png'
        this._downloadBlob(blob, `${base}_${col}_blender_${eng}_${ts}.${ext}`)
      } catch (e) {
        const msg = e?.message || String(e)
        this.blenderRenderError = msg
                log.scoped("Showroom").error("Blender-Render:", e)
      } finally {
        this.isBlenderRendering = false
      }
    },

    toggleLightDebug() {
      this.showLightDebug = !this.showLightDebug
      LightDebugView.setVisible(this.showLightDebug)
    },

    togglePivotDebug() {
      this.showPivotDebug = !this.showPivotDebug
      PivotDebugView.setVisible(this.showPivotDebug)
    },

    toggleOriginalOrientation() {
      this.showOriginalOrientation = !this.showOriginalOrientation
      ProductPlacement.setOriginalOrientation(PRIMARY_ZONE, this.showOriginalOrientation)
    },

    togglePerformancePanel() {
      this.perfPanelOpen = !this.perfPanelOpen
      if (this.perfPanelOpen) {
        this.refreshPerfStats()
      } else {
        performanceMonitor.clearStress(SceneManager.getScene())
        this.perfStressResult = null
      }
    },

    refreshPerfStats() {
      const placement = ProductPlacement.getPlacement(PRIMARY_ZONE)
      const root = placement?.group
      if (!root) {
        this.perfStats = null
        return
      }
      this.updateMeshInfo()
      const m = performanceMonitor.measureModel(root)
      const mem = performanceMonitor.estimateGpuMemory(root)
      this.perfStats = {
        ...m,
        geomMb: mem.geomMb,
        texMb: mem.texMb,
        totalMb: mem.totalMb,
      }
    },

    async runPerfStress(n) {
      const raw = n !== undefined && n !== null ? Number(n) : Number(this.perfStressN)
      const count = Math.max(1, Math.min(256, Math.floor(Number.isFinite(raw) && raw > 0 ? raw : this.perfStressN || 4)))
      if (this.perfStressRunning || !this.currentProduct) return
      const placement = ProductPlacement.getPlacement(PRIMARY_ZONE)
      const root = placement?.group
      if (!root) return
      this.perfStressRunning = true
      this.perfStressResult = null
      try {
        const scene = SceneManager.getScene()
        const res = await performanceMonitor.runStress({
          sourceRoot: root,
          count,
          scene,
          sampleMs: 2000,
        })
        this.perfStressResult = res
      } catch (e) {
                log.scoped("Showroom").error("Performance-Stresstest:", e)
        this.perfStressResult = null
      } finally {
        this.perfStressRunning = false
      }
    },

    clearPerfStress() {
      performanceMonitor.clearStress(SceneManager.getScene())
      this.perfStressResult = null
    },

    perfStressSummaryLine() {
      const r = this.perfStressResult
      if (!r) return ''
      return `FPS min ${Number(r.min).toFixed(1)} · ø ${Number(r.avg).toFixed(1)} · max ${Number(r.max).toFixed(1)} (${r.count}×, ${Number(r.durationS).toFixed(2)} s)`
    },

    perfStressDetailLine() {
      const r = this.perfStressResult
      if (!r || r.drawCalls == null) return ''
      const tri = r.triRender != null ? r.triRender.toLocaleString('de-DE') : '–'
      return `Draw calls: ${r.drawCalls} · Triangles (Frame): ${tri}`
    },

    toggleMeshInfo() {
      this.showMeshInfo = !this.showMeshInfo
      if (this.showMeshInfo && this.meshInfoList.length === 0) this.updateMeshInfo()
    },
  }
}

Alpine.data('showroomApp', showroomApp)
window.Alpine = Alpine
Alpine.start()
