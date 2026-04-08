export function createStorage() {
  const memory = new Map()
  const hasLocalStorage = (() => {
    try {
      const k = '__minova_test__'
      localStorage.setItem(k, '1')
      localStorage.removeItem(k)
      return true
    } catch {
      return false
    }
  })()

  const get = (key) => {
    if (hasLocalStorage) return localStorage.getItem(key)
    return memory.get(key) ?? null
  }

  const set = (key, value) => {
    if (hasLocalStorage) localStorage.setItem(key, value)
    else memory.set(key, value)
  }

  const remove = (key) => {
    if (hasLocalStorage) localStorage.removeItem(key)
    else memory.delete(key)
  }

  return { get, set, remove, hasLocalStorage }
}

