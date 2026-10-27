import assert from 'node:assert/strict'
import test from 'node:test'
import { estimateRequired, getStockStatus, STATUS_LABEL } from '../src/utils/stockStatus.js'
import { summarizeByCategory } from '../src/utils/statistics.js'

for (const [unit, scale] of [['pcs', 1], ['g', 100], ['ml', 100]]) {
  test(`stock boundaries for ${unit}`, () => {
    for (const [quantity, expected] of [
      [0, 'out_of_stock'], [1, 'critical'], [5 * scale, 'critical'],
      [5 * scale + 1, 'low'], [10 * scale, 'low'], [10 * scale + 1, 'normal'],
    ]) {
      assert.equal(getStockStatus({ quantity, unit }), expected, `${quantity} ${unit}`)
    }
    const target = estimateRequired({ id: '1', quantity: 0, unit }, [])
    assert.equal(getStockStatus({ quantity: target, unit }), 'normal')
  })
}

test('stock filters and category totals include all four statuses', () => {
  assert.equal(STATUS_LABEL.out_of_stock, 'Out of stock')
  const ingredients = [0, 5, 10, 11].map((quantity) => ({ quantity, unit: 'pcs', category: 'Other' }))
  const summary = summarizeByCategory(ingredients).find((row) => row.category === 'Other')
  assert.deepEqual(summary, { category: 'Other', total: 4, normal: 1, low: 1, critical: 1, out_of_stock: 1 })
})
