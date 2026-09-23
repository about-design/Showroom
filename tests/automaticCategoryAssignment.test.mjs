import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeAutomaticCategoryMappings,
  planAutomaticCategoryAssignments,
  resolveAutomaticCategory,
} from '../scripts/lib/automaticCategoryAssignment.mjs'

const mappings = [
  { prefix: 'MP', category: 'Palettenregale' },
  { prefix: 'CL', category: 'Fachbodenregale' },
  { prefix: 'KR', category: 'Kragarmregale' },
]

test('ordnet MP, CL und KR am getrimmten Kurztextanfang ohne Beachtung der Schreibweise zu', () => {
  assert.equal(resolveAutomaticCategory('  mp SR85/20', mappings), 'Palettenregale')
  assert.equal(resolveAutomaticCategory('cl Regal', mappings), 'Fachbodenregale')
  assert.equal(resolveAutomaticCategory('Kr Ausleger', mappings), 'Kragarmregale')
  assert.equal(resolveAutomaticCategory('XX Sonstiges', mappings), '')
})

test('längstes eindeutiges Kürzel gewinnt und widersprüchliche gleich lange Treffer bleiben offen', () => {
  assert.equal(resolveAutomaticCategory('MP GIRO', [...mappings, { prefix: 'MP GI', category: 'Zubehör' }]), 'Zubehör')
  assert.equal(resolveAutomaticCategory('MP Produkt', [...mappings, { prefix: 'mp', category: 'Zubehör' }]), '')
})

test('plant ausschließlich Produkte ohne bereits gesetzte Hauptkategorie', () => {
  assert.deepEqual(planAutomaticCategoryAssignments([
    { id: '1', shortText: 'MP Produkt', mainCategory: '' },
    { id: '2', shortText: 'CL Produkt', mainCategory: 'Zubehör' },
    { id: '3', shortText: 'KR Produkt' },
  ], mappings), [
    { id: '1', category: 'Palettenregale' },
    { id: '3', category: 'Kragarmregale' },
  ])
})

test('entfernt unvollständige Einstellungszeilen ohne Standardwerte im Code zu ergänzen', () => {
  assert.deepEqual(normalizeAutomaticCategoryMappings([
    { prefix: ' MP ', category: ' Palettenregale ' },
    { prefix: '', category: 'Zubehör' },
  ]), [{ prefix: 'MP', category: 'Palettenregale' }])
  assert.deepEqual(normalizeAutomaticCategoryMappings(undefined), [])
})
