#!/usr/bin/env node
import { createLogger } from './lib/logger.mjs'
const log = createLogger("bake-glb-yup")

/**
 * Brennt Root-Node Z-up-Korrekturen (±90° X-Rotation) in die Vertex-Daten ein,
 * sodass die GLB-Dateien nativ Y-up sind – ohne Root-Transform.
 *
 * Bei --out=pfad: Ausgabe in Unterordner nach Oberfläche (verzinkt/matt/textur/gemischt)
 * plus export-log.json und export-log.txt (Ausrichtung, Oberfläche, Metallic/Roughness).
 *
 * Usage:
 *   node scripts/bake-glb-yup.js                          → Vorschau (Dry-Run)
 *   node scripts/bake-glb-yup.js --write                  → In-Place mit .bak-Backup
 *   node scripts/bake-glb-yup.js --out=pfad               → Ausgabe in anderes Verzeichnis
 *   node scripts/bake-glb-yup.js --dir=public/models/xyz  → Anderes Eingabe-Verzeichnis
 *   node scripts/bake-glb-yup.js --file=pfad/zu.glb      → Eine Datei in-place einbrennen (Pipeline)
 *   node scripts/bake-glb-yup.js --file=xyz.glb --ral=9007 --write  → Base Color aus Palette + Metallic/Roughness (Verzinkt)
 *   node scripts/bake-glb-yup.js --file=xyz.glb --ral=7035 --write  → Base Color RAL 7035 + mattes Finish (ohne Base-Textur)
 *   node scripts/bake-glb-yup.js --file=x.glb --ral=7035 --surface=pulver --write  → Farbe RAL, Finish Pulver erzwingen
 *   node scripts/bake-glb-yup.js --file=x.glb --surface=verzinkt --write  → Finish Verzinkt erzwingen
 *   node scripts/bake-glb-yup.js --file=x.glb --write --color-overrides=o.json  → (1) Quellhex→Zielhex; --ral (2) nur ohne Mapping-Treffer; dann (3) Geometrie-, (4) Namensregeln
 *   node scripts/bake-glb-yup.js --file=x.glb --write --name-rules=rules.json  → JSON mit nameColorRules, geometryColorRules, vertexReductionRules und/oder visibilityRules (global→Produkt, letzte passende Regel gewinnt; visibilityRules: action=hide entfernt Treffer, keep schützt sie wieder)
 *   node scripts/bake-glb-yup.js --registry=pfad/export-log.json    → Registry-Datei (Standard: export-log.json im Ausgabe-/Eingabeverzeichnis)
 *   node scripts/bake-glb-yup.js --no-registry                     → Registry ignorieren, RAL/Finish frisch ermitteln
 *   node scripts/bake-glb-yup.js --file=x.glb --write --mtl-for-textures=public/models/obj/a.mtl  → map_Kd aus MTL auf GLB-Materialnamen anwenden, andere Textur-Slots an diesen Materialien leeren
 *   node scripts/bake-glb-yup.js … --mtl-base-texture-repeat=12  → optional KHR_texture_transform (Kachelung); Standard ohne Flag: Textur genau 1× über die Mesh-UVs (keine Extension)
 */
import { NodeIO, PropertyType } from '@gltf-transform/core'
import { ALL_EXTENSIONS, KHRTextureTransform } from '@gltf-transform/extensions'
import { dedup, prune, weldPrimitive, simplifyPrimitive, compactPrimitive } from '@gltf-transform/functions'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { normalizeMappingHex } from '../src/lib/hexMapping.js'
import { compileNameColorRules, sceneNameColorRulesInOrder } from '../src/lib/nameColorRules.js'
import {
  compileGeometryColorRules,
  getPrimitiveGeometryMetrics,
  matchesGeometryColorRule,
} from '../src/lib/geometryColorRules.js'
import {
  compileVertexReductionRules,
  getReductionPrimitiveMetrics,
  matchesGeometryFilter,
  effectiveRatioForRule,
} from '../src/lib/vertexReductionRules.js'
import { compileVisibilityRules } from '../src/lib/visibilityRules.js'
import { parseMtl } from '../src/lib/mtlParser.js'
import { ralFromColorNameAlias } from '../src/lib/colorNameAliases.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const EPSILON = 0.005

const RAL_VERZINKT = 'RAL 9007'

// ─── CLI Args ───────────────────────────────────────────────────────
const args = process.argv.slice(2)
const flag = (name) => {
  const eq = args.find((a) => a.startsWith(`--${name}=`))
  if (eq) return eq.split('=').slice(1).join('=')
  const idx = args.indexOf(`--${name}`)
  if (idx >= 0 && idx + 1 < args.length && !args[idx + 1].startsWith('--')) return args[idx + 1]
  return undefined
}
const hasFlag = (name) => args.some((a) => a === `--${name}` || a.startsWith(`--${name}=`))

const singleFile = flag('file')
const inputDir = path.resolve(ROOT, flag('dir') || 'public/models/products')
const dryRun = !hasFlag('write') && !flag('out') && !singleFile
const outDir = flag('out') ? path.resolve(ROOT, flag('out')) : null
/** RAL aus CLI (z. B. --ral=7016); hat Vorrang vor Dateiname-_RAL_XXXX bei Einzeldatei. */
const cliRalCode = flag('ral')
/** Oberfläche erzwingen: verzinkt | pulver (sonst automatisch aus RAL/Hex). */
const rawSurface = (flag('surface') || '').trim().toLowerCase()
const cliSurfaceMode = rawSurface === 'verzinkt' || rawSurface === 'pulver' ? rawSurface : null
/** Expliziter Pfad zur Export-Registry (Standard: export-log.json im Output-/Input-Verzeichnis). */
const registryPathArg = flag('registry')
/** Registry ignorieren, RAL/Finish frisch aus Dateiname/CLI/nearestRAL ermitteln. */
const noRegistry = hasFlag('no-registry')
/** JSON: { "#Quellhex": "#Zielhex" } — wie Konverter colorOverrides (mtl-ral-color-mapping). */
const colorOverridesPathArg = flag('color-overrides')
let colorOverridesForBake = null
if (colorOverridesPathArg) {
  const coPath = path.isAbsolute(colorOverridesPathArg)
    ? colorOverridesPathArg
    : path.resolve(ROOT, colorOverridesPathArg)
  try {
    if (fs.existsSync(coPath)) {
      const parsed = JSON.parse(fs.readFileSync(coPath, 'utf-8'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        colorOverridesForBake = parsed
      }
    }
  } catch (e) {
        log.warn('  ⚠ color-overrides konnte nicht geladen werden:', e.message)
  }
}

/** JSON: { nameColorRules?, geometryColorRules?, vertexReductionRules?, visibilityRules? } oder reines Array (= nur nameColorRules) */
const nameRulesPathArg = flag('name-rules')
let nameColorRulesCompiled = null
let geometryColorRulesCompiled = null
let vertexReductionRulesCompiled = null
let visibilityRulesCompiled = null
/** Materialien, deren Oberfläche explizit durch eine Namens-Regel festgelegt wurde.
 *  `applyMaterialFinish[FromRegistry]` respektiert diesen Override und überschreibt nicht. */
const finishLockedMaterials = new WeakSet()
if (nameRulesPathArg) {
  const nrPath = path.isAbsolute(nameRulesPathArg) ? nameRulesPathArg : path.resolve(ROOT, nameRulesPathArg)
  try {
    if (fs.existsSync(nrPath)) {
      const parsed = JSON.parse(fs.readFileSync(nrPath, 'utf-8'))
      const raw = Array.isArray(parsed) ? parsed : parsed?.nameColorRules
      nameColorRulesCompiled = compileNameColorRules(Array.isArray(raw) ? raw : [])
      const geoRaw = Array.isArray(parsed) ? null : parsed?.geometryColorRules
      geometryColorRulesCompiled = compileGeometryColorRules(Array.isArray(geoRaw) ? geoRaw : [])
      const reductionRaw = Array.isArray(parsed) ? null : parsed?.vertexReductionRules
      vertexReductionRulesCompiled = compileVertexReductionRules(Array.isArray(reductionRaw) ? reductionRaw : [])
      const visibilityRaw = Array.isArray(parsed) ? null : parsed?.visibilityRules
      visibilityRulesCompiled = compileVisibilityRules(Array.isArray(visibilityRaw) ? visibilityRaw : [])
    }
  } catch (e) {
        log.warn('  ⚠ name-rules konnte nicht geladen werden:', e.message)
  }
}

const _rawMtlForTex = flag('mtl-for-textures')
const mtlForTexturesAbs = _rawMtlForTex
  ? path.isAbsolute(_rawMtlForTex)
    ? _rawMtlForTex
    : path.resolve(ROOT, _rawMtlForTex)
  : null
const mtlTextureExtraDirs = (flag('mtl-texture-extra-dirs') || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((p) => (path.isAbsolute(p) ? p : path.resolve(ROOT, p)))
/** Optional: UV-Kachelung (KHR_texture_transform scale > 1). Ohne Flag: keine Extension (= 1× über UV). */
const mtlBaseTextureRepeatRaw = flag('mtl-base-texture-repeat')
// Material-Finish wird automatisch aus ralColors.json + baseColor ermittelt (pro Material)

const KHR_TEXTURE_TRANSFORM = 'KHR_texture_transform'

// ─── Quaternion-Mathematik ──────────────────────────────────────────
function isIdentityQuat([x, y, z, w]) {
  return Math.abs(x) < EPSILON && Math.abs(y) < EPSILON &&
         Math.abs(z) < EPSILON && Math.abs(Math.abs(w) - 1) < EPSILON
}

function isZupCorrection([x, y, z, w]) {
  return Math.abs(Math.abs(x) - 0.7071) < 0.03 &&
         Math.abs(y) < 0.03 && Math.abs(z) < 0.03 &&
         Math.abs(Math.abs(w) - 0.7071) < 0.03
}

function quatToMat3([qx, qy, qz, qw]) {
  const xx = qx * qx, yy = qy * qy, zz = qz * qz
  const xy = qx * qy, xz = qx * qz, yz = qy * qz
  const wx = qw * qx, wy = qw * qy, wz = qw * qz
  return [
    1 - 2 * (yy + zz), 2 * (xy - wz),     2 * (xz + wy),
    2 * (xy + wz),     1 - 2 * (xx + zz), 2 * (yz - wx),
    2 * (xz - wy),     2 * (yz + wx),     1 - 2 * (xx + yy),
  ]
}

function rotVec3(m, x, y, z) {
  return [
    m[0] * x + m[1] * y + m[2] * z,
    m[3] * x + m[4] * y + m[5] * z,
    m[6] * x + m[7] * y + m[8] * z,
  ]
}

function quatMul([ax, ay, az, aw], [bx, by, bz, bw]) {
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]
}

/** 3×3-Rotationsteil der 4×4-Matrix ist Identity (bis auf EPSILON). */
function isIdentityMatrix4(m) {
  if (!m || m.length < 16) return true
  const e = EPSILON
  return (
    Math.abs(m[0] - 1) < e && Math.abs(m[1]) < e && Math.abs(m[2]) < e &&
    Math.abs(m[4]) < e && Math.abs(m[5] - 1) < e && Math.abs(m[6]) < e &&
    Math.abs(m[8]) < e && Math.abs(m[9]) < e && Math.abs(m[10] - 1) < e
  )
}

/** Quaternion aus 4×4-Matrix (3×3-Rotation, column-major) extrahieren (xyzw). */
function mat4ToQuat(m) {
  if (!m || m.length < 16) return [0, 0, 0, 1]
  const m0 = m[0], m1 = m[1], m2 = m[2], m4 = m[4], m5 = m[5], m6 = m[6], m8 = m[8], m9 = m[9], m10 = m[10]
  const trace = m0 + m5 + m10
  const out = [0, 0, 0, 1]
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1)
    out[3] = 0.25 / s
    out[0] = (m6 - m9) * s
    out[1] = (m8 - m2) * s
    out[2] = (m4 - m1) * s
  } else if (m0 > m5 && m0 > m10) {
    const s = 2 * Math.sqrt(1 + m0 - m5 - m10)
    out[3] = (m6 - m9) / s
    out[0] = 0.25 * s
    out[1] = (m1 + m4) / s
    out[2] = (m2 + m8) / s
  } else if (m5 > m10) {
    const s = 2 * Math.sqrt(1 + m5 - m0 - m10)
    out[3] = (m8 - m2) / s
    out[0] = (m1 + m4) / s
    out[1] = 0.25 * s
    out[2] = (m6 + m9) / s
  } else {
    const s = 2 * Math.sqrt(1 + m10 - m0 - m5)
    out[3] = (m4 - m1) / s
    out[0] = (m2 + m8) / s
    out[1] = (m6 + m9) / s
    out[2] = 0.25 * s
  }
  return out
}

