import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compareShortText } from '../scripts/lib/shortTextSort.mjs'

const missing = ['', null, undefined, '   ', '–', '—', '-', ' − ']
const texts = [' MP DSS L 2700 ', 'mp dss l 1825', 'MP DSS L 2225']

for (const descending of [false, true]) {
  test(`Kurztext ${descending ? 'Z–A' : 'A–Z'} keeps missing values last`, () => {
    const products = [...missing, ...texts].map((shortText, id) => ({ id, shortText }))
    const snapshot = structuredClone(products)
    const sorted = [...products].sort((a, b) => compareShortText(a, b, descending))
    assert.deepEqual(sorted.slice(0, 3).map(p => p.shortText.trim()), descending
      ? ['MP DSS L 2700', 'MP DSS L 2225', 'mp dss l 1825']
      : ['mp dss l 1825', 'MP DSS L 2225', 'MP DSS L 2700'])
    assert.deepEqual(sorted.slice(3).map(p => p.shortText), missing)
    assert.deepEqual(products, snapshot)
    assert.equal(compareShortText({ shortText: ' Alpha ' }, { shortText: 'alpha' }, descending), 0)
  })
}

test('dashboard API filters before sorting and paginates afterwards', () => {
  const source = readFileSync(new URL('../scripts/vite-plugin/dashboardApi.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('          let list = allProducts')
  const end = source.indexOf('          const stats =', start)
  const run = new Function('allProducts', 'sort', 'search', 'filter', 'status', 'categoryParam', 'targetRalParam', 'page', 'limit', 'compareShortText',
    source.slice(start, end) + '\nreturn { items, total };')
  const products = [
    { id: '1', name: 'Match', shortText: 'Zulu', type: 'single' },
    { id: '2', name: 'Match', shortText: null, type: 'single' },
    { id: '3', name: 'Match', shortText: 'Alpha', type: 'single' },
    { id: '4', name: 'Other', shortText: 'Beta', type: 'single' },
    { id: '5', name: 'Match', shortText: 'Gamma', type: 'composed' },
  ]
  for (const [sort, ids] of [['shortTextAsc', ['3', '1']], ['shortTextDesc', ['1', '3']]]) {
    const result = run(products, sort, 'match', 'single', 'all', 'all', 'all', 1, 2, compareShortText)
    assert.equal(result.total, 3)
    assert.deepEqual(result.items.map(p => p.id), ids)
    const last = run(products, sort, 'match', 'single', 'all', 'all', 'all', 2, 2, compareShortText)
    assert.equal(last.items[0].id, '2')
    const html = readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8')
    assert.ok(html.includes(`value="${sort}"`))
  }
})
