import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMutationQueue } from '../src/utils/mutationQueue.js'

test('stock and order writes finish in invocation order, even after a failed request', async () => {
  const queue = createMutationQueue()
  const events = []
  let finish
  const a = queue(async () => { events.push('stock'); await new Promise((r) => { finish = r }); events.push('stock saved') })
  const b = queue(async () => { events.push('order'); throw Error('not enough stock') })
  const failed = assert.rejects(b)
  const c = queue(async () => events.push('menu'))
  await new Promise((r) => setTimeout(r, 0))
  assert.deepEqual(events, ['stock'])
  finish()
  await Promise.all([a, failed, c])
  assert.deepEqual(events, ['stock', 'stock saved', 'order', 'menu'])
})
