/**
 * Farb-Token (de/en) -> RAL-Code.
 * Dient als generischer Fallback, wenn CAD/GLB-Farben kollabieren, aber Namen
 * (Mesh/Material) weiterhin die Zielfarbe tragen.
 */

const ALIAS_TO_RAL = new Map()

function add(ralCode, aliases) {
  for (const raw of aliases) {
    const token = String(raw || '').trim().toLowerCase()
    if (!token) continue
    ALIAS_TO_RAL.set(token, ralCode)
  }
}

add('RAL 3000', [
  'rot',
  'red',
  'feuerrot',
  'signalrot',
  'karminrot',
  'rubinrot',
  'weinrot',
])
add('RAL 5010', [
  'blau',
  'blue',
  'enzianblau',
  'ultramarin',
  'cobalt',
  'kobalt',
  'navy',
])
add('RAL 1003', [
  'gelb',
  'yellow',
  'signalgelb',
  'zitronengelb',
  'goldgelb',
])
add('RAL 2001', [
  'orange',
  'rotorange',
  'orangefarben',
])
add('RAL 6011', [
  'gruen',
  'green',
  'resedagruen',
  'olivgruen',
])
add('RAL 7035', [
  'grau',
  'grey',
  'gray',
  'lichtgrau',
  'silbergrau',
  'hellgrau',
])
add('RAL 7016', [
  'anthrazit',
  'anthracite',
  'graphit',
  'graphite',
  'dunkelgrau',
  'darkgray',
  'darkgrey',
])
add('RAL 9005', [
  'schwarz',
  'black',
  'tiefschwarz',
])
add('RAL 9007', [
  'verzinkt',
  'galvanized',
  'galvanised',
  'zinc',
  'zink',
  'silber',
  'silver',
  'metal',
  'metall',
  'stahl',
  'steel',
  'aluminium',
  'aluminum',
  'alu',
  'edelstahl',
  'inox',
])

function tokenize(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/**
 * Liefert den RAL-Code aus dem letzten erkannten Farb-Token im Namen.
 * Das "letzte gewinnt" passt gut zu Namen wie "..._Platte_Rot".
 */
export function ralFromColorNameAlias(name) {
  const tokens = tokenize(name)
  let match = null
  for (const t of tokens) {
    const ral = ALIAS_TO_RAL.get(t)
    if (ral) match = ral
  }
  return match
}

