import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRestockRecommendations } from '../src/utils/aiInsights.js'
import { isForecastStale } from '../src/utils/forecastFreshness.js'

const forecast = {
  outlook: { restock: [{ id: '1', expectedDemand: 10, shortage: 8, suggested: 8, priority: 'high', menus: [] }] },
}
const recommendations = (quantity, unit = 'pcs') => buildRestockRecommendations({
  ingredients: [{ id: '1', name: 'Rice', quantity, unit }], menus: [], forecast,
})

test('restock disappears after applying the recommended amount', () => {
  assert.equal(recommendations(2)[0].suggested, 8)
  assert.deepEqual(recommendations(10), [])
})

test('partial restock uses the remaining shortage and unit step', () => {
  assert.equal(recommendations(7)[0].suggested, 3)
  assert.equal(recommendations(7, 'g')[0].suggested, 10)
})

test('fresh ingredients are purchased exactly without rounding up', () => {
  for (const category of ['Meat', 'Vegetable', 'Fruit']) {
    const result = buildRestockRecommendations({
      ingredients: [{ id: '1', name: 'Fresh', quantity: 7, unit: 'g', category }], menus: [], forecast,
    })
    assert.equal(result[0].suggested, 3)
  }
})

test('backend stock policy controls buffer and purchase step on the frontend', () => {
  const result = buildRestockRecommendations({
    ingredients: [{ id: '1', quantity: 5, unit: 'g', category: 'Meat' }], menus: [],
    forecast: { outlook: { restock: [{ id: '1', expectedDemand: 97, targetStock: 107, purchaseStep: 10, menus: [] }] } },
  })
  assert.equal(result[0].shortage, 102)
  assert.equal(result[0].suggested, 110)
})

test('forecast becomes stale when the target is no longer tomorrow in Thailand', () => {
  const result = { generatedAt: '2026-10-24T16:00:00Z', daily: [{ date: '2026-10-25' }] }
  assert.equal(isForecastStale(result, Date.parse('2026-10-24T16:30:00Z')), false)
  assert.equal(isForecastStale(result, Date.parse('2026-10-24T18:00:00Z')), true)
})

test('invalid timestamps and missing daily forecasts are stale', () => {
  assert.equal(isForecastStale({ generatedAt: 'invalid', daily: [] }), true)
})

test('tomorrow recommendations exclude lots expiring today', () => {
  const result = buildRestockRecommendations({ ingredients: [{ id: '1', quantity: 10, usableQuantity: 10, unit: 'g', category: 'Meat',
    batches: [{ remaining: 8, expiresOn: '2026-10-25' }, { remaining: 2, expiresOn: null }],
  }], menus: [], forecast: { ...forecast, daily: [{ date: '2026-10-26' }] } })
  assert.equal(result[0].shortage, 8)
  assert.equal(result[0].suggested, 8)
})
