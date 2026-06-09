import { createLogger } from '../lib/logger.js'
const log = createLogger("ProductPlacement")

import * as THREE from 'three'
import SceneManager from './SceneManager.js'
import RoomEnvironment from './RoomEnvironment.js'
import ProductLoader from './ProductLoader.js'
import MaterialManager from './MaterialManager.js'
import ColorService from '../services/ColorService.js'
import { resolveEffectiveDefaultColorOrFallback } from '../lib/defaultColorMapping.js'
import gsap from 'gsap'

/**
 * Verwaltet welche Produkte in welcher PlacementZone stehen. Animiert Ein-/Ausblenden.
 */
class ProductPlacement {
  constructor() {
    this.scene = SceneManager.getScene()
    this.placements = new Map() // zoneId -> { productId, group }
    this.currentProductPerZone = new Map()
  }

  /** Nur noch RAL-Vorschau bei explizitem hexColor; sonst GLB unverändert (siehe MaterialManager). */
  _applyAppearanceToModel(modelOrClone, productData, hexColor) {
    MaterialManager.applyProductAppearance(modelOrClone, productData, hexColor)
  }

  /**
   * Setzt ein Produkt in eine Zone (lädt es bei Bedarf, positioniert, fügt zur Scene hinzu).
   * Bei type === 'composed' werden mehrere Teile geladen (je GLB einmal), geklont und positioniert.
   * @param {string} zoneId
   * @param {string} productId
   * @param {object} productData - { glbFile, defaultColor } oder { type: 'composed', parts: [...] }
   * @param {string} hexColor
   * @param {Array} allProducts - alle Produkte (zum Auflösen von productId in parts)
   * @returns {Promise<THREE.Group>}
   */
  async placeProduct(zoneId, productId, productData, hexColor, allProducts = []) {
    const pos = RoomEnvironment.getZonePosition(zoneId)
    const rotY = RoomEnvironment.getZoneRotation(zoneId)
    if (!pos) {
            log.scoped("ProductPlacement").warn("Zone nicht gefunden:", zoneId)
      return null
    }

    // Altes Modell in dieser Zone ausblenden/entfernen
    const existing = this.placements.get(zoneId)
    if (existing && existing.group) {
      gsap.to(existing.group.scale, { x: 0, y: 0, z: 0, duration: 0.2, ease: 'power2.in' })
      gsap.to(existing.group, { duration: 0.2, onComplete: () => {
        this.scene.remove(existing.group)
      }})
      this.placements.delete(zoneId)
    }

    if (productData?.type === 'composed' && Array.isArray(productData.parts)) {
      return this.placeComposedProduct(zoneId, productId, productData, hexColor, pos, rotY, allProducts)
    }

    const glbPath = productData?.glbFile || null
    const model = await ProductLoader.loadProduct(glbPath)
    if (!model) return null

    const group = new THREE.Group()
    group.name = `placement-${zoneId}-${productId}`
    group.add(model)

    // Rotation: zuerst Modell-Korrektur (z. B. Z-up → Y-up), dann Zone-Rotation um Y
    const rotOffset = productData?.rotationOffset
    if (rotOffset) {
      model.rotation.x = (rotOffset.x ?? 0) * (Math.PI / 180)
      model.rotation.y = (rotOffset.y ?? 0) * (Math.PI / 180)
      model.rotation.z = (rotOffset.z ?? 0) * (Math.PI / 180)
    }
    group.rotation.y = rotY
    group.scale.set(0, 0, 0)

    const bbox = new THREE.Box3().setFromObject(model)
    group.position.set(pos.x, pos.y - bbox.min.y, pos.z)

    this._applyAppearanceToModel(model, productData, hexColor)

    this.scene.add(group)
    this.placements.set(zoneId, {
      productId,
      group,
      model,
      productData,
      zoneRotY: rotY,
    })
    this.currentProductPerZone.set(zoneId, productId)

    gsap.to(group.scale, { x: 1, y: 1, z: 1, duration: 0.35, ease: 'back.out(1.2)' })
    return group
  }

  /**
   * Berechnet Böden-Höhen: erster bei firstY (z. B. 15 cm), letzter bei lastY (Ständer-Oberkante),
   * dazwischen (count - 2) Stück gleichmäßig verteilt, alle auf 5-cm-Raster gerundet.
   * @param {number} firstY - erste Bodenhöhe (m), z. B. 0.15
   * @param {number} lastY - letzte Bodenhöhe = Oberkante Ständer (m)
   * @param {number} count - Anzahl Böden (z. B. 5)
   * @param {number} raster - Raster in m (z. B. 0.05)
   * @returns {number[]}
   */
  computeShelfHeights(firstY, lastY, count, raster = 0.05) {
    if (count < 2) return lastY > firstY ? [firstY, lastY].slice(0, count) : [firstY]
    const snap = (y) => Math.round(y / raster) * raster
    const heights = [snap(firstY)]
    const gap = (lastY - firstY) / (count - 1)
    for (let i = 1; i < count - 1; i++) heights.push(snap(firstY + i * gap))
    heights.push(snap(lastY))
    return heights
  }

  /**
   * Platziert ein zusammengesetztes Produkt: pro Teil wird das GLB einmal geladen, dann count× geklont.
   * @param {string} zoneId
   * @param {string} productId
   * @param {object} productData - { type: 'composed', parts: [{ productId, count, positions: [{x,y,z,rotationY?}] }] }
   * @param {string} hexColor
   * @param {THREE.Vector3} pos - Zonenposition
   * @param {number} rotY - Zonenrotation (rad)
   * @param {Array} allProducts
   * @returns {Promise<THREE.Group>}
   */
  async placeComposedProduct(zoneId, productId, productData, hexColor, pos, rotY, allProducts) {
    const group = new THREE.Group()
    group.name = `placement-${zoneId}-${productId}`
    const toRad = Math.PI / 180
    for (const part of productData.parts) {
      const product = allProducts.find((p) => p.id === part.productId)
      if (!product?.glbFile) continue
      const master = await ProductLoader.getCachedOrLoad(product.glbFile)
      if (!master) continue
      const rotOffset = product.rotationOffset
      const positions = part.positions || []
      const count = Math.max(part.count || 1, positions.length)

      for (let i = 0; i < count; i++) {
        const clone = master.clone(true)
        const place = positions[i] || { x: 0, y: 0, z: 0, rotationX: 0, rotationY: 0, rotationZ: 0 }
        clone.position.set(place.x, place.y, place.z)
        clone.scale.set(place.scaleX ?? 1, place.scaleY ?? 1, place.scaleZ ?? 1)
        clone.rotation.x = (place.rotationX ?? 0) * toRad
        clone.rotation.y = (place.rotationY ?? 0) * toRad
        clone.rotation.z = (place.rotationZ ?? 0) * toRad
        if (rotOffset) {
          clone.rotation.x += (rotOffset.x ?? 0) * toRad
          clone.rotation.y += (rotOffset.y ?? 0) * toRad
          clone.rotation.z += (rotOffset.z ?? 0) * toRad
        }
        clone.userData.rotationOffset = rotOffset ? { x: rotOffset.x ?? 0, y: rotOffset.y ?? 0, z: rotOffset.z ?? 0 } : null
        clone.userData.placeRotationX = place.rotationX ?? 0
        clone.userData.placeRotationY = place.rotationY ?? 0
        clone.userData.placeRotationZ = place.rotationZ ?? 0
        group.add(clone)
        this._applyAppearanceToModel(clone, productData, hexColor)
      }
    }

    const bbox = new THREE.Box3().setFromObject(group)
    // Früher: bbox.max.y minus Kappenhöhe (heuristisch erkannt). Die GLB ist
    // nun die Wahrheit, die Oberkante der Böden ist die Modell-Oberkante.
    const firstBodenY = 0.15
    const lastBodenY = bbox.max.y
    const raster = 0.05
    const shelfHeights = this.computeShelfHeights(firstBodenY, lastBodenY, 5, raster)
    const shelvesProductId = productData.shelves?.productId
    const staenderTiefeM = (productData.shelves?.staenderTiefeMm ?? 536) / 1000
    // Regel Ständer/Böden: Ständer 1 = Startpunkt, Böden = +shelfToStanderMm, Ständer 2 = +(shelfWidthMm+2×3mm). Siehe docs/Regel-Regal-Masse.md
    let staender1PivotX = Infinity
    for (const part of productData.parts) {
      for (const p of part.positions || []) {
        if (p.x < staender1PivotX) staender1PivotX = p.x
      }
    }
    if (staender1PivotX === Infinity) staender1PivotX = bbox.min.x
    const shelfToStanderM = (productData.shelves?.shelfToStanderMm ?? 503) / 1000
    const standSpacingM = (productData.shelves?.shelfWidthMm ?? 1000) / 1000 + 0.006 // shelfWidthMm + 2×3mm
    const shelfBayCount = productData.shelves?.shelfBayCount ?? 1
    const shelfCenterXs = []
    for (let b = 0; b < shelfBayCount; b++) {
      shelfCenterXs.push(staender1PivotX + b * standSpacingM + shelfToStanderM)
    }
    if (shelvesProductId && shelfHeights.length > 0) {
      const shelvesProduct = allProducts.find((p) => p.id === shelvesProductId)
      if (shelvesProduct?.glbFile) {
        const master = await ProductLoader.getCachedOrLoad(shelvesProduct.glbFile)
        if (master) {
          const frontZ = bbox.max.z
          const shelfCenterZ = frontZ - staenderTiefeM / 2
          const rotOffset = shelvesProduct.rotationOffset
          for (let b = 0; b < shelfCenterXs.length; b++) {
            const shelfCenterX = shelfCenterXs[b]
            for (let i = 0; i < shelfHeights.length; i++) {
              const clone = master.clone(true)
              clone.position.set(shelfCenterX, shelfHeights[i], shelfCenterZ)
              clone.rotation.y = 0
              if (rotOffset) {
                clone.rotation.x = (rotOffset.x ?? 0) * toRad
                clone.rotation.y += (rotOffset.y ?? 0) * toRad
                clone.rotation.z = (rotOffset.z ?? 0) * toRad
              }
              clone.userData.rotationOffset = rotOffset ? { x: rotOffset.x ?? 0, y: rotOffset.y ?? 0, z: rotOffset.z ?? 0 } : null
              clone.userData.placeRotationY = 0
              group.add(clone)
              this._applyAppearanceToModel(clone, productData, hexColor)
            }
          }
        }
      }
    }

    group.rotation.y = rotY
    group.scale.set(0, 0, 0)
    const bboxFinal = new THREE.Box3().setFromObject(group)
    const centerX = (bboxFinal.min.x + bboxFinal.max.x) / 2
    const centerZ = (bboxFinal.min.z + bboxFinal.max.z) / 2
    group.position.set(pos.x - centerX, pos.y - bboxFinal.min.y, pos.z - centerZ)

    this.scene.add(group)
    this.placements.set(zoneId, {
      productId,
      group,
      model: null,
      isComposed: true,
      productData,
      zoneRotY: rotY,
    })
    this.currentProductPerZone.set(zoneId, productId)

    gsap.to(group.scale, { x: 1, y: 1, z: 1, duration: 0.35, ease: 'back.out(1.2)' })
    return group
  }

  /**
   * Gibt die Gruppe und das eigentliche Modell für eine Zone zurück (für Hotspots/Kamera).
   * @param {string} zoneId
   * @returns {{ group: THREE.Group, model: THREE.Group }|null}
   */
  getPlacement(zoneId) {
    return this.placements.get(zoneId) || null
  }

  /**
   * Sammelt alle Kameras aus dem platzierten Modell (Weltposition + Blickrichtung).
   * @param {string} zoneId
   * @returns {Array<{ id: string, name: string, position: {x,y,z}, target: {x,y,z} }>}
   */
  getProductCameras(zoneId) {
    const p = this.placements.get(zoneId)
    if (!p || !p.group) return []
    const list = []
    const dir = new THREE.Vector3()
    const pos = new THREE.Vector3()
    const lookDistance = 5
    let index = 0
    p.group.updateMatrixWorld(true)
    p.group.traverse((o) => {
      if (!o.isCamera) return
      o.getWorldPosition(pos)
      o.getWorldDirection(dir)
      const target = pos.clone().add(dir.clone().multiplyScalar(lookDistance))
      list.push({
        id: `cam-${index}`,
        name: o.name || `Kamera ${index + 1}`,
        position: { x: pos.x, y: pos.y, z: pos.z },
        target: { x: target.x, y: target.y, z: target.z },
      })
      index++
    })
    return list
  }

  /**
   * Gibt die Weltposition der Mitte eines platzierten Produkts zurück (z.B. für Kamera-Fokus).
   * @param {string} zoneId
   * @returns {THREE.Vector3|null}
   */
  getProductCenter(zoneId) {
    const p = this.placements.get(zoneId)
    if (!p || !p.group) return null
    const v = new THREE.Vector3()
    p.group.getWorldPosition(v)
    v.y += 1
    return v
  }

  /**
   * Gibt die Welt-Bounding-Box des platzierten Produkts in voller Größe zurück (für Kamera-Framing).
   * Scale wird temporär auf 1 gesetzt, damit die Box alle Felder umfasst (nicht die animierte 0 beim Start).
   * @param {string} zoneId
   * @returns {THREE.Box3|null}
   */
  getProductBoundingBox(zoneId) {
    const p = this.placements.get(zoneId)
    if (!p || !p.group) return null
    const group = p.group
    const prevScale = group.scale.clone()
    group.scale.set(1, 1, 1)
    group.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(group)
    group.scale.copy(prevScale)
    group.updateMatrixWorld(true)
    return box
  }

  /**
   * Zeigt das Modell in der Zone wie in der Datei (keine rotationOffset, keine Zone-Rotation)
   * oder wieder mit Showroom-Ausrichtung.
   * @param {string} zoneId
   * @param {boolean} useOriginal - true = wie in GLB, false = mit rotationOffset + Zone-Rotation
   */
  setOriginalOrientation(zoneId, useOriginal) {
    const p = this.placements.get(zoneId)
    if (!p || !p.group) return
    const toRad = Math.PI / 180
    if (p.isComposed) {
      p.group.rotation.y = useOriginal ? 0 : p.zoneRotY
      p.group.children.forEach((clone) => {
        if (useOriginal) {
          clone.rotation.set(0, 0, 0)
        } else {
          const ro = clone.userData.rotationOffset
          const placeX = clone.userData.placeRotationX ?? 0
          const placeY = clone.userData.placeRotationY ?? 0
          const placeZ = clone.userData.placeRotationZ ?? 0
          if (ro) {
            clone.rotation.x = (ro.x ?? 0) * toRad + placeX * toRad
            clone.rotation.y = (ro.y ?? 0) * toRad + placeY * toRad
            clone.rotation.z = (ro.z ?? 0) * toRad + placeZ * toRad
          } else {
            clone.rotation.x = placeX * toRad
            clone.rotation.y = placeY * toRad
            clone.rotation.z = placeZ * toRad
          }
        }
      })
      return
    }
    if (!p.model) return
    if (useOriginal) {
      p.model.rotation.set(0, 0, 0)
      p.group.rotation.y = 0
    } else {
      const rotOffset = p.productData?.rotationOffset
      if (rotOffset) {
        p.model.rotation.x = (rotOffset.x ?? 0) * toRad
        p.model.rotation.y = (rotOffset.y ?? 0) * toRad
        p.model.rotation.z = (rotOffset.z ?? 0) * toRad
      } else {
        p.model.rotation.set(0, 0, 0)
      }
      p.group.rotation.y = p.zoneRotY
    }
  }

  /** Aktualisiert die Farbe des Produkts in der Zone (nach RAL-Wechsel). */
  updateColor(zoneId, hexColor, ralCode = null) {
    if (hexColor == null) return
    const p = this.placements.get(zoneId)
    if (!p || !p.group) return
    const effUpd = resolveEffectiveDefaultColorOrFallback(p.productData)
    const rc =
      (ralCode && ColorService.getRAL(String(ralCode).trim()) ? String(ralCode).trim() : null) ||
      (effUpd && ColorService.getRAL(effUpd) ? effUpd : null)
    const finishCtx = rc
      ? { ralCode: rc, surfaceFinish: p.productData?.surfaceFinish }
      : { ralCode: null, surfaceFinish: p.productData?.surfaceFinish }
    const stripColorMaps = MaterialManager.shouldStripColorMapsForProduct(p.productData)
    const roots = p.isComposed ? [...p.group.children] : (p.model ? [p.model] : [])
    const forceTraverse = !!p.isComposed
    for (const root of roots) {
      if (!root) continue
      MaterialManager.applyRALColor(root, hexColor, forceTraverse, finishCtx, { stripColorMaps })
    }
  }

  /** Alle Platzierungen zurücksetzen */
  clear() {
    this.placements.forEach(({ group }) => this.scene.remove(group))
    this.placements.clear()
    this.currentProductPerZone.clear()
  }
}

export default new ProductPlacement()
