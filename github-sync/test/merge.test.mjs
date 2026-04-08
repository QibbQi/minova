import test from 'node:test'
import assert from 'node:assert/strict'

const { mergeState } = await import('../merge.js')

test('mergeState keeps local products/inventory and merges history', () => {
  const remote = { data: { products: [{ id: '1', name: 'A' }], inventory: [], inventoryHistory: [{ ts: 1, type: 'in', productId: '1' }] } }
  const local = { data: { products: [{ id: '1', name: 'A2' }], inventory: [{ id: 'inv1', productId: '1', quantity: 1 }], inventoryHistory: [{ ts: 2, type: 'out', productId: '1' }] } }
  const merged = mergeState(remote, local)
  assert.equal(merged.data.products[0].name, 'A2')
  assert.equal(merged.data.inventory.length, 1)
  assert.equal(merged.data.inventoryHistory.length, 2)
})