// ─── Transform-Logik ────────────────────────────────────────────────
/** Einzelnen Node prüfen und ggf. Rotation einbrennen (alle Ebenen, nicht nur Scene-Kinder). */
function bakeNodeRotation(node) {
  let q = node.getRotation()
  const mat = node.getMatrix ? node.getMatrix() : null
  const matrixNotIdentity = mat && !isIdentityMatrix4(mat)
  if (isIdentityQuat(q) && !matrixNotIdentity) return false
  if (isIdentityQuat(q) && matrixNotIdentity) q = mat4ToQuat(mat)

  const s = node.getScale()
  if (Math.abs(s[0] - 1) > EPSILON || Math.abs(s[1] - 1) > EPSILON || Math.abs(s[2] - 1) > EPSILON) {
    return false
  }

  const mat3 = quatToMat3(q)

  const ownMesh = node.getMesh()
  if (ownMesh) transformMeshData(ownMesh, q)

  pushRotationDown(node, q, mat3)

  node.setRotation([0, 0, 0, 1])
  node.setTranslation([0, 0, 0])
  return true
}

function bakeRootRotation(doc) {
  const root = doc.getRoot()
  let baked = false

  for (const scene of root.listScenes()) {
    scene.traverse((node) => {
      if (bakeNodeRotation(node)) baked = true
    })
  }
  return baked
}

function pushRotationDown(parentNode, parentQ, parentMat) {
  for (const child of parentNode.listChildren()) {
    const ct = child.getTranslation()
    child.setTranslation(rotVec3(parentMat, ct[0], ct[1], ct[2]))

    const cq = child.getRotation()
    const newQ = quatMul(parentQ, cq)
    child.setRotation(newQ)

    if (child.listChildren().length > 0) {
      if (!isIdentityQuat(newQ)) {
        const newMat = quatToMat3(newQ)
        pushRotationDown(child, newQ, newMat)
        child.setRotation([0, 0, 0, 1])
      }
    } else {
      bakeLeafMesh(child)
    }
  }
}

function bakeLeafMesh(node) {
  const q = node.getRotation()
  if (isIdentityQuat(q)) return

  const mesh = node.getMesh()
  if (!mesh) {
    node.setRotation([0, 0, 0, 1])
    return
  }

  const parents = mesh.listParents().filter((p) => p.propertyType === 'Node')
  if (parents.length > 1) {
        log.info(`    ⚠ Mesh wird von ${parents.length} Nodes geteilt – klone für sicheres Baking`)
    const clone = mesh.clone()
    node.setMesh(clone)
    transformMeshData(clone, q)
  } else {
    transformMeshData(mesh, q)
  }

  node.setRotation([0, 0, 0, 1])
}

function transformMeshData(mesh, q) {
  const mat = quatToMat3(q)

  for (const prim of mesh.listPrimitives()) {
    rotateAccessor(prim.getAttribute('POSITION'), mat)
    rotateAccessor(prim.getAttribute('NORMAL'), mat)
    rotateTangentAccessor(prim.getAttribute('TANGENT'), mat)

    for (const target of prim.listTargets()) {
      rotateAccessor(target.getAttribute('POSITION'), mat)
      rotateAccessor(target.getAttribute('NORMAL'), mat)
      rotateTangentAccessor(target.getAttribute('TANGENT'), mat)
    }
  }
}

function rotateAccessor(accessor, mat) {
  if (!accessor) return
  const arr = accessor.getArray()
  if (!arr) return
  for (let i = 0; i < arr.length; i += 3) {
    const [rx, ry, rz] = rotVec3(mat, arr[i], arr[i + 1], arr[i + 2])
    arr[i] = rx; arr[i + 1] = ry; arr[i + 2] = rz
  }
  accessor.setArray(arr)
}

function rotateTangentAccessor(accessor, mat) {
  if (!accessor) return
  const arr = accessor.getArray()
  if (!arr) return
  for (let i = 0; i < arr.length; i += 4) {
    const [rx, ry, rz] = rotVec3(mat, arr[i], arr[i + 1], arr[i + 2])
    arr[i] = rx; arr[i + 1] = ry; arr[i + 2] = rz
    // arr[i+3] (w / handedness) bleibt unverändert
  }
  accessor.setArray(arr)
}

// ─── Material-Finish (Metallic/Roughness) ───────────────────────────
// RAL-Palette laden und pro Material den nächsten RAL matchen.
// RAL 9007 (Verzinkt) → 0.75/0.25, alle anderen → 0/0.35.

/** sRGB → linear (glTF baseColorFactor ist im linearen Farbraum definiert). */
function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** Linear → sRGB-Kanal (0…1), für Vergleich mit MTL-Override-Keys in sRGB-#hex. */
function linearToSrgbChannel(c) {
  if (c <= 0) return 0
  if (c >= 1) return 1
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

/** glTF baseColorFactor (linear) → normalisiertes sRGB-#RRGGBB für Mapping-Lookup. */
function linearFactorToSrgbHex(factor) {
  if (!factor || factor.length < 3) return ''
  const r = linearToSrgbChannel(Math.max(0, Math.min(1, factor[0])))
  const g = linearToSrgbChannel(Math.max(0, Math.min(1, factor[1])))
  const b = linearToSrgbChannel(Math.max(0, Math.min(1, factor[2])))
  const to255 = (x) => Math.round(Math.max(0, Math.min(255, x * 255)))
  return (
    '#' +
    [to255(r), to255(g), to255(b)]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  )
}

/**
 * Palette-Einträge enthalten sowohl sRGB (für Vergleich mit bestehenden GLB-Farben,
 * die ggf. schon sRGB-in-linear stehen) als auch lineare Werte (für setBaseColorFactor).
 */
function loadRalPalette() {
  try {
    const ralPath = path.join(ROOT, 'src/data/ralColors.json')
    const raw = JSON.parse(fs.readFileSync(ralPath, 'utf-8'))
    const entries = []
    for (const [key, val] of Object.entries(raw)) {
      if (key === '_meta' || !val?.hex) continue
      const h = String(val.hex).replace(/^#/, '')
      if (h.length !== 6) continue
      const rs = parseInt(h.slice(0, 2), 16) / 255
      const gs = parseInt(h.slice(2, 4), 16) / 255
      const bs = parseInt(h.slice(4, 6), 16) / 255
      entries.push({
        code: key,
        r: rs, g: gs, b: bs,
        rLin: srgbToLinear(rs), gLin: srgbToLinear(gs), bLin: srgbToLinear(bs),
      })
    }
    return entries
  } catch { return [] }
}

function nearestRAL(palette, r, g, b) {
  if (!palette.length) return null
  let best = null, bestD = Infinity
  for (const e of palette) {
    const d = (r - e.r) ** 2 + (g - e.g) ** 2 + (b - e.b) ** 2
    if (d < bestD) { bestD = d; best = e.code }
  }
  return best
}

/** Liefert RAL-Code nur bei exaktem Treffer (Toleranz 1/255). Für Finish: nur exakt RAL 9007 = Verzinkt. */
function exactMatchRAL(palette, r, g, b) {
  if (!palette.length) return null
  const tol = 1 / 255
  for (const e of palette) {
    if (Math.abs(r - e.r) <= tol && Math.abs(g - e.g) <= tol && Math.abs(b - e.b) <= tol) return e.code
  }
  return null
}

/** Wie exactMatchRAL, aber im linearen Farbraum (für glTF baseColorFactor). */
function exactMatchRALLinear(palette, rLin, gLin, bLin) {
  if (!palette.length) return null
  const tol = 0.005
  for (const e of palette) {
    if (Math.abs(rLin - e.rLin) <= tol && Math.abs(gLin - e.gLin) <= tol && Math.abs(bLin - e.bLin) <= tol) return e.code
  }
  return null
}

function getRALColorFromPalette(palette, ralCode) {
  if (!palette?.length || !ralCode) return null
  const needle = String(ralCode).trim().toUpperCase()
  const item = palette.find((e) => String(e.code || '').trim().toUpperCase() === needle)
  return item ? { r: item.r, g: item.g, b: item.b } : null
}

/** Vierstellige Ziffern aus CLI (--ral=7035) → Palette-Key „RAL 7035“. */
function ralPaletteKeyFromCli(ralArg) {
  const digits = String(ralArg || '').replace(/\D/g, '').slice(-4)
  if (!/^\d{4}$/.test(digits)) return null
  return `RAL ${digits}`
}

/**
 * Wendet projekt-Mapping (Quell-#hex → Ziel-#hex) auf Materialien ohne Base-Color-Textur an.
 * Basis-Schicht im Automatisch-Modus (`__mapping__`): Farbe aus den Datei-Hexwerten.
 * Überspringt bereits durch höher-priorisierte Regeln (Namen/Geometrie) gelockte Materialien
 * und lockt eigene Treffer, damit der Auto-Alias-Fallback sie nicht mehr anfasst.
 */
function applyMtlColorOverrides(doc, overrides, remappedWeakSet) {
  if (!overrides || typeof overrides !== 'object') return 0
  let n = 0
  for (const mat of doc.getRoot().listMaterials()) {
    if (remappedWeakSet?.has(mat)) continue
    if (mat.getBaseColorTexture()) continue
    const factor = mat.getBaseColorFactor() || [1, 1, 1, 1]
    const srcHex = normalizeMappingHex(linearFactorToSrgbHex(factor))
    if (!srcHex) continue
    let targetHex = overrides[srcHex] ?? overrides[srcHex.toLowerCase()]
    if (targetHex == null) continue
    const tNorm = normalizeMappingHex(String(targetHex))
    if (!/^#[0-9A-F]{6}$/.test(tNorm)) continue
    const tr = parseInt(tNorm.slice(1, 3), 16) / 255
    const tg = parseInt(tNorm.slice(3, 5), 16) / 255
    const tb = parseInt(tNorm.slice(5, 7), 16) / 255
    mat.setBaseColorFactor([srgbToLinear(tr), srgbToLinear(tg), srgbToLinear(tb), factor[3] ?? 1])
    remappedWeakSet?.add(mat)
    n++
  }
  if (n) log.info(`    MTL→RAL Hex-Overrides: ${n} Material(ien) Base Color gesetzt`)
  return n
}

/** Letztes bildtragendes Token aus MTL map_*-Restzeile (Optionen wie -o … vor dem Dateinamen). */
function filenameFromMapLineRest(rest) {
  if (!rest || !String(rest).trim()) return null
  const tokens = String(rest).trim().split(/\s+/)
  const extRe = /\.(png|jpe?g|webp|tif|tga)$/i
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i]
    if (!t || t.startsWith('-')) continue
    if (extRe.test(t)) return t.replace(/\\/g, '/')
  }
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i]
    if (!t || t.startsWith('-')) continue
    return t.replace(/\\/g, '/')
  }
  return null
}

function stripNonBaseColorTextureSlots(mat) {
  mat.setMetallicRoughnessTexture(null)
  mat.setNormalTexture(null)
  mat.setOcclusionTexture(null)
  mat.setEmissiveTexture(null)
}

function mimeFromImagePath(p) {
  const low = String(p).toLowerCase()
  if (low.endsWith('.png')) return 'image/png'
  if (low.endsWith('.jpg') || low.endsWith('.jpeg')) return 'image/jpeg'
  if (low.endsWith('.webp')) return 'image/webp'
  return 'image/png'
}

function resolveMapKdFileOnDisk(mtlDir, relFromMtl, extraDirs) {
  const norm = relFromMtl.replace(/\\/g, '/')
  const tries = [path.resolve(mtlDir, norm)]
  const base = path.basename(norm)
  for (const d of extraDirs) {
    tries.push(path.resolve(d, base))
    tries.push(path.resolve(d, norm))
  }
  for (const t of tries) {
    try {
      if (fs.existsSync(t) && fs.statSync(t).isFile()) return t
    } catch (_) {}
  }
  return null
}

/**
 * UV-Scale für KHR_texture_transform (nur wenn > 1): Kachelung.
 * Standard: 1 = keine Extension, Textur legt sich genau einmal gemäß Mesh-UVs.
 */
function baseTextureUvRepeatScale() {
  const raw = (mtlBaseTextureRepeatRaw || '').trim().toLowerCase()
  if (raw === '' || raw === 'off' || raw === 'none' || raw === '1' || raw === 'auto') return 1
  const num = parseFloat(mtlBaseTextureRepeatRaw || '')
  if (!Number.isFinite(num) || num <= 1) return 1
  return Math.min(64, num)
}

/** Entfernt die Root-Extension KHR_texture_transform, wenn keine TextureInfo sie mehr nutzt. */
function disposeKhrTextureTransformIfUnused(document) {
  for (const mat of document.getRoot().listMaterials()) {
    const infos = [
      mat.getBaseColorTextureInfo(),
      mat.getMetallicRoughnessTextureInfo(),
      mat.getNormalTextureInfo(),
      mat.getOcclusionTextureInfo(),
      mat.getEmissiveTextureInfo(),
    ]
    for (const info of infos) {
      if (info?.getExtension(KHR_TEXTURE_TRANSFORM)) return
    }
  }
  document.disposeExtension(KHR_TEXTURE_TRANSFORM)
}

/**
 * Wendet MTL map_Kd (Materialname = glTF material.name) auf die GLB an: Base-Color-Textur aus
 * Datei, alle anderen Textur-Slots an diesen Materialien entfernen; unbenutzte Texturen prunen.
 */
