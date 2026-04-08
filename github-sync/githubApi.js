function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

export function createGitHubApi({ tokenProvider, limiter }) {
  async function request(url, init, attempt = 0) {
    await limiter.wait()
    const token = await tokenProvider.getToken()
    const headers = new Headers(init?.headers || {})
    headers.set('Accept', 'application/vnd.github+json')
    headers.set('X-GitHub-Api-Version', '2022-11-28')
    if (token) headers.set('Authorization', `Bearer ${token}`)
    if (!headers.has('Content-Type') && init?.body) headers.set('Content-Type', 'application/json')

    const res = await fetch(url, { ...init, headers })
    const remaining = res.headers.get('x-ratelimit-remaining')
    const reset = res.headers.get('x-ratelimit-reset')
    if (remaining === '0' && reset) {
      const waitMs = Math.max(0, parseInt(reset, 10) * 1000 - Date.now())
      await sleep(Math.min(waitMs, 60_000))
    }

    if (res.status === 429 || res.status === 500 || res.status === 502 || res.status === 503 || res.status === 504) {
      if (attempt < 4) {
        const retryAfter = res.headers.get('retry-after')
        const backoff = retryAfter ? parseInt(retryAfter, 10) * 1000 : (2 ** attempt) * 800
        await sleep(backoff)
        return request(url, init, attempt + 1)
      }
    }

    const text = await res.text()
    let data
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = text
    }

    if (!res.ok) {
      const err = new Error(`GitHub API ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`)
      err.status = res.status
      err.data = data
      throw err
    }
    return data
  }

  return {
    get: (path) => request(`https://api.github.com${path}`, { method: 'GET' }),
    put: (path, body) => request(`https://api.github.com${path}`, { method: 'PUT', body: JSON.stringify(body) }),
    post: (path, body, headers) => request(`https://api.github.com${path}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined, headers })
  }
}

export function createRateLimiter({ minIntervalMs = 350 }) {
  let lastAt = 0
  let chain = Promise.resolve()
  const wait = () => {
    chain = chain.then(async () => {
      const now = Date.now()
      const diff = now - lastAt
      if (diff < minIntervalMs) await sleep(minIntervalMs - diff)
      lastAt = Date.now()
    })
    return chain
  }
  return { wait }
}

