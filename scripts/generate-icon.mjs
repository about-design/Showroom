#!/usr/bin/env node
/**
 * Erzeugt ein markenkonformes App-Icon (META "M") ohne externe Abhaengigkeiten.
 * Ausgabe:
 *   electron/icon.ico  – Multi-Size-Icon fuer den Windows-Installer & das Fenster
 *   electron/icon.png  – 256px PNG (Referenz / Linux)
 *
 * Aufruf:
 *   node scripts/generate-icon.mjs
 *
 * Hinweis: Reines Node (zlib), funktioniert identisch auf macOS und Windows.
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(__dirname, '..')
const OUT_DIR = join(ROOT, 'electron')

// Markenfarben (siehe src/styles/main.css)
const BG = [0x08, 0x08, 0x0a] // --sr-bg, dunkles "M"
const ACCENT = [0xf5, 0x9e, 0x0b] // --sr-accent
const ACCENT_DIM = [0xb4, 0x53, 0x09] // gradient-Ende

const ICO_SIZES = [256, 128, 64, 48, 32, 16]

function lerp(a, b, t) {
  return a + (b - a) * t
}

function mix(c1, c2, t) {
  return [
    Math.round(lerp(c1[0], c2[0], t)),
    Math.round(lerp(c1[1], c2[1], t)),
    Math.round(lerp(c1[2], c2[2], t)),
  ]
}

/** Distanz Punkt -> Segment */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx
  const cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}

/** Coverage einer abgerundeten Kachel (1 innen, 0 aussen, weicher Rand) */
function tileCoverage(nx, ny, radius, aa) {
  // nx, ny in [0,1]. Abstand zum Rand eines rounded rect mit Radius r.
  const r = radius
  const dx = Math.max(r - nx, nx - (1 - r), 0)
  const dy = Math.max(r - ny, ny - (1 - r), 0)
  const cornerDist = Math.hypot(dx, dy)
  // signed distance: positiv = ausserhalb der Rundung
  const sd = cornerDist - r
  return Math.max(0, Math.min(1, 0.5 - sd / aa))
}

/** Coverage des "M"-Buchstabens */
function letterCoverage(nx, ny, stroke, aa) {
  const p = 0.27
  const x0 = p
  const x1 = 1 - p
  const xm = 0.5
  const yTop = p
  const yBot = 1 - p
  const yValley = 0.62
  const segs = [
    [x0, yBot, x0, yTop], // linke Senkrechte
    [x1, yBot, x1, yTop], // rechte Senkrechte
    [x0, yTop, xm, yValley], // linke Diagonale
    [x1, yTop, xm, yValley], // rechte Diagonale
  ]
  let best = Infinity
  for (const s of segs) {
    const d = distToSegment(nx, ny, s[0], s[1], s[2], s[3])
    if (d < best) best = d
  }
  const sd = best - stroke / 2
  return Math.max(0, Math.min(1, 0.5 - sd / aa))
}

/** Rendert RGBA-Buffer der Groesse size x size */
function renderRGBA(size) {
  const buf = Buffer.alloc(size * size * 4)
  const aa = 1.5 / size // Kantenglaettung in Normkoordinaten
  const radius = 0.22
  const stroke = 0.135
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5) / size
      const ny = (y + 0.5) / size
      const tile = tileCoverage(nx, ny, radius, aa)
      let rgb
      let alpha
      if (tile <= 0) {
        rgb = BG
        alpha = 0
      } else {
        // Diagonaler Verlauf accent -> accent-dim
        const t = Math.max(0, Math.min(1, (nx + ny) / 2))
        const tileColor = mix(ACCENT, ACCENT_DIM, t)
        const letter = letterCoverage(nx, ny, stroke, aa)
        rgb = mix(tileColor, BG, letter)
        alpha = Math.round(tile * 255)
      }
      const i = (y * size + x) * 4
      buf[i] = rgb[0]
      buf[i + 1] = rgb[1]
      buf[i + 2] = rgb[2]
      buf[i + 3] = alpha
    }
  }
  return buf
}

// ── PNG-Encoder (8-bit RGBA) ──
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

function encodePNG(rgba, size) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  // Scanlines mit Filter 0
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ── ICO-Container (PNG-komprimierte Eintraege) ──
function encodeICO(entries) {
  const count = entries.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type icon
  header.writeUInt16LE(count, 4)
  const dirSize = 16 * count
  let offset = 6 + dirSize
  const dir = Buffer.alloc(dirSize)
  entries.forEach((e, idx) => {
    const o = idx * 16
    dir[o] = e.size >= 256 ? 0 : e.size
    dir[o + 1] = e.size >= 256 ? 0 : e.size
    dir[o + 2] = 0 // palette
    dir[o + 3] = 0 // reserved
    dir.writeUInt16LE(1, o + 4) // planes
    dir.writeUInt16LE(32, o + 6) // bpp
    dir.writeUInt32LE(e.png.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += e.png.length
  })
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)])
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const entries = ICO_SIZES.map((size) => ({
    size,
    png: encodePNG(renderRGBA(size), size),
  }))
  const ico = encodeICO(entries)
  writeFileSync(join(OUT_DIR, 'icon.ico'), ico)
  const png256 = entries.find((e) => e.size === 256).png
  writeFileSync(join(OUT_DIR, 'icon.png'), png256)
  console.log(`icon.ico (${ICO_SIZES.join(',')}px) + icon.png -> ${dirname(join(OUT_DIR, 'icon.ico'))}`)
}

main()