async function applyMtlDeclaredBaseTexturesFromMtl(document) {
  if (!mtlForTexturesAbs) return 0
  if (!fs.existsSync(mtlForTexturesAbs)) {
        log.warn(`  ⚠ --mtl-for-textures: Datei fehlt: ${mtlForTexturesAbs}`)
    return 0
  }
  let text
  try {
    text = fs.readFileSync(mtlForTexturesAbs, 'utf-8')
  } catch (e) {
        log.warn(`  ⚠ MTL für Texturen konnte nicht gelesen werden: ${e.message}`)
    return 0
  }
  const { materials: mtlMats } = parseMtl(text)
  const mtlDir = path.dirname(mtlForTexturesAbs)
  let applied = 0
  let khrTexTransform = null
  const glbMaterials = document.getRoot().listMaterials()
  const nameToGlbMat = new Map(glbMaterials.map((m) => [m.getName() || '', m]))

  for (const mm of mtlMats) {
    const mapKdRaw = mm.maps?.Kd
    if (mapKdRaw == null || String(mapKdRaw).trim() === '') continue
    const relFile = filenameFromMapLineRest(String(mapKdRaw))
    if (!relFile) continue
    const glbMat = nameToGlbMat.get(mm.name)
    if (!glbMat) {
            log.warn(`    MTL map_Kd "${relFile}": kein Material "${mm.name}" in GLB`)
      continue
    }
    stripNonBaseColorTextureSlots(glbMat)
    const abs = resolveMapKdFileOnDisk(mtlDir, relFile, mtlTextureExtraDirs)
    if (!abs) {
      glbMat.setBaseColorTexture(null)
      if (mm.Kd) {
        const r = srgbToLinear(Math.max(0, Math.min(1, mm.Kd.r)))
        const g = srgbToLinear(Math.max(0, Math.min(1, mm.Kd.g)))
        const b = srgbToLinear(Math.max(0, Math.min(1, mm.Kd.b)))
        glbMat.setBaseColorFactor([r, g, b, 1])
      }
      log.warn(
        `    MTL map_Kd "${relFile}" für "${mm.name}": Datei nicht gefunden → Fremdtexturen entfernt, nur Kd-Faktor`,
      )
      applied++
      continue
    }
    let buf
    try {
      buf = fs.readFileSync(abs)
    } catch (e) {
            log.warn(`    map_Kd "${abs}": ${e.message}`)
      continue
    }
    const tex = document.createTexture(path.basename(abs))
    tex.setMimeType(mimeFromImagePath(abs))
    tex.setImage(new Uint8Array(buf))
    glbMat.setBaseColorTexture(tex)
    glbMat.setBaseColorFactor([1, 1, 1, 1])
    const texInfo = glbMat.getBaseColorTextureInfo()
    if (texInfo) texInfo.setExtension(KHR_TEXTURE_TRANSFORM, null)
    const scale = baseTextureUvRepeatScale()
    let khrNote = ''
    if (scale > 1) {
      if (!khrTexTransform) khrTexTransform = document.createExtension(KHRTextureTransform)
      const xf = khrTexTransform.createTransform().setScale([scale, scale])
      texInfo?.setExtension(KHR_TEXTURE_TRANSFORM, xf)
      khrNote = `; KHR_texture_transform [${scale},${scale}] (Kachelung)`
    }
        log.info(`    MTL map_Kd → Base-Textur: "${mm.name}" ← ${path.basename(abs)}${khrNote}`)
    applied++
  }

  if (applied > 0) {
    try {
      await document.transform(
        dedup({ propertyTypes: [PropertyType.TEXTURE] }),
        prune(),
      )
    } catch (e) {
            log.warn(`    ⚠ dedup/prune nach MTL-Texturen: ${e.message}`)
    }
    disposeKhrTextureTransformIfUnused(document)
  }
  return applied
}

/**
 * Schreibt Base Color (glTF-Faktor) aus ralColors.json für alle noch ungefärbten Materialien
 * (ohne Base-Color-Textur). Basis-Schicht: explizite Standardfarbe (--ral), bzw. dominanter
 * RAL-Fallback im Automatisch-Modus. glTF baseColorFactor ist **linear** → sRGB-Hex konvertiert.
 * @param {WeakSet<object>|null} lockedSet — bereits durch höhere Schichten gefärbte Materialien; werden übersprungen und eigene Treffer gelockt.
 */
