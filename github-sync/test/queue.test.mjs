import test from 'node:test'
import assert from 'node:assert/strict'

const { createAsyncQueue } = await import('../queue.js')
const { createStorage } = await import('../storage.js')

test('queue runs items in order', async () => {
  const storage = createStorage()
  const q = createAsyncQueue({ storage, key: '__q__' })
  q.clear()
  q.enqueue({ n: 1 })
  q.enqueue({ n: 2 })
  const seen = []
  await q.run(async (it) => {
    seen.push(it.n)
  })
  assert.deepEqual(seen, [1, 2])
  assert.equal(q.items.length, 0)
})

