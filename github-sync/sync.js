import { createStorage } from './storage.js'
import { encryptWithPassphrase, decryptWithPassphrase } from './crypto.js'
import { createAsyncQueue } from './queue.js'
import { createGitHubApi, createRateLimiter } from './githubApi.js'
import { createRepoStore } from './repoStore.js'

const KEY = {
  config: 'minova_github_sync_config_v1',
  token: 'minova_github_token_enc_v1',
  queue: 'minova_github_sync_queue_v1',
  audit: 'minova_github_sync_audit_v1'
}

function nowIso() {
  return new Date().toISOString()
}

function uuid() {
  return crypto.randomUUID()
}

function safeJsonParse(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

export function createGitHubSync({ getLocalState, applyRemoteState }) {
  const storage = createStorage()
  const limiter = createRateLimiter({ minIntervalMs: 800 })

  let unlockedToken = null
  let config = safeJsonParse(storage.get(KEY.config), {
    clientId: '',
    owner: '',
    repo: '',
    branch: 'main',
    path: 'minova-data/state.json',
    scope: 'repo'
  })

  const audit = safeJsonParse(storage.get(KEY.audit), [])
  const queue = createAsyncQueue({ storage, key: KEY.queue })

  const tokenProvider = {
    async getToken() {
      return unlockedToken
    }
  }

  const api = createGitHubApi({ tokenProvider, limiter })
  const repo = createRepoStore({ api })

  function saveConfig(next) {
    config = { ...config, ...next }
    storage.set(KEY.config, JSON.stringify(config))
  }

  function appendAudit(action, detail) {
    audit.unshift({ id: uuid(), at: nowIso(), action, detail })
    storage.set(KEY.audit, JSON.stringify(audit.slice(0, 2000)))
  }

  async function unlock(passphrase) {
    const raw = storage.get(KEY.token)
    if (!raw) return false
    const payload = safeJsonParse(raw, null)
    if (!payload) return false
    const token = await decryptWithPassphrase(passphrase, payload)
    unlockedToken = token
    appendAudit('unlock', 'token unlocked')
    return true
  }

  async function lock() {
    unlockedToken = null
    appendAudit('lock', 'token cleared from memory')
  }

  async function storeToken(passphrase, token) {
    const payload = await encryptWithPassphrase(passphrase, token)
    storage.set(KEY.token, JSON.stringify(payload))
    unlockedToken = token
    appendAudit('store_token', 'token stored (encrypted)')
  }

  async function pull() {
    const { owner, repo: repoName, branch, path } = config
    if (!owner || !repoName || !path) throw new Error('Missing repo config')
    const file = await repo.getFile({ owner, repo: repoName, branch, path })
    const json = file.content ? JSON.parse(file.content) : null
    if (!json?.data) throw new Error('Remote state is empty')
    applyRemoteState(json.data)
    appendAudit('pull', `${owner}/${repoName}:${path}`)
    return json
  }

  async function selfCheck() {
    if (!unlockedToken) throw new Error('Not connected')
    const user = await api.get('/user')
    const rate = await api.get('/rate_limit')
    const core = rate?.resources?.core || {}
    return {
      login: user?.login || '',
      rateLimit: {
        remaining: core.remaining,
        limit: core.limit,
        reset: core.reset
      }
    }
  }

  async function pushSnapshot(reason) {
    const { owner, repo: repoName, branch, path } = config
    if (!owner || !repoName || !path) throw new Error('Missing repo config')
    const local = getLocalState()
    const payload = {
      v: 1,
      updatedAt: nowIso(),
      data: local,
      audit: [{ id: uuid(), at: nowIso(), action: 'snapshot', detail: reason }]
    }
    await repo.upsertJson({
      owner,
      repo: repoName,
      branch,
      path,
      message: `minova: ${reason} (${new Date().toLocaleString()})`,
      next: payload
    })
    appendAudit('push', `${owner}/${repoName}:${path} (${reason})`)
  }

  function enqueueSnapshot(reason) {
    const keep = queue.items.filter((x) => x.type !== 'snapshot')
    queue.clear()
    for (const it of keep) queue.enqueue(it)
    queue.enqueue({ id: uuid(), at: nowIso(), type: 'snapshot', reason })
    void flush()
  }

  async function flush() {
    await queue.run(async (item) => {
      if (!unlockedToken) throw new Error('Not connected')
      if (item.type === 'snapshot') await pushSnapshot(item.reason)
    })
  }

  function getStatus() {
    return {
      connected: !!unlockedToken,
      config,
      queueSize: queue.items.length,
      hasTokenStored: !!storage.get(KEY.token)
    }
  }

  return {
    storage,
    getStatus,
    saveConfig,
    unlock,
    lock,
    storeToken,
    enqueueSnapshot,
    pull,
    selfCheck,
    flush
  }
}
