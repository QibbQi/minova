import { mergeState } from './merge.js'

function toBase64Utf8(str) {
  return btoa(unescape(encodeURIComponent(str)))
}

function fromBase64Utf8(b64) {
  return decodeURIComponent(escape(atob(b64)))
}

function base64ToBytes(b64) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function fromBase64Utf8Safe(b64) {
  const clean = String(b64 || '').replaceAll('\n', '')
  try {
    return new TextDecoder().decode(base64ToBytes(clean))
  } catch {
    return fromBase64Utf8(clean)
  }
}

function encodeContentPath(path) {
  return String(path || '')
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/')
}

function encodeRefPath(ref) {
  return String(ref || '')
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/')
}

export function createRepoStore({ api }) {
  async function getFileViaGitDataApi({ owner, repo, path, branch }) {
    const cleanPath = String(path || '').replace(/^\//, '')
    const ref = await api.get(`/repos/${owner}/${repo}/git/ref/heads/${encodeRefPath(branch || '')}`)
    const headSha = ref?.object?.sha
    if (!headSha) throw new Error('Unable to resolve branch head')

    const headCommit = await api.get(`/repos/${owner}/${repo}/git/commits/${headSha}`)
    const baseTreeSha = headCommit?.tree?.sha
    if (!baseTreeSha) throw new Error('Unable to resolve base tree')

    const tree = await api.get(`/repos/${owner}/${repo}/git/trees/${baseTreeSha}?recursive=1`)
    const items = Array.isArray(tree?.tree) ? tree.tree : []
    const hit = items.find((it) => String(it?.path || '') === cleanPath && String(it?.type || '') === 'blob')
    const blobSha = hit?.sha
    if (!blobSha) throw new Error('Unable to resolve blob sha')

    const blob = await api.get(`/repos/${owner}/${repo}/git/blobs/${blobSha}`)
    const encoding = String(blob?.encoding || '')
    const content = encoding === 'base64' ? fromBase64Utf8Safe(blob?.content || '') : String(blob?.content || '')
    return { sha: blobSha, content, raw: blob }
  }

  async function getFile({ owner, repo, path, branch }) {
    const cleanPath = String(path || '').replace(/^\//, '')
    const ref = branch ? `?ref=${encodeURIComponent(branch)}` : ''
    let data = null
    try {
      data = await api.get(`/repos/${owner}/${repo}/contents/${encodeContentPath(cleanPath)}${ref}`)
    } catch (e) {
      if (e?.status === 403 && branch) return getFileViaGitDataApi({ owner, repo, path: cleanPath, branch })
      throw e
    }
    let content = ''
    if (data?.content) {
      content = fromBase64Utf8Safe(data.content)
    } else if (data?.download_url && typeof api.fetchText === 'function') {
      try {
        content = await api.fetchText(data.download_url, { method: 'GET' })
      } catch (e) {
        content = ''
      }
    }
    if (!content && branch) {
      try {
        return await getFileViaGitDataApi({ owner, repo, path: cleanPath, branch })
      } catch (e) {}
    }
    return { sha: data?.sha || null, content, raw: data }
  }

  async function putFile({ owner, repo, path, branch, message, content, sha }) {
    return api.put(`/repos/${owner}/${repo}/contents/${encodeContentPath(path)}`, {
      message,
      content: toBase64Utf8(content),
      sha: sha || undefined,
      branch: branch || undefined
    })
  }

  async function upsertJson({ owner, repo, path, branch, message, next }) {
    let remote = { sha: null, content: '' }
    try {
      remote = await getFile({ owner, repo, path, branch })
    } catch (e) {
      if (e?.status !== 404) throw e
    }

    let remoteJson = null
    try {
      remoteJson = remote.content ? JSON.parse(remote.content) : null
    } catch {
      remoteJson = null
    }

    const merged = remoteJson ? mergeState(remoteJson, next) : next
    const finalContent = JSON.stringify(merged, null, 2)

    try {
      return await putFile({
        owner,
        repo,
        path,
        branch,
        message,
        content: finalContent,
        sha: remote.sha
      })
    } catch (e) {
      if (e?.status === 409) {
        const latest = await getFile({ owner, repo, path, branch })
        let latestJson = null
        try {
          latestJson = latest.content ? JSON.parse(latest.content) : null
        } catch {
          latestJson = null
        }
        const merged2 = latestJson ? mergeState(latestJson, next) : next
        return putFile({
          owner,
          repo,
          path,
          branch,
          message: `${message} (merge)`,
          content: JSON.stringify(merged2, null, 2),
          sha: latest.sha
        })
      }
      throw e
    }
  }

  async function upsertText({ owner, repo, path, branch, message, content }) {
    let remote = { sha: null }
    try {
      remote = await getFile({ owner, repo, path, branch })
    } catch (e) {
      if (e?.status !== 404) throw e
    }

    try {
      return await putFile({
        owner,
        repo,
        path,
        branch,
        message,
        content,
        sha: remote.sha
      })
    } catch (e) {
      if (e?.status === 409) {
        const latest = await getFile({ owner, repo, path, branch })
        return putFile({
          owner,
          repo,
          path,
          branch,
          message: `${message} (retry)`,
          content,
          sha: latest.sha
        })
      }
      throw e
    }
  }

  async function commitTextFiles({ owner, repo, branch, message, files }) {
    const list = Array.isArray(files) ? files.filter((f) => f?.path) : []
    if (!list.length) throw new Error('No files to commit')
    if (!branch) throw new Error('Missing branch')

    for (let attempt = 0; attempt < 3; attempt++) {
      const ref = await api.get(`/repos/${owner}/${repo}/git/ref/heads/${encodeRefPath(branch)}`)
      const headSha = ref?.object?.sha
      if (!headSha) throw new Error('Unable to resolve branch head')

      const headCommit = await api.get(`/repos/${owner}/${repo}/git/commits/${headSha}`)
      const baseTreeSha = headCommit?.tree?.sha
      if (!baseTreeSha) throw new Error('Unable to resolve base tree')

      const treeItems = []
      for (const f of list) {
        const blob = await api.post(`/repos/${owner}/${repo}/git/blobs`, { content: String(f.content ?? ''), encoding: f.encoding || 'utf-8' })
        treeItems.push({ path: String(f.path), mode: '100644', type: 'blob', sha: blob?.sha })
      }

      const tree = await api.post(`/repos/${owner}/${repo}/git/trees`, { base_tree: baseTreeSha, tree: treeItems })
      const newTreeSha = tree?.sha
      if (!newTreeSha) throw new Error('Unable to create tree')

      const commit = await api.post(`/repos/${owner}/${repo}/git/commits`, { message, tree: newTreeSha, parents: [headSha] })
      const newCommitSha = commit?.sha
      if (!newCommitSha) throw new Error('Unable to create commit')

      try {
        await api.patch(`/repos/${owner}/${repo}/git/refs/heads/${encodeRefPath(branch)}`, { sha: newCommitSha, force: false })
        return commit
      } catch (e) {
        if (e?.status === 422 && attempt < 2) continue
        throw e
      }
    }
    throw new Error('Failed to update branch ref')
  }

  return { getFile, upsertJson, upsertText, commitTextFiles }
}
