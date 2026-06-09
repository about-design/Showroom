#!/usr/bin/env node
/**
 * Brennt Root-Node Z-up-Korrekturen (±90° X-Rotation) in die Vertex-Daten ein,
 * sodass die GLB-Dateien nativ Y-up sind – ohne Root-Transform.
 *
 * Usage:
 *   node scripts/bake-glb-yup.js                          → Vorschau (Dry-Run)
 *   node scripts/bake-glb-yup.js --write                  → In-Place mit .bak-Backup
 *   node scripts/bake-glb-yup.js --out=pfad               → Ausgabe in anderes Verzeichnis
 *   node scripts/bake-glb-yup.js --dir=public/models/xyz  → Anderes Eingabe-Verzeichnis
 */
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const EPSILON = 0.005

// ─── CLI Args ───────────────────────────────────────────────────────
const args = process.argv.slice(2)
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
const hasFlag = (name) => args.includes(`--${name}`)

const inputDir = path.resolve(ROOT, flag('dir') || 'public/models/products')
const dryRun = !hasFlag('write') && !flag('out')
const outDir = flag('out') ? path.resolve(ROOT, flag('out')) : null

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

// ─── Transform-Logik ────────────────────────────────────────────────
function bakeRootRotation(doc) {
  const root = doc.getRoot()
  let baked = false

  for (const scene of root.listScenes()) {
    for (const rootNode of scene.listChildren()) {
      const q = rootNode.getRotation()
      if (isIdentityQuat(q)) continue

      const t = rootNode.getTranslation()
      const s = rootNode.getScale()
      if (Math.abs(t[0]) > EPSILON || Math.abs(t[1]) > EPSILON || Math.abs(t[2]) > EPSILON) {
        console.log(`    ⚠ Root hat Translation [${t.map(v => v.toFixed(4))}] – wird mit eingebrannt`)
      }
      if (Math.abs(s[0] - 1) > EPSILON || Math.abs(s[1] - 1) > EPSILON || Math.abs(s[2] - 1) > EPSILON) {
        console.log(`    ⚠ Root hat Scale [${s.map(v => v.toFixed(4))}] – übersprungen`)
        continue
      }

      const mat = quatToMat3(q)

      // Root-Node selbst kann ein Mesh tragen (häufig bei CAD-Exporten)
      const ownMesh = rootNode.getMesh()
      if (ownMesh) {
        transformMeshData(ownMesh, q)
      }

      // Rotation an Kinder-Nodes weitergeben
      pushRotationDown(rootNode, q, mat)

      rootNode.setRotation([0, 0, 0, 1])
      rootNode.setTranslation([0, 0, 0])
      baked = true
    }
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
    console.log(`    ⚠ Mesh wird von ${parents.length} Nodes geteilt – klone für sicheres Baking`)
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
  console.log('\n╔══════════════════════════════════════════╗')
  console.log('║   GLB Y-up Bake Tool                     ║')
  console.log('╚══════════════════════════════════════════╝')
  console.log(`  Input:   ${inputDir}`)
  if (dryRun) console.log('  Modus:   DRY-RUN (keine Änderungen, nur Analyse)')
  else if (outDir) console.log(`  Output:  ${outDir}`)
  else console.log('  Modus:   IN-PLACE (mit .bak-Backup)')
  console.log()

  const files = findGlbs(inputDir)
  if (!files.length) { console.log('Keine .glb-Dateien gefunden.'); return }
  console.log(`${files.length} GLB-Dateien gefunden.\n`)

  // IO vorbereiten (mit optionalem Draco)
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  try {
    const draco = await import('draco3dgltf')
    io.registerDependencies({
      'draco3d.decoder': await draco.default.createDecoderModule(),
      'draco3d.encoder': await draco.default.createEncoderModule(),
    })
    console.log('  Draco-Support: aktiv\n')
  } catch {
    console.log('  Draco-Support: nicht verfügbar (draco3dgltf nicht installiert)\n')
  }

  if (!dryRun && outDir && !fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true })
  }

  function fmtSize(bytes) {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
  }

  const SIZE_WARN_PCT = 15
  let modified = 0, skipped = 0, errors = 0, sizeWarnings = 0
  let totalBefore = 0, totalAfter = 0

  for (const file of files) {
    const relPath = path.relative(inputDir, file)
    const originalSize = fs.statSync(file).size
    try {
      const doc = await io.read(file)

      let hasCorrection = false
      let rotInfo = ''
      for (const scene of doc.getRoot().listScenes()) {
        for (const node of scene.listChildren()) {
          const q = node.getRotation()
          if (!isIdentityQuat(q)) {
            hasCorrection = true
            const label = isZupCorrection(q) ? 'Z-up→Y-up' : 'andere'
            rotInfo = `[${q.map((v) => v.toFixed(4)).join(', ')}] (${label})`
          }
        }
      }

      if (!hasCorrection) {
        console.log(`  ✓ ${relPath} – bereits Y-up (${fmtSize(originalSize)})`)
        skipped++
        if (!dryRun && outDir) {
          const out = path.join(outDir, relPath)
          fs.mkdirSync(path.dirname(out), { recursive: true })
          fs.copyFileSync(file, out)
        }
        continue
      }

      console.log(`  ★ ${relPath}`)
      console.log(`    Root-Rotation: ${rotInfo}`)
      console.log(`    Original: ${fmtSize(originalSize)}`)

      if (dryRun) {
        console.log('    → Würde eingebrannt werden (Dry-Run)')
        modified++
        continue
      }

      const baked = bakeRootRotation(doc)
      if (!baked) {
        console.log('    ✗ Baking fehlgeschlagen')
        errors++
        continue
      }

      if (!verifyNoRootRotation(doc)) {
        console.log('    ✗ Verifikation fehlgeschlagen: Root hat noch Rotation')
        errors++
        continue
      }

      let outPath
      if (outDir) {
        outPath = path.join(outDir, relPath)
        fs.mkdirSync(path.dirname(outPath), { recursive: true })
        await io.write(outPath, doc)
      } else {
        outPath = file
        fs.copyFileSync(file, file + '.bak')
        await io.write(file, doc)
      }

      const newSize = fs.statSync(outPath).size
      const pct = ((newSize - originalSize) / originalSize * 100).toFixed(1)
      const sign = newSize > originalSize ? '+' : ''
      totalBefore += originalSize
      totalAfter += newSize

      if (parseFloat(pct) > SIZE_WARN_PCT) {
        sizeWarnings++
        console.log(`    ⚠ Größe: ${fmtSize(originalSize)} → ${fmtSize(newSize)} (${sign}${pct}%) ← WARNUNG`)
      } else {
        console.log(`    ✓ Größe: ${fmtSize(originalSize)} → ${fmtSize(newSize)} (${sign}${pct}%)`)
      }

      if (outDir) console.log(`    → Gespeichert: ${outPath}`)
      else console.log(`    → In-Place gespeichert (Backup: ${relPath}.bak)`)

      modified++
    } catch (err) {
      console.log(`  ✗ ${relPath} – Fehler: ${err.message}`)
      errors++
    }
  }

  console.log('\n── Ergebnis ────────────────────────────────')
  console.log(`  Eingebrannt:   ${modified}`)
  console.log(`  Übersprungen:  ${skipped} (bereits Y-up)`)
  console.log(`  Fehler:        ${errors}`)
  if (modified > 0 && !dryRun) {
    const totalPct = totalBefore > 0 ? ((totalAfter - totalBefore) / totalBefore * 100).toFixed(1) : '0.0'
    const totalSign = totalAfter > totalBefore ? '+' : ''
    console.log(`\n  Größe gesamt:  ${fmtSize(totalBefore)} → ${fmtSize(totalAfter)} (${totalSign}${totalPct}%)`)
    if (sizeWarnings > 0) {
      console.log(`  ⚠ ${sizeWarnings} Datei(en) mit Größenzunahme über ${SIZE_WARN_PCT}%`)
    }
  }
  if (dryRun) console.log('\n  → Dry-Run: Keine Dateien geändert. Mit --write oder --out=pfad ausführen.')
  if (!dryRun && outDir) console.log(`\n  Ausgabe: ${outDir}`)
  console.log()
}

main().catch((err) => {
  console.error('Fataler Fehler:', err)
  process.exit(1)
})
