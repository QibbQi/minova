import { startDeviceFlow, pollDeviceFlow } from './oauthDeviceFlow.js'

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

  const statusText = el('div', { class: 'text-[10px] text-slate-500 font-bold', text: '' })
  const btn = el('button', { class: 'text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-xl font-bold border border-slate-200', text: 'GitHub 同步' })

  const modal = el('div', { class: 'fixed inset-0 bg-slate-900/60 backdrop-blur-sm hidden items-center justify-center z-[300] p-4' })
  const card = el('div', { class: 'bg-white rounded-2xl p-6 w-full max-w-xl shadow-2xl' })
  modal.append(card)

  const title = el('div', { class: 'text-lg font-black text-slate-800', text: 'GitHub 数据同步' })
  const tip = el('div', { class: 'text-xs text-slate-500 mt-1', text: '使用 GitHub Device Flow + 加密本地存储，将数据自动提交到你的仓库。' })

  const form = el('div', { class: 'mt-5 grid grid-cols-1 md:grid-cols-2 gap-4' })

  const clientId = el('input', { class: 'w-full border border-slate-200 rounded-xl p-3 text-sm outline-none', placeholder: 'GitHub OAuth Client ID' })
  const owner = el('input', { class: 'w-full border border-slate-200 rounded-xl p-3 text-sm outline-none', placeholder: 'owner' })
  const repo = el('input', { class: 'w-full border border-slate-200 rounded-xl p-3 text-sm outline-none', placeholder: 'repo' })
  const branch = el('input', { class: 'w-full border border-slate-200 rounded-xl p-3 text-sm outline-none', placeholder: 'branch (main)', value: 'main' })
  const path = el('input', { class: 'w-full border border-slate-200 rounded-xl p-3 text-sm outline-none md:col-span-2', placeholder: 'path (minova-data/state.json)', value: 'minova-data/state.json' })
  const passphrase = el('input', { class: 'w-full border border-slate-200 rounded-xl p-3 text-sm outline-none md:col-span-2', placeholder: '本地加密口令（用于加密 token）', type: 'password' })
  const pat = el('input', { class: 'w-full border border-slate-200 rounded-xl p-3 text-sm outline-none md:col-span-2', placeholder: '可选：粘贴 GitHub PAT（fine-grained，仓库Contents读写）', type: 'password' })

  const cfg = state().config
  clientId.value = cfg.clientId || ''
  owner.value = cfg.owner || ''
  repo.value = cfg.repo || ''
  branch.value = cfg.branch || 'main'
  path.value = cfg.path || 'minova-data/state.json'

  form.append(
    el('div', {}, [el('div', { class: 'text-[10px] font-black text-slate-400 uppercase mb-1', text: 'Client ID' }), clientId]),
    el('div', {}, [el('div', { class: 'text-[10px] font-black text-slate-400 uppercase mb-1', text: 'Owner' }), owner]),
    el('div', {}, [el('div', { class: 'text-[10px] font-black text-slate-400 uppercase mb-1', text: 'Repo' }), repo]),
    el('div', {}, [el('div', { class: 'text-[10px] font-black text-slate-400 uppercase mb-1', text: 'Branch' }), branch]),
    el('div', { class: 'md:col-span-2' }, [el('div', { class: 'text-[10px] font-black text-slate-400 uppercase mb-1', text: 'Path' }), path]),
    el('div', { class: 'md:col-span-2' }, [el('div', { class: 'text-[10px] font-black text-slate-400 uppercase mb-1', text: 'Passphrase' }), passphrase]),
    el('div', { class: 'md:col-span-2' }, [el('div', { class: 'text-[10px] font-black text-slate-400 uppercase mb-1', text: 'PAT (optional)' }), pat])
  )

  const deviceBox = el('div', { class: 'mt-4 hidden rounded-xl border border-slate-200 p-4 bg-slate-50' })
  const deviceText = el('div', { class: 'text-sm text-slate-700 font-bold', text: '' })
  const deviceHint = el('div', { class: 'text-xs text-slate-500 mt-1', text: '' })
  const deviceBtn = el('button', { class: 'mt-3 bg-slate-900 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-black', text: '打开 GitHub 授权页' })
  deviceBox.append(deviceText, deviceHint, deviceBtn)

  function formatErr(e) {
    const msg = String(e?.message || e || '')
    const reset = e?.rateLimit?.reset
    if (reset) {
      const at = new Date(parseInt(reset, 10) * 1000).toLocaleString()
      return `${msg}\n可用次数耗尽，预计恢复时间：${at}`
    }
    return msg
  }

  const footer = el('div', { class: 'mt-6 flex flex-col md:flex-row gap-3 justify-end' })
  const btnClose = el('button', { class: 'px-4 py-2 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50', text: '关闭' })
  const btnSave = el('button', { class: 'px-4 py-2 rounded-xl bg-purple-700 text-white font-bold hover:bg-purple-800', text: '保存配置' })
  const btnConnect = el('button', { class: 'px-4 py-2 rounded-xl bg-slate-900 text-white font-bold hover:bg-black', text: '连接 GitHub' })
  const btnUnlock = el('button', { class: 'px-4 py-2 rounded-xl bg-slate-900 text-white font-bold hover:bg-black', text: '解锁已保存 Token' })
  const btnCheck = el('button', { class: 'px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold hover:bg-slate-200 border border-slate-200', text: '连接自检' })
  const btnConnectPat = el('button', { class: 'px-4 py-2 rounded-xl bg-slate-900 text-white font-bold hover:bg-black', text: '使用 PAT 连接' })
  const btnDownloadHtml = el('button', { class: 'px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold hover:bg-slate-200 border border-slate-200', text: '生成更新HTML' })
  const btnPublish = el('button', { class: 'px-4 py-2 rounded-xl bg-purple-700 text-white font-bold hover:bg-purple-800', text: '发布到 Pages' })
  const btnPull = el('button', { class: 'px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold hover:bg-slate-200 border border-slate-200', text: '拉取' })
  const btnPush = el('button', { class: 'px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold hover:bg-slate-200 border border-slate-200', text: '立即提交' })
  const btnDisconnect = el('button', { class: 'px-4 py-2 rounded-xl bg-red-600 text-white font-bold hover:bg-red-700', text: '断开' })

  footer.append(btnCheck, btnPull, btnPush, btnDownloadHtml, btnPublish, btnDisconnect, btnSave, btnUnlock, btnConnectPat, btnConnect, btnClose)

  const msg = el('div', { class: 'mt-3 text-xs text-slate-500' })

  card.append(title, tip, form, deviceBox, msg, footer)

  const refresh = () => {
    const s = state()
    statusText.textContent = s.connected ? `GitHub 已连接 | 队列 ${s.queueSize}` : `GitHub 未连接${s.hasTokenStored ? '（有已保存 token）' : ''}`
    btnUnlock.style.display = s.hasTokenStored && !s.connected ? '' : 'none'
    btnCheck.style.display = s.connected ? '' : 'none'
    btnPublish.style.display = s.connected ? '' : 'none'
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
    deviceBox.classList.add('hidden')
  }
  modal.addEventListener('click', (e) => {
    if (e.target === modal) btnClose.click()
  })

  btnSave.onclick = () => {
    sync.saveConfig({ clientId: clientId.value.trim(), owner: owner.value.trim(), repo: repo.value.trim(), branch: branch.value.trim() || 'main', path: path.value.trim() || 'minova-data/state.json' })
    msg.textContent = '已保存配置'
    refresh()
  }

  btnDisconnect.onclick = async () => {
    await sync.lock()
    msg.textContent = '已断开（token 已从内存清除）'
    refresh()
  }

  btnPull.onclick = async () => {
    try {
      await sync.pull()
      msg.textContent = '已拉取并覆盖本地数据'
    } catch (e) {
      msg.textContent = formatErr(e)
    }
    refresh()
  }

  btnPush.onclick = async () => {
    try {
      await sync.enqueueSnapshot('manual sync')
      msg.textContent = '已入队提交'
    } catch (e) {
      msg.textContent = formatErr(e)
    }
    refresh()
  }

  btnUnlock.onclick = async () => {
    if (!passphrase.value) {
      msg.textContent = '请填写加密口令'
      return
    }
    try {
      const ok = await sync.unlock(passphrase.value)
      if (!ok) {
        msg.textContent = '未找到已保存 token'
      } else {
        msg.textContent = '已解锁并连接'
      }
    } catch (e) {
      msg.textContent = formatErr(e)
    }
    refresh()
  }

  btnConnect.onclick = async () => {
    const cfgNow = state().config
    if (!cfgNow.clientId) {
      msg.textContent = '请先填写 Client ID'
      return
    }
    if (!passphrase.value) {
      msg.textContent = '请填写加密口令'
      return
    }

    try {
      const flow = await startDeviceFlow({ clientId: cfgNow.clientId, scope: cfgNow.scope || 'repo' })
      deviceText.textContent = `验证码：${flow.user_code}`
      deviceHint.textContent = `在新窗口打开授权页并输入验证码，完成后本页会自动连接。`
      deviceBtn.onclick = () => window.open(flow.verification_uri, '_blank', 'noopener,noreferrer')
      deviceBox.classList.remove('hidden')
      deviceBtn.click()
      const token = await pollDeviceFlow({ clientId: cfgNow.clientId, deviceCode: flow.device_code, interval: flow.interval })
      await sync.storeToken(passphrase.value, token.access_token)
      msg.textContent = '连接成功'
    } catch (e) {
      msg.textContent = formatErr(e)
    }
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
  refresh()
}