function applyCliRalBaseColor(doc, lockedSet = null) {
  if (!cliRalCode) return
  const key = ralPaletteKeyFromCli(cliRalCode)
  if (!key) return
  const palette = loadRalPalette()
  const item = palette.find((e) => String(e.code || '').trim().toUpperCase() === key.toUpperCase())
  if (!item) {
        log.info(`    ⚠ ${key} nicht in ralColors.json – Base Color unverändert`)
    return
  }
  const { rLin, gLin, bLin, r, g, b } = item
  const srgbHex = '#' + [r, g, b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase()
  let n = 0
  for (const mat of doc.getRoot().listMaterials()) {
    if (lockedSet?.has(mat)) continue
    if (mat.getBaseColorTexture()) continue
    mat.setBaseColorFactor([rLin, gLin, bLin, 1])
    lockedSet?.add(mat)
    n++
  }
  if (n) log.info(`    Base Color → ${key} ${srgbHex} (${n} Materialien, linear: [${rLin.toFixed(4)}, ${gLin.toFixed(4)}, ${bLin.toFixed(4)}])`)
}

/** Szene von Wurzel bis Blatt: `Eltern/…/Knoten` (leere Namen bleiben als leere Segmente erhalten). */
function getReductionNodePath(node) {
  const parts = []
  for (let n = node; n; n = n.getParentNode()) parts.unshift(n.getName() || '')
  return parts.join('/')
}

/** Ein String für Regex auf CAD-/Tool-Metadaten in `extras` (Node, Mesh, Primitive). */
function getReductionExtrasMatchString(node, mesh, prim) {
  const payload = {
    node: node.getExtras() || {},
    mesh: mesh ? mesh.getExtras() || {} : {},
    primitive: prim.getExtras() || {},
  }
  try {
    return JSON.stringify(payload)
  } catch {
    return ''
  }
}

function reductionHaystackForRule(rule, node, mesh, meshName, nodePathStr, extrasStr, materialName) {
  if (rule.target === 'material') return materialName || ''
  if (rule.target === 'node') return node.getName() || ''
  if (rule.target === 'mesh') return meshName
  if (rule.target === 'nodePath') return nodePathStr
  if (rule.target === 'extras') return extrasStr
  return ''
}

function reductionRuleLabel(t) {
  if (t === 'material') return 'Material'
  if (t === 'node') return 'Knoten'
  if (t === 'mesh') return 'Mesh'
  if (t === 'nodePath') return 'Pfad'
  if (t === 'extras') return 'Extras'
  return t
}

/**
 * Erklärt in Klartext, weshalb `matchesGeometryFilter(m, rule)` `false` lieferte.
 * Wird ausschließlich für Diagnose-Logs in `applyVertexReductionRules` verwendet.
 */
function describeGeometryFilterFailure(m, rule) {
  if (!m) return 'keine Geometrie-Metriken'
  if (rule.vertexCountMin != null && m.vertexCount < rule.vertexCountMin) {
    return `vertexCount=${m.vertexCount} < vMin=${rule.vertexCountMin}`
  }
  if (rule.vertexCountMax != null && m.vertexCount > rule.vertexCountMax) {
    return `vertexCount=${m.vertexCount} > vMax=${rule.vertexCountMax}`
  }
  if (rule.extentMin || rule.extentMax || rule.sortedExtentMin || rule.sortedExtentMax) {
    return `extent (dx=${m.dx.toFixed(3)},dy=${m.dy.toFixed(3)},dz=${m.dz.toFixed(3)}) verfehlt extent-Schranken`
  }
  if (rule.maxExtentMin != null && m.maxExtent + 1e-5 < rule.maxExtentMin) {
    return `maxExtent=${m.maxExtent.toFixed(3)} < maxExtentMin=${rule.maxExtentMin}`
  }
  if (rule.maxExtentMax != null && m.maxExtent - 1e-5 > rule.maxExtentMax) {
    return `maxExtent=${m.maxExtent.toFixed(3)} > maxExtentMax=${rule.maxExtentMax}`
  }
  if (rule.volumeMin != null && m.volume + 1e-5 < rule.volumeMin) {
    return `volume=${m.volume.toFixed(6)} < volumeMin=${rule.volumeMin}`
  }
  if (rule.volumeMax != null && m.volume - 1e-5 > rule.volumeMax) {
    return `volume=${m.volume.toFixed(6)} > volumeMax=${rule.volumeMax}`
  }
  return 'Geometrie-Filter (unbekannte Schranke)'
}

/**
 * Kurzform einer Regel für Logs. Vermeidet riesige Ausgaben.
 */
function summarizeReductionRule(rule, idx) {
  const fields = [
    `target=${rule.target}`,
    rule.pattern ? `pattern=/${rule.pattern}/${rule.flags || ''}` : null,
    rule.vertexCountMin != null ? `vMin=${rule.vertexCountMin}` : null,
    rule.vertexCountMax != null ? `vMax=${rule.vertexCountMax}` : null,
    rule.ratio != null ? `ratio=${rule.ratio}` : null,
    rule.targetVertexCount != null ? `targetV=${rule.targetVertexCount}` : null,
    rule.error != null ? `error=${rule.error}` : null,
    rule.lockBorder ? 'lockBorder' : null,
  ].filter(Boolean)
  return `[#${idx}] ${fields.join(' · ')}`
}

/**
 * Reduziert ein einzelnes Primitive in mehreren Stufen, damit auch
 * CAD-Geometrie (Schraubgewinde, non-manifold Edges, T-Junctions aus
 * STEP→Blender-Tessellation) zuverlässig schrumpft.
 *
 * Pipeline:
 *   1. Aggressives Pre-Welding (`overwrite: true`) — bitwise-identische Vertex-
 *      Tupel werden zusammengeführt, sodass meshoptimizer überhaupt eine
 *      verwertbare Adjacency sieht. Bei CAD-konvertierten Modellen ist das
 *      oft schon der Hauptgewinn (~50 % der Vertices verschwinden).
 *   2. Strikter Pass via `simplifyPrimitive` (gltf-transform) — respektiert
 *      die Fehler-Schranke, ist aber „brav" bei Schraubgewinden.
 *   3. Wenn der strikte Pass weniger als die halbe Strecke zum Soll geschafft
 *      hat **und** der Nutzer ein konkretes Reduktions-Ziel formuliert hat
 *      (`ratio < 0.9` oder `targetVertexCount`), wird ein **Sloppy-Pass**
 *      direkt über `MeshoptSimplifier.simplifySloppy` nachgeschoben. Dieser
 *      ignoriert Mesh-Topologie und garantiert, dass das Ziel ungefähr
 *      erreicht wird — Preis: leichte Topologie-Kosmetik, was für
 *      Vorschau-Schrauben unkritisch ist.
 *
 * @param {import('@gltf-transform/core').Primitive} prim
 * @param {object} chosen — kompilierte Regel
 * @param {number} ratio — effektive Ratio aus `effectiveRatioForRule`
 * @param {object} simplifier — MeshoptSimplifier
 * @returns {{
 *   resultPrim: import('@gltf-transform/core').Primitive,
 *   beforeWeld: number,
 *   afterWeld: number,
 *   afterStrict: number,
 *   afterSloppy: number|null,
 *   sloppyUsed: boolean,
 * }}
 */
function reducePrimitiveRobust(prim, chosen, ratio, simplifier) {
  const beforeWeld = prim.getAttribute('POSITION')?.getCount() ?? 0
  weldPrimitive(prim, { overwrite: true })
  const afterWeld = prim.getAttribute('POSITION')?.getCount() ?? beforeWeld

  const targetError = chosen.error ?? 0.001
  const lockBorder = !!chosen.lockBorder

  let resultPrim = prim
  try {
    resultPrim = simplifyPrimitive(prim, {
      simplifier,
      ratio,
      error: targetError,
      lockBorder,
    }) || prim
  } catch (e) {
    return {
      resultPrim,
      beforeWeld,
      afterWeld,
      afterStrict: afterWeld,
      afterSloppy: null,
      sloppyUsed: false,
      error: e,
    }
  }

  const afterStrict = resultPrim.getAttribute('POSITION')?.getCount() ?? afterWeld

  const targetVertexAbs =
    Number.isFinite(chosen.targetVertexCount) && chosen.targetVertexCount > 0
      ? Math.max(3, Math.floor(chosen.targetVertexCount))
      : Math.max(3, Math.floor(afterWeld * ratio))
  const wantedReduction = ratio < 0.9 || Number.isFinite(chosen.targetVertexCount)
  const expectedRemoved = Math.max(0, afterWeld - targetVertexAbs)
  const actualRemoved = Math.max(0, afterWeld - afterStrict)
  const halfwayMissed = wantedReduction && expectedRemoved > 0 && actualRemoved < expectedRemoved * 0.5

  if (!halfwayMissed) {
    return {
      resultPrim,
      beforeWeld,
      afterWeld,
      afterStrict,
      afterSloppy: null,
      sloppyUsed: false,
    }
  }

  // Sloppy-Fallback direkt über die Simplifier-API.
  // Wir arbeiten auf den (durch Strict-Pass evtl. schon verkleinerten)
  // Indices/Positionen weiter und reduzieren bis zum Ziel-Index-Count.
  try {
    const indicesAcc = resultPrim.getIndices()
    const posAcc = resultPrim.getAttribute('POSITION')
    if (!indicesAcc || !posAcc) {
      return { resultPrim, beforeWeld, afterWeld, afterStrict, afterSloppy: null, sloppyUsed: false }
    }
    const srcIndices = indicesAcc.getArray()
    const srcPositions = posAcc.getArray()
    const indices32 = srcIndices instanceof Uint32Array ? srcIndices : new Uint32Array(srcIndices)
    const positions32 = srcPositions instanceof Float32Array ? srcPositions : new Float32Array(srcPositions)
    const srcIndexCount = indices32.length
    const srcVertexCount = posAcc.getCount()
    const targetIndexCount = Math.max(
      3,
      Math.floor(((targetVertexAbs / Math.max(1, srcVertexCount)) * srcIndexCount) / 3) * 3,
    )
    if (targetIndexCount >= srcIndexCount) {
      return { resultPrim, beforeWeld, afterWeld, afterStrict, afterSloppy: null, sloppyUsed: false }
    }
    // Sloppy ignoriert Topologie/Borders und liefert garantiert < target_index_count Indices.
    // Wir geben einen großzügigen Fehler-Threshold (1.0 = unbegrenzt), damit das Ziel sicher erreicht wird.
    const [dstIndices /* , reportedError */] = simplifier.simplifySloppy(
      indices32,
      positions32,
      3,
      null,
      targetIndexCount,
      Math.max(targetError, 1.0),
    )
    if (!dstIndices || dstIndices.length === 0 || dstIndices.length >= srcIndexCount) {
      return { resultPrim, beforeWeld, afterWeld, afterStrict, afterSloppy: null, sloppyUsed: false }
    }
    indicesAcc.setArray(dstIndices.length <= 65534 && dstIndices.every((v) => v <= 65535)
      ? new Uint16Array(dstIndices)
      : new Uint32Array(dstIndices))
    compactPrimitive(resultPrim)
    const afterSloppy = resultPrim.getAttribute('POSITION')?.getCount() ?? afterStrict
    return { resultPrim, beforeWeld, afterWeld, afterStrict, afterSloppy, sloppyUsed: true }
  } catch (e) {
    return { resultPrim, beforeWeld, afterWeld, afterStrict, afterSloppy: null, sloppyUsed: false, sloppyError: e }
  }
}

/**
 * Entfernt Knoten/Primitive nach Sichtbarkeits-Regeln (analog Vertex-Reduktion,
 * aber ohne Geometrie-Filter und ohne Ratio).
 *
 *   - Match per Name-Regex auf einem von fünf Haystacks:
 *     `material | node | mesh | nodePath | extras` (selbe Logik wie Reduktion).
 *   - `action: 'hide'` setzt das Primitive auf „unsichtbar"; `action: 'keep'`
 *     überschreibt einen vorherigen `hide`-Treffer (last-wins) — so kann man
 *     Whitelist-Patterns oder gezielte Ausnahmen formulieren.
 *   - Standard ohne Treffer: sichtbar.
 *
 * Verhältnis zur Vertex-Reduktion:
 *   - Sichtbarkeit läuft **vor** der Reduktion. Ein gelöschtes Element kann
 *     nicht mehr reduziert werden — die zwei Systeme stören sich nicht.
 *   - Nach den Disposes ruft die Funktion zwingend `prune()` + `dedup()` auf,
 *     damit verwaiste Accessoren, Materialien, Texturen und Buffer-Daten nicht
 *     im GLB landen. Ohne diesen Cleanup-Schritt wäre die Datei deutlich
 *     größer als das Original (Buffer bleiben in der GLB-BIN-Section liegen).
 *
 * Ausführungsstufen:
 *   1. Pro Primitive Last-wins über alle Regeln → `hide` markiert zum Löschen,
 *      `keep` neutralisiert einen vorherigen `hide`-Treffer.
 *   2. Mesh-lose Knoten (Gruppen) werden über `node`/`nodePath`/`extras`
 *      gematched; Material/Mesh-Targets ignoriert.
 *   3. `prim.dispose()` für markierte Primitives, `node.dispose()` für ganze
 *      Knoten (dispose löst auch die Kinder aus der Hierarchie).
 *   4. `await doc.transform(prune(), dedup())` räumt verwaiste Resources auf.
 *
 * @param {import('@gltf-transform/core').Document} doc
 * @param {Array<object>} rules — kompilierte visibilityRules
 * @returns {Promise<number>} Anzahl entfernter Primitives + Knoten
 */
async function applyVisibilityRules(doc, rules) {
  if (!rules?.length) return 0
    log.info(`    Sichtbarkeit: ${rules.length} Regel(n) — pro Primitive last-wins (hide/keep):`)
  rules.forEach((r, idx) => {
    log.info(
      `      [#${idx + 1}] action=${r.action} · target=${r.target} · pattern=/${r.pattern}/${r.flags || ''}`,
    )
  })

  /** @type {Array<{ prim: any, mesh: any, node: any, rule: any, hay: string }>} */
  const primHits = []
  /** @type {Array<{ node: any, rule: any, hay: string }>} */
  const nodeHits = []
  const ruleStats = rules.map(() => ({ hideHits: 0, keepHits: 0 }))
  let scannedPrims = 0

  function nodePathOf(node) {
    const parts = []
    for (let n = node; n; n = n.getParentNode()) parts.unshift(n.getName() || '')
    return parts.join('/')
  }
  function extrasOf(node, mesh, prim) {
    try {
      return JSON.stringify({
        node: node?.getExtras?.() || {},
        mesh: mesh ? mesh.getExtras?.() || {} : {},
        primitive: prim ? prim.getExtras?.() || {} : {},
      })
    } catch {
      return ''
    }
  }
  function haystackFor(target, { node, mesh, meshName, nodePathStr, extrasStr, materialName }) {
    if (target === 'material') return materialName || ''
    if (target === 'node') return node?.getName?.() || ''
    if (target === 'mesh') return meshName || ''
    if (target === 'nodePath') return nodePathStr || ''
    if (target === 'extras') return extrasStr || ''
    return ''
  }

  function visit(node) {
    const mesh = node.getMesh()
    const nodePathStr = nodePathOf(node)
    if (mesh) {
      const meshName = (mesh.getName() || '').trim() || (node.getName() || '').trim()
      for (const prim of mesh.listPrimitives()) {
        scannedPrims++
        const mat = prim.getMaterial()
        const materialName = mat ? mat.getName() || '' : ''
        const extrasStr = extrasOf(node, mesh, prim)
        let chosen = null
        let chosenHay = ''
        for (let i = 0; i < rules.length; i++) {
          const rule = rules[i]
          const hay = haystackFor(rule.target, {
            node, mesh, meshName, nodePathStr, extrasStr, materialName,
          })
          if (!rule.regex.test(hay)) continue
          chosen = rule
          chosenHay = hay
          if (rule.action === 'hide') ruleStats[i].hideHits++
          else ruleStats[i].keepHits++
        }
        if (chosen && chosen.action === 'hide') {
          primHits.push({ prim, mesh, node, rule: chosen, hay: chosenHay })
        }
      }
    } else {
      const extrasStr = extrasOf(node, null, null)
      let chosen = null
      let chosenHay = ''
      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i]
        if (rule.target === 'material' || rule.target === 'mesh') continue
        const hay = haystackFor(rule.target, {
          node, mesh: null, meshName: '', nodePathStr, extrasStr, materialName: '',
        })
        if (!rule.regex.test(hay)) continue
        chosen = rule
        chosenHay = hay
        if (rule.action === 'hide') ruleStats[i].hideHits++
        else ruleStats[i].keepHits++
      }
      if (chosen && chosen.action === 'hide') {
        nodeHits.push({ node, rule: chosen, hay: chosenHay })
      }
    }
    for (const child of node.listChildren()) visit(child)
  }

  for (const scene of doc.getRoot().listScenes()) {
    for (const rootChild of scene.listChildren()) visit(rootChild)
  }

  const SAMPLE_LIMIT = 8
  const samples = []
  let removedPrims = 0
  for (const hit of primHits) {
    if (samples.length < SAMPLE_LIMIT) {
      samples.push(
        `prim in "${hit.mesh.getName() || hit.node.getName() || '(unnamed)'}" via ${hit.rule.target}=/${hit.rule.pattern}/${hit.rule.flags || ''} (hay="${hit.hay}")`,
      )
    }
    try {
      hit.prim.dispose()
      removedPrims++
    } catch (e) {
            log.warn(`    ⚠ Sichtbarkeits-Regel: Primitive konnte nicht entfernt werden: ${e.message}`)
    }
  }

  let removedNodes = 0
  for (const hit of nodeHits) {
    if (samples.length < SAMPLE_LIMIT) {
      samples.push(
        `node "${hit.node.getName() || '(unnamed)'}" via ${hit.rule.target}=/${hit.rule.pattern}/${hit.rule.flags || ''} (hay="${hit.hay}")`,
      )
    }
    try {
      // gltf-transform `dispose()` löst die Node aus ihrer Hierarchie samt Kindern.
      hit.node.dispose()
      removedNodes++
    } catch (e) {
            log.warn(`    ⚠ Sichtbarkeits-Regel: Knoten konnte nicht entfernt werden: ${e.message}`)
    }
  }

  // Pflicht-Cleanup: ohne `prune` bleiben verwaiste Accessoren/Materialien/Buffer
  // im Doc und werden beim `io.write` mit-geschrieben (→ die GLB würde nicht
  // kleiner werden, im Gegenteil: durch entfernte Draco-Kompression u. U.
  // sogar deutlich größer). `dedup` entfernt zusätzlich Duplikate, die durch
  // den Cleanup sichtbar werden können.
  let prunedSize = 0
  try {
    await doc.transform(prune(), dedup())
    prunedSize = 1
  } catch (e) {
        log.warn(`    ⚠ Sichtbarkeits-Regel: prune/dedup fehlgeschlagen: ${e.message}`)
  }

  log.info(
    `    Sichtbarkeit: ${scannedPrims} Primitive(s) gescannt — ${removedPrims} Primitive(s) entfernt, ${removedNodes} Knoten entfernt${prunedSize ? ', verwaiste Ressourcen aufgeräumt (prune+dedup)' : ''}.`,
  )
  ruleStats.forEach((s, i) => {
        log.info(`      Regel #${i + 1}: hide-Treffer=${s.hideHits} · keep-Treffer=${s.keepHits}`)
  })
  if (samples.length) {
        log.info('    Sichtbarkeit: erste Treffer zur Diagnose:')
    for (const s of samples) log.info(`      • ${s}`)
  }
  return removedPrims + removedNodes
}

/**
 * Reduziert Vertex-/Triangle-Anzahl pro Primitive nach Regeln:
 *   - Match: Name-Regex (target) UND Geometrie-Filter (vertexCountMin/Max, …)
 *     müssen gleichzeitig zutreffen, soweit gesetzt.
 *   - Last-wins: bei mehreren Treffern entscheidet die letzte Regel (global → Produkt).
 *   - Pipeline: aggressives weld (overwrite=true) → simplifyPrimitive (strict) →
 *     ggf. simplifySloppy als Fallback (siehe `reducePrimitiveRobust`).
 *   - Materialien mit Base-Color-Textur können trotzdem reduziert werden – UVs werden
 *     vom Simplifier mitgeführt.
 *
 * @param {import('@gltf-transform/core').Document} doc
 * @param {Array<object>} rules — kompilierte vertexReductionRules
 * @param {object|null} simplifier — MeshoptSimplifier instance (falls nicht verfügbar: skip)
 */
