function el(tag, attrs, children) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') node.className = v
    else if (k === 'text') node.textContent = v
    else node.setAttribute(k, v)
  }
  for (const c of children || []) node.append(c)
  return node
}

export function mountGitHubSyncUi({ sync }) {
  const root = document.getElementById('github-sync-root')
  if (!root) return

  const state = () => sync.getStatus()

  const defaults = {
    owner: 'QibbQi',
    repo: 'minova',
    branch: 'main',
    path: 'minova-data/state.json'
  }

  function ensureConfig() {
    const cfg = state().config || {}
    sync.saveConfig({
      owner: cfg.owner || defaults.owner,
      repo: cfg.repo || defaults.repo,
      branch: cfg.branch || defaults.branch,
      path: cfg.path || defaults.path
    })
  }

  const statusText = el('div', { class: 'text-[10px] text-slate-500 font-bold', text: '' })
  const btn = el('button', { class: 'text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-xl font-bold border border-slate-200', text: 'GitHub 同步' })

  root.innerHTML = ''
  const existing = document.getElementById('github-sync-modal')
  if (existing) existing.remove()

  const modal = el('div', { id: 'github-sync-modal', class: 'fixed inset-0 bg-slate-900/60 backdrop-blur-sm hidden items-center justify-center z-[300] p-4' })
  const card = el('div', { class: 'bg-white rounded-2xl p-6 w-full max-w-xl shadow-2xl max-h-[90vh] overflow-y-auto' })
  modal.append(card)

  const title = el('div', { class: 'text-lg font-black text-slate-800', text: 'GitHub 数据同步' })
  const tip = el('div', { class: 'text-xs text-slate-500 mt-1', text: '使用 PAT + 加密本地存储，将当前页面打包发布到 GitHub Pages（覆盖 index.html）。' })

  const form = el('div', { class: 'mt-5 grid grid-cols-1 gap-4' })
  const repoHint = el('div', { class: 'rounded-xl border border-slate-200 p-4 bg-slate-50 text-xs text-slate-600' })
  const passphrase = el('input', { class: 'w-full border border-slate-200 rounded-xl p-3 text-sm outline-none', placeholder: '本地加密口令（用于加密 PAT）', type: 'password' })
  const pat = el('input', { class: 'w-full border border-slate-200 rounded-xl p-3 text-sm outline-none', placeholder: '粘贴 GitHub PAT（fine-grained，限定 minova 仓库 Contents 读写）', type: 'password' })
  form.append(
    repoHint,
    el('div', {}, [el('div', { class: 'text-[10px] font-black text-slate-400 uppercase mb-1', text: 'Passphrase' }), passphrase]),
    el('div', {}, [el('div', { class: 'text-[10px] font-black text-slate-400 uppercase mb-1', text: 'PAT' }), pat])
  )

  function formatErr(e) {
    const msg = String(e?.message || e || '')
    const reset = e?.rateLimit?.reset
    if (reset) {
      const at = new Date(parseInt(reset, 10) * 1000).toLocaleString()
      return `${msg}\n可用次数耗尽，预计恢复时间：${at}`
    }
    return msg
  }

  const footer = el('div', { class: 'mt-6 flex flex-wrap gap-3 justify-end' })
  const btnClose = el('button', { class: 'px-4 py-2 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50', text: '关闭' })
  const btnCheck = el('button', { class: 'px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold hover:bg-slate-200 border border-slate-200', text: '连接自检' })
  const btnConnectPat = el('button', { class: 'px-4 py-2 rounded-xl bg-slate-900 text-white font-bold hover:bg-black', text: '使用 PAT 连接' })
  const btnPublish = el('button', { class: 'px-4 py-2 rounded-xl bg-purple-700 text-white font-bold hover:bg-purple-800', text: '发布到 Pages' })
  const btnDisconnect = el('button', { class: 'px-4 py-2 rounded-xl bg-red-600 text-white font-bold hover:bg-red-700', text: '断开' })

  footer.append(btnConnectPat, btnPublish, btnCheck, btnDisconnect, btnClose)

  const msg = el('div', { class: 'mt-3 text-xs text-slate-500' })

  card.append(title, tip, form, msg, footer)

  const refresh = () => {
    const s = state()
    statusText.textContent = s.connected ? `GitHub 已连接 | 队列 ${s.queueSize}` : `GitHub 未连接${s.hasTokenStored ? '（有已保存 token）' : ''}`
    btnCheck.style.display = s.connected ? '' : 'none'
    btnPublish.style.display = s.connected ? '' : 'none'
    const cfg = s.config || {}
    repoHint.textContent = `目标仓库：${cfg.owner || defaults.owner}/${cfg.repo || defaults.repo}（分支：${cfg.branch || defaults.branch}）`
  }

  btn.onclick = () => {
    modal.classList.remove('hidden')
    modal.classList.add('flex')
    refresh()
  }
  btnClose.onclick = () => {
    modal.classList.add('hidden')
    modal.classList.remove('flex')
    msg.textContent = ''
  }
  modal.addEventListener('click', (e) => {
    if (e.target === modal) btnClose.click()
  })

  btnDisconnect.onclick = async () => {
    await sync.lock()
    msg.textContent = '已断开（token 已从内存清除）'
    refresh()
  }

  btnConnectPat.onclick = async () => {
    if (!passphrase.value) {
      msg.textContent = '请填写加密口令'
      return
    }
    const token = pat.value.trim()
    if (!token) {
      msg.textContent = '请粘贴 PAT'
      return
    }
    try {
      ensureConfig()
      await sync.storeToken(passphrase.value, token)
      const s = await sync.selfCheck()
      const reset = s?.rateLimit?.reset ? new Date(parseInt(s.rateLimit.reset, 10) * 1000).toLocaleString() : '-'
      msg.textContent = `已使用 PAT 连接：${s.login || '-'} | RateLimit ${s.rateLimit.remaining}/${s.rateLimit.limit}，重置：${reset}`
    } catch (e) {
      msg.textContent = formatErr(e)
    }
    refresh()
  }

  btnCheck.onclick = async () => {
    try {
      const s = await sync.selfCheck()
      const reset = s?.rateLimit?.reset ? new Date(parseInt(s.rateLimit.reset, 10) * 1000).toLocaleString() : '-'
      msg.textContent = `已认证：${s.login || '-'}\nRateLimit(Core)：${s.rateLimit.remaining}/${s.rateLimit.limit}，重置：${reset}`
    } catch (e) {
      msg.textContent = formatErr(e)
    }
    refresh()
  }

  btnDownloadHtml.onclick = () => {
    try {
      window.downloadUpdatedHtml?.()
      msg.textContent = '已生成下载（更新版本.html）'
    } catch (e) {
      msg.textContent = formatErr(e)
    }
    refresh()
  }

  btnPublish.onclick = async () => {
    try {
      ensureConfig()
      const html = window.buildUpdatedHtml?.()
      if (!html) {
        msg.textContent = '生成 HTML 失败'
        return
      }
      await sync.publishIndexHtml(html)
      msg.textContent = '已发布：index.html 已覆盖（等待 Pages 重新部署）'
    } catch (e) {
      msg.textContent = formatErr(e)
    }
    refresh()
  }

  root.append(el('div', { class: 'flex items-center gap-3' }, [btn, statusText]))
  document.body.append(modal)
  ensureConfig()
  refresh()
}
