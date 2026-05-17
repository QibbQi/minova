function byKey(arr, key) {
  const m = new Map()
  for (const it of arr || []) {
    const k = it?.[key]
    if (k != null) m.set(k, it)
  }
  return m
}

export function mergeState(remote, local) {
  const r = remote || {}
  const l = local || {}
  const rData = r.data || {}
  const lData = l.data || {}

  const data = {
    products: lData.products ?? rData.products ?? [],
    inventory: lData.inventory ?? rData.inventory ?? [],
    inventoryHistory: [],
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