function applyVertexReductionRules(doc, rules, simplifier) {
  if (!rules?.length) return 0
  if (!simplifier) {
        log.info('    ⚠ Vertex-Reduktion übersprungen: MeshoptSimplifier nicht verfügbar (meshoptimizer fehlt)')
    return 0
  }

  // Regel-Übersicht ausgeben, damit im Konvertierungs-Log nachvollziehbar ist,
  // welche Regeln tatsächlich an die Bake-Phase übergeben wurden (nicht nur die Anzahl).
    log.info(`    Vertex-Reduktion: ${rules.length} Regel(n) — Bedingungen werden auf alle Mesh-Primitiven angewandt:`)
  rules.forEach((r, idx) => log.info(`      ${summarizeReductionRule(r, idx + 1)}`))

  let n = 0
  let totalBefore = 0
  let totalAfter = 0
  let scanned = 0
  let skipped = 0
  // Pro Regel zählen, wie oft Pattern-Mismatch bzw. Geometrie-Filter blockiert haben,
  // damit der Nutzer sofort sieht, ob Pattern oder vMin/vMax die Regel ausgesperrt hat.
  const ruleStats = rules.map(() => ({ patternFails: 0, geometryFails: 0, matched: 0 }))
  const SAMPLE_LIMIT = 8
  const noMatchSamples = []

  function visitNode(node) {
    const mesh = node.getMesh()
    if (mesh) {
      const nodePathStr = getReductionNodePath(node)
      const meshName = (mesh.getName() || '').trim() || (node.getName() || '').trim()
      for (const prim of mesh.listPrimitives()) {
        scanned++
        const metrics = getReductionPrimitiveMetrics(prim)
        if (!metrics) continue
        const mat = prim.getMaterial()
        const matName = mat ? mat.getName() || '' : ''
        const extrasStr = getReductionExtrasMatchString(node, mesh, prim)

        let chosen = null
        let lastFailReason = null
        for (let i = 0; i < rules.length; i++) {
          const rule = rules[i]
          const hay = reductionHaystackForRule(rule, node, mesh, meshName, nodePathStr, extrasStr, matName)
          if (rule.regex && !rule.regex.test(hay)) {
            ruleStats[i].patternFails++
            lastFailReason = `Regel #${i + 1}: pattern /${rule.pattern}/${rule.flags || ''} (${rule.target}) verfehlt "${hay}"`
            continue
          }
          if (!matchesGeometryFilter(metrics, rule)) {
            ruleStats[i].geometryFails++
            lastFailReason = `Regel #${i + 1}: ${describeGeometryFilterFailure(metrics, rule)}`
            continue
          }
          chosen = rule
          ruleStats[i].matched++
        }
        if (!chosen) {
          skipped++
          if (noMatchSamples.length < SAMPLE_LIMIT) {
            noMatchSamples.push({
              name: meshName || matName || nodePathStr || '(unnamed)',
              vertexCount: metrics.vertexCount,
              reason: lastFailReason,
            })
          }
          continue
        }

        const ratio = effectiveRatioForRule(chosen, metrics.vertexCount)
        const before = metrics.vertexCount
        const stages = reducePrimitiveRobust(prim, chosen, ratio, simplifier)
        if (stages.error) {
          log.warn(
            `    ⚠ Reduktion fehlgeschlagen für "${meshName || matName || nodePathStr}": ${stages.error.message}`,
          )
          continue
        }
        const after = stages.afterSloppy != null ? stages.afterSloppy : stages.afterStrict
        const pct = before > 0 ? ((after / before) * 100).toFixed(1) : '0'
        totalBefore += before
        totalAfter += after
        n++
        const reducedBy = before - after
        const stageInfo =
          `weld ${stages.beforeWeld}→${stages.afterWeld}` +
          ` · strict ${stages.afterWeld}→${stages.afterStrict}` +
          (stages.sloppyUsed ? ` · sloppy ${stages.afterStrict}→${stages.afterSloppy}` : '')
        const wantedReduction = ratio < 0.99
        const achievedReduction = before > 0 && (before - after) / before > 0.01
        if (wantedReduction && !achievedReduction) {
          log.info(
            `    Reduktion (${reductionRuleLabel(chosen.target)}) "${meshName || matName || nodePathStr}" ` +
              `→ ${after}/${before} V (${pct}%, -${reducedBy}, ratio=${ratio.toFixed(3)}) [${stageInfo}] ` +
              `⚠ Auch der Sloppy-Fallback brachte keine Reduktion. ε=${(chosen.error ?? 0.001).toString()} oder Geometrie verhindert es.`,
          )
        } else {
          log.info(
            `    Reduktion (${reductionRuleLabel(chosen.target)}) "${meshName || matName || nodePathStr}" ` +
              `→ ${after}/${before} V (${pct}%, -${reducedBy}, ratio=${ratio.toFixed(3)}) [${stageInfo}]`,
          )
        }
        if (stages.sloppyError) {
          log.warn(
            `      ⚠ Sloppy-Fallback warf Fehler (ignoriert, Strict-Ergebnis behalten): ${stages.sloppyError.message}`,
          )
        }
      }
    }
    for (const child of node.listChildren()) visitNode(child)
  }

  for (const scene of doc.getRoot().listScenes()) {
    for (const rootChild of scene.listChildren()) visitNode(rootChild)
  }

  log.info(
    `    Vertex-Reduktion: scannte ${scanned} Primitive(s) — ${n} reduziert, ${skipped} ohne Treffer.`,
  )
  ruleStats.forEach((s, i) => {
    log.info(
      `      Regel #${i + 1}: ${s.matched} Treffer, ${s.patternFails} pattern-Mismatch, ${s.geometryFails} Geometrie-Filter (vMin/vMax/extent/volume) blockiert`,
    )
  })
  if (skipped > 0 && noMatchSamples.length > 0) {
        log.info(`    Vertex-Reduktion: erste ${noMatchSamples.length} nicht-getroffene Primitive(s) zur Diagnose:`)
    for (const s of noMatchSamples) {
            log.info(`      • "${s.name}" (V=${s.vertexCount}): ${s.reason || '(keine passende Regel)'}`)
    }
    if (skipped > noMatchSamples.length) {
            log.info(`      … und ${skipped - noMatchSamples.length} weitere.`)
    }
  }

  if (n) {
    const totalPct = totalBefore > 0 ? ((totalAfter / totalBefore) * 100).toFixed(1) : '0'
    log.info(
      `    Vertex-Reduktion gesamt: ${n} Primitive(s), ${totalAfter}/${totalBefore} V (${totalPct}%)`,
    )
  }
  return n
}

/**
 * Farb-Schichten (Bake) — Priorität hoch → niedrig. Es wird die HÖCHSTE Priorität zuerst
 * gefärbt und gelockt; niedrigere Schichten überspringen bereits gelockte Materialien.
 *
 * (1) Namensregeln (Produkt + global gemerged, last-wins) — gewinnen immer
 * (2) Geometrie-Regeln (wie globale Regeln)
 * (3) Hex-Mapping — nur im Automatisch-Modus (`__mapping__`); bei explizitem RAL wird
 *     `colorOverridesForBake` nicht übergeben und die Schicht ist leer
 * (4) Auto-Alias (Farbwort im Namen) — nur für noch ungefärbte Materialien
 * (5) Standardfarbe (--ral) — Basis für alle noch ungefärbten Materialien
 *     (explizit gesetzt; im Automatisch-Modus dominanter RAL als Fallback)
 */
function applyMappingAndCliRalBaseColors(doc) {
  const locked = new WeakSet()
  if (nameColorRulesCompiled && nameColorRulesCompiled.length > 0) {
    applyNameColorRules(doc, nameColorRulesCompiled, locked)
  }
  if (geometryColorRulesCompiled && geometryColorRulesCompiled.length > 0) {
    applyGeometryColorRules(doc, geometryColorRulesCompiled, locked)
  }
  if (colorOverridesForBake && Object.keys(colorOverridesForBake).length > 0) {
    applyMtlColorOverrides(doc, colorOverridesForBake, locked)
  }
  applyAutomaticColorAliasRules(doc, locked)
  applyCliRalBaseColor(doc, locked)
}

/**
 * Generischer Fallback: erkennt Farbwoerter in Material-/Mesh-/Node-Namen
 * und setzt die entsprechende RAL-Basisfarbe.
 */
function applyAutomaticColorAliasRules(doc, remappedWeakSet) {
  const palette = loadRalPalette()
  if (!palette.length) return 0
  const ralItem = (key) =>
    palette.find((e) => String(e.code || '').trim().toUpperCase() === String(key || '').trim().toUpperCase())
  let n = 0

  // 1) Materialien direkt ueber Materialname.
  for (const mat of doc.getRoot().listMaterials()) {
    if (remappedWeakSet?.has(mat)) continue
    if (mat.getBaseColorTexture()) continue
    const ralKey = ralFromColorNameAlias(mat.getName() || '')
    if (!ralKey) continue
    const item = ralItem(ralKey)
    if (!item) continue
    const factor = mat.getBaseColorFactor() || [1, 1, 1, 1]
    mat.setBaseColorFactor([item.rLin, item.gLin, item.bLin, factor[3] ?? 1])
    remappedWeakSet?.add(mat)
    n++
        log.info(`    Alias-Regel (Material) "${mat.getName() || '(unnamed)'}" -> ${ralKey}`)
  }

  // 2) Noch offene Materialien ueber Mesh-/Node-Namen.
  function visitNode(node) {
    const mesh = node.getMesh()
    if (mesh) {
      const meshName = (mesh.getName() || '').trim()
      const nodeName = (node.getName() || '').trim()
      const candidateName = [meshName, nodeName].filter(Boolean).join(' ')
      const ralKey = ralFromColorNameAlias(candidateName)
      if (ralKey) {
        const item = ralItem(ralKey)
        if (item) {
          for (const prim of mesh.listPrimitives()) {
            const mat = prim.getMaterial()
            if (!mat || remappedWeakSet?.has(mat) || mat.getBaseColorTexture()) continue
            const factor = mat.getBaseColorFactor() || [1, 1, 1, 1]
            mat.setBaseColorFactor([item.rLin, item.gLin, item.bLin, factor[3] ?? 1])
            remappedWeakSet?.add(mat)
            n++
                        log.info(`    Alias-Regel (Mesh/Node) "${meshName || nodeName}" -> ${ralKey}`)
          }
        }
      }
    }
    for (const child of node.listChildren()) visitNode(child)
  }

  for (const scene of doc.getRoot().listScenes()) {
    for (const rootChild of scene.listChildren()) {
      visitNode(rootChild)
    }
  }

  if (n) log.info(`    Alias-Regeln (auto): ${n} Material-Zuweisung(en)`)
  return n
}

/**
 * Pro Primitive: Metriken aus POSITION; Regel-Array global → Produkt — **letzte** passende Regel setzt RAL.
 */
function applyGeometryColorRules(doc, rules, remappedWeakSet) {
  const palette = loadRalPalette()
  if (!palette.length) return 0
  const ralItem = (key) =>
    palette.find((e) => String(e.code || '').trim().toUpperCase() === String(key).trim().toUpperCase())
  let n = 0

  function visitNode(node) {
    const mesh = node.getMesh()
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const mat = prim.getMaterial()
        if (!mat || mat.getBaseColorTexture()) continue
        if (remappedWeakSet?.has(mat)) continue
        const metrics = getPrimitiveGeometryMetrics(prim)
        let chosen = null
        for (const rule of rules) {
          if (!matchesGeometryColorRule(metrics, rule)) continue
          chosen = rule
        }
        if (chosen) {
          const item = ralItem(chosen.ralKey)
          if (!item) {
                        log.warn(`    ⚠ Geometrie-Regel: ${chosen.ralKey} nicht in ralColors.json`)
          } else {
            const factor = mat.getBaseColorFactor() || [1, 1, 1, 1]
            mat.setBaseColorFactor([item.rLin, item.gLin, item.bLin, factor[3] ?? 1])
            remappedWeakSet?.add(mat)
            n++
            const m = metrics
            log.info(
              `    Geometrie-Regel → ${chosen.ralKey} (V=${m.vertexCount}, Kanten sort.≈${m.sorted.map((x) => x.toFixed(4)).join('/')})`,
            )
          }
        }
      }
    }
    for (const child of node.listChildren()) visitNode(child)
  }

  for (const scene of doc.getRoot().listScenes()) {
    for (const rootChild of scene.listChildren()) {
      visitNode(rootChild)
    }
  }

  if (n) log.info(`    Geometrie-Regeln: ${n} Material-Zuweisung(en)`)
  return n
}

/** Szene von Wurzel bis Blatt: `Eltern/…/Knoten` (leere Namen bleiben als leere Segmente erhalten). */
function getNodePathString(node) {
  const parts = []
  for (let n = node; n; n = n.getParentNode()) {
    parts.unshift(n.getName() || '')
  }
  return parts.join('/')
}

/** Ein String für Regex auf CAD-/Tool-Metadaten in `extras` (Node, Mesh, Primitive). */
function buildExtrasMatchString(node, mesh, prim) {
  const payload = {
    node: node.getExtras() || {},
    mesh: mesh ? mesh.getExtras() || {} : {},
    primitive: prim.getExtras() || {},
  }
  try {
    return JSON.stringify(payload)
  } catch {
    return ''
  }
}

function sceneRuleLabel(t) {
  if (t === 'node') return 'Knoten'
  if (t === 'mesh') return 'Mesh'
  if (t === 'nodePath') return 'Pfad'
  if (t === 'extras') return 'Extras'
  return t
}

/**
 * Material: Regex auf mat.getName(). Szenen-Regeln: node, mesh, nodePath, extras.
 * Regel-Array: global → Produkt; bei mehreren Treffern gewinnt die **letzte** passende Regel.
 */
