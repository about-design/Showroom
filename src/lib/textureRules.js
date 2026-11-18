/**
 * Textur-Regeln: Texturen aus Bibliothek/Uploads gezielt auf Teile legen.
 *
 * Match-Quellen (wie Namens-Farbregeln):
 *   - `target`: `material | node | mesh | nodePath`
 *   - `pattern` (Regex, gemeinsamer JS/Python-Subset) + optionale `flags` (nur "i")
 *
 * Zuweisung:
 *   - `textureId`: Bibliotheks-ID (public/textures/library.json) oder
 *     `upload:<datei>` (Produkt-Upload unter public/models/products/<id>/textures/).
 *   - `textureId: null` → „Textur entfernen" (Produkt hebt globale Regel auf).
 *   - `repeatMm`: physische Kachelgröße; Default aus Bibliothekseintrag.
 *   - `finish`: optionale PBR-Overrides { metallic, roughness }.
 *   - `source: 'meshSelect'`: nur auf Regeln, die das Einzelteile-Dropdown erzeugt.
 *
 * Auswertung: global → Produkt, letzte passende Regel gewinnt (wie überall).
 * Angewendet wird in Blender (convert_to_glb.py, --texture-rules-json) —
 * inkl. UV-Box-Projektion. Der Bake (bake-glb-yup.js, --texture-rules) nutzt die
 * Regeln nur zum SCHUTZ der texturierten Materialien vor Farb-/Strip-Pässen.
 */

const TARGETS = new Set(['material', 'node', 'mesh', 'nodePath'])
const SIDES = new Set(['all', 'outer', 'inner', 'top', 'bottom', 'left', 'right', 'front', 'back'])
const MAPPINGS = new Set(['tile', 'fit', 'unfold'])

export const TEXTURE_RULE_MESH_SELECT_SOURCE = 'meshSelect'

/**
 * Roh-Einträge aus Mapping + conversionPreset zusammenführen (serialisierbar).
 * @param {object|null} globalMapping - public/mtl-ral-color-mapping.json
 * @param {object|null} productPreset - products[].conversionPreset
 * @returns {Array<object>}
 */
export function mergeTextureRuleEntries(globalMapping = null, productPreset = null) {
  const product = productPreset?.textureRules
  const global = globalMapping?.textureRules
  return [...(Array.isArray(global) ? global : []), ...(Array.isArray(product) ? product : [])]
}

/**
 * Kompiliert Regeln (Regex-Instanz, normalisierte Felder). Ungültige Einträge
 * werden verworfen. `textureId: null` bleibt erhalten (= entfernen).
 * @param {Array<object>} rules
 * @returns {Array<{ target: string, pattern: string, flags: string, regex: RegExp, textureId: string|null, repeatMm: number|null, finish: object|null, source: string|null }>}
 */
export function compileTextureRules(rules) {
  const out = []
  if (!Array.isArray(rules)) return out
  for (const r of rules) {
    if (!r || typeof r !== 'object') continue
    const tRaw = String(r.target ?? 'mesh').trim()
    const target = TARGETS.has(tRaw) ? tRaw : 'mesh'
    const pattern = String(r.pattern ?? '').trim()
    if (!pattern) continue
    const flags = r.flags === 'i' ? 'i' : ''
    let regex
    try {
      regex = new RegExp(pattern, flags)
    } catch {
      continue
    }
    const textureId =
      r.textureId === null || r.textureId === undefined || r.textureId === ''
        ? null
        : String(r.textureId)
    const repeatMm = Number.isFinite(Number(r.repeatMm)) && Number(r.repeatMm) > 0
      ? Number(r.repeatMm)
      : null
    const finish =
      r.finish && typeof r.finish === 'object' && !Array.isArray(r.finish) ? r.finish : null
    const source = typeof r.source === 'string' ? r.source : null
    const sideRaw = String(r.side ?? 'all').trim().toLowerCase()
    const side = SIDES.has(sideRaw) ? sideRaw : 'all'
    const mapRaw = String(r.mapping ?? 'tile').trim().toLowerCase()
    const mapping = MAPPINGS.has(mapRaw) ? mapRaw : 'tile'
    out.push({ target, pattern, flags, regex, textureId, repeatMm, finish, source, side, mapping })
  }
  return out
}

/**
 * Letzte passende Regel für einen Kandidaten (oder null).
 * @param {Array<object>} compiled - aus compileTextureRules
 * @param {{ meshName?: string, materialName?: string, nodeName?: string, nodePath?: string }} candidate
 */
