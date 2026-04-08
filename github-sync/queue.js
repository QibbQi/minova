export function createAsyncQueue({ storage, key }) {
  let running = false
  let inMemory = []

  const load = () => {
    try {
      const raw = storage.get(key)
      inMemory = raw ? JSON.parse(raw) : []
    } catch {
      inMemory = []
    }
  }

  const persist = () => {
    storage.set(key, JSON.stringify(inMemory))
  }

  const enqueue = (item) => {
    inMemory.push(item)
    persist()
  }

  const clear = () => {
    inMemory = []
    persist()
  }

  const run = async (fn) => {
    if (running) return
    running = true
    try {
      while (inMemory.length) {
        const next = inMemory[0]
        await fn(next)
        inMemory.shift()
        persist()
      }
    } finally {
      running = false
    }
  }

  load()
  return { enqueue, run, clear, get items() { return [...inMemory] } }
}

