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

export function mergeState(remote, local) {
  const r = remote || {}
  const l = local || {}
  const rData = r.data || {}
  const lData = l.data || {}

  const data = {
    ...rData,
    ...lData,
    products: lData.products ?? rData.products ?? [],
    inventory: lData.inventory ?? rData.inventory ?? [],
    inventoryHistory: [],
    suppliers: mergeByKey(rData.suppliers, lData.suppliers, supplierMergeKey),
    subcategoriesByCategory: { ...(rData.subcategoriesByCategory || {}), ...(lData.subcategoriesByCategory || {}) },
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
