export const ISSUE_CATALOG = [
  { id: 'wrong-color', label: 'Falsche Farben' },
  { id: 'wrong-orientation', label: 'Falsche Ausrichtung' },
  { id: 'wrong-scale', label: 'Falsche Skalierung' },
  { id: 'missing-parts', label: 'Fehlende Teile' },
  { id: 'file-too-large', label: 'Datei zu groß' },
  { id: 'mesh-errors', label: 'Mesh-Fehler' },
  { id: 'texture-missing', label: 'Texturen fehlen' },
  { id: 'other', label: 'Sonstiges' },
]

export const STATUS_LABELS = {
  open: 'Offen',
  review: 'In Prüfung',
  approved: 'Freigegeben',
  rejected: 'Abgelehnt',
}

/** Feste Hauptkategorien für Filter, Karten-Schnellwahl und Stammdaten-Auswahl */
export const MAIN_PRODUCT_CATEGORIES = [
  'Fachbodenregale',
  'Palettenregale',
  'Kragarmregale',
  'Weitspannregale',
  'Zubehör',
]

export const MAIN_PRODUCT_CATEGORY_SET = new Set(MAIN_PRODUCT_CATEGORIES)

export function mergeMainCategoryOptions(fromApi) {
  const extras = (fromApi || [])
    .map((c) => String(c || '').trim())
    .filter(Boolean)
    .filter((c) => !MAIN_PRODUCT_CATEGORY_SET.has(c))
    .sort((a, b) => a.localeCompare(b, 'de'))
  return [...MAIN_PRODUCT_CATEGORIES, ...extras]
}

export const PAGE_SIZES = [12, 24, 48, 96]

/** LRU-Pool für Card-Previews (Grid). Zu hoch → Browser „Too many WebGL contexts“. */
export const CARD_PREVIEW_POOL_MAX = 6