export function matchTextureRule(compiled, candidate) {
  if (!Array.isArray(compiled) || !compiled.length) return null
  const haystacks = {
    mesh: candidate.meshName ?? '',
    node: candidate.nodeName ?? candidate.meshName ?? '',
    material: candidate.materialName ?? '',
    nodePath: candidate.nodePath ?? '',
  }
  let hit = null
  for (const rule of compiled) {
    const hay = haystacks[rule.target] ?? ''
    if (hay && rule.regex.test(hay)) hit = rule
  }
  return hit
}

/**
 * Trennt manuelle Regeln von den generierten Einzelteile-Dropdown-Regeln,
 * damit der manuelle Editor die generierten nie anzeigt/verschluckt.
 * @param {Array<object>} rules
 * @returns {{ manual: Array<object>, meshSelect: Array<object> }}
 */
export function splitTextureRules(rules) {
  const manual = []
  const meshSelect = []
  for (const r of Array.isArray(rules) ? rules : []) {
    if (r && r.source === TEXTURE_RULE_MESH_SELECT_SOURCE) meshSelect.push(r)
    else if (r) manual.push(r)
  }
  return { manual, meshSelect }
}

/**
 * Löst textureIds zu absoluten Map-Dateipfaden + Defaults auf (Node-seitig,
 * für den Konverter-Payload). Regeln mit unauflösbarer ID werden verworfen
 * (mit Eintrag in `warnings`); `textureId: null`-Regeln bleiben (= entfernen).
 *
 * @param {Array<object>} rules - rohe (unkompiliierte) Regeln
 * @param {{ libraryManifest: object|null, libraryDir: string, productTexturesDir: string|null, pathResolve: (...p: string[]) => string, fileExists: (p: string) => boolean }} ctx
 * @returns {{ resolved: Array<object>, warnings: string[] }}
 */
export function resolveTextureRuleAssets(rules, ctx) {
  const resolved = []
  const warnings = []
  const entries = Array.isArray(ctx.libraryManifest?.textures) ? ctx.libraryManifest.textures : []
  const byId = new Map(entries.map((e) => [String(e.id), e]))

  for (const r of Array.isArray(rules) ? rules : []) {
    if (!r || typeof r !== 'object') continue
    const sideRaw = String(r.side ?? 'all').trim().toLowerCase()
    const mapRaw = String(r.mapping ?? 'tile').trim().toLowerCase()
    const base = {
      target: r.target ?? 'mesh',
      pattern: r.pattern,
      flags: r.flags === 'i' ? 'i' : '',
      side: SIDES.has(sideRaw) ? sideRaw : 'all',
      mapping: MAPPINGS.has(mapRaw) ? mapRaw : 'tile',
    }
    const id = r.textureId === null || r.textureId === undefined || r.textureId === ''
      ? null
      : String(r.textureId)

    if (id === null) {
      resolved.push({ ...base, textureId: null })
      continue
    }

    if (id.startsWith('upload:')) {
      const fname = id.slice('upload:'.length)
      if (!ctx.productTexturesDir) {
        warnings.push(`Textur-Regel übersprungen (kein Produktkontext für ${id})`)
        continue
      }
      const abs = ctx.pathResolve(ctx.productTexturesDir, fname)
      if (!ctx.fileExists(abs)) {
        warnings.push(`Textur-Upload fehlt: ${abs}`)
        continue
      }
      resolved.push({
        ...base,
        textureId: id,
        repeatMm: Number(r.repeatMm) > 0 ? Number(r.repeatMm) : 600,
        maps: { baseColor: abs },
        finish: r.finish && typeof r.finish === 'object' ? r.finish : { metallic: 0, roughness: 0.85 },
      })
      continue
    }

    const entry = byId.get(id)
    if (!entry) {
      warnings.push(`Textur-ID unbekannt: ${id}`)
      continue
    }
    const maps = {}
    for (const [slot, rel] of Object.entries(entry.maps || {})) {
      if (!rel) continue
      const abs = ctx.pathResolve(ctx.libraryDir, String(rel))
      if (ctx.fileExists(abs)) maps[slot] = abs
      else warnings.push(`Textur-Datei fehlt (${id}/${slot}): ${abs}`)
    }
    if (!maps.baseColor) {
      warnings.push(`Textur-Regel übersprungen (${id}: keine baseColor-Map auflösbar)`)
      continue
    }
    resolved.push({
      ...base,
      textureId: id,
      repeatMm: Number(r.repeatMm) > 0 ? Number(r.repeatMm) : Number(entry.defaultRepeatMm) > 0 ? Number(entry.defaultRepeatMm) : 600,
      maps,
      finish:
        r.finish && typeof r.finish === 'object'
          ? r.finish
          : entry.defaultFinish && typeof entry.defaultFinish === 'object'
            ? entry.defaultFinish
            : { metallic: 0, roughness: 0.85 },
    })
  }
  return { resolved, warnings }
}
