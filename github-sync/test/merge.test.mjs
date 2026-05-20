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

test('mergeState merges category market price records and keeps local conflicts', () => {
  const remote = {
    data: {
      products: [],
      inventory: [],
      marketPrices: {
        records: [
          { id: 'remote-1', category: '光伏组件', priceCny: 0.82, ts: 10 },
          { id: 'both-1', category: '电池', priceCny: 620, ts: 20, note: 'remote' }
        ],
        categoryUnits: {
          光伏组件: { unit: 'W', source: 'auto', updatedAt: 10 },
          电池: { unit: 'kWh', source: 'auto', updatedAt: 10 }
        }
      }
    }
  }
  const local = {
    data: {
      products: [],
      inventory: [],
      marketPrices: {
        records: [
          { id: 'local-1', category: '逆变器', priceCny: 350, ts: 30 },
          { id: 'both-1', category: '电池', priceCny: 660, ts: 40, note: 'local' }
        ],
        categoryUnits: {
          电池: { unit: 'kWh', source: 'manual', updatedAt: 40 },
          逆变器: { unit: 'kW', source: 'auto', updatedAt: 30 }
        }
      }
    }
  }
  const merged = mergeState(remote, local)
  assert.deepEqual(
    merged.data.marketPrices.records.map((r) => r.id),
    ['remote-1', 'both-1', 'local-1']
  )
  assert.equal(merged.data.marketPrices.records.find((r) => r.id === 'both-1').note, 'local')
  assert.deepEqual(merged.data.marketPrices.categoryUnits, {
    光伏组件: { unit: 'W', source: 'auto', updatedAt: 10 },
    电池: { unit: 'kWh', source: 'manual', updatedAt: 40 },
    逆变器: { unit: 'kW', source: 'auto', updatedAt: 30 }
  })
})

test('mergeState preserves unique products inventory and transport records from both sides', () => {
  const remote = {
    data: {
      products: [
        { id: 'remote-product', name: 'Remote Product' },
        { id: 'shared-product', name: 'Remote Version' }
      ],
      inventory: [
        { id: 'remote-inv', productId: 'remote-product', quantity: 2 },
        { id: 'shared-inv', productId: 'shared-product', quantity: 3 }
      ],
      transportRecords: [
        { id: 'remote-transport', vehicle: 'Remote Truck' },
        { id: 'shared-transport', vehicle: 'Remote Van' }
      ]
    }
  }
  const local = {
    data: {
      products: [
        { id: 'local-product', name: 'Local Product' },
        { id: 'shared-product', name: 'Local Version' }
      ],
      inventory: [
        { id: 'local-inv', productId: 'local-product', quantity: 4 },
        { id: 'shared-inv', productId: 'shared-product', quantity: 5 }
      ],
      transportRecords: [
        { id: 'local-transport', vehicle: 'Local Truck' },
        { id: 'shared-transport', vehicle: 'Local Van' }
      ]
    }
  }

  const merged = mergeState(remote, local)

  assert.deepEqual(merged.data.products.map((p) => p.id), ['remote-product', 'shared-product', 'local-product'])
  assert.equal(merged.data.products.find((p) => p.id === 'shared-product').name, 'Local Version')
  assert.deepEqual(merged.data.inventory.map((i) => i.id), ['remote-inv', 'shared-inv', 'local-inv'])
  assert.equal(merged.data.inventory.find((i) => i.id === 'shared-inv').quantity, 5)
  assert.deepEqual(merged.data.transportRecords.map((r) => r.id), ['remote-transport', 'shared-transport', 'local-transport'])
  assert.equal(merged.data.transportRecords.find((r) => r.id === 'shared-transport').vehicle, 'Local Van')
})

test('mergeState keeps market price deletions from resurrecting remote records', () => {
  const remote = {
    data: {
      products: [],
      inventory: [],
      marketPrices: {
        records: [
          { id: 'keep-remote', category: '光伏组件', priceCny: 0.8, ts: 1 },
          { id: 'delete-me', category: '配件', priceCny: 12, ts: 2 }
        ],
        deletedRecordIds: []
      }
    }
  }
  const local = {
    data: {
      products: [],
      inventory: [],
      marketPrices: {
        records: [{ id: 'keep-local', category: '电池', priceCny: 650, ts: 3 }],
        deletedRecordIds: ['delete-me']
      }
    }
  }

  const merged = mergeState(remote, local)

  assert.deepEqual(merged.data.marketPrices.records.map((r) => r.id), ['keep-remote', 'keep-local'])
  assert.deepEqual(merged.data.marketPrices.deletedRecordIds, ['delete-me'])
})

test('mergeState preserves quote pricing settings in sync payload merge', () => {
  const remote = {
    data: {
      products: [],
      inventory: [],
      profitSettings: { v: 1, remoteOnly: true },
      installerProfitSettings: { cnPct: 5, myPct: 10 }
    }
  }
  const local = {
    data: {
      products: [],
      inventory: [],
      profitSettings: { v: 1, localOnly: true },
      installerProfitSettings: { cnPct: 6, myPct: 15 }
    }
  }

  const merged = mergeState(remote, local)

  assert.deepEqual(merged.data.profitSettings, { v: 1, localOnly: true })
  assert.deepEqual(merged.data.installerProfitSettings, { cnPct: 6, myPct: 15 })
})