function applyNameColorRules(doc, rules, remappedWeakSet) {
  const palette = loadRalPalette()
  if (!palette.length) return 0
  const materialRules = rules.filter((r) => r.target === 'material')
  const sceneRules = sceneNameColorRulesInOrder(rules)
  let n = 0

  // Diagnose: pro Regel Trefferzahl + Sample der gescannten Namen, damit man im Log
  // sofort sieht, warum eine Regel nicht greift (typischer Fehler bei CAD/STEP:
  // Material-/Mesh-Namen heißen anders als in der ursprünglichen MTL/Stammdaten).
  const ruleStats = new Map(rules.map((r) => [r, { matched: 0, scanned: 0 }]))
  const sampledMaterialNames = []
  const sampledSceneHays = []
  const SAMPLE_LIMIT = 12

    log.info(`    Namens-Regeln: ${rules.length} Regel(n) — ${materialRules.length} Material-, ${sceneRules.length} Szenen-Regel(n):`)
  rules.forEach((r, idx) => {
    log.info(
      `      [#${idx + 1}] target=${r.target} · pattern=/${r.regex.source}/${r.regex.flags || ''} → ${r.ralKey}${r.finish ? ` (finish=${r.finish})` : ' (finish=auto)'}`,
    )
  })

  const ralItem = (key) =>
    palette.find((e) => String(e.code || '').trim().toUpperCase() === String(key).trim().toUpperCase())

  /**
   * Oberfläche der getroffenen Regel einbrennen + Material im Lock-Set markieren.
   *
   * Auch wenn der Nutzer „Automatisch" gewählt hat (`finish == null/auto`),
   * wird das Material gelocked und das Finish aus dem RAL-Code abgeleitet
   * (RAL 9007 → Verzinkt, alle anderen → Pulver/matt). Sonst würde
   * `applyMaterialFinish` später bei einem Produkt mit Standardfarbe „Verzinkt"
   * jedes Material auf metallic=0.75 setzen — und ein per Namensregel orange
   * gefärbtes Teil würde wie poliertes Metall aussehen.
   */
  const applyRuleFinish = (mat, finish, ralKey, label) => {
    const norm = String(finish || '').trim().toLowerCase()
    let verzinkt
    if (norm === 'verzinkt') verzinkt = true
    else if (norm === 'pulver') verzinkt = false
    else verzinkt = String(ralKey || '').trim().toUpperCase().replace(/\s+/g, '') === 'RAL9007'
    const metallic = verzinkt ? 0.75 : 0
    const roughness = verzinkt ? 0.25 : 0.35
    mat.setMetallicFactor(metallic)
    mat.setRoughnessFactor(roughness)
    finishLockedMaterials.add(mat)
    const mode = norm === 'verzinkt' || norm === 'pulver' ? norm : 'auto'
        log.info(`    ${label} Oberfläche: ${verzinkt ? 'Verzinkt' : 'Pulver'} (${metallic}/${roughness}, ${mode})`)
  }

  for (const mat of doc.getRoot().listMaterials()) {
    if (remappedWeakSet?.has(mat)) continue
    const matName = mat.getName() || ''
    if (sampledMaterialNames.length < SAMPLE_LIMIT) sampledMaterialNames.push(matName || '(unnamed)')
    let chosen = null
    for (const rule of materialRules) {
      const stat = ruleStats.get(rule); if (stat) stat.scanned++
      if (!rule.regex.test(matName)) continue
      chosen = rule
      if (stat) stat.matched++
    }
    if (chosen) {
      const item = ralItem(chosen.ralKey)
      if (!item) {
                log.warn(`    ⚠ Name-Regel Material "${matName}": ${chosen.ralKey} nicht in ralColors.json`)
      } else {
        const stripped = []
        if (mat.getBaseColorTexture()) { mat.setBaseColorTexture(null); stripped.push('BaseColor') }
        if (mat.getMetallicRoughnessTexture()) { mat.setMetallicRoughnessTexture(null); stripped.push('MetallicRoughness') }
        if (stripped.length) {
                    log.info(`    Name-Regel (Material) "${matName}" → Texturen entfernt: ${stripped.join(', ')}`)
        }
        const factor = mat.getBaseColorFactor() || [1, 1, 1, 1]
        mat.setBaseColorFactor([item.rLin, item.gLin, item.bLin, factor[3] ?? 1])
        remappedWeakSet?.add(mat)
        n++
                log.info(`    Name-Regel (Material) "${matName}" → ${chosen.ralKey}`)
        applyRuleFinish(mat, chosen.finish, chosen.ralKey, `Name-Regel (Material) "${matName}" →`)
      }
    }
  }

  function haystackForSceneRule(rule, node, mesh, meshName, nodePathStr, extrasStr) {
    if (rule.target === 'node') return node.getName() || ''
    if (rule.target === 'mesh') return meshName
    if (rule.target === 'nodePath') return nodePathStr
    if (rule.target === 'extras') return extrasStr
    return ''
  }

  function visitNode(node) {
    const mesh = node.getMesh()
    const nodePathStr = getNodePathString(node)
    /** Viele Exporter setzen den Anzeigenamen nur auf dem Knoten; Three.js zeigt oft Knoten+Mesh vereinheitlicht. */
    const meshName = mesh ? (mesh.getName() || '').trim() || (node.getName() || '').trim() : ''
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const mat = prim.getMaterial()
        if (!mat) continue
        if (remappedWeakSet?.has(mat)) continue
        const extrasStr = buildExtrasMatchString(node, mesh, prim)
        let sceneChosen = null
        let sceneHay = ''
        for (const rule of sceneRules) {
          const hay = haystackForSceneRule(rule, node, mesh, meshName, nodePathStr, extrasStr)
          const stat = ruleStats.get(rule); if (stat) stat.scanned++
          if (sampledSceneHays.length < SAMPLE_LIMIT) {
            sampledSceneHays.push(`${rule.target}="${(hay || '').slice(0, 80)}"`)
          }
          if (!rule.regex.test(hay)) continue
          sceneChosen = rule
          sceneHay = hay
          if (stat) stat.matched++
        }
        if (sceneChosen) {
          const item = ralItem(sceneChosen.ralKey)
          if (!item) {
                        log.warn(`    ⚠ Name-Regel ${sceneRuleLabel(sceneChosen.target)}: ${sceneChosen.ralKey} nicht in ralColors.json`)
          } else {
            const stripped = []
            if (mat.getBaseColorTexture()) { mat.setBaseColorTexture(null); stripped.push('BaseColor') }
            if (mat.getMetallicRoughnessTexture()) { mat.setMetallicRoughnessTexture(null); stripped.push('MetallicRoughness') }
            if (stripped.length) {
                            log.info(`    Name-Regel (${sceneRuleLabel(sceneChosen.target)}) "${meshName}" → Texturen entfernt: ${stripped.join(', ')}`)
            }
            const factor = mat.getBaseColorFactor() || [1, 1, 1, 1]
            mat.setBaseColorFactor([item.rLin, item.gLin, item.bLin, factor[3] ?? 1])
            remappedWeakSet?.add(mat)
            n++
            const preview =
              sceneChosen.target === 'extras' ? sceneHay.slice(0, 120) + (sceneHay.length > 120 ? '…' : '') : sceneHay
                        log.info(`    Name-Regel (${sceneRuleLabel(sceneChosen.target)}) "${preview}" → ${sceneChosen.ralKey}`)
            applyRuleFinish(mat, sceneChosen.finish, sceneChosen.ralKey, `Name-Regel (${sceneRuleLabel(sceneChosen.target)}) "${preview}" →`)
          }
        }
      }
    }
    for (const child of node.listChildren()) {
      visitNode(child)
    }
  }

  for (const scene of doc.getRoot().listScenes()) {
    for (const rootChild of scene.listChildren()) {
      visitNode(rootChild)
    }
  }

  // Pro-Regel-Statistik immer ausgeben (auch bei 0 Treffern), damit klar wird,
  // ob eine Regel überhaupt evaluiert wurde.
  rules.forEach((r, idx) => {
    const s = ruleStats.get(r)
        log.info(`      Regel #${idx + 1} (${r.target}, /${r.regex.source}/${r.regex.flags}, → ${r.ralKey}): ${s?.matched ?? 0} Treffer, ${s?.scanned ?? 0} Kandidaten geprüft`)
  })
  if (n === 0) {
    if (sampledMaterialNames.length) {
            log.info(`      ⚠ Keine Material-Regel hat gegriffen. Material-Namen in der GLB (Sample bis ${SAMPLE_LIMIT}):`)
      for (const name of sampledMaterialNames) log.info(`         • "${name}"`)
    }
    if (sampledSceneHays.length && sceneRules.length) {
            log.info(`      ⚠ Keine Szenen-Regel hat gegriffen. Erste Match-Strings (Sample bis ${SAMPLE_LIMIT}):`)
      for (const hay of sampledSceneHays) log.info(`         • ${hay}`)
    }
  }
  if (n) log.info(`    Name-Regeln (Material/Mesh/Pfad/Extras): ${n} Material-Zuweisung(en)`)
  return n
}

/** Kategorie der Oberfläche für Ordneraufteilung und Log. */
function getSurfaceCategory(materials) {
  if (!materials?.length) return 'unbekannt'
  const hasVerzinkt = materials.some((m) => m.finish === 'verzinkt')
  const hasMatt = materials.some((m) => m.finish === 'matt')
  const hasTextur = materials.some((m) => m.finish === 'textur')
  const count = (hasVerzinkt ? 1 : 0) + (hasMatt ? 1 : 0) + (hasTextur ? 1 : 0)
  if (count > 1) return 'gemischt'
  if (hasVerzinkt) return 'verzinkt'
  if (hasTextur) return 'textur'
  if (hasMatt) return 'matt'
  return 'unbekannt'
}

// ─── Export-Registry (export-log.json als Konfiguration) ─────────────────────
const REGISTRY_VERSION = 2

/**
 * Lädt die Export-Registry. Altes Array-Format wird migriert (letzter Eintrag pro Datei).
 * @param {string} logPathJson - Pfad zu export-log.json
 * @returns {{ _meta: object, [filename: string]: object }}
 */
function loadRegistry(logPathJson) {
  const registry = { _meta: { version: REGISTRY_VERSION, updatedAt: new Date().toISOString() } }
  if (!fs.existsSync(logPathJson)) return registry
  try {
    const raw = fs.readFileSync(logPathJson, 'utf-8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      for (const e of parsed) {
        const key = e.file != null ? path.basename(e.file) : null
        if (!key) continue
        registry[key] = {
          ralCode: e.materials?.[0]?.ral?.replace(/^RAL\s*/i, '') ?? null,
          surfaceCategory: e.surfaceCategory ?? 'unbekannt',
          materials: e.materials ?? [],
          orientation: e.orientation ?? e.orientationDetail ?? 'y-up',
          sizeBefore: e.sizeBefore ?? null,
          sizeAfter: e.sizeAfter ?? null,
          outputPath: e.outputPath ?? null,
          lastExport: e.runAt ?? e.timestamp ?? null,
        }
      }
      return registry
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed)) {
        if (k === '_meta') registry._meta = { ...registry._meta, ...v }
        else if (v && typeof v === 'object') registry[k] = { ...v }
      }
      return registry
    }
  } catch (_) {}
  return registry
}

/**
 * Wendet Material-Finish aus einem Registry-Eintrag an (metallic/roughness pro Materialname).
 * Fehlende Materialien werden mit forcedRalCode (aus entry.ralCode) behandelt.
 * @returns {{ materials: Array, surfaceCategory: string }}
 */
