/**
 * Wavefront .mtl Parser/Serializer für Dashboard-Editor und Vite-API.
 * Bekannte Direktiven werden strukturiert; alles andere bleibt in material.unknown (Round-Trip).
 */

/** @typedef {{ r: number, g: number, b: number }} RgbTriplet */

/**
 * @typedef {object} MtlMaterial
 * @property {string} name
 * @property {RgbTriplet | null} Ka
 * @property {RgbTriplet | null} Kd
 * @property {RgbTriplet | null} Ks
 * @property {RgbTriplet | null} Ke
 * @property {RgbTriplet | null} Tf
 * @property {number | null} Ns
 * @property {number | null} Ni
 * @property {number | null} d
 * @property {number | null} Tr
 * @property {number | null} illum
 * @property {Record<string, string | null>} maps map_Kd → maps.Kd (Wert = Rest der Zeile nach dem Schlüsselwort)
 * @property {string[]} unknown rohe Zeilen (inkl. Leerzeilen), Reihenfolge erhalten
 */

const MAP_KEYS = ['Kd', 'Ka', 'Ks', 'Ke', 'Ns', 'd', 'bump', 'disp', 'decal', 'refl']

function emptyMaps() {
  /** @type {Record<string, string | null>} */
  const o = {}
  for (const k of MAP_KEYS) o[k] = null
  return o
}

/**
 * @param {string} name
 * @returns {MtlMaterial}
 */
export function createEmptyMaterial(name = 'NeuesMaterial') {
  return {
    name,
    Ka: null,
    Kd: null,
    Ks: null,
    Ke: null,
    Tf: null,
    Ns: null,
    Ni: null,
    d: null,
    Tr: null,
    illum: null,
    maps: emptyMaps(),
    unknown: [],
  }
}

function parseFloatOrNull(s) {
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}

function parseTriplet(parts) {
  if (parts.length < 3) return null
  const r = parseFloat(parts[0])
  const g = parseFloat(parts[1])
  const b = parseFloat(parts[2])
  if (![r, g, b].every(Number.isFinite)) return null
  return { r, g, b }
}

function restAfterFirstToken(line) {
  const t = line.trim()
  const i = t.search(/\s/)
  if (i < 0) return ''
  return t.slice(i + 1).trimEnd()
}

/**
 * @param {string} text
 * @returns {{ header: string[], materials: MtlMaterial[] }}
 */
export function parseMtl(text) {
  const lines = text.split(/\r?\n/)
  // Trailing „leere Zeile“ entsteht bei split oft nur durch abschließendes \n – kein echtes MTL-Blank.
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  const header = []
  let i = 0
  for (; i < lines.length; i++) {
    const line = lines[i]
    const t = line.trim()
    if (t.startsWith('newmtl ')) break
    header.push(line)
  }

  /** @type {MtlMaterial[]} */
  const materials = []
  /** @type {MtlMaterial | null} */
  let cur = null

  for (; i < lines.length; i++) {
    const line = lines[i]
    const t = line.trim()
    if (t.startsWith('newmtl ')) {
      cur = createEmptyMaterial(t.slice(7).trim())
      materials.push(cur)
      continue
    }
    if (!cur) {
      header.push(line)
      continue
    }

    if (!t) {
      cur.unknown.push(line)
      continue
    }
    if (t.startsWith('#')) {
      cur.unknown.push(line)
      continue
    }

    const parts = t.split(/\s+/)
    const cmd = parts[0]

    if (cmd === 'Ka' || cmd === 'Kd' || cmd === 'Ks' || cmd === 'Ke') {
      const rgb = parseTriplet(parts.slice(1))
      if (rgb) {
        cur[cmd] = rgb
        continue
      }
    }
    if (cmd === 'Tf') {
      const rgb = parseTriplet(parts.slice(1))
      if (rgb) {
        cur.Tf = rgb
        continue
      }
    }
    if (cmd === 'Ns' && parts.length >= 2) {
      cur.Ns = parseFloatOrNull(parts[1])
      continue
    }
    if (cmd === 'Ni' && parts.length >= 2) {
      cur.Ni = parseFloatOrNull(parts[1])
      continue
    }
    if (cmd === 'd' && parts.length >= 2) {
      cur.d = parseFloatOrNull(parts[1])
      continue
    }
    if (cmd === 'Tr' && parts.length >= 2) {
      cur.Tr = parseFloatOrNull(parts[1])
      continue
    }
    if (cmd === 'illum' && parts.length >= 2) {
      cur.illum = parseFloatOrNull(parts[1])
      continue
    }

    if (cmd.startsWith('map_')) {
      const sub = cmd.slice(4)
      if (MAP_KEYS.includes(sub)) {
        const rest = restAfterFirstToken(line)
        cur.maps[sub] = rest || null
        continue
      }
    }
    if (cmd === 'bump' && cur.maps.bump == null) {
      cur.maps.bump = restAfterFirstToken(line) || null
      continue
    }
    if (cmd === 'disp') {
      cur.maps.disp = restAfterFirstToken(line) || null
      continue
    }
    if (cmd === 'decal') {
      cur.maps.decal = restAfterFirstToken(line) || null
      continue
    }
    if (cmd === 'refl') {
      cur.maps.refl = restAfterFirstToken(line) || null
      continue
    }

    cur.unknown.push(line)
  }

  return { header, materials }
}

