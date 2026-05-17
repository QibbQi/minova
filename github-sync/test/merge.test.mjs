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

test('mergeState preserves suppliers from both sides and prefers local conflicts', () => {
  const remote = {
    data: {
      products: [],
      inventory: [],
      suppliers: [
        { code: 'REMOTE', nameZh: '远端供应商', stage: 'research' },
        { code: 'BOTH', nameZh: '远端版本', stage: 'info', evaluation: { totalScore: 40 } }
      ]
    }
  }
  const local = {
    data: {
      products: [],
      inventory: [],
      suppliers: [
        { code: 'LOCAL', nameZh: '本地供应商', stage: 'trial' },
        { code: 'BOTH', nameZh: '本地版本', stage: 'core', evaluation: { totalScore: 92 } }
      ]
    }
  }
  const merged = mergeState(remote, local)
  assert.deepEqual(
    merged.data.suppliers.map((s) => s.code),
    ['REMOTE', 'BOTH', 'LOCAL']
  )
  assert.equal(merged.data.suppliers.find((s) => s.code === 'BOTH').nameZh, '本地版本')
  assert.equal(merged.data.suppliers.find((s) => s.code === 'BOTH').stage, 'core')
})

test('mergeState keeps newer state fields when adding supplier merge support', () => {
  const remote = { data: { products: [], inventory: [], companyCerts: { isoCerts: [{ id: 'iso1' }] }, transportRecords: [{ id: 'tr1' }] } }
  const local = { data: { products: [], inventory: [], salesRecords: [{ id: 'sale1' }], profitSettings: { v: 1 } } }
  const merged = mergeState(remote, local)
  assert.deepEqual(merged.data.companyCerts, { isoCerts: [{ id: 'iso1' }] })
  assert.deepEqual(merged.data.transportRecords, [{ id: 'tr1' }])
  assert.deepEqual(merged.data.salesRecords, [{ id: 'sale1' }])
  assert.deepEqual(merged.data.profitSettings, { v: 1 })
})
