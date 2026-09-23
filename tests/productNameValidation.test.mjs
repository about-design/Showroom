import assert from 'node:assert/strict'
import { formatValidatedProductName, getProductNameIdentifierMismatch } from '../src/dashboard/modules/helpers.js'

const mismatch = (value) => `<span class="card-name-identifier-mismatch">${value}</span>`
const base = { name: 'Produkt 4026212308860_182550', sapEan: '4026212308860', sapArticleNumber: '182550' }

assert.equal(formatValidatedProductName(base), 'Produkt 4026212308860_182550')
assert.equal(getProductNameIdentifierMismatch(base), null)
assert.equal(
  formatValidatedProductName({ ...base, sapEan: '9999999999999' }),
  `Produkt ${mismatch('4026212308860')}_182550`,
)
assert.deepEqual(getProductNameIdentifierMismatch({ ...base, sapEan: '9999999999999' }), {
  eanMismatch: true, articleMismatch: false, nameEan: '4026212308860', nameArticle: '182550',
})
assert.equal(
  formatValidatedProductName({ ...base, sapArticleNumber: '999999' }),
  `Produkt 4026212308860_${mismatch('182550')}`,
)
assert.deepEqual(getProductNameIdentifierMismatch({ ...base, sapArticleNumber: '999999' }), {
  eanMismatch: false, articleMismatch: true, nameEan: '4026212308860', nameArticle: '182550',
})
assert.equal(
  formatValidatedProductName({ ...base, sapEan: '9999999999999', sapArticleNumber: '999999' }),
  `Produkt ${mismatch('4026212308860')}_${mismatch('182550')}`,
)
assert.deepEqual(getProductNameIdentifierMismatch({ ...base, sapEan: '9999999999999', sapArticleNumber: '999999' }), {
  eanMismatch: true, articleMismatch: true, nameEan: '4026212308860', nameArticle: '182550',
})

console.log('Passed: correct, EAN mismatch, article mismatch, and both mismatches.')