function fmtFloat(n) {
  if (n == null || !Number.isFinite(n)) return '0.000000'
  return n.toFixed(6)
}

function fmtTriplet(rgb) {
  if (!rgb) return null
  return `${fmtFloat(rgb.r)} ${fmtFloat(rgb.g)} ${fmtFloat(rgb.b)}`
}

/**
 * @param {{ header?: string[], materials: MtlMaterial[] }} data
 * @returns {string}
 */
export function serializeMtl(data) {
  const header = Array.isArray(data.header) ? data.header : []
  const materials = Array.isArray(data.materials) ? data.materials : []
  const out = []

  for (const h of header) {
    out.push(h)
  }
  if (header.length && header[header.length - 1] !== '' && materials.length) {
    out.push('')
  }

  for (let mi = 0; mi < materials.length; mi++) {
    const m = materials[mi]
    const name = (m && typeof m.name === 'string' ? m.name : 'Material').trim() || 'Material'
    out.push(`newmtl ${name}`)
    const maps = m.maps && typeof m.maps === 'object' ? m.maps : emptyMaps()

    if (m.Ns != null && Number.isFinite(m.Ns)) out.push(`Ns ${fmtFloat(m.Ns)}`)
    const ka = fmtTriplet(m.Ka)
    if (ka) out.push(`Ka ${ka}`)
    const kd = fmtTriplet(m.Kd)
    if (kd) out.push(`Kd ${kd}`)
    const ks = fmtTriplet(m.Ks)
    if (ks) out.push(`Ks ${ks}`)
    const ke = fmtTriplet(m.Ke)
    if (ke) out.push(`Ke ${ke}`)
    const tf = fmtTriplet(m.Tf)
    if (tf) out.push(`Tf ${tf}`)
    if (m.Ni != null && Number.isFinite(m.Ni)) out.push(`Ni ${fmtFloat(m.Ni)}`)
    if (m.d != null && Number.isFinite(m.d)) out.push(`d ${fmtFloat(m.d)}`)
    if (m.Tr != null && Number.isFinite(m.Tr)) out.push(`Tr ${fmtFloat(m.Tr)}`)
    if (m.illum != null && Number.isFinite(m.illum)) out.push(`illum ${Math.round(m.illum)}`)

    const order = ['Kd', 'Ka', 'Ks', 'Ke', 'Ns', 'd', 'bump', 'disp', 'decal', 'refl']
    for (const k of order) {
      const v = maps[k]
      if (v != null && String(v).trim() !== '') {
        if (k === 'bump') out.push(`map_bump ${String(v).trim()}`)
        else out.push(`map_${k} ${String(v).trim()}`)
      }
    }

    for (const u of m.unknown || []) {
      out.push(u)
    }
  }

  const body = out.join('\n')
  if (!body.length) return ''
  return body.endsWith('\n') ? body : `${body}\n`
}
