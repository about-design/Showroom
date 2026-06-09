import './styles/main.css'
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

import productsData from './data/products.json'
import ralColorsData from './data/ralColors.json'
import roomsData from './data/rooms.json'

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
    ralColors: ralColorsData,
    currentProduct: null,
    currentColor: 'RAL 7035',
    activeHotspot: null,
    isLoading: true,
    loadProgress: 0,
    loadStatus: 'Initialisiere …',
    isMobile: false,
    mobileMenuClosed: false,
    lightIntensity: 100,
    showLightDebug: false,
    showPivotDebug: false,
    productCameras: [],
    selectedCameraId: 'orbit',
    showOriginalOrientation: false,
    sidebarClosed: false,
    sidebarPeek: false,
    settingsOpen: false,

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

      const hex = (ralColorsData[this.currentColor] && ralColorsData[this.currentColor].hex) || '#D7D7D7'
      const urlProduct = new URLSearchParams(window.location.search).get('product')
      const initial = (urlProduct && this.products.find(p => p.id === urlProduct)) || this.products[0]
      this.selectProduct(initial, hex)
    },

    setLightIntensity() {
      const p = this.lightIntensity / 100
      const factor = p * p
      LightingManager.setIntensity(factor)
      SceneManager.setExposure(factor)
      RoomEnvironment.setCeilingIntensity(factor)
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
      const hex = hexColor || (ralColorsData[this.currentColor] && ralColorsData[this.currentColor].hex) || '#D7D7D7'
      this.currentProduct = product
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
        }
      }).catch((err) => {
        this.isLoading = false
        this.loadStatus = 'Fehler beim Laden'
        if (import.meta.env.DEV) console.error('[Showroom] placeProduct fehlgeschlagen:', err)
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
      const ral = ralColorsData[ralCode]
      const hex = ral ? ral.hex : '#D7D7D7'
      MaterialManager.setCurrentRAL(ralCode)
      if (this.currentProduct) {
        MaterialManager.applyRALColor(
          ProductPlacement.getPlacement(PRIMARY_ZONE)?.model || null,
          hex
        )
        ProductPlacement.updateColor(PRIMARY_ZONE, hex)
      }
    },

    openAR() {
      const glb = this.currentProduct?.glbFile || ''
      const usdz = this.currentProduct?.usdzFile || ''
      const hex = (ralColorsData[this.currentColor] && ralColorsData[this.currentColor].hex) || '#D7D7D7'
      ARManager.showAR(glb, hex, usdz)
    },

    resetCamera() {
      this.selectedCameraId = 'orbit'
      CameraController.resetCamera()
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
  }
}

Alpine.data('showroomApp', showroomApp)
window.Alpine = Alpine
Alpine.start()
