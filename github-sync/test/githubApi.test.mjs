import test from 'node:test'
import assert from 'node:assert/strict'

const { createGitHubApi, createRateLimiter } = await import('../githubApi.js')

test('github api retries on 500', async () => {
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    if (calls === 1) {
      return new Response(JSON.stringify({ error: 'x' }), { status: 500, headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  const api = createGitHubApi({
    tokenProvider: { getToken: async () => 't' },
    limiter: createRateLimiter({ minIntervalMs: 0 })
  })

  const data = await api.get('/rate_limit')
  assert.equal(data.ok, true)
  assert.equal(calls, 2)
})

