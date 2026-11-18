export function normalizeAutomaticCategoryMappings(value) {
  if (!Array.isArray(value)) return []
  return value.map((row) => ({
    prefix: String(row?.prefix || '').trim(),
    category: String(row?.category || '').trim(),
  })).filter((row) => row.prefix && row.category)
}

export function resolveAutomaticCategory(shortText, mappings) {
  const text = String(shortText || '').trimStart().toLocaleUpperCase('de-DE')
  if (!text) return ''
  const matches = normalizeAutomaticCategoryMappings(mappings)
    .filter((row) => text.startsWith(row.prefix.toLocaleUpperCase('de-DE')))
  if (!matches.length) return ''
  const longest = Math.max(...matches.map((row) => row.prefix.length))
  const categories = [...new Set(matches.filter((row) => row.prefix.length === longest).map((row) => row.category))]
  return categories.length === 1 ? categories[0] : ''
}

export function planAutomaticCategoryAssignments(products, mappings) {
  const assignments = []
  for (const product of Array.isArray(products) ? products : []) {
    if (String(product?.mainCategory || '').trim()) continue
    const category = resolveAutomaticCategory(product?.shortText, mappings)
    if (category) assignments.push({ id: String(product.id), category })
  }
  return assignments
}