function applyMaterialFinishFromRegistry(doc, registryEntry, surfaceMode = null) {
  const result = { materials: [], surfaceCategory: registryEntry?.surfaceCategory ?? 'unbekannt' }
  const palette = loadRalPalette()
  const forcedRal = registryEntry?.ralCode ? `RAL ${String(registryEntry.ralCode).replace(/^RAL\s*/i, '').trim()}` : null
  const matMap = new Map((registryEntry?.materials ?? []).map((m) => [m.name, m]))

  for (const mat of doc.getRoot().listMaterials()) {
    const name = mat.getName() || '(unnamed)'
    const reg = matMap.get(name)
    if (finishLockedMaterials.has(mat)) {
      const metallic = mat.getMetallicFactor() ?? 0
      const roughness = mat.getRoughnessFactor() ?? 0
      result.materials.push({
        name,
        ral: reg?.ral ?? null,
        metallic,
        roughness,
        finish: metallic > 0.5 ? 'verzinkt' : 'matt',
      })
            log.info(`    Material "${name}" → Oberfläche durch Namens-Regel gesperrt (${metallic}/${roughness})`)
      continue
    }
    const hasAnyTexture =
      !!mat.getBaseColorTexture() ||
      !!mat.getMetallicRoughnessTexture() ||
      !!mat.getNormalTexture() ||
      !!mat.getOcclusionTexture() ||
      !!mat.getEmissiveTexture()
    if (hasAnyTexture) {
      mat.setMetallicFactor(0)
      mat.setRoughnessFactor(Math.max(0.85, mat.getRoughnessFactor() ?? 0))
      result.materials.push({ name, ral: null, metallic: 0, roughness: 0.85, finish: 'textur' })
            log.info(`    Material "${name}" → Textur (0/0.85)`)
      continue
    }
    if (reg && typeof reg.metallic === 'number' && typeof reg.roughness === 'number') {
      // Eine explizit gewählte Produkt-Oberfläche (--surface) hat Vorrang vor der
      // (evtl. veralteten) Registry: Ein als „Pulver" konfiguriertes Produkt darf
      // nicht metallisch werden, nur weil das Teil einmal als „Verzinkt" registriert
      // wurde. Namensregel-gesperrte Teile (echte Verzinkt-Beschläge) sind oben schon
      // abgehandelt und bleiben unberührt.
      let metallic = reg.metallic
      let roughness = reg.roughness
      let finish = reg.finish ?? (reg.metallic > 0.5 ? 'verzinkt' : 'matt')
      let source = `Registry: ${reg.metallic}/${reg.roughness}`
      if (surfaceMode === 'pulver') {
        metallic = 0; roughness = 0.35; finish = 'matt'
        source = 'Override --surface pulver: 0/0.35'
      } else if (surfaceMode === 'verzinkt') {
        metallic = 0.75; roughness = 0.25; finish = 'verzinkt'
        source = 'Override --surface verzinkt: 0.75/0.25'
      }
      mat.setMetallicFactor(metallic)
      mat.setRoughnessFactor(roughness)
      result.materials.push({ name, ral: reg.ral ?? null, metallic, roughness, finish })
            log.info(`    Material "${name}" → ${reg.ral ?? '–'} (${source})`)
      continue
    }
    const factor = mat.getBaseColorFactor()
    if (!factor || factor.length < 3) continue
    const [rLin, gLin, bLin] = factor
    const exactRal = exactMatchRALLinear(palette, rLin, gLin, bLin) || exactMatchRAL(palette, rLin, gLin, bLin)
    // Finish-Entscheidung pro Material:
    //   1. Material-Basisfarbe ist exakt RAL 9007  → Verzinkt
    //   2. Material-Basisfarbe ist eine ANDERE RAL → matt/Pulver (auch wenn das
    //      Produkt als Standard „Verzinkt" hat — Namens-/Geometrie-/Mapping-Regeln
    //      sollen den Verzinkt-Fallback nicht reaktivieren).
    //   3. Keine RAL erkennbar (Freifarbe) → forcedRalCode entscheidet als Fallback.
    let verzinkt
    if (surfaceMode === 'verzinkt') verzinkt = true
    else if (surfaceMode === 'pulver') verzinkt = false
    else if (exactRal === RAL_VERZINKT) verzinkt = true
    else if (exactRal) verzinkt = false
    else verzinkt = forcedRal === 'RAL 9007'
    const metallic = verzinkt ? 0.75 : 0
    const roughness = verzinkt ? 0.25 : 0.35
    mat.setMetallicFactor(metallic)
    mat.setRoughnessFactor(roughness)
    result.materials.push({
      name,
      ral: exactRal || null,
      metallic,
      roughness,
      finish: verzinkt ? 'verzinkt' : 'matt',
    })
        log.info(`    Material "${name}" → ${exactRal || '–'} (finish: ${verzinkt ? 'Verzinkt 0.75/0.25' : 'matt 0/0.35'})`)
  }
  result.surfaceCategory = getSurfaceCategory(result.materials)
  return result
}

/**
 * Setzt Metallic/Roughness pro Material anhand der RAL-Palette.
 * Verzinkt (metallisch) nur bei exaktem RAL-9007-Treffer der baseColor oder forcedRalCode.
 * RAL 9007 (Verzinkt) → 0.75 / 0.25; alle anderen → 0 / 0.35.
 * @returns {{ materials: Array<{ name: string, ral: string|null, metallic: number, roughness: number, finish: 'verzinkt'|'matt'|'textur' }>, surfaceCategory: string }}
 */
function applyMaterialFinish(doc, { forcedRalCode = null, surfaceMode = null } = {}) {
  const result = { materials: [], surfaceCategory: 'unbekannt' }
  const palette = loadRalPalette()
  if (!palette.length) {
        log.info('    ⚠ ralColors.json nicht geladen – Material-Finish übersprungen')
    return result
  }
  const forcedRal = forcedRalCode ? `RAL ${String(forcedRalCode).replace(/^RAL\s*/i, '').trim()}` : null
  for (const mat of doc.getRoot().listMaterials()) {
    if (finishLockedMaterials.has(mat)) {
      const metallic = mat.getMetallicFactor() ?? 0
      const roughness = mat.getRoughnessFactor() ?? 0
      result.materials.push({
        name: mat.getName() || '(unnamed)',
        ral: null,
        metallic,
        roughness,
        finish: metallic > 0.5 ? 'verzinkt' : 'matt',
      })
            log.info(`    Material "${mat.getName()}" → Oberfläche durch Namens-Regel gesperrt (${metallic}/${roughness})`)
      continue
    }
    const hasAnyTexture =
      !!mat.getBaseColorTexture() ||
      !!mat.getMetallicRoughnessTexture() ||
      !!mat.getNormalTexture() ||
      !!mat.getOcclusionTexture() ||
      !!mat.getEmissiveTexture()
    if (hasAnyTexture) {
      mat.setMetallicFactor(0)
      mat.setRoughnessFactor(Math.max(0.85, mat.getRoughnessFactor() ?? 0))
      result.materials.push({ name: mat.getName() || '(unnamed)', ral: null, metallic: 0, roughness: 0.85, finish: 'textur' })
            log.info(`    Material "${mat.getName()}" → Textur erkannt (skip RAL-Finish, setze 0/0.85)`)
      continue
    }

    const factor = mat.getBaseColorFactor()
    if (!factor || factor.length < 3) continue
    const [rLin, gLin, bLin] = factor
    const exactRal = exactMatchRALLinear(palette, rLin, gLin, bLin) || exactMatchRAL(palette, rLin, gLin, bLin)
    // Finish-Entscheidung pro Material aus tatsächlicher Basisfarbe:
    //   1. Material-Basisfarbe ist exakt RAL 9007   → Verzinkt
    //   2. Material-Basisfarbe ist eine ANDERE RAL  → matt/Pulver, auch wenn das
    //      Produkt als Standard „Verzinkt" gesetzt ist. So bleibt eine per
    //      Namens-/Geometrie-/Mapping-Regel gefärbte Stelle z. B. orange-matt
    //      und wird nicht durch den Verzinkt-Default des Produkts überschrieben.
    //   3. Keine RAL erkennbar (Freifarbe)          → forcedRalCode als Fallback.
    let verzinkt
    if (surfaceMode === 'verzinkt') verzinkt = true
    else if (surfaceMode === 'pulver') verzinkt = false
    else if (exactRal === RAL_VERZINKT) verzinkt = true
    else if (exactRal) verzinkt = false
    else verzinkt = forcedRal === 'RAL 9007'
    const metallic = verzinkt ? 0.75 : 0
    const roughness = verzinkt ? 0.25 : 0.35
    mat.setMetallicFactor(metallic)
    mat.setRoughnessFactor(roughness)
    result.materials.push({
      name: mat.getName() || '(unnamed)',
      ral: exactRal || null,
      metallic,
      roughness,
      finish: verzinkt ? 'verzinkt' : 'matt',
    })
        log.info(`    Material "${mat.getName()}" → ${exactRal || '–'} (finish: ${verzinkt ? 'Verzinkt 0.75/0.25' : 'matt 0/0.35'})`)
  }
  result.surfaceCategory = getSurfaceCategory(result.materials)
  return result
}

/** Entfernt Meshopt und aktiviert Draco-Kompression. */
async function stripMeshoptApplyDraco(doc) {
  for (const ext of doc.getRoot().listExtensionsUsed()) {
    if (ext.extensionName === 'EXT_meshopt_compression') {
      ext.dispose()
    }
  }
  // Draco-Kompression auf alle Meshes, egal ob Meshopt vorlag oder nicht
  try {
    const { draco } = await import('@gltf-transform/functions')
    await doc.transform(draco({ method: 'edgebreaker' }))
  } catch (e) {
    // Draco nicht verfügbar → ohne Kompression
  }
}

// ─── Verifikation ───────────────────────────────────────────────────
function verifyNoRootRotation(doc) {
  for (const scene of doc.getRoot().listScenes()) {
    for (const node of scene.listChildren()) {
      if (!isIdentityQuat(node.getRotation())) return false
    }
  }
  return true
}

// ─── Dateien finden ─────────────────────────────────────────────────
function findGlbs(dir) {
  const results = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) results.push(...findGlbs(full))
    else if (entry.name.toLowerCase().endsWith('.glb')) results.push(full)
  }
  return results.sort()
}

