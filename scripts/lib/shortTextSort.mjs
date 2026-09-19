const collator = new Intl.Collator('de', { sensitivity: 'accent' })

function sortKey(product) {
  const text = typeof product.shortText === 'string' ? product.shortText.trim() : ''
  return /^[-–—−\s]*$/u.test(text) ? '' : text
}

/** Compare stored SAP short texts, keeping missing values last in both directions. */
export function compareShortText(a, b, descending = false) {
  const left = sortKey(a)
  const right = sortKey(b)
  if (!left || !right) return left ? -1 : right ? 1 : 0
  return descending ? collator.compare(right, left) : collator.compare(left, right)
}
