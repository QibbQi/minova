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

test('mergeState merges compatibility matrix rules and keeps local conflicts', () => {
  const remote = {
    data: {
      products: [],
      inventory: [],
      compatibilityRules: [
        { id: 'remote-rule', relationType: 'PV ↔ Inverter', sourceProductId: 'PV1', targetProductId: 'INV1', status: 'Approved' },
        { id: 'shared-rule', relationType: 'Inverter ↔ Battery', sourceProductId: 'INV1', targetProductId: 'BAT1', status: 'Pending', remark: 'remote' }
      ]
    }
  }
  const local = {
    data: {
      products: [],
      inventory: [],
      compatibilityRules: [
        { id: 'local-rule', relationType: 'System Bundle', sourceProductId: 'ESS1', targetProductId: 'BOS1', status: 'Approved' },
        { id: 'shared-rule', relationType: 'Inverter ↔ Battery', sourceProductId: 'INV1', targetProductId: 'BAT1', status: 'Approved', remark: 'local' }
      ]
    }
  }

  const merged = mergeState(remote, local)

  assert.deepEqual(merged.data.compatibilityRules.map((rule) => rule.id), ['remote-rule', 'shared-rule', 'local-rule'])
  assert.equal(merged.data.compatibilityRules.find((rule) => rule.id === 'shared-rule').status, 'Approved')
  assert.equal(merged.data.compatibilityRules.find((rule) => rule.id === 'shared-rule').remark, 'local')
})

test('mergeState merges engineering certification records and evidence by stable id', () => {
  const remote = {
    data: {
      products: [],
      inventory: [],
      certificationRequirementsCatalog: [
        { id: 'PV-001', standard: 'IEC 61215 series', remarks: 'remote' },
        { id: 'INV-001', standard: 'IEC 62109-1' }
      ],
      productCertificationEvidence: [
        { id: 'P1:PV-001', productId: 'P1', requirementRecordId: 'PV-001', status: 'remote' }
      ],
      productMasterDetailTemplates: [
        { id: 'PV Module:basic', category: 'PV Module', detailGroup: 'basic', fieldKeys: ['model'], remarks: 'remote' },
        { id: 'Battery:electrical', category: 'Battery', detailGroup: 'electrical', fieldKeys: ['nominalEnergyKwh'] }
      ]
    }
  }
  const local = {
    data: {
      products: [],
      inventory: [],
      certificationRequirementsCatalog: [
        { id: 'PV-001', standard: 'IEC 61215 series', remarks: 'local' },
        { id: 'BESS-001', standard: 'IEC 62619' }
      ],
      productCertificationEvidence: [
        { id: 'P1:PV-001', productId: 'P1', requirementRecordId: 'PV-001', status: 'local' },
        { id: 'P2:BESS-001', productId: 'P2', requirementRecordId: 'BESS-001', status: 'Pending Evidence' }
      ],
      productMasterDetailTemplates: [
        { id: 'PV Module:basic', category: 'PV Module', detailGroup: 'basic', fieldKeys: ['model', 'series'], remarks: 'local' },
        { id: 'Inverter:commercial', category: 'Inverter', detailGroup: 'commercial', fieldKeys: ['remark'] }
      ]
    }
  }

  const merged = mergeState(remote, local)

  assert.deepEqual(merged.data.certificationRequirementsCatalog.map((record) => record.id), ['PV-001', 'INV-001', 'BESS-001'])
  assert.equal(merged.data.certificationRequirementsCatalog.find((record) => record.id === 'PV-001').remarks, 'local')
  assert.deepEqual(merged.data.productCertificationEvidence.map((record) => record.id), ['P1:PV-001', 'P2:BESS-001'])
  assert.equal(merged.data.productCertificationEvidence.find((record) => record.id === 'P1:PV-001').status, 'local')
  assert.deepEqual(merged.data.productMasterDetailTemplates.map((record) => record.id), ['PV Module:basic', 'Battery:electrical', 'Inverter:commercial'])
  assert.equal(merged.data.productMasterDetailTemplates.find((record) => record.id === 'PV Module:basic').remarks, 'local')
})

test('mergeState merges channel partners and keeps local conflicts', () => {
  const remote = {
    data: {
      products: [],
      inventory: [],
      channelPartners: [
        { id: 'remote-channel', brandSupplierCode: 'BRAND1', type: 'Authorized Distributor', name: 'Remote Distributor' },
        { id: 'shared-channel', brandSupplierCode: 'BRAND1', type: 'Dealer', name: 'Remote Dealer' }
      ]
    }
  }
  const local = {
    data: {
      products: [],
      inventory: [],
      channelPartners: [
        { id: 'local-channel', brandSupplierCode: 'BRAND2', type: 'EPC Partner', name: 'Local EPC' },
        { id: 'shared-channel', brandSupplierCode: 'BRAND1', type: 'Dealer', name: 'Local Dealer' }
      ]
    }
  }

  const merged = mergeState(remote, local)

  assert.deepEqual(merged.data.channelPartners.map((partner) => partner.id), ['remote-channel', 'shared-channel', 'local-channel'])
  assert.equal(merged.data.channelPartners.find((partner) => partner.id === 'shared-channel').name, 'Local Dealer')
})

test('mergeState preserves nested presales intake and prefers local project conflicts', () => {
  const merged = mergeState(
    { data: { presalesProjects: [{ id: 'BD1', intakeBasis: { location: 'Remote' } }] } },
    { data: { presalesProjects: [{ id: 'BD1', intakeBasis: { location: 'Sabah' }, evidenceStatus: { utilityBills: 'partial' } }] } }
  )
  assert.equal(merged.data.presalesProjects.length, 1)
  assert.equal(merged.data.presalesProjects[0].intakeBasis.location, 'Sabah')
  assert.equal(merged.data.presalesProjects[0].evidenceStatus.utilityBills, 'partial')
})
