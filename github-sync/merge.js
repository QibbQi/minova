function byKey(arr, key) {
  const m = new Map()
  for (const it of arr || []) {
    const k = it?.[key]
    if (k != null) m.set(k, it)
  }
  return m
}

function normalizeSupplierCode(raw) {
  return String(raw || '').trim().toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9_-]/g, '')
}

function supplierMergeKey(supplier, index) {
  const code = normalizeSupplierCode(supplier?.code)
  if (code) return `code:${code}`
  const id = String(supplier?.id || '').trim()
  if (id) return `id:${id}`
  const name = String(supplier?.nameZh || supplier?.nameCn || supplier?.nameEn || supplier?.name || supplier?.vendor || '').trim()
  return name ? `name:${name}` : `idx:${index}`
}

function mergeByKey(remoteArr, localArr, keyFn) {
  const merged = []
  const positions = new Map()
  ;(Array.isArray(remoteArr) ? remoteArr : []).forEach((item, index) => {
    const key = keyFn(item, index)
    positions.set(key, merged.length)
    merged.push(item)
  })
  ;(Array.isArray(localArr) ? localArr : []).forEach((item, index) => {
    const key = keyFn(item, index)
    if (positions.has(key)) {
      merged[positions.get(key)] = item
    } else {
      positions.set(key, merged.length)
      merged.push(item)
    }
  })
  return merged
}

function marketPriceRecordKey(record, index) {
  const id = String(record?.id || '').trim()
  if (id) return `id:${id}`
  const category = String(record?.category || '').trim()
  const quotedAt = String(record?.quotedAt || '').trim()
  const ts = record?.ts ?? ''
  return `idx:${category}:${quotedAt}:${ts}:${index}`
}

function stableRecordKey(record, index) {
  const id = String(record?.id || '').trim()
  if (id) return `id:${id}`
  const ts = record?.ts ?? record?.createdAt ?? record?.updatedAt ?? ''
  const productId = String(record?.productId || '').trim()
  const batchNo = String(record?.batchNo || '').trim()
  if (ts || productId || batchNo) return `record:${productId}:${batchNo}:${ts}`
  return `idx:${index}`
}

function mergeMarketPrices(remotePrices, localPrices) {
  const r = remotePrices && typeof remotePrices === 'object' ? remotePrices : {}
  const l = localPrices && typeof localPrices === 'object' ? localPrices : {}
  const deletedRecordIds = Array.from(new Set([
    ...(Array.isArray(r.deletedRecordIds) ? r.deletedRecordIds : []),
    ...(Array.isArray(l.deletedRecordIds) ? l.deletedRecordIds : [])
  ].map((id) => String(id || '').trim()).filter(Boolean)))
  const deleted = new Set(deletedRecordIds.map((id) => `id:${id}`))
  const records = mergeByKey(r.records, l.records, marketPriceRecordKey)
    .filter((record, index) => !deleted.has(marketPriceRecordKey(record, index)))
  return {
    ...r,
    ...l,
    records,
    deletedRecordIds,
    categoryUnits: { ...(r.categoryUnits || {}), ...(l.categoryUnits || {}) }
  }
}

export function mergeState(remote, local) {
  const r = remote || {}
  const l = local || {}
  const rData = r.data || {}
  const lData = l.data || {}

  const data = {
    ...rData,
    ...lData,
    products: mergeByKey(rData.products, lData.products, stableRecordKey),
    channelPartners: mergeByKey(rData.channelPartners, lData.channelPartners, stableRecordKey),
    certificationRequirementsCatalog: mergeByKey(rData.certificationRequirementsCatalog, lData.certificationRequirementsCatalog, stableRecordKey),
    productCertificationEvidence: mergeByKey(rData.productCertificationEvidence, lData.productCertificationEvidence, stableRecordKey),
    productMasterDetailTemplates: mergeByKey(rData.productMasterDetailTemplates, lData.productMasterDetailTemplates, stableRecordKey),
    inventory: mergeByKey(rData.inventory, lData.inventory, stableRecordKey),
    inventoryHistory: [],
    suppliers: mergeByKey(rData.suppliers, lData.suppliers, supplierMergeKey),
    compatibilityRules: mergeByKey(rData.compatibilityRules, lData.compatibilityRules, stableRecordKey),
    marketPrices: mergeMarketPrices(rData.marketPrices, lData.marketPrices),
    salesRecords: mergeByKey(rData.salesRecords, lData.salesRecords, stableRecordKey),
    historicalInventory: mergeByKey(rData.historicalInventory, lData.historicalInventory, stableRecordKey),
    transportRecords: mergeByKey(rData.transportRecords, lData.transportRecords, stableRecordKey),
    fileDeleteLogs: mergeByKey(rData.fileDeleteLogs, lData.fileDeleteLogs, stableRecordKey),
    subcategoriesByCategory: { ...(rData.subcategoriesByCategory || {}), ...(lData.subcategoriesByCategory || {}) },
    nonStockPricingStrategies: { ...(rData.nonStockPricingStrategies || {}), ...(lData.nonStockPricingStrategies || {}) },
    settings: { ...(rData.settings || {}), ...(lData.settings || {}) }
  }

  const rHist = Array.isArray(rData.inventoryHistory) ? rData.inventoryHistory : []
  const lHist = Array.isArray(lData.inventoryHistory) ? lData.inventoryHistory : []
  const mergedHist = [...rHist]
  const seen = new Set(rHist.map((x) => x?.ts + ':' + x?.type + ':' + x?.productId + ':' + x?.batchNo))
  for (const h of lHist) {
    const k = h?.ts + ':' + h?.type + ':' + h?.productId + ':' + h?.batchNo
    if (!seen.has(k)) mergedHist.push(h)
  }
  data.inventoryHistory = mergedHist.sort((a, b) => (a.ts || 0) - (b.ts || 0))

  const invMap = byKey(data.inventory, 'id')
  const prodMap = byKey(data.products, 'id')
  data.inventory = Array.from(invMap.values())
  data.products = Array.from(prodMap.values())

  return { ...r, ...l, data }
}
