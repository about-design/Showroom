/**
 * Regeln zur Reduktion der Vertex-Anzahl pro Primitive (Bake-Pipeline).
 *
 * Match-Quellen kombinierbar:
 *   - Name-Regex (target = material | node | mesh | nodePath | extras)
 *   - Geometrie-Filter (vertexCountMin/Max, extentMin/Max, sortedExtentMin/Max,
 *     maxExtentMin/Max, volumeMin/Max)
 *   - Beide Bedingungen müssen gleichzeitig zutreffen, wenn beide gesetzt sind.
 *
 * Reduktionsziel:
 *   - `ratio` (0…1): Zielanteil der Vertices, der erhalten bleibt (z. B. 0.1 = 10 %).
 *   - `targetVertexCount`: alternativer absoluter Zielwert; wird in `ratio` umgerechnet.
 *   - `error`: maximaler relativer Fehler (Standard 0.001 = 0.1 % Modell-Radius).
 *   - `lockBorder`: hält offene Kanten/Ränder fest (Standard false).
 *
 * Auswertung im Bake (siehe scripts/bake-glb-yup.js):
 *   global → Produkt; bei mehreren Treffern gewinnt die **letzte** passende Regel.
 *   Wird vor allen Farb-Schichten ausgeführt, damit Materialzuordnung konsistent bleibt.
 */

import { Accessor } from '@gltf-transform/core'

const TARGETS = new Set(['material', 'node', 'mesh', 'nodePath', 'extras'])
const EPS = 1e-5

/**
 * @param {object|null} globalMapping
 * @param {object|null} productPreset
 * @returns {Array<object>}
 */
export function mergeVertexReductionRuleEntries(globalMapping = null, productPreset = null) {
  const product = productPreset?.vertexReductionRules
  const global = globalMapping?.vertexReductionRules
  return [...(Array.isArray(global) ? global : []), ...(Array.isArray(product) ? product : [])]
}

function clamp01(v) {
  if (!Number.isFinite(v)) return null
  return Math.max(0, Math.min(1, v))
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * @param {Array<object>} rules
 * @returns {Array<object>}
 */
export function compileVertexReductionRules(rules) {
  const out = []
  if (!Array.isArray(rules)) return out
  for (const r of rules) {
    if (!r || typeof r !== 'object') continue

    const tRaw = String(r.target ?? 'mesh').trim()
    const target = TARGETS.has(tRaw) ? tRaw : 'mesh'
    const pattern = String(r.pattern ?? '').trim()
    const flags = typeof r.flags === 'string' ? r.flags : ''

    let regex = null
    if (pattern) {
      try {
        regex = new RegExp(pattern, flags)
      } catch {
        continue
      }
    }

    const ratio = r.ratio == null || r.ratio === '' ? null : clamp01(Number(r.ratio))
    const targetVertexCount =
      Number.isFinite(r.targetVertexCount) && r.targetVertexCount > 0
        ? Math.max(3, Math.floor(r.targetVertexCount))
        : null
    if (ratio == null && targetVertexCount == null) continue

    const error = Number.isFinite(r.error) ? Math.max(0, Math.min(1, Number(r.error))) : 0.001
    const lockBorder = !!r.lockBorder

    const entry = {
      target,
      regex,
      pattern,
      flags,
      ratio,
      targetVertexCount,
      error,
      lockBorder,
    }

    const vMin = num(r.vertexCountMin)
    const vMax = num(r.vertexCountMax)
    if (vMin != null) entry.vertexCountMin = Math.max(0, Math.floor(vMin))
    if (vMax != null) entry.vertexCountMax = Math.max(0, Math.floor(vMax))

    if (Array.isArray(r.extentMin) && r.extentMin.length === 3) {
      const arr = r.extentMin.map(num)
      if (arr.every((x) => x != null)) entry.extentMin = arr
    }
    if (Array.isArray(r.extentMax) && r.extentMax.length === 3) {
      const arr = r.extentMax.map(num)
      if (arr.every((x) => x != null)) entry.extentMax = arr
    }
    if (Array.isArray(r.sortedExtentMin) && r.sortedExtentMin.length === 3) {
      const arr = r.sortedExtentMin.map(num)
      if (arr.every((x) => x != null)) entry.sortedExtentMin = arr
    }
    if (Array.isArray(r.sortedExtentMax) && r.sortedExtentMax.length === 3) {
      const arr = r.sortedExtentMax.map(num)
      if (arr.every((x) => x != null)) entry.sortedExtentMax = arr
    }
    const mEMin = num(r.maxExtentMin)
    const mEMax = num(r.maxExtentMax)
    if (mEMin != null) entry.maxExtentMin = mEMin
    if (mEMax != null) entry.maxExtentMax = mEMax
    const vMinV = num(r.volumeMin)
    const vMaxV = num(r.volumeMax)
    if (vMinV != null) entry.volumeMin = vMinV
    if (vMaxV != null) entry.volumeMax = vMaxV

    out.push(entry)
  }
  return out
}

function vecGte(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] + EPS < b[i]) return false
  return true
}
function vecLte(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] - EPS > b[i]) return false
  return true
}

/**
 * @param {import('@gltf-transform/core').Primitive} prim
 * @returns {{ dx:number, dy:number, dz:number, sorted:number[], volume:number, maxExtent:number, vertexCount:number } | null}
 */
export function getReductionPrimitiveMetrics(prim) {
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
  return {
    dx,
    dy,
    dz,
    sorted,
    volume: dx * dy * dz,
    maxExtent: Math.max(dx, dy, dz),
    vertexCount: pos.getCount(),
  }
}

/**
 * @param {ReturnType<typeof getReductionPrimitiveMetrics>} m
 * @param {object} rule — kompilierte Regel
 */
export function matchesGeometryFilter(m, rule) {
  if (rule.vertexCountMin == null && rule.vertexCountMax == null &&
      !rule.extentMin && !rule.extentMax &&
      !rule.sortedExtentMin && !rule.sortedExtentMax &&
      rule.maxExtentMin == null && rule.maxExtentMax == null &&
      rule.volumeMin == null && rule.volumeMax == null) {
    return true
  }
  if (!m) return false
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

/**
 * Effektiver `ratio`-Wert für eine Regel und eine bekannte Vertexzahl.
 * Falls `targetVertexCount` gesetzt ist, wird daraus eine Quote berechnet (gegenüber `ratio` bevorzugt).
 * Untergrenze: 0.001 (0.1 %), Obergrenze: 0.999 (99.9 %).
 *
 * @param {object} rule — kompilierte Regel
 * @param {number} vertexCount — aktuelle Vertexzahl der Primitive
 * @returns {number}
 */
export function effectiveRatioForRule(rule, vertexCount) {
  if (rule.targetVertexCount != null && Number.isFinite(vertexCount) && vertexCount > 0) {
    const r = rule.targetVertexCount / vertexCount
    return Math.max(0.001, Math.min(0.999, r))
  }
  if (rule.ratio != null) return Math.max(0.001, Math.min(0.999, rule.ratio))
  return 0.5
}
