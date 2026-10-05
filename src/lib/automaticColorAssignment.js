export const AUTOMATIC_COLOR_RULE_SOURCE = 'automatic-color-assignment'

const DRAWING_NUMBER = /^\d{2}-\d{5}$/

export function normalizeAutomaticColorMappings(mappings) {
  const normalized = []
  const seen = new Map()
  for (const mapping of Array.isArray(mappings) ? mappings : []) {
    const drawingNumber = String(mapping?.drawingNumber || '').trim()
    const ralMatch = String(mapping?.ral || '').trim().match(/^(?:RAL\s*)?(\d{4})$/i)
    if (!DRAWING_NUMBER.test(drawingNumber) || !ralMatch) continue
    seen.set(drawingNumber, { drawingNumber, ral: `RAL ${ralMatch[1]}`, always: mapping?.always === true })
  }
  for (const mapping of seen.values()) normalized.push(mapping)
  return normalized
}

export function drawingNumberFromMeshName(name) {
  const matches = [...String(name || '').matchAll(/(?:^|_)(\d{2}-\d{5})(?=_\d+$|$)/g)]
  return matches.at(-1)?.[1] || null
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function hasVzkShortTextMarker(shortText) {
  return /(?:^|[^A-Za-z0-9])vzk(?=$|[^A-Za-z0-9])/i.test(String(shortText || ''))
}

export function ralCodeFromShortText(shortText) {
  const match = String(shortText || '').match(/(?:^|[^A-Za-z0-9])R(?:AL)?\s*(\d{4})(?=$|[^A-Za-z0-9])/i)
  return match ? `RAL ${match[1]}` : null
}

export function eanFromMeshNames(meshNames, productIdentifier = '') {
  const names = (Array.isArray(meshNames) ? meshNames : []).map((name) => String(name || '').trim()).filter(Boolean)
  const candidates = [
    ...String(productIdentifier || '').matchAll(/\d{8,14}/g),
    ...String(names[0] || '').matchAll(/(?:^|_)(\d{8,14})(?=_|$)/g),
  ].map((match) => match[1] || match[0])
  return candidates.find((ean) => names.every((name) => new RegExp(`(?:^|_)${ean}(?=_|$)`).test(name))) || null
}

export function buildAutomaticColorRulePlan(meshNames, mappings, shortText = '', productIdentifier = '') {
  const names = [...new Set((Array.isArray(meshNames) ? meshNames : []).map((name) => String(name || '').trim()).filter(Boolean))]
  const isVzkProduct = hasVzkShortTextMarker(shortText)
  const ean = eanFromMeshNames(names, productIdentifier)
  const normalizedMappings = normalizeAutomaticColorMappings(mappings)
  const normalMappings = normalizedMappings.filter((mapping) => !mapping.always)
  const alwaysMappings = normalizedMappings.filter((mapping) => mapping.always)
  const shortTextRal = ralCodeFromShortText(shortText)
  const shortTextMappings = normalMappings.filter((mapping) => mapping.ral === shortTextRal)
  const applicableMappings = isVzkProduct
    ? [...shortTextMappings, ...alwaysMappings]
    : [...normalMappings, ...alwaysMappings]
  const byDrawingNumber = new Map(applicableMappings.map((mapping) => [mapping.drawingNumber, mapping.ral]))
  const assignments = names.map((name) => ({
    name,
    drawingNumber: drawingNumberFromMeshName(name),
  }))
  assignments.forEach((assignment) => {
    assignment.ral = byDrawingNumber.get(assignment.drawingNumber) || 'RAL 9007'
  })
  const rules = [{
    target: 'mesh',
    pattern: ean ? `(?:^|_)${escapeRegex(ean)}(?=_|$)` : '.*',
    displayPattern: ean || 'Alle Meshes',
    matchMode: ean ? 'ean' : 'all',
    ral: 'RAL 9007',
    finish: 'verzinkt',
    source: AUTOMATIC_COLOR_RULE_SOURCE,
  }]
  for (const [drawingNumber, ral] of byDrawingNumber) {
    if (!assignments.some((assignment) => assignment.drawingNumber === drawingNumber)) continue
    rules.push({
      target: 'mesh', pattern: `(?:^|_)${escapeRegex(drawingNumber)}(?:_\\d+)?$`, displayPattern: drawingNumber, matchMode: 'drawing-number', ral,
      finish: ral === 'RAL 9007' ? 'verzinkt' : 'pulver', source: AUTOMATIC_COLOR_RULE_SOURCE,
    })
  }
  const counts = new Map()
  assignments.forEach(({ ral }) => counts.set(ral, (counts.get(ral) || 0) + 1))
  return {
    assignments,
    counts: [...counts.entries()].map(([ral, count]) => ({ ral, count })),
    rules,
    isVzkProduct,
    shortTextRal,
    shortTextRalMappingCount: shortTextMappings.length,
    ean,
    alwaysMappingCount: alwaysMappings.length,
  }
}