// ─── Hauptprogramm ──────────────────────────────────────────────────
async function main() {
    log.info('\n╔══════════════════════════════════════════╗')
    log.info('║   GLB Y-up Bake Tool                     ║')
    log.info('╚══════════════════════════════════════════╝')
    log.info(`  Input:   ${inputDir}`)
  if (dryRun) log.info('  Modus:   DRY-RUN (keine Änderungen, nur Analyse)')
  else if (outDir) log.info(`  Output:  ${outDir}`)
  else log.info('  Modus:   IN-PLACE (mit .bak-Backup)')
  if (colorOverridesForBake && Object.keys(colorOverridesForBake).length > 0) {
        log.info(`  color-overrides: ${Object.keys(colorOverridesForBake).length} Hex-Regel(n)`)
  }
  if (geometryColorRulesCompiled && geometryColorRulesCompiled.length > 0) {
        log.info(`  geometry-rules: ${geometryColorRulesCompiled.length} Regel(n)`)
  }
  if (nameColorRulesCompiled && nameColorRulesCompiled.length > 0) {
        log.info(`  name-rules: ${nameColorRulesCompiled.length} Regel(n)`)
  }
  if (vertexReductionRulesCompiled && vertexReductionRulesCompiled.length > 0) {
        log.info(`  vertex-reduction-rules: ${vertexReductionRulesCompiled.length} Regel(n)`)
  }
  if (visibilityRulesCompiled && visibilityRulesCompiled.length > 0) {
        log.info(`  visibility-rules: ${visibilityRulesCompiled.length} Regel(n)`)
  }
  if (mtlForTexturesAbs) {
        log.info(`  mtl-for-textures: ${mtlForTexturesAbs}`)
    const rep = (mtlBaseTextureRepeatRaw || '').trim()
        log.info(`  mtl-base-texture-repeat: ${rep || '1 (keine Kachelung, Textur 1× über UV)'}`)
    if (mtlTextureExtraDirs.length) {
            log.info(`  mtl-texture-extra-dirs: ${mtlTextureExtraDirs.join(', ')}`)
    }
  }
    log.info()

  const files = singleFile ? [path.resolve(singleFile)] : findGlbs(inputDir)
  if (!files.length) { log.info(singleFile ? `Datei nicht gefunden: ${singleFile}` : 'Keine .glb-Dateien gefunden.'); return }
  if (singleFile && !fs.existsSync(files[0])) { log.info(`Datei nicht gefunden: ${files[0]}`); return }
    log.info(`${files.length} GLB-Datei(en) gefunden.\n`)

  // IO vorbereiten (alle Extensions inkl. Meshopt + Draco)
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  try {
    const draco = await import('draco3dgltf')
    io.registerDependencies({
      'draco3d.decoder': await draco.default.createDecoderModule(),
      'draco3d.encoder': await draco.default.createEncoderModule(),
    })
        log.info('  Draco-Support: aktiv')
  } catch {
        log.info('  Draco-Support: nicht verfügbar (draco3dgltf nicht installiert)')
  }
  let meshoptSimplifier = null
  try {
    const { MeshoptDecoder, MeshoptSimplifier } = await import('meshoptimizer')
    await MeshoptDecoder.ready
    io.registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
        log.info('  Meshopt-Decoder: aktiv (wird beim Schreiben entfernt)')
    if (MeshoptSimplifier) {
      try {
        await MeshoptSimplifier.ready
        meshoptSimplifier = MeshoptSimplifier
                log.info('  Meshopt-Simplifier: aktiv (für Vertex-Reduktion)')
      } catch (e) {
                log.info('  Meshopt-Simplifier: Init fehlgeschlagen –', e.message)
      }
    }
  } catch {
        log.info('  Meshopt-Decoder: nicht verfügbar (meshoptimizer nicht installiert)')
  }
    log.info()

  if (!dryRun && outDir && !fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true })
  }

  const logDir = outDir || (singleFile ? path.dirname(files[0]) : inputDir)
  const registryPath = registryPathArg ? path.resolve(ROOT, registryPathArg) : path.join(logDir, 'export-log.json')
  const useRegistry = !noRegistry
  let registry = useRegistry ? loadRegistry(registryPath) : { _meta: { version: REGISTRY_VERSION, updatedAt: new Date().toISOString() } }
  if (useRegistry) log.info(`  Export-Registry: ${registryPath}`)

  function fmtSize(bytes) {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
  }

  const SIZE_WARN_PCT = 15
  let modified = 0, skipped = 0, errors = 0, sizeWarnings = 0
  let totalBefore = 0, totalAfter = 0

  /** Eintrag für die Export-Registry (ein Eintrag pro Datei, Key = Dateiname). */
  function makeRegistryEntry(relPath, orientation, orientationDetail, materialInfo, sizeBefore, sizeAfter, outputPath) {
    const ralCode = materialInfo?.materials?.[0]?.ral?.replace(/^RAL\s*/i, '') ?? null
    return {
      ralCode: ralCode || (materialInfo?.materials?.find((m) => m.ral)?.ral?.replace(/^RAL\s*/i, '') ?? null),
      surfaceCategory: materialInfo?.surfaceCategory ?? 'unbekannt',
      materials: materialInfo?.materials ?? [],
      orientation: orientation ?? orientationDetail ?? 'y-up',
      sizeBefore: sizeBefore ?? null,
      sizeAfter: sizeAfter ?? null,
      outputPath: outputPath || null,
      lastExport: new Date().toISOString(),
    }
  }

  for (const file of files) {
    const relPath = singleFile ? path.basename(file) : path.relative(inputDir, file)
    const basename = path.basename(file)
    const originalSize = fs.statSync(file).size
    const registryEntry = useRegistry ? registry[basename] : null
    try {
      const doc = await io.read(file)
      await stripMeshoptApplyDraco(doc)
      const mtlTexCount = await applyMtlDeclaredBaseTexturesFromMtl(doc)
      if (mtlTexCount > 0) log.info(`  MTL-Pflichttexturen: ${mtlTexCount} Material-Update(s)`)
      // Verzinkt/Finish nur aus CLI oder Registry, nicht aus Dateiname (_VZK/_RAL_)
      const forcedRalCode =
        cliRalCode ||
        (registryEntry?.ralCode ?? null)

      let hasCorrection = false
      let rotInfo = ''
      let orientationDetail = 'y-up'
      for (const scene of doc.getRoot().listScenes()) {
        for (const node of scene.listChildren()) {
          const q = node.getRotation()
          if (!isIdentityQuat(q)) {
            hasCorrection = true
            const label = isZupCorrection(q) ? 'Z-up→Y-up' : 'andere'
            rotInfo = `[${q.map((v) => v.toFixed(4)).join(', ')}] (${label})`
            orientationDetail = label
          }
        }
      }
      const orientation = hasCorrection ? rotInfo || 'Root-Rotation' : 'y-up (keine Korrektur nötig)'

      if (!hasCorrection && !singleFile) {
                log.info(`  ✓ ${relPath} – bereits Y-up (${fmtSize(originalSize)})`)
        skipped++
        let materialInfo = { materials: [], surfaceCategory: 'unbekannt' }
        if (!dryRun && outDir) {
          // WICHTIG: Farb-/Namensregeln ZUERST ausführen – sonst führt das `dedup()`
          // in applyVisibilityRules noch identische Materialien zusammen, bevor die
          // Regeln pro Teil differenzieren können (Farb-Kollaps). Sichtbarkeit und
          // Reduktion sind optional und isoliert und laufen danach.
          applyMappingAndCliRalBaseColors(doc)
          if (visibilityRulesCompiled?.length) {
            try {
              await applyVisibilityRules(doc, visibilityRulesCompiled)
            } catch (e) {
                            log.warn(`    ⚠ Sichtbarkeits-Regeln übersprungen: ${e.message}`)
            }
          }
          if (vertexReductionRulesCompiled?.length) {
            try {
              applyVertexReductionRules(doc, vertexReductionRulesCompiled, meshoptSimplifier)
            } catch (e) {
                            log.warn(`    ⚠ Vertex-Reduktion übersprungen: ${e.message}`)
            }
          }
          materialInfo =
            useRegistry && registryEntry?.materials?.length
              ? applyMaterialFinishFromRegistry(doc, { ...registryEntry, ralCode: forcedRalCode || registryEntry.ralCode }, cliSurfaceMode)
              : applyMaterialFinish(doc, { forcedRalCode, surfaceMode: cliSurfaceMode })
          const surfaceDir = path.join(outDir, materialInfo.surfaceCategory)
          const out = path.join(surfaceDir, relPath)
          fs.mkdirSync(path.dirname(out), { recursive: true })
          await io.write(out, doc)
          const newSize = fs.statSync(out).size
          registry[basename] = makeRegistryEntry(relPath, orientation, orientationDetail, materialInfo, originalSize, newSize, out)
                    log.info(`    → Gespeichert: ${out} (Oberfläche: ${materialInfo.surfaceCategory})`)
        }
        continue
      }

            log.info(`  ★ ${relPath}`)
            log.info(`    Root-Rotation: ${rotInfo}`)
            log.info(`    Original: ${fmtSize(originalSize)}`)

      if (dryRun) {
                log.info('    → Würde eingebrannt werden (Dry-Run)')
        modified++
        continue
      }

      const baked = bakeRootRotation(doc)
      if (!baked && !singleFile) {
                log.info('    ✗ Baking fehlgeschlagen')
        errors++
        continue
      }
      if (!baked && singleFile) {
        // WICHTIG: Farb-/Namensregeln ZUERST ausführen – sonst führt das `dedup()`
        // in applyVisibilityRules noch identische Materialien zusammen, bevor die
        // Regeln pro Teil differenzieren können (Farb-Kollaps). Sichtbarkeit und
        // Reduktion sind optional und isoliert und laufen danach.
        applyMappingAndCliRalBaseColors(doc)
        if (visibilityRulesCompiled?.length) {
          try {
            await applyVisibilityRules(doc, visibilityRulesCompiled)
          } catch (e) {
                        log.warn(`    ⚠ Sichtbarkeits-Regeln übersprungen: ${e.message}`)
          }
        }
        if (vertexReductionRulesCompiled?.length) {
          try {
            applyVertexReductionRules(doc, vertexReductionRulesCompiled, meshoptSimplifier)
          } catch (e) {
                        log.warn(`    ⚠ Vertex-Reduktion übersprungen: ${e.message}`)
          }
        }
        const materialInfo =
          useRegistry && registryEntry?.materials?.length
            ? applyMaterialFinishFromRegistry(doc, { ...registryEntry, ralCode: forcedRalCode || registryEntry.ralCode }, cliSurfaceMode)
            : applyMaterialFinish(doc, { forcedRalCode, surfaceMode: cliSurfaceMode })
        await io.write(file, doc)
        const newSize = fs.statSync(file).size
        registry[basename] = makeRegistryEntry(relPath, orientation, orientationDetail, materialInfo, originalSize, newSize, file)
        continue
      }

      if (!verifyNoRootRotation(doc) && !singleFile) {
                log.info('    ✗ Verifikation fehlgeschlagen: Root hat noch Rotation')
        errors++
        continue
      }

      // WICHTIG: Farb-/Namensregeln ZUERST ausführen – sonst führt das `dedup()`
      // in applyVisibilityRules noch identische Materialien zusammen, bevor die
      // Regeln pro Teil differenzieren können (Farb-Kollaps). Sichtbarkeit und
      // Reduktion sind optional und isoliert und laufen danach.
      applyMappingAndCliRalBaseColors(doc)
      if (visibilityRulesCompiled?.length) {
        try {
          await applyVisibilityRules(doc, visibilityRulesCompiled)
        } catch (e) {
                    log.warn(`    ⚠ Sichtbarkeits-Regeln übersprungen: ${e.message}`)
        }
      }
      if (vertexReductionRulesCompiled?.length) {
        try {
          applyVertexReductionRules(doc, vertexReductionRulesCompiled, meshoptSimplifier)
        } catch (e) {
                    log.warn(`    ⚠ Vertex-Reduktion übersprungen: ${e.message}`)
        }
      }
      const materialInfo =
        useRegistry && registryEntry?.materials?.length
          ? applyMaterialFinishFromRegistry(doc, { ...registryEntry, ralCode: forcedRalCode || registryEntry.ralCode }, cliSurfaceMode)
          : applyMaterialFinish(doc, { forcedRalCode, surfaceMode: cliSurfaceMode })
      let outPath
      if (outDir) {
        const surfaceDir = path.join(outDir, materialInfo.surfaceCategory)
        outPath = path.join(surfaceDir, relPath)
        fs.mkdirSync(path.dirname(outPath), { recursive: true })
        await io.write(outPath, doc)
      } else {
        outPath = file
        if (!singleFile) fs.copyFileSync(file, file + '.bak')
        await io.write(file, doc)
      }

      const newSize = fs.statSync(outPath).size
      const pct = ((newSize - originalSize) / originalSize * 100).toFixed(1)
      const sign = newSize > originalSize ? '+' : ''
      totalBefore += originalSize
      totalAfter += newSize

      registry[basename] = makeRegistryEntry(relPath, orientation, orientationDetail, materialInfo, originalSize, newSize, outPath)

      if (parseFloat(pct) > SIZE_WARN_PCT) {
        sizeWarnings++
                log.info(`    ⚠ Größe: ${fmtSize(originalSize)} → ${fmtSize(newSize)} (${sign}${pct}%) ← WARNUNG`)
      } else {
                log.info(`    ✓ Größe: ${fmtSize(originalSize)} → ${fmtSize(newSize)} (${sign}${pct}%)`)
      }

      if (outDir) log.info(`    → Gespeichert: ${outPath} (Oberfläche: ${materialInfo.surfaceCategory})`)
      else log.info(`    → In-Place gespeichert (Backup: ${relPath}.bak)`)

      modified++
    } catch (err) {
            log.info(`  ✗ ${relPath} – Fehler: ${err.message}`)
      registry[basename] = makeRegistryEntry(relPath, null, null, null, originalSize, null, null)
      registry[basename].error = err.message
      errors++
    }
  }

  // Export-Registry schreiben (ein Eintrag pro Datei, Konfiguration für künftige Exporte)
  if (!dryRun) {
    const logPathTxt = path.join(path.dirname(registryPath), 'export-log.txt')
    try {
      registry._meta.updatedAt = new Date().toISOString()
      fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf-8')
      const entries = Object.entries(registry).filter(([k]) => k !== '_meta')
      const lines = [
        `Export-Registry – ${entries.length} Datei(en), zuletzt: ${registry._meta.updatedAt}`,
        `Ausgabe nach Oberfläche: ${outDir ? path.join(outDir, '<verzinkt|matt|textur|gemischt>') : 'In-Place'}`,
        '',
        ...entries.map(([filename, e], idx) => {
          const sizeStr =
            e.sizeBefore != null && e.sizeAfter != null
              ? `${fmtSize(e.sizeBefore)} → ${fmtSize(e.sizeAfter)}${e.sizeBefore > 0 ? ` (${((e.sizeAfter - e.sizeBefore) / e.sizeBefore * 100).toFixed(1)}%)` : ''}`
              : '–'
          const parts = [
            `[${idx + 1}/${entries.length}] ${filename}`,
            `  Letzter Export: ${e.lastExport ?? '–'}`,
            `  Ausrichtung: ${e.orientation ?? '–'}`,
            `  Oberfläche: ${e.surfaceCategory}`,
            `  RAL: ${e.ralCode ?? '–'}`,
            `  Größe: ${sizeStr}`,
            `  Ausgabe: ${e.outputPath ?? '–'}`,
          ]
          if (e.materials?.length) {
            parts.push('  Materialien:')
            e.materials.forEach((m) => {
              parts.push(`    - ${m.name}: RAL ${m.ral ?? '–'}, metallic=${m.metallic}, roughness=${m.roughness} (${m.finish})`)
            })
          }
          if (e.error) parts.push(`  Fehler: ${e.error}`)
          return parts.join('\n')
        }),
      ]
      fs.writeFileSync(logPathTxt, lines.join('\n\n'), 'utf-8')
            log.info(`  Export-Registry: ${registryPath} (${entries.length} Einträge)`)
            log.info(`  Übersicht (lesbar): ${logPathTxt}`)
    } catch (e) {
            log.info(`  ⚠ Export-Registry konnte nicht geschrieben werden: ${e.message}`)
    }
  }

    log.info('\n── Ergebnis ────────────────────────────────')
    log.info(`  Eingebrannt:   ${modified}`)
    log.info(`  Übersprungen:  ${skipped} (bereits Y-up)`)
    log.info(`  Fehler:        ${errors}`)
  if (modified > 0 && !dryRun) {
    const totalPct = totalBefore > 0 ? ((totalAfter - totalBefore) / totalBefore * 100).toFixed(1) : '0.0'
    const totalSign = totalAfter > totalBefore ? '+' : ''
        log.info(`\n  Größe gesamt:  ${fmtSize(totalBefore)} → ${fmtSize(totalAfter)} (${totalSign}${totalPct}%)`)
    if (sizeWarnings > 0) {
            log.info(`  ⚠ ${sizeWarnings} Datei(en) mit Größenzunahme über ${SIZE_WARN_PCT}%`)
    }
  }
  if (dryRun) log.info('\n  → Dry-Run: Keine Dateien geändert. Mit --write oder --out=pfad ausführen.')
  if (!dryRun && outDir) log.info(`\n  Ausgabe nach Oberfläche: ${outDir} (Unterordner: verzinkt, matt, textur, gemischt)`)
  if (!dryRun && !outDir) log.info(`\n  Ausgabe: In-Place`)
    log.info()
}

main().catch((err) => {
    log.error('Fataler Fehler:', err)
  process.exit(1)
})
