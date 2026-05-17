
        import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
        import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
        import { getFirestore, collection, doc, setDoc, onSnapshot, deleteDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

        const initGitHubSync = (() => {
            const KEY = {
                config: 'minova_github_sync_config_v1',
                token: 'minova_github_token_enc_v1',
                queue: 'minova_github_sync_queue_v1',
                audit: 'minova_github_sync_audit_v1'
            };

            function createStorage() {
                const memory = new Map();
                const hasLocalStorage = (() => {
                    try {
                        const k = '__minova_test__';
                        localStorage.setItem(k, '1');
                        localStorage.removeItem(k);
                        return true;
                    } catch {
                        return false;
                    }
                })();

                const get = (key) => {
                    if (hasLocalStorage) return localStorage.getItem(key);
                    return memory.get(key) ?? null;
                };

                const set = (key, value) => {
                    if (hasLocalStorage) localStorage.setItem(key, value);
                    else memory.set(key, value);
                };

                const remove = (key) => {
                    if (hasLocalStorage) localStorage.removeItem(key);
                    else memory.delete(key);
                };

                return { get, set, remove, hasLocalStorage };
            }

            function sleep(ms) {
                return new Promise((r) => setTimeout(r, ms));
            }

            function utf8ToBytes(str) {
                return new TextEncoder().encode(str);
            }

            function bytesToBase64(bytes) {
                let bin = '';
                for (const b of bytes) bin += String.fromCharCode(b);
                return btoa(bin);
            }

            function base64ToBytes(b64) {
                const bin = atob(b64);
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                return bytes;
            }

            async function deriveKey(passphrase, salt) {
                const baseKey = await crypto.subtle.importKey('raw', utf8ToBytes(passphrase), 'PBKDF2', false, ['deriveKey']);
                return crypto.subtle.deriveKey(
                    { name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' },
                    baseKey,
                    { name: 'AES-GCM', length: 256 },
                    false,
                    ['encrypt', 'decrypt']
                );
            }

            async function encryptWithPassphrase(passphrase, plaintext) {
                const salt = crypto.getRandomValues(new Uint8Array(16));
                const iv = crypto.getRandomValues(new Uint8Array(12));
                const key = await deriveKey(passphrase, salt);
                const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, utf8ToBytes(plaintext));
                return { v: 1, salt: bytesToBase64(salt), iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(ciphertext)) };
            }

            async function decryptWithPassphrase(passphrase, payload) {
                const salt = base64ToBytes(payload.salt);
                const iv = base64ToBytes(payload.iv);
                const ct = base64ToBytes(payload.ct);
                const key = await deriveKey(passphrase, salt);
                const plaintextBytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
                return new TextDecoder().decode(new Uint8Array(plaintextBytes));
            }

            function createAsyncQueue({ storage, key }) {
                let running = false;
                let inMemory = [];

                const load = () => {
                    try {
                        const raw = storage.get(key);
                        inMemory = raw ? JSON.parse(raw) : [];
                    } catch {
                        inMemory = [];
                    }
                };

                const persist = () => {
                    storage.set(key, JSON.stringify(inMemory));
                };

                const enqueue = (item) => {
                    inMemory.push(item);
                    persist();
                };

                const clear = () => {
                    inMemory = [];
                    persist();
                };

                const run = async (fn) => {
                    if (running) return;
                    running = true;
                    try {
                        while (inMemory.length) {
                            const next = inMemory[0];
                            await fn(next);
                            inMemory.shift();
                            persist();
                        }
                    } finally {
                        running = false;
                    }
                };

                load();
                return { enqueue, run, clear, get items() { return [...inMemory]; } };
            }

            function createRateLimiter({ minIntervalMs = 800 }) {
                let lastAt = 0;
                let chain = Promise.resolve();
                const wait = () => {
                    chain = chain.then(async () => {
                        const now = Date.now();
                        const diff = now - lastAt;
                        if (diff < minIntervalMs) await sleep(minIntervalMs - diff);
                        lastAt = Date.now();
                    });
                    return chain;
                };
                return { wait };
            }

            function createGitHubApi({ tokenProvider, limiter }) {
                async function request(url, init, attempt = 0, authAttempt = 0) {
                    await limiter.wait();
                    const token = await tokenProvider.getToken();
                    const headers = new Headers(init?.headers || {});
                    headers.set('Accept', 'application/vnd.github+json');
                    headers.set('X-GitHub-Api-Version', '2022-11-28');
                    headers.set('User-Agent', 'MinovaQuotation');
                    if (token) {
                        const t = String(token).trim();
                        const scheme = authAttempt === 0 ? (t.startsWith('github_pat_') ? 'Bearer' : 'token') : (t.startsWith('github_pat_') ? 'token' : 'Bearer');
                        headers.set('Authorization', `${scheme} ${t}`);
                    }
                    if (!headers.has('Content-Type') && init?.body) headers.set('Content-Type', 'application/json');

                    const res = await fetch(url, { ...init, headers });
                    if (res.status === 401 && token && authAttempt === 0) {
                        return request(url, init, attempt, authAttempt + 1);
                    }
                    const remaining = res.headers.get('x-ratelimit-remaining');
                    const reset = res.headers.get('x-ratelimit-reset');
                    const resetMs = reset ? Math.max(0, parseInt(reset, 10) * 1000 - Date.now()) : 0;

                    if (res.status === 429 || res.status === 500 || res.status === 502 || res.status === 503 || res.status === 504) {
                        if (attempt < 4) {
                            const retryAfter = res.headers.get('retry-after');
                            const backoff = retryAfter ? parseInt(retryAfter, 10) * 1000 : (2 ** attempt) * 800;
                            await sleep(backoff);
                            return request(url, init, attempt + 1, authAttempt);
                        }
                    }

                    const text = await res.text();
                    let data;
                    try {
                        data = text ? JSON.parse(text) : null;
                    } catch {
                        data = text;
                    }

                    if (res.status === 403) {
                        const msg = typeof data === 'string' ? data : data?.message;
                        const isRateLimited = typeof msg === 'string' && msg.toLowerCase().includes('rate limit exceeded');
                        if ((isRateLimited || remaining === '0') && resetMs > 0 && attempt < 2) {
                            await sleep(Math.min(resetMs, 5 * 60 * 1000));
                            return request(url, init, attempt + 1, authAttempt);
                        }
                    }

                    if (!res.ok) {
                        let docUrl = typeof data === 'object' && data ? data.documentation_url : '';
                        if (typeof docUrl === 'string') {
                            docUrl = docUrl.trim();
                            if (docUrl.endsWith(')')) docUrl = docUrl.slice(0, -1);
                        }
                        const baseMsg = typeof data === 'string' ? data : (data?.message ? String(data.message) : JSON.stringify(data));
                        const err = new Error(`GitHub API ${res.status}: ${baseMsg}${docUrl ? ` (${docUrl})` : ''}`);
                        err.status = res.status;
                        err.data = data;
                        err.rateLimit = { remaining, reset };
                        throw err;
                    }
                    return data;
                }

                return {
                    get: (path) => request(`https://api.github.com${path}`, { method: 'GET' }),
                    put: (path, body) => request(`https://api.github.com${path}`, { method: 'PUT', body: JSON.stringify(body) }),
                    post: (path, body) => request(`https://api.github.com${path}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
                    patch: (path, body) => request(`https://api.github.com${path}`, { method: 'PATCH', body: JSON.stringify(body) }),
                    fetchText: async (url, init) => {
                        await limiter.wait();
                        const token = await tokenProvider.getToken();
                        const headers = new Headers(init?.headers || {});
                        headers.set('Accept', 'application/vnd.github+json');
                        headers.set('X-GitHub-Api-Version', '2022-11-28');
                        headers.set('User-Agent', 'MinovaQuotation');
                        if (token) {
                            const t = String(token).trim();
                            const scheme = t.startsWith('github_pat_') ? 'Bearer' : 'token';
                            headers.set('Authorization', `${scheme} ${t}`);
                        }
                        if (!headers.has('Content-Type') && init?.body) headers.set('Content-Type', 'application/json');
                        const res = await fetch(url, { ...init, headers });
                        const text = await res.text();
                        if (!res.ok) {
                            const err = new Error(`GitHub API ${res.status}: ${text}`);
                            err.status = res.status;
                            err.data = text;
                            throw err;
                        }
                        return text;
                    }
                };
            }

            function encodeContentPath(path) {
                return String(path || '').split('/').map((s) => encodeURIComponent(s)).join('/');
            }

            function encodeRefPath(ref) {
                return String(ref || '').split('/').map((s) => encodeURIComponent(s)).join('/');
            }

            function toBase64Utf8(str) {
                return btoa(unescape(encodeURIComponent(str)));
            }

            function fromBase64Utf8(b64) {
                return decodeURIComponent(escape(atob(b64)));
            }

            function base64ToBytes(b64) {
                const bin = atob(b64);
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                return bytes;
            }

            function fromBase64Utf8Safe(b64) {
                const clean = String(b64 || '').replaceAll('\n', '');
                try {
                    return new TextDecoder().decode(base64ToBytes(clean));
                } catch {
                    return fromBase64Utf8(clean);
                }
            }

            function createRepoStore({ api }) {
                async function getFileViaGitDataApi({ owner, repo, path, branch }) {
                    const cleanPath = String(path || '').replace(/^\//, '');
                    const ref = await api.get(`/repos/${owner}/${repo}/git/ref/heads/${encodeRefPath(branch || '')}`);
                    const headSha = ref?.object?.sha;
                    if (!headSha) throw new Error('Unable to resolve branch head');

                    const headCommit = await api.get(`/repos/${owner}/${repo}/git/commits/${headSha}`);
                    const baseTreeSha = headCommit?.tree?.sha;
                    if (!baseTreeSha) throw new Error('Unable to resolve base tree');

                    const tree = await api.get(`/repos/${owner}/${repo}/git/trees/${baseTreeSha}?recursive=1`);
                    const items = Array.isArray(tree?.tree) ? tree.tree : [];
                    const hit = items.find((it) => String(it?.path || '') === cleanPath && String(it?.type || '') === 'blob');
                    const blobSha = hit?.sha;
                    if (!blobSha) throw new Error('Unable to resolve blob sha');

                    const blob = await api.get(`/repos/${owner}/${repo}/git/blobs/${blobSha}`);
                    const encoding = String(blob?.encoding || '');
                    const content = encoding === 'base64' ? fromBase64Utf8Safe(blob?.content || '') : String(blob?.content || '');
                    return { sha: blobSha, content };
                }

                async function getFile({ owner, repo, path, branch }) {
                    const cleanPath = String(path || '').replace(/^\//, '');
                    const ref = branch ? `?ref=${encodeURIComponent(branch)}` : '';
                    let data = null;
                    try {
                        data = await api.get(`/repos/${owner}/${repo}/contents/${encodeContentPath(cleanPath)}${ref}`);
                    } catch (e) {
                        if (e?.status === 403 && branch) return getFileViaGitDataApi({ owner, repo, path: cleanPath, branch });
                        throw e;
                    }
                    let content = '';
                    if (data?.content) {
                        content = fromBase64Utf8Safe(data.content);
                    } else if (data?.download_url && typeof api.fetchText === 'function') {
                        try { content = await api.fetchText(data.download_url, { method: 'GET' }); } catch (e) { content = ''; }
                    }
                    if (!content && branch) {
                        try { return await getFileViaGitDataApi({ owner, repo, path: cleanPath, branch }); } catch (e) {}
                    }
                    return { sha: data?.sha || null, content };
                }

                async function putFile({ owner, repo, path, branch, message, content, sha }) {
                    return api.put(`/repos/${owner}/${repo}/contents/${encodeContentPath(path)}`, {
                        message,
                        content: toBase64Utf8(content),
                        sha: sha || undefined,
                        branch: branch || undefined
                    });
                }

                async function upsertText({ owner, repo, path, branch, message, content }) {
                    let remote = { sha: null };
                    try {
                        remote = await getFile({ owner, repo, path, branch });
                    } catch (e) {
                        if (e?.status !== 404) throw e;
                    }

                    try {
                        return await putFile({ owner, repo, path, branch, message, content, sha: remote.sha });
                    } catch (e) {
                        if (e?.status === 409) {
                            const latest = await getFile({ owner, repo, path, branch });
                            return putFile({ owner, repo, path, branch, message: `${message} (retry)`, content, sha: latest.sha });
                        }
                        throw e;
                    }
                }

                async function commitTextFiles({ owner, repo, branch, message, files }) {
                    const list = Array.isArray(files) ? files.filter((f) => f?.path && (f.delete || f.content !== undefined)) : [];
                    if (!list.length) throw new Error('No files to commit');
                    if (!branch) throw new Error('Missing branch');

                    for (let attempt = 0; attempt < 3; attempt++) {
                        const ref = await api.get(`/repos/${owner}/${repo}/git/ref/heads/${encodeRefPath(branch)}`);
                        const headSha = ref?.object?.sha;
                        if (!headSha) throw new Error('Unable to resolve branch head');

                        const headCommit = await api.get(`/repos/${owner}/${repo}/git/commits/${headSha}`);
                        const baseTreeSha = headCommit?.tree?.sha;
                        if (!baseTreeSha) throw new Error('Unable to resolve base tree');

                        const treeItems = [];
                        for (const f of list) {
                            if (f.delete) {
                                treeItems.push({ path: String(f.path), mode: '100644', type: 'blob', sha: null });
                                continue;
                            }
                            const blob = await api.post(`/repos/${owner}/${repo}/git/blobs`, { content: String(f.content ?? ''), encoding: f.encoding || 'utf-8' });
                            treeItems.push({ path: String(f.path), mode: '100644', type: 'blob', sha: blob?.sha });
                        }

                        const tree = await api.post(`/repos/${owner}/${repo}/git/trees`, { base_tree: baseTreeSha, tree: treeItems });
                        const newTreeSha = tree?.sha;
                        if (!newTreeSha) throw new Error('Unable to create tree');

                        const commit = await api.post(`/repos/${owner}/${repo}/git/commits`, { message, tree: newTreeSha, parents: [headSha] });
                        const newCommitSha = commit?.sha;
                        if (!newCommitSha) throw new Error('Unable to create commit');

                        try {
                            await api.patch(`/repos/${owner}/${repo}/git/refs/heads/${encodeRefPath(branch)}`, { sha: newCommitSha, force: false });
                            return commit;
                        } catch (e) {
                            if (e?.status === 422 && attempt < 2) continue;
                            throw e;
                        }
                    }
                    throw new Error('Failed to update branch ref');
                }

                return { getFile, upsertText, commitTextFiles };
            }

            function nowIso() {
                return new Date().toISOString();
            }

            function uuid() {
                return crypto.randomUUID();
            }

            function safeJsonParse(raw, fallback) {
                try {
                    return raw ? JSON.parse(raw) : fallback;
                } catch {
                    return fallback;
                }
            }

            function el(tag, attrs, children) {
                const node = document.createElement(tag);
                for (const [k, v] of Object.entries(attrs || {})) {
                    if (k === 'class') node.className = v;
                    else if (k === 'text') node.textContent = v;
                    else node.setAttribute(k, v);
                }
                for (const c of children || []) node.append(c);
                return node;
            }

            function mountGitHubSyncUi({ sync }) {
                const root = document.getElementById('github-sync-root');
                if (!root) return;

                const defaults = { owner: 'QibbQi', repo: 'minova', branch: 'main', path: 'minova-data/state.json' };
                function ensureConfig() {
                    const cfg = sync.getStatus().config || {};
                    sync.saveConfig({
                        owner: cfg.owner || defaults.owner,
                        repo: cfg.repo || defaults.repo,
                        branch: cfg.branch || defaults.branch,
                        path: cfg.path || defaults.path
                    });
                }

                const state = () => sync.getStatus();

                const btnBaseClass = 'whitespace-nowrap text-[11px] px-2 py-1.5 rounded-lg font-bold border transition-colors';
                const btn = el('button', { title: 'GitHub 数据同步', class: `${btnBaseClass} bg-red-600 hover:bg-red-700 text-white border-red-700`, text: 'GH 未连' });

                root.innerHTML = '';
                const existing = document.getElementById('github-sync-modal');
                if (existing) existing.remove();

                const modal = el('div', { id: 'github-sync-modal', class: 'fixed inset-0 bg-slate-900/60 backdrop-blur-sm hidden items-center justify-center z-[300] p-4' });
                const card = el('div', { class: 'bg-white rounded-2xl p-6 w-full max-w-xl shadow-2xl max-h-[90vh] overflow-y-auto' });
                modal.append(card);

                const title = el('div', { class: 'text-lg font-black text-slate-800', text: 'GitHub 数据同步' });
                const tip = el('div', { class: 'text-xs text-slate-500 mt-1', text: '使用 PAT + 加密本地存储，将当前页面发布到 GitHub Pages（覆盖 index.html）。' });

                const form = el('div', { class: 'mt-5 grid grid-cols-1 gap-4' });
                const repoHint = el('div', { class: 'rounded-xl border border-slate-200 p-4 bg-slate-50 text-xs text-slate-600' });
                const passphrase = el('input', { class: 'w-full border border-slate-200 rounded-xl p-3 text-sm outline-none', placeholder: '本地加密口令（用于加密 PAT）', type: 'password' });
                const pat = el('input', { class: 'w-full border border-slate-200 rounded-xl p-3 text-sm outline-none', placeholder: '粘贴 GitHub PAT（fine-grained，限定 minova 仓库 Contents 读写）', type: 'password' });
                form.append(repoHint, passphrase, pat);

                const msg = el('div', { class: 'mt-3 text-xs text-slate-500 whitespace-pre-line' });
                let dotsTimer = null;
                const stopDots = () => {
                    if (!dotsTimer) return;
                    clearInterval(dotsTimer);
                    dotsTimer = null;
                };
                const startDots = (prefix) => {
                    stopDots();
                    let n = 0;
                    msg.textContent = `${prefix}...`;
                    dotsTimer = setInterval(() => {
                        n = (n + 1) % 4;
                        msg.textContent = `${prefix}${'.'.repeat(n)}`;
                    }, 350);
                };

                const footer = el('div', { class: 'mt-6 flex flex-wrap gap-3 justify-end' });
                const btnClose = el('button', { class: 'px-4 py-2 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50', text: '关闭' });
                const btnCheck = el('button', { class: 'px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold hover:bg-slate-200 border border-slate-200', text: '连接自检' });
                const btnConnectPat = el('button', { class: 'px-4 py-2 rounded-xl bg-slate-900 text-white font-bold hover:bg-black', text: '使用 PAT 连接' });
                const btnPublish = el('button', { class: 'px-4 py-2 rounded-xl bg-purple-700 text-white font-bold hover:bg-purple-800', text: '发布到 Pages' });
                const btnDisconnect = el('button', { class: 'px-4 py-2 rounded-xl bg-red-600 text-white font-bold hover:bg-red-700', text: '断开' });

                footer.append(btnConnectPat, btnPublish, btnCheck, btnDisconnect, btnClose);
                card.append(title, tip, form, msg, footer);

                function formatErr(e) {
                    const m = String(e?.message || e || '');
                    const reset = e?.rateLimit?.reset;
                    if (reset) {
                        const at = new Date(parseInt(reset, 10) * 1000).toLocaleString();
                        return `${m}\n预计恢复时间：${at}`;
                    }
                    return m;
                }

                const refresh = () => {
                    const s = state();
                    btn.textContent = s.connected
                        ? `GH 已连(${s.queueSize})`
                        : `GH 未连${s.hasTokenStored ? '·token' : ''}`;
                    btn.className = `${btnBaseClass} ${s.connected ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-700' : 'bg-red-600 hover:bg-red-700 text-white border-red-700'}`;
                    const restrictedTabs = ['quotation', 'costcalc', 'database', 'inventory', 'transport'];
                    for (const t of restrictedTabs) {
                        const tabBtn = document.getElementById(`tab-${t}`);
                        if (tabBtn) tabBtn.style.display = s.connected ? '' : 'none';
                    }
                    const pdfBtn = document.getElementById('btn-generate-pdf');
                    if (pdfBtn) pdfBtn.style.display = s.connected ? '' : 'none';
                    if (!s.connected) {
                        const activeRestricted = restrictedTabs.some(t => {
                            const view = document.getElementById(`view-${t}`);
                            return view && !view.classList.contains('hidden') && view.style.display !== 'none';
                        });
                        if (activeRestricted) {
                            try { window.switchTab?.('pvcalc'); } catch (e) {}
                        }
                    }
                    btnCheck.style.display = s.connected ? '' : 'none';
                    btnPublish.style.display = s.connected ? '' : 'none';
                    const cfg = s.config || {};
                    repoHint.textContent = `目标仓库：${cfg.owner || defaults.owner}/${cfg.repo || defaults.repo}（分支：${cfg.branch || defaults.branch}）`;
                };

                btn.onclick = () => {
                    modal.classList.remove('hidden');
                    modal.classList.add('flex');
                    refresh();
                };
                btnClose.onclick = () => {
                    modal.classList.add('hidden');
                    modal.classList.remove('flex');
                    stopDots();
                    msg.textContent = '';
                };
                modal.addEventListener('click', (e) => {
                    if (e.target === modal) btnClose.click();
                });

                btnDisconnect.onclick = async () => {
                    await sync.lock();
                    stopDots();
                    msg.textContent = '已断开（token 已从内存清除）';
                    refresh();
                };

                btnConnectPat.onclick = async () => {
                    if (!passphrase.value) { msg.textContent = '请填写加密口令'; return; }
                    const token = pat.value.trim();
                    if (!token) { msg.textContent = '请粘贴 PAT'; return; }
                    stopDots();
                    try {
                        ensureConfig();
                        await sync.storeToken(passphrase.value, token);
                        const s = await sync.selfCheck();
                        const reset = s?.rateLimit?.reset ? new Date(parseInt(s.rateLimit.reset, 10) * 1000).toLocaleString() : '-';
                        const pulled = typeof tryLoadPublishedState === 'function' ? await tryLoadPublishedState(true, true) : false;
                        msg.textContent = `已使用 PAT 连接：${s.login || '-'}\nRateLimit(Core)：${s.rateLimit.remaining}/${s.rateLimit.limit}，重置：${reset}${pulled ? '\n已同步线上数据到本地' : ''}`;
                        try {
                            await window.refreshSavedQuotesList?.();
                            const sel = document.getElementById('saved-quotes-select');
                            const cur = String(window.currentSavedQuoteId || '').trim();
                            if (sel && cur) sel.value = cur;
                        } catch (e) {}
                    } catch (e) {
                        if (e?.status === 401) {
                            try { await sync.lock(); } catch (e2) {}
                        }
                        msg.textContent = formatErr(e);
                    }
                    refresh();
                };

                btnCheck.onclick = async () => {
                    stopDots();
                    try {
                        const s = await sync.selfCheck();
                        const reset = s?.rateLimit?.reset ? new Date(parseInt(s.rateLimit.reset, 10) * 1000).toLocaleString() : '-';
                        msg.textContent = `已认证：${s.login || '-'}\nRateLimit(Core)：${s.rateLimit.remaining}/${s.rateLimit.limit}，重置：${reset}`;
                    } catch (e) {
                        if (e?.status === 401) {
                            try { await sync.lock(); } catch (e2) {}
                        }
                        msg.textContent = formatErr(e);
                    }
                    refresh();
                };

                btnPublish.onclick = async () => {
                    stopDots();
                    btnPublish.disabled = true;
                    btnPublish.classList.add('opacity-60');
                    try {
                        ensureConfig();
                        const html = window.buildUpdatedHtml?.();
                        if (!html) { msg.textContent = '生成 HTML 失败'; return; }
                        startDots('提交中，请稍等');
                        await sync.publishIndexHtml(html);
                        startDots('已提交，请稍等');
                        const expectedAt = (() => {
                            const m = html.match(/\x3Cscript id="minova-embedded-state" type="application\/json">([\s\S]*?)<\/script>/);
                            if (!m?.[1]) return 0;
                            try { return Date.parse(JSON.parse(m[1]).updatedAt || '') || 0; } catch { return 0; }
                        })();

                        const cfg = sync.getStatus().config || defaults;
                        const pagesUrl = `https://${String(cfg.owner || defaults.owner).toLowerCase()}.github.io/${cfg.repo || defaults.repo}/`;

                        const fetchDeployedAt = async () => {
                            const res = await fetch(`${pagesUrl}?v=${Date.now()}`, { cache: 'no-store' });
                            const text = await res.text();
                            const m = text.match(/\x3Cscript id="minova-embedded-state" type="application\/json">([\s\S]*?)<\/script>/);
                            if (!m?.[1]) return 0;
                            try { return Date.parse(JSON.parse(m[1]).updatedAt || '') || 0; } catch { return 0; }
                        };

                        let deployedOk = false;
                        if (expectedAt) {
                            for (let i = 0; i < 6; i++) {
                                await new Promise(r => setTimeout(r, 4000));
                                const deployedAt = await fetchDeployedAt();
                                if (deployedAt && deployedAt >= expectedAt) { deployedOk = true; break; }
                            }
                        }

                        stopDots();
                        if (deployedOk) {
                            msg.textContent = '已发布：index.html 已覆盖，Pages 已更新';
                        } else {
                            msg.textContent = '已发布：index.html 已覆盖；Pages 可能仍在构建/缓存中，稍后再刷新。如超过 2-3 分钟仍未更新，请到 GitHub Actions 手动运行 “Manual Redeploy Pages”。';
                        }
                    } catch (e) {
                        stopDots();
                        if (e?.status === 401) {
                            try { await sync.lock(); } catch (e2) {}
                        }
                        msg.textContent = formatErr(e);
                    } finally {
                        btnPublish.disabled = false;
                        btnPublish.classList.remove('opacity-60');
                    }
                    refresh();
                };

                root.append(el('div', { class: 'flex items-center' }, [btn]));
                document.body.append(modal);

                // 添加 cert-attachment-modal
                const certModal = el('div', { id: 'cert-attachment-modal', class: 'fixed inset-0 bg-slate-900/60 backdrop-blur-sm hidden items-center justify-center z-[300] p-4' });
                document.body.appendChild(certModal);

                // 注意：el() 函数的 onclick 是字符串，不会自动执行，需要手动绑定
                // certModal 的 innerHTML 通过直接设置字符串内容，其中的 onclick 会被浏览器解析

                certModal.innerHTML = `
<div class="bg-white rounded-3xl p-8 w-full max-w-xl shadow-2xl max-h-[90vh] overflow-y-auto">
    <h3 class="text-xl font-bold text-slate-800 mb-2">选择附上认证文件</h3>
    <p class="text-xs text-slate-400 mb-5">勾选本次报价需要附上的认证文件，将拼接在报价 PDF 后面一起交付</p>

    <!-- 附加页面选择 -->
    <div class="border border-slate-200 rounded-xl mb-4">
        <div class="flex items-center justify-between p-4 cursor-pointer" onclick="toggleCertSection('pages')">
            <span class="text-sm font-bold text-slate-700">【附加页面选择】</span>
            <span id="qa-pages-cert-count" class="text-xs text-slate-400">4 项</span>
            <span id="qa-pages-cert-arrow">▼</span>
        </div>
        <div id="qa-pages-cert-body" class="px-4 pb-4">
            <div class="flex justify-end gap-2 mb-2">
                <button onclick="toggleAllPages(true)" class="text-xs text-purple-600 hover:underline">全选</button>
                <button onclick="toggleAllPages(false)" class="text-xs text-slate-500 hover:underline">不选</button>
            </div>
            <div class="space-y-2">
                <label class="flex items-center gap-2 py-1">
                    <input type="checkbox" class="w-4 h-4 text-purple-600" disabled checked>
                    <span class="text-sm text-slate-400">1. 报价单 (Quotation) - 必选</span>
                </label>
                <label class="flex items-center gap-2 py-1 cursor-pointer">
                    <input type="checkbox" value="2" class="print-page-checkbox w-4 h-4 text-purple-600" checked onchange="updateCertSelectedSummary()">
                    <span class="text-sm text-slate-700">2. ROI / Financial Analysis</span>
                </label>
                <label class="flex items-center gap-2 py-1 cursor-pointer">
                    <input type="checkbox" value="3" class="print-page-checkbox w-4 h-4 text-purple-600" checked onchange="updateCertSelectedSummary()">
                    <span class="text-sm text-slate-700">3. Part Breakdown & Warranty</span>
                </label>
                <label class="flex items-center gap-2 py-1 cursor-pointer">
                    <input type="checkbox" value="4" class="print-page-checkbox w-4 h-4 text-purple-600" checked onchange="updateCertSelectedSummary()">
                    <span class="text-sm text-slate-700">4. Reference</span>
                </label>
                <label class="flex items-center gap-2 py-1 cursor-pointer">
                    <input type="checkbox" value="5" class="print-page-checkbox w-4 h-4 text-purple-600" checked onchange="updateCertSelectedSummary()">
                    <span class="text-sm text-slate-700">5. Site Overview</span>
                </label>
            </div>
        </div>
    </div>

    <!-- 公司级认证 -->
    <div class="border border-slate-200 rounded-xl mb-4">
        <div class="flex items-center justify-between p-4 cursor-pointer" onclick="toggleCertSection('company')">
            <span class="text-sm font-bold text-slate-700">【公司级认证】</span>
            <span id="qa-company-cert-count" class="text-xs text-slate-400">0 项</span>
            <span id="qa-company-cert-arrow">▶</span>
        </div>
        <div id="qa-company-cert-body" class="hidden px-4 pb-4">
            <div class="mb-3">
                <p class="text-xs font-bold text-slate-500 mb-2">工厂ISO认证</p>
                <div id="qa-iso-cert-checkboxes"></div>
            </div>
            <div>
                <p class="text-xs font-bold text-slate-500 mb-2">运输文件 (UN38.3/MSDS)</p>
                <div id="qa-transport-cert-checkboxes"></div>
            </div>
        </div>
    </div>

    <!-- 产品级认证 -->
    <div class="border border-slate-200 rounded-xl mb-4">
        <div class="flex items-center justify-between p-4 cursor-pointer" onclick="toggleCertSection('product')">
            <span class="text-sm font-bold text-slate-700">【产品级认证】</span>
            <span id="qa-product-cert-count" class="text-xs text-slate-400">0 项</span>
            <span id="qa-product-cert-arrow">▶</span>
        </div>
        <div id="qa-product-cert-body" class="hidden px-4 pb-4">
            <div id="qa-product-cert-list"></div>
            <p id="qa-product-cert-empty" class="text-xs text-slate-400 hidden">报价单中暂无有认证文件的产品</p>
        </div>
    </div>

    <!-- 底部按钮 -->
    <div class="flex justify-between items-center mt-4">
        <span id="qa-cert-selected-summary" class="text-xs text-slate-500">已选 0 个文件</span>
        <div class="flex gap-3">
            <button onclick="closeCertAttachmentModal()" class="px-4 py-2 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50">取消</button>
            <button onclick="confirmAndGeneratePDF()" class="px-4 py-2 rounded-xl bg-purple-700 text-white font-bold hover:bg-purple-800">生成 PDF</button>
        </div>
    </div>
</div>
`;

                ensureConfig();
                refresh();
            }

            return function initGitHubSync({ getLocalState, applyRemoteState }) {
                const storage = createStorage();
                const limiter = createRateLimiter({ minIntervalMs: 800 });

                let unlockedToken = null;
                let config = safeJsonParse(storage.get(KEY.config), {
                    owner: 'QibbQi',
                    repo: 'minova',
                    branch: 'main',
                    path: 'minova-data/state.json'
                });

                const audit = safeJsonParse(storage.get(KEY.audit), []);
                const queue = createAsyncQueue({ storage, key: KEY.queue });

                const tokenProvider = { async getToken() { return unlockedToken; } };
                const api = createGitHubApi({ tokenProvider, limiter });
                const repo = createRepoStore({ api });

                function appendAudit(action, detail) {
                    audit.unshift({ id: uuid(), at: nowIso(), action, detail });
                    storage.set(KEY.audit, JSON.stringify(audit.slice(0, 2000)));
                }

                function saveConfig(next) {
                    config = { ...config, ...next };
                    storage.set(KEY.config, JSON.stringify(config));
                }

                async function lock() {
                    unlockedToken = null;
                    appendAudit('lock', 'token cleared from memory');
                }

                async function storeToken(passphrase, token) {
                    const cleaned = String(token || '').trim();
                    const payload = await encryptWithPassphrase(passphrase, cleaned);
                    storage.set(KEY.token, JSON.stringify(payload));
                    unlockedToken = cleaned;
                    appendAudit('store_token', 'token stored (encrypted)');
                }

                async function selfCheck() {
                    if (!unlockedToken) throw new Error('Not connected');
                    let login = '';
                    try {
                        const user = await api.get('/user');
                        login = user?.login || '';
                    } catch (e) {}
                    const cfg = config || {};
                    try {
                        const repoInfo = await api.get(`/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`);
                        if (!login) login = repoInfo?.full_name || '';
                    } catch (e) {}
                    const rate = await api.get('/rate_limit');
                    const core = rate?.resources?.core || {};
                    return { login, rateLimit: { remaining: core.remaining, limit: core.limit, reset: core.reset } };
                }

                async function publishIndexHtml(html) {
                    if (!unlockedToken) throw new Error('Not connected');
                    const { owner, repo: repoName, branch } = config;
                    const m = html.match(/\x3Cscript id="minova-embedded-state" type="application\/json">([\s\S]*?)<\/script>/);
                    const raw = m?.[1] ? m[1] : '';
                    let stateJson = '';
                    if (raw) {
                        stateJson = raw;
                        try { stateJson = JSON.stringify(JSON.parse(raw), null, 2); } catch (e) {}
                    }
                    const files = [{ path: 'index.html', content: html }];
                    if (stateJson) files.push({ path: 'minova-data/state.json', content: stateJson });
                    await repo.commitTextFiles({
                        owner,
                        repo: repoName,
                        branch,
                        message: `minova: publish pages files (${new Date().toLocaleString()})`,
                        files
                    });
                    appendAudit('publish', `${owner}/${repoName}:${files.map((f) => f.path).join(',')}`);
                }

                function getStatus() {
                    return { connected: !!unlockedToken, config, queueSize: queue.items.length, hasTokenStored: !!storage.get(KEY.token) };
                }

                const sync = { storage, getStatus, saveConfig, lock, storeToken, selfCheck, publishIndexHtml, repo, config };
                mountGitHubSyncUi({ sync });
                return sync;
            };
        })();

        // --- 数据持久化 ---
        let products = [];
        let inventory = [];
        let inventoryHistory = [];
        let salesRecords = [];
        let historicalInventory = [];
        let companyCerts = { isoCerts: [], transportCerts: [] };
        let transportRecords = [];
        let fileDeleteLogs = [];
        let inventorySummaryMode = false;
        let inventoryFullHeadHtml = '';
        let selectedInventoryForTransport = new Set();
        let selectedInventoryForTransportPicker = new Set();
        let selectedTransportRecords = new Set();
        let inventoryHistoryPage = 1;
        let subcategoriesByCategory = {};
        let profitSettings = null;
        let profitTarget = 'home';
        let installerProfitSettings = { cnPct: 0, myPct: 0 };
        function safeJsonParseLoose(raw, fallback) {
            try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
        }
        function normalizeInstallerProfitSettings(next) {
            const base = next && typeof next === 'object' ? next : {};
            const cnPct = Number.isFinite(parseFloat(base.cnPct)) ? parseFloat(base.cnPct) : 0;
            const myPct = Number.isFinite(parseFloat(base.myPct)) ? parseFloat(base.myPct) : 0;
            return { cnPct, myPct };
        }
        function normalizeProfitSettings(next) {
            const base = next && typeof next === 'object' ? next : {};
            const companies = Array.isArray(base.companies) ? base.companies.filter(c => c && c.id && c.name) : [];
            const seeded = companies.length ? companies : [
                { id: 'cn_parent', name: '中国母公司', locked: true },
                { id: 'my_sub', name: '马来西亚子公司' }
            ];
            const settings = {
                v: 1,
                companies: seeded.map(c => ({ id: String(c.id), name: String(c.name), locked: !!c.locked })),
                enabled: (base.enabled && typeof base.enabled === 'object') ? base.enabled : {},
                categoryProfitPct: (base.categoryProfitPct && typeof base.categoryProfitPct === 'object') ? base.categoryProfitPct : {},
                subcatProfitPct: (base.subcatProfitPct && typeof base.subcatProfitPct === 'object') ? base.subcatProfitPct : {}
            };
            for (const c of settings.companies) {
                if (!settings.categoryProfitPct[c.id]) settings.categoryProfitPct[c.id] = { home: {}, biz: {} };
                if (!settings.categoryProfitPct[c.id].home) settings.categoryProfitPct[c.id].home = {};
                if (!settings.categoryProfitPct[c.id].biz) settings.categoryProfitPct[c.id].biz = {};
                if (!settings.subcatProfitPct[c.id]) settings.subcatProfitPct[c.id] = { home: {}, biz: {} };
                if (!settings.subcatProfitPct[c.id].home) settings.subcatProfitPct[c.id].home = {};
                if (!settings.subcatProfitPct[c.id].biz) settings.subcatProfitPct[c.id].biz = {};
            }
            return settings;
        }
        function ensureProfitSettingsCoverage() {
            if (!profitSettings) profitSettings = normalizeProfitSettings(null);
            const cats = Object.keys(subcategoriesByCategory || {}).sort((a, b) => String(a).localeCompare(String(b)));
            for (const cat of cats) {
                const subs = Array.isArray(subcategoriesByCategory?.[cat]) ? subcategoriesByCategory[cat] : [];
                if (!profitSettings.enabled[cat]) profitSettings.enabled[cat] = {};
                for (const sub of subs) {
                    if (profitSettings.enabled[cat][sub] === undefined) profitSettings.enabled[cat][sub] = true;
                }
            }
        }
        function getProfitPct(companyId, target, category, subcategory) {
            const cid = String(companyId || '');
            const t = target === 'biz' ? 'biz' : 'home';
            const cat = String(category || '').trim();
            const sub = String(subcategory || '').trim();
            const byCompany = profitSettings?.subcatProfitPct?.[cid]?.[t]?.[cat];
            const override = byCompany && Object.prototype.hasOwnProperty.call(byCompany, sub) ? byCompany[sub] : null;
            const ov = Number.isFinite(parseFloat(override)) ? parseFloat(override) : null;
            if (ov !== null) return ov;
            const def = profitSettings?.categoryProfitPct?.[cid]?.[t]?.[cat];
            const dv = Number.isFinite(parseFloat(def)) ? parseFloat(def) : null;
            return dv !== null ? dv : 0;
        }
        function persistProfitSettings(reason = 'profit settings update') {
            try { localStorage.setItem('minova_profit_settings_v1', JSON.stringify(profitSettings)); } catch (e) {}
            try { if (!suppressGitHubSync) window.__minovaSync?.enqueueSnapshot(reason); } catch (e) {}
        }
        window.setProfitTarget = (target) => {
            profitTarget = target === 'biz' ? 'biz' : 'home';
            renderProfitSettingsUI();
        };
        window.addProfitCompany = () => {
            const input = document.getElementById('profit-new-company-name');
            const name = String(input?.value || '').trim();
            if (!name) return alert('请输入子公司名称');
            if (!profitSettings) profitSettings = normalizeProfitSettings(null);
            const id = `co_${Date.now()}`;
            profitSettings.companies.push({ id, name });
            profitSettings.categoryProfitPct[id] = { home: {}, biz: {} };
            profitSettings.subcatProfitPct[id] = { home: {}, biz: {} };
            if (input) input.value = '';
            ensureProfitSettingsCoverage();
            persistProfitSettings();
            renderProfitSettingsUI();
        };
        window.deleteProfitCompany = (companyId) => {
            if (!profitSettings) return;
            const c = profitSettings.companies.find(x => x.id === companyId);
            if (!c || c.locked) return;
            if (!confirm(`确定删除公司主体：${c.name}？`)) return;
            profitSettings.companies = profitSettings.companies.filter(x => x.id !== companyId);
            delete profitSettings.categoryProfitPct[companyId];
            delete profitSettings.subcatProfitPct[companyId];
            persistProfitSettings();
            renderProfitSettingsUI();
        };
        window.updateProfitCategoryPct = (companyId, target, category, raw) => {
            if (!profitSettings) profitSettings = normalizeProfitSettings(null);
            const cid = String(companyId || '');
            const t = target === 'biz' ? 'biz' : 'home';
            const cat = String(category || '').trim();
            const vRaw = String(raw ?? '').trim();
            const v = vRaw === '' ? null : (Number.isFinite(parseFloat(vRaw)) ? parseFloat(vRaw) : null);
            if (!profitSettings.categoryProfitPct[cid]) profitSettings.categoryProfitPct[cid] = { home: {}, biz: {} };
            if (!profitSettings.categoryProfitPct[cid][t]) profitSettings.categoryProfitPct[cid][t] = {};
            if (v === null) delete profitSettings.categoryProfitPct[cid][t][cat];
            else profitSettings.categoryProfitPct[cid][t][cat] = v;
            persistProfitSettings();
            renderProfitSettingsUI();
        };
        window.updateProfitSubcatPct = (companyId, target, category, subcategory, raw) => {
            if (!profitSettings) profitSettings = normalizeProfitSettings(null);
            const cid = String(companyId || '');
            const t = target === 'biz' ? 'biz' : 'home';
            const cat = String(category || '').trim();
            const sub = String(subcategory || '').trim();
            const vRaw = String(raw ?? '').trim();
            const v = vRaw === '' ? null : (Number.isFinite(parseFloat(vRaw)) ? parseFloat(vRaw) : null);
            if (!profitSettings.subcatProfitPct[cid]) profitSettings.subcatProfitPct[cid] = { home: {}, biz: {} };
            if (!profitSettings.subcatProfitPct[cid][t]) profitSettings.subcatProfitPct[cid][t] = {};
            if (!profitSettings.subcatProfitPct[cid][t][cat]) profitSettings.subcatProfitPct[cid][t][cat] = {};
            if (v === null) delete profitSettings.subcatProfitPct[cid][t][cat][sub];
            else profitSettings.subcatProfitPct[cid][t][cat][sub] = v;
            persistProfitSettings();
            renderProfitSettingsUI();
        };
        window.toggleProfitSubcatEnabled = (category, subcategory, checked) => {
            if (!profitSettings) profitSettings = normalizeProfitSettings(null);
            const cat = String(category || '').trim();
            const sub = String(subcategory || '').trim();
            if (!profitSettings.enabled[cat]) profitSettings.enabled[cat] = {};
            profitSettings.enabled[cat][sub] = !!checked;
            persistProfitSettings();
            renderProfitSettingsUI();
        };
        function updateProfitTargetButtons() {
            const btnHome = document.getElementById('btn-profit-target-home');
            const btnBiz = document.getElementById('btn-profit-target-biz');
            const activeClass = 'px-4 py-2 rounded-xl text-xs font-black border border-purple-200 bg-purple-700 text-white';
            const idleClass = 'px-4 py-2 rounded-xl text-xs font-black border border-slate-200 bg-white text-slate-700 hover:bg-slate-50';
            if (btnHome) btnHome.className = profitTarget === 'home' ? activeClass : idleClass;
            if (btnBiz) btnBiz.className = profitTarget === 'biz' ? activeClass : idleClass;
        }
        window.renderProfitSettingsUI = () => {
            const head = document.getElementById('profit-settings-head');
            const body = document.getElementById('profit-settings-body');
            const outHead = document.getElementById('profit-output-head');
            const outBody = document.getElementById('profit-output-body');
            const chips = document.getElementById('profit-company-chips');
            if (!head || !body || !outHead || !outBody || !chips) return;
            if (!profitSettings) {
                const stored = safeJsonParseLoose(localStorage.getItem('minova_profit_settings_v1'), null);
                profitSettings = normalizeProfitSettings(stored);
            } else {
                profitSettings = normalizeProfitSettings(profitSettings);
            }
            ensureProfitSettingsCoverage();
            updateProfitTargetButtons();

            chips.innerHTML = profitSettings.companies.map(c => {
                const del = c.locked ? '' : `<button onclick="deleteProfitCompany('${c.id}')" class="ml-2 text-slate-400 hover:text-red-600">×</button>`;
                return `<span class="inline-flex items-center px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700">${c.name}${del}</span>`;
            }).join('');

            head.innerHTML = [
                `<th class="py-3 px-4">类目</th>`,
                `<th class="py-3 px-4">子类目</th>`,
                `<th class="py-3 px-4 text-center">启用</th>`,
                ...profitSettings.companies.map(c => `<th class="py-3 px-4 text-right">${c.name} 利润%</th>`)
            ].join('');

            const cats = Object.keys(subcategoriesByCategory || {}).sort((a, b) => String(a).localeCompare(String(b)));
            const rows = [];
            for (const cat of cats) {
                const catLabel = String(cat || '').trim() || '-';
                const subs = (Array.isArray(subcategoriesByCategory?.[cat]) ? subcategoriesByCategory[cat] : []).filter(Boolean).sort((a, b) => String(a).localeCompare(String(b)));
                rows.push({ type: 'category', category: catLabel });
                for (const sub of subs) rows.push({ type: 'subcat', category: catLabel, subcategory: String(sub) });
            }

            body.innerHTML = rows.map(r => {
                if (r.type === 'category') {
                    const cat = r.category;
                    return `
                        <tr class="bg-slate-50/50">
                            <td class="py-3 px-4 font-bold text-slate-700">${cat}</td>
                            <td class="py-3 px-4 text-xs text-slate-400">（类目默认）</td>
                            <td class="py-3 px-4 text-center text-slate-300">-</td>
                            ${profitSettings.companies.map(c => {
                                const v = profitSettings.categoryProfitPct?.[c.id]?.[profitTarget]?.[cat];
                                const val = Number.isFinite(parseFloat(v)) ? String(parseFloat(v)) : '';
                                return `<td class="py-3 px-4 text-right"><input type="number" step="1" value="${val}" placeholder="0" oninput="updateProfitCategoryPct('${c.id}', '${profitTarget}', '${cat}', this.value)" class="w-20 text-right bg-transparent border-b border-dashed border-slate-300 outline-none font-bold text-slate-700"></td>`;
                            }).join('')}
                        </tr>
                    `;
                }
                const cat = r.category;
                const sub = r.subcategory;
                const enabled = profitSettings.enabled?.[cat]?.[sub] !== false;
                return `
                    <tr class="hover:bg-slate-50 transition-colors">
                        <td class="py-3 px-4 text-xs text-slate-500">${cat}</td>
                        <td class="py-3 px-4 font-medium text-slate-700">${sub}</td>
                        <td class="py-3 px-4 text-center">
                            <input type="checkbox" ${enabled ? 'checked' : ''} onchange="toggleProfitSubcatEnabled('${cat}', '${sub}', this.checked)" class="h-4 w-4 accent-purple-600">
                        </td>
                        ${profitSettings.companies.map(c => {
                            const v = profitSettings.subcatProfitPct?.[c.id]?.[profitTarget]?.[cat]?.[sub];
                            const val = Number.isFinite(parseFloat(v)) ? String(parseFloat(v)) : '';
                            return `<td class="py-3 px-4 text-right"><input type="number" step="1" value="${val}" placeholder="继承" oninput="updateProfitSubcatPct('${c.id}', '${profitTarget}', '${cat}', '${sub}', this.value)" class="w-20 text-right bg-transparent border-b border-dashed border-slate-300 outline-none text-blue-700 font-bold"></td>`;
                        }).join('')}
                    </tr>
                `;
            }).join('');

            outHead.innerHTML = [
                `<th class="py-3 px-4">类目</th>`,
                `<th class="py-3 px-4">子类目</th>`,
                ...profitSettings.companies.flatMap(c => [
                    `<th class="py-3 px-4 text-right">${c.name}子类目利润（家用）%</th>`,
                    `<th class="py-3 px-4 text-right">${c.name}子类目利润（工商业）%</th>`
                ])
            ].join('');

            const outRows = [];
            for (const cat of cats) {
                const subs = (Array.isArray(subcategoriesByCategory?.[cat]) ? subcategoriesByCategory[cat] : []).filter(Boolean).sort((a, b) => String(a).localeCompare(String(b)));
                for (const sub of subs) {
                    const enabled = profitSettings.enabled?.[cat]?.[sub] !== false;
                    if (!enabled) continue;
                    outRows.push({ category: cat, subcategory: sub });
                }
            }

            outBody.innerHTML = outRows.map(r => {
                return `
                    <tr class="hover:bg-slate-50 transition-colors">
                        <td class="py-3 px-4 text-xs text-slate-500">${r.category}</td>
                        <td class="py-3 px-4 font-medium text-slate-700">${r.subcategory}</td>
                        ${profitSettings.companies.flatMap(c => {
                            const home = getProfitPct(c.id, 'home', r.category, r.subcategory);
                            const biz = getProfitPct(c.id, 'biz', r.category, r.subcategory);
                            return [
                                `<td class="py-3 px-4 text-right font-mono text-slate-700">${home.toFixed(2)}%</td>`,
                                `<td class="py-3 px-4 text-right font-mono text-slate-700">${biz.toFixed(2)}%</td>`
                            ];
                        }).join('')}
                    </tr>
                `;
            }).join('');
        };
        try {
            const el = document.getElementById('minova-embedded-state');
            const raw = el?.textContent ? el.textContent.trim() : '';
            if (raw) {
                const embedded = JSON.parse(raw);
                const embeddedAt = embedded?.updatedAt ? Date.parse(embedded.updatedAt) : 0;
                if (embedded?.data) {
                    products = Array.isArray(embedded.data.products) ? embedded.data.products : [];
                    inventory = Array.isArray(embedded.data.inventory) ? embedded.data.inventory : [];
                    inventoryHistory = Array.isArray(embedded.data.inventoryHistory) ? embedded.data.inventoryHistory : [];
                    if (inventoryHistory.length > 1000) inventoryHistory = inventoryHistory.slice(inventoryHistory.length - 1000);
                    salesRecords = Array.isArray(embedded.data.salesRecords) ? embedded.data.salesRecords : [];
                    historicalInventory = Array.isArray(embedded.data.historicalInventory) ? embedded.data.historicalInventory : [];
                    subcategoriesByCategory = embedded.data.subcategoriesByCategory && typeof embedded.data.subcategoriesByCategory === 'object' ? embedded.data.subcategoriesByCategory : {};
                    profitSettings = normalizeProfitSettings(embedded.data.profitSettings || null);
                    installerProfitSettings = normalizeInstallerProfitSettings(embedded.data.installerProfitSettings || installerProfitSettings || null);
                    try {
                        if (embeddedAt) localStorage.setItem('minova_embedded_updatedAt', String(embeddedAt));
                        localStorage.setItem('minova_products', JSON.stringify(products));
                        localStorage.setItem('minova_inventory', JSON.stringify(inventory));
                        localStorage.setItem('minova_inventory_history', JSON.stringify(inventoryHistory));
                        localStorage.setItem('minova_sales_records_v1', JSON.stringify(salesRecords));
                        localStorage.setItem('minova_historical_inventory_v1', JSON.stringify(historicalInventory));
                        localStorage.setItem('minova_subcategories_v1', JSON.stringify(subcategoriesByCategory));
                        localStorage.setItem('minova_profit_settings_v1', JSON.stringify(profitSettings));
                        localStorage.setItem('minova_installer_profit_v1', JSON.stringify(installerProfitSettings));
                    } catch (e) {}
                    companyCerts = embedded.data.companyCerts && typeof embedded.data.companyCerts === 'object' ? embedded.data.companyCerts : companyCerts;
                    transportRecords = Array.isArray(embedded.data.transportRecords) ? embedded.data.transportRecords : [];
                    fileDeleteLogs = Array.isArray(embedded.data.fileDeleteLogs) ? embedded.data.fileDeleteLogs : [];
                }
            }
        } catch (e) {}
        // Only load from localStorage if embedded didn't provide companyCerts
        if (!companyCerts.isoCerts.length && !companyCerts.transportCerts.length) {
            const savedCerts = localStorage.getItem('minova_company_certs');
            if (savedCerts) {
                try { companyCerts = JSON.parse(savedCerts); } catch (e) { console.warn('Failed to parse companyCerts from localStorage:', e); }
            }
        }
        try {
            const raw = localStorage.getItem('minova_transport_records_v1');
            if (raw) transportRecords = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : transportRecords;
        } catch (e) {}
        try {
            const raw = localStorage.getItem('minova_file_delete_logs_v1');
            if (raw) fileDeleteLogs = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : fileDeleteLogs;
        } catch (e) {}
        function rebuildSubcategoryIndexFromProducts() {
            const map = {};
            products.forEach(p => {
                const cat = (p.category || '').trim() || '未分类';
                const sub = (p.scenario || '').trim();
                if (!map[cat]) map[cat] = [];
                if (sub && !map[cat].includes(sub)) map[cat].push(sub);
            });
            subcategoriesByCategory = map;
        }
        function saveSubcategoryIndex() {
            try { localStorage.setItem('minova_subcategories_v1', JSON.stringify(subcategoriesByCategory)); } catch (e) {}
        }
        function loadSubcategoryIndex() {
            try {
                const raw = localStorage.getItem('minova_subcategories_v1');
                if (raw) {
                    subcategoriesByCategory = JSON.parse(raw) || {};
                    return;
                }
            } catch (e) {}
            rebuildSubcategoryIndexFromProducts();
            saveSubcategoryIndex();
        }
        window.updateSubcatSuggestions = () => {
            const list = document.getElementById('subcat-suggestions');
            const catEl = document.getElementById('m-category');
            if (!list) return;
            const cat = (catEl?.value || '').trim();
            const subs = cat
                ? (subcategoriesByCategory[cat] || [])
                : Array.from(new Set(Object.values(subcategoriesByCategory).flat()));
            list.innerHTML = subs.filter(Boolean).sort((a, b) => String(a).localeCompare(String(b))).map(s => `<option value="${String(s).replaceAll('"', '&quot;')}">`).join('');
        };

        loadSubcategoryIndex();

        let suppressGitHubSync = false;
        let lastPublishedStateAt = 0;
        let publishedStatePollingStarted = false;
        function applyInstallerProfitSettingsToUi() {
            const cnEl = document.getElementById('installer-profit-cn');
            const myEl = document.getElementById('installer-profit-my');
            if (cnEl) cnEl.value = String(Number.isFinite(parseFloat(installerProfitSettings?.cnPct)) ? parseFloat(installerProfitSettings.cnPct) : 0);
            if (myEl) myEl.value = String(Number.isFinite(parseFloat(installerProfitSettings?.myPct)) ? parseFloat(installerProfitSettings.myPct) : 0);
        }
        function applyStateFromData(data, stampMs = 0) {
            suppressGitHubSync = true;
            products = Array.isArray(data?.products) ? data.products : [];
            inventory = Array.isArray(data?.inventory) ? data.inventory : [];
            inventoryHistory = Array.isArray(data?.inventoryHistory) ? data.inventoryHistory : [];
            if (inventoryHistory.length > 1000) inventoryHistory = inventoryHistory.slice(inventoryHistory.length - 1000);
            salesRecords = Array.isArray(data?.salesRecords) ? data.salesRecords : [];
            historicalInventory = Array.isArray(data?.historicalInventory) ? data.historicalInventory : [];
            subcategoriesByCategory = data?.subcategoriesByCategory && typeof data.subcategoriesByCategory === 'object' ? data.subcategoriesByCategory : {};
            profitSettings = normalizeProfitSettings(data?.profitSettings || profitSettings || null);
            installerProfitSettings = normalizeInstallerProfitSettings(data?.installerProfitSettings || installerProfitSettings || null);
            try {
                if (stampMs) localStorage.setItem('minova_embedded_updatedAt', String(stampMs));
                localStorage.setItem('minova_products', JSON.stringify(products));
                localStorage.setItem('minova_inventory', JSON.stringify(inventory));
                localStorage.setItem('minova_inventory_history', JSON.stringify(inventoryHistory));
                localStorage.setItem('minova_sales_records_v1', JSON.stringify(salesRecords));
                localStorage.setItem('minova_historical_inventory_v1', JSON.stringify(historicalInventory));
                localStorage.setItem('minova_subcategories_v1', JSON.stringify(subcategoriesByCategory));
                localStorage.setItem('minova_profit_settings_v1', JSON.stringify(profitSettings));
                localStorage.setItem('minova_installer_profit_v1', JSON.stringify(installerProfitSettings));
            } catch (e) {}
            // companyCerts 也从 applyStateFromData 恢复（保持同步）
            if (data.companyCerts && typeof data.companyCerts === 'object') {
                companyCerts = data.companyCerts;
                try { localStorage.setItem('minova_company_certs', JSON.stringify(companyCerts)); } catch (e) {}
            }
            if (Array.isArray(data.transportRecords)) {
                transportRecords = data.transportRecords;
                try { localStorage.setItem('minova_transport_records_v1', JSON.stringify(transportRecords)); } catch (e) {}
            }
            if (Array.isArray(data.fileDeleteLogs)) {
                fileDeleteLogs = data.fileDeleteLogs;
                try { localStorage.setItem('minova_file_delete_logs_v1', JSON.stringify(fileDeleteLogs)); } catch (e) {}
            }
            renderDb();
            renderInventory();
            renderTransport();
            renderSalesRecords();
            renderHistoricalInventory();
            renderInventoryHistory();
            updatePickerFilters();
            renderPicker();
            updateDatalists();
            renderProfitSettingsUI();
            applyInstallerProfitSettingsToUi();
            renderCostCalcUI();
            suppressGitHubSync = false;
        }

        async function tryLoadPublishedState(force = false, allowWhenConnected = false) {
            try {
                const isConnected = !!window.__minovaSync?.getStatus?.()?.connected;
                if (isConnected && !allowWhenConnected) return false;
                const url = new URL('minova-data/state.json', window.location.href);
                url.searchParams.set('v', String(Date.now()));
                const res = await fetch(url.toString(), { cache: 'no-store' });
                if (!res.ok) return false;
                const snap = await res.json();
                const at = snap?.updatedAt ? Date.parse(snap.updatedAt) : 0;
                if (!snap?.data) return false;
                if (force || !at || at > lastPublishedStateAt) {
                    if (at) lastPublishedStateAt = at;
                    applyStateFromData(snap.data, at);
                    return true;
                }
                return false;
            } catch (e) {
                return false;
            }
        }
        function startPublishedStatePolling() {
            if (publishedStatePollingStarted) return;
            publishedStatePollingStarted = true;

            const poll = () => {
                if (document.visibilityState !== 'visible') return;
                tryLoadPublishedState(false, false);
            };
            const forceSync = () => {
                if (document.visibilityState !== 'visible') return;
                tryLoadPublishedState(true, false);
            };
            setInterval(poll, 5000);
            document.addEventListener('visibilitychange', forceSync);
            window.addEventListener('focus', forceSync);
        }

        function saveToLocal() {
            localStorage.setItem('minova_products', JSON.stringify(products));
            localStorage.setItem('minova_inventory', JSON.stringify(inventory));
            localStorage.setItem('minova_inventory_history', JSON.stringify(inventoryHistory));
            localStorage.setItem('minova_sales_records_v1', JSON.stringify(salesRecords));
            localStorage.setItem('minova_historical_inventory_v1', JSON.stringify(historicalInventory));
            localStorage.setItem('minova_company_certs', JSON.stringify(companyCerts));
            try { localStorage.setItem('minova_transport_records_v1', JSON.stringify(transportRecords)); } catch (e) {}
            try { localStorage.setItem('minova_file_delete_logs_v1', JSON.stringify(fileDeleteLogs)); } catch (e) {}
            rebuildSubcategoryIndexFromProducts();
            saveSubcategoryIndex();
            ensureProfitSettingsCoverage();
            try { localStorage.setItem('minova_profit_settings_v1', JSON.stringify(profitSettings)); } catch (e) {}
            renderDb();
            renderInventory();
            renderTransport();
            renderSalesRecords();
            renderHistoricalInventory();
            renderInventoryHistory();
            updatePickerFilters();
            renderPicker();
            updateDatalists();
            renderProfitSettingsUI();
            try { if (!suppressGitHubSync) window.__minovaSync?.enqueueSnapshot('state update'); } catch (e) {}
        }

        let quoteRows = [{ id: Date.now(), description: '', vendor: '', spec: '', batchNo: '', quantity: 1, price: 0, cost: 0, productId: '', inventoryId: '' }];
        let dbGroupMode = 'category';
        let currentLang = 'zh';
        let currentCurrency = 'CNY';
        let paymentTermsConfirmed = true;
        let quoteSplit = { enabled: false, afterRowId: null };
        let validityDays = 30;
        window.__getQuoteRows = () => quoteRows;
        window.__setQuoteRows = (rows) => {
            quoteRows = Array.isArray(rows) ? rows : [];
            window.quoteRows = quoteRows;
        };
        window.__getValidityDays = () => validityDays;
        window.__setValidityDays = (n) => {
            const v = parseInt(n, 10);
            if (Number.isInteger(v) && v >= 1 && v <= 999) validityDays = v;
            renderValidityBadge();
        };
        const apiKey = ""; 
        try {
            const savedSplit = localStorage.getItem('minova_quote_split');
            if (savedSplit) {
                const parsed = JSON.parse(savedSplit);
                quoteSplit = { enabled: !!parsed.enabled, afterRowId: parsed.afterRowId ?? null };
            }
        } catch (e) {}

        const i18n = {
            zh: {
                title: "报价单", toCustomer: "致客户：", quoteNo: "单据编号:", quoteDate: "报价日期:",
                thDesc: "产品", thVendor: "品牌", thSpec: "规格型号", thBatch: "采购批次", thQty: "数量", thPrice: "单价", thMargin: "毛利%", thAmount: "小计",
                terms: "备注与条款：", totalItems: "项目总数", avgMargin: "平均毛利率", grandTotal: "应付总额",
                authSign: "批准人签名", signDate: "日期",
                termPlaceholder: "1. 报价有效期自即日起30天。\n2. 款项请汇至：XX银行 XXXX...",
                timeline: "预计时间表",
                step1: "现场勘测",
                step2: "材料采购与安装规划",
                step3: "安装",
                paymentTerms: "支付条款",
                totalPayable: "核算总价",
                confirmation: "确认后",
                installation: "安装后",
                testing: "测试与调试后",
                final: "交付验收后",
                addPayment: "+ 增加阶段",
                daysUnit: "天",
                subTotal: "小计 (Sub-Total)",
                sst: "销售服务税 (SST 6%)",
                paymentWarning: "⚠️ 支付比例总和必须等于 100%（当前：{total}%）",
                shippingHandling: "运输与装卸",
                included: "已包含",
                customerNamePlaceholder: "输入客户公司",
                customerContactPlaceholder: "联系人/职位",
                siteAddressLabel: "Site Address：",
                siteAddressPlaceholder: "填写现场地址",
                validityLabel: "报价有效期：",
                validityUnit: "天",
                validityError: "请输入 1-999 之间的整数",
                signature: "签名",
                fullName: "姓名",
                contactNumber: "联系电话",
                email: "邮箱",
                nricPassport: "身份证/护照",
                signatureDate: "日期",
                termsDefault: "条款：\n本报价以现场全面勘察为准。如需采用非标准安装方式（包括但不限于额外开槽/破拆、布线、线槽/桥架、定制加工或任何超出标准安装范围的工作），费用可能调整。\n\n确认：\n本人/本公司（签署人）确认接受“光伏+电池+逆变器系统”及上述价格、规格、条款与条件，并同意由 Minova Holdings Sdn. Bhd. 开始进行系统设计、采购与安装。"
            },
            en: {
                title: "QUOTATION", toCustomer: "To Customer:", quoteNo: "Quote No.:", quoteDate: "Date:",
                thDesc: "Description", thVendor: "Brand", thSpec: "Specification", thBatch: "Batch", thQty: "Qty", thPrice: "Unit Price", thMargin: "Margin%", thAmount: "Amount",
                terms: "Terms & Conditions:", totalItems: "Total Items", avgMargin: "Avg Margin", grandTotal: "Grand Total",
                authSign: "Authorized Signature", signDate: "Date",
                termPlaceholder: "1. Quotation valid for 30 days.\n2. Please remit to: Bank XX, Acct...",
                timeline: "Estimated Timeline",
                step1: "Site Survey",
                step2: "Material Procurement & Installation Planning",
                step3: "Installation",
                paymentTerms: "Payment Terms",
                totalPayable: "Total Payable",
                confirmation: "Upon Confirmation",
                installation: "Upon Installation",
                testing: "Upon Testing & Commissioning",
                final: "Upon Final Acceptance",
                addPayment: "+ Add Phase",
                daysUnit: "Days",
                subTotal: "Sub-Total",
                sst: "SST (6%)",
                paymentWarning: "⚠️ Total payment percentage must equal 100% (Current: {total}%)",
                shippingHandling: "Shipping & Handling",
                included: "Included",
                customerNamePlaceholder: "Customer Company / Name",
                customerContactPlaceholder: "Contact Person / Title",
                siteAddressLabel: "Site Address:",
                siteAddressPlaceholder: "Site Address",
                validityLabel: "Quote Validity:",
                validityUnit: "Days",
                validityError: "Please enter an integer between 1 and 999.",
                signature: "Signature",
                fullName: "Full Name",
                contactNumber: "Contact Number",
                email: "Email",
                nricPassport: "NRIC/Passport",
                signatureDate: "Date",
                termsDefault: "Conditions:\nThis quotation is subject to a thorough site assessment. The cost may vary if non-standard installation is applied which require additional hacking, cabling, trunking, customization, or any other out of our standard installation.\n\nConfirmation:\nI / We, the undersigned hereby accept the Solar PV with Battery + Inverter System and the aforementioned price, specification, terms and conditions and would like to commence with the design, procurement and installation of the system by Minova Holdings. Sdn. Bhd."
            }
        };

        // --- Core UI Logic ---
        window.switchTab = (tab) => {
            const tabs = ['quotation', 'database', 'pvcalc', 'costcalc', 'inventory', 'transport'];
            tabs.forEach(t => {
                const el = document.getElementById(`view-${t}`);
                if (el) {
                    if (t === tab) {
                        el.classList.remove('hidden');
                        el.style.display = 'block';
                    } else {
                        el.classList.add('hidden');
                        el.style.display = 'none';
                    }
                }
                const btn = document.getElementById(`tab-${t}`);
                if (btn) {
                    if (t === tab) {
                        btn.classList.add('tab-active');
                        btn.classList.remove('text-slate-500', 'hover:text-blue-600');
                    } else {
                        btn.classList.remove('tab-active');
                        btn.classList.add('text-slate-500', 'hover:text-blue-600');
                    }
                }
            });
            if(tab === 'costcalc') {
                renderProfitSettingsUI();
                renderCostCalcUI();
                const rateBtn = document.getElementById('btn-fetch-rate');
                if(rateBtn) fetchLiveRate(rateBtn);
            }
            if(tab === 'inventory') {
                renderInventory();
            }
            if(tab === 'transport') {
                renderTransport();
            }
            if (tab === 'quotation') {
                const page = document.getElementById('quote-page-select')?.value || '1';
                const target = document.getElementById('quote-page-' + page);
                if (target) requestAnimationFrame(() => window.autosizeAllTextareas?.(target));
            }
        };

        window.generateQuotationPDF = () => {
            openCertAttachmentModal();
        };

        window.toggleCurrency = () => {
            currentCurrency = currentCurrency === 'CNY' ? 'MYR' : 'CNY';
            document.getElementById('btn-currency').textContent = currentCurrency === 'CNY' ? '¥ / RM' : 'RM / ¥';
            renderQuote();
        };

        window.toggleLanguage = () => {
            currentLang = currentLang === 'zh' ? 'en' : 'zh';
            updateLanguageLabels();
        };

        window.onPaymentPercentInput = () => {
            paymentTermsConfirmed = false;
            calculateQuote();
        };

        window.confirmPaymentTerms = () => {
            paymentTermsConfirmed = true;
            calculateQuote();
        };

        window.toggleFinalPayment = (show) => {
            const container = document.getElementById('payment-final-container');
            const addBtn = document.getElementById('btn-add-payment');
            const percentInput = document.getElementById('payment-final-percent');
            
            if (show) {
                container.classList.remove('hidden');
                addBtn.classList.add('hidden');
            } else {
                container.classList.add('hidden');
                addBtn.classList.remove('hidden');
                percentInput.value = 0;
                onPaymentPercentInput();
            }
        };

        function renderValidityBadge() {
            const labelEl = document.getElementById('validity-badge-label');
            const valueEl = document.getElementById('validity-badge-value');
            const t = i18n[currentLang];
            if (labelEl) labelEl.textContent = t.validityLabel.replace(':', '').replace('：', '');
            if (valueEl) valueEl.textContent = currentLang === 'zh' ? `${validityDays}${t.validityUnit}` : `${validityDays} ${t.validityUnit}`;
        }

        function autosizeAllTextareas(root) {
            const el = root || document;
            const list = el.querySelectorAll ? el.querySelectorAll('textarea') : [];
            list.forEach(t => {
                try {
                    t.style.height = '';
                    t.style.height = t.scrollHeight + 'px';
                } catch (e) {}
            });
        }
        window.autosizeAllTextareas = autosizeAllTextareas;

        window.enterValidityEdit = () => {
            const badge = document.getElementById('validity-badge');
            const valueEl = document.getElementById('validity-badge-value');
            if (!badge || !valueEl) return;
            const existing = badge.querySelector('input');
            if (existing) return;

            const input = document.createElement('input');
            input.type = 'number';
            input.min = '1';
            input.max = '999';
            input.step = '1';
            input.inputMode = 'numeric';
            input.value = String(validityDays);
            input.className = 'w-14 bg-transparent outline-none text-white text-xs font-black text-right border-b border-white/50 focus:border-white';
            valueEl.replaceWith(input);
            input.focus();
            input.select();

            const commit = () => {
                const v = String(input.value ?? '').trim();
                const n = parseInt(v, 10);
                const ok = v !== '' && Number.isInteger(n) && String(n) === v && n >= 1 && n <= 999;
                const nextValueEl = document.createElement('span');
                nextValueEl.id = 'validity-badge-value';
                if (ok) {
                    validityDays = n;
                    try { localStorage.setItem('minova_validityDays', String(n)); } catch (e) {}
                    badge.classList.remove('ring-2', 'ring-red-200');
                } else {
                    badge.classList.add('ring-2', 'ring-red-200');
                }
                nextValueEl.textContent = currentLang === 'zh' ? `${validityDays}${i18n[currentLang].validityUnit}` : `${validityDays} ${i18n[currentLang].validityUnit}`;
                input.replaceWith(nextValueEl);
            };

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); commit(); }
                if (e.key === 'Escape') { e.preventDefault(); commit(); }
            });
            input.addEventListener('blur', commit);
        };

        function isQuoteEffectivelyEmpty() {
            return quoteRows.length === 0 || quoteRows.every(r => {
                const desc = (r.description || '').trim();
                const spec = (r.spec || '').trim();
                const batch = (r.batchNo || '').trim();
                const price = parseFloat(r.price) || 0;
                return !desc && !spec && !batch && price === 0;
            });
        }

        function saveQuoteSplit() {
            localStorage.setItem('minova_quote_split', JSON.stringify(quoteSplit));
        }

        function normalizeQuoteSplit() {
            if (!quoteSplit.enabled) return;
            if (isQuoteEffectivelyEmpty()) { quoteSplit.enabled = false; quoteSplit.afterRowId = null; saveQuoteSplit(); return; }
            if (!quoteSplit.afterRowId || !quoteRows.some(r => r.id === quoteSplit.afterRowId)) {
                quoteSplit.afterRowId = quoteRows[quoteRows.length - 1].id;
                saveQuoteSplit();
            }
        }

        function updateQuoteSplitUI() {
            const btn = document.getElementById('btn-split');
            const lbl = document.getElementById('btn-split-label');
            const preview = document.getElementById('split-preview');
            const afterDetails = document.getElementById('section-after-details');

            const disabled = isQuoteEffectivelyEmpty();
            if (btn) {
                btn.disabled = disabled;
                btn.className = disabled
                    ? 'text-xs bg-slate-50 text-slate-300 px-4 py-2 rounded-lg font-bold transition-all border border-slate-200 flex items-center gap-1 cursor-not-allowed'
                    : 'text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 px-4 py-2 rounded-lg font-bold transition-all border border-slate-200 flex items-center gap-1';
                btn.title = disabled ? '报价明细为空，无法分割' : '在报价明细与备注条款之间插入分割线，并在打印/PDF中分页';
            }

            if (lbl) lbl.textContent = quoteSplit.enabled ? '取消分割' : '从此分割';
            if (preview) preview.classList.toggle('hidden', !quoteSplit.enabled);
            if (afterDetails) afterDetails.dataset.splitEnabled = quoteSplit.enabled ? 'true' : 'false';
        }

        window.toggleQuoteSplit = () => {
            if (isQuoteEffectivelyEmpty()) return alert('报价明细为空，无法分割。请先添加报价内容。');
            if (!quoteSplit.enabled) {
                if (!confirm('确定在报价明细与备注条款之间插入分割线，并在打印/PDF中从新页开始显示下方内容吗？')) return;
                quoteSplit.enabled = true;
                quoteSplit.afterRowId = quoteRows[quoteRows.length - 1]?.id || null;
                saveQuoteSplit();
                normalizeQuoteSplit();
                renderQuote();
                updateQuoteSplitUI();
                return;
            }
            if (!confirm('确定取消分割线吗？')) return;
            quoteSplit.enabled = false;
            quoteSplit.afterRowId = null;
            saveQuoteSplit();
            renderQuote();
            updateQuoteSplitUI();
        };

        window.moveQuoteSplit = (dir) => {
            if (!quoteSplit.enabled) return;
            const idx = quoteRows.findIndex(r => r.id === quoteSplit.afterRowId);
            if (idx === -1) return;
            const nextIdx = Math.min(Math.max(idx + dir, 0), quoteRows.length - 1);
            quoteSplit.afterRowId = quoteRows[nextIdx].id;
            saveQuoteSplit();
            renderQuote();
            updateQuoteSplitUI();
        };

        const updateLanguageLabels = () => {
            const t = i18n[currentLang];
            document.getElementById('lbl-title').textContent = t.title;
            const titleEl = document.getElementById('lbl-title');
            if (titleEl) {
                if (currentLang === 'zh') {
                    titleEl.classList.remove('tracking-wider', 'uppercase');
                    titleEl.classList.add('tracking-normal', 'whitespace-nowrap');
                } else {
                    titleEl.classList.add('tracking-wider', 'uppercase');
                    titleEl.classList.remove('tracking-normal', 'whitespace-nowrap');
                }
            }
            document.getElementById('lbl-to-customer').textContent = t.toCustomer;
            const customerNameEl = document.getElementById('input-customer-name');
            if (customerNameEl) customerNameEl.placeholder = t.customerNamePlaceholder;
            const siteAddressLabelEl = document.getElementById('lbl-site-address');
            if (siteAddressLabelEl) siteAddressLabelEl.textContent = t.siteAddressLabel;
            const siteAddressInputEl = document.getElementById('input-site-address');
            if (siteAddressInputEl) siteAddressInputEl.placeholder = t.siteAddressPlaceholder;
            const customerContactEl = document.getElementById('input-customer-contact');
            if (customerContactEl) customerContactEl.placeholder = t.customerContactPlaceholder;
            document.getElementById('lbl-quote-no').textContent = t.quoteNo;
            document.getElementById('lbl-quote-date').textContent = t.quoteDate;
            const validityLabelEl = document.getElementById('lbl-quote-validity');
            if (validityLabelEl) validityLabelEl.textContent = t.validityLabel;
            const validityUnitEl = document.getElementById('lbl-validity-unit');
            if (validityUnitEl) validityUnitEl.textContent = t.validityUnit;
            document.getElementById('th-desc').textContent = t.thDesc;
            document.getElementById('th-spec').textContent = t.thSpec;
            document.getElementById('th-batch').textContent = t.thBatch;
            document.getElementById('th-qty').textContent = t.thQty;
            document.getElementById('th-price').textContent = `${t.thPrice} (${currentCurrency === 'CNY' ? '¥' : 'RM'})`;
            document.getElementById('th-margin').textContent = t.thMargin;
            document.getElementById('th-amount').textContent = `${t.thAmount} (${currentCurrency === 'CNY' ? '¥' : 'RM'})`;
            document.getElementById('lbl-terms').textContent = t.terms;
            document.getElementById('val-terms').placeholder = t.termPlaceholder;
            document.getElementById('lbl-total-items').textContent = t.totalItems;
            document.getElementById('lbl-avg-margin').textContent = t.avgMargin;
            document.getElementById('lbl-grand-total').textContent = t.grandTotal;
            document.getElementById('lbl-auth-sign').textContent = t.authSign;
            document.getElementById('lbl-sign-date').textContent = t.signDate;
 
            document.getElementById('lbl-timeline').textContent = t.timeline;
            document.getElementById('val-step1').value = t.step1;
            document.getElementById('val-step2').value = t.step2;
            document.getElementById('val-step3').value = t.step3;
            document.getElementById('lbl-payment-terms').textContent = t.paymentTerms;
            document.getElementById('lbl-total-payable').textContent = t.totalPayable;
            document.getElementById('lbl-confirmation').value = t.confirmation;
            document.getElementById('lbl-installation').value = t.installation;
            document.getElementById('lbl-testing').value = t.testing;
            const finalInput = document.getElementById('lbl-final');
            if (finalInput) finalInput.value = t.final;
            const addPaymentBtn = document.getElementById('btn-add-payment');
            if (addPaymentBtn) addPaymentBtn.textContent = t.addPayment;
            document.getElementById('lbl-shipping-handling').textContent = t.shippingHandling;
            document.getElementById('lbl-sub-total').textContent = t.subTotal;
            document.getElementById('lbl-sst').textContent = t.sst;
            document.getElementById('lbl-signature').textContent = t.signature;
            document.getElementById('lbl-full-name').textContent = t.fullName;
            document.getElementById('lbl-contact-number').textContent = t.contactNumber;
            document.getElementById('lbl-email').textContent = t.email;
            document.getElementById('lbl-nric-passport').textContent = t.nricPassport;
            document.getElementById('lbl-signature-date').textContent = t.signatureDate;

            const termsEl = document.getElementById('val-terms');
            if (termsEl) {
                try {
                    const prevLang = termsEl.dataset.lang || currentLang;
                    localStorage.setItem(`minova_terms_text_${prevLang}`, termsEl.value);
                    const nextVal = localStorage.getItem(`minova_terms_text_${currentLang}`) ?? t.termsDefault;
                    termsEl.value = nextVal;
                } catch (e) {
                    termsEl.value = t.termsDefault;
                }
                termsEl.dataset.lang = currentLang;
                termsEl.dataset.dirty = 'false';
                termsEl.style.height = '';
                termsEl.style.height = termsEl.scrollHeight + 'px';
            }

            const shipEl = document.getElementById('val-shipping-handling');
            if (shipEl) {
                try {
                    const prevLang = shipEl.dataset.lang || currentLang;
                    localStorage.setItem(`minova_shipping_${prevLang}`, shipEl.value);
                    shipEl.value = localStorage.getItem(`minova_shipping_${currentLang}`) ?? t.included;
                } catch (e) {
                    shipEl.value = t.included;
                }
                shipEl.dataset.lang = currentLang;
                shipEl.dataset.dirty = 'false';
            }

            renderValidityBadge();
            calculateQuote();

            document.querySelectorAll('.unit-days').forEach(el => el.textContent = t.daysUnit);

            document.getElementById('btn-lang').textContent = currentLang === 'zh' ? '中 / EN' : 'EN / 中';
            renderQuote();

            const p2 = document.getElementById('lbl-page2-title');
            if(p2) p2.textContent = currentLang === 'zh' ? '投资回报分析' : 'ROI / FINANCIAL ANALYSIS';
            const p3 = document.getElementById('lbl-page3-title');
            if(p3) p3.textContent = currentLang === 'zh' ? '产品明细与质保' : 'PART BREAKDOWN & WARRANTY';
            const p4 = document.getElementById('lbl-page4-title');
            if(p4) p4.textContent = currentLang === 'zh' ? '参考信息' : 'REFERENCE';
            const p5 = document.getElementById('lbl-page5-title');
            if(p5) p5.textContent = currentLang === 'zh' ? '现场概览' : 'SITE OVERVIEW';
            
            const lblBefore = document.getElementById('lbl-roi-before');
            if(lblBefore) lblBefore.textContent = currentLang === 'zh' ? `安装前月均电费 (${currentCurrency === 'CNY' ? '¥' : 'RM'})` : `Monthly Bill Before (${currentCurrency === 'CNY' ? '¥' : 'RM'})`;
            const lblAfter = document.getElementById('lbl-roi-after');
            if(lblAfter) lblAfter.textContent = currentLang === 'zh' ? `安装后月均电费 (${currentCurrency === 'CNY' ? '¥' : 'RM'})` : `Monthly Bill After (${currentCurrency === 'CNY' ? '¥' : 'RM'})`;
            const lblCost = document.getElementById('lbl-roi-cost');
            if(lblCost) lblCost.textContent = currentLang === 'zh' ? `系统总成本 (${currentCurrency === 'CNY' ? '¥' : 'RM'})` : `System Cost (${currentCurrency === 'CNY' ? '¥' : 'RM'})`;
        };

        // --- 报价单逻辑 ---
        window.removeRow = (id) => {
            quoteRows = quoteRows.filter(r => r.id !== id);
            if(quoteRows.length === 0) quoteRows.push({ id: Date.now(), description: '', vendor: '', spec: '', batchNo: '', quantity: 1, price: 0, cost: 0, productId: '', inventoryId: '' });
            renderQuote();
        };
        window.moveRow = (id, dir) => {
            const idx = quoteRows.findIndex(r => r.id === id);
            if (idx === -1) return;
            const nextIdx = Math.min(Math.max(idx + dir, 0), quoteRows.length - 1);
            if (nextIdx === idx) return;
            const copy = [...quoteRows];
            const [item] = copy.splice(idx, 1);
            copy.splice(nextIdx, 0, item);
            quoteRows = copy;
            renderQuote();
        };
        window.addBlankRowsFromUI = () => {
            const n = Math.min(Math.max(parseInt(document.getElementById('blank-row-count')?.value || '1', 10) || 1, 1), 10);
            for (let i = 0; i < n; i++) {
                quoteRows.push({ id: Date.now() + i, description: '', vendor: '', spec: '', batchNo: '', quantity: 0, price: 0, cost: 0, productId: '', inventoryId: '', isBlank: true });
            }
            renderQuote();
        };
        let translateCache = {};
        let translatePending = new Set();
        try { translateCache = safeJsonParseLoose(localStorage.getItem('minova_translate_cache_v1'), {}) || {}; } catch (e) { translateCache = {}; }
        function looksChinese(s) { return /[\u4e00-\u9fff]/.test(String(s || '')); }
        async function translateZhToEn(text) {
            const raw = String(text || '').trim();
            if (!raw) return '';
            if (translateCache[raw]) return translateCache[raw];
            if (translatePending.has(raw)) return '';
            translatePending.add(raw);
            try {
                const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(raw)}&langpair=zh-CN|en`;
                const res = await fetch(url, { cache: 'no-store' });
                const data = await res.json();
                const out = String(data?.responseData?.translatedText || '').trim();
                if (out) {
                    translateCache[raw] = out;
                    try { localStorage.setItem('minova_translate_cache_v1', JSON.stringify(translateCache)); } catch (e) {}
                }
            } catch (e) {}
            translatePending.delete(raw);
            if (currentLang === 'en') renderQuote();
            return translateCache[raw] || '';
        }

        window.updateRow = (id, field, val) => {
            const row = quoteRows.find(r => r.id === id);
            if(!row) return;

            if (field === 'price') {
                const rate = parseFloat(document.getElementById('rate-myr-cny').value) || 1.53;
                row.price = currentCurrency === 'MYR' ? (parseFloat(val) || 0) * rate : parseFloat(val) || 0;
            } else if (field === 'description') {
                if (currentLang === 'en') row.descEn = val;
                else row.description = val;
            } else if (field === 'vendor') {
                row.vendor = String(val || '');
            } else if (field === 'spec' || field === 'batchNo') {
                row[field] = val;
            } else {
                row[field] = parseFloat(val) || 0;
            }
            calculateQuote();
        };

        function formatNumberAuto(v, maxDecimals = 4) {
            const n = Number(v);
            if (!Number.isFinite(n)) return '0';
            const s = n.toFixed(maxDecimals);
            return s.replace(/\.?0+$/, '');
        }
        function calculateQuote() {
            let total = 0, totalCost = 0;
            const rate = parseFloat(document.getElementById('rate-myr-cny').value) || 1.53;

            quoteRows.forEach(r => {
                if (r.isBlank) return;
                const priceInCurrentCurrency = currentCurrency === 'MYR' ? r.price / rate : r.price;
                const sub = r.quantity * priceInCurrentCurrency;
                total += sub;
                totalCost += r.quantity * r.cost;
                const subEl = document.getElementById(`sub-${r.id}`);
                const marginEl = document.getElementById(`margin-${r.id}`);
                if(subEl) subEl.textContent = sub.toFixed(2);
                if(marginEl) {
                    // 更新计算公式：(售价 - 成本) / 成本
                    const margin = r.cost > 0 ? ((r.price - r.cost) / r.cost * 100) : 0;
                    marginEl.textContent = margin.toFixed(1) + '%';
                    marginEl.className = `no-print py-4 px-2 text-center text-[10px] font-bold ${margin < 15 ? 'text-red-500 bg-red-50 rounded-lg animate-pulse' : 'text-slate-400'}`;
                }
            });
            const currencySymbol = currentCurrency === 'CNY' ? '¥' : 'RM';
            
            // Sub-Total and SST calculations
            const subTotal = total;
            const sst = subTotal * 0.06;
            const grandTotal = subTotal + sst;

            document.getElementById('val-sub-total').textContent = subTotal.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
            document.getElementById('val-sst').textContent = sst.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2});

            const formattedGrandTotal = grandTotal.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
            document.getElementById('grand-total').textContent = formattedGrandTotal;
            document.getElementById('payment-grand-total').textContent = formattedGrandTotal;

            const confirmationPercent = parseFloat(document.getElementById('payment-confirmation-percent').value) || 0;
            const installationPercent = parseFloat(document.getElementById('payment-installation-percent').value) || 0;
            const testingPercent = parseFloat(document.getElementById('payment-testing-percent').value) || 0;
            
            const finalContainer = document.getElementById('payment-final-container');
            const finalPercent = finalContainer && !finalContainer.classList.contains('hidden') ? (parseFloat(document.getElementById('payment-final-percent').value) || 0) : 0;

            const totalPercent = confirmationPercent + installationPercent + testingPercent + finalPercent;
            const warningEl = document.getElementById('payment-warning');
            
            const percentInputs = ['payment-confirmation-percent', 'payment-installation-percent', 'payment-testing-percent'];
            if (finalContainer && !finalContainer.classList.contains('hidden')) {
                percentInputs.push('payment-final-percent');
            }
            
            const t = i18n[currentLang];

            if (!paymentTermsConfirmed) {
                warningEl.classList.add('hidden');
                percentInputs.forEach(id => {
                    document.getElementById(id).classList.remove('text-red-500', 'border-red-500');
                    document.getElementById(id).classList.add('text-[#582C83]', 'border-purple-200');
                });
                document.getElementById('payment-confirmation').textContent = '---';
                document.getElementById('payment-installation').textContent = '---';
                document.getElementById('payment-testing').textContent = '---';
                document.getElementById('payment-final').textContent = '---';
            } else if (totalPercent !== 100) {
                warningEl.classList.remove('hidden');
                warningEl.textContent = t.paymentWarning.replace('{total}', totalPercent);
                percentInputs.forEach(id => {
                    document.getElementById(id).classList.add('text-red-500', 'border-red-500');
                    document.getElementById(id).classList.remove('text-[#582C83]', 'border-purple-200');
                });
                document.getElementById('payment-confirmation').textContent = '---';
                document.getElementById('payment-installation').textContent = '---';
                document.getElementById('payment-testing').textContent = '---';
                document.getElementById('payment-final').textContent = '---';
            } else {
                warningEl.classList.add('hidden');
                percentInputs.forEach(id => {
                    document.getElementById(id).classList.remove('text-red-500', 'border-red-500');
                    document.getElementById(id).classList.add('text-[#582C83]', 'border-purple-200');
                });
                document.getElementById('payment-confirmation').textContent = (grandTotal * confirmationPercent / 100).toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
                document.getElementById('payment-installation').textContent = (grandTotal * installationPercent / 100).toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
                document.getElementById('payment-testing').textContent = (grandTotal * testingPercent / 100).toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
                document.getElementById('payment-final').textContent = (grandTotal * finalPercent / 100).toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
            }

            document.querySelectorAll('.currency-symbol').forEach(el => el.textContent = currencySymbol);
            const itemCount = quoteRows.filter(r => !r.isBlank && (((r.description || '').trim()) || ((r.spec || '').trim()) || ((r.batchNo || '').trim()) || (parseFloat(r.quantity) || 0) > 0 || (parseFloat(r.price) || 0) > 0)).length;
            document.getElementById('stat-count').textContent = itemCount;
            const avgMargin = totalCost > 0 ? ((total * (currentCurrency === 'MYR' ? rate : 1) - totalCost) / totalCost * 100) : 0;
            document.getElementById('stat-avg-margin').textContent = avgMargin.toFixed(1) + '%';
        }
        function renderQuote() {
            const container = document.getElementById('quote-body');
            const rate = parseFloat(document.getElementById('rate-myr-cny').value) || 1.53;
            const t = i18n[currentLang];
            const thVendorEl = document.getElementById('th-vendor');
            if (thVendorEl) thVendorEl.textContent = t.thVendor;
            document.getElementById('th-price').textContent = `${t.thPrice} (${currentCurrency === 'CNY' ? '¥' : 'RM'})`;
            document.getElementById('th-amount').textContent = `${t.thAmount} (${currentCurrency === 'CNY' ? '¥' : 'RM'})`;

            normalizeQuoteSplit();
            const splitAfterId = quoteSplit.enabled ? quoteSplit.afterRowId : null;
            let displayIndex = 0;
            const isCountedRow = (r) => {
                if (r.isBlank) return false;
                const desc = (r.description || '').trim();
                const spec = (r.spec || '').trim();
                const batch = (r.batchNo || '').trim();
                const qty = parseFloat(r.quantity) || 0;
                const price = parseFloat(r.price) || 0;
                return !!(desc || spec || batch || qty > 0 || price > 0);
            };

            container.innerHTML = quoteRows.map((r, idx) => {
                const priceInCurrentCurrency = currentCurrency === 'MYR' ? r.price / rate : r.price;
                const descVal = currentLang === 'en'
                    ? (r.descEn || r.description || '')
                    : (r.description || '');
                if (currentLang === 'en' && !r.descEn && looksChinese(r.description)) {
                    translateZhToEn(r.description).then(enText => {
                        if (enText) {
                            const row = quoteRows.find(x => x.id === r.id);
                            if (row && !row.descEn) row.descEn = enText;
                        }
                    });
                }
                const displayNo = isCountedRow(r) ? (++displayIndex) : '';
                const rowHtml = r.isBlank ? `
                <tr class="group transition-colors hover:bg-slate-50/50">
                    <td class="py-4 px-2 text-center text-[10px] font-mono text-slate-200"></td>
                    <td class="py-4 px-2 select-none">&nbsp;</td>
                    <td class="py-4 px-2 select-none">&nbsp;</td>
                    <td class="py-4 px-2 select-none">&nbsp;</td>
                    <td class="py-4 px-2 no-print select-none">&nbsp;</td>
                    <td class="py-4 px-2 text-center select-none">&nbsp;</td>
                    <td class="py-4 px-2 text-right select-none print:hidden no-print">&nbsp;</td>
                    <td class="no-print py-4 px-2 text-center select-none">&nbsp;</td>
                    <td class="py-4 px-2 text-right select-none">&nbsp;</td>
                    <td class="no-print py-4 px-2 text-center">
                        <div class="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                            <button onclick="moveRow(${r.id}, -1)" class="px-2 py-1 text-[10px] font-black text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-md border border-slate-200" title="上移">↑</button>
                            <button onclick="moveRow(${r.id}, 1)" class="px-2 py-1 text-[10px] font-black text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-md border border-slate-200" title="下移">↓</button>
                            <button onclick="removeRow(${r.id})" class="px-2 py-1 text-[10px] font-black text-red-500 bg-red-50 hover:bg-red-100 rounded-md border border-red-200" title="删除">✕</button>
                        </div>
                    </td>
                </tr>
                ` : `
                <tr class="border-b border-slate-50 group transition-colors hover:bg-slate-50/50">
                    <td class="py-2 px-2 text-center text-[10px] font-mono text-slate-300">${displayNo}</td>
                    <td class="py-2 px-2"><input type="text" value="${descVal}" oninput="updateRow(${r.id}, 'description', this.value)" class="w-full bg-transparent outline-none text-sm font-medium focus:text-blue-600" placeholder="${currentLang === 'en' ? 'Description' : '描述'}"></td>
                    <td class="py-2 px-2"><input type="text" value="${String(r.vendor || '')}" oninput="updateRow(${r.id}, 'vendor', this.value)" class="w-full bg-transparent outline-none text-center text-sm focus:text-blue-600" placeholder="${currentLang === 'en' ? 'Brand' : '品牌'}"></td>
                    <td class="py-2 px-2"><input type="text" value="${r.spec}" oninput="updateRow(${r.id}, 'spec', this.value)" class="w-full bg-transparent outline-none text-center text-sm focus:text-blue-600" placeholder="${currentLang === 'en' ? 'Spec' : '规格'}"></td>
                    <td class="py-2 px-2 no-print"><input type="text" value="${r.batchNo}" oninput="updateRow(${r.id}, 'batchNo', this.value)" class="w-full bg-transparent outline-none text-sm focus:text-blue-600" placeholder="${currentLang === 'en' ? 'Batch' : '采购批次'}"></td>
                    <td class="py-2 px-2"><input type="number" value="${r.quantity}" oninput="updateRow(${r.id}, 'quantity', this.value)" class="w-full bg-transparent outline-none text-center text-sm"></td>
                    <td class="py-2 px-2 print:hidden no-print whitespace-nowrap"><input type="number" step="0.01" value="${formatNumberAuto(priceInCurrentCurrency, 4)}" oninput="updateRow(${r.id}, 'price', this.value)" class="w-full bg-transparent outline-none text-right text-sm font-bold"></td>
                    <td id="margin-${r.id}" class="no-print py-2 px-2 text-center text-[10px] font-bold text-slate-400">0%</td>
                    <td class="py-2 px-2 text-right font-black text-slate-700 text-sm whitespace-nowrap"><span class="currency-symbol mr-1"></span><span id="sub-${r.id}">0.00</span></td>
                    <td class="no-print py-2 px-2 text-center">
                        <div class="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                            <button onclick="moveRow(${r.id}, -1)" class="px-2 py-1 text-[10px] font-black text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-md border border-slate-200" title="上移">↑</button>
                            <button onclick="moveRow(${r.id}, 1)" class="px-2 py-1 text-[10px] font-black text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-md border border-slate-200" title="下移">↓</button>
                            <button onclick="removeRow(${r.id})" class="px-2 py-1 text-[10px] font-black text-red-500 bg-red-50 hover:bg-red-100 rounded-md border border-red-200" title="删除">✕</button>
                        </div>
                    </td>
                </tr>
                `;

                const splitHtml = (quoteSplit.enabled && r.id === splitAfterId) ? `
                <tr id="quote-split-row" class="quote-split-row">
                    <td colspan="10" class="py-4 px-2">
                        <div class="flex items-center gap-3">
                            <div class="flex-grow border-t border-dashed border-purple-200"></div>
                            <div class="no-print flex items-center gap-1">
                                <button onclick="moveQuoteSplit(-1)" class="px-2 py-1 text-[10px] font-black text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-md border border-slate-200" title="上移">↑</button>
                                <button onclick="moveQuoteSplit(1)" class="px-2 py-1 text-[10px] font-black text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-md border border-slate-200" title="下移">↓</button>
                                <button onclick="toggleQuoteSplit()" class="px-2 py-1 text-[10px] font-black text-red-500 bg-red-50 hover:bg-red-100 rounded-md border border-red-200" title="删除">✕</button>
                            </div>
                        </div>
                    </td>
                </tr>
                ` : '';

                return rowHtml + splitHtml;
            }).join('');
            calculateQuote();
            updateQuoteSplitUI();
        }
        window.renderQuote = renderQuote;
        window.calculateQuote = calculateQuote;

        // --- 库管理逻辑 ---
        window.setDbGroup = (mode) => {
            dbGroupMode = mode;
            document.getElementById('btn-group-category').className = mode === 'category' ? 'px-4 py-1.5 text-xs font-bold rounded-lg transition-all bg-white shadow-sm text-purple-700' : 'px-4 py-1.5 text-xs font-bold rounded-lg transition-all text-slate-500';
            document.getElementById('btn-group-vendor').className = mode === 'vendor' ? 'px-4 py-1.5 text-xs font-bold rounded-lg transition-all bg-white shadow-sm text-purple-700' : 'px-4 py-1.5 text-xs font-bold rounded-lg transition-all text-slate-500';
            renderDb();
        };
        window.renderDb = () => {
            const list = document.getElementById('db-list');
            if(products.length === 0) {
                list.innerHTML = `<tr><td colspan="12" class="py-20 text-center text-slate-400 text-sm">暂无入库产品...</td></tr>`;
                return;
            }
            const sorted = [...products].sort((a,b) => (a[dbGroupMode] || '').localeCompare(b[dbGroupMode] || ''));
            list.innerHTML = sorted.map(p => {
                const margin = p.price > 0 ? ((p.price - p.cost) / p.price * 100).toFixed(1) : 0;
                const warrantyY = p.warrantyYears ? `${p.warrantyYears}年` : '-';
                const warrantyC = p.warrantyCycles ? `${p.warrantyCycles}次` : '-';
                const contactHtml = p.contact ? `<div class="relative group inline-block cursor-help"><span class="${p.contactInfo ? 'border-b border-dashed border-blue-400 text-blue-600' : ''}">${p.contact}</span>${p.contactInfo ? `<div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block px-3 py-2 bg-slate-800 text-white text-xs rounded-lg z-50 whitespace-nowrap">📞 ${p.contactInfo}</div>` : ''}</div>` : '-';
                return `
                    <tr class="hover:bg-slate-50 transition-colors group">
                        <td class="py-4 px-4 text-xs font-mono text-slate-500">${p.id || '-'}</td>
                        <td class="py-4 px-4 font-bold text-slate-700 text-sm max-w-[200px] truncate" title="${p.name}">${p.name}</td>
                        <td class="py-4 px-4 text-xs text-slate-600">${p.spec || '-'}</td>
                        <td class="py-4 px-4 text-xs text-slate-500 uppercase tracking-tighter">${p.category}</td>
                        <td class="py-4 px-4 text-xs text-slate-600">${p.scenario || '-'}</td>
                        <td class="py-4 px-4 text-xs text-slate-500 text-center">${warrantyY} / ${warrantyC}</td>
                        <td class="py-4 px-4 text-xs text-slate-600">${p.leadTime || '-'}</td>
                        <td class="py-4 px-4 text-xs text-slate-500">${p.vendor}</td>
                        <td class="py-4 px-4 text-xs">${contactHtml}</td>
                        <td class="py-4 px-4 text-right text-sm font-mono text-slate-400">¥${(p.cost||0).toFixed(2)}</td>
                        <td class="py-4 px-4 text-right text-sm font-bold text-purple-700">¥${(p.price||0).toFixed(2)}</td>
                        <td class="py-4 px-4 text-right"><span class="text-[10px] font-black px-2 py-1 rounded ${margin > 30 ? 'bg-green-50 text-green-600' : 'bg-slate-50 text-slate-400'}">${margin}%</span></td>
                        <td class="py-4 px-4 text-center">
                            <div class="flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-all">
                                <button onclick="editProduct('${p.id}')" class="text-purple-700 hover:bg-purple-50 p-1 rounded">✎</button>
                                <button onclick="deleteProduct('${p.id}')" class="text-red-300 hover:text-red-500 p-1 rounded">🗑</button>
                            </div>
                        </td>
                    </tr>`;
            }).join('');
        };

        window.renderInventory = () => {
            const list = document.getElementById('inventory-list');
            const headRow = document.getElementById('inventory-head-row');
            if (headRow && !inventoryFullHeadHtml) inventoryFullHeadHtml = headRow.innerHTML;
            const btn = document.getElementById('btn-inv-summary');
            if (btn) btn.innerHTML = inventorySummaryMode ? '<span>取消汇总</span>' : '<span>一键汇总</span>';
            if (inventorySummaryMode && headRow) {
                headRow.innerHTML = `
                    <th class="py-4 px-4">产品编号</th>
                    <th class="py-4 px-4">产品全称</th>
                    <th class="py-4 px-4">类目</th>
                    <th class="py-4 px-4">子类目</th>
                    <th class="py-4 px-4">供应商</th>
                    <th class="py-4 px-4">规格</th>
                    <th class="py-4 px-4 text-center">库存数量(汇总)</th>
                    <th class="py-4 px-4 text-right">总库存平均成本(¥)</th>
                `;
            } else if (!inventorySummaryMode && headRow && inventoryFullHeadHtml) {
                headRow.innerHTML = inventoryFullHeadHtml;
            }

            if (inventorySummaryMode) {
                if (inventory.length === 0) {
                    list.innerHTML = `<tr><td colspan="8" class="py-20 text-center text-slate-400 text-sm">暂无库存记录...</td></tr>`;
                    return;
                }
                const grouped = new Map();
                for (const item of inventory) {
                    const pid = String(item.productId || '').trim();
                    if (!pid) continue;
                    const q = parseFloat(item.quantity) || 0;
                    if (q <= 0) continue;
                    const prev = grouped.get(pid) || { productId: pid, quantity: 0 };
                    prev.quantity += q;
                    grouped.set(pid, prev);
                }
                const rows = [...grouped.values()].sort((a, b) => a.productId.localeCompare(b.productId));
                list.innerHTML = rows.map(r => {
                    const p = products.find(x => x.id === r.productId) || {};
                    const ref = inventory.find(x => x.productId === r.productId && (parseFloat(x.quantity) || 0) > 0) || inventory.find(x => x.productId === r.productId);
                    const specNum = Number.isFinite(parseFloat(ref?.spec)) ? parseFloat(ref.spec) : 1;
                    const avgCost = getAverageInventoryCostPerSpec(r.productId, specNum);
                    return `
                        <tr class="hover:bg-slate-50 transition-colors">
                            <td class="py-4 px-4 text-xs font-mono text-slate-500">${r.productId}</td>
                            <td class="py-4 px-4 font-bold text-slate-700 text-sm">${p.name || '未知产品'}</td>
                            <td class="py-4 px-4 text-xs text-slate-500 uppercase tracking-tighter">${p.category || '-'}</td>
                            <td class="py-4 px-4 text-xs text-slate-600">${p.scenario || '-'}</td>
                            <td class="py-4 px-4 text-xs text-slate-600">${p.vendor || '-'}</td>
                            <td class="py-4 px-4 text-xs text-slate-600">${specNum}</td>
                            <td class="py-4 px-4 text-center font-black text-green-700">${formatNumberAuto(r.quantity, 4)}</td>
                            <td class="py-4 px-4 text-right text-sm font-mono text-slate-700">¥${(parseFloat(avgCost) || 0).toFixed(4)}</td>
                        </tr>
                    `;
                }).join('');
                return;
            }

            if(inventory.length === 0) {
                list.innerHTML = `<tr><td colspan="21" class="py-20 text-center text-slate-400 text-sm">暂无库存记录...</td></tr>`;
                return;
            }
            list.innerHTML = inventory.map(item => {
                const product = products.find(p => p.id === item.productId) || {};
                const locked = Array.isArray(item.transportIds) && item.transportIds.length > 0;
                if (locked) selectedInventoryForTransport.delete(item.id);
                const checked = !locked && selectedInventoryForTransport.has(item.id) ? 'checked' : '';
                const disabled = locked ? 'disabled' : '';
                const lockTitle = locked ? 'title="已生成运输单"' : '';
                
                const unitPrice = item.unitPurchasePrice || ((item.purchasePrice || 0) * (item.spec || 1));
                const purchaseDate = item.purchaseDate ? String(item.purchaseDate) : '-';
                const spec = Number.isFinite(parseFloat(item.spec)) ? parseFloat(item.spec) : 1;
                const purchaseTotal = item.purchaseTotal || (unitPrice * (item.quantity || 0));
                const shippingRatePct = ((item.shippingRate ?? 0.08) * 100);
                const taxRatePct = ((item.domesticTaxRate ?? 0.06) * 100);
                const shippingCost = item.shippingCost ?? (purchaseTotal * (shippingRatePct / 100));
                const domesticTax = item.domesticTax ?? (purchaseTotal * (taxRatePct / 100));
                const totalCost = item.totalCost ?? (purchaseTotal + shippingCost + domesticTax);
                const avgCost = getAverageInventoryCostPerSpec(item.productId, spec);

                return `
                    <tr class="hover:bg-slate-50 transition-colors">
                        <td class="py-4 px-4 no-print">
                            <input type="checkbox" class="h-4 w-4 ${locked ? 'opacity-40 cursor-not-allowed' : ''}" ${checked} ${disabled} ${lockTitle} onchange="toggleInventoryForTransport('${item.id}', this.checked)">
                        </td>
                        <td class="py-4 px-4 text-xs font-mono text-slate-500 cursor-help" 
                            onmouseenter="showInventoryTooltip(event, '${item.productId}')" 
                            onmouseleave="hideInventoryTooltip()">
                            ${item.productId}
                        </td>
                        <td class="py-4 px-4 font-bold text-slate-700 text-sm">${product.name || '未知产品'}</td>
                        <td class="py-4 px-4 text-xs text-slate-500 uppercase tracking-tighter">${product.category || '-'}</td>
                        <td class="py-4 px-4 text-xs text-slate-600">${product.scenario || '-'}</td>
                        <td class="py-4 px-4 text-xs text-slate-600">${product.vendor || '-'}</td>
                        <td class="py-4 px-4 text-xs text-slate-600">${purchaseDate}</td>
                        <td class="py-4 px-4 text-center font-bold text-green-600">${item.quantity}</td>
                        <td class="py-4 px-4 text-xs text-slate-600">${item.batchNo || '-'}</td>
                        <td class="py-4 px-4 text-right text-sm font-mono text-slate-600">¥${(item.purchasePrice || 0).toFixed(2)}</td>
                        <td class="py-4 px-4 text-right text-sm font-mono text-slate-600">${spec}</td>
                        <td class="py-4 px-4 text-right text-sm font-mono text-slate-600">¥${unitPrice.toFixed(2)}</td>
                        <td class="py-4 px-4 text-right text-sm font-mono text-slate-600">¥${purchaseTotal.toFixed(2)}</td>
                        <td class="py-4 px-4 text-right text-sm font-mono text-slate-600">${shippingRatePct.toFixed(1)}%</td>
                        <td class="py-4 px-4 text-right text-sm font-mono text-slate-600">${taxRatePct.toFixed(1)}%</td>
                        <td class="py-4 px-4 text-right text-sm font-mono text-slate-600">¥${shippingCost.toFixed(2)}</td>
                        <td class="py-4 px-4 text-right text-sm font-mono text-slate-600">¥${domesticTax.toFixed(2)}</td>
                        <td class="py-4 px-4 text-right text-sm font-mono text-slate-900 font-bold">¥${totalCost.toFixed(2)}</td>
                        <td class="py-4 px-4 text-right text-sm font-mono text-slate-700">¥${avgCost.toFixed(2)}</td>
                        <td class="py-4 px-4 text-xs text-slate-600">${item.location || '-'}</td>
                        <td class="py-4 px-4 text-center">
                            <div class="flex items-center justify-center gap-2">
                                <button onclick="openInventoryEditModal('${item.id}')" class="text-purple-700 hover:bg-purple-50 p-1 rounded text-xs">定价</button>
                                <button onclick="openInventoryModal('edit', '${item.id}')" class="text-blue-600 hover:bg-blue-50 p-1 rounded text-xs">修改</button>
                                <button onclick="openInventoryModal('out', '${item.id}')" class="text-orange-500 hover:bg-orange-50 p-1 rounded text-xs">出库</button>
                                <button onclick="deleteInventoryItem('${item.id}')" class="text-red-300 hover:text-red-500 p-1 rounded">🗑</button>
                            </div>
                        </td>
                    </tr>`;
            }).join('');
        };

        window.toggleInventorySummary = () => {
            inventorySummaryMode = !inventorySummaryMode;
            if (inventorySummaryMode) selectedInventoryForTransport = new Set();
            renderInventory();
        };

        window.toggleInventoryForTransport = (invId, checked) => {
            const id = String(invId || '');
            if (!id) return;
            const item = inventory.find(x => x.id === id);
            const locked = item && Array.isArray(item.transportIds) && item.transportIds.length > 0;
            if (locked) {
                selectedInventoryForTransport.delete(id);
                return;
            }
            if (checked) selectedInventoryForTransport.add(id);
            else selectedInventoryForTransport.delete(id);
        };

        function getTransportMethodLabel(v) {
            if (v === 'sea') return '海运';
            if (v === 'air') return '空运';
            if (v === 'land') return '陆运';
            if (v === 'other') return '其他';
            return '-';
        }
        function getTransportStatusLabel(v) {
            if (v === 'draft') return '草稿';
            if (v === 'in_transit') return '运输中';
            if (v === 'delivered') return '已到货';
            if (v === 'cancelled') return '已取消';
            return '-';
        }
        window.renderTransport = () => {
            const list = document.getElementById('transport-list');
            if (!list) return;
            const q = String(document.getElementById('transport-search')?.value || '').trim().toLowerCase();
            const status = String(document.getElementById('transport-status-filter')?.value || '').trim();
            const method = String(document.getElementById('transport-method-filter')?.value || '').trim();

            const rows = (Array.isArray(transportRecords) ? transportRecords : []).slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
            const filtered = rows.filter(r => {
                if (status && String(r.status || '') !== status) return false;
                if (method && String(r.method || '') !== method) return false;
                if (!q) return true;
                const hay = [
                    r.trackingNo,
                    r.carrierCompany,
                    r.method,
                    r.status,
                    ...(Array.isArray(r.lines) ? r.lines.flatMap(l => [l.productId, l.productName, l.category, l.subcategory, l.vendor, l.batchNo]) : [])
                ]
                    .filter(Boolean)
                    .map(x => String(x).toLowerCase())
                    .join(' | ');
                return hay.includes(q);
            });

            if (!filtered.length) {
                list.innerHTML = `<tr><td colspan="12" class="py-20 text-center text-slate-400 text-sm">暂无运输记录...</td></tr>`;
                return;
            }

            const fmtNum = (n, d = 2) => (Number.isFinite(parseFloat(n)) ? parseFloat(n).toFixed(d) : (0).toFixed(d));
            const fmtMoney = (n) => `¥${fmtNum(n, 2)}`;

            list.innerHTML = filtered.map(r => {
                const created = r.createdAt ? String(r.createdAt).slice(0, 19).replace('T', ' ') : '-';
                const lines = Array.isArray(r.lines) ? r.lines : [];
                const totalWeight = Number.isFinite(parseFloat(r.totalWeightKg)) ? parseFloat(r.totalWeightKg) : lines.reduce((s, l) => s + (parseFloat(l.weightKg) || 0), 0);
                const totalVol = Number.isFinite(parseFloat(r.totalVolumeM3)) ? parseFloat(r.totalVolumeM3) : lines.reduce((s, l) => s + (parseFloat(l.volumeM3) || 0), 0);
                const brief = lines.slice(0, 2).map(l => `${l.productId || ''}×${l.quantity || 0}`).filter(Boolean).join('、');
                const more = lines.length > 2 ? ` 等${lines.length}项` : (lines.length ? '' : '无');
                const batches = [...new Set(lines.map(l => String(l.batchNo || '').trim()).filter(Boolean))];
                const batchFull = batches.join('、');
                const batchBrief = batches.slice(0, 2).join('、') + (batches.length > 2 ? ` 等${batches.length}批` : (batches.length ? '' : '无'));
                const checked = selectedTransportRecords.has(r.id) ? 'checked' : '';
                return `
                    <tr class="hover:bg-slate-50 transition-colors">
                        <td class="py-4 px-4 no-print">
                            <input type="checkbox" class="h-4 w-4" ${checked} onchange="toggleTransportSelect('${r.id}', this.checked)">
                        </td>
                        <td class="py-4 px-4 text-xs text-slate-600">${created}</td>
                        <td class="py-4 px-4 text-sm font-bold text-slate-800">${String(r.trackingNo || '-')}</td>
                        <td class="py-4 px-4 text-xs text-slate-600">${String(r.carrierCompany || '-')}</td>
                        <td class="py-4 px-4 text-xs text-slate-600">${getTransportMethodLabel(r.method)}</td>
                        <td class="py-4 px-4">
                            <select class="border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold outline-none" onchange="updateTransportStatus('${r.id}', this.value)">
                                <option value="draft" ${r.status === 'draft' ? 'selected' : ''}>草稿</option>
                                <option value="in_transit" ${r.status === 'in_transit' ? 'selected' : ''}>运输中</option>
                                <option value="delivered" ${r.status === 'delivered' ? 'selected' : ''}>已到货</option>
                                <option value="cancelled" ${r.status === 'cancelled' ? 'selected' : ''}>已取消</option>
                            </select>
                        </td>
                        <td class="py-4 px-4 text-right text-sm font-mono text-slate-700">${fmtMoney(r.freight)}</td>
                        <td class="py-4 px-4 text-right text-sm font-mono text-slate-700">${fmtNum(totalWeight, 2)}</td>
                        <td class="py-4 px-4 text-right text-sm font-mono text-slate-700">${fmtNum(totalVol, 3)}</td>
                        <td class="py-4 px-4 text-xs text-slate-600" title="${batchFull || ''}">${batchBrief}</td>
                        <td class="py-4 px-4 text-xs text-slate-600">${brief}${more}</td>
                        <td class="py-4 px-4 text-center">
                            <div class="flex items-center justify-center gap-3">
                                <button onclick="openTransportEditModal('${r.id}')" class="text-blue-600 hover:text-blue-800 text-xs font-bold">编辑</button>
                                <button onclick="deleteTransportRecord('${r.id}')" class="text-red-400 hover:text-red-600 text-xs font-bold">删除</button>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');
        };

        window.toggleTransportSelect = (id, checked) => {
            const v = String(id || '');
            if (!v) return;
            if (checked) selectedTransportRecords.add(v);
            else selectedTransportRecords.delete(v);
        };

        window.deleteSelectedTransportRecords = () => {
            const ids = Array.from(selectedTransportRecords);
            if (!ids.length) return alert('请先勾选要删除的运输记录');
            if (!confirm(`确定删除选中的 ${ids.length} 条运输记录？`)) return;
            for (const id of ids) {
                const idx = transportRecords.findIndex(r => r.id === id);
                if (idx === -1) continue;
                const rec = transportRecords[idx];
                transportRecords.splice(idx, 1);
                const invIds = Array.isArray(rec?.lines) ? rec.lines.map(l => l.inventoryId).filter(Boolean) : [];
                for (const invId of invIds) {
                    const item = inventory.find(x => x.id === invId);
                    if (!item) continue;
                    if (Array.isArray(item.transportIds)) item.transportIds = item.transportIds.filter(t => t !== id);
                }
            }
            selectedTransportRecords = new Set();
            saveToLocal();
            renderTransport();
            renderInventory();
            try { renderCompanyCertUploadSelectors(); } catch (e) {}
            try { renderCompanyCertList(); } catch (e) {}
        };

        window.updateTransportStatus = (id, status) => {
            const rec = transportRecords.find(r => r.id === id);
            if (!rec) return;
            rec.status = String(status || 'draft');
            saveToLocal();
            renderTransport();
        };

        window.deleteTransportRecord = (id) => {
            if (!confirm('确定删除该运输记录？')) return;
            const idx = transportRecords.findIndex(r => r.id === id);
            if (idx === -1) return;
            const rec = transportRecords[idx];
            transportRecords.splice(idx, 1);
            const invIds = Array.isArray(rec?.lines) ? rec.lines.map(l => l.inventoryId).filter(Boolean) : [];
            for (const invId of invIds) {
                const item = inventory.find(x => x.id === invId);
                if (!item) continue;
                if (Array.isArray(item.transportIds)) item.transportIds = item.transportIds.filter(t => t !== id);
            }
            saveToLocal();
            renderTransport();
            renderInventory();
            try { renderCompanyCertUploadSelectors(); } catch (e) {}
            try { renderCompanyCertList(); } catch (e) {}
        };

        function ensureTransportModal() {
            let modal = document.getElementById('transport-modal');
            if (modal) return modal;
            modal = document.createElement('div');
            modal.id = 'transport-modal';
            modal.className = 'fixed inset-0 bg-slate-900/60 backdrop-blur-sm hidden items-center justify-center z-[260] p-4';
            document.body.appendChild(modal);
            return modal;
        }
        function buildTransportLinesTable(lines) {
            const safe = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
            return `
                <div class="overflow-x-auto border border-slate-200 rounded-xl">
                    <table class="w-full text-left whitespace-nowrap">
                        <thead class="bg-slate-50/50">
                            <tr class="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                                <th class="py-3 px-3">产品编号</th>
                                <th class="py-3 px-3">产品全称</th>
                                <th class="py-3 px-3">类目</th>
                                <th class="py-3 px-3">子类目</th>
                                <th class="py-3 px-3">供应商</th>
                                <th class="py-3 px-3 text-right">运输数量</th>
                                <th class="py-3 px-3 text-right">重量(kg)</th>
                                <th class="py-3 px-3 text-right">体积(m³)</th>
                                <th class="py-3 px-3">批次</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                            ${lines.map((l, i) => `
                                <tr>
                                    <td class="py-3 px-3 text-xs font-mono text-slate-600">${safe(l.productId)}</td>
                                    <td class="py-3 px-3 text-xs text-slate-700">${safe(l.productName)}</td>
                                    <td class="py-3 px-3 text-xs text-slate-600">${safe(l.category)}</td>
                                    <td class="py-3 px-3 text-xs text-slate-600">${safe(l.subcategory)}</td>
                                    <td class="py-3 px-3 text-xs text-slate-600">${safe(l.vendor)}</td>
                                    <td class="py-3 px-3"><input id="tr-line-qty-${i}" type="number" min="0" class="w-24 text-right border border-slate-200 rounded-lg px-2 py-1 text-xs outline-none" value="${safe(l.quantity)}"></td>
                                    <td class="py-3 px-3"><input id="tr-line-w-${i}" type="number" min="0" step="0.01" class="w-28 text-right border border-slate-200 rounded-lg px-2 py-1 text-xs outline-none" value="${safe(l.weightKg)}"></td>
                                    <td class="py-3 px-3"><input id="tr-line-v-${i}" type="number" min="0" step="0.001" class="w-28 text-right border border-slate-200 rounded-lg px-2 py-1 text-xs outline-none" value="${safe(l.volumeM3)}"></td>
                                    <td class="py-3 px-3 text-xs text-slate-500">${safe(l.batchNo || '-')}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }

        window.onTransportCarrierSelectChange = (v) => {
            const modal = document.getElementById('transport-modal');
            if (!modal) return;
            const input = modal.querySelector('#tr-carrier-new');
            if (!input) return;
            const show = String(v || '') === '__new__';
            input.style.display = show ? '' : 'none';
            if (!show) input.value = '';
        };

        window.openTransportCreateModal = (prefilledLines = [], preset = null) => {
            const modal = ensureTransportModal();
            const lines = Array.isArray(prefilledLines) ? prefilledLines : [];
            const safe = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
            const carriers = [...new Set((Array.isArray(transportRecords) ? transportRecords : []).map(r => String(r?.carrierCompany || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
            const carrierOptions = [
                `<option value="">请选择</option>`,
                ...carriers.map(c => `<option value="${safe(c)}">${safe(c)}</option>`),
                `<option value="__new__">新增...</option>`
            ].join('');
            const isEdit = !!(preset && typeof preset === 'object' && preset.id);
            const saveId = isEdit ? String(preset.id) : '';
            modal.innerHTML = `
                <div class="bg-white rounded-3xl p-6 w-full max-w-5xl shadow-2xl max-h-[90vh] overflow-y-auto">
                    <div class="flex items-center justify-between mb-4">
                        <div>
                            <h3 class="text-xl font-bold text-slate-800">${isEdit ? '编辑运输单' : '新建运输单'}</h3>
                            <p class="text-xs text-slate-400 mt-1">请补全重量/体积等信息后保存</p>
                        </div>
                        <button onclick="closeTransportModal()" class="text-slate-400 hover:text-slate-600 text-2xl">×</button>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                        <div>
                            <div class="text-xs font-bold text-slate-500 mb-1">运输单号</div>
                            <input id="tr-tracking-no" type="text" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none" placeholder="如：AWB/BL/Tracking No">
                        </div>
                        <div>
                            <div class="text-xs font-bold text-slate-500 mb-1">货运公司</div>
                            <select id="tr-carrier" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none" onchange="onTransportCarrierSelectChange(this.value)">
                                ${carrierOptions}
                            </select>
                            <input id="tr-carrier-new" type="text" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none mt-2" placeholder="输入新的货运公司" style="display:none">
                        </div>
                        <div>
                            <div class="text-xs font-bold text-slate-500 mb-1">运输方式</div>
                            <select id="tr-method" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none">
                                <option value="">请选择</option>
                                <option value="sea">海运</option>
                                <option value="air">空运</option>
                                <option value="land">陆运</option>
                                <option value="other">其他</option>
                            </select>
                        </div>
                        <div>
                            <div class="text-xs font-bold text-slate-500 mb-1">运费金额(¥)</div>
                            <input id="tr-freight" type="number" min="0" step="0.01" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none" value="0">
                        </div>
                    </div>
                    ${lines.length ? buildTransportLinesTable(lines) : `<div class="py-16 text-center text-slate-400 text-sm border border-dashed border-slate-200 rounded-2xl">请从库存管理中勾选记录后点击“生成运输单”</div>`}
                    <div class="flex justify-end gap-3 mt-5">
                        <button onclick="closeTransportModal()" class="px-4 py-2 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50">取消</button>
                        <button onclick="saveTransportFromModal('${encodeURIComponent(JSON.stringify(lines))}', '${safe(saveId)}')" class="px-4 py-2 rounded-xl bg-purple-700 text-white font-bold hover:bg-purple-800">保存</button>
                    </div>
                </div>
            `;
            if (isEdit) {
                try {
                    const noEl = modal.querySelector('#tr-tracking-no');
                    const methodEl = modal.querySelector('#tr-method');
                    const freightEl = modal.querySelector('#tr-freight');
                    const carrierEl = modal.querySelector('#tr-carrier');
                    const carrierNewEl = modal.querySelector('#tr-carrier-new');

                    if (noEl) noEl.value = String(preset.trackingNo || '');
                    if (methodEl) methodEl.value = String(preset.method || '');
                    if (freightEl) freightEl.value = Number.isFinite(parseFloat(preset.freight)) ? String(preset.freight) : '0';

                    const carrierVal = String(preset.carrierCompany || '').trim();
                    if (carrierEl) {
                        if (carrierVal && carriers.includes(carrierVal)) {
                            carrierEl.value = carrierVal;
                            window.onTransportCarrierSelectChange(carrierEl.value);
                        } else if (carrierVal) {
                            carrierEl.value = '__new__';
                            window.onTransportCarrierSelectChange(carrierEl.value);
                            if (carrierNewEl) carrierNewEl.value = carrierVal;
                        } else {
                            carrierEl.value = '';
                            window.onTransportCarrierSelectChange(carrierEl.value);
                        }
                    }
                } catch (e) {}
            }
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        };

        window.closeTransportModal = () => {
            const modal = document.getElementById('transport-modal');
            if (!modal) return;
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            modal.innerHTML = '';
        };

        function ensureTransportInventoryPickerModal() {
            let modal = document.getElementById('transport-inv-picker-modal');
            if (modal) return modal;
            modal = document.createElement('div');
            modal.id = 'transport-inv-picker-modal';
            modal.className = 'fixed inset-0 bg-slate-900/60 backdrop-blur-sm hidden items-center justify-center z-[255] p-4';
            document.body.appendChild(modal);
            return modal;
        }
        window.closeTransportInventoryPickerModal = () => {
            const modal = document.getElementById('transport-inv-picker-modal');
            if (!modal) return;
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            modal.innerHTML = '';
            selectedInventoryForTransportPicker = new Set();
        };
        window.toggleInventoryForTransportPicker = (invId, checked) => {
            const id = String(invId || '');
            if (!id) return;
            if (checked) selectedInventoryForTransportPicker.add(id);
            else selectedInventoryForTransportPicker.delete(id);
            try { renderTransportInventoryPickerList(); } catch (e) {}
        };
        window.renderTransportInventoryPickerList = () => {
            const modal = document.getElementById('transport-inv-picker-modal');
            if (!modal) return;
            const list = modal.querySelector('#tr-inv-picker-list');
            if (!list) return;
            const q = String(modal.querySelector('#tr-inv-picker-search')?.value || '').trim().toLowerCase();
            const eligible = inventory.filter(it => (parseFloat(it.quantity) || 0) > 0 && !(Array.isArray(it.transportIds) && it.transportIds.length > 0));
            const filtered = eligible.filter(it => {
                if (!q) return true;
                const p = products.find(x => x.id === it.productId) || {};
                const hay = [it.productId, p.name, p.vendor, it.batchNo, it.location].filter(Boolean).map(x => String(x).toLowerCase()).join(' | ');
                return hay.includes(q);
            });
            if (!filtered.length) {
                list.innerHTML = `<div class="py-16 text-center text-slate-400 text-sm">暂无可用库存记录...</div>`;
                return;
            }
            list.innerHTML = filtered.map(it => {
                const p = products.find(x => x.id === it.productId) || {};
                const checked = selectedInventoryForTransportPicker.has(it.id) ? 'checked' : '';
                return `
                    <label class="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 cursor-pointer border-b border-slate-50">
                        <div class="flex items-center gap-3 min-w-0">
                            <input type="checkbox" class="h-4 w-4" ${checked} onchange="toggleInventoryForTransportPicker('${it.id}', this.checked)">
                            <div class="min-w-0">
                                <div class="text-sm font-bold text-slate-800 truncate">${p.name || '未知产品'}</div>
                                <div class="text-[10px] text-slate-500 truncate">${it.productId || ''} ｜ ${p.vendor || '-'} ｜ 批次 ${it.batchNo || '-'} ｜ 库存 ${formatNumberAuto(it.quantity, 4)}</div>
                            </div>
                        </div>
                        <div class="text-[10px] text-slate-400 text-right whitespace-nowrap">${it.location || '-'}</div>
                    </label>
                `;
            }).join('');
        };
        window.openTransportCreateModalFromInventoryPicker = () => {
            const modal = ensureTransportInventoryPickerModal();
            const eligibleCount = inventory.filter(it => (parseFloat(it.quantity) || 0) > 0 && !(Array.isArray(it.transportIds) && it.transportIds.length > 0)).length;
            modal.innerHTML = `
                <div class="bg-white rounded-3xl p-6 w-full max-w-3xl shadow-2xl max-h-[90vh] overflow-y-auto">
                    <div class="flex items-center justify-between mb-4">
                        <div>
                            <h3 class="text-xl font-bold text-slate-800">从库存生成运输单</h3>
                            <p class="text-xs text-slate-400 mt-1">仅显示未生成运输单的库存记录（${eligibleCount} 条）</p>
                        </div>
                        <button onclick="closeTransportInventoryPickerModal()" class="text-slate-400 hover:text-slate-600 text-2xl">×</button>
                    </div>
                    <div class="mb-3">
                        <input id="tr-inv-picker-search" type="text" placeholder="搜索：产品编号/名称/供应商/批次/仓库" oninput="renderTransportInventoryPickerList()" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none">
                    </div>
                    <div id="tr-inv-picker-list" class="border border-slate-200 rounded-2xl overflow-hidden"></div>
                    <div class="flex justify-end gap-3 mt-5">
                        <button onclick="closeTransportInventoryPickerModal()" class="px-4 py-2 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50">取消</button>
                        <button onclick="confirmTransportCreateFromInventoryPicker()" class="px-4 py-2 rounded-xl bg-purple-700 text-white font-bold hover:bg-purple-800">下一步</button>
                    </div>
                </div>
            `;
            renderTransportInventoryPickerList();
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        };
        window.confirmTransportCreateFromInventoryPicker = () => {
            const ids = Array.from(selectedInventoryForTransportPicker);
            const selected = ids.map(id => inventory.find(x => x.id === id)).filter(Boolean);
            if (!selected.length) return alert('请先勾选要生成运输单的库存记录');
            const lines = selected.map(it => {
                const p = products.find(x => x.id === it.productId) || {};
                return {
                    inventoryId: it.id,
                    batchNo: it.batchNo || '',
                    productId: it.productId || '',
                    productName: p.name || '',
                    category: p.category || '',
                    subcategory: p.scenario || '',
                    vendor: p.vendor || '',
                    quantity: Number.isFinite(parseFloat(it.quantity)) ? parseFloat(it.quantity) : 0,
                    weightKg: '',
                    volumeM3: ''
                };
            });
            closeTransportInventoryPickerModal();
            window.switchTab?.('transport');
            openTransportCreateModal(lines);
        };

        window.openTransportCreateModalFromSelectedInventory = () => {
            const ids = Array.from(selectedInventoryForTransport);
            const rawSelected = ids.map(id => inventory.find(x => x.id === id)).filter(Boolean);
            const selected = rawSelected.filter(it => !(Array.isArray(it.transportIds) && it.transportIds.length > 0));
            if (!selected.length) return alert('请先在库存管理中勾选需要运输的记录');
            const lines = selected.map(it => {
                const p = products.find(x => x.id === it.productId) || {};
                return {
                    inventoryId: it.id,
                    batchNo: it.batchNo || '',
                    productId: it.productId || '',
                    productName: p.name || '',
                    category: p.category || '',
                    subcategory: p.scenario || '',
                    vendor: p.vendor || '',
                    quantity: Number.isFinite(parseFloat(it.quantity)) ? parseFloat(it.quantity) : 0,
                    weightKg: '',
                    volumeM3: ''
                };
            });
            window.switchTab?.('transport');
            openTransportCreateModal(lines);
        };

        window.openTransportEditModal = (id) => {
            const rec = (Array.isArray(transportRecords) ? transportRecords : []).find(r => r.id === id);
            if (!rec) return alert('未找到该运输记录');
            const lines = Array.isArray(rec.lines) ? rec.lines : [];
            openTransportCreateModal(lines, rec);
        };

        window.saveTransportFromModal = (linesJsonEncoded, editingId = '') => {
            const trackingNo = String(document.getElementById('tr-tracking-no')?.value || '').trim();
            const carrierSel = String(document.getElementById('tr-carrier')?.value || '').trim();
            const carrierNew = String(document.getElementById('tr-carrier-new')?.value || '').trim();
            const carrierCompany = carrierSel === '__new__' ? carrierNew : carrierSel;
            const method = String(document.getElementById('tr-method')?.value || '').trim();
            const freight = parseFloat(document.getElementById('tr-freight')?.value || '0') || 0;
            const rawLines = JSON.parse(decodeURIComponent(linesJsonEncoded || '%5B%5D'));
            const lines = Array.isArray(rawLines) ? rawLines : [];
            if (!trackingNo) return alert('运输单号不能为空');
            if (!carrierCompany) return alert('请选择或填写货运公司');
            if (!method) return alert('请选择运输方式');
            if (!lines.length) return alert('运输明细不能为空');

            const finalLines = [];
            let totalW = 0;
            let totalV = 0;
            for (let i = 0; i < lines.length; i++) {
                const base = lines[i] || {};
                const qty = parseFloat(document.getElementById(`tr-line-qty-${i}`)?.value || '0') || 0;
                const w = parseFloat(document.getElementById(`tr-line-w-${i}`)?.value || '') ;
                const v = parseFloat(document.getElementById(`tr-line-v-${i}`)?.value || '') ;
                if (!(qty > 0)) return alert(`第 ${i + 1} 行：运输数量必须大于 0`);
                if (!Number.isFinite(w) || w < 0) return alert(`第 ${i + 1} 行：请填写重量(kg)`);
                if (!Number.isFinite(v) || v < 0) return alert(`第 ${i + 1} 行：请填写体积(m³)`);
                totalW += w;
                totalV += v;
                finalLines.push({ ...base, quantity: qty, weightKg: w, volumeM3: v });
            }

            const editId = String(editingId || '').trim();
            if (editId) {
                const idx = transportRecords.findIndex(r => r.id === editId);
                if (idx === -1) return alert('未找到要编辑的运输记录');
                const old = transportRecords[idx] || {};
                const oldInvIds = new Set((Array.isArray(old.lines) ? old.lines : []).map(l => l.inventoryId).filter(Boolean));
                const nextInvIds = new Set(finalLines.map(l => l.inventoryId).filter(Boolean));

                for (const invId of oldInvIds) {
                    if (nextInvIds.has(invId)) continue;
                    const item = inventory.find(x => x.id === invId);
                    if (!item) continue;
                    if (Array.isArray(item.transportIds)) item.transportIds = item.transportIds.filter(t => t !== editId);
                }
                for (const invId of nextInvIds) {
                    if (oldInvIds.has(invId)) continue;
                    const item = inventory.find(x => x.id === invId);
                    if (!item) continue;
                    if (!Array.isArray(item.transportIds)) item.transportIds = [];
                    if (!item.transportIds.includes(editId)) item.transportIds.push(editId);
                }

                transportRecords[idx] = {
                    ...old,
                    trackingNo,
                    carrierCompany,
                    method,
                    freight,
                    totalWeightKg: totalW,
                    totalVolumeM3: totalV,
                    lines: finalLines
                };
                try {
                    (companyCerts?.transportCerts || []).forEach(f => {
                        if (f && String(f.transportId || '') === editId) f.trackingNo = trackingNo;
                    });
                } catch (e) {}
            } else {
                const rec = {
                    id: `tr_${Date.now()}`,
                    createdAt: new Date().toISOString(),
                    trackingNo,
                    carrierCompany,
                    method,
                    status: 'draft',
                    freight,
                    totalWeightKg: totalW,
                    totalVolumeM3: totalV,
                    lines: finalLines
                };
                transportRecords.push(rec);
                for (const l of finalLines) {
                    const item = inventory.find(x => x.id === l.inventoryId);
                    if (!item) continue;
                    if (!Array.isArray(item.transportIds)) item.transportIds = [];
                    if (!item.transportIds.includes(rec.id)) item.transportIds.push(rec.id);
                }
            }
            selectedInventoryForTransport = new Set();
            saveToLocal();
            renderTransport();
            renderInventory();
            try { renderCompanyCertUploadSelectors(); } catch (e) {}
            try { renderCompanyCertList(); } catch (e) {}
            closeTransportModal();
        };

        // --- 全局浮窗逻辑 ---
        window.showInventoryTooltip = (e, productId) => {
            const summary = getInventorySummary(productId);
            const tooltip = document.getElementById('global-tooltip');
            
            tooltip.innerHTML = `
                <p class="font-bold text-base mb-2 border-b border-slate-600 pb-1">库存汇总: ${productId}</p>
                <div class="space-y-1">
                    <p class="flex justify-between"><span>总数量:</span> <span class="font-bold text-green-400">${summary.totalQuantity}</span></p>
                    <p class="flex justify-between"><span>平均采购价:</span> <span class="font-bold text-blue-400">¥${summary.avgPrice.toFixed(2)}</span></p>
                    <div class="pt-2">
                        <p class="font-bold text-slate-400 mb-1">位置分布:</p>
                        ${Object.entries(summary.locations).map(([loc, qty]) => 
                            `<p class="flex justify-between text-[10px]"><span>${loc}:</span> <span>${qty}</span></p>`
                        ).join('') || '<p class="italic text-slate-500 text-[10px]">无位置信息</p>'}
                    </div>
                </div>
            `;
            
            tooltip.classList.remove('hidden');
            
            // 计算位置：尽量显示在指针上方，防止超出边界
            const x = e.clientX + 15;
            const y = e.clientY - tooltip.offsetHeight - 15;
            
            tooltip.style.left = `${x}px`;
            tooltip.style.top = `${y > 10 ? y : e.clientY + 15}px`;
        };

        window.hideInventoryTooltip = () => {
            document.getElementById('global-tooltip').classList.add('hidden');
        };

        // --- 库存价格编辑逻辑 ---
        function getDefaultImportDutyPercent(category) {
            const c = String(category || '');
            if (c.includes('光伏组件')) return 0;
            if (c.includes('一体机')) return 0;
            if (c.includes('电池')) return 20;
            if (c.includes('逆变器')) return 20;
            return 0;
        }
        function getDefaultSstPercent() {
            return 10;
        }
        function getDefaultGrayTaxPercent() {
            return 5;
        }
        function computeInventoryPricing({ item, product }) {
            const spec = Number.isFinite(parseFloat(item?.spec)) ? parseFloat(item.spec) : 1;
            const avgCost = getAverageInventoryCostPerSpec(item?.productId, spec);
            const dutyPct = Number.isFinite(parseFloat(item?.importDutyPct)) ? parseFloat(item.importDutyPct) : getDefaultImportDutyPercent(product?.category);
            const sstPct = Number.isFinite(parseFloat(item?.sstPct)) ? parseFloat(item.sstPct) : getDefaultSstPercent();
            const grayPct = Number.isFinite(parseFloat(item?.grayTaxPct)) ? parseFloat(item.grayTaxPct) : getDefaultGrayTaxPercent();

            const cat = String(product?.category || '').trim();
            const sub = String(product?.scenario || '').trim();
            profitSettings = normalizeProfitSettings(profitSettings || safeJsonParseLoose(localStorage.getItem('minova_profit_settings_v1'), null));
            const cnHomePct = getProfitPct('cn_parent', 'home', cat, sub);
            const myHomePct = getProfitPct('my_sub', 'home', cat, sub);
            const cnBizPct = getProfitPct('cn_parent', 'biz', cat, sub);
            const myBizPct = getProfitPct('my_sub', 'biz', cat, sub);

            const clearanceCost = avgCost * (1 + dutyPct / 100 + sstPct / 100);
            const grayCost = avgCost * (1 + grayPct / 100);
            const homeMul = 1 + (cnHomePct + myHomePct) / 100;
            const bizMul = 1 + (cnBizPct + myBizPct) / 100;

            return {
                spec,
                avgCost,
                dutyPct,
                sstPct,
                grayPct,
                clearanceCost,
                grayCost,
                cnHomePct,
                myHomePct,
                cnBizPct,
                myBizPct,
                clearanceHomePrice: clearanceCost * homeMul,
                clearanceBizPrice: clearanceCost * bizMul,
                grayHomePrice: grayCost * homeMul,
                grayBizPrice: grayCost * bizMul
            };
        }
        window.recalcInventoryPricingModal = () => {
            const item = inventory.find(i => i.id === window.editingInvId);
            if (!item) return;
            const product = products.find(p => p.id === item.productId) || {};

            const dutyEl = document.getElementById('edit-inv-import-duty');
            const sstEl = document.getElementById('edit-inv-sst');
            const grayEl = document.getElementById('edit-inv-gray-tax');

            const dutyPct = Number.isFinite(parseFloat(dutyEl?.value)) ? parseFloat(dutyEl.value) : getDefaultImportDutyPercent(product.category);
            const sstPct = Number.isFinite(parseFloat(sstEl?.value)) ? parseFloat(sstEl.value) : getDefaultSstPercent();
            const grayPct = Number.isFinite(parseFloat(grayEl?.value)) ? parseFloat(grayEl.value) : getDefaultGrayTaxPercent();
            const tempItem = { ...item, importDutyPct: dutyPct, sstPct: sstPct, grayTaxPct: grayPct };
            const r = computeInventoryPricing({ item: tempItem, product });
            const set = (id, v, digits = 2) => {
                const el = document.getElementById(id);
                if (!el) return;
                el.value = Number.isFinite(parseFloat(v)) ? parseFloat(v).toFixed(digits) : '0.00';
            };

            set('edit-inv-avg-cost', r.avgCost, 4);
            if (dutyEl && String(dutyEl.value ?? '').trim() === '') dutyEl.value = String(r.dutyPct);
            if (sstEl && String(sstEl.value ?? '').trim() === '') sstEl.value = String(r.sstPct);
            if (grayEl && String(grayEl.value ?? '').trim() === '') grayEl.value = String(r.grayPct);
            set('edit-inv-clearance-cost', r.clearanceCost, 4);
            set('edit-inv-gray-cost', r.grayCost, 4);
            set('edit-profit-cn-home', r.cnHomePct);
            set('edit-profit-my-home', r.myHomePct);
            set('edit-profit-cn-biz', r.cnBizPct);
            set('edit-profit-my-biz', r.myBizPct);
            set('edit-price-clearance-home', r.clearanceHomePrice, 4);
            set('edit-price-clearance-biz', r.clearanceBizPrice, 4);
            set('edit-price-gray-home', r.grayHomePrice, 4);
            set('edit-price-gray-biz', r.grayBizPrice, 4);
        };
        window.openInventoryEditModal = (id) => {
            const item = inventory.find(i => i.id === id);
            if (!item) return;
            window.editingInvId = id;
            const product = products.find(p => p.id === item.productId) || {};
            const dutyEl = document.getElementById('edit-inv-import-duty');
            const sstEl = document.getElementById('edit-inv-sst');
            const grayEl = document.getElementById('edit-inv-gray-tax');
            if (dutyEl) dutyEl.value = Number.isFinite(parseFloat(item.importDutyPct)) ? String(parseFloat(item.importDutyPct)) : String(getDefaultImportDutyPercent(product.category));
            if (sstEl) sstEl.value = Number.isFinite(parseFloat(item.sstPct)) ? String(parseFloat(item.sstPct)) : String(getDefaultSstPercent());
            if (grayEl) grayEl.value = Number.isFinite(parseFloat(item.grayTaxPct)) ? String(parseFloat(item.grayTaxPct)) : String(getDefaultGrayTaxPercent());
            recalcInventoryPricingModal();
            document.getElementById('inventory-edit-modal').classList.remove('hidden');
        };

        window.closeInventoryEditModal = () => {
            document.getElementById('inventory-edit-modal').classList.add('hidden');
        };

        window.updateInventoryPrices = () => {
            const item = inventory.find(i => i.id === window.editingInvId);
            if (!item) return;

            const product = products.find(p => p.id === item.productId) || {};
            const oldDuty = Number.isFinite(parseFloat(item.importDutyPct)) ? parseFloat(item.importDutyPct) : 0;
            const oldSst = Number.isFinite(parseFloat(item.sstPct)) ? parseFloat(item.sstPct) : 0;
            const oldGray = Number.isFinite(parseFloat(item.grayTaxPct)) ? parseFloat(item.grayTaxPct) : 0;
            const oldCh = Number.isFinite(parseFloat(item.clearanceHomePrice)) ? parseFloat(item.clearanceHomePrice) : 0;
            const oldCb = Number.isFinite(parseFloat(item.clearanceBizPrice)) ? parseFloat(item.clearanceBizPrice) : 0;
            const oldGh = Number.isFinite(parseFloat(item.grayHomePrice)) ? parseFloat(item.grayHomePrice) : 0;
            const oldGb = Number.isFinite(parseFloat(item.grayBizPrice)) ? parseFloat(item.grayBizPrice) : 0;

            const dutyPct = parseFloat(document.getElementById('edit-inv-import-duty')?.value) || 0;
            const sstPct = parseFloat(document.getElementById('edit-inv-sst')?.value) || 0;
            const grayPct = parseFloat(document.getElementById('edit-inv-gray-tax')?.value) || 0;
            item.importDutyPct = dutyPct;
            item.sstPct = sstPct;
            item.grayTaxPct = grayPct;

            const r = computeInventoryPricing({ item, product });
            item.clearanceHomePrice = r.clearanceHomePrice;
            item.clearanceBizPrice = r.clearanceBizPrice;
            item.grayHomePrice = r.grayHomePrice;
            item.grayBizPrice = r.grayBizPrice;
            item.suggestedRetailPrice = r.clearanceHomePrice;
            item.suggestedProjectPrice = r.clearanceBizPrice;

            pushInventoryHistory({
                ts: Date.now(),
                type: 'price',
                productId: item.productId,
                productName: product.name || '未知产品',
                quantity: item.quantity,
                batchNo: item.batchNo,
                note: `定价 税率 关税:${oldDuty.toFixed(2)}→${dutyPct.toFixed(2)} SST:${oldSst.toFixed(2)}→${sstPct.toFixed(2)} 灰清:${oldGray.toFixed(2)}→${grayPct.toFixed(2)} | 清关家用:${oldCh.toFixed(2)}→${r.clearanceHomePrice.toFixed(2)} 清关工商:${oldCb.toFixed(2)}→${r.clearanceBizPrice.toFixed(2)} 灰清家用:${oldGh.toFixed(2)}→${r.grayHomePrice.toFixed(2)} 灰清工商:${oldGb.toFixed(2)}→${r.grayBizPrice.toFixed(2)}`
            });
            
            saveToLocal();
            closeInventoryEditModal();
        };

        function pushInventoryHistory(entry) {
            inventoryHistory.push(entry);
            if (inventoryHistory.length > 1000) inventoryHistory = inventoryHistory.slice(inventoryHistory.length - 1000);
        }

        function formatYmd(dateStr) {
            if (!dateStr) return '';
            return String(dateStr).replaceAll('-', '');
        }

        function getDefaultDomesticTaxRatePercent(category) {
            const c = String(category || '');
            if (c.includes('光伏组件')) return 13;
            if (c.includes('光伏') && (c.includes('组件') || c.includes('板'))) return 13;
            if (c.includes('一体机')) return 0;
            if (c.includes('电池')) return 6;
            if (c.includes('逆变器')) return 6;
            if (c.includes('配件')) return 6;
            return 6;
        }

        function generateNextBatchNoForDate(ymd) {
            const prefix = `${ymd}-`;
            const used = new Set(inventory.map(i => String(i.batchNo || '')).filter(Boolean));
            let maxSeq = 0;
            inventory.forEach(i => {
                const b = String(i.batchNo || '');
                if (!b.startsWith(prefix)) return;
                const tail = b.slice(prefix.length);
                const n = parseInt(tail, 10);
                if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
            });
            let seq = maxSeq + 1;
            while (seq <= 999) {
                const next = `${prefix}${String(seq).padStart(3, '0')}`;
                if (!used.has(next)) return next;
                seq++;
            }
            return `${prefix}${String(Date.now()).slice(-3)}`;
        }

        window.onInventoryPurchaseDateChange = () => {
            const d = document.getElementById('inv-purchase-date')?.value || '';
            const ymd = formatYmd(d);
            const el = document.getElementById('inv-batch-no');
            if (el && ymd) el.value = generateNextBatchNoForDate(ymd);
        };

        window.onInventoryProductChange = () => {
            const productId = document.getElementById('inv-product-id')?.value || '';
            const p = products.find(x => x.id === productId);
            const vendorEl = document.getElementById('inv-vendor');
            const subEl = document.getElementById('inv-subcategory');
            if (vendorEl) vendorEl.value = p?.vendor || '';
            if (subEl) subEl.value = p?.scenario || '';
            if (p) {
                const priceEl = document.getElementById('inv-price');
                if (priceEl && !priceEl.value) priceEl.value = String(parseFloat(p.cost || 0).toFixed(2));
                const taxEl = document.getElementById('inv-domestic-tax-rate');
                if (taxEl && !taxEl.value) taxEl.value = String(getDefaultDomesticTaxRatePercent(p.category));
            }
            recalcInventoryCosts();
        };

        window.recalcInventoryCosts = () => {
            const qty = parseFloat(document.getElementById('inv-quantity')?.value) || 0;
            const spec = parseFloat(document.getElementById('inv-spec')?.value) || 0;
            const batchPrice = parseFloat(document.getElementById('inv-price')?.value) || 0;
            const shippingRatePct = parseFloat(document.getElementById('inv-shipping-rate')?.value) || 0;
            const taxRatePct = parseFloat(document.getElementById('inv-domestic-tax-rate')?.value) || 0;

            const unitPrice = batchPrice * (spec || 0);
            const purchaseTotal = unitPrice * qty;
            const shippingCost = purchaseTotal * (shippingRatePct / 100);
            const domesticTax = purchaseTotal * (taxRatePct / 100);
            const totalCost = purchaseTotal + shippingCost + domesticTax;

            const unitEl = document.getElementById('inv-unit-price');
            const totalEl = document.getElementById('inv-purchase-total');
            const shipEl = document.getElementById('inv-shipping-cost');
            const taxEl = document.getElementById('inv-domestic-tax');
            const allEl = document.getElementById('inv-total-cost');
            const avgEl = document.getElementById('inv-avg-cost');
            if (unitEl) unitEl.value = unitPrice ? unitPrice.toFixed(2) : '0.00';
            if (totalEl) totalEl.value = purchaseTotal ? purchaseTotal.toFixed(2) : '0.00';
            if (shipEl) shipEl.value = shippingCost ? shippingCost.toFixed(2) : '0.00';
            if (taxEl) taxEl.value = domesticTax ? domesticTax.toFixed(2) : '0.00';
            if (allEl) allEl.value = totalCost ? totalCost.toFixed(2) : '0.00';
            if (avgEl) {
                const productId = document.getElementById('inv-product-id')?.value || '';
                const avg = getAverageInventoryCostPerSpec(productId, spec || 1);
                avgEl.value = avg ? avg.toFixed(2) : '0.00';
            }
        };

        function getItemTotalCost(item) {
            const qty = parseFloat(item.quantity) || 0;
            const unitPrice = item.unitPurchasePrice || ((parseFloat(item.purchasePrice) || 0) * (parseFloat(item.spec) || 1));
            const purchaseTotal = item.purchaseTotal ?? (unitPrice * qty);
            const shippingRatePct = ((item.shippingRate ?? 0.08) * 100);
            const taxRatePct = ((item.domesticTaxRate ?? 0.06) * 100);
            const shippingCost = item.shippingCost ?? (purchaseTotal * (shippingRatePct / 100));
            const domesticTax = item.domesticTax ?? (purchaseTotal * (taxRatePct / 100));
            return item.totalCost ?? (purchaseTotal + shippingCost + domesticTax);
        }

        function getAverageInventoryCostPerSpec(productId, spec) {
            const id = String(productId || '').trim();
            if (!id) return 0;
            const s = parseFloat(spec) || 1;
            const items = inventory.filter(i => i.productId === id);
            const totalQty = items.reduce((sum, i) => sum + (parseFloat(i.quantity) || 0), 0);
            if (totalQty <= 0) return 0;
            const totalCost = items.reduce((sum, i) => sum + (getItemTotalCost(i) || 0), 0);
            return (totalCost / totalQty) / s;
        }

        window.recalcInstallerQuote = () => {
            const labor = parseFloat(document.getElementById('installer-labor')?.value) || 0;
            const bracket = parseFloat(document.getElementById('installer-bracket')?.value) || 0;
            const cable = parseFloat(document.getElementById('installer-cable')?.value) || 0;
            const totalMyr = labor + bracket + cable;
            const rate = parseFloat(document.getElementById('rate-myr-cny')?.value) || 1.53;
            const totalCny = totalMyr * rate;

            const myrEl = document.getElementById('installer-total-myr');
            const cnyEl = document.getElementById('installer-total-cny');
            if (myrEl) myrEl.value = totalMyr.toFixed(4);
            if (cnyEl) cnyEl.value = totalCny.toFixed(4);
            const cnProfitEl = document.getElementById('installer-profit-cn');
            const myProfitEl = document.getElementById('installer-profit-my');
            const feeEl = document.getElementById('installer-install-fee-cny');
            const feeMyrEl = document.getElementById('installer-install-fee-myr');
            if (cnProfitEl && myProfitEl && feeEl) {
                const cnPct = parseFloat(cnProfitEl.value) || 0;
                const myPct = parseFloat(myProfitEl.value) || 0;
                const fee = totalCny * (1 + (cnPct + myPct) / 100);
                feeEl.value = fee.toFixed(4);
                if (feeMyrEl) feeMyrEl.value = (fee / rate).toFixed(4);
                installerProfitSettings = normalizeInstallerProfitSettings({ cnPct, myPct });
                try { localStorage.setItem('minova_installer_profit_v1', JSON.stringify(installerProfitSettings)); } catch (e) {}
            }
            try {
                localStorage.setItem('minova_installer_quote_v1', JSON.stringify({ labor, bracket, cable }));
            } catch (e) {}
        };

        function getDefaultPvModuleQuantity() {
            let total = 0;
            for (const r of quoteRows) {
                if (r.isBlank) continue;
                const qty = parseFloat(r.quantity) || 0;
                if (qty <= 0) continue;
                const desc = String(r.description || '').trim();
                if (!desc) continue;
                const p = products.find(x => String(x?.name || '').trim() === desc);
                if (p && String(p.category || '').includes('光伏组件')) {
                    total += qty;
                    continue;
                }
                if (desc.includes('光伏组件') || desc.includes('组件')) total += qty;
            }
            return total > 0 ? total : 1;
        }

        window.openInstallModal = (mode) => {
            window.installMode = mode === 'domestic' ? 'domestic' : 'overseas';
            const modal = document.getElementById('install-modal');
            if (!modal) return;
            modal.classList.remove('hidden');

            const titleEl = document.getElementById('install-title');
            const descEl = document.getElementById('install-desc');
            const unitEl = document.getElementById('install-unit-price');
            const qtyEl = document.getElementById('install-qty');

            const isDomestic = window.installMode === 'domestic';
            if (titleEl) titleEl.textContent = isDomestic ? '施工安装 · 国内施工费' : '施工安装 · 海外施工费';
            if (descEl) descEl.value = isDomestic ? '国内施工费' : '海外施工费';

            const overseasUnit = parseFloat(document.getElementById('installer-install-fee-cny')?.value) || 0;
            if (unitEl) {
                unitEl.value = isDomestic ? '0' : String(overseasUnit.toFixed(4));
                unitEl.readOnly = !isDomestic;
                unitEl.classList.toggle('bg-slate-50', !isDomestic);
            }
            if (qtyEl) qtyEl.value = String(isDomestic ? 1 : getDefaultPvModuleQuantity());
            recalcInstallModal();
        };
        window.closeInstallModal = () => {
            const modal = document.getElementById('install-modal');
            if (modal) modal.classList.add('hidden');
        };
        window.recalcInstallModal = () => {
            const unit = parseFloat(document.getElementById('install-unit-price')?.value) || 0;
            const qty = parseFloat(document.getElementById('install-qty')?.value) || 0;
            const sub = unit * qty;
            const el = document.getElementById('install-subtotal');
            if (el) el.value = sub.toFixed(4);
        };
        window.applyInstallToQuote = () => {
            const desc = String(document.getElementById('install-desc')?.value || '').trim() || '施工安装';
            const unit = parseFloat(document.getElementById('install-unit-price')?.value) || 0;
            const qty = Math.max(0, parseFloat(document.getElementById('install-qty')?.value) || 0);
            if (qty <= 0) return alert('请输入数量');
            if (unit < 0) return alert('单价不能为负数');

            const row = { id: Date.now(), description: desc, spec: '', batchNo: '', quantity: qty, price: unit, cost: 0 };
            const firstBlankIdx = quoteRows.findIndex(r => r.isBlank);
            const insertIdx = firstBlankIdx === -1 ? quoteRows.length : firstBlankIdx;
            quoteRows.splice(insertIdx, 0, row);
            closeInstallModal();
            renderQuote();
        };

        window.changeInventoryHistoryPage = (delta) => {
            const per = 10;
            const totalPages = Math.max(1, Math.min(100, Math.ceil(inventoryHistory.length / per)));
            inventoryHistoryPage = Math.min(Math.max(inventoryHistoryPage + delta, 1), totalPages);
            renderInventoryHistory();
        };

        window.exportInventoryHistory = () => {
            const rows = [...inventoryHistory].reverse().map(h => ({
                操作时间: new Date(h.ts).toLocaleString(),
                类型: h.type,
                产品编号: h.productId,
                产品名称: h.productName,
                数量: h.quantity,
                批次号: h.batchNo || '',
                说明: h.note || ''
            }));
            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, '历史操作记录');
            XLSX.writeFile(wb, '库存历史操作记录.xlsx');
        };

        window.renderInventoryHistory = () => {
            const list = document.getElementById('inventory-history-list');
            if(!list) return;
            const per = 10;
            const totalPages = Math.max(1, Math.min(100, Math.ceil(inventoryHistory.length / per)));
            if (inventoryHistoryPage > totalPages) inventoryHistoryPage = totalPages;
            const start = (inventoryHistoryPage - 1) * per;
            const slice = [...inventoryHistory].reverse().slice(start, start + per);
            if(inventoryHistory.length === 0) {
                list.innerHTML = `<tr><td colspan="7" class="py-10 text-center text-slate-400 text-sm">暂无操作记录...</td></tr>`;
                const pageEl = document.getElementById('inventory-history-page');
                if (pageEl) pageEl.textContent = `1 / 1`;
                const sumEl = document.getElementById('inventory-history-summary');
                if (sumEl) sumEl.textContent = `共 0 条`;
                return;
            }
            const pageEl = document.getElementById('inventory-history-page');
            if (pageEl) pageEl.textContent = `${inventoryHistoryPage} / ${totalPages}`;
            const sumEl = document.getElementById('inventory-history-summary');
            if (sumEl) sumEl.textContent = `共 ${inventoryHistory.length} 条（每页 10 条，最多保留 1000 条）`;

            list.innerHTML = slice.map(h => `
                <tr class="hover:bg-slate-50 transition-colors">
                    <td class="py-3 px-4 text-xs text-slate-500">${new Date(h.ts).toLocaleString()}</td>
                    <td class="py-3 px-4 text-xs font-bold ${h.type === 'in' ? 'text-green-600' : h.type === 'out' ? 'text-orange-600' : (h.type === 'price' || h.type === 'edit') ? 'text-purple-600' : h.type === 'modify' ? 'text-blue-600' : 'text-red-600'}">${h.type === 'in' ? '入库' : h.type === 'out' ? '出库' : (h.type === 'price' || h.type === 'edit') ? '定价' : h.type === 'modify' ? '修改' : '删除'}</td>
                    <td class="py-3 px-4 text-xs font-mono text-slate-500">${h.productId}</td>
                    <td class="py-3 px-4 text-xs text-slate-700">${h.productName}</td>
                    <td class="py-3 px-4 text-xs font-bold">${h.type === 'in' ? '+' : h.type === 'out' ? '-' : ''}${h.quantity ?? ''}</td>
                    <td class="py-3 px-4 text-xs text-slate-500">${h.batchNo || '-'}</td>
                    <td class="py-3 px-4 text-xs text-slate-500 truncate max-w-[150px]" title="${h.note || ''}">${h.note || '-'}</td>
                </tr>
            `).join('');
        };

        window.renderSalesRecords = () => {
            const list = document.getElementById('sales-records-list');
            const sumEl = document.getElementById('sales-records-summary');
            if (!list || !sumEl) return;
            const rows = Array.isArray(salesRecords) ? salesRecords : [];
            sumEl.textContent = `共 ${rows.length} 条`;
            if (rows.length === 0) {
                list.innerHTML = `<tr><td colspan="18" class="py-10 text-center text-slate-400 text-sm">暂无销售记录...</td></tr>`;
                return;
            }
            list.innerHTML = rows.slice(0, 500).map(r => {
                const finalPrice = parseFloat(r.finalContractPrice) || 0;
                const qty = parseFloat(r.quantity) || 0;
                const spec = parseFloat(r.spec) || 1;
                const avgCostPerSpec = parseFloat(r.avgCostPerSpec) || 0;
                const goodsCost = avgCostPerSpec * spec * qty;
                const customsFee = computeSalesCustomsFeeByType({
                    avgCostPerSpec,
                    spec,
                    qty,
                    priceType: r.priceType,
                    dutyPct: r.dutyPct,
                    sstPct: r.sstPct,
                    grayPct: r.grayPct,
                    fallback: r.customsFee
                });
                const profit = finalPrice - goodsCost - customsFee;
                const margin = finalPrice > 0 ? (profit / finalPrice * 100) : 0;
                const mClass = margin >= 15 ? 'text-green-700 bg-green-50' : margin >= 0 ? 'text-orange-700 bg-orange-50' : 'text-red-700 bg-red-50';
                return `
                    <tr class="hover:bg-slate-50 transition-colors">
                        <td class="py-3 px-4 text-xs font-mono text-slate-600">${r.productId || '-'}</td>
                        <td class="py-3 px-4 text-xs font-bold text-slate-700 max-w-[180px] truncate" title="${r.productName || ''}">${r.productName || '-'}</td>
                        <td class="py-3 px-4 text-xs text-slate-600">${r.category || '-'}</td>
                        <td class="py-3 px-4 text-xs text-slate-600">${r.subcategory || '-'}</td>
                        <td class="py-3 px-4 text-xs text-slate-600">${r.vendor || '-'}</td>
                        <td class="py-3 px-4 text-xs text-slate-500">${r.outAt ? `${r.outDate || ''} ${new Date(r.outAt).toLocaleTimeString()}`.trim() : (r.outDate || '-')}</td>
                        <td class="py-3 px-4 text-xs text-right font-bold text-slate-700">${qty}</td>
                        <td class="py-3 px-4 text-xs text-slate-600">${r.contractNo || '-'}</td>
                        <td class="py-3 px-4 text-xs text-right font-mono text-slate-700">¥${(parseFloat(r.salesPrice) || 0).toFixed(4)}</td>
                        <td class="py-3 px-4 text-xs text-right font-mono text-slate-700">${spec.toFixed(2)}</td>
                        <td class="py-3 px-4 text-xs text-right font-mono text-purple-700 font-black">¥${finalPrice.toFixed(2)}</td>
                        <td class="py-3 px-4 text-xs text-right font-mono text-slate-700">¥${goodsCost.toFixed(2)}</td>
                        <td class="py-3 px-4 text-xs text-right font-mono text-slate-700">¥${customsFee.toFixed(2)}</td>
                        <td class="py-3 px-4 text-xs text-right font-mono text-slate-900 font-black">¥${profit.toFixed(2)}</td>
                        <td class="py-3 px-4 text-xs text-right"><span class="px-2 py-1 rounded ${mClass} text-[10px] font-black">${margin.toFixed(1)}%</span></td>
                        <td class="py-3 px-4 text-xs text-slate-600">${r.salesperson || '-'}</td>
                        <td class="py-3 px-4 text-xs text-slate-600">${r.outWarehouse || '-'}</td>
                        <td class="py-3 px-4 text-xs text-center">
                            <div class="flex items-center justify-center gap-2">
                                <button onclick="editSalesRecord('${r.id}')" class="text-blue-700 hover:bg-blue-50 p-1 rounded text-xs">修改</button>
                                <button onclick="deleteSalesRecord('${r.id}')" class="text-red-600 hover:bg-red-50 p-1 rounded text-xs">删除</button>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');
        };

        function computeSalesCustomsFeeByType({ avgCostPerSpec, spec, qty, priceType, dutyPct, sstPct, grayPct, fallback }) {
            const base = (parseFloat(avgCostPerSpec) || 0) * (parseFloat(spec) || 0) * (parseFloat(qty) || 0);
            const pt = String(priceType || '');
            const duty = parseFloat(dutyPct);
            const sst = parseFloat(sstPct);
            const gray = parseFloat(grayPct);
            if (pt.startsWith('clearance_') && Number.isFinite(duty) && Number.isFinite(sst)) return base * ((duty + sst) / 100);
            if (pt.startsWith('gray_') && Number.isFinite(gray)) return base * (gray / 100);
            const fb = parseFloat(fallback);
            return Number.isFinite(fb) ? fb : 0;
        }
        function restoreArchivedInventoryItemById(id, qtyToAdd) {
            const qty = parseInt(qtyToAdd, 10) || 0;
            if (!id || qty <= 0) return;
            const live = inventory.find(i => i.id === id);
            if (live) {
                live.quantity = (parseInt(live.quantity, 10) || 0) + qty;
                return;
            }
            const idx = historicalInventory.findIndex(i => i.id === id);
            if (idx === -1) return;
            const item = historicalInventory[idx];
            historicalInventory.splice(idx, 1);
            const { archivedAt, archivedReason, ...rest } = item || {};
            inventory.push({ ...rest, quantity: qty });
        }
        function archiveZeroQtyInventoryItems(reason) {
            const now = Date.now();
            const toArchive = [];
            for (const item of inventory) {
                const q = parseInt(item.quantity, 10) || 0;
                if (q <= 0) toArchive.push({ ...item, quantity: 0, archivedAt: now, archivedReason: String(reason || '') });
            }
            if (toArchive.length) {
                inventory = inventory.filter(i => (parseInt(i.quantity, 10) || 0) > 0);
                historicalInventory.unshift(...toArchive);
                if (historicalInventory.length > 10000) historicalInventory = historicalInventory.slice(0, 10000);
            }
        }
        window.openHistoricalInventoryModal = () => {
            const modal = document.getElementById('historical-inventory-modal');
            if (modal) modal.classList.remove('hidden');
            renderHistoricalInventory();
        };
        window.closeHistoricalInventoryModal = () => {
            const modal = document.getElementById('historical-inventory-modal');
            if (modal) modal.classList.add('hidden');
        };
        window.renderHistoricalInventory = () => {
            const list = document.getElementById('historical-inventory-list');
            const sumEl = document.getElementById('historical-inventory-summary');
            if (!list || !sumEl) return;
            const rows = Array.isArray(historicalInventory) ? historicalInventory : [];
            sumEl.textContent = `共 ${rows.length} 条`;
            if (rows.length === 0) {
                list.innerHTML = `<tr><td colspan="12" class="py-10 text-center text-slate-400 text-sm">暂无历史库存...</td></tr>`;
                return;
            }
            list.innerHTML = rows.slice(0, 500).map(it => {
                const p = products.find(x => x.id === it.productId) || {};
                return `
                    <tr class="hover:bg-slate-50 transition-colors">
                        <td class="py-3 px-4 text-xs text-slate-500">${it.archivedAt ? new Date(it.archivedAt).toLocaleString() : '-'}</td>
                        <td class="py-3 px-4 text-xs font-mono text-slate-600">${it.productId || '-'}</td>
                        <td class="py-3 px-4 text-xs font-bold text-slate-700 max-w-[180px] truncate" title="${p.name || ''}">${p.name || '-'}</td>
                        <td class="py-3 px-4 text-xs text-slate-600">${p.category || '-'}</td>
                        <td class="py-3 px-4 text-xs text-slate-600">${p.scenario || '-'}</td>
                        <td class="py-3 px-4 text-xs text-slate-600">${p.vendor || '-'}</td>
                        <td class="py-3 px-4 text-xs text-slate-500">${it.purchaseDate || '-'}</td>
                        <td class="py-3 px-4 text-xs text-slate-500">${it.batchNo || '-'}</td>
                        <td class="py-3 px-4 text-xs text-right font-mono text-slate-700">${(parseFloat(it.spec) || 1).toFixed(2)}</td>
                        <td class="py-3 px-4 text-xs text-right font-mono text-slate-700">¥${(parseFloat(it.purchasePrice) || 0).toFixed(4)}</td>
                        <td class="py-3 px-4 text-xs text-slate-600">${it.location || '-'}</td>
                        <td class="py-3 px-4 text-xs text-slate-500 truncate max-w-[160px]" title="${it.archivedReason || ''}">${it.archivedReason || '-'}</td>
                    </tr>
                `;
            }).join('');
        };
        window.exportHistoricalInventory = () => {
            const rows = (Array.isArray(historicalInventory) ? historicalInventory : []).map(it => {
                const p = products.find(x => x.id === it.productId) || {};
                return {
                    归档时间: it.archivedAt ? new Date(it.archivedAt).toLocaleString() : '',
                    归档原因: it.archivedReason || '',
                    产品编号: it.productId || '',
                    产品全称: p.name || '',
                    类目: p.category || '',
                    子类目: p.scenario || '',
                    供应商: p.vendor || '',
                    采购入库时间: it.purchaseDate || '',
                    批次号: it.batchNo || '',
                    规格: parseFloat(it.spec) || 1,
                    批次采购价格: parseFloat(it.purchasePrice) || 0,
                    单位采购价: parseFloat(it.unitPurchasePrice) || 0,
                    运费比率: parseFloat(it.shippingRate) || 0,
                    国内税率: parseFloat(it.domesticTaxRate) || 0,
                    仓库: it.location || '',
                    原始记录: JSON.stringify(it)
                };
            });
            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, '历史库存');
            XLSX.writeFile(wb, '历史库存.xlsx');
        };

        window.editSalesRecord = (id) => {
            const r = salesRecords.find(x => x.id === id);
            if (!r) return;
            openSalesOutModal({ recordId: id });
        };
        window.deleteSalesRecord = (id) => {
            const idx = salesRecords.findIndex(x => x.id === id);
            if (idx === -1) return;
            const r = salesRecords[idx];
            if (!confirm('确定删除该销售出库记录吗？将尝试回滚库存。')) return;
            const alloc = Array.isArray(r.allocations) ? r.allocations : [];
            for (const a of alloc) {
                restoreArchivedInventoryItemById(a.id, a.qty);
            }
            salesRecords.splice(idx, 1);
            pushInventoryHistory({
                ts: Date.now(),
                type: 'modify',
                productId: r.productId,
                productName: r.productName,
                quantity: r.quantity,
                batchNo: '',
                note: `删除销售出库记录并回滚库存 | 合同：${r.contractNo || '-'}`
            });
            saveToLocal();
        };

        function getInventorySummary(productId) {
            const items = inventory.filter(i => i.productId === productId);
            const totalQuantity = items.reduce((sum, i) => sum + i.quantity, 0);
            const totalCost = items.reduce((sum, i) => sum + i.quantity * (i.unitPurchasePrice || i.purchasePrice || 0), 0);
            const avgPrice = totalQuantity > 0 ? totalCost / totalQuantity : 0;
            const locations = items.reduce((acc, i) => {
                if(i.location) acc[i.location] = (acc[i.location] || 0) + i.quantity;
                return acc;
            }, {});
            return { totalQuantity, avgPrice, locations };
        }

        window.openInventoryModal = (type, targetId = '') => {
            const modal = document.getElementById('inventory-modal');
            modal.classList.remove('hidden');
            window.inventoryType = type;
            window.inventoryTargetId = targetId; // 记录是针对哪个批次的出库
            const productEl = document.getElementById('inv-product-id');
            if (productEl) {
                productEl.readOnly = type === 'out' || type === 'edit';
                productEl.classList.toggle('bg-slate-50', productEl.readOnly);
            }
            const qtyLabel = document.getElementById('inv-quantity-label');
            const outDateWrap = document.getElementById('inv-out-date-container');
            const outNatureWrap = document.getElementById('inv-out-nature-container');
            const transferFromWrap = document.getElementById('inv-transfer-from-container');
            const transferToWrap = document.getElementById('inv-transfer-to-container');
            if (outDateWrap) outDateWrap.style.display = type === 'out' ? 'block' : 'none';
            if (outNatureWrap) outNatureWrap.style.display = type === 'out' ? 'block' : 'none';
            if (transferFromWrap) transferFromWrap.style.display = 'none';
            if (transferToWrap) transferToWrap.style.display = 'none';

            if(type === 'in') {
                if (qtyLabel) qtyLabel.textContent = '采购数量';
                document.getElementById('inv-title').innerText = '产品入库';
                document.getElementById('inv-product-id').value = targetId; // 这里targetId传的是productId
                document.getElementById('inv-quantity').value = '';
                document.getElementById('inv-spec').value = '1';
                document.getElementById('inv-price').value = '';
                document.getElementById('inv-location').value = '';
                document.getElementById('inv-shipping-rate').value = '8';
                document.getElementById('inv-domestic-tax-rate').value = '';
                const outDateEl = document.getElementById('inv-out-date');
                if (outDateEl) outDateEl.value = '';

                const today = new Date();
                const d = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
                document.getElementById('inv-purchase-date').value = d;
                onInventoryPurchaseDateChange();

                const showEls = [
                    'inv-purchase-date-container',
                    'inv-batchno-container',
                    'inv-spec-container',
                    'inv-price-container',
                    'inv-location-container'
                ];
                showEls.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'block'; });
                [
                    'inv-unit-price',
                    'inv-purchase-total',
                    'inv-shipping-rate',
                    'inv-domestic-tax-rate',
                    'inv-shipping-cost',
                    'inv-domestic-tax',
                    'inv-avg-cost',
                    'inv-total-cost'
                ].forEach(id => { const el = document.getElementById(id); if (el?.parentElement) el.parentElement.style.display = 'block'; });

                onInventoryProductChange();
            } else if (type === 'edit') {
                if (qtyLabel) qtyLabel.textContent = '采购数量';
                document.getElementById('inv-title').innerText = '修改入库';
                const item = inventory.find(i => i.id === targetId);
                if(item) {
                    document.getElementById('inv-product-id').value = item.productId;
                    document.getElementById('inv-quantity').value = String(parseInt(item.quantity, 10) || 0);
                    document.getElementById('inv-spec').value = String(Number.isFinite(parseFloat(item.spec)) ? parseFloat(item.spec) : 1);
                    document.getElementById('inv-price').value = String(parseFloat(item.purchasePrice) || 0);
                    document.getElementById('inv-location').value = item.location || '';
                    document.getElementById('inv-shipping-rate').value = String(((item.shippingRate ?? 0.08) * 100).toFixed(2));
                    document.getElementById('inv-domestic-tax-rate').value = String(((item.domesticTaxRate ?? 0.06) * 100).toFixed(2));
                    document.getElementById('inv-purchase-date').value = item.purchaseDate || '';
                    document.getElementById('inv-batch-no').value = item.batchNo || '';
                }
                const showEls = [
                    'inv-purchase-date-container',
                    'inv-batchno-container',
                    'inv-spec-container',
                    'inv-price-container',
                    'inv-location-container'
                ];
                showEls.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'block'; });
                [
                    'inv-unit-price',
                    'inv-purchase-total',
                    'inv-shipping-rate',
                    'inv-domestic-tax-rate',
                    'inv-shipping-cost',
                    'inv-domestic-tax',
                    'inv-avg-cost',
                    'inv-total-cost'
                ].forEach(id => { const el = document.getElementById(id); if (el?.parentElement) el.parentElement.style.display = 'block'; });
                onInventoryProductChange();
            } else {
                if (qtyLabel) qtyLabel.textContent = '出库数量';
                document.getElementById('inv-title').innerText = '产品出库';
                const item = inventory.find(i => i.id === targetId);
                if(item) {
                    document.getElementById('inv-product-id').value = item.productId;
                    document.getElementById('inv-quantity').value = '';
                    document.getElementById('inv-price').value = item.purchasePrice;
                    document.getElementById('inv-location').value = item.location;
                }
                const outNatureEl = document.getElementById('inv-out-nature');
                if (outNatureEl) outNatureEl.value = 'transfer';
                const today = new Date();
                const d = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
                const outDateEl = document.getElementById('inv-out-date');
                if (outDateEl) outDateEl.value = d;
                onInventoryProductChange();
                onInvOutNatureChange();
                const hideEls = [
                    'inv-purchase-date-container',
                    'inv-batchno-container',
                    'inv-spec-container',
                    'inv-price-container',
                    'inv-location-container'
                ];
                hideEls.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
                [
                    'inv-unit-price',
                    'inv-purchase-total',
                    'inv-shipping-rate',
                    'inv-domestic-tax-rate',
                    'inv-shipping-cost',
                    'inv-domestic-tax',
                    'inv-avg-cost',
                    'inv-total-cost'
                ].forEach(id => { const el = document.getElementById(id); if (el?.parentElement) el.parentElement.style.display = 'none'; });
            }
        };

        window.closeInventoryModal = () => document.getElementById('inventory-modal').classList.add('hidden');
        window.onInvOutNatureChange = () => {
            if (window.inventoryType !== 'out') return;
            const outNature = String(document.getElementById('inv-out-nature')?.value || 'sale');
            const item = inventory.find(i => i.id === window.inventoryTargetId);
            const transferFromWrap = document.getElementById('inv-transfer-from-container');
            const transferToWrap = document.getElementById('inv-transfer-to-container');
            const transferFromEl = document.getElementById('inv-transfer-from');
            const transferToEl = document.getElementById('inv-transfer-to');
            if (outNature === 'transfer') {
                const fromLoc = String(item?.location || '').trim() || '未指定位置';
                if (transferFromEl) transferFromEl.value = fromLoc;
                if (transferFromWrap) transferFromWrap.style.display = 'block';
                if (transferToWrap) transferToWrap.style.display = 'block';

                const locations = [...new Set(inventory.map(i => String(i.location || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
                const opts = locations.filter(x => x !== fromLoc);
                if (transferToEl) {
                    transferToEl.innerHTML = `<option value="">请选择</option>` + opts.map(x => `<option value="${x.replaceAll('"', '&quot;')}">${x}</option>`).join('');
                    if (transferToEl.value === fromLoc) transferToEl.value = '';
                }
                return;
            }
            if (transferFromWrap) transferFromWrap.style.display = 'none';
            if (transferToWrap) transferToWrap.style.display = 'none';
            if (outNature === 'sale') {
                const productId = String(document.getElementById('inv-product-id')?.value || '').trim();
                closeInventoryModal();
                openSalesOutModal({ productId });
            }
        };

        window.saveInventory = () => {
            const productId = document.getElementById('inv-product-id').value;
            const quantity = parseInt(document.getElementById('inv-quantity').value) || 0;
            const purchasePrice = parseFloat(document.getElementById('inv-price').value) || 0;
            const location = document.getElementById('inv-location').value;

            if(!productId) return alert("请选择或输入产品编号！");
            if (window.inventoryType === 'out') {
                const outNature = String(document.getElementById('inv-out-nature')?.value || 'sale');
                if (outNature === 'sale') {
                    closeInventoryModal();
                    openSalesOutModal({ productId });
                    return;
                }
            }
            if(quantity <= 0) return alert("请输入有效数量！");

            const product = products.find(p => p.id === productId);
            const productName = product ? product.name : '未知产品';

            if(window.inventoryType === 'in') {
                const purchaseDate = document.getElementById('inv-purchase-date').value;
                if (!purchaseDate) return alert("请选择采购入库时间！");
                const ymd = formatYmd(purchaseDate);
                let newBatchNo = document.getElementById('inv-batch-no').value || generateNextBatchNoForDate(ymd);
                if (inventory.some(i => String(i.batchNo || '') === newBatchNo)) {
                    newBatchNo = generateNextBatchNoForDate(ymd);
                    document.getElementById('inv-batch-no').value = newBatchNo;
                }

                const spec = parseFloat(document.getElementById('inv-spec').value) || 0;
                const shippingRatePct = parseFloat(document.getElementById('inv-shipping-rate').value) || 0;
                const domesticTaxRatePct = parseFloat(document.getElementById('inv-domestic-tax-rate').value) || 0;
                const unitPurchasePrice = purchasePrice * spec;
                const purchaseTotal = unitPurchasePrice * quantity;
                const shippingCost = purchaseTotal * (shippingRatePct / 100);
                const domesticTax = purchaseTotal * (domesticTaxRatePct / 100);
                const totalCost = purchaseTotal + shippingCost + domesticTax;

                const newId = `inv_${Date.now()}`;
                inventory.push({ 
                    id: newId,
                    productId, 
                    quantity, 
                    batchNo: newBatchNo, 
                    purchaseDate,
                    purchasePrice,
                    spec,
                    unitPurchasePrice,
                    purchaseTotal,
                    shippingRate: shippingRatePct / 100,
                    domesticTaxRate: domesticTaxRatePct / 100,
                    shippingCost,
                    domesticTax,
                    totalCost,
                    location 
                });

                pushInventoryHistory({
                    ts: Date.now(),
                    type: 'in',
                    productId,
                    productName,
                    quantity,
                    batchNo: newBatchNo,
                    note: `采购入库 ${purchaseDate} | 入库到 ${location || '未指定位置'} | 总成本¥${totalCost.toFixed(2)}`
                });
            } else if (window.inventoryType === 'edit') {
                const item = inventory.find(i => i.id === window.inventoryTargetId);
                if(!item) return alert("未找到该入库记录！");
                const purchaseDate = document.getElementById('inv-purchase-date').value;
                if (!purchaseDate) return alert("请选择采购入库时间！");
                const batchNo = document.getElementById('inv-batch-no').value || '';
                if (!batchNo) return alert("采购批次号不能为空！");
                if (inventory.some(i => i.id !== item.id && String(i.batchNo || '') === String(batchNo))) {
                    return alert("采购批次号已存在，请调整采购入库时间后自动生成新批次号！");
                }
                const spec = parseFloat(document.getElementById('inv-spec').value) || 0;
                const shippingRatePct = parseFloat(document.getElementById('inv-shipping-rate').value) || 0;
                const domesticTaxRatePct = parseFloat(document.getElementById('inv-domestic-tax-rate').value) || 0;
                const unitPurchasePrice = purchasePrice * spec;
                const purchaseTotal = unitPurchasePrice * quantity;
                const shippingCost = purchaseTotal * (shippingRatePct / 100);
                const domesticTax = purchaseTotal * (domesticTaxRatePct / 100);
                const totalCost = purchaseTotal + shippingCost + domesticTax;

                item.quantity = quantity;
                item.purchaseDate = purchaseDate;
                item.batchNo = batchNo;
                item.purchasePrice = purchasePrice;
                item.spec = spec;
                item.unitPurchasePrice = unitPurchasePrice;
                item.purchaseTotal = purchaseTotal;
                item.shippingRate = shippingRatePct / 100;
                item.domesticTaxRate = domesticTaxRatePct / 100;
                item.shippingCost = shippingCost;
                item.domesticTax = domesticTax;
                item.totalCost = totalCost;
                item.location = location;

                pushInventoryHistory({
                    ts: Date.now(),
                    type: 'modify',
                    productId,
                    productName,
                    quantity,
                    batchNo,
                    note: `修改入库 ${purchaseDate} | 存放 ${location || '未指定位置'} | 总成本¥${totalCost.toFixed(2)}`
                });
            } else {
                const item = inventory.find(i => i.id === window.inventoryTargetId);
                const outNature = String(document.getElementById('inv-out-nature')?.value || 'sale');
                const outDate = String(document.getElementById('inv-out-date')?.value || '').trim();
                if (outNature === 'sale') {
                    closeInventoryModal();
                    openSalesOutModal({ productId: item?.productId || productId });
                    return;
                }
                if (outNature === 'transfer') {
                    if (!item) return alert('找不到该批次库存记录');
                    const fromLoc = String(item.location || '').trim() || '未指定位置';
                    const toLoc = String(document.getElementById('inv-transfer-to')?.value || '').trim();
                    if (!toLoc) return alert('请选择调入仓库');
                    if (!quantity || quantity <= 0) return alert('请输入有效出库数量');
                    if (item.quantity < quantity) return alert('该批次库存不足！');

                    item.quantity -= quantity;
                    const dest = inventory.find(i =>
                        i.productId === item.productId &&
                        String(i.batchNo || '') === String(item.batchNo || '') &&
                        String(i.purchaseDate || '') === String(item.purchaseDate || '') &&
                        String(i.location || '') === toLoc
                    );
                    if (dest) {
                        dest.quantity = (parseInt(dest.quantity, 10) || 0) + quantity;
                    } else {
                        inventory.push({
                            ...item,
                            id: `inv_${Date.now()}_${Math.random().toString(16).slice(2)}`,
                            quantity,
                            location: toLoc
                        });
                    }

                    pushInventoryHistory({
                        ts: Date.now(),
                        type: 'out',
                        productId,
                        productName,
                        quantity,
                        batchNo: item.batchNo,
                        note: `出库性质：调拨出库 | 出库日期：${outDate || '-'} | 调出：${fromLoc} → 调入：${toLoc}`
                    });
                    pushInventoryHistory({
                        ts: Date.now(),
                        type: 'in',
                        productId,
                        productName,
                        quantity,
                        batchNo: item.batchNo,
                        note: `入库性质：调拨入库 | 入库日期：${outDate || '-'} | 调入：${toLoc} ← 调出：${fromLoc}`
                    });
                    archiveZeroQtyInventoryItems(`调拨出库 | ${fromLoc}→${toLoc}`);
                    saveToLocal();
                    closeInventoryModal();
                    return;
                }
                if(!item || item.quantity < quantity) return alert("该批次库存不足！");
                item.quantity -= quantity;

                pushInventoryHistory({
                    ts: Date.now(),
                    type: 'out',
                    productId,
                    productName,
                    quantity,
                    batchNo: item.batchNo,
                    note: `出库性质：${outNature} | 出库日期：${outDate || '-'} | 从 ${item.location || '未指定位置'} 出库`
                });

                archiveZeroQtyInventoryItems(`批次出库 | ${outNature}`);
            }
            
            saveToLocal();
            closeInventoryModal();
        };

        function getTotalStockQty(productId) {
            const id = String(productId || '').trim();
            if (!id) return 0;
            return inventory.filter(i => i.productId === id).reduce((sum, i) => sum + (parseFloat(i.quantity) || 0), 0);
        }
        function getFifoBatchesForProduct(productId) {
            const id = String(productId || '').trim();
            return inventory
                .filter(i => i.productId === id && (parseFloat(i.quantity) || 0) > 0)
                .sort((a, b) => {
                    const ad = a.purchaseDate ? Date.parse(a.purchaseDate) : 0;
                    const bd = b.purchaseDate ? Date.parse(b.purchaseDate) : 0;
                    if (ad !== bd) return ad - bd;
                    return String(a.batchNo || '').localeCompare(String(b.batchNo || ''));
                });
        }
        function computeFifoAllocations(productId, outQty) {
            const qty = Math.max(0, parseInt(outQty, 10) || 0);
            const batches = getFifoBatchesForProduct(productId);
            let remaining = qty;
            const alloc = [];
            for (const b of batches) {
                if (remaining <= 0) break;
                const avail = parseInt(b.quantity, 10) || 0;
                if (avail <= 0) continue;
                const take = Math.min(avail, remaining);
                alloc.push({ id: b.id, batchNo: b.batchNo || '-', purchaseDate: b.purchaseDate || '-', location: b.location || '未指定位置', qty: take, spec: Number.isFinite(parseFloat(b.spec)) ? parseFloat(b.spec) : 1 });
                remaining -= take;
            }
            return { requested: qty, allocated: qty - remaining, remaining, allocations: alloc };
        }
        function getLocationSummaryFromAllocations(allocations) {
            const map = {};
            for (const a of allocations || []) map[a.location] = (map[a.location] || 0) + (parseFloat(a.qty) || 0);
            const parts = Object.entries(map).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`);
            return parts.length ? parts.join('；') : '-';
        }
        function formatAllocationsPreview(allocations, maxLines = 3) {
            const list = Array.isArray(allocations) ? allocations : [];
            const slice = list.slice(0, maxLines);
            const lines = slice.map(a => `批次 ${a.batchNo} | ${a.purchaseDate} | ${a.location} | 数量 ${a.qty}`);
            if (list.length > maxLines) lines.push(`… 还有 ${list.length - maxLines} 个批次`);
            return lines;
        }
        function getSalespeopleList() {
            try {
                const raw = localStorage.getItem('minova_salespeople_v1');
                const arr = raw ? JSON.parse(raw) : [];
                return Array.isArray(arr) ? arr.filter(Boolean).map(s => String(s).trim()).filter(Boolean) : [];
            } catch (e) {
                return [];
            }
        }
        function saveSalespeopleList(list) {
            try { localStorage.setItem('minova_salespeople_v1', JSON.stringify(list)); } catch (e) {}
        }
        function renderSalespeopleDatalist() {
            const dl = document.getElementById('salesperson-suggestions');
            if (!dl) return;
            const list = getSalespeopleList();
            dl.innerHTML = list.map(s => `<option value="${String(s).replaceAll('"', '&quot;')}"></option>`).join('');
        }
        function getDefaultTaxInputsForProduct(product) {
            const p = product || {};
            return {
                shippingRatePct: 8,
                domesticTaxRatePct: getDefaultDomesticTaxRatePercent(p.category),
                dutyPct: getDefaultImportDutyPercent(p.category),
                sstPct: getDefaultSstPercent(),
                grayPct: getDefaultGrayTaxPercent()
            };
        }
        function computeSalesPricingForProduct({ productId, dutyPct, sstPct, grayPct }) {
            const p = products.find(x => x.id === productId) || {};
            const batches = getFifoBatchesForProduct(productId);
            const spec = batches.length ? (Number.isFinite(parseFloat(batches[0].spec)) ? parseFloat(batches[0].spec) : 1) : 1;
            const tempItem = { productId, spec, importDutyPct: dutyPct, sstPct: sstPct, grayTaxPct: grayPct };
            const r = computeInventoryPricing({ item: tempItem, product: p });
            return { product: p, ...r };
        }
        function getSuggestedSalesPriceByType(r, priceType) {
            if (!r) return 0;
            if (priceType === 'clearance_biz') return r.clearanceBizPrice || 0;
            if (priceType === 'gray_home') return r.grayHomePrice || 0;
            if (priceType === 'gray_biz') return r.grayBizPrice || 0;
            return r.clearanceHomePrice || 0;
        }
        function getSalesOutRateCnyPerMyr() {
            const rate = parseFloat(document.getElementById('rate-myr-cny')?.value) || 1.53;
            return rate > 0 ? rate : 1.53;
        }
        function getSalesOutCurrency() {
            return window.salesOutCurrency === 'MYR' ? 'MYR' : 'CNY';
        }
        function salesOutDisplayFromCny(v) {
            const n = Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0;
            if (getSalesOutCurrency() === 'MYR') return n / getSalesOutRateCnyPerMyr();
            return n;
        }
        function salesOutCnyFromDisplay(v) {
            const n = Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0;
            if (getSalesOutCurrency() === 'MYR') return n * getSalesOutRateCnyPerMyr();
            return n;
        }
        function updateSalesOutCurrencyUi() {
            const toggle = document.getElementById('sales-out-currency-toggle');
            const sym = document.getElementById('sales-out-currency-symbol');
            const symFinal = document.getElementById('sales-out-currency-symbol-final');
            const c = getSalesOutCurrency();
            if (toggle) toggle.textContent = c === 'MYR' ? '¥ / RM' : 'RM / ¥';
            if (sym) sym.textContent = c === 'MYR' ? 'RM' : '¥';
            if (symFinal) symFinal.textContent = c === 'MYR' ? 'RM' : '¥';
        }
        window.toggleSalesOutCurrency = () => {
            const unitEl = document.getElementById('sales-out-unit-price');
            const finalEl = document.getElementById('sales-out-final-price');
            const unitDisplay = parseFloat(unitEl?.value) || 0;
            const finalDisplay = parseFloat(finalEl?.value) || 0;
            const unitCny = salesOutCnyFromDisplay(unitDisplay);
            const finalCny = salesOutCnyFromDisplay(finalDisplay);

            window.salesOutCurrency = getSalesOutCurrency() === 'CNY' ? 'MYR' : 'CNY';
            updateSalesOutCurrencyUi();

            if (unitEl) unitEl.value = salesOutDisplayFromCny(unitCny).toFixed(4);
            if (finalEl) finalEl.value = salesOutDisplayFromCny(finalCny).toFixed(2);
        };
        window.openSalesOutModal = (opts = {}) => {
            const modal = document.getElementById('sales-out-modal');
            if (!modal) return;
            modal.classList.remove('hidden');

            const editingId = String(opts?.recordId || '').trim();
            const editingRecord = editingId ? salesRecords.find(r => r.id === editingId) : null;
            window.salesOutEditingRecordId = editingRecord ? editingRecord.id : null;

            const productEl = document.getElementById('sales-out-product-id');
            const dl = document.getElementById('sales-out-product-suggestions');
            if (dl) {
                const ids = [...new Set(inventory.filter(i => (parseFloat(i.quantity) || 0) > 0).map(i => i.productId))].filter(Boolean);
                const options = ids.map(id => {
                    const p = products.find(x => x.id === id) || {};
                    const qty = getTotalStockQty(id);
                    const label = `${id}（库存 ${qty}）${p.name ? ` - ${p.name}` : ''}`;
                    return `<option value="${id}">${label.replaceAll('<', '&lt;')}</option>`;
                }).join('');
                dl.innerHTML = options;
            }
            renderSalespeopleDatalist();

            const today = new Date();
            const d = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            const dateEl = document.getElementById('sales-out-date');
            if (dateEl) dateEl.value = editingRecord?.outDate || d;
            const qtyEl = document.getElementById('sales-out-qty');
            if (qtyEl) qtyEl.value = String(editingRecord?.quantity ?? '1');

            window.salesOutCurrency = 'CNY';
            window.salesOutUnitPriceDirty = !!editingRecord;
            window.salesOutFinalPriceDirty = !!editingRecord;
            const priceTypeEl = document.getElementById('sales-out-price-type');
            if (priceTypeEl) priceTypeEl.value = String(editingRecord?.priceType || 'clearance_home');
            updateSalesOutCurrencyUi();

            const presetId = editingRecord ? String(editingRecord.productId || '').trim() : String(opts?.productId || '').trim();
            if (productEl) {
                if (presetId) productEl.value = presetId;
                productEl.readOnly = !!editingRecord;
                productEl.classList.toggle('bg-slate-50', productEl.readOnly);
            }

            if (editingRecord) {
                const shipEl = document.getElementById('sales-out-shipping-rate');
                const taxEl = document.getElementById('sales-out-domestic-tax');
                const dutyEl = document.getElementById('sales-out-import-duty');
                const sstEl = document.getElementById('sales-out-sst');
                const grayEl = document.getElementById('sales-out-gray-tax');
                if (shipEl) shipEl.value = Number.isFinite(parseFloat(editingRecord.shippingRatePct)) ? String(parseFloat(editingRecord.shippingRatePct)) : '';
                if (taxEl) taxEl.value = Number.isFinite(parseFloat(editingRecord.domesticTaxRatePct)) ? String(parseFloat(editingRecord.domesticTaxRatePct)) : '';
                if (dutyEl) dutyEl.value = Number.isFinite(parseFloat(editingRecord.dutyPct)) ? String(parseFloat(editingRecord.dutyPct)) : '';
                if (sstEl) sstEl.value = Number.isFinite(parseFloat(editingRecord.sstPct)) ? String(parseFloat(editingRecord.sstPct)) : '';
                if (grayEl) grayEl.value = Number.isFinite(parseFloat(editingRecord.grayPct)) ? String(parseFloat(editingRecord.grayPct)) : '';
            } else {
                const contractEl = document.getElementById('sales-out-contract-no');
                if (contractEl) contractEl.value = '';
                const salespersonEl = document.getElementById('sales-out-salesperson');
                if (salespersonEl && String(salespersonEl.value || '').trim() === '') salespersonEl.value = '';
            }
            onSalesOutProductChange();

            if (editingRecord) {
                const specEl = document.getElementById('sales-out-spec');
                if (specEl) specEl.value = String(Number.isFinite(parseFloat(editingRecord.spec)) ? parseFloat(editingRecord.spec) : 1);
                const unitEl = document.getElementById('sales-out-unit-price');
                const finalEl = document.getElementById('sales-out-final-price');
                if (unitEl) unitEl.value = salesOutDisplayFromCny(parseFloat(editingRecord.salesPrice) || 0).toFixed(4);
                if (finalEl) finalEl.value = salesOutDisplayFromCny(parseFloat(editingRecord.finalContractPrice) || 0).toFixed(2);
                const contractEl = document.getElementById('sales-out-contract-no');
                if (contractEl) contractEl.value = String(editingRecord.contractNo || '');
                const salespersonEl = document.getElementById('sales-out-salesperson');
                if (salespersonEl) salespersonEl.value = String(editingRecord.salesperson || '');
                recalcSalesOutPricing();
                recalcSalesOutPreview();
            }
        };
        window.closeSalesOutModal = () => {
            const modal = document.getElementById('sales-out-modal');
            if (modal) modal.classList.add('hidden');
            window.salesOutEditingRecordId = null;
        };
        window.onSalesOutProductChange = () => {
            const productId = String(document.getElementById('sales-out-product-id')?.value || '').trim();
            const p = products.find(x => x.id === productId) || null;
            const nameEl = document.getElementById('sales-out-product-name');
            const metaEl = document.getElementById('sales-out-product-meta');
            const totalEl = document.getElementById('sales-out-total-stock');
            const breakdownEl = document.getElementById('sales-out-stock-breakdown');
            const specEl = document.getElementById('sales-out-spec');
            if (nameEl) nameEl.textContent = p?.name || '-';
            if (metaEl) metaEl.textContent = p ? `${p.category || '-'} / ${p.scenario || '-'} | ${p.vendor || '-'}` : '-';
            const total = getTotalStockQty(productId);
            if (totalEl) totalEl.textContent = String(total || 0);

            if (breakdownEl) {
                const batches = getFifoBatchesForProduct(productId);
                const spec = batches.length ? (Number.isFinite(parseFloat(batches[0].spec)) ? parseFloat(batches[0].spec) : 1) : 1;
                if (specEl) specEl.value = String(spec);
                const lines = batches.slice(0, 3).map(b => `批次 ${b.batchNo || '-'} | ${b.purchaseDate || '-'} | ${b.location || '未指定位置'} | 库存 ${b.quantity}`);
                if (batches.length > 3) lines.push(`… 还有 ${batches.length - 3} 个批次`);
                breakdownEl.innerHTML = lines.length ? lines.map(x => `<div>${x}</div>`).join('') : `<div>-</div>`;
            }

            if (p) {
                const def = getDefaultTaxInputsForProduct(p);
                const shipEl = document.getElementById('sales-out-shipping-rate');
                const taxEl = document.getElementById('sales-out-domestic-tax');
                const dutyEl = document.getElementById('sales-out-import-duty');
                const sstEl = document.getElementById('sales-out-sst');
                const grayEl = document.getElementById('sales-out-gray-tax');
                if (shipEl && String(shipEl.value ?? '').trim() === '') shipEl.value = String(def.shippingRatePct);
                if (taxEl && String(taxEl.value ?? '').trim() === '') taxEl.value = String(def.domesticTaxRatePct);
                if (dutyEl && String(dutyEl.value ?? '').trim() === '') dutyEl.value = String(def.dutyPct);
                if (sstEl && String(sstEl.value ?? '').trim() === '') sstEl.value = String(def.sstPct);
                if (grayEl && String(grayEl.value ?? '').trim() === '') grayEl.value = String(def.grayPct);
            }
            recalcSalesOutPricing();
            recalcSalesOutPreview();
        };
        window.recalcSalesOutPricing = () => {
            const productId = String(document.getElementById('sales-out-product-id')?.value || '').trim();
            const p = products.find(x => x.id === productId) || null;
            const avgEl = document.getElementById('sales-out-avg-cost');
            const homeProfitEl = document.getElementById('sales-out-profit-home');
            const bizProfitEl = document.getElementById('sales-out-profit-biz');
            const chEl = document.getElementById('sales-out-q-ch');
            const cbEl = document.getElementById('sales-out-q-cb');
            const ghEl = document.getElementById('sales-out-q-gh');
            const gbEl = document.getElementById('sales-out-q-gb');
            if (!p) {
                if (avgEl) avgEl.value = '0.00';
                if (homeProfitEl) homeProfitEl.value = '0.00';
                if (bizProfitEl) bizProfitEl.value = '0.00';
                if (chEl) chEl.value = '0.00';
                if (cbEl) cbEl.value = '0.00';
                if (ghEl) ghEl.value = '0.00';
                if (gbEl) gbEl.value = '0.00';
                const specEl = document.getElementById('sales-out-spec');
                if (specEl) specEl.value = '1';
                const unitEl = document.getElementById('sales-out-unit-price');
                if (unitEl && !window.salesOutUnitPriceDirty) unitEl.value = '0.0000';
                const finalEl = document.getElementById('sales-out-final-price');
                if (finalEl && !window.salesOutFinalPriceDirty) finalEl.value = '0.0000';
                return;
            }
            const dutyPct = parseFloat(document.getElementById('sales-out-import-duty')?.value) || getDefaultImportDutyPercent(p.category);
            const sstPct = parseFloat(document.getElementById('sales-out-sst')?.value) || getDefaultSstPercent();
            const grayPct = parseFloat(document.getElementById('sales-out-gray-tax')?.value) || getDefaultGrayTaxPercent();
            const r = computeSalesPricingForProduct({ productId, dutyPct, sstPct, grayPct });
            if (avgEl) avgEl.value = (r.avgCost || 0).toFixed(4);
            if (homeProfitEl) homeProfitEl.value = ((r.cnHomePct || 0) + (r.myHomePct || 0)).toFixed(2);
            if (bizProfitEl) bizProfitEl.value = ((r.cnBizPct || 0) + (r.myBizPct || 0)).toFixed(2);
            if (chEl) chEl.value = (r.clearanceHomePrice || 0).toFixed(4);
            if (cbEl) cbEl.value = (r.clearanceBizPrice || 0).toFixed(4);
            if (ghEl) ghEl.value = (r.grayHomePrice || 0).toFixed(4);
            if (gbEl) gbEl.value = (r.grayBizPrice || 0).toFixed(4);

            const priceType = String(document.getElementById('sales-out-price-type')?.value || 'clearance_home');
            const suggested = getSuggestedSalesPriceByType(r, priceType);
            const unitEl = document.getElementById('sales-out-unit-price');
            if (unitEl && !window.salesOutUnitPriceDirty) unitEl.value = suggested ? salesOutDisplayFromCny(suggested).toFixed(4) : '0.0000';
        };
        window.onSalesOutPriceTypeChange = () => {
            window.salesOutUnitPriceDirty = false;
            recalcSalesOutPricing();
            recalcSalesOutPreview();
        };
        window.recalcSalesOutPreview = () => {
            const productId = String(document.getElementById('sales-out-product-id')?.value || '').trim();
            const qty = parseInt(document.getElementById('sales-out-qty')?.value || '0', 10) || 0;
            const { allocations, remaining } = computeFifoAllocations(productId, qty);
            const previewEl = document.getElementById('sales-out-allocation-preview');
            const locEl = document.getElementById('sales-out-location-summary');
            const spec = parseFloat(document.getElementById('sales-out-spec')?.value) || 1;
            const unitDisplay = parseFloat(document.getElementById('sales-out-unit-price')?.value) || 0;
            const unitCny = salesOutCnyFromDisplay(unitDisplay);
            const finalEl = document.getElementById('sales-out-final-price');
            if (finalEl && !window.salesOutFinalPriceDirty) {
                const finalCny = (qty * spec) * unitCny;
                finalEl.value = salesOutDisplayFromCny(finalCny).toFixed(2);
            }
            if (previewEl) {
                const lines = formatAllocationsPreview(allocations, 3);
                previewEl.innerHTML = lines.length ? lines.map(x => `<div>${x}</div>`).join('') : `<div>-</div>`;
            }
            if (locEl) locEl.textContent = allocations.length ? getLocationSummaryFromAllocations(allocations) : '-';

            if (remaining > 0) {
                if (previewEl) previewEl.innerHTML = `<div class="text-red-600 font-black">库存不足：缺少 ${remaining}</div>` + (previewEl.innerHTML || '');
            }
        };
        window.confirmSalesOut = () => {
            const editingId = String(window.salesOutEditingRecordId || '').trim();
            const editingIdx = editingId ? salesRecords.findIndex(r => r.id === editingId) : -1;
            const editingPrev = editingIdx >= 0 ? salesRecords[editingIdx] : null;

            const productId = String(document.getElementById('sales-out-product-id')?.value || '').trim();
            if (!productId) return alert('请选择产品编号');
            const p = products.find(x => x.id === productId) || {};
            const productName = p.name || '未知产品';
            const outDate = String(document.getElementById('sales-out-date')?.value || '').trim();
            const qty = parseInt(document.getElementById('sales-out-qty')?.value || '0', 10) || 0;
            if (qty <= 0) return alert('请输入有效出库数量');

            const priceType = String(document.getElementById('sales-out-price-type')?.value || 'clearance_home');
            const unitPriceCny = salesOutCnyFromDisplay(parseFloat(document.getElementById('sales-out-unit-price')?.value) || 0);
            const finalPriceCny = salesOutCnyFromDisplay(parseFloat(document.getElementById('sales-out-final-price')?.value) || 0);
            const spec = parseFloat(document.getElementById('sales-out-spec')?.value) || 1;
            const salesperson = String(document.getElementById('sales-out-salesperson')?.value || '').trim();
            const contractNo = String(document.getElementById('sales-out-contract-no')?.value || '').trim();
            const shippingRatePct = parseFloat(document.getElementById('sales-out-shipping-rate')?.value) || 0;
            const domesticTaxRatePct = parseFloat(document.getElementById('sales-out-domestic-tax')?.value) || 0;
            const dutyPct = parseFloat(document.getElementById('sales-out-import-duty')?.value) || 0;
            const sstPct = parseFloat(document.getElementById('sales-out-sst')?.value) || 0;
            const grayPct = parseFloat(document.getElementById('sales-out-gray-tax')?.value) || 0;

            const prevAlloc = editingPrev && Array.isArray(editingPrev.allocations) ? editingPrev.allocations : null;
            if (editingPrev && !prevAlloc) {
                if (qty !== (parseInt(editingPrev.quantity, 10) || 0)) {
                    return alert('该销售记录缺少批次扣减明细，无法修改出库数量（仅允许修改合同/人员/价格等信息）');
                }
                const avgCostPerSpec = parseFloat(document.getElementById('sales-out-avg-cost')?.value) || (parseFloat(editingPrev.avgCostPerSpec) || 0);
                const goodsCost = avgCostPerSpec * spec * qty;
                const customsFee = computeSalesCustomsFeeByType({ avgCostPerSpec, spec, qty, priceType, dutyPct, sstPct, grayPct, fallback: 0 });
                const totalProfit = finalPriceCny - goodsCost - customsFee;
                const marginPct = finalPriceCny > 0 ? (totalProfit / finalPriceCny) * 100 : 0;
                pushInventoryHistory({
                    ts: Date.now(),
                    type: 'modify',
                    productId,
                    productName,
                    quantity: qty,
                    batchNo: '',
                    note: `修改销售出库（未回滚库存） | 出库日期：${outDate || '-'} | 合同：${contractNo || '-'} | 价格：${priceType} ¥${unitPriceCny.toFixed(2)} | 合同总价¥${finalPriceCny.toFixed(2)} | 销售：${salesperson || '-'}`
                });
                salesRecords[editingIdx] = {
                    ...editingPrev,
                    outDate,
                    quantity: qty,
                    contractNo,
                    priceType,
                    salesPrice: unitPriceCny,
                    spec,
                    finalContractPrice: finalPriceCny,
                    avgCostPerSpec,
                    goodsCost,
                    customsFee,
                    totalProfit,
                    marginPct,
                    salesperson,
                    shippingRatePct,
                    domesticTaxRatePct,
                    dutyPct,
                    sstPct,
                    grayPct,
                    updatedAt: Date.now()
                };
                saveToLocal();
                closeSalesOutModal();
                return;
            }
            if (prevAlloc) {
                for (const a of prevAlloc) {
                    restoreArchivedInventoryItemById(a.id, a.qty);
                }
            }

            const { allocations, remaining } = computeFifoAllocations(productId, qty);
            if (remaining > 0) {
                if (prevAlloc) {
                    for (const a of prevAlloc) {
                        const item = inventory.find(i => i.id === a.id);
                        if (!item) continue;
                        item.quantity = (parseInt(item.quantity, 10) || 0) - (parseInt(a.qty, 10) || 0);
                    }
                }
                return alert('库存不足');
            }

            for (const a of allocations) {
                const item = inventory.find(i => i.id === a.id);
                if (!item) continue;
                item.quantity = (parseInt(item.quantity, 10) || 0) - (parseInt(a.qty, 10) || 0);
            }

            const allocLines = formatAllocationsPreview(allocations, 3).join('；');
            const note = `出库性质：销售出库 | 出库日期：${outDate || '-'} | 合同：${contractNo || '-'} | 价格：${priceType} ¥${unitPriceCny.toFixed(2)} | 合同总价¥${finalPriceCny.toFixed(2)} | 销售：${salesperson || '-'} | 税费：运费${shippingRatePct.toFixed(1)}%/国内税${domesticTaxRatePct.toFixed(1)}%/关税${dutyPct.toFixed(1)}%/SST${sstPct.toFixed(1)}%/灰清${grayPct.toFixed(1)}% | 扣减：${allocLines || '-'}`;
            if (editingPrev) {
                pushInventoryHistory({
                    ts: Date.now(),
                    type: 'modify',
                    productId,
                    productName,
                    quantity: qty,
                    batchNo: '',
                    note: `修改销售出库 | ${note}`
                });
            } else {
                for (const a of allocations) {
                    pushInventoryHistory({
                        ts: Date.now(),
                        type: 'out',
                        productId,
                        productName,
                        quantity: a.qty,
                        batchNo: a.batchNo,
                        note
                    });
                }
            }

            const avgCostPerSpec = parseFloat(document.getElementById('sales-out-avg-cost')?.value) || 0;
            const goodsCost = avgCostPerSpec * spec * qty;
            const customsFee = computeSalesCustomsFeeByType({ avgCostPerSpec, spec, qty, priceType, dutyPct, sstPct, grayPct, fallback: 0 });
            const totalProfit = finalPriceCny - goodsCost - customsFee;
            const marginPct = finalPriceCny > 0 ? (totalProfit / finalPriceCny) * 100 : 0;
            const outWarehouse = getLocationSummaryFromAllocations(allocations);
            const record = {
                id: editingPrev ? editingPrev.id : `sale_${Date.now()}`,
                productId,
                productName,
                category: p.category || '',
                subcategory: p.scenario || '',
                vendor: p.vendor || '',
                outAt: editingPrev ? editingPrev.outAt : Date.now(),
                outDate,
                quantity: qty,
                contractNo,
                priceType,
                salesPrice: unitPriceCny,
                spec,
                finalContractPrice: finalPriceCny,
                avgCostPerSpec,
                goodsCost,
                customsFee,
                totalProfit,
                marginPct,
                salesperson,
                outWarehouse,
                shippingRatePct,
                domesticTaxRatePct,
                dutyPct,
                sstPct,
                grayPct,
                allocations: allocations.map(a => ({ id: a.id, qty: a.qty, batchNo: a.batchNo, purchaseDate: a.purchaseDate, location: a.location }))
            };
            if (editingPrev) {
                record.updatedAt = Date.now();
                salesRecords[editingIdx] = record;
            } else {
                salesRecords.unshift(record);
                if (salesRecords.length > 5000) salesRecords = salesRecords.slice(0, 5000);
            }

            archiveZeroQtyInventoryItems(`销售出库 | 合同：${contractNo || '-'} | 价格类型：${priceType}`);

            if (salesperson) {
                const list = getSalespeopleList();
                if (!list.includes(salesperson)) {
                    list.unshift(salesperson);
                    saveSalespeopleList(list.slice(0, 100));
                }
            }
            saveToLocal();
            closeSalesOutModal();
        };

        window.deleteInventoryItem = (id) => {
            const item = inventory.find(i => i.id === id);
            if(!item) return;
            if(confirm('确定删除该入库记录吗？删除会记录在历史中。')) {
                const product = products.find(p => p.id === item.productId) || {};
                pushInventoryHistory({
                    ts: Date.now(),
                    type: 'delete',
                    productId: item.productId,
                    productName: product.name || '未知产品',
                    quantity: item.quantity,
                    batchNo: item.batchNo,
                    note: `删除入库记录 | 批次 ${item.batchNo || '-'}`
                });
                inventory = inventory.filter(i => i.id !== id);
                saveToLocal();
            }
        };
        window.openModal = () => {
            updateSubcatSuggestions();
            if (!window.editId) {
                ['tuv', 'specs'].forEach(type => {
                    const list = document.getElementById(`product-${type}-list`);
                    const empty = document.getElementById(`product-${type}-empty`);
                    if (list) list.innerHTML = '';
                    if (empty) empty.classList.remove('hidden');
                });
            }
            document.getElementById('modal').classList.remove('hidden');
        };
        window.closeModal = () => {
            document.getElementById('modal').classList.add('hidden');
            window.editId = null;
            ['m-name', 'm-category', 'm-vendor', 'm-spec', 'm-scenario', 'm-warranty-years', 'm-warranty-cycles', 'm-lead-time', 'm-contact', 'm-contact-info', 'm-cost', 'm-price'].forEach(id => document.getElementById(id).value = '');
        };
        window.saveProduct = () => {
            const category = document.getElementById('m-category').value || '未分类';
            const data = {
                id: window.editId || generateNextId(category),
                name: document.getElementById('m-name').value,
                category: category,
                vendor: document.getElementById('m-vendor').value || '通用',
                spec: document.getElementById('m-spec').value,
                scenario: document.getElementById('m-scenario').value,
                warrantyYears: document.getElementById('m-warranty-years').value,
                warrantyCycles: document.getElementById('m-warranty-cycles').value,
                leadTime: document.getElementById('m-lead-time').value,
                contact: document.getElementById('m-contact').value,
                contactInfo: document.getElementById('m-contact-info').value,
                cost: parseFloat(document.getElementById('m-cost').value) || 0,
                price: parseFloat(document.getElementById('m-price').value) || 0,
                ts: Date.now()
            };
            // For existing products, preserve existing certifications
            if (window.editId) {
                const existing = products.find(p => p.id === window.editId);
                if (existing?.certifications) {
                    data.certifications = existing.certifications;
                }
            }
            // 确保 certifications 字段存在
            if (!data.certifications) {
                data.certifications = { tuvCerts: [], specSheets: [] };
            }
            if(!data.name) return alert("请输入产品全称！");
            const sub = (data.scenario || '').trim();
            const cat = (data.category || '').trim() || '未分类';
            if (!subcategoriesByCategory[cat]) subcategoriesByCategory[cat] = [];
            if (sub && !subcategoriesByCategory[cat].includes(sub)) {
                subcategoriesByCategory[cat].push(sub);
                saveSubcategoryIndex();
            }
            const idx = products.findIndex(p => p.id === data.id);
            if(idx !== -1) products[idx] = data; else products.push(data);
            saveToLocal(); closeModal();
        };
        window.editProduct = (id) => {
            const p = products.find(prod => prod.id === id);
            if(!p) return;
            window.editId = id;
            document.getElementById('m-name').value = p.name || '';
            document.getElementById('m-category').value = p.category || '';
            document.getElementById('m-vendor').value = p.vendor || '';
            document.getElementById('m-spec').value = p.spec || '';
            updateSubcatSuggestions();
            document.getElementById('m-scenario').value = p.scenario || '';
            document.getElementById('m-warranty-years').value = p.warrantyYears || '';
            document.getElementById('m-warranty-cycles').value = p.warrantyCycles || '';
            document.getElementById('m-lead-time').value = p.leadTime || '';
            document.getElementById('m-contact').value = p.contact || '';
            document.getElementById('m-contact-info').value = p.contactInfo || '';
            document.getElementById('m-cost').value = p.cost || 0;
            document.getElementById('m-price').value = p.price || 0;
            openModal();
            renderProductCertsInModal();
        };
        window.deleteProduct = (id) => {
            if(confirm('确定删除该产品档案吗？')) { products = products.filter(p => p.id !== id); saveToLocal(); }
        };

        // --- 批量导入逻辑 ---
        let importStep = 1;
        let importData = [];
        let importHeaders = [];
        const systemFields = {
            id: '产品编号',
            name: '产品全称',
            category: '类目',
            vendor: '供应商',
            spec: '规格型号',
            scenario: '子类目',
            warrantyYears: '质保年限',
            warrantyCycles: '循环次数',
            leadTime: '供货周期',
            contact: '联系人',
            contactInfo: '联系方式',
            cost: '基准采购价',
            price: '基准售价'
        };

        // 获取拼音首字母的简易映射
        function getPinyinInitials(str) {
            if (!str) return 'PROD';
            const dict = {
                '光': 'G', '伏': 'F', '板': 'B', '电': 'D', '池': 'C', '储': 'C', '能': 'N', '逆': 'N', '变': 'B', '器': 'Q',
                '支': 'Z', '架': 'J', '缆': 'L', '线': 'X', '辅': 'F', '材': 'C', '安': 'A', '装': 'Z', '组': 'Z', '件': 'J',
                '系': 'X', '统': 'T', '监': 'J', '控': 'K', '柜': 'G', '箱': 'X'
            };
            let initials = '';
            for (let char of str) {
                initials += dict[char] || char.charAt(0).toUpperCase();
            }
            return initials.replace(/[^A-Z]/g, '') || 'PROD';
        }

        function generateNextId(category) {
            const prefix = getPinyinInitials(category);
            const regex = new RegExp(`^${prefix}(\\d+)$`);
            let maxNum = 0;
            products.forEach(p => {
                const match = String(p.id).match(regex);
                if (match) {
                    const num = parseInt(match[1]);
                    if (num > maxNum) maxNum = num;
                }
            });
            return `${prefix}${String(maxNum + 1).padStart(3, '0')}`;
        }

        window.openImportModal = () => document.getElementById('import-modal').classList.remove('hidden');
        window.closeImportModal = () => {
            document.getElementById('import-modal').classList.add('hidden');
            // 重置状态
            goToStep(1, true);
            document.getElementById('excel-file-input').value = '';
            document.getElementById('file-name-display').textContent = '';
        };

        window.goToStep = (step, isReset = false) => {
            if (!isReset && step === 2 && !validateFile()) return;
            if (!isReset && step === 3) {
                processImport();
                return;
            }

            importStep = step;
            document.getElementById('import-step-1').style.display = step === 1 ? 'block' : 'none';
            document.getElementById('import-step-2').style.display = step === 2 ? 'block' : 'none';
            document.getElementById('import-step-3').style.display = step === 3 ? 'block' : 'none';

            const nextBtn = document.getElementById('import-next-btn');
            if (step === 1) {
                nextBtn.textContent = '下一步';
                nextBtn.onclick = () => goToStep(2);
                nextBtn.disabled = !document.getElementById('excel-file-input').files.length;
            } else if (step === 2) {
                nextBtn.textContent = '确认导入';
                nextBtn.onclick = () => goToStep(3);
                nextBtn.disabled = false;
            } else if (step === 3) {
                nextBtn.textContent = '完成';
                nextBtn.onclick = closeImportModal;
            }
        };

        window.handleFileSelect = (files) => {
            if (files.length === 0) return;
            const file = files[0];
            document.getElementById('file-name-display').textContent = `已选择: ${file.name}`;
            document.getElementById('import-next-btn').disabled = false;
            parseExcel(file);
        };

        function validateFile() {
            const fileInput = document.getElementById('excel-file-input');
            if (fileInput.files.length === 0) {
                alert('请选择一个文件');
                return false;
            }
            const file = fileInput.files[0];
            if (file.size > 10 * 1024 * 1024) {
                alert('文件大小不能超过 10MB');
                return false;
            }
            return true;
        }

        function parseExcel(file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, {type: 'array', cellDates: true});
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                
                if (json.length < 2) {
                    alert('Excel 文件为空或没有数据');
                    return;
                }

                importHeaders = json[0];
                importData = json.slice(1).map(row => {
                    let obj = {};
                    importHeaders.forEach((h, i) => obj[h] = row[i]);
                    return obj;
                });

                if (importData.length > 1000) {
                    alert('单次最多导入1000条记录');
                    importData = importData.slice(0, 1000);
                }

                renderFieldMapping();
                renderPreview();
            };
            reader.readAsArrayBuffer(file);
        }

        function renderFieldMapping() {
            const container = document.getElementById('field-mapping-container');
            const aliases = { scenario: ['子类目', '应用场景'] };
            container.innerHTML = Object.keys(systemFields).map(key => `
                <div class="flex items-center">
                    <label class="w-28 font-bold text-slate-600">${systemFields[key]}:</label>
                    <select id="map-${key}" class="flex-1 border border-slate-300 rounded-md p-1.5 outline-none focus:border-blue-500 bg-white">
                        <option value="">- 忽略此列 -</option>
                        ${importHeaders.map(h => {
                            const preferred = (aliases[key] || [systemFields[key]]).find(a => importHeaders.includes(a));
                            return `<option value="${h}" ${h === preferred ? 'selected' : ''}>${h}</option>`;
                        }).join('')}
                    </select>
                </div>
            `).join('');
        }

        function renderPreview() {
            const header = document.getElementById('preview-header');
            const body = document.getElementById('preview-body');
            const previewData = importData.slice(0, 10);

            header.innerHTML = `<tr>${importHeaders.map(h => `<th class="py-2 px-3">${h}</th>`).join('')}</tr>`;
            body.innerHTML = previewData.map(row => 
                `<tr>${importHeaders.map(h => `<td class="py-2 px-3">${row[h] || ''}</td>`).join('')}</tr>`
            ).join('');
        }

        function processImport() {
            let successCount = 0;
            let failCount = 0;
            let log = [];

            const mapping = {};
            Object.keys(systemFields).forEach(key => {
                const select = document.getElementById(`map-${key}`);
                if (select.value) mapping[key] = select.value;
            });

            importData.forEach((row, i) => {
                const newProduct = {};
                for (const key in mapping) {
                    newProduct[key] = row[mapping[key]];
                }

                // 如果没填产品全称，跳过
                if (!newProduct.name) {
                    failCount++;
                    log.push(`<p class="text-red-500">第 ${i + 2} 行: 导入失败，产品全称不能为空。</p>`);
                    return;
                }

                // 如果没填编号，则自动生成
                if (!newProduct.id) {
                    newProduct.id = generateNextId(newProduct.category || '通用');
                } else {
                    newProduct.id = String(newProduct.id);
                }

                const existingIndex = products.findIndex(p => p.id === newProduct.id);
                if (existingIndex !== -1) {
                    products[existingIndex] = { ...products[existingIndex], ...newProduct, ts: Date.now() };
                } else {
                    products.push({ ...newProduct, ts: Date.now() });
                }
                successCount++;
            });

            saveToLocal();
            renderImportLog(successCount, failCount, log);
            goToStep(3);
        }

        function renderImportLog(success, failed, details) {
            const logContainer = document.getElementById('import-log');
            let summary = `<p>导入成功: <strong class="text-green-600">${success}</strong> 条</p>`;
            if (failed > 0) {
                summary += `<p>导入失败: <strong class="text-red-600">${failed}</strong> 条</p>`;
            }
            logContainer.innerHTML = summary + '<div class="mt-4 text-xs max-h-60 overflow-y-auto border p-2 rounded-md">' + details.join('') + '</div>';
        }

        window.downloadTemplate = () => {
            const headers = ['产品编号', '产品全称', '类目', '供应商', '规格型号', '子类目', '质保年限', '循环次数', '供货周期', '联系人', '联系方式', '基准采购价', '基准售价'];
            const data = products.map(p => [
                p.id || '',
                p.name || '',
                p.category || '',
                p.vendor || '',
                p.spec || '',
                p.scenario || '',
                p.warrantyYears || '',
                p.warrantyCycles || '',
                p.leadTime || '',
                p.contact || '',
                p.contactInfo || '',
                p.cost || 0,
                p.price || 0
            ]);
            
            // 如果没数据，加一行示例
            if (data.length === 0) {
                data.push(['GFB001', '示例产品', '光伏板', '通用供应商', '550W', '屋顶', '10', '0', '15天', '张经理', '13800138000', 500, 650]);
            }

            const worksheet = XLSX.utils.aoa_to_sheet([headers, ...data]);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, '产品清单');
            XLSX.writeFile(workbook, '库管理产品清单.xlsx');
        };

        // --- 选择器逻辑 ---
        window.renderPicker = () => {
            const query = (document.getElementById('picker-search')?.value || '').toLowerCase();
            const vendor = document.getElementById('picker-vendor')?.value || '';
            const category = document.getElementById('picker-category')?.value || '';
            const list = document.getElementById('picker-list');
            if(!list) return;

            // 过滤逻辑：必须在库存中有记录且数量 > 0
            const availableBatches = inventory.filter(i => i.quantity > 0);

            const filtered = availableBatches.filter(item => {
                const p = products.find(prod => prod.id === item.productId);
                if (!p) return false;

                const pid = String(item.productId || '').toLowerCase();
                return (!vendor || p.vendor === vendor) && 
                       (!category || p.category === category) && 
                       (!query || p.name.toLowerCase().includes(query) || p.category.toLowerCase().includes(query) || pid.includes(query));
            });

            if(filtered.length === 0) { list.innerHTML = `<div class="p-8 text-center text-xs text-slate-400 italic">未找到有库存的产品...</div>`; return; }
            
            list.innerHTML = filtered.map(item => {
                const p = products.find(prod => prod.id === item.productId);
                const r = computeInventoryPricing({ item, product: p || {} });
                const ch = (item.clearanceHomePrice ?? r.clearanceHomePrice) || 0;
                const cb = (item.clearanceBizPrice ?? r.clearanceBizPrice) || 0;
                const gh = (item.grayHomePrice ?? r.grayHomePrice) || 0;
                const gb = (item.grayBizPrice ?? r.grayBizPrice) || 0;
                return `
                <div class="p-3 hover:bg-purple-50 transition-colors group border-b border-slate-50">
                    <div class="flex justify-between items-start">
                        <div class="min-w-0">
                            <div class="text-sm font-bold text-slate-700 truncate" title="${p.name}">${p.name}</div>
                            <div class="text-[10px] font-mono text-slate-400">${item.productId || ''}</div>
                        </div>
                        <div class="text-right">
                            <span class="text-[10px] text-slate-400 block">仓库: ${item.location || '-'} | 批次: ${item.batchNo}</span>
                            <span class="text-[10px] text-slate-400 block">库存: <span class="text-green-700 font-black">${formatNumberAuto(item.quantity, 4)}</span></span>
                        </div>
                    </div>
                    <div class="flex justify-between items-center mt-2">
                        <div class="flex gap-2">
                            <span class="text-[9px] uppercase px-1.5 py-0.5 bg-slate-100 text-slate-400 rounded">${p.category}</span>
                            <span class="text-[9px] uppercase px-1.5 py-0.5 bg-slate-100 text-slate-400 rounded">${p.vendor}</span>
                        </div>
                        <div class="flex flex-wrap gap-2 justify-end">
                            <button onclick="pickProduct('${item.id}', 'clearance_home')" class="px-3 py-1 bg-blue-700 text-white text-[10px] font-bold rounded-lg hover:bg-blue-800 transition-all shadow-sm">清关家用 ¥${formatNumberAuto(ch, 4)}</button>
                            <button onclick="pickProduct('${item.id}', 'clearance_biz')" class="px-3 py-1 bg-sky-700 text-white text-[10px] font-bold rounded-lg hover:bg-sky-800 transition-all shadow-sm">清关工商业 ¥${formatNumberAuto(cb, 4)}</button>
                            <button onclick="pickProduct('${item.id}', 'gray_home')" class="px-3 py-1 bg-indigo-700 text-white text-[10px] font-bold rounded-lg hover:bg-indigo-800 transition-all shadow-sm">灰清家用 ¥${formatNumberAuto(gh, 4)}</button>
                            <button onclick="pickProduct('${item.id}', 'gray_biz')" class="px-3 py-1 bg-violet-700 text-white text-[10px] font-bold rounded-lg hover:bg-violet-800 transition-all shadow-sm">灰清工商业 ¥${formatNumberAuto(gb, 4)}</button>
                        </div>
                    </div>
                </div>`}).join('');
        };
        window.pickProduct = (inventoryId, priceType) => {
            const item = inventory.find(i => i.id === inventoryId); if(!item) return;
            const p = products.find(prod => prod.id === item.productId); if(!p) return;
            
            const cost = item.purchasePrice || 0;
            const r = computeInventoryPricing({ item, product: p });
            let price = 0;
            if (priceType === 'clearance_home') price = (item.clearanceHomePrice ?? r.clearanceHomePrice) || 0;
            else if (priceType === 'clearance_biz') price = (item.clearanceBizPrice ?? r.clearanceBizPrice) || 0;
            else if (priceType === 'gray_home') price = (item.grayHomePrice ?? r.grayHomePrice) || 0;
            else if (priceType === 'gray_biz') price = (item.grayBizPrice ?? r.grayBizPrice) || 0;
            else price = (item.clearanceHomePrice ?? r.clearanceHomePrice) || 0;

            const firstBlankIdx = quoteRows.findIndex(r => r.isBlank);
            const insertIdx = firstBlankIdx === -1 ? quoteRows.length : firstBlankIdx;
            const candidateIdx = Math.min(Math.max(insertIdx - 1, 0), quoteRows.length - 1);
            const candidate = quoteRows[candidateIdx];

            if (candidate && !candidate.isBlank && !candidate.description && candidate.price === 0) {
                candidate.description = p.name;
                candidate.vendor = p.vendor || '';
                candidate.spec = p.spec || '';
                candidate.batchNo = item.batchNo;
                candidate.price = price;
                candidate.cost = cost;
                candidate.productId = item.productId || '';
                candidate.inventoryId = item.id || '';
            } else {
                quoteRows.splice(insertIdx, 0, { id: Date.now(), description: p.name, vendor: p.vendor || '', spec: p.spec || '', batchNo: item.batchNo, quantity: 1, price: price, cost: cost, productId: item.productId || '', inventoryId: item.id || '' });
            }
            renderQuote();
        };

        // --- 其他工具 ---
        function updatePickerFilters() {
            const vendors = [...new Set(products.map(p => p.vendor).filter(Boolean))];
            const categories = [...new Set(products.map(p => p.category).filter(Boolean))];
            const vS = document.getElementById('picker-vendor'), cS = document.getElementById('picker-category');
            if(vS) vS.innerHTML = `<option value="">全部供应商</option>` + vendors.map(v => `<option value="${v}">${v}</option>`).join('');
            if(cS) cS.innerHTML = `<option value="">全部类目</option>` + categories.map(c => `<option value="${c}">${c}</option>`).join('');
        }
        function updateDatalists() {
            const cats = [...new Set(products.map(p => p.category))];
            document.getElementById('cat-suggestions').innerHTML = cats.map(c => `<option value="${c}">`).join('');
            const vendors = [...new Set(products.map(p => p.vendor))];
            document.getElementById('vendor-suggestions').innerHTML = vendors.map(v => `<option value="${v}">`).join('');
            updateSubcatSuggestions();
            
            const invProds = products.map(p => `<option value="${p.id}">${p.name} (${p.vendor})</option>`).join('');
            document.getElementById('inv-product-suggestions').innerHTML = invProds;

            const locations = [...new Set(inventory.map(i => i.location).filter(Boolean))];
            document.getElementById('location-suggestions').innerHTML = locations.map(l => `<option value="${l}">`).join('');
        }
        window.aiImproveName = async () => {
            const nameEl = document.getElementById('m-name'); if(!nameEl.value) return;
            try {
                const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
                    method: 'POST', body: JSON.stringify({ contents: [{ parts: [{ text: `将以下产品名称润色得更专业（15字内）：${nameEl.value}` }] }] })
                });
                const d = await res.json(); nameEl.value = d.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || nameEl.value;
            } catch(e) {}
        };

        // --- 计算器逻辑 ---
        window.calculatePV = () => {
            const area = parseFloat(document.getElementById('pv-area').value) || 0, util = parseFloat(document.getElementById('pv-util').value) || 0, capSqm = parseFloat(document.getElementById('pv-cap-sqm').value) || 0, panelSpec = parseFloat(document.getElementById('pv-panel').value) || 0, hours = parseFloat(document.getElementById('pv-hours').value) || 0;
            const totalKW = (area * util * capSqm) / 1000, panelCount = panelSpec > 0 ? Math.ceil((totalKW * 1000) / panelSpec) : 0, dailyKwh = totalKW * hours, batteryCap = totalKW * 2;
            document.getElementById('res-kw').textContent = totalKW.toFixed(2); document.getElementById('res-kwh-day').textContent = dailyKwh.toFixed(2);
            document.getElementById('res-panels').textContent = panelCount; document.getElementById('summary-panels').textContent = panelCount;
            document.getElementById('res-battery').textContent = batteryCap.toFixed(2); document.getElementById('summary-battery').textContent = batteryCap.toFixed(2);
        };
        let costData = {
            pv: [{ name: '光伏板', price: 1, freight: 5, importTax: 0, sst: 10, profit: 1.1 }, { name: '支架', price: 0.4, freight: 5, importTax: 0, sst: 10, profit: 1.1 }, { name: '逆变器', price: 0.275, freight: 5, importTax: 0, sst: 10, profit: 1.1 }, { name: '辅材', price: 0.2, freight: 5, importTax: 0, sst: 10, profit: 1.1 }, { name: '并网柜', price: 0.1, freight: 5, importTax: 0, sst: 10, profit: 1.1 }, { name: '安装管理费', price: 0.3, freight: 0, importTax: 0, sst: 0, profit: 1.1 }, { name: '其他管理费', price: 0.1, freight: 0, importTax: 0, sst: 0, profit: 1.1 }, { name: '安装费', price: 0.4, freight: 0, importTax: 0, sst: 0, profit: 1.1 }],
            bat: [{ name: '纯电池', price: 0.55, freight: 5, importTax: 20, sst: 10, profit: 1.2 }, { name: '并机柜防逆流', price: 0.2, freight: 5, importTax: 0, sst: 10, profit: 1.2 }, { name: '其他材料', price: 0.15, freight: 5, importTax: 0, sst: 10, profit: 1.2 }]
        };
        window.updateCostData = (group, index, field, value) => { costData[group][index][field] = parseFloat(value) || 0; renderCostCalcUI(); };
        window.renderCostCalcUI = () => {
            renderProfitSettingsUI();
            const rate = parseFloat(document.getElementById('rate-myr-cny').value) || 1.53;
            const renderG = (g, tBId, tFId) => {
                const tB = document.getElementById(tBId), tF = document.getElementById(tFId); if(!tB || !tF) return;
                let sTC = 0, sQRmb = 0, sQRm = 0;
                tB.innerHTML = costData[g].map((item, idx) => {
                    const tC = item.price * (1 + item.importTax / 100 + item.sst / 100 + item.freight / 100), qRmb = tC * item.profit, qRm = qRmb / rate;
                    sTC += tC; sQRmb += qRmb; sQRm += qRm;
                    return `<tr><td class="py-3 px-4 font-medium text-slate-700">${item.name}</td><td class="py-3 px-4 text-right"><input type="number" step="0.01" value="${item.price}" oninput="updateCostData('${g}', ${idx}, 'price', this.value)" class="w-16 text-right bg-transparent border-b border-dashed border-slate-300 outline-none text-blue-600 font-bold"></td><td class="py-3 px-4 text-right"><input type="number" value="${item.freight}" oninput="updateCostData('${g}', ${idx}, 'freight', this.value)" class="w-12 text-right bg-transparent border-b border-dashed border-slate-300 outline-none"></td><td class="py-3 px-4 text-right"><input type="number" value="${item.importTax}" oninput="updateCostData('${g}', ${idx}, 'importTax', this.value)" class="w-12 text-right bg-transparent border-b border-dashed border-slate-300 outline-none"></td><td class="py-3 px-4 text-right"><input type="number" value="${item.sst}" oninput="updateCostData('${g}', ${idx}, 'sst', this.value)" class="w-12 text-right bg-transparent border-b border-dashed border-slate-300 outline-none"></td><td class="py-3 px-4 text-right bg-slate-100/50 font-mono text-slate-600">${tC.toFixed(4)}</td><td class="py-3 px-4 text-right"><input type="number" step="0.1" value="${item.profit}" oninput="updateCostData('${g}', ${idx}, 'profit', this.value)" class="w-16 text-right bg-transparent border-b border-dashed border-slate-300 outline-none font-bold"></td><td class="py-3 px-4 text-right bg-blue-50/50 font-black text-blue-700">${qRmb.toFixed(4)}</td><td class="py-3 px-4 text-right bg-green-50/50 font-black text-green-700">${qRm.toFixed(4)}</td></tr>`;
                }).join('');
                tF.innerHTML = `<tr><td colspan="5" class="py-4 px-4 text-right text-slate-500">合计：</td><td class="py-4 px-4 text-right bg-slate-200/50 font-mono text-slate-800">${sTC.toFixed(4)}</td><td class="py-4 px-4"></td><td class="py-4 px-4 text-right bg-blue-100/50 font-black text-blue-800 text-lg">${sQRmb.toFixed(4)}</td><td class="py-4 px-4 text-right bg-green-100/50 font-black text-green-800 text-lg">${sQRm.toFixed(4)}</td></tr>`;
            };
            renderG('pv', 'cost-pv-body', 'cost-pv-foot'); renderG('bat', 'cost-bat-body', 'cost-bat-foot');
            recalcInstallerQuote();
        };
        window.fetchLiveRate = async (btn) => {
            if(!btn) return; const oT = btn.innerHTML; btn.innerHTML = '获取中...'; btn.disabled = true;
            try { const res = await fetch('https://api.exchangerate-api.com/v4/latest/MYR'); const data = await res.json(); if(data?.rates?.CNY) { document.getElementById('rate-myr-cny').value = data.rates.CNY.toFixed(4); renderCostCalcUI(); } }
            catch(e) { console.error('获取汇率失败:', e); } finally { btn.innerHTML = oT; btn.disabled = false; }
        };
        window.generateQuoteNo = () => {
            const dateVal = document.getElementById('currentDate').value; if(!dateVal) return;
            const date = new Date(dateVal), yyyy = date.getFullYear(), mm = String(date.getMonth() + 1).padStart(2, '0'), dd = String(date.getDate()).padStart(2, '0');
            const currentNo = document.getElementById('quote-no').value; let suffix = '01';
            if(currentNo && currentNo.startsWith(`QT-${yyyy}${mm}${dd}`)) { const parts = currentNo.split('-'); if(parts.length === 3) suffix = parts[2]; }
            document.getElementById('quote-no').value = `QT-${yyyy}${mm}${dd}-${suffix}`;
        };

        // --- 初始化启动 ---
        // 线上优先：不再在启动时清空本地数据
        if (localStorage.getItem('minova_inventory_cleaned_v2') !== 'true') {
            localStorage.setItem('minova_inventory_cleaned_v2', 'true');
        }

        document.getElementById('currentDate').valueAsDate = new Date();
        generateQuoteNo();
        const trSearch = document.getElementById('transport-search');
        if (trSearch) trSearch.addEventListener('input', () => renderTransport());
        const trStatus = document.getElementById('transport-status-filter');
        if (trStatus) trStatus.addEventListener('change', () => renderTransport());
        const trMethod = document.getElementById('transport-method-filter');
        if (trMethod) trMethod.addEventListener('change', () => renderTransport());
        try {
            const savedValidity = localStorage.getItem('minova_validityDays');
            const n = parseInt(savedValidity || '', 10);
            if (Number.isInteger(n) && n >= 1 && n <= 999) validityDays = n;
        } catch (e) {}
        updateLanguageLabels();
        const termsEl = document.getElementById('val-terms');
        if (termsEl) { 
            requestAnimationFrame(() => {
                termsEl.style.height = ''; 
                termsEl.style.height = termsEl.scrollHeight + 'px'; 
            });
        }
        const addrEl = document.getElementById('company-address');
        // Addr element is now a contenteditable div, so height sync is not needed
        if (termsEl) {
            termsEl.addEventListener('input', () => {
                try { localStorage.setItem(`minova_terms_text_${currentLang}`, termsEl.value); } catch (e) {}
            });
        }
        const shipEl = document.getElementById('val-shipping-handling');
        if (shipEl) {
            shipEl.addEventListener('input', () => {
                try { localStorage.setItem(`minova_shipping_${currentLang}`, shipEl.value); } catch (e) {}
            });
        }
        try {
            const raw = localStorage.getItem('minova_installer_quote_v1');
            if (raw) {
                const d = JSON.parse(raw);
                const laborEl = document.getElementById('installer-labor');
                const bracketEl = document.getElementById('installer-bracket');
                const cableEl = document.getElementById('installer-cable');
                if (laborEl && Number.isFinite(parseFloat(d?.labor))) laborEl.value = String(d.labor);
                if (bracketEl && Number.isFinite(parseFloat(d?.bracket))) bracketEl.value = String(d.bracket);
                if (cableEl && Number.isFinite(parseFloat(d?.cable))) cableEl.value = String(d.cable);
            }
        } catch (e) {}
        try {
            const raw = localStorage.getItem('minova_installer_profit_v1');
            if (raw) {
                installerProfitSettings = normalizeInstallerProfitSettings(JSON.parse(raw));
                const cnEl = document.getElementById('installer-profit-cn');
                const myEl = document.getElementById('installer-profit-my');
                if (cnEl) cnEl.value = String(installerProfitSettings.cnPct);
                if (myEl) myEl.value = String(installerProfitSettings.myPct);
            } else {
                const cnEl = document.getElementById('installer-profit-cn');
                const myEl = document.getElementById('installer-profit-my');
                if (cnEl && String(cnEl.value ?? '').trim() === '') cnEl.value = String(installerProfitSettings.cnPct);
                if (myEl && String(myEl.value ?? '').trim() === '') myEl.value = String(installerProfitSettings.myPct);
            }
        } catch (e) {}

        window.__minovaSync = initGitHubSync({
            getLocalState: () => ({
                products,
                inventory,
                inventoryHistory,
                salesRecords,
                historicalInventory,
                companyCerts,
                transportRecords,
                fileDeleteLogs,
                subcategoriesByCategory,
                profitSettings,
                installerProfitSettings
            }),
            applyRemoteState: (data) => {
                applyStateFromData(data, Date.now());
            }
        });

        window.buildUpdatedHtml = () => {
            const snapshot = {
                v: 1,
                updatedAt: new Date().toISOString(),
                data: {
                    products,
                    inventory,
                    inventoryHistory,
                    salesRecords,
                    historicalInventory,
                    companyCerts,
                    transportRecords,
                    fileDeleteLogs,
                    subcategoriesByCategory,
                    profitSettings,
                    installerProfitSettings
                }
            };
            const json = JSON.stringify(snapshot).replaceAll('<', '\\u003c');
            let el = document.getElementById('minova-embedded-state');
            let prev = '';
            let created = false;
            if (!el) {
                el = document.createElement('script');
                el.id = 'minova-embedded-state';
                el.type = 'application/json';
                document.body.appendChild(el);
                created = true;
            } else {
                prev = el.textContent || '';
            }
            el.textContent = json;
            const modal = document.getElementById('github-sync-modal');
            const modalParent = modal?.parentElement || null;
            const modalNext = modal?.nextSibling || null;
            if (modal && modalParent) modal.remove();
            const html = '<!doctype html>\n' + document.documentElement.outerHTML;
            if (modal && modalParent) modalParent.insertBefore(modal, modalNext);
            if (created) el.remove(); else el.textContent = prev;
            return html;
        };

        window.previewUpdatedHtml = (html, name = 'minova_preview') => {
            const blob = new Blob([html], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
            const w = window.open(url, name);
            setTimeout(() => URL.revokeObjectURL(url), 120000);
            if (!w) throw new Error('预览被浏览器拦截，请允许弹窗后重试');
        };

        window.downloadUpdatedHtml = () => {
            const html = window.buildUpdatedHtml();
            const now = new Date();
            const y = now.getFullYear();
            const m = String(now.getMonth() + 1).padStart(2, '0');
            const d = String(now.getDate()).padStart(2, '0');
            const hh = String(now.getHours()).padStart(2, '0');
            const mm = String(now.getMinutes()).padStart(2, '0');
            const ss = String(now.getSeconds()).padStart(2, '0');
            const filename = `当前页面的更新版本_${y}${m}${d}_${hh}${mm}${ss}.html`;
            const blob = new Blob([html], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
            try { window.previewUpdatedHtml(html, filename); } catch (e) {}
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 120000);
        };
        renderDb();
        renderInventory();
        renderTransport();
        renderSalesRecords();
        renderHistoricalInventory();
        renderInventoryHistory();
        updatePickerFilters();
        renderPicker();
        updateDatalists();
        calculatePV();
        renderProfitSettingsUI();
        renderCostCalcUI();
        startPublishedStatePolling();
        tryLoadPublishedState(true);

        window.toggleCompanyCertPanel = () => {
            const body = document.getElementById('company-cert-body');
            const btn = document.getElementById('btn-toggle-company-cert');
            const isHidden = body.classList.contains('hidden');
            body.classList.toggle('hidden', !isHidden);
            btn.textContent = isHidden ? '收起' : '展开';
            if (isHidden) renderCompanyCertList();
        };

        window.renderCompanyCertUploadSelectors = () => {
            const safe = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

            const isoSel = document.getElementById('iso-cert-vendor-select');
            if (isoSel) {
                const cur = String(isoSel.value || '');
                const vendors = [...new Set((Array.isArray(products) ? products : []).map(p => String(p?.vendor || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
                isoSel.innerHTML = `<option value="">选择供应商</option>` + vendors.map(v => `<option value="${safe(v)}">${safe(v)}</option>`).join('') + `<option value="未指定">未指定</option>`;
                if (cur && (vendors.includes(cur) || cur === '未指定')) isoSel.value = cur;
                isoSel.onchange = () => { try { renderCompanyCertList(); } catch (e) {} };
            }

            const trSel = document.getElementById('transport-cert-transport-select');
            if (trSel) {
                const cur = String(trSel.value || '');
                const rows = (Array.isArray(transportRecords) ? transportRecords : []).slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
                trSel.innerHTML = `<option value="">选择运输单号</option>` + rows.map(r => {
                    const lines = Array.isArray(r?.lines) ? r.lines : [];
                    const batches = [...new Set(lines.map(l => String(l?.batchNo || '').trim()).filter(Boolean))];
                    let batchBrief = '';
                    if (batches.length === 0) batchBrief = '无批次';
                    else if (batches.length === 1) batchBrief = batches[0];
                    else batchBrief = `${batches[0]}+${batches.length - 1}`;
                    const label = `${String(r?.trackingNo || '-')}${batchBrief ? `（${batchBrief}）` : ''}`;
                    return `<option value="${safe(r.id)}">${safe(label)}</option>`;
                }).join('');
                if (cur && rows.some(r => String(r.id) === cur)) trSel.value = cur;
                trSel.onchange = () => { try { renderCompanyCertList(); } catch (e) {} };
            }
        };
        try { renderCompanyCertUploadSelectors(); } catch (e) {}
        try { renderCompanyCertList(); } catch (e) {}

        window.renderCompanyCertList = () => {
            const certs = companyCerts;
            ['iso', 'transport'].forEach(type => {
                const list = document.getElementById(`${type}-cert-list`);
                const empty = document.getElementById(`${type}-cert-empty`);
                const allFiles = type === 'iso' ? certs.isoCerts : certs.transportCerts;

                const norm = (v) => String(v ?? '').trim();
                const normKey = (v) => norm(v).toLowerCase();

                let files = Array.isArray(allFiles) ? allFiles.slice() : [];
                if (type === 'iso') {
                    const vendor = norm(document.getElementById('iso-cert-vendor-select')?.value || '');
                    if (!vendor) {
                        files = [];
                        empty.textContent = '请先选择供应商后查看已上传文件';
                    } else {
                        const vendorK = normKey(vendor);
                        files = files.filter(f => normKey(f?.vendor) === vendorK);
                        empty.textContent = files.length ? '' : `未找到该供应商已上传的文件（${vendor}）`;
                    }
                } else {
                    const transportId = norm(document.getElementById('transport-cert-transport-select')?.value || '');
                    if (!transportId) {
                        files = [];
                        empty.textContent = '请先选择运输单号后查看已上传文件';
                    } else {
                        const rec = (Array.isArray(transportRecords) ? transportRecords : []).find(r => norm(r?.id) === transportId) || {};
                        const trackingNo = norm(rec?.trackingNo);
                        files = files.filter(f => norm(f?.transportId) === transportId || (trackingNo && norm(f?.trackingNo) === trackingNo));
                        empty.textContent = files.length ? '' : '未找到该运输单号已上传的文件';
                    }
                }

                if (!files || files.length === 0) {
                    list.innerHTML = '';
                    empty.classList.remove('hidden');
                } else {
                    empty.classList.add('hidden');
                    list.innerHTML = '';
                    files.forEach(f => {
                        const div = document.createElement('div');
                        div.className = 'flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2';
                        const a = document.createElement('a');
                        const url = new URL(String(f?.path || ''), window.location.href).toString();
                        a.href = url;
                        a.target = '_blank';
                        a.rel = 'noopener';
                        a.className = 'text-sm text-purple-700 hover:underline flex-1 truncate';
                        const label = type === 'iso'
                            ? `${f.name}${String(f.vendor || '').trim() ? `（${String(f.vendor || '').trim()}）` : ''}`
                            : `${f.name}${String(f.trackingNo || '').trim() ? `（${String(f.trackingNo || '').trim()}）` : ''}`;
                        a.textContent = label;
                        a.onclick = (e) => { e.preventDefault(); previewCertFile(f.path); };
                        const btn = document.createElement('button');
                        btn.className = 'text-red-400 hover:text-red-600 ml-2 text-xs font-bold';
                        btn.textContent = '删除';
                        btn.onclick = () => deleteCompanyCert(type, f.id);
                        div.appendChild(a);
                        div.appendChild(btn);
                        list.appendChild(div);
                    });
                }
            });
        };

        window.openCertUpload = (type) => {
            const t = String(type || '').trim();
            const meta = {};
            if (t === 'iso') {
                const vendor = String(document.getElementById('iso-cert-vendor-select')?.value || '').trim();
                if (!vendor) return alert('请先选择供应商');
                meta.vendor = vendor;
            } else if (t === 'transport') {
                const transportId = String(document.getElementById('transport-cert-transport-select')?.value || '').trim();
                if (!transportId) return alert('请先选择运输单号');
                const rec = (Array.isArray(transportRecords) ? transportRecords : []).find(r => String(r.id) === transportId) || {};
                const trackingNo = String(rec.trackingNo || '').trim();
                if (!trackingNo) return alert('该运输记录缺少运输单号');
                meta.transportId = transportId;
                meta.trackingNo = trackingNo;
            }
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.pdf,.jpg,.jpeg,.png';
            input.onchange = async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                await uploadCompanyCert(t, file, meta);
            };
            input.click();
        };

        window.uploadCompanyCert = async (type, file, meta = {}) => {
            try {
                const arrayBuffer = await file.arrayBuffer();
                const bytes = new Uint8Array(arrayBuffer);
                const digest = await crypto.subtle.digest('SHA-256', arrayBuffer);
                const hashHex = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
                let binary = '';
                for (let i = 0; i < bytes.length; i++) {
                    binary += String.fromCharCode(bytes[i]);
                }
                const content = btoa(binary);
                const path = `minova-data/certifications/${type}/${file.name}`;
                const { owner, repo: repoName, branch } = window.__minovaSync.config;
                await window.__minovaSync.repo.commitTextFiles({
                    owner,
                    repo: repoName,
                    branch,
                    message: `minova: upload cert ${file.name}`,
                    files: [{ path, content, encoding: 'base64' }]
                });
                const m = meta && typeof meta === 'object' ? meta : {};
                const certEntry = {
                    id: crypto.randomUUID(),
                    name: file.name,
                    path: path,
                    size: file.size,
                    sha256: hashHex,
                    uploadedAt: new Date().toISOString()
                };
                if (type === 'iso') {
                    certEntry.vendor = String(m.vendor || '').trim();
                    companyCerts.isoCerts.push(certEntry);
                } else {
                    certEntry.transportId = String(m.transportId || '').trim();
                    certEntry.trackingNo = String(m.trackingNo || '').trim();
                    companyCerts.transportCerts.push(certEntry);
                }
                saveToLocal();
                renderCompanyCertList();
                try { if (document.getElementById('cert-attachment-modal')) renderCompanyCertCheckboxes(); } catch (e) {}
                try { if (document.getElementById('cert-attachment-modal')) updateCertSelectedSummary(); } catch (e) {}
            } catch (err) {
                alert('上传失败: ' + err.message);
            }
        };

        function pushFileDeleteLog(entry) {
            const e = entry && typeof entry === 'object' ? entry : {};
            const cfg = window.__minovaSync?.getStatus?.()?.config || window.__minovaSync?.config || {};
            const user = String(cfg.owner || '').trim() || '-';
            const row = {
                id: crypto.randomUUID(),
                at: new Date().toISOString(),
                user,
                scope: String(e.scope || ''),
                fileType: String(e.fileType || ''),
                path: String(e.path || ''),
                name: String(e.name || ''),
                productId: e.productId ? String(e.productId) : ''
            };
            fileDeleteLogs.unshift(row);
            if (fileDeleteLogs.length > 500) fileDeleteLogs = fileDeleteLogs.slice(0, 500);
        }
        function extractStateJsonFromHtml(html) {
            const m = String(html || '').match(/\x3Cscript id="minova-embedded-state"[^>]*>([\s\S]*?)<\/script>/i);
            if (!m) throw new Error('无法提取 state 快照');
            const parsed = JSON.parse(m[1]);
            return JSON.stringify(parsed, null, 2);
        }
        async function commitPagesUpdateWithDeletes({ deletePaths, message }) {
            const sync = window.__minovaSync;
            const s = sync?.getStatus?.();
            if (!s?.connected) throw new Error('GitHub 未连接');
            const cfg = s.config || sync.config || {};
            const owner = cfg.owner;
            const repo = cfg.repo;
            const branch = cfg.branch || 'main';
            if (!owner || !repo) throw new Error('缺少仓库配置');

            const html = window.buildUpdatedHtml?.();
            if (!html) throw new Error('无法生成更新后的 HTML');
            const stateJson = extractStateJsonFromHtml(html);

            const del = Array.isArray(deletePaths) ? deletePaths.filter(Boolean) : [];
            const files = [
                { path: 'index.html', content: html },
                { path: 'minova-data/state.json', content: stateJson },
                ...del.map((p) => ({ path: String(p), delete: true }))
            ];
            await sync.repo.commitTextFiles({ owner, repo, branch, message, files });
        }

        window.deleteCompanyCert = async (type, certId) => {
            if (!confirm('确定删除该文件？')) return;
            const s = window.__minovaSync?.getStatus?.();
            if (!s?.connected) return alert('请先连接 GitHub（需要同步删除线上文件）');

            const certs = type === 'iso' ? companyCerts.isoCerts : companyCerts.transportCerts;
            const idx = certs.findIndex(c => c.id === certId);
            if (idx === -1) return;

            const removed = certs[idx];
            const before = JSON.stringify(certs);
            const beforeLogs = JSON.stringify(fileDeleteLogs);
            try {
                certs.splice(idx, 1);
                pushFileDeleteLog({ scope: 'company', fileType: type, path: removed?.path, name: removed?.name });
                await commitPagesUpdateWithDeletes({
                    deletePaths: [removed?.path].filter(Boolean),
                    message: `minova: delete company cert ${removed?.name || removed?.path || ''}`.trim()
                });
                saveToLocal();
                renderCompanyCertList();
                try { if (document.getElementById('cert-attachment-modal')) renderCompanyCertCheckboxes(); } catch (e) {}
                try { if (document.getElementById('cert-attachment-modal')) updateCertSelectedSummary(); } catch (e) {}
            } catch (e) {
                try { certs.splice(0, certs.length, ...JSON.parse(before)); } catch (e2) {}
                try { fileDeleteLogs = JSON.parse(beforeLogs); } catch (e2) {}
                saveToLocal();
                renderCompanyCertList();
                alert('删除失败：' + String(e?.message || e || ''));
            }
        };

        window.previewCertFile = (path) => {
            const url = new URL(String(path || ''), window.location.href).toString();
            const win = window.open(url, '_blank', 'noopener,noreferrer,width=1100,height=800');
            if (!win) {
                navigator.clipboard.writeText(url);
                alert('链接已复制到剪贴板，请在浏览器中打开');
            }
        };

        window.openProductCertUpload = (type) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.pdf,.jpg,.jpeg,.png';
            input.onchange = async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                await uploadProductCert(type, file);
            };
            input.click();
        };

        window.uploadProductCert = async (type, file) => {
            const pid = window.editId;
            if (!pid) { alert('请先保存产品后再上传认证文件'); return; }
            try {
                const arrayBuffer = await file.arrayBuffer();
                const bytes = new Uint8Array(arrayBuffer);
                const digest = await crypto.subtle.digest('SHA-256', arrayBuffer);
                const hashHex = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
                let binary = '';
                for (let i = 0; i < bytes.length; i++) {
                    binary += String.fromCharCode(bytes[i]);
                }
                const content = btoa(binary);
                const subDir = type === 'tuv' ? 'tuv' : 'specs';
                const path = `minova-data/certifications/products/${pid}/${subDir}/${file.name}`;
                const { owner, repo, branch } = window.__minovaSync.config;
                await window.__minovaSync.repo.commitTextFiles({
                    owner, repo, branch,
                    message: `minova: upload product cert ${file.name}`,
                    files: [{ path, content, encoding: 'base64' }]
                });
                const certEntry = {
                    id: crypto.randomUUID(),
                    name: file.name,
                    path: path,
                    size: file.size,
                    sha256: hashHex,
                    uploadedAt: new Date().toISOString()
                };
                const p = products.find(x => x.id === pid);
                if (!p.certifications) {
                    p.certifications = { tuvCerts: [], specSheets: [] };
                }
                if (type === 'tuv') {
                    p.certifications.tuvCerts.push(certEntry);
                } else {
                    p.certifications.specSheets.push(certEntry);
                }
                saveToLocal();
                renderProductCertsInModal();
            } catch (err) {
                alert('上传失败: ' + err.message);
            }
        };

        window.renderProductCertsInModal = () => {
            const pid = window.editId;
            if (!pid) {
                ['tuv', 'specs'].forEach(type => {
                    document.getElementById(`product-${type}-list`).innerHTML = '';
                    document.getElementById(`product-${type}-empty`).classList.remove('hidden');
                });
                return;
            }
            const p = products.find(x => x.id === pid);
            if (!p) return;
            const certs = p.certifications || {};
            ['tuv', 'specs'].forEach(type => {
                const list = document.getElementById(`product-${type}-list`);
                const empty = document.getElementById(`product-${type}-empty`);
                const files = type === 'tuv' ? (certs.tuvCerts || []) : (certs.specSheets || []);
                if (!files.length) {
                    list.innerHTML = '';
                    empty.classList.remove('hidden');
                } else {
                    empty.classList.add('hidden');
                    list.innerHTML = '';
                    files.forEach(f => {
                        const div = document.createElement('div');
                        div.className = 'flex items-center justify-between bg-slate-50 rounded-lg px-2 py-1.5';
                        const a = document.createElement('a');
                        a.href = '#';
                        a.className = 'text-xs text-blue-600 hover:underline flex-1 truncate';
                        a.textContent = f.name;
                        a.onclick = () => { previewCertFile(f.path); return false; };
                        const btn = document.createElement('button');
                        btn.className = 'text-red-400 hover:text-red-600 ml-2 text-xs font-bold';
                        btn.textContent = '×';
                        btn.onclick = () => deleteProductCert(type, f.id);
                        div.appendChild(a);
                        div.appendChild(btn);
                        list.appendChild(div);
                    });
                }
            });
        };

        window.deleteProductCert = async (type, certId) => {
            if (!confirm('确定删除？')) return;
            const s = window.__minovaSync?.getStatus?.();
            if (!s?.connected) return alert('请先连接 GitHub（需要同步删除线上文件）');

            const pid = window.editId;
            const p = products.find(x => x.id === pid);
            if (!p || !p.certifications) return;
            const arr = type === 'tuv' ? p.certifications.tuvCerts : p.certifications.specSheets;
            const idx = arr.findIndex(c => c.id === certId);
            if (idx === -1) return;

            const removed = arr[idx];
            const before = JSON.stringify(arr);
            const beforeLogs = JSON.stringify(fileDeleteLogs);
            try {
                arr.splice(idx, 1);
                pushFileDeleteLog({ scope: 'product', fileType: type, path: removed?.path, name: removed?.name, productId: pid });
                await commitPagesUpdateWithDeletes({
                    deletePaths: [removed?.path].filter(Boolean),
                    message: `minova: delete product cert ${pid} ${removed?.name || removed?.path || ''}`.trim()
                });
                saveToLocal();
                renderProductCertsInModal();
                try { if (document.getElementById('cert-attachment-modal')) renderProductCertCheckboxes(); } catch (e) {}
                try { if (document.getElementById('cert-attachment-modal')) updateCertSelectedSummary(); } catch (e) {}
            } catch (e) {
                try { arr.splice(0, arr.length, ...JSON.parse(before)); } catch (e2) {}
                try { fileDeleteLogs = JSON.parse(beforeLogs); } catch (e2) {}
                saveToLocal();
                renderProductCertsInModal();
                alert('删除失败：' + String(e?.message || e || ''));
            }
        };

        window.openCertAttachmentModal = () => {
            const modal = document.getElementById('cert-attachment-modal');
            if (!modal) return;
            renderCompanyCertCheckboxes();
            renderProductCertCheckboxes();
            updateCertSelectedSummary();
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        };

        window.renderCompanyCertCheckboxes = () => {
            const modal = document.getElementById('cert-attachment-modal');
            if (!modal) return;
            const isoContainer = modal.querySelector('#qa-iso-cert-checkboxes');
            const transportContainer = modal.querySelector('#qa-transport-cert-checkboxes');
            if (!isoContainer || !transportContainer) return;

            const certs = companyCerts;
            const isoCerts = certs?.isoCerts || [];
            const ctx = window.getQuoteContextForCertMatching?.() || {};
            const vendorsInQuote = ctx?.vendors instanceof Set ? ctx.vendors : new Set();
            const batchesInQuote = ctx?.batches instanceof Set ? ctx.batches : new Set();
            const quotedProductIds = window.getQuotedProductIds?.() || new Set();
            const hasQuotedProducts = quotedProductIds instanceof Set && quotedProductIds.size > 0;

            const norm = (v) => String(v || '').trim();
            if (!hasQuotedProducts) {
                isoContainer.innerHTML = '<p class="text-xs text-slate-400">报价表未选择产品，暂不显示公司级认证文件</p>';
                transportContainer.innerHTML = '<p class="text-xs text-slate-400">报价表未选择产品，暂不显示公司级认证文件</p>';
                updateCertSectionCount('company');
                return;
            }
            if (isoCerts.length === 0) {
                isoContainer.innerHTML = '<p class="text-xs text-slate-400">暂无文件</p>';
            } else {
                if (vendorsInQuote.size) {
                    const matchedIso = isoCerts.filter(f => vendorsInQuote.has(norm(f?.vendor)));
                    if (!matchedIso.length) {
                        isoContainer.innerHTML = `<p class="text-xs text-slate-400">未找到匹配的工厂ISO认证文件（供应商：${[...vendorsInQuote].join('、')}）。请先上传并绑定供应商。</p>`;
                    } else {
                        isoContainer.innerHTML = matchedIso.map(f => `
                            <label class="flex items-center gap-2 py-1 cursor-pointer">
                                <input type="checkbox" class="cert-checkbox" checked data-type="iso" data-id="${f.id}" data-path="${f.path}" data-name="${f.name}">
                                <span class="text-sm text-slate-700 truncate flex-1">${f.name}${norm(f?.vendor) ? `（${norm(f.vendor)}）` : ''}</span>
                            </label>
                        `).join('');
                    }
                } else {
                    isoContainer.innerHTML = isoCerts.map(f => `
                        <label class="flex items-center gap-2 py-1 cursor-pointer">
                            <input type="checkbox" class="cert-checkbox" data-type="iso" data-id="${f.id}" data-path="${f.path}" data-name="${f.name}">
                            <span class="text-sm text-slate-700 truncate flex-1">${f.name}${norm(f?.vendor) ? `（${norm(f.vendor)}）` : ''}</span>
                        </label>
                    `).join('');
                }
            }

            const transportCerts = certs?.transportCerts || [];
            if (transportCerts.length === 0) {
                transportContainer.innerHTML = '<p class="text-xs text-slate-400">暂无文件</p>';
            } else {
                if (batchesInQuote.size) {
                    const hitTransportIds = new Set();
                    (Array.isArray(transportRecords) ? transportRecords : []).forEach(rec => {
                        const lines = Array.isArray(rec?.lines) ? rec.lines : [];
                        for (const l of lines) {
                            const b = norm(l?.batchNo);
                            if (b && batchesInQuote.has(b)) {
                                hitTransportIds.add(String(rec.id || ''));
                                break;
                            }
                        }
                    });
                    const matchedTransport = hitTransportIds.size
                        ? transportCerts.filter(f => hitTransportIds.has(String(f?.transportId || '')))
                        : [];
                    if (!matchedTransport.length) {
                        transportContainer.innerHTML = `<p class="text-xs text-slate-400">未找到匹配的运输文件（采购批次：${[...batchesInQuote].join('、')}）。请先创建运输单并上传运输文件绑定到对应运输单号。</p>`;
                    } else {
                        transportContainer.innerHTML = matchedTransport.map(f => `
                            <label class="flex items-center gap-2 py-1 cursor-pointer">
                                <input type="checkbox" class="cert-checkbox" checked data-type="transport" data-id="${f.id}" data-path="${f.path}" data-name="${f.name}">
                                <span class="text-sm text-slate-700 truncate flex-1">${f.name}${norm(f?.trackingNo) ? `（${norm(f.trackingNo)}）` : ''}</span>
                            </label>
                        `).join('');
                    }
                } else {
                    transportContainer.innerHTML = transportCerts.map(f => `
                        <label class="flex items-center gap-2 py-1 cursor-pointer">
                            <input type="checkbox" class="cert-checkbox" data-type="transport" data-id="${f.id}" data-path="${f.path}" data-name="${f.name}">
                            <span class="text-sm text-slate-700 truncate flex-1">${f.name}${norm(f?.trackingNo) ? `（${norm(f.trackingNo)}）` : ''}</span>
                        </label>
                    `).join('');
                }
            }

            updateCertSectionCount('company');
            modal.querySelectorAll('.cert-checkbox').forEach(cb => {
                cb.addEventListener('change', updateCertSelectedSummary);
            });
        };

        window.renderProductCertCheckboxes = () => {
            const modal = document.getElementById('cert-attachment-modal');
            if (!modal) return;
            const list = modal.querySelector('#qa-product-cert-list');
            const empty = modal.querySelector('#qa-product-cert-empty');
            if (!list || !empty) return;

            const productIds = getQuotedProductIds();
            const quotedProducts = products.filter(p => productIds.has(p.id));

            const productsWithCerts = quotedProducts.filter(p => {
                const certs = p.certifications || {};
                return (certs.tuvCerts && certs.tuvCerts.length > 0) ||
                       (certs.specSheets && certs.specSheets.length > 0);
            });

            if (productsWithCerts.length === 0) {
                list.innerHTML = '';
                empty.classList.remove('hidden');
                const countEl = modal.querySelector('#qa-product-cert-count');
                if (countEl) countEl.textContent = '0 项';
                return;
            }

            empty.classList.add('hidden');
            list.innerHTML = productsWithCerts.map(p => {
                const certs = p.certifications || {};
                const tuvCerts = certs.tuvCerts || [];
                const specSheets = certs.specSheets || [];
                return `
                    <div class="mb-3">
                        <p class="text-xs font-bold text-slate-600 mb-2">${p.id} - ${p.name}</p>
                        ${tuvCerts.length > 0 ? tuvCerts.map(f => `
                            <label class="flex items-center gap-2 py-1 pl-2 cursor-pointer">
                                <input type="checkbox" class="cert-checkbox" data-type="tuv" data-id="${f.id}" data-path="${f.path}" data-name="${f.name}" data-product-id="${p.id}">
                                <span class="text-xs text-slate-700 truncate flex-1">${f.name}</span>
                                <span class="text-xs text-slate-400">TUV</span>
                            </label>
                        `).join('') : ''}
                        ${specSheets.length > 0 ? specSheets.map(f => `
                            <label class="flex items-center gap-2 py-1 pl-2 cursor-pointer">
                                <input type="checkbox" class="cert-checkbox" data-type="specs" data-id="${f.id}" data-path="${f.path}" data-name="${f.name}" data-product-id="${p.id}">
                                <span class="text-xs text-slate-700 truncate flex-1">${f.name}</span>
                                <span class="text-xs text-slate-400">规格书</span>
                            </label>
                        `).join('') : ''}
                    </div>
                `;
            }).join('');

            updateCertSectionCount('product');
        };

        window.getQuotedProductIds = () => {
            const quotedProductIds = new Set();
            (Array.isArray(quoteRows) ? quoteRows : []).forEach(r => {
                if (!r || r.isBlank) return;
                const pid = String(r.productId || '').trim();
                if (pid) {
                    quotedProductIds.add(pid);
                    return;
                }
                const descVal = String(r.description || '').trim().toLowerCase();
                if (!descVal) return;
                products.forEach(p => {
                    if (!p || !p.name) return;
                    const pName = p.name.toLowerCase();
                    const pId = (p.id || '').toLowerCase();
                    if (descVal.includes(pName) || descVal === pId || (pId && descVal.startsWith(pId))) {
                        quotedProductIds.add(p.id);
                    }
                });
            });
            return quotedProductIds;
        };

        window.getQuoteContextForCertMatching = () => {
            const vendors = new Set();
            const batches = new Set();
            const rows = Array.isArray(quoteRows) ? quoteRows : [];
            for (const r of rows) {
                if (!r || r.isBlank) continue;
                const v = String(r.vendor || '').trim();
                if (v) {
                    vendors.add(v);
                } else {
                    const pid = String(r.productId || '').trim();
                    if (pid) {
                        const p = products.find(x => String(x?.id || '').trim() === pid) || {};
                        const vv = String(p.vendor || '').trim();
                        if (vv) vendors.add(vv);
                    } else {
                        const descVal = String(r.description || '').trim().toLowerCase();
                        if (descVal) {
                            for (const p of (Array.isArray(products) ? products : [])) {
                                if (!p || !p.name) continue;
                                const pName = String(p.name || '').toLowerCase();
                                const pId = String(p.id || '').toLowerCase();
                                if (descVal.includes(pName) || descVal === pId || (pId && descVal.startsWith(pId))) {
                                    const vv = String(p.vendor || '').trim();
                                    if (vv) vendors.add(vv);
                                }
                            }
                        }
                    }
                }
                const invId = String(r.inventoryId || '').trim();
                if (invId) {
                    const inv = inventory.find(x => x.id === invId);
                    const b = String(inv?.batchNo || '').trim();
                    if (b) batches.add(b);
                }
                const b2 = String(r.batchNo || '').trim();
                if (b2) batches.add(b2);
            }
            return { vendors, batches };
        };

        window.toggleCertSection = (name) => {
            const modal = document.getElementById('cert-attachment-modal');
            if (!modal) return;
            const body = modal.querySelector(`#qa-${name}-cert-body`);
            const arrow = modal.querySelector(`#qa-${name}-cert-arrow`);
            if (!body || !arrow) return;
            const isHidden = body.classList.contains('hidden');
            body.classList.toggle('hidden', !isHidden);
            arrow.textContent = isHidden ? '▼' : '▶';
        };

        window.updateCertSectionCount = (section) => {
            const modal = document.getElementById('cert-attachment-modal');
            if (!modal) return;
            const countEl = modal.querySelector(`#qa-${section}-cert-count`);
            if (!countEl) return;
            let checkboxes, checked;
            if (section === 'pages') {
                checkboxes = modal.querySelectorAll(`#qa-${section}-cert-body input[type="checkbox"]`);
                checked = modal.querySelectorAll(`#qa-${section}-cert-body input[type="checkbox"]:checked`);
            } else {
                checkboxes = modal.querySelectorAll(`#qa-${section}-cert-body .cert-checkbox`);
                checked = modal.querySelectorAll(`#qa-${section}-cert-body .cert-checkbox:checked`);
            }
            countEl.textContent = `${checked.length}/${checkboxes.length} 项`;
        };

        window.updateCertSelectedSummary = () => {
            const modal = document.getElementById('cert-attachment-modal');
            if (!modal) return;
            const checked = modal.querySelectorAll('.cert-checkbox:checked');
            const summary = modal.querySelector('#qa-cert-selected-summary');
            if (summary) {
                summary.textContent = `已选 ${checked.length} 个文件`;
            }
            updateCertSectionCount('company');
            updateCertSectionCount('product');
            updateCertSectionCount('pages');
        };

        window.toggleAllPages = (select) => {
            const modal = document.getElementById('cert-attachment-modal');
            if (!modal) return;
            modal.querySelectorAll('.print-page-checkbox').forEach(cb => cb.checked = select);
            updateCertSelectedSummary();
        };

        window.buildAttachmentHtml = (selectedFiles) => {
            if (!selectedFiles || selectedFiles.length === 0) return '';

            const { owner, repo } = window.__minovaSync.config;
            const baseUrl = `https://${owner}.github.io/${repo}/`;

            const companyIso = selectedFiles.filter(f => f.type === 'iso');
            const companyTransport = selectedFiles.filter(f => f.type === 'transport');
            const productTuv = selectedFiles.filter(f => f.type === 'tuv');
            const productSpecs = selectedFiles.filter(f => f.type === 'specs');

            let html = '<div style="padding: 20px 0; border-top: 1px solid #e2e8f0; margin-top: 20px;">';
            html += '<h2 style="font-size: 16px; font-weight: bold; color: #1e293b; margin-bottom: 12px;">附件：</h2>';

            if (companyIso.length + companyTransport.length > 0) {
                html += '<div style="margin-bottom: 16px;">';
                html += '<p style="font-size: 13px; font-weight: bold; color: #475569; margin-bottom: 8px;">【公司级认证】</p>';
                companyIso.forEach(f => {
                    const url = baseUrl + f.path;
                    html += `<p style="font-size: 12px; color: #64748b; margin-left: 8px; margin-bottom: 4px;">□ ${f.name} → <a href="${url}" target="_blank" style="color: #7c3aed; text-decoration: underline;">${url}</a></p>`;
                });
                companyTransport.forEach(f => {
                    const url = baseUrl + f.path;
                    html += `<p style="font-size: 12px; color: #64748b; margin-left: 8px; margin-bottom: 4px;">□ ${f.name} → <a href="${url}" target="_blank" style="color: #7c3aed; text-decoration: underline;">${url}</a></p>`;
                });
                html += '</div>';
            }

            if (productTuv.length + productSpecs.length > 0) {
                html += '<div>';
                html += '<p style="font-size: 13px; font-weight: bold; color: #475569; margin-bottom: 8px;">【产品级认证】</p>';

                const byProduct = {};
                [...productTuv, ...productSpecs].forEach(f => {
                    const pid = f.productId || 'unknown';
                    if (!byProduct[pid]) byProduct[pid] = { tuv: [], specs: [] };
                    if (f.type === 'tuv') byProduct[pid].tuv.push(f);
                    else byProduct[pid].specs.push(f);
                });

                Object.entries(byProduct).forEach(([pid, certs]) => {
                    const product = products.find(p => p.id === pid);
                    const pName = product ? product.name : pid;
                    html += `<p style="font-size: 12px; font-weight: bold; color: #475569; margin-left: 4px; margin-bottom: 4px;">${pid} - ${pName}：</p>`;
                    certs.tuv.forEach(f => {
                        const url = baseUrl + f.path;
                        html += `<p style="font-size: 11px; color: #64748b; margin-left: 16px; margin-bottom: 2px;">□ ${f.name} → <a href="${url}" target="_blank" style="color: #7c3aed; text-decoration: underline;">${url}</a></p>`;
                    });
                    certs.specs.forEach(f => {
                        const url = baseUrl + f.path;
                        html += `<p style="font-size: 11px; color: #64748b; margin-left: 16px; margin-bottom: 2px;">□ ${f.name} → <a href="${url}" target="_blank" style="color: #7c3aed; text-decoration: underline;">${url}</a></p>`;
                    });
                });
                html += '</div>';
            }

            html += '</div>';
            return html;
        };

        
        const downloadFile = async (type, path, name) => {
            const cfgStr = localStorage.getItem('minova_github_sync_config_v1');
            const cfg = cfgStr ? JSON.parse(cfgStr) : {};
            const owner = cfg.owner || 'QibbQi';
            const repo = cfg.repo || 'minova';
            const branch = cfg.branch || 'main';
            if (!owner || !repo) throw new Error('未连接 GitHub，无法下载附件');
            const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${String(path).replace(/^\//, '')}?v=${Date.now()}`;
            const res = await fetch(url, { cache: 'no-store' });
            if (!res.ok) throw new Error(`附件下载失败：${res.status}`);
            return res.arrayBuffer();
        };

        const savePdfBytes = (bytes) => {
            const blob = new Blob([bytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = document.getElementById('quote-no').value || 'Quotation.pdf';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 120000);
        };

        window.confirmAndGeneratePDF = async () => {
            const modal = document.getElementById('cert-attachment-modal');
            
            if (modal) {
                const pageCheckboxes = modal.querySelectorAll('.print-page-checkbox:checked');
                window.selectedPrintPages = [1, ...Array.from(pageCheckboxes).map(cb => parseInt(cb.value, 10))];
            }

            const checked = modal ? modal.querySelectorAll('.cert-checkbox:checked') : [];
            const selectedFiles = Array.from(checked).map(cb => ({
                type: cb.dataset.type,
                id: cb.dataset.id,
                path: cb.dataset.path,
                name: cb.dataset.name,
                productId: cb.dataset.productId || null
            }));

            closeCertAttachmentModal();

            const PDFLibRef = window.PDFLib;
            if (!PDFLibRef?.PDFDocument) {
                showToast('当前环境未加载 PDFLib，无法生成合并文件', 'error');
                return;
            }

            const originalStates = {};
            [1, 2, 3, 4, 5].forEach(pageNum => {
                const page = document.getElementById(`quote-page-${pageNum}`);
                if (page) {
                    originalStates[pageNum] = {
                        display: page.style.display,
                        hidden: page.classList.contains('hidden')
                    };
                }
            });

            const loadingOverlay = document.createElement('div');
            loadingOverlay.className = 'fixed inset-0 bg-white/90 z-[9999] flex flex-col items-center justify-center backdrop-blur-sm';
            loadingOverlay.innerHTML = `
                <div class="text-2xl font-bold text-purple-700 mb-4" id="pdf-progress-title">正在初始化 PDF...</div>
                <div class="text-sm text-slate-500">请稍候，这可能需要几秒钟时间</div>
            `;
            document.body.appendChild(loadingOverlay);

            const restoreStates = () => {
                [1, 2, 3, 4, 5].forEach(pageNum => {
                    const page = document.getElementById(`quote-page-${pageNum}`);
                    const state = originalStates[pageNum];
                    if (page && state) {
                        page.style.display = state.display;
                        if (state.hidden) {
                            page.classList.add('hidden');
                        } else {
                            page.classList.remove('hidden');
                        }
                    }
                });
                if (loadingOverlay && loadingOverlay.parentNode) {
                    loadingOverlay.parentNode.removeChild(loadingOverlay);
                }
            };

            try {
                const { PDFDocument } = PDFLibRef;
                const mergedDoc = await PDFDocument.create();
                const quoteNo = document.getElementById('quote-no').value || 'Quotation';
                const titleEl = document.getElementById('pdf-progress-title');

                const opt = {
                    margin: 0,
                    filename: 'temp.pdf',
                    image: { type: 'jpeg', quality: 0.98 },
                    pagebreak: { mode: ['css', 'legacy'] },
                    html2canvas: {
                        scale: 3,
                        useCORS: true,
                        letterRendering: true,
                        scrollX: 0,
                        scrollY: 0,
                        backgroundColor: '#ffffff',
                        onclone: (clonedDoc) => {
                            clonedDoc.documentElement.style.margin = '0';
                            clonedDoc.documentElement.style.padding = '0';
                            clonedDoc.body.style.margin = '0';
                            clonedDoc.body.style.padding = '0';
                            clonedDoc.body.style.width = '210mm';
                            clonedDoc.body.style.maxWidth = '210mm';
                            
                            const wrappers = clonedDoc.querySelectorAll('.quote-page');
                            wrappers.forEach(page => {
                                if (page.style.display !== 'none' && !page.classList.contains('hidden')) {
                                    page.style.boxShadow = 'none';
                                    page.style.border = 'none';
                                    page.style.margin = '0 auto';
                                    page.style.borderRadius = '0';
                                    page.style.boxSizing = 'border-box';
                                    page.style.minHeight = '297mm';
                                    page.style.height = 'auto';
                                    page.style.overflow = 'visible';
                                    page.style.width = '210mm';
                                    page.style.maxWidth = '210mm';
                                }
                            });
                            const cont = clonedDoc.getElementById('pdf-content-wrapper');
                            if (cont) {
                                cont.style.width = '210mm';
                                cont.style.maxWidth = '210mm';
                                cont.style.margin = '0 auto';
                            }
                            clonedDoc.querySelectorAll('.no-print').forEach(el => el.style.display = 'none');

                            const style = clonedDoc.createElement('style');
                            style.innerHTML = `
                                @page { size: A4; margin: 0; }
                                input, textarea { overflow-wrap: anywhere !important; word-break: break-word !important; }
                                textarea { white-space: pre-wrap !important; overflow: visible !important; }
                                #val-terms { white-space: pre-wrap !important; }
                                tr, h1, h2, h3, h4, h5, h6 { page-break-inside: avoid !important; break-inside: avoid !important; }
                                .grand-total-container, .grand-total-container * { page-break-inside: avoid !important; break-inside: avoid !important; }
                                .total-pill { page-break-inside: avoid !important; break-inside: avoid !important; }
                                .signature-container { page-break-inside: avoid !important; break-inside: avoid !important; margin-bottom: 0 !important; }
                                .pv-module .resize-handle, .pv-module .delete-btn { display: none !important; }
                            `;
                            clonedDoc.head.appendChild(style);

                            try {
                                const win = clonedDoc.defaultView || window;
                                const list = Array.from(clonedDoc.querySelectorAll('textarea'));
                                list.forEach((ta) => {
                                    const cs = win.getComputedStyle ? win.getComputedStyle(ta) : null;
                                    const tag = (cs && (cs.display === 'inline' || cs.display === 'inline-block')) ? 'span' : 'div';
                                    const repl = clonedDoc.createElement(tag);
                                    repl.id = ta.id;
                                    repl.className = ta.className;
                                    repl.textContent = String(ta.value ?? '');
                                    if (cs) {
                                        repl.style.display = cs.display;
                                        repl.style.width = cs.width;
                                        repl.style.maxWidth = cs.maxWidth;
                                        repl.style.minWidth = cs.minWidth;
                                        repl.style.font = cs.font;
                                        repl.style.fontSize = cs.fontSize;
                                        repl.style.lineHeight = cs.lineHeight;
                                        repl.style.fontWeight = cs.fontWeight;
                                        repl.style.textTransform = cs.textTransform;
                                        repl.style.letterSpacing = cs.letterSpacing;
                                        repl.style.textAlign = cs.textAlign;
                                        repl.style.padding = cs.padding;
                                        repl.style.margin = cs.margin;
                                        repl.style.borderRadius = cs.borderRadius;
                                    }
                                    repl.style.boxSizing = 'border-box';
                                    repl.style.whiteSpace = 'pre-wrap';
                                    repl.style.overflowWrap = 'anywhere';
                                    repl.style.wordBreak = 'break-all';
                                    repl.style.overflow = 'visible';
                                    repl.style.background = 'transparent';
                                    repl.style.height = 'auto';
                                    ta.replaceWith(repl);
                                });
                            } catch (e) {}
                        }
                    },
                    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait', compress: true }
                };

                // Render internal pages sequentially
                for (let i = 0; i < window.selectedPrintPages.length; i++) {
                    const pageNum = window.selectedPrintPages[i];
                    if (titleEl) titleEl.textContent = `正在生成页面 ${pageNum}... (${i + 1}/${window.selectedPrintPages.length})`;
                    
                    // Hide all, show only current
                    [1, 2, 3, 4, 5].forEach(pn => {
                        const p = document.getElementById(`quote-page-${pn}`);
                        if (p) {
                            if (pn === pageNum) {
                                p.classList.remove('hidden');
                                p.style.display = 'block';
                            } else {
                                p.classList.add('hidden');
                                p.style.display = 'none';
                            }
                        }
                    });

                    try {
                        const cur = document.getElementById(`quote-page-${pageNum}`);
                        if (cur) window.autosizeAllTextareas?.(cur);
                    } catch (e) {}

                    // Await next frame to ensure DOM updates
                    await new Promise(r => setTimeout(r, 100));

                    const container = document.getElementById('pdf-content-wrapper');
                    const pdfData = await html2pdf().set(opt).from(container).toPdf().get('pdf').then(pdf => {
                        const total = pdf.internal.getNumberOfPages();
                        const last = pdf.internal.pages?.[total];
                        if (last && last.length <= 1) pdf.deletePage(total);
                        return pdf.output('arraybuffer');
                    });

                    const tempDoc = await PDFDocument.load(pdfData);
                    const copiedPages = await mergedDoc.copyPages(tempDoc, tempDoc.getPageIndices());
                    copiedPages.forEach(p => mergedDoc.addPage(p));
                }

                // Process external attachments
                const skipped = [];
                const failed = [];
                const A4 = [595.28, 841.89];

                for (let i = 0; i < selectedFiles.length; i++) {
                    const f = selectedFiles[i];
                    if (titleEl) titleEl.textContent = `正在合并附件... (${i + 1}/${selectedFiles.length})`;
                    
                    const name = String(f?.name || '');
                    const path = String(f?.path || '');
                    const ext = name.toLowerCase().split('.').pop() || '';

                    try {
                        const bytes = await downloadFile(f.type, path, name);
                        if (ext === 'pdf') {
                            const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
                            const pages = await mergedDoc.copyPages(doc, doc.getPageIndices());
                            pages.forEach(p => mergedDoc.addPage(p));
                        } else if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
                            const img = ext === 'png' ? await mergedDoc.embedPng(bytes) : await mergedDoc.embedJpg(bytes);
                            const dims = img.scale(1);
                            const page = mergedDoc.addPage(A4);
                            const pw = page.getWidth();
                            const ph = page.getHeight();
                            const ratio = Math.min((pw - 40) / dims.width, (ph - 40) / dims.height);
                            const w = dims.width * ratio;
                            const h = dims.height * ratio;
                            page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
                        } else {
                            skipped.push(name);
                        }
                    } catch (e) {
                        console.error(`Error processing ${name}:`, e);
                        failed.push(name);
                    }
                }

                if (titleEl) titleEl.textContent = `正在保存...`;
                const finalBytes = await mergedDoc.save();
                savePdfBytes(finalBytes);

                if (skipped.length || failed.length) {
                    let msg = '';
                    if (skipped.length) msg += `跳过 ${skipped.length} 个非 PDF/图片文件。\n`;
                    if (failed.length) msg += `处理失败 ${failed.length} 个文件。\n`;
                    showToast(msg + '请检查控制台获取详情。', 'error');
                }

            } catch (e) {
                console.error("PDF generation failed:", e);
                showToast("PDF生成失败，请检查控制台错误", "error");
            } finally {
                restoreStates();
            }
        };

        window.closeCertAttachmentModal = () => {
            const modal = document.getElementById('cert-attachment-modal');
            if (!modal) return;
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        };
    