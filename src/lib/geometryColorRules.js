/**
 * Geometrie-basierte Farbregeln für die Bake-Pipeline (nach Vertexzahl & Bounding-Box).
 * Merge: zuerst **global**, dann **Produkt** — letzte passende Regel gewinnt.
 */

import { Accessor } from '@gltf-transform/core'
import { normalizeNameRuleRalKey } from './nameColorRules.js'

const EPS = 1e-5

/**
 * @param {object|null} globalMapping
 * @param {object|null} productPreset
 * @returns {Array<object>}
 */
export function mergeGeometryColorRuleEntries(globalMapping = null, productPreset = null) {
  const product = productPreset?.geometryColorRules
  const global = globalMapping?.geometryColorRules
  return [...(Array.isArray(global) ? global : []), ...(Array.isArray(product) ? product : [])]
}

/**
 * @param {number[]} a
 * @param {number[]} b
 */
function vecGte(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] + EPS < b[i]) return false
  }
  return true
}

/**
 * @param {number[]} a
 * @param {number[]} b
 */
function vecLte(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] - EPS > b[i]) return false
  }
  return true
}

/**
 * @param {object} raw
 * @returns {boolean}
 */
function hasGeometryConstraint(raw) {
  if (!raw || typeof raw !== 'object') return false
  return (
    raw.vertexCount != null ||
    raw.vertexCountMin != null ||
    raw.vertexCountMax != null ||
    (Array.isArray(raw.extentMin) && raw.extentMin.length === 3) ||
    (Array.isArray(raw.extentMax) && raw.extentMax.length === 3) ||
    (Array.isArray(raw.sortedExtentMin) && raw.sortedExtentMin.length === 3) ||
    (Array.isArray(raw.sortedExtentMax) && raw.sortedExtentMax.length === 3) ||
    raw.maxExtentMin != null ||
    raw.maxExtentMax != null ||
    raw.volumeMin != null ||
    raw.volumeMax != null
  )
}

/**
 * Kompiliert Regeln: normalisierte Zahlen + RAL-Key.
 *
 * @param {Array<object>} rules
 * @returns {Array<object>}
 */
export function compileGeometryColorRules(rules) {
  const out = []
  if (!Array.isArray(rules)) return out
  for (const r of rules) {
    if (!r || typeof r !== 'object') continue
    if (!hasGeometryConstraint(r)) continue
    const ralKey = normalizeNameRuleRalKey(r.ral)
    if (!ralKey) continue
    const tol = Number.isFinite(r.vertexCountTolerance) ? Math.max(0, Math.floor(r.vertexCountTolerance)) : 0
    const entry = { ralKey, vertexCountTolerance: tol }
    if (r.vertexCount != null && Number.isFinite(r.vertexCount)) entry.vertexCount = Math.round(r.vertexCount)
    if (r.vertexCountMin != null && Number.isFinite(r.vertexCountMin)) entry.vertexCountMin = Math.round(r.vertexCountMin)
    if (r.vertexCountMax != null && Number.isFinite(r.vertexCountMax)) entry.vertexCountMax = Math.round(r.vertexCountMax)
    if (Array.isArray(r.extentMin) && r.extentMin.length === 3) {
      entry.extentMin = r.extentMin.map((x) => Number(x))
      if (entry.extentMin.some((x) => !Number.isFinite(x))) delete entry.extentMin
    }
    if (Array.isArray(r.extentMax) && r.extentMax.length === 3) {
      entry.extentMax = r.extentMax.map((x) => Number(x))
      if (entry.extentMax.some((x) => !Number.isFinite(x))) delete entry.extentMax
    }
    if (Array.isArray(r.sortedExtentMin) && r.sortedExtentMin.length === 3) {
      entry.sortedExtentMin = r.sortedExtentMin.map((x) => Number(x))
      if (entry.sortedExtentMin.some((x) => !Number.isFinite(x))) delete entry.sortedExtentMin
    }
    if (Array.isArray(r.sortedExtentMax) && r.sortedExtentMax.length === 3) {
      entry.sortedExtentMax = r.sortedExtentMax.map((x) => Number(x))
      if (entry.sortedExtentMax.some((x) => !Number.isFinite(x))) delete entry.sortedExtentMax
    }
    if (r.maxExtentMin != null && Number.isFinite(r.maxExtentMin)) entry.maxExtentMin = Number(r.maxExtentMin)
    if (r.maxExtentMax != null && Number.isFinite(r.maxExtentMax)) entry.maxExtentMax = Number(r.maxExtentMax)
    if (r.volumeMin != null && Number.isFinite(r.volumeMin)) entry.volumeMin = Number(r.volumeMin)
    if (r.volumeMax != null && Number.isFinite(r.volumeMax)) entry.volumeMax = Number(r.volumeMax)
    out.push(entry)
  }
  return out
}

/**
 * @param {import('@gltf-transform/core').Primitive} prim
 * @returns {{ dx: number, dy: number, dz: number, sorted: number[], volume: number, maxExtent: number, vertexCount: number } | null}
 */
export function getPrimitiveGeometryMetrics(prim) {
  const pos = prim.getAttribute('POSITION')
  if (!pos || pos.getType() !== Accessor.Type.VEC3) return null
  const min = [0, 0, 0]
  const max = [0, 0, 0]
  try {
    pos.getMin(min)
    pos.getMax(max)
  } catch {
    return null
  }
  if (!min.every(Number.isFinite) || !max.every(Number.isFinite)) return null
  const dx = Math.abs(max[0] - min[0])
  const dy = Math.abs(max[1] - min[1])
  const dz = Math.abs(max[2] - min[2])
  const sorted = [dx, dy, dz].sort((a, b) => a - b)
  const volume = dx * dy * dz
  const maxExtent = Math.max(dx, dy, dz)
  const vertexCount = pos.getCount()
  return { dx, dy, dz, sorted, volume, maxExtent, vertexCount }
}

/**
 * @param {ReturnType<typeof getPrimitiveGeometryMetrics>} m
 * @param {object} rule — kompilierte Regel
 */
export function matchesGeometryColorRule(m, rule) {
  if (!m) return false
  if (rule.vertexCount != null) {
    if (Math.abs(m.vertexCount - rule.vertexCount) > rule.vertexCountTolerance) return false
  }
  if (rule.vertexCountMin != null && m.vertexCount < rule.vertexCountMin) return false
  if (rule.vertexCountMax != null && m.vertexCount > rule.vertexCountMax) return false

  if (rule.extentMin && !vecGte([m.dx, m.dy, m.dz], rule.extentMin)) return false
  if (rule.extentMax && !vecLte([m.dx, m.dy, m.dz], rule.extentMax)) return false

  if (rule.sortedExtentMin && !vecGte(m.sorted, rule.sortedExtentMin)) return false
  if (rule.sortedExtentMax && !vecLte(m.sorted, rule.sortedExtentMax)) return false

  if (rule.maxExtentMin != null && m.maxExtent + EPS < rule.maxExtentMin) return false
  if (rule.maxExtentMax != null && m.maxExtent - EPS > rule.maxExtentMax) return false

  if (rule.volumeMin != null && m.volume + EPS < rule.volumeMin) return false
  if (rule.volumeMax != null && m.volume - EPS > rule.volumeMax) return false

  return true
}
