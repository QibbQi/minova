
        const localStorage = (() => {
            const memory = new Map();
            let native = null;
            try {
                native = globalThis.localStorage;
                const k = '__minova_storage_probe__';
                native.setItem(k, '1');
                native.removeItem(k);
            } catch (e) {
                native = null;
            }
            const fallback = {
                getItem: (key) => memory.has(String(key)) ? memory.get(String(key)) : null,
                setItem: (key, value) => { memory.set(String(key), String(value)); },
                removeItem: (key) => { memory.delete(String(key)); },
                clear: () => { memory.clear(); },
                key: (index) => Array.from(memory.keys())[Number(index)] ?? null,
                get length() { return memory.size; }
            };
            const safe = {
                getItem(key) {
                    if (native) {
                        try { return native.getItem(key); } catch (e) {}
                    }
                    return fallback.getItem(key);
                },
                setItem(key, value) {
                    if (native) {
                        try { native.setItem(key, value); return; } catch (e) {}
                    }
                    fallback.setItem(key, value);
                },
                removeItem(key) {
                    if (native) {
                        try { native.removeItem(key); return; } catch (e) {}
                    }
                    fallback.removeItem(key);
                },
                clear() {
                    if (native) {
                        try { native.clear(); return; } catch (e) {}
                    }
                    fallback.clear();
                },
                key(index) {
                    if (native) {
                        try { return native.key(index); } catch (e) {}
                    }
                    return fallback.key(index);
                },
                get length() {
                    if (native) {
                        try { return native.length; } catch (e) {}
                    }
                    return fallback.length;
                },
                get isFallback() { return !native; }
            };
            globalThis.__minovaSafeLocalStorage = safe;
            return safe;
        })();

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
                const btn = el('button', { title: 'GitHub Backup / Static Publish', class: `${btnBaseClass} bg-red-600 hover:bg-red-700 text-white border-red-700`, text: 'Backup' });

                root.innerHTML = '';
                const existing = document.getElementById('github-sync-modal');
                if (existing) existing.remove();

                const modal = el('div', { id: 'github-sync-modal', class: 'fixed inset-0 bg-slate-900/60 backdrop-blur-sm hidden items-center justify-center z-[300] p-4' });
                const card = el('div', { class: 'bg-white rounded-2xl p-6 w-full max-w-xl shadow-2xl max-h-[90vh] overflow-y-auto' });
                modal.append(card);

                const title = el('div', { class: 'text-lg font-black text-slate-800', text: 'GitHub Backup / Static Publish' });
                const tip = el('div', { class: 'text-xs text-slate-500 mt-1', text: '业务主数据优先保存到 Cloudflare D1。这里的 PAT 只用于静态备份、GitHub Pages 发布和附件文件维护，不是维护 Supplier/Product/Inventory/Price List 的必要条件。' });

                const form = el('div', { class: 'mt-5 grid grid-cols-1 gap-4' });
                const repoHint = el('div', { class: 'rounded-xl border border-slate-200 p-4 bg-slate-50 text-xs text-slate-600' });
                const passphrase = el('input', { class: 'w-full border border-slate-200 rounded-xl p-3 text-sm outline-none', placeholder: '本地加密口令（用于加密 PAT）', type: 'password' });
                const pat = el('input', { class: 'w-full border border-slate-200 rounded-xl p-3 text-sm outline-none', placeholder: '粘贴 GitHub PAT（fine-grained，限定 minova Warehouse Contents 读写）', type: 'password' });
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
                const btnClose = el('button', { class: 'px-4 py-2 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50', text: 'Close' });
                const btnCheck = el('button', { class: 'px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold hover:bg-slate-200 border border-slate-200', text: '连接自检' });
                const btnConnectPat = el('button', { class: 'px-4 py-2 rounded-xl bg-slate-900 text-white font-bold hover:bg-black', text: '使用 PAT 连接' });
                const btnSyncData = el('button', { class: 'px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700', text: 'Backup Data' });
                const btnPublish = el('button', { class: 'px-4 py-2 rounded-xl bg-purple-700 text-white font-bold hover:bg-purple-800', text: 'Publish Page' });
                const btnDisconnect = el('button', { class: 'px-4 py-2 rounded-xl bg-red-600 text-white font-bold hover:bg-red-700', text: '断开' });

                footer.append(btnConnectPat, btnSyncData, btnPublish, btnCheck, btnDisconnect, btnClose);
                const actionGuide = el('div', { class: 'mt-4 rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-xs leading-relaxed text-emerald-800', text: 'Recommended: maintain master data after backend login. Use Backup Data only when you want to export a static GitHub copy; use Publish Page only after code/layout changes.' });
                card.append(title, tip, form, actionGuide, msg, footer);

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
                    const localFileMode = window.location.protocol === 'file:';
                    const authMode = !!window.__minovaAuth?.state?.user || document.body.classList.contains('minova-authenticated');
                    const syncAuthorized = document.body.classList.contains('minova-sync-authorized');
                    const dataUnlocked = s.connected || localFileMode || authMode;
                    btn.style.display = syncAuthorized ? '' : 'none';
                    btn.textContent = s.connected
                        ? `Backup(${s.queueSize})`
                        : syncAuthorized
                            ? 'Backup'
                            : 'Hidden';
                    btn.className = `${btnBaseClass} ${s.connected ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-700' : syncAuthorized ? 'bg-purple-700 hover:bg-purple-800 text-white border-purple-800' : 'bg-red-600 hover:bg-red-700 text-white border-red-700'}`;
                    const restrictedTabs = ['quotation', 'costcalc', 'database', 'engineering', 'pricelist', 'inventory', 'transport'];
                    for (const t of restrictedTabs) {
                        const tabBtn = document.getElementById(`tab-${t}`);
                        if (tabBtn) tabBtn.style.display = dataUnlocked ? '' : 'none';
                    }
                    const pdfBtn = document.getElementById('btn-generate-pdf');
                    if (pdfBtn) pdfBtn.style.display = dataUnlocked ? '' : 'none';
                    if (!dataUnlocked) {
                        const activeRestricted = restrictedTabs.some(t => {
                            const view = document.getElementById(`view-${t}`);
                            return view && !view.classList.contains('hidden') && view.style.display !== 'none';
                        });
                        if (activeRestricted) {
                            try { window.switchTab?.('pvcalc'); } catch (e) {}
                        }
                    }
                    btnCheck.style.display = s.connected ? '' : 'none';
                    btnSyncData.style.display = s.connected ? '' : 'none';
                    btnPublish.style.display = s.connected ? '' : 'none';
                    const cfg = s.config || {};
                    repoHint.textContent = `Static backup repository: ${cfg.owner || defaults.owner}/${cfg.repo || defaults.repo} (branch: ${cfg.branch || defaults.branch})`;
                };

                btn.onclick = () => {
                    if (!document.body.classList.contains('minova-sync-authorized')) {
                        alert('No permission to access data sync.');
                        return;
                    }
                    window.__minovaAuth?.auditEvent?.('data_sync_opened', 'sync', 'github', {
                        connected: !!state().connected
                    });
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

                btnSyncData.onclick = async () => {
                    stopDots();
                    btnSyncData.disabled = true;
                    btnSyncData.classList.add('opacity-60');
                    try {
                        ensureConfig();
                        startDots('同步数据中');
                        const result = await sync.syncStateJson();
                        stopDots();
                        const sha = result?.commit?.sha || result?.sha || '';
                        if (sha) window.__lastGitHubCommitSha = sha;
                        msg.textContent = `已同步数据：minova-data/state.json${sha ? `\nCommit SHA：${sha}` : ''}\n未重新发布 index.html，因此速度更快。`;
                    } catch (e) {
                        stopDots();
                        if (e?.status === 401) {
                            try { await sync.lock(); } catch (e2) {}
                        }
                        msg.textContent = formatErr(e);
                    } finally {
                        btnSyncData.disabled = false;
                        btnSyncData.classList.remove('opacity-60');
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
                        const published = await sync.publishIndexHtml(html);
                        const publishSha = published?.sha || published?.commit?.sha || '';
                        if (publishSha) window.__lastGitHubCommitSha = publishSha;
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
    <h3 class="text-xl font-bold text-slate-800 mb-2">SelectAttach Certification Files</h3>
    <p class="text-xs text-slate-400 mb-5">勾选本次Quote需要附上的认证文件，将拼接在Quote PDF 后面一起交付</p>

    <!-- 附加页面Select -->
    <div class="border border-slate-200 rounded-xl mb-4">
        <div class="flex items-center justify-between p-4 cursor-pointer" onclick="toggleCertSection('pages')">
            <span class="text-sm font-bold text-slate-700">【附加页面Select】</span>
            <span id="qa-pages-cert-count" class="text-xs text-slate-400">4 项</span>
            <span id="qa-pages-cert-arrow">▼</span>
        </div>
        <div id="qa-pages-cert-body" class="px-4 pb-4">
            <div class="flex justify-end gap-2 mb-2">
                <button onclick="toggleAllPages(true)" class="text-xs text-purple-600 hover:underline">Select All</button>
                <button onclick="toggleAllPages(false)" class="text-xs text-slate-500 hover:underline">Select None</button>
            </div>
            <div class="space-y-2">
                <label class="flex items-center gap-2 py-1">
                    <input type="checkbox" class="w-4 h-4 text-purple-600" disabled checked>
                    <span class="text-sm text-slate-400">1. Quotation (Quotation) - Required</span>
                </label>
                <label class="flex items-center gap-2 py-1 cursor-pointer">
                    <input type="checkbox" value="2" class="print-page-checkbox w-4 h-4 text-purple-600" checked onchange="updateCertSelectedSummary()">
                    <span class="text-sm text-slate-700">2. Financial Analysis</span>
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

    <div class="border border-slate-200 rounded-xl mb-4">
        <div class="flex items-center justify-between p-4">
            <span class="text-sm font-bold text-slate-700">【Export选项】</span>
        </div>
        <div class="px-4 pb-4">
            <label class="flex items-start gap-2 py-1 cursor-pointer">
                <input id="qa-rotate-siteoverview" type="checkbox" class="w-4 h-4 text-purple-600 mt-0.5" onchange="onRotateSiteOverviewPrintChanged(this.checked)">
                <div class="flex flex-col">
                    <span class="text-sm text-slate-700">第 5 页画布旋转打印（右转 90°）</span>
                    <span class="text-xs text-slate-400">仅影响 PDF Export，不影响网页端显示</span>
                </div>
            </label>
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
                <p class="text-xs font-bold text-slate-500 mb-2">Transport Files (UN38.3/MSDS)</p>
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
            <p id="qa-product-cert-empty" class="text-xs text-slate-400 hidden">No quoted products have certification files</p>
        </div>
    </div>

    <!-- 底部按钮 -->
    <div class="flex justify-between items-center mt-4">
        <span id="qa-cert-selected-summary" class="text-xs text-slate-500">已选 0 个文件</span>
        <div class="flex gap-3">
            <button onclick="closeCertAttachmentModal()" class="px-4 py-2 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50">Cancel</button>
            <button onclick="confirmAndGeneratePDF()" class="px-4 py-2 rounded-xl bg-purple-700 text-white font-bold hover:bg-purple-800">Generate PDF</button>
        </div>
    </div>
</div>
`;

                ensureConfig();
                refresh();
                document.addEventListener('minova-auth-changed', refresh);
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

                function buildStateSnapshot() {
                    return {
                        v: 1,
                        updatedAt: new Date().toISOString(),
                        data: getLocalState()
                    };
                }

                async function syncStateJson() {
                    if (!unlockedToken) throw new Error('Not connected');
                    const { owner, repo: repoName, branch, path } = config;
                    const statePath = path || 'minova-data/state.json';
                    const content = JSON.stringify(buildStateSnapshot(), null, 2);
                    const result = await repo.upsertText({
                        owner,
                        repo: repoName,
                        branch,
                        path: statePath,
                        message: `minova: sync data (${new Date().toLocaleString()})`,
                        content
                    });
                    appendAudit('sync_data', `${owner}/${repoName}:${statePath}`);
                    return result;
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
                    const result = await repo.commitTextFiles({
                        owner,
                        repo: repoName,
                        branch,
                        message: `minova: publish pages files (${new Date().toLocaleString()})`,
                        files
                    });
                    appendAudit('publish', `${owner}/${repoName}:${files.map((f) => f.path).join(',')}`);
                    return result;
                }

                function getStatus() {
                    return { connected: !!unlockedToken, config, queueSize: queue.items.length, hasTokenStored: !!storage.get(KEY.token) };
                }

                const sync = { storage, getStatus, saveConfig, lock, storeToken, selfCheck, syncStateJson, publishIndexHtml, repo, config };
                mountGitHubSyncUi({ sync });
                return sync;
            };
        })();

        // --- 数据持久化 ---
        let products = [];
        let inventory = [];
        let inventoryHistory = [];
        let marketPrices = { records: [], categoryUnits: {} };
        let salesRecords = [];
        let historicalInventory = [];
        let suppliers = [];
        let channelPartners = [];
        let companyCerts = { isoCerts: [], transportCerts: [] };
        let transportRecords = [];
        let fileDeleteLogs = [];
        let compatibilityRules = [];
        let certificationRequirementsCatalog = [];
        let productCertificationEvidence = [];
        let productMasterDetailTemplates = [];
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
        let installerQuoteSettings = null;
        let installerQuoteRegion = 'peninsular';
        let nonStockPricingStrategies = {};
        function safeJsonParseLoose(raw, fallback) {
            try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
        }
        function htmlSafe(v) {
            return String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
        }
        function domSafeId(v) {
            return String(v ?? '').replace(/[^A-Za-z0-9_-]/g, '_');
        }
        const PRODUCT_CATEGORY_ALIASES = [
            ['光伏组件', 'PV Module'],
            ['光伏板', 'PV Module'],
            ['PV Module', 'PV Module'],
            ['PV Modules', 'PV Module'],
            ['Pv Module', 'PV Module'],
            ['逆变器', 'Inverter'],
            ['电池', 'Battery'],
            ['储能电池', 'Battery'],
            ['配件', 'Accessory'],
            ['一体机', 'All-in-One System'],
            ['工商储', 'C&I Storage'],
            ['工商业储能', 'C&I Storage'],
            ['未分类', 'Uncategorized']
        ];
        const PRODUCT_SUBCATEGORY_ALIASES = [
            ['双面', 'Bifacial'],
            ['三相', 'Three-Phase'],
            ['堆叠式单相逆变器', 'Stackable Single-Phase Inverter'],
            ['堆叠式家储', 'Stackable Home Storage'],
            ['堆叠式产品配件', 'Stackable Product Accessory'],
            ['堆叠式配件', 'Stackable Product Accessory'],
            ['单相一体机', 'Single-Phase All-in-One'],
            ['储能柜', 'Energy Storage Cabinet'],
            ['户外柜', 'Energy Storage Cabinet']
        ];
        function normalizeAliasValue(value, aliases, fallback = '') {
            const raw = String(value ?? '').trim();
            if (!raw) return fallback;
            const found = aliases.find(([from, to]) => raw === from || raw.toLowerCase() === String(to).toLowerCase());
            return found ? found[1] : raw;
        }
        function normalizeProductCategory(value, fallback = '') {
            return normalizeAliasValue(value, PRODUCT_CATEGORY_ALIASES, fallback);
        }
        function normalizeProductSubcategory(value) {
            return normalizeAliasValue(value, PRODUCT_SUBCATEGORY_ALIASES, '');
        }
        function normalizeSubcategoryMap(map) {
            const out = {};
            Object.entries(map && typeof map === 'object' ? map : {}).forEach(([category, values]) => {
                const cat = normalizeProductCategory(category, 'Uncategorized');
                if (!cat) return;
                if (!out[cat]) out[cat] = [];
                (Array.isArray(values) ? values : [values]).forEach((value) => {
                    const sub = normalizeProductSubcategory(value);
                    if (sub && !out[cat].includes(sub)) out[cat].push(sub);
                });
            });
            return out;
        }
        function mergeNormalizedValue(out, key, value) {
            if (value && typeof value === 'object' && !Array.isArray(value) && out[key] && typeof out[key] === 'object' && !Array.isArray(out[key])) {
                out[key] = { ...out[key], ...value };
            } else {
                out[key] = value;
            }
        }
        function normalizeCategoryValueMap(map) {
            const out = {};
            Object.entries(map && typeof map === 'object' ? map : {}).forEach(([category, value]) => {
                mergeNormalizedValue(out, normalizeProductCategory(category, 'Uncategorized'), value);
            });
            return out;
        }
        function normalizeEnabledCategoryMap(map) {
            const out = {};
            Object.entries(map && typeof map === 'object' ? map : {}).forEach(([category, subs]) => {
                const cat = normalizeProductCategory(category, 'Uncategorized');
                if (!out[cat]) out[cat] = {};
                Object.entries(subs && typeof subs === 'object' ? subs : {}).forEach(([subcategory, enabled]) => {
                    out[cat][normalizeProductSubcategory(subcategory)] = enabled;
                });
            });
            return out;
        }
        function normalizeSubcatProfitMap(map) {
            const out = {};
            Object.entries(map && typeof map === 'object' ? map : {}).forEach(([category, subMap]) => {
                const cat = normalizeProductCategory(category, 'Uncategorized');
                if (!out[cat]) out[cat] = {};
                Object.entries(subMap && typeof subMap === 'object' ? subMap : {}).forEach(([subcategory, value]) => {
                    out[cat][normalizeProductSubcategory(subcategory)] = value;
                });
            });
            return out;
        }
        function normalizeUnitLabel(unit) {
            const raw = String(unit || '').trim();
            if (!raw || raw === '个') return 'pcs';
            if (raw.toLowerCase() === 'pc' || raw.toLowerCase() === 'piece' || raw.toLowerCase() === 'pieces') return 'pcs';
            if (raw === '套' || raw.toLowerCase() === 'set') return 'set';
            return raw;
        }
        function normalizeMarketUnit(unit) {
            return normalizeUnitLabel(unit);
        }
        function normalizePricingUnit(unit) {
            const raw = String(unit || '').trim();
            const normalized = normalizeUnitLabel(raw);
            const lower = String(normalized || '').trim().toLowerCase();
            if (lower === 'w') return 'W';
            if (lower === 'kw') return 'kW';
            if (lower === 'kwh') return 'kWh';
            if (lower === 'pcs') return 'pcs';
            if (lower === 'set') return 'set';
            return normalized || 'pcs';
        }
        function inferProductPricingUnit(product) {
            const p = product || {};
            const explicit = String(p.priceBasisUnit || p.pricingUnit || p.costUnit || '').trim();
            if (explicit) return normalizePricingUnit(explicit);
            const categoryUnit = getMarketCategoryUnitMeta(p.category || '').unit || '';
            return normalizePricingUnit(categoryUnit || 'pcs');
        }
        function inferProductUnitQtyPerPcs(product, inventoryItem, unit) {
            const p = product || {};
            const u = normalizePricingUnit(unit || inferProductPricingUnit(p));
            const explicitQty = parseFloat(p.unitQtyPerPcs);
            if (Number.isFinite(explicitQty) && explicitQty > 0) return explicitQty;
            if (inventoryItem) {
                const invQty = parseFloat(inventoryItem.spec);
                if (Number.isFinite(invQty) && invQty > 0) return invQty;
            }
            if (u === 'pcs' || u === 'set') return 1;
            const text = String((p.spec || '') + ' ' + (p.name || ''));
            const unitPattern = u.replace(/[^A-Za-z]/g, '');
            const match = text.match(new RegExp('(\\d+(?:\\.\\d+)?)\\s*' + unitPattern + '\\b', 'i'));
            const parsed = match ? parseFloat(match[1]) : NaN;
            if (Number.isFinite(parsed) && parsed > 0) return parsed;
            const numericSpec = parseFloat(p.spec);
            return Number.isFinite(numericSpec) && numericSpec > 0 ? numericSpec : 1;
        }
        function getProductPricingMeta(product, inventoryItem) {
            const p = product || {};
            const unit = inferProductPricingUnit(p);
            const explicitQty = parseFloat(p.unitQtyPerPcs);
            let qty = inferProductUnitQtyPerPcs(p, inventoryItem, unit);
            const rounded = Math.round(qty * 1000000) / 1000000;
            const qtyLabel = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/0+$/, '').replace(/\.$/, '');
            const hasExplicit = !!String(p.priceBasisUnit || p.pricingUnit || p.costUnit || '').trim() || (Number.isFinite(explicitQty) && explicitQty > 0);
            return {
                priceBasisUnit: unit,
                unitQtyPerPcs: rounded,
                source: hasExplicit ? 'explicit' : 'inferred',
                label: qtyLabel + ' ' + unit + '/pcs'
            };
        }
        function isHybridStorageCategory(category) {
            const cat = normalizeProductCategory(category);
            return cat === 'All-in-One System' || cat === 'C&I Storage';
        }
        function formatCapacityValue(value) {
            const n = parseFloat(value);
            if (!Number.isFinite(n) || n <= 0) return '';
            const rounded = Math.round(n * 10000) / 10000;
            return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/0+$/, '').replace(/\.$/, '');
        }
        function parseHybridStorageSpec(productOrSpec) {
            const p = productOrSpec && typeof productOrSpec === 'object' ? productOrSpec : {};
            const text = String(typeof productOrSpec === 'string' ? productOrSpec : `${p.inverterKw || ''}kW ${p.batteryKwh || ''}kWh ${p.spec || ''} ${p.name || ''}`);
            const invDirect = parseFloat(p.inverterKw);
            const batDirect = parseFloat(p.batteryKwh);
            const invMatch = text.match(/(\d+(?:\.\d+)?)\s*kW(?!h)/i);
            const batMatch = text.match(/(\d+(?:\.\d+)?)\s*kWh\b/i);
            return {
                inverterKw: Number.isFinite(invDirect) && invDirect > 0 ? invDirect : (invMatch ? parseFloat(invMatch[1]) : 0),
                batteryKwh: Number.isFinite(batDirect) && batDirect > 0 ? batDirect : (batMatch ? parseFloat(batMatch[1]) : 0)
            };
        }
        function formatHybridStorageSpec(input) {
            const parsed = parseHybridStorageSpec(input);
            const inv = formatCapacityValue(parsed.inverterKw);
            const bat = formatCapacityValue(parsed.batteryKwh);
            if (inv && bat) return inv + ' kW / ' + bat + ' kWh';
            if (inv) return inv + ' kW';
            if (bat) return bat + ' kWh';
            return '';
        }
        function getProductDisplaySpec(product) {
            const p = product || {};
            if (isHybridStorageCategory(p.category)) {
                return formatHybridStorageSpec(p) || String(p.spec || '').trim();
            }
            return String(p.spec || '').trim();
        }
        function normalizeMarketPrices(data) {
            const raw = data && typeof data === 'object' ? data : {};
            const unitSource = raw.categoryUnits && typeof raw.categoryUnits === 'object' ? raw.categoryUnits : {};
            const categoryUnits = {};
            const deletedRecordIds = Array.from(new Set((Array.isArray(raw.deletedRecordIds) ? raw.deletedRecordIds : [])
                .map(id => String(id || '').trim())
                .filter(Boolean)));
            const deleted = new Set(deletedRecordIds);
            Object.entries(unitSource).forEach(([category, meta]) => {
                const cat = normalizeProductCategory(category);
                if (!cat) return;
                const m = meta && typeof meta === 'object' ? meta : {};
                const unit = normalizeMarketUnit(m.unit || '');
                if (!unit) return;
                categoryUnits[cat] = {
                    unit,
                    source: m.source === 'manual' ? 'manual' : 'auto',
                    updatedAt: Number.isFinite(parseFloat(m.updatedAt)) ? parseFloat(m.updatedAt) : Date.now()
                };
            });
            const records = (Array.isArray(raw.records) ? raw.records : []).map((record, index) => {
                const r = record && typeof record === 'object' ? record : {};
                const category = normalizeProductCategory(r.category);
                const id = String(r.id || `mp_${r.ts || Date.now()}_${index}`).trim();
                const unit = normalizeMarketUnit(r.unit || categoryUnits[category]?.unit || '');
                const currency = String(r.currency || 'CNY').toUpperCase() === 'MYR' ? 'MYR' : 'CNY';
                const price = Number.isFinite(parseFloat(r.price)) ? parseFloat(r.price) : 0;
                const rate = Number.isFinite(parseFloat(r.rateCnyPerMyr)) ? parseFloat(r.rateCnyPerMyr) : 1.53;
                const priceCnyRaw = Number.isFinite(parseFloat(r.priceCny)) ? parseFloat(r.priceCny) : (currency === 'MYR' ? price * rate : price);
                const ts = Number.isFinite(parseFloat(r.ts)) ? parseFloat(r.ts) : (r.quotedAt ? Date.parse(r.quotedAt) : Date.now());
                const quotedAt = String(r.quotedAt || '').trim() || new Date(ts || Date.now()).toISOString().slice(0, 10);
                if (deleted.has(id) || !category || !unit || price <= 0 || priceCnyRaw <= 0) return null;
                return {
                    id,
                    category,
                    unit,
                    price,
                    currency,
                    rateCnyPerMyr: rate > 0 ? rate : 1.53,
                    priceCny: priceCnyRaw,
                    quotedAt,
                    ts: ts || Date.now(),
                    note: String(r.note || '').trim()
                };
            }).filter(Boolean).sort((a, b) => (a.ts || 0) - (b.ts || 0));
            return { records, categoryUnits, deletedRecordIds };
        }
        function normalizeProductUnitFields() {
            if (Array.isArray(products)) {
                products = products.map(p => {
                    if (!p || typeof p !== 'object') return p;
                    const next = {
                        ...p,
                        category: normalizeProductCategory(p.category, 'Uncategorized'),
                        scenario: normalizeProductSubcategory(p.scenario)
                    };
                    if (String(next.spec || '').trim() === '个') next.spec = 'pcs';
                    if (String(next.priceBasisUnit || next.pricingUnit || next.costUnit || '').trim()) {
                        next.priceBasisUnit = normalizePricingUnit(next.priceBasisUnit || next.pricingUnit || next.costUnit);
                    }
                    if (next.unitQtyPerPcs != null) {
                        const qty = parseFloat(next.unitQtyPerPcs);
                        if (Number.isFinite(qty) && qty > 0) next.unitQtyPerPcs = qty;
                        else delete next.unitQtyPerPcs;
                    }
                    if (isHybridStorageCategory(next.category)) {
                        const hybridSpec = parseHybridStorageSpec(next);
                        if (hybridSpec.inverterKw > 0) next.inverterKw = hybridSpec.inverterKw;
                        if (hybridSpec.batteryKwh > 0) next.batteryKwh = hybridSpec.batteryKwh;
                        const formattedSpec = formatHybridStorageSpec(next);
                        if (formattedSpec) next.spec = formattedSpec;
                    }
                    return next;
                });
            }
            if (marketPrices?.categoryUnits?.Accessory?.unit === '个') {
                marketPrices.categoryUnits.Accessory = { ...marketPrices.categoryUnits.Accessory, unit: 'pcs' };
            }
        }
        function getMarketCategoryUnitMeta(category) {
            const cat = normalizeProductCategory(category);
            marketPrices = normalizeMarketPrices(marketPrices);
            if (!cat) return { unit: 'pcs', source: 'auto', updatedAt: Date.now() };
            const existing = marketPrices.categoryUnits?.[cat];
            if (existing?.unit) return { ...existing, unit: normalizeMarketUnit(existing.unit) };
            const unit = inferMarketUnitForCategory(cat);
            marketPrices.categoryUnits[cat] = { unit, source: 'auto', updatedAt: Date.now() };
            return marketPrices.categoryUnits[cat];
        }
        function inferMarketUnitForCategory(category) {
            const cat = normalizeProductCategory(category);
            const categoryProducts = products.filter(p => normalizeProductCategory(p.category) === cat);
            const categoryInventory = inventory.filter(item => {
                const product = products.find(p => p.id === item.productId);
                return normalizeProductCategory(product?.category) === cat;
            });
            const sample = [...categoryInventory.map(i => String(i.spec || '')), ...categoryProducts.map(p => String(p.spec || ''))].join(' ').toLowerCase();
            if (cat === 'All-in-One System') return 'set';
            if (cat === 'Accessory') return 'pcs';
            if (cat === 'C&I Storage') return /\bkwh\b/i.test(sample) ? 'kWh' : 'kW';
            if (cat === 'PV Module' || /\b\d{3,4}\s*w\b/i.test(sample)) return 'W';
            if (cat === 'Inverter' || /\bkw\b/i.test(sample)) {
                return 'kW';
            }
            if (cat === 'Battery' || /\bkwh\b/i.test(sample)) return 'kWh';
            return 'pcs';
        }
        function upsertMarketCategoryUnit(category, unit) {
            const cat = normalizeProductCategory(category);
            const u = normalizeMarketUnit(unit || '');
            if (!cat || !u) return;
            marketPrices = normalizeMarketPrices(marketPrices);
            marketPrices.categoryUnits[cat] = { unit: u, source: 'manual', updatedAt: Date.now() };
        }
        function addMarketPriceRecord(input) {
            const raw = input && typeof input === 'object' ? input : {};
            const category = normalizeProductCategory(raw.category);
            const unit = normalizeMarketUnit(raw.unit || getMarketCategoryUnitMeta(category).unit || '');
            const currency = String(raw.currency || 'CNY').toUpperCase() === 'MYR' ? 'MYR' : 'CNY';
            const price = Number.isFinite(parseFloat(raw.price)) ? parseFloat(raw.price) : 0;
            const rate = Number.isFinite(parseFloat(raw.rateCnyPerMyr)) ? parseFloat(raw.rateCnyPerMyr) : 1.53;
            const quotedAt = String(raw.quotedAt || '').trim() || new Date().toISOString().slice(0, 10);
            const ts = Date.parse(quotedAt) || Date.now();
            if (!category) throw new Error('Please select a category');
            if (!unit) throw new Error('Please select a unit');
            if (price <= 0) throw new Error('Please enter a valid market price');
            marketPrices = normalizeMarketPrices(marketPrices);
            upsertMarketCategoryUnit(category, unit);
            marketPrices.records.push({
                id: `mp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                category,
                unit,
                price,
                currency,
                rateCnyPerMyr: rate > 0 ? rate : 1.53,
                priceCny: currency === 'MYR' ? price * (rate > 0 ? rate : 1.53) : price,
                quotedAt,
                ts,
                note: String(raw.note || '').trim()
            });
            marketPrices = normalizeMarketPrices(marketPrices);
        }
        function updateMarketPriceRecord(id, input) {
            const recordId = String(id || '').trim();
            if (!recordId) throw new Error('Missing market price record id');
            const raw = input && typeof input === 'object' ? input : {};
            marketPrices = normalizeMarketPrices(marketPrices);
            const idx = marketPrices.records.findIndex(r => String(r.id) === recordId);
            if (idx === -1) throw new Error('Market price record not found');
            const prev = marketPrices.records[idx];
            const category = String(raw.category || prev.category || '').trim();
            const unit = normalizeMarketUnit(raw.unit || prev.unit || getMarketCategoryUnitMeta(category).unit || '');
            const currency = String(raw.currency || prev.currency || 'CNY').toUpperCase() === 'MYR' ? 'MYR' : 'CNY';
            const price = Number.isFinite(parseFloat(raw.price)) ? parseFloat(raw.price) : 0;
            const rate = Number.isFinite(parseFloat(raw.rateCnyPerMyr)) ? parseFloat(raw.rateCnyPerMyr) : getSalesOutRateCnyPerMyr();
            const quotedAt = String(raw.quotedAt || prev.quotedAt || '').trim() || new Date().toISOString().slice(0, 10);
            const ts = Date.parse(quotedAt) || prev.ts || Date.now();
            if (!category) throw new Error('SelectCategory');
            if (!unit) throw new Error('SelectUnit');
            if (price <= 0) throw new Error('请输入有效市场价');
            upsertMarketCategoryUnit(category, unit);
            marketPrices.records[idx] = {
                ...prev,
                category,
                unit,
                price,
                currency,
                rateCnyPerMyr: rate > 0 ? rate : 1.53,
                priceCny: currency === 'MYR' ? price * (rate > 0 ? rate : 1.53) : price,
                quotedAt,
                ts,
                note: String(raw.note || '').trim()
            };
            marketPrices = normalizeMarketPrices(marketPrices);
        }
        function deleteMarketPriceRecord(id) {
            const recordId = String(id || '').trim();
            if (!recordId) return;
            marketPrices = normalizeMarketPrices(marketPrices);
            marketPrices.records = marketPrices.records.filter(r => String(r.id) !== recordId);
            marketPrices.deletedRecordIds = Array.from(new Set([...(marketPrices.deletedRecordIds || []), recordId]));
        }
        function getMarketPriceSummary(category, options = {}) {
            const cat = String(category || '').trim();
            const days = Number.isFinite(parseFloat(options.days)) ? parseFloat(options.days) : 30;
            marketPrices = normalizeMarketPrices(marketPrices);
            const unit = getMarketCategoryUnitMeta(cat).unit;
            const all = marketPrices.records
                .filter(r => String(r.category || '').trim() === cat)
                .sort((a, b) => (a.ts || 0) - (b.ts || 0));
            const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
            const recent = all.filter(r => (r.ts || Date.parse(r.quotedAt) || 0) >= cutoff);
            const base = recent.length ? recent : [];
            const avgCny = base.length ? base.reduce((sum, r) => sum + (parseFloat(r.priceCny) || 0), 0) / base.length : 0;
            const latest = all[all.length - 1] || null;
            const firstRecent = recent[0] || null;
            const latestRecent = recent[recent.length - 1] || null;
            const trendCny = firstRecent && latestRecent ? (latestRecent.priceCny || 0) - (firstRecent.priceCny || 0) : 0;
            const trendPct = firstRecent && firstRecent.priceCny ? (trendCny / firstRecent.priceCny) * 100 : 0;
            return { category: cat, unit, days, records: recent, allRecords: all, avgCny, latest, latestRecent, trendCny, trendPct };
        }
        function getMarketTrendRecords(category, range = 'day') {
            const cat = String(category || '').trim();
            const mode = ['day', 'month', 'year'].includes(String(range || '').toLowerCase()) ? String(range).toLowerCase() : 'day';
            const days = mode === 'year' ? 365 * 5 : mode === 'month' ? 365 : 30;
            const summary = getMarketPriceSummary(cat, { days });
            return { ...summary, range: mode, records: summary.records, days };
        }
        function formatMarketPrice(valueCny, unit, currency = 'CNY') {
            const n = Number.isFinite(parseFloat(valueCny)) ? parseFloat(valueCny) : 0;
            const u = normalizeUnitLabel(unit || '');
            if (String(currency || '').toUpperCase() === 'MYR') {
                const rate = typeof getSalesOutRateCnyPerMyr === 'function' ? getSalesOutRateCnyPerMyr() : 1.53;
                return `RM ${(n / rate).toFixed(4)}/${u}`;
            }
            return `¥${n.toFixed(4)}/${u}`;
        }
        function normalizeSupplierCode(raw) {
            return String(raw || '').trim().toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9_-]/g, '');
        }
        function hashStringToNumber(raw) {
            let h = 0;
            const s = String(raw || '');
            for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
            return Math.abs(h);
        }
        function getSupplierDisplayName(supplier) {
            if (!supplier || typeof supplier !== 'object') return '';
            const s = supplier && typeof supplier === 'object' ? supplier : {};
            const zh = String(s.nameZh || s.nameCn || '').trim();
            const en = String(s.nameEn || s.name || '').trim();
            if (zh && en && zh !== en) return `${zh} / ${en}`;
            return zh || en || String(s.code || '').trim() || '未命名Supplier';
        }
        function getSupplierDisplayNameForLang(supplier, lang = currentLang) {
            if (!supplier || typeof supplier !== 'object') return '';
            const s = supplier && typeof supplier === 'object' ? supplier : {};
            const zh = String(s.nameZh || s.nameCn || '').trim();
            const en = String(s.nameEn || s.name || '').trim();
            const code = String(s.code || '').trim();
            return lang === 'en'
                ? (en || zh || code || 'Unnamed Supplier')
                : (zh || en || code || '未命名Supplier');
        }
        function getSupplierLogo(supplier) {
            const s = supplier && typeof supplier === 'object' ? supplier : {};
            return String(s.logoDataUrl || s.brandLogo || s.logo || '').trim();
        }
        const SUPPLIER_STAGES = [
            { key: 'info', label: 'Info Pool', shortLabel: 'Info', desc: 'Info / Basic Quote' },
            { key: 'research', label: 'Field Review', shortLabel: 'Review', desc: 'Visit / Accurate Quote' },
            { key: 'trial', label: 'Trial Partner', shortLabel: 'Trial', desc: 'At least 1 order' },
            { key: 'core', label: 'Strategic Core', shortLabel: 'Core', desc: 'Long-term / Credit Term' }
        ];
        const SUPPLIER_SCORE_FIELDS = [
            { key: 'quality', label: 'Product Quality', weight: 18 },
            { key: 'price', label: 'Price Advantage', weight: 14 },
            { key: 'technical', label: 'Technical R&D', weight: 12 },
            { key: 'willingness', label: 'Cooperation Willingness', weight: 12 },
            { key: 'capacity', label: 'Production Capacity', weight: 10 },
            { key: 'afterSales', label: 'After-Sales Support', weight: 10 },
            { key: 'coverage', label: 'Type Coverage', weight: 9 },
            { key: 'export', label: 'Export Experience', weight: 8 },
            { key: 'scale', label: 'Company Scale', weight: 7 }
        ];
        const SUPPLIER_STAGE_CLASS = {
            info: 'bg-slate-100 text-slate-600 border-slate-200',
            research: 'bg-blue-50 text-blue-700 border-blue-100',
            trial: 'bg-amber-50 text-amber-700 border-amber-100',
            core: 'bg-purple-50 text-purple-700 border-purple-100'
        };
        function normalizeSupplierStage(stage) {
            const raw = String(stage || '').trim();
            const mapped = {
                info: 'info',
                research: 'research',
                trial: 'trial',
                core: 'core',
                '资料级': 'info',
                '资料储备级': 'info',
                '调研级': 'research',
                '实地调研级': 'research',
                '初步合作级': 'trial',
                '试单合作级': 'trial',
                '核心Supplier级': 'core',
                '战略核心级': 'core'
            };
            return mapped[raw] || 'info';
        }
        function getSupplierStageDef(stage) {
            return SUPPLIER_STAGES.find(s => s.key === normalizeSupplierStage(stage)) || SUPPLIER_STAGES[0];
        }
        function supplierStageIndex(stage) {
            const key = normalizeSupplierStage(stage);
            return Math.max(0, SUPPLIER_STAGES.findIndex(s => s.key === key));
        }
        function supplierStageByIndex(index) {
            return SUPPLIER_STAGES[Math.min(Math.max(parseInt(index, 10) || 0, 0), SUPPLIER_STAGES.length - 1)]?.key || 'info';
        }
        function normalizeSupplierScore(value) {
            const n = parseFloat(value);
            if (!Number.isFinite(n)) return 0;
            return Math.min(Math.max(n, 0), 10);
        }
        function normalizeSupplierScores(raw) {
            const base = raw && typeof raw === 'object' ? raw : {};
            return SUPPLIER_SCORE_FIELDS.reduce((acc, field) => {
                acc[field.key] = normalizeSupplierScore(base[field.key]);
                return acc;
            }, {});
        }
        function normalizeSupplierEvidence(raw) {
            const base = raw && typeof raw === 'object' ? raw : {};
            const orderCount = Math.max(0, parseInt(base.orderCount ?? base.orders ?? 0, 10) || 0);
            const creditTermDays = Math.max(0, parseInt(base.creditTermDays ?? base.creditDays ?? 0, 10) || 0);
            return {
                factoryVisited: !!base.factoryVisited,
                accurateQuote: !!base.accurateQuote,
                firstOrderDone: !!base.firstOrderDone || orderCount > 0,
                longTermCooperation: !!base.longTermCooperation,
                preferredPrice: !!base.preferredPrice,
                creditTermDays,
                orderCount
            };
        }
        function calculateSupplierTotalScore(scores) {
            const normalized = normalizeSupplierScores(scores);
            const total = SUPPLIER_SCORE_FIELDS.reduce((sum, field) => sum + (normalized[field.key] / 10 * field.weight), 0);
            return Math.round(total * 10) / 10;
        }
        function getSupplierScoreStage(totalScore) {
            const score = Number.isFinite(parseFloat(totalScore)) ? parseFloat(totalScore) : 0;
            if (score >= 85) return 'core';
            if (score >= 70) return 'trial';
            if (score >= 50) return 'research';
            return 'info';
        }
        function getSupplierEvidenceMaxStage(evidence) {
            const e = normalizeSupplierEvidence(evidence);
            const hasResearch = e.factoryVisited && e.accurateQuote;
            const hasTrial = hasResearch && (e.firstOrderDone || e.orderCount > 0);
            const hasCore = hasTrial && e.longTermCooperation && e.preferredPrice && e.creditTermDays > 0;
            if (hasCore) return 'core';
            if (hasTrial) return 'trial';
            if (hasResearch) return 'research';
            return 'info';
        }
        function minSupplierStage(stageA, stageB) {
            return supplierStageByIndex(Math.min(supplierStageIndex(stageA), supplierStageIndex(stageB)));
        }
        function capSupplierStage(stage, evidence) {
            return minSupplierStage(normalizeSupplierStage(stage), getSupplierEvidenceMaxStage(evidence));
        }
        function getSupplierSuggestedStage(scores, evidence) {
            return minSupplierStage(getSupplierScoreStage(calculateSupplierTotalScore(scores)), getSupplierEvidenceMaxStage(evidence));
        }
        function normalizeSupplierEvaluation(input) {
            const base = input && typeof input === 'object' ? input : {};
            const scores = normalizeSupplierScores(base.scores || base);
            const evidence = normalizeSupplierEvidence(base.evidence || base);
            const totalScore = calculateSupplierTotalScore(scores);
            return {
                scores,
                evidence,
                totalScore,
                suggestedStage: getSupplierSuggestedStage(scores, evidence),
                lastReviewedAt: String(base.lastReviewedAt || '').trim()
            };
        }
        function getSupplierMissingEvidenceForStage(stage, evidence) {
            const target = supplierStageIndex(stage);
            const e = normalizeSupplierEvidence(evidence);
            const missing = [];
            if (target >= supplierStageIndex('research')) {
                if (!e.factoryVisited) missing.push('Factory visit');
                if (!e.accurateQuote) missing.push('Accurate quote');
            }
            if (target >= supplierStageIndex('trial') && !(e.firstOrderDone || e.orderCount > 0)) missing.push('At least 1 order');
            if (target >= supplierStageIndex('core')) {
                if (!e.longTermCooperation) missing.push('Long-term cooperation');
                if (!e.preferredPrice) missing.push('Preferred pricing');
                if (!(e.creditTermDays > 0)) missing.push('Credit term days');
            }
            return missing;
        }
        function getSupplierWeakness(scores) {
            const normalized = normalizeSupplierScores(scores);
            const sorted = SUPPLIER_SCORE_FIELDS
                .map(field => ({ ...field, value: normalized[field.key] }))
                .sort((a, b) => (a.value - b.value) || (b.weight - a.weight));
            const worst = sorted[0];
            return worst ? `${worst.label} ${worst.value.toFixed(1)}` : '-';
        }
        function supplierStageBadgeHtml(stage) {
            const def = getSupplierStageDef(stage);
            const cls = SUPPLIER_STAGE_CLASS[def.key] || SUPPLIER_STAGE_CLASS.info;
            return `<span class="inline-flex items-center px-2.5 py-1 rounded-full border text-[10px] font-black whitespace-nowrap ${cls}">${htmlSafe(def.label)}</span>`;
        }
        function normalizeSupplierRecord(input, idx = 0) {
            const base = input && typeof input === 'object' ? input : {};
            const nameZh = String(base.nameZh || base.nameCn || base.zhName || base.vendor || base.name || '').trim();
            const nameEn = String(base.nameEn || base.enName || '').trim();
            const seed = nameZh || nameEn || base.code || `SUP${idx + 1}`;
            const asciiSeed = normalizeSupplierCode(seed).replace(/[^A-Z0-9]/g, '').slice(0, 10);
            const fallback = asciiSeed || `SUP${String(hashStringToNumber(seed) % 10000).padStart(4, '0')}`;
            const code = normalizeSupplierCode(base.code || fallback) || fallback;
            const evaluation = normalizeSupplierEvaluation(base.evaluation || {});
            const stage = capSupplierStage(base.stage || base.level || evaluation.suggestedStage || 'info', evaluation.evidence);
            const finalEvaluation = {
                ...evaluation,
                suggestedStage: getSupplierSuggestedStage(evaluation.scores, evaluation.evidence),
                totalScore: calculateSupplierTotalScore(evaluation.scores)
            };
            return {
                id: String(base.id || `supplier_${code}`),
                code,
                nameZh,
                nameEn,
                stage,
                evaluation: finalEvaluation,
                logoDataUrl: getSupplierLogo(base),
                country: String(base.country || base.region || '').trim(),
                contact: String(base.contact || '').trim(),
                contactInfo: String(base.contactInfo || base.phoneEmail || '').trim(),
                website: String(base.website || '').trim(),
                address: String(base.address || '').trim(),
                notes: String(base.notes || '').trim(),
                ts: parseInt(base.ts, 10) || Date.now()
            };
        }
        function getSupplierByCode(code) {
            const c = normalizeSupplierCode(code);
            return (Array.isArray(suppliers) ? suppliers : []).find(s => normalizeSupplierCode(s?.code) === c) || null;
        }
        function findSupplierByDisplayName(name) {
            const n = String(name || '').trim();
            if (!n) return null;
            return (Array.isArray(suppliers) ? suppliers : []).find(s => {
                const label = getSupplierDisplayName(s);
                return label === n || String(s?.nameZh || '').trim() === n || String(s?.nameEn || '').trim() === n || String(s?.code || '').trim() === n;
            }) || null;
        }
        function makeUniqueSupplierCode(seed, ignoreCode = '') {
            const normalizedSeed = normalizeSupplierCode(seed).replace(/[^A-Z0-9]/g, '').slice(0, 10);
            const fallback = `SUP${String(hashStringToNumber(seed || Date.now()) % 10000).padStart(4, '0')}`;
            const base = normalizedSeed || fallback;
            const used = new Set((Array.isArray(suppliers) ? suppliers : [])
                .map(s => normalizeSupplierCode(s?.code))
                .filter(c => c && c !== normalizeSupplierCode(ignoreCode)));
            let code = base;
            let i = 1;
            while (used.has(code)) code = `${base}${String(i++).padStart(2, '0')}`;
            return code;
        }
        function ensureSupplierForVendorName(vendorName) {
            const name = String(vendorName || '').trim();
            if (!name) return null;
            let found = findSupplierByDisplayName(name);
            if (found) return found;
            const code = makeUniqueSupplierCode(name);
            found = normalizeSupplierRecord({ code, nameZh: name, ts: Date.now() }, suppliers.length);
            suppliers.push(found);
            return found;
        }
        function ensureSupplierData() {
            const normalized = [];
            const usedCodes = new Set();
            (Array.isArray(suppliers) ? suppliers : []).forEach((raw, idx) => {
                let s = normalizeSupplierRecord(raw, idx);
                if (!s.code) s.code = makeUniqueSupplierCode(s.nameZh || s.nameEn || `SUP${idx + 1}`);
                if (usedCodes.has(s.code)) {
                    const base = s.code || 'SUP';
                    let seq = 1;
                    while (usedCodes.has(`${base}${String(seq).padStart(2, '0')}`)) seq++;
                    s.code = `${base}${String(seq).padStart(2, '0')}`;
                }
                usedCodes.add(s.code);
                normalized.push(s);
            });
            suppliers = normalized;
            (Array.isArray(products) ? products : []).forEach(p => {
                if (!p || typeof p !== 'object') return;
                let supplier = getSupplierByCode(p.supplierCode);
                if (!supplier) supplier = ensureSupplierForVendorName(p.vendor || p.supplier || '');
                if (supplier) {
                    p.supplierCode = supplier.code;
                    p.vendor = getSupplierDisplayName(supplier);
                }
                if (p.productImageDataUrl === undefined && p.imageDataUrl) p.productImageDataUrl = p.imageDataUrl;
            });
            suppliers.sort((a, b) => String(a.code || '').localeCompare(String(b.code || '')));
        }
        function getProductSupplier(product) {
            const p = product && typeof product === 'object' ? product : {};
            return getSupplierByCode(p.supplierCode) || findSupplierByDisplayName(p.vendor) || null;
        }
        function getProductSupplierDisplay(product) {
            return getSupplierDisplayName(getProductSupplier(product)) || String(product?.vendor || '').trim() || '-';
        }
        function normalizeProductPriceCurrency(value) {
            return String(value || '').trim().toUpperCase() === 'MYR' ? 'MYR' : 'CNY';
        }
        function inferSupplierPriceCurrency(supplier) {
            const text = [
                supplier?.country,
                supplier?.region,
                supplier?.address,
                supplier?.notes
            ].map(v => String(v || '').trim().toLowerCase()).filter(Boolean).join(' ');
            if (/(malaysia|malaysian|\bmy\b|马来西亚|馬來西亞)/i.test(text)) return 'MYR';
            if (/(china|chinese|\bcn\b|中国|中國|mainland)/i.test(text)) return 'CNY';
            return 'CNY';
        }
        function getProductCurrency(product, field = 'cost') {
            const p = product && typeof product === 'object' ? product : {};
            const direct = field === 'price' ? p.priceCurrency : p.costCurrency;
            if (direct) return normalizeProductPriceCurrency(direct);
            if (p.currency) return normalizeProductPriceCurrency(p.currency);
            return inferSupplierPriceCurrency(getProductSupplier(p));
        }
        function productAmountToCny(value, currency) {
            const n = Number.isFinite(parseFloat(value)) ? parseFloat(value) : 0;
            return normalizeProductPriceCurrency(currency) === 'MYR' ? n * getSalesOutRateCnyPerMyr() : n;
        }
        function getProductCostCny(product) {
            return productAmountToCny(product?.cost, getProductCurrency(product, 'cost'));
        }
        function getProductPriceCny(product) {
            return productAmountToCny(product?.price, getProductCurrency(product, 'price'));
        }
        function getProductCurrencySymbol(currency) {
            return normalizeProductPriceCurrency(currency) === 'MYR' ? 'RM' : '¥';
        }
        function formatProductBaseAmount(product, field = 'cost', digits = 2) {
            const p = product && typeof product === 'object' ? product : {};
            const currency = getProductCurrency(p, field);
            const amount = Number.isFinite(parseFloat(p[field])) ? parseFloat(p[field]) : 0;
            return `${getProductCurrencySymbol(currency)} ${amount.toFixed(digits)}`;
        }
        function updateProductPriceUnitNote() {
            const note = document.getElementById('m-price-unit-note');
            if (!note) return;
            const category = document.getElementById('m-category')?.value || '';
            const spec = document.getElementById('m-spec')?.value || '';
            const unitEl = document.getElementById('m-price-basis-unit');
            const qtyEl = document.getElementById('m-unit-qty-per-pcs');
            const draft = {
                category,
                spec,
                priceBasisUnit: unitEl?.value || '',
                unitQtyPerPcs: qtyEl?.value || ''
            };
            const meta = getProductPricingMeta(draft);
            note.textContent = `Base cost/price: /${meta.priceBasisUnit} · Quote price: ${meta.label}`;
        }
        function syncHybridSpecFromInputs() {
            const category = document.getElementById('m-category')?.value || '';
            if (!isHybridStorageCategory(category)) return;
            const inv = parseFloat(document.getElementById('m-inverter-kw')?.value);
            const bat = parseFloat(document.getElementById('m-battery-kwh')?.value);
            const specEl = document.getElementById('m-spec');
            if (specEl) specEl.value = formatHybridStorageSpec({ inverterKw: inv, batteryKwh: bat });
            updateProductPriceUnitNote();
        }
        function updateHybridSpecControls() {
            const category = document.getElementById('m-category')?.value || '';
            const isHybrid = isHybridStorageCategory(category);
            const container = document.getElementById('m-hybrid-spec-container');
            const specEl = document.getElementById('m-spec');
            const specLabel = document.getElementById('m-spec-label');
            if (container) container.classList.toggle('hidden', !isHybrid);
            if (specLabel) specLabel.textContent = isHybrid ? 'Specification (Auto)' : 'Specification';
            if (specEl) {
                specEl.readOnly = isHybrid;
                specEl.classList.toggle('bg-slate-50', isHybrid);
                if (isHybrid) {
                    const parsed = parseHybridStorageSpec(specEl.value);
                    const invEl = document.getElementById('m-inverter-kw');
                    const batEl = document.getElementById('m-battery-kwh');
                    if (invEl && !invEl.value && parsed.inverterKw) invEl.value = formatCapacityValue(parsed.inverterKw);
                    if (batEl && !batEl.value && parsed.batteryKwh) batEl.value = formatCapacityValue(parsed.batteryKwh);
                    syncHybridSpecFromInputs();
                }
            }
        }
        function updateProductPriceCurrencyUi() {
            const currency = normalizeProductPriceCurrency(document.getElementById('m-price-currency')?.value || 'CNY');
            const symbol = getProductCurrencySymbol(currency);
            const costLabel = document.getElementById('m-cost-currency-label');
            const priceLabel = document.getElementById('m-price-currency-label');
            if (costLabel) costLabel.textContent = symbol;
            if (priceLabel) priceLabel.textContent = symbol;
            updateProductPriceUnitNote();
        }
        function updateProductCurrencyFromSupplier(options = {}) {
            const currencyEl = document.getElementById('m-price-currency');
            if (!currencyEl) return;
            if (options.skipExisting && window.editId) return;
            const supplier = getSupplierByCode(document.getElementById('m-supplier-code')?.value || '');
            currencyEl.value = inferSupplierPriceCurrency(supplier);
            updateProductPriceCurrencyUi();
        }
        window.updateProductPriceUnitNote = updateProductPriceUnitNote;
        window.updateHybridSpecControls = updateHybridSpecControls;
        window.syncHybridSpecFromInputs = syncHybridSpecFromInputs;
        window.updateProductPriceCurrencyUi = updateProductPriceCurrencyUi;
        window.updateProductCurrencyFromSupplier = updateProductCurrencyFromSupplier;
        function getProductSupplierBrandForLang(product, lang = currentLang) {
            const supplier = getProductSupplier(product);
            return getSupplierDisplayNameForLang(supplier, lang) || String(product?.vendor || '').trim() || '-';
        }
        const CERTIFICATION_REQUIREMENT_LEVELS = ['Mandatory', 'Utility Preferred', 'International Finance Preferred', 'Optional'];
        const CERTIFICATION_SOURCE_CATEGORIES = ['PV_MODULE', 'INVERTER', 'BATTERY'];
        const ENGINEERING_CLASS_DEFINITIONS = {
            A1: { label: 'A1 - Grid-Tied PV Only', categories: ['PV_MODULE', 'INVERTER'], note: 'Grid-tied PV only; excludes BESS-specific records.' },
            A2: { label: 'A2 - Grid-Tied PV + Small Battery', categories: ['PV_MODULE', 'INVERTER', 'BATTERY'], note: 'Small backup / self-use battery on a grid-tied PV system.' },
            B: { label: 'B - Hybrid PV + BESS', categories: ['PV_MODULE', 'INVERTER', 'BATTERY'], note: 'Hybrid PV + BESS with peak shaving or grid-support participation.' },
            C: { label: 'C - Off-Grid Hybrid', categories: ['PV_MODULE', 'INVERTER', 'BATTERY'], note: 'Off-grid / grid-forming hybrid system; grid-only requirements are hidden.' },
            D: { label: 'D - Utility Scale Solar', categories: ['PV_MODULE', 'INVERTER'], note: 'Utility solar and MV/HV grid-code review.' },
            E: { label: 'E - Utility Scale BESS', categories: ['INVERTER', 'BATTERY'], note: 'Utility BESS, PCS, EMS, safety and statutory evidence.' }
        };
        const PRODUCT_CATEGORY_TO_CERT_SOURCE = {
            'PV Module': ['PV_MODULE'],
            Inverter: ['INVERTER'],
            Battery: ['BATTERY'],
            'All-in-One System': ['INVERTER', 'BATTERY'],
            'C&I Storage': ['INVERTER', 'BATTERY']
        };
        const CERTIFICATION_PRODUCT_CATEGORY_DEFAULTS = {
            PV_MODULE: ['PV Module', 'PV Junction Box', 'PV Cable / Connector', 'PV Mounting / Tracker', 'PV Packaging'],
            INVERTER: ['PV Inverter', 'Hybrid Inverter', 'BESS PCS', 'Grid Interface', 'EMS'],
            BATTERY: ['Battery Pack / System', 'BMS', 'EMS', 'BESS PCS', 'BESS System']
        };
        function uniqueCertList(list) {
            const seen = new Set();
            const out = [];
            (Array.isArray(list) ? list : []).forEach(v => {
                const text = String(v || '').trim();
                const key = text.toLowerCase();
                if (!text || seen.has(key)) return;
                seen.add(key);
                out.push(text);
            });
            return out;
        }
        function normalizeCertificationSourceCategory(value = '') {
            const raw = String(value || '').trim().toUpperCase().replace(/[\s/-]+/g, '_');
            if (raw.includes('PV')) return 'PV_MODULE';
            if (raw.includes('INV') || raw.includes('PCS')) return 'INVERTER';
            if (raw.includes('BESS') || raw.includes('BAT')) return 'BATTERY';
            return raw || 'PV_MODULE';
        }
        function normalizeCertificationRequirement(record = {}) {
            const id = String(record.id || record.recordId || '').trim();
            return {
                id,
                sourceCategory: normalizeCertificationSourceCategory(record.sourceCategory || record.categoryGroup || record.source_category),
                productCategory: String(record.productCategory || record.product_category || '').trim(),
                standard: String(record.standard || record.requirement || record.name || '').trim(),
                requirementLevel: CERTIFICATION_REQUIREMENT_LEVELS.includes(record.requirementLevel) ? record.requirementLevel : String(record.requirementLevel || record.level || '').trim(),
                applicabilityCondition: String(record.applicabilityCondition || record.applicability || '').trim(),
                evidenceType: String(record.evidenceType || '').trim(),
                projectApplicability: String(record.projectApplicability || '').trim(),
                sourceUrl: String(record.sourceUrl || record.officialUrl || '').trim(),
                remarks: String(record.remarks || '').trim(),
                seedVersion: String(record.seedVersion || '').trim()
            };
        }
        function normalizeCertificationRequirementsCatalog(records = []) {
            const byId = new Map();
            (Array.isArray(records) ? records : []).forEach(record => {
                const normalized = normalizeCertificationRequirement(record);
                if (!normalized.id || !normalized.standard) return;
                byId.set(normalized.id, normalized);
            });
            return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
        }
        function mergeCertificationRequirementsCatalog(baseRecords = [], incomingRecords = []) {
            const byId = new Map();
            normalizeCertificationRequirementsCatalog(baseRecords).forEach(record => byId.set(record.id, record));
            normalizeCertificationRequirementsCatalog(incomingRecords).forEach(record => byId.set(record.id, record));
            return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
        }
        function getCertificationRequirementById(id) {
            const key = String(id || '').trim();
            return certificationRequirementsCatalog.find(record => record.id === key) || null;
        }
        function productCertificationSourceCategories(product = {}) {
            const category = normalizeProductCategory(product.category || document.getElementById('m-category')?.value || '', '');
            return PRODUCT_CATEGORY_TO_CERT_SOURCE[category] || [];
        }
        function defaultCertificationRequirementIdsForProduct(product = {}) {
            const sources = new Set(productCertificationSourceCategories(product));
            if (!sources.size) return [];
            return certificationRequirementsCatalog
                .filter(record => sources.has(record.sourceCategory) && record.requirementLevel === 'Mandatory')
                .map(record => record.id);
        }
        function normalizeCertificationRequirements(value, product = {}) {
            const selectedIds = Array.isArray(product.certificationRequirementIds)
                ? product.certificationRequirementIds
                : Array.isArray(value?.recordIds)
                    ? value.recordIds
                    : Array.isArray(value?.requirementIds)
                        ? value.requirementIds
                        : [];
            const legacyStandards = value && typeof value === 'object'
                ? (Array.isArray(value.standards) ? value.standards : String(value.standards || value.text || '').split(/[\n;,]+/))
                : (typeof value === 'string' ? value.split(/[\n;,]+/) : []);
            const normalizedIds = uniqueCertList(selectedIds).filter(id => getCertificationRequirementById(id));
            return {
                recordIds: normalizedIds,
                standards: uniqueCertList(legacyStandards),
                source: String(value?.source || (normalizedIds.length ? 'record-catalog' : 'legacy')),
                updatedAt: String(value?.updatedAt || '')
            };
        }
        function certificationText(req) {
            const fromRecords = uniqueCertList((req?.recordIds || []).map(id => getCertificationRequirementById(id)?.standard || id));
            const legacy = uniqueCertList(req?.standards || []);
            return uniqueCertList([...fromRecords, ...legacy]).join('\n');
        }
        function getProductCertificationRequirements(product = {}) {
            return normalizeCertificationRequirements(product.certificationRequirements, product);
        }
        function productCertificationSelectedRecords(product = {}) {
            const req = getProductCertificationRequirements(product);
            return (req.recordIds || []).map(getCertificationRequirementById).filter(Boolean);
        }
        function productCertificationEvidenceFor(productId, requirementRecordId = '') {
            const pid = String(productId || '').trim();
            const rid = String(requirementRecordId || '').trim();
            return productCertificationEvidence.filter(record => record.productId === pid && (!rid || record.requirementRecordId === rid));
        }
        function normalizeProductCertificationEvidence(record = {}) {
            const productId = String(record.productId || '').trim();
            const requirementRecordId = String(record.requirementRecordId || record.recordId || '').trim();
            const id = String(record.id || (productId && requirementRecordId ? `${productId}:${requirementRecordId}` : '')).trim();
            return {
                id,
                productId,
                requirementRecordId,
                status: String(record.status || 'Pending Evidence').trim(),
                evidenceAvailable: record.evidenceAvailable === true || record.evidenceAvailable === 'Yes' || (Array.isArray(record.fileRefs) && record.fileRefs.length) ? 'Yes' : String(record.evidenceAvailable || 'No').trim(),
                certificateNo: String(record.certificateNo || '').trim(),
                reportNo: String(record.reportNo || '').trim(),
                issueDate: String(record.issueDate || '').trim(),
                expiryDate: String(record.expiryDate || '').trim(),
                verificationStatus: String(record.verificationStatus || 'Not Reviewed').trim(),
                fileRefs: Array.isArray(record.fileRefs) ? record.fileRefs.filter(Boolean) : [],
                remarks: String(record.remarks || '').trim(),
                updatedAt: String(record.updatedAt || '').trim()
            };
        }
        function normalizeProductCertificationEvidenceList(records = []) {
            const byId = new Map();
            (Array.isArray(records) ? records : []).forEach(record => {
                const normalized = normalizeProductCertificationEvidence(record);
                if (!normalized.id || !normalized.productId || !normalized.requirementRecordId) return;
                byId.set(normalized.id, normalized);
            });
            return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
        }
        function upsertProductCertificationEvidence(record = {}) {
            const normalized = normalizeProductCertificationEvidence({
                ...record,
                updatedAt: record.updatedAt || new Date().toISOString()
            });
            if (!normalized.id || !normalized.productId || !normalized.requirementRecordId) return null;
            const idx = productCertificationEvidence.findIndex(item => item.id === normalized.id);
            if (idx >= 0) productCertificationEvidence[idx] = normalized;
            else productCertificationEvidence.push(normalized);
            productCertificationEvidence = normalizeProductCertificationEvidenceList(productCertificationEvidence);
            saveToLocal();
            persistEntityToD1('product_certification_evidence', normalized.id, normalized);
            try { renderEngineeringWorkspace(); } catch (e) {}
            try { renderDb(); } catch (e) {}
            return normalized;
        }
        function evidenceHasFileOrAvailability(record = {}) {
            return record.evidenceAvailable === 'Yes' || (Array.isArray(record.fileRefs) && record.fileRefs.length > 0);
        }
        function productCertificationEvidenceSummary(product = {}) {
            const selectedRecords = productCertificationSelectedRecords(product);
            const evidence = productCertificationEvidenceFor(product.id || '');
            const availableIds = new Set(evidence.filter(evidenceHasFileOrAvailability).map(item => item.requirementRecordId));
            const missingMandatory = selectedRecords.filter(record => record.requirementLevel === 'Mandatory' && !availableIds.has(record.id));
            const uploadedRecords = selectedRecords.filter(record => availableIds.has(record.id)).length;
            const fileCount = evidence.reduce((sum, item) => sum + (Array.isArray(item.fileRefs) ? item.fileRefs.length : 0), 0);
            return {
                selectedRecords,
                evidence,
                availableIds,
                selectedCount: selectedRecords.length,
                uploadedRecords,
                fileCount,
                missingMandatory
            };
        }
        function selectedCertificationRequirementIdsFromUi() {
            return Array.from(document.querySelectorAll('#m-cert-record-picker input[data-cert-record]:checked'))
                .map(input => String(input.value || '').trim())
                .filter(Boolean);
        }
        function readProductCertificationRequirementsFromModal() {
            const recordIds = selectedCertificationRequirementIdsFromUi();
            const text = String(document.getElementById('m-cert-requirements')?.value || '').trim();
            return {
                recordIds,
                standards: uniqueCertList(text.split(/[\n;,]+/)).filter(standard => !recordIds.some(id => getCertificationRequirementById(id)?.standard === standard)),
                source: 'record-catalog',
                updatedAt: new Date().toISOString()
            };
        }
        function renderProductCertificationRecordPicker(product = {}, selectedIds = []) {
            const picker = document.getElementById('m-cert-record-picker');
            const summary = document.getElementById('m-cert-selected-summary');
            const textarea = document.getElementById('m-cert-requirements');
            if (!picker) return;
            const sourceSet = new Set(productCertificationSourceCategories(product));
            const selected = new Set(uniqueCertList(selectedIds));
            const rows = certificationRequirementsCatalog.filter(record => sourceSet.has(record.sourceCategory));
            picker.innerHTML = rows.map(record => {
                const checked = selected.has(record.id);
                const levelTone = record.requirementLevel === 'Mandatory' ? 'text-red-700 bg-red-50 border-red-100' : record.requirementLevel === 'Utility Preferred' ? 'text-amber-700 bg-amber-50 border-amber-100' : record.requirementLevel === 'International Finance Preferred' ? 'text-blue-700 bg-blue-50 border-blue-100' : 'text-slate-500 bg-slate-50 border-slate-100';
                return `
                    <label class="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 text-xs hover:border-purple-200">
                        <input type="checkbox" data-cert-record value="${htmlSafe(record.id)}" ${checked ? 'checked' : ''} onchange="onProductCertificationSelectionChange()" class="mt-0.5 h-4 w-4 accent-purple-700">
                        <span class="min-w-0 flex-1">
                            <span class="font-black text-slate-700">${htmlSafe(record.id)} · ${htmlSafe(record.standard)}</span>
                            <span class="mt-1 block text-[10px] text-slate-400 truncate" title="${htmlSafe(record.applicabilityCondition)}">${htmlSafe(record.applicabilityCondition || '-')}</span>
                        </span>
                        <span class="shrink-0 rounded-full border px-2 py-1 text-[10px] font-black ${levelTone}">${htmlSafe(record.requirementLevel || '-')}</span>
                    </label>
                `;
            }).join('') || '<div class="rounded-xl border border-dashed border-slate-200 p-4 text-xs text-slate-400">No certification records mapped to this category.</div>';
            const selectedRecords = Array.from(selected).map(getCertificationRequirementById).filter(Boolean);
            if (summary) summary.textContent = `${selectedRecords.length} selected / ${rows.length} available`;
            if (textarea) textarea.value = certificationText({ recordIds: Array.from(selected), standards: [] });
        }
        window.onProductCertificationSelectionChange = () => {
            const product = {
                category: document.getElementById('m-category')?.value || '',
                scenario: document.getElementById('m-scenario')?.value || '',
                name: document.getElementById('m-name')?.value || ''
            };
            renderProductCertificationRecordPicker(product, selectedCertificationRequirementIdsFromUi());
        };
        window.applyDefaultProductCertifications = () => {
            const product = {
                category: document.getElementById('m-category')?.value || '',
                scenario: document.getElementById('m-scenario')?.value || '',
                name: document.getElementById('m-name')?.value || ''
            };
            const ids = defaultCertificationRequirementIdsForProduct(product);
            renderProductCertificationRecordPicker(product, ids);
            const note = document.getElementById('m-cert-source-note');
            if (note) note.textContent = `${ids.length} mandatory records selected from the engineering certification catalog.`;
        };
        window.maybeFillProductCertificationDefaults = () => {
            if (selectedCertificationRequirementIdsFromUi().length) return;
            window.applyDefaultProductCertifications?.();
        };
        window.refreshCertificationDefaults = () => {
            window.applyDefaultProductCertifications?.();
        };
        function certificationLevelTone(level = '') {
            if (level === 'Mandatory') return 'bg-red-50 text-red-700 border-red-100';
            if (level === 'Utility Preferred') return 'bg-amber-50 text-amber-700 border-amber-100';
            if (level === 'International Finance Preferred') return 'bg-blue-50 text-blue-700 border-blue-100';
            return 'bg-slate-50 text-slate-500 border-slate-100';
        }
        const MINOVA_ENGINEERING_QUOTE_DEFAULTS_KEY = 'minova_engineering_quote_defaults_v1';
        const MINOVA_ENGINEERING_CLASS_STORAGE_KEY = 'minova_engineering_architecture_classes_v1';
        let engineeringWorkspaceView = 'certification';
        let engineeringWorkspaceMode = 'standard';
        let engineeringCertificationEditMode = false;
        let engineeringProductMasterMode = 'product';
        let engineeringStandardSelectedIds = new Set();
        let engineeringArchitectureClassSelectedIds = new Set();
        const ENGINEERING_PRODUCT_MASTER_DETAIL_GROUPS = {
            all: { label: 'All Product Master Details', master: ['model', 'brand', 'series', 'application', 'voltageClass', 'phase', 'status', 'countryAvailable'], technical: [], extra: ['certification', 'commercial', 'documents'] },
            basic: { label: 'Basic', master: ['model', 'brand', 'series', 'application', 'status', 'countryAvailable'], technical: [], extra: [] },
            electrical: { label: 'Electrical', master: ['voltageClass', 'phase'], technical: ['powerW', 'ratedAcPowerKw', 'maxAcOutputPowerKw', 'nominalEnergyKwh', 'usableEnergyKwh', 'pcsRatedPowerKw', 'maxOutputPowerKw', 'moduleEfficiencyPct', 'mpptQty', 'batteryVoltageRangeV', 'gridVoltageV'], extra: [] },
            mechanical: { label: 'Mechanical', master: [], technical: ['dimensionsMm', 'weightKg', 'ipRating', 'coolingType', 'mountingMethod', 'installationType', 'indoorOutdoor', 'operatingTemperature'], extra: [] },
            certification: { label: 'Certification', master: ['certificateLink'], technical: ['certification', 'safetyStandard', 'gridCode'], extra: ['certification'] },
            commercial: { label: 'Commercial / Source', master: ['remark'], technical: [], extra: ['commercial'] },
            documents: { label: 'Documents', master: ['datasheetLink', 'certificateLink'], technical: [], extra: ['documents'] }
        };
        const PRODUCT_MASTER_DETAIL_TEMPLATE_STORAGE_KEY = 'minova_product_master_detail_templates_v1';
        const PRODUCT_MASTER_DETAIL_HISTORY_HIDDEN_STORAGE_KEY = 'minova_product_master_detail_history_hidden_v1';
        const PRODUCT_MASTER_DETAIL_NEW_GROUP_VALUE = '__new_detail_group__';
        const PRODUCT_MASTER_DETAIL_MASTER_FIELD_LABELS = {
            model: 'Model',
            brand: 'Brand',
            series: 'Series',
            application: 'Application',
            voltageClass: 'Voltage Class',
            phase: 'Phase',
            status: 'Status',
            countryAvailable: 'Country Available',
            datasheetLink: 'Datasheet Link',
            certificateLink: 'Certificate Link',
            remark: 'Remark'
        };
        function normalizeProductMasterDetailGroupKey(value = 'basic') {
            const raw = String(value || '').trim();
            if (!raw) return 'basic';
            if (ENGINEERING_PRODUCT_MASTER_DETAIL_GROUPS[raw]) return raw;
            return raw
                .toLowerCase()
                .replace(/&/g, ' and ')
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '')
                .slice(0, 48) || 'basic';
        }
        function productMasterDetailGroupLabel(detailGroup = 'basic') {
            const groupKey = normalizeProductMasterDetailGroupKey(detailGroup);
            const builtin = ENGINEERING_PRODUCT_MASTER_DETAIL_GROUPS[groupKey];
            if (builtin?.label) return builtin.label;
            const custom = productMasterDetailTemplates.find(template => normalizeProductMasterDetailGroupKey(template.detailGroup) === groupKey && String(template.detailGroupLabel || '').trim());
            if (custom) return String(custom.detailGroupLabel || '').trim();
            return groupKey.split('-').filter(Boolean).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ') || 'Custom Details';
        }
        function productMasterDetailGroupDefinition(detailGroup = 'basic') {
            const groupKey = normalizeProductMasterDetailGroupKey(detailGroup);
            return ENGINEERING_PRODUCT_MASTER_DETAIL_GROUPS[groupKey] || { label: productMasterDetailGroupLabel(groupKey), master: [], technical: [], extra: [] };
        }
        function productMasterDetailGroupSelectOptions(selected = 'basic', { includeAll = false, includeNew = false } = {}) {
            const selectedKey = normalizeProductMasterDetailGroupKey(selected);
            const rows = Object.entries(ENGINEERING_PRODUCT_MASTER_DETAIL_GROUPS)
                .filter(([key]) => includeAll || key !== 'all')
                .map(([key, group]) => ({ key, label: group.label }));
            productMasterDetailTemplates.forEach(template => {
                const key = normalizeProductMasterDetailGroupKey(template.detailGroup);
                if (!key || key === 'all' || ENGINEERING_PRODUCT_MASTER_DETAIL_GROUPS[key] || rows.some(row => row.key === key)) return;
                rows.push({ key, label: productMasterDetailGroupLabel(key) });
            });
            if (includeNew) rows.push({ key: PRODUCT_MASTER_DETAIL_NEW_GROUP_VALUE, label: 'New Group' });
            return rows.map(row => `<option value="${htmlSafe(row.key)}" ${row.key === selectedKey ? 'selected' : ''}>${htmlSafe(row.label)}</option>`).join('');
        }
        function syncProductMasterDetailSelectOptions(selectId = '', selected = 'basic', options = {}) {
            const select = document.getElementById(selectId);
            if (!select) return;
            const value = normalizeProductMasterDetailGroupKey(selected || select.value || 'basic');
            select.innerHTML = productMasterDetailGroupSelectOptions(value, options);
            select.value = value;
        }
        function productMasterDetailTemplateId(category = '', detailGroup = '') {
            const cat = normalizeProductCategory(category || 'PV Module', 'PV Module');
            const group = normalizeProductMasterDetailGroupKey(detailGroup || 'basic');
            return `${cat}:${group}`;
        }
        function uniqueProductMasterFieldKeys(keys = []) {
            return Array.from(new Set((Array.isArray(keys) ? keys : []).map(key => String(key || '').trim()).filter(Boolean)));
        }
        function defaultProductMasterDetailFieldKeys(category = 'PV Module', detailGroup = 'basic') {
            const group = productMasterDetailGroupDefinition(detailGroup);
            const techIds = (() => {
                try { return new Set(getProductTechnicalSpecFieldsForCategory(category).map(field => field.id)); } catch (e) { return new Set(); }
            })();
            return uniqueProductMasterFieldKeys([
                ...(group.master || []),
                ...(group.technical || []).filter(key => !techIds.size || techIds.has(key))
            ]);
        }
        function normalizeProductMasterDetailTemplate(record = {}) {
            const category = normalizeProductCategory(record.category || 'PV Module', 'PV Module');
            const detailGroup = normalizeProductMasterDetailGroupKey(record.detailGroup || 'basic');
            const defaultFields = defaultProductMasterDetailFieldKeys(category, detailGroup);
            const fieldKeys = uniqueProductMasterFieldKeys(record.fieldKeys?.length ? record.fieldKeys : defaultFields);
            const requiredSet = new Set(uniqueProductMasterFieldKeys(record.requiredFieldKeys));
            const fieldLabels = {};
            if (record.fieldLabels && typeof record.fieldLabels === 'object') {
                fieldKeys.forEach(key => {
                    const label = String(record.fieldLabels[key] || '').trim();
                    if (label) fieldLabels[key] = label;
                });
            }
            const id = String(record.id || productMasterDetailTemplateId(category, detailGroup)).trim();
            return {
                id,
                category,
                detailGroup,
                detailGroupLabel: String(record.detailGroupLabel || '').trim(),
                fieldKeys,
                requiredFieldKeys: fieldKeys.filter(key => requiredSet.has(key)),
                fieldLabels,
                updatedAt: String(record.updatedAt || new Date().toISOString()),
                remarks: String(record.remarks || '').trim()
            };
        }
        function normalizeProductMasterDetailTemplates(list = []) {
            const map = new Map();
            (Array.isArray(list) ? list : []).forEach(item => {
                const normalized = normalizeProductMasterDetailTemplate(item);
                if (normalized.id) map.set(normalized.id, normalized);
            });
            return Array.from(map.values());
        }
        function getProductMasterDetailTemplate(category = 'PV Module', detailGroup = 'basic') {
            const id = productMasterDetailTemplateId(category, detailGroup);
            return productMasterDetailTemplates.find(template => template.id === id)
                || normalizeProductMasterDetailTemplate({ id, category, detailGroup });
        }
        function productMasterDetailFieldLabel(key = '') {
            const fieldKey = String(key || '').trim();
            try {
                if (PRODUCT_MASTER_DETAIL_MASTER_FIELD_LABELS[fieldKey]) return PRODUCT_MASTER_DETAIL_MASTER_FIELD_LABELS[fieldKey];
                if (PRODUCT_MASTER_TECHNICAL_LABEL_BY_KEY?.[fieldKey]) return PRODUCT_MASTER_TECHNICAL_LABEL_BY_KEY[fieldKey];
            } catch (e) {}
            return fieldKey;
        }
        function productMasterDetailTemplateFieldLabel(key = '', template = {}) {
            const fieldKey = String(key || '').trim();
            const customLabel = String(template?.fieldLabels?.[fieldKey] || '').trim();
            return customLabel || productMasterDetailFieldLabel(fieldKey);
        }
        function nextProductMasterDetailCustomFieldKey(template = {}) {
            const category = normalizeProductCategory(template.category || 'PV Module', 'PV Module');
            const selected = new Set([
                ...uniqueProductMasterFieldKeys(template.fieldKeys),
                ...productMasterDetailTemplates
                    .filter(item => normalizeProductCategory(item.category, '') === category)
                    .flatMap(item => uniqueProductMasterFieldKeys(item.fieldKeys))
            ]);
            let index = 1;
            while (selected.has(`customDetail${String(index).padStart(2, '0')}`)) index += 1;
            return `customDetail${String(index).padStart(2, '0')}`;
        }
        function productMasterDetailFieldOptions(category = '') {
            const masterKeys = Object.keys(PRODUCT_MASTER_DETAIL_MASTER_FIELD_LABELS);
            const techFields = (() => {
                try { return getProductTechnicalSpecFieldsForCategory(category); } catch (e) { return []; }
            })();
            const rows = [
                ...masterKeys.map(key => ({ key, label: PRODUCT_MASTER_DETAIL_MASTER_FIELD_LABELS[key], kind: 'masterData' })),
                ...techFields.map(field => ({ key: field.id, label: field.label || field.id, kind: 'technicalSpecs' }))
            ];
            const seen = new Set();
            return rows.filter(row => {
                if (!row.key || seen.has(row.key)) return false;
                seen.add(row.key);
                return true;
            });
        }
        function productMasterDetailFieldKind(category = '', key = '') {
            const fieldKey = String(key || '').trim();
            try {
                if (PRODUCT_MASTER_COMMON_FIELD_KEYS.includes(fieldKey)) return 'masterData';
                if (getProductTechnicalSpecFieldsForCategory(category).some(field => field.id === fieldKey)) return 'technicalSpecs';
            } catch (e) {}
            if (fieldKey.startsWith('customDetail')) return 'technicalSpecs';
            return 'previewOnly';
        }
        function productMasterDetailValue(product = {}, category = '', key = '') {
            const kind = productMasterDetailFieldKind(category || product.category, key);
            if (kind === 'masterData') return getProductMasterData(product)[key] ?? '';
            if (kind === 'technicalSpecs') return getProductTechnicalSpecs(product)[key] ?? '';
            return '';
        }
        function setProductMasterDetailValue(product = {}, category = '', key = '', value = '') {
            const kind = productMasterDetailFieldKind(category || product.category, key);
            if (kind === 'masterData') {
                product.masterData = { ...(product.masterData || {}), [key]: String(value ?? '').trim() };
                product.masterData = compactProductMasterObject(product.masterData);
                return true;
            }
            if (kind === 'technicalSpecs') {
                const field = getProductTechnicalSpecFieldsForCategory(category || product.category).find(item => item.id === key) || {};
                product.technicalSpecs = { ...(product.technicalSpecs || {}), [key]: coerceProductMasterFieldValue(value, field.type) };
                product.technicalSpecs = compactProductMasterObject(product.technicalSpecs);
                return true;
            }
            return false;
        }
        function canManageEngineeringRecord(action = 'edit') {
            if (action === 'delete') return window.__minovaAuth?.canPerformAction?.('engineering', 'delete') ?? true;
            if (action === 'upload') return window.__minovaAuth?.canPerformAction?.('engineering', 'upload') ?? true;
            return window.__minovaAuth?.canPerformAction?.('engineering', 'edit') ?? true;
        }
        function canAddEngineeringProductToQuote() {
            return window.__minovaAuth?.canPerformAction?.('quotes', 'edit') ?? true;
        }
        function applyEngineeringPermissions() {
            const canEdit = canManageEngineeringRecord('edit');
            const canDelete = canManageEngineeringRecord('delete');
            const canUpload = canManageEngineeringRecord('upload');
            document.querySelectorAll('[data-engineering-action="edit"]').forEach(el => { el.style.display = canEdit ? '' : 'none'; });
            document.querySelectorAll('[data-engineering-action="delete"]').forEach(el => { el.style.display = canDelete ? '' : 'none'; });
            document.querySelectorAll('[data-engineering-action="upload"]').forEach(el => { el.style.display = canUpload ? '' : 'none'; });
            document.querySelectorAll('[data-engineering-action="quote-add"]').forEach(el => {
                const allowed = canAddEngineeringProductToQuote();
                el.disabled = !allowed;
                el.classList.toggle('opacity-40', !allowed);
                el.classList.toggle('cursor-not-allowed', !allowed);
                el.title = allowed ? '' : 'No quotation edit permission';
            });
        }
        window.applyEngineeringPermissions = applyEngineeringPermissions;
        function getEngineeringQuoteDefaults() {
            try {
                const parsed = JSON.parse(localStorage.getItem(MINOVA_ENGINEERING_QUOTE_DEFAULTS_KEY) || '{}');
                return {
                    source: parsed.source === 'priceList' ? 'priceList' : 'inventory',
                    priceType: ['clearance_home', 'clearance_biz', 'gray_home', 'gray_biz'].includes(parsed.priceType) ? parsed.priceType : 'clearance_home'
                };
            } catch (e) {
                return { source: 'inventory', priceType: 'clearance_home' };
            }
        }
        function loadEngineeringQuoteDefaultsToUi() {
            const defaults = getEngineeringQuoteDefaults();
            const source = document.getElementById('engineering-quote-source-default');
            const price = document.getElementById('engineering-quote-price-default');
            const detailSource = document.getElementById('engineering-detail-quote-source-default');
            const detailPrice = document.getElementById('engineering-detail-quote-price-default');
            if (source) source.value = defaults.source;
            if (price) price.value = defaults.priceType;
            if (detailSource) detailSource.value = defaults.source;
            if (detailPrice) detailPrice.value = defaults.priceType;
        }
        window.saveEngineeringQuoteDefaults = () => {
            const source = document.getElementById('engineering-quote-source-default')?.value === 'priceList' ? 'priceList' : 'inventory';
            const priceType = document.getElementById('engineering-quote-price-default')?.value || 'clearance_home';
            try { localStorage.setItem(MINOVA_ENGINEERING_QUOTE_DEFAULTS_KEY, JSON.stringify({ source, priceType })); } catch (e) {}
            loadEngineeringQuoteDefaultsToUi();
        };
        window.saveEngineeringDetailQuoteDefaults = () => {
            const source = document.getElementById('engineering-detail-quote-source-default')?.value === 'priceList' ? 'priceList' : 'inventory';
            const priceType = document.getElementById('engineering-detail-quote-price-default')?.value || 'clearance_home';
            try { localStorage.setItem(MINOVA_ENGINEERING_QUOTE_DEFAULTS_KEY, JSON.stringify({ source, priceType })); } catch (e) {}
            loadEngineeringQuoteDefaultsToUi();
        };
        function normalizeEngineeringClassId(value = '') {
            return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 16);
        }
        function normalizeEngineeringClassCategories(value = []) {
            const raw = Array.isArray(value) ? value : String(value || '').split(',');
            const allowed = new Set(CERTIFICATION_SOURCE_CATEGORIES);
            const categories = raw.map(item => normalizeCertificationSourceCategory(item)).filter(item => allowed.has(item));
            return Array.from(new Set(categories));
        }
        function saveEngineeringArchitectureClasses() {
            const custom = Object.entries(ENGINEERING_CLASS_DEFINITIONS)
                .filter(([, cls]) => cls?.custom)
                .map(([id, cls]) => ({
                    id,
                    label: String(cls.label || id).trim(),
                    categories: normalizeEngineeringClassCategories(cls.categories),
                    recordIds: Array.from(new Set(Array.isArray(cls.recordIds) ? cls.recordIds.map(v => String(v || '').trim()).filter(Boolean) : [])),
                    note: String(cls.note || '').trim()
                }));
            try { localStorage.setItem(MINOVA_ENGINEERING_CLASS_STORAGE_KEY, JSON.stringify(custom)); } catch (e) {}
        }
        function loadEngineeringArchitectureClasses() {
            try {
                const parsed = JSON.parse(localStorage.getItem(MINOVA_ENGINEERING_CLASS_STORAGE_KEY) || '[]');
                (Array.isArray(parsed) ? parsed : []).forEach(item => {
                    const id = normalizeEngineeringClassId(item.id);
                    const categories = normalizeEngineeringClassCategories(item.categories);
                    if (!id || !categories.length) return;
                    ENGINEERING_CLASS_DEFINITIONS[id] = {
                        label: String(item.label || id).trim() || id,
                        categories,
                        recordIds: Array.from(new Set(Array.isArray(item.recordIds) ? item.recordIds.map(v => String(v || '').trim()).filter(Boolean) : [])),
                        note: String(item.note || '').trim(),
                        custom: true
                    };
                });
            } catch (e) {}
        }
        loadEngineeringArchitectureClasses();
        function renderEngineeringArchitectureClassOptions() {
            loadEngineeringArchitectureClasses();
            const select = document.getElementById('engineering-class-filter');
            if (!select) return;
            const previous = select.value || 'A1';
            select.innerHTML = Object.entries(ENGINEERING_CLASS_DEFINITIONS).map(([id, cls]) => `<option value="${htmlSafe(id)}">${htmlSafe(cls.label || id)}</option>`).join('');
            select.value = ENGINEERING_CLASS_DEFINITIONS[previous] ? previous : 'A1';
        }
        window.renderEngineeringArchitectureClassOptions = renderEngineeringArchitectureClassOptions;
        function syncEngineeringCertificationEditChrome() {
            const viewBtn = document.getElementById('engineering-cert-view-mode');
            const editBtn = document.getElementById('engineering-cert-edit-mode');
            const addRecord = document.getElementById('engineering-add-record-button');
            const classActions = document.getElementById('engineering-architecture-class-edit-actions');
            const viewClass = 'px-4 py-2 rounded-lg text-xs font-black bg-slate-900 text-white';
            const idleClass = 'px-4 py-2 rounded-lg text-xs font-black text-slate-500';
            if (viewBtn) viewBtn.className = engineeringCertificationEditMode ? idleClass : viewClass;
            if (editBtn) editBtn.className = engineeringCertificationEditMode ? viewClass : idleClass;
            if (addRecord) addRecord.classList.toggle('hidden', !engineeringCertificationEditMode);
            if (classActions) {
                classActions.classList.toggle('hidden', !engineeringCertificationEditMode);
                classActions.classList.toggle('flex', engineeringCertificationEditMode);
            }
        }
        window.syncEngineeringCertificationEditChrome = syncEngineeringCertificationEditChrome;
        function setEngineeringCertificationEditMode(mode = 'view') {
            engineeringCertificationEditMode = mode === 'edit';
            renderEngineeringWorkspace();
        }
        window.setEngineeringCertificationEditMode = setEngineeringCertificationEditMode;
        function nextEngineeringArchitectureClassId() {
            const ids = Object.keys(ENGINEERING_CLASS_DEFINITIONS).map(id => normalizeEngineeringClassId(id)).filter(Boolean);
            const letters = ids.filter(id => /^[A-Z]$/.test(id)).map(id => id.charCodeAt(0));
            const nextCode = Math.max('E'.charCodeAt(0), ...letters) + 1;
            if (nextCode <= 'Z'.charCodeAt(0)) return String.fromCharCode(nextCode);
            let index = 1;
            while (ENGINEERING_CLASS_DEFINITIONS[`CUSTOM-${index}`]) index += 1;
            return `CUSTOM-${index}`;
        }
        window.nextEngineeringArchitectureClassId = nextEngineeringArchitectureClassId;
        function selectedEngineeringArchitectureClassLevels() {
            return Array.from(document.querySelectorAll('#engineering-architecture-class-level-filters input[data-engineering-class-level]:checked')).map(input => input.value).filter(Boolean);
        }
        function selectedEngineeringArchitectureClassCategories() {
            return Array.from(document.querySelectorAll('#engineering-architecture-class-category-filters input[data-engineering-class-category]:checked')).map(input => input.value).filter(Boolean);
        }
        function renderEngineeringArchitectureClassModalFilters() {
            const render = (box, values, attr) => {
                if (!box) return;
                box.innerHTML = values.map(value => `
                    <label class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 shadow-sm transition-colors hover:border-purple-200">
                        <input type="checkbox" ${attr} value="${htmlSafe(value)}" checked onchange="renderEngineeringArchitectureClassRecordCards()" class="h-4 w-4 accent-purple-700">
                        <span>${htmlSafe(value)}</span>
                    </label>
                `).join('');
            };
            render(document.getElementById('engineering-architecture-class-level-filters'), CERTIFICATION_REQUIREMENT_LEVELS, 'data-engineering-class-level');
            render(document.getElementById('engineering-architecture-class-category-filters'), CERTIFICATION_SOURCE_CATEGORIES, 'data-engineering-class-category');
        }
        window.renderEngineeringArchitectureClassModalFilters = renderEngineeringArchitectureClassModalFilters;
        function updateEngineeringArchitectureClassSelectionNote(visibleCount = 0) {
            const note = document.getElementById('engineering-architecture-class-selection-note');
            if (note) note.textContent = `${engineeringArchitectureClassSelectedIds.size} records selected · ${visibleCount} visible`;
        }
        function renderEngineeringArchitectureClassRecordCards() {
            const box = document.getElementById('engineering-architecture-class-record-cards');
            if (!box) return;
            const levels = new Set(selectedEngineeringArchitectureClassLevels());
            const categories = new Set(selectedEngineeringArchitectureClassCategories());
            const rows = certificationRequirementsCatalog.filter(record => {
                if (levels.size && !levels.has(record.requirementLevel)) return false;
                if (categories.size && !categories.has(record.sourceCategory)) return false;
                return true;
            });
            const groups = new Map();
            rows.forEach(record => {
                const key = `${record.requirementLevel || 'Other'} · ${record.sourceCategory || 'Other'}`;
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(record);
            });
            updateEngineeringArchitectureClassSelectionNote(rows.length);
            if (!rows.length) {
                box.innerHTML = '<div class="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-xs font-bold text-slate-400">No records match the selected level and category filters.</div>';
                return;
            }
            box.innerHTML = Array.from(groups.entries()).map(([group, records]) => `
                <div class="rounded-2xl border border-slate-200 overflow-hidden">
                    <div class="flex items-center justify-between gap-3 bg-slate-50 px-4 py-3">
                        <div class="text-xs font-black text-slate-500 uppercase tracking-widest">${htmlSafe(group)}</div>
                        <div class="text-[10px] font-black text-slate-400">${records.length} records</div>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 p-3">
                        ${records.map(record => {
                            const checked = engineeringArchitectureClassSelectedIds.has(record.id);
                            return `
                                <label class="rounded-2xl border ${checked ? 'border-purple-300 bg-purple-50' : 'border-slate-200 bg-white'} p-3 cursor-pointer hover:border-purple-300 transition-colors">
                                    <div class="flex items-start gap-3">
                                        <input type="checkbox" data-engineering-class-record value="${htmlSafe(record.id)}" ${checked ? 'checked' : ''} onchange="toggleEngineeringArchitectureClassRecord('${htmlSafe(record.id)}', this.checked)" class="mt-1 h-4 w-4 accent-purple-700">
                                        <div class="min-w-0">
                                            <div class="text-sm font-black text-slate-800">${htmlSafe(record.id)}</div>
                                            <div class="mt-1 text-xs font-bold text-slate-700 truncate" title="${htmlSafe(record.standard || '')}">${htmlSafe(record.standard || '-')}</div>
                                            <div class="mt-1 text-[10px] text-slate-400 line-clamp-2">${htmlSafe(record.applicabilityCondition || record.productCategory || '-')}</div>
                                        </div>
                                    </div>
                                </label>
                            `;
                        }).join('')}
                    </div>
                </div>
            `).join('');
        }
        window.renderEngineeringArchitectureClassRecordCards = renderEngineeringArchitectureClassRecordCards;
        function toggleEngineeringArchitectureClassRecord(recordId, checked) {
            const id = String(recordId || '').trim();
            if (!id) return;
            if (checked) engineeringArchitectureClassSelectedIds.add(id);
            else engineeringArchitectureClassSelectedIds.delete(id);
            renderEngineeringArchitectureClassRecordCards();
        }
        window.toggleEngineeringArchitectureClassRecord = toggleEngineeringArchitectureClassRecord;
        function selectVisibleEngineeringArchitectureClassRecords(checked = true) {
            document.querySelectorAll('#engineering-architecture-class-record-cards input[data-engineering-class-record]').forEach(input => {
                const id = String(input.value || '').trim();
                if (!id) return;
                if (checked) engineeringArchitectureClassSelectedIds.add(id);
                else engineeringArchitectureClassSelectedIds.delete(id);
            });
            renderEngineeringArchitectureClassRecordCards();
        }
        window.selectVisibleEngineeringArchitectureClassRecords = selectVisibleEngineeringArchitectureClassRecords;
        function selectedEngineeringArchitectureClassRecordIds() {
            return Array.from(engineeringArchitectureClassSelectedIds).filter(id => getCertificationRequirementById(id));
        }
        window.selectedEngineeringArchitectureClassRecordIds = selectedEngineeringArchitectureClassRecordIds;
        function openEngineeringArchitectureClassModal() {
            const modal = document.getElementById('engineering-architecture-class-modal');
            if (!modal) return;
            engineeringArchitectureClassSelectedIds = new Set();
            const idInput = document.getElementById('engineering-architecture-class-id');
            const nameInput = document.getElementById('engineering-architecture-class-name');
            if (idInput) idInput.value = nextEngineeringArchitectureClassId();
            if (nameInput) nameInput.value = '';
            renderEngineeringArchitectureClassModalFilters();
            renderEngineeringArchitectureClassRecordCards();
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            setTimeout(() => nameInput?.focus(), 0);
        }
        window.openEngineeringArchitectureClassModal = openEngineeringArchitectureClassModal;
        function closeEngineeringArchitectureClassModal() {
            const modal = document.getElementById('engineering-architecture-class-modal');
            if (!modal) return;
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
        window.closeEngineeringArchitectureClassModal = closeEngineeringArchitectureClassModal;
        function saveEngineeringArchitectureClassModal() {
            if (!canManageEngineeringRecord()) return alert('No engineering edit permission.');
            const id = normalizeEngineeringClassId(document.getElementById('engineering-architecture-class-id')?.value || nextEngineeringArchitectureClassId());
            const name = String(document.getElementById('engineering-architecture-class-name')?.value || '').trim();
            const recordIds = selectedEngineeringArchitectureClassRecordIds();
            if (!id) return alert('Architecture Class ID is required.');
            if (!name) return alert('Architecture Class name is required.');
            if (ENGINEERING_CLASS_DEFINITIONS[id]) return alert('Architecture Class already exists.');
            if (!recordIds.length) return alert('Select at least one certification record.');
            const selectedRecords = recordIds.map(id => getCertificationRequirementById(id)).filter(Boolean);
            const categories = Array.from(new Set(selectedRecords.map(record => record.sourceCategory).filter(Boolean)));
            ENGINEERING_CLASS_DEFINITIONS[id] = {
                label: `${id} - ${name}`,
                categories: categories.length ? categories : CERTIFICATION_SOURCE_CATEGORIES.slice(),
                recordIds,
                note: `${recordIds.length} selected certification records.`,
                custom: true
            };
            saveEngineeringArchitectureClasses();
            closeEngineeringArchitectureClassModal();
            renderEngineeringArchitectureClassOptions();
            const select = document.getElementById('engineering-class-filter');
            if (select) select.value = id;
            renderEngineeringWorkspace();
        }
        window.saveEngineeringArchitectureClassModal = saveEngineeringArchitectureClassModal;
        function addEngineeringArchitectureClass() {
            if (!canManageEngineeringRecord()) return alert('No engineering edit permission.');
            openEngineeringArchitectureClassModal();
        }
        window.addEngineeringArchitectureClass = addEngineeringArchitectureClass;
        function deleteEngineeringArchitectureClass() {
            if (!canManageEngineeringRecord()) return alert('No engineering delete permission.');
            const select = document.getElementById('engineering-class-filter');
            const id = normalizeEngineeringClassId(select?.value || '');
            const cls = ENGINEERING_CLASS_DEFINITIONS[id];
            if (!id || !cls) return;
            if (!cls.custom) return alert('Default Architecture Classes cannot be deleted.');
            if (!confirm(`Delete Architecture Class ${cls.label || id}?`)) return;
            delete ENGINEERING_CLASS_DEFINITIONS[id];
            saveEngineeringArchitectureClasses();
            if (select) select.value = 'A1';
            renderEngineeringWorkspace();
        }
        window.deleteEngineeringArchitectureClass = deleteEngineeringArchitectureClass;
        function syncEngineeringCertificationModeVisibility() {
            const standard = document.getElementById('engineering-standard-panel');
            const matrix = document.getElementById('engineering-matrix-panel');
            const standardSearchFilters = document.getElementById('engineering-standard-search-filters');
            const standardMatchCard = document.getElementById('engineering-standard-match-card');
            const searchProductBtn = document.getElementById('engineering-search-products-primary');
            const standardMatchHost = document.getElementById('engineering-standard-match-host');
            const matrixMatchHost = document.getElementById('engineering-matrix-match-host');
            const standardBtn = document.getElementById('engineering-mode-standard');
            const matrixBtn = document.getElementById('engineering-mode-matrix');
            const inCertification = engineeringWorkspaceView === 'certification';
            if (standardMatchCard) {
                const targetHost = engineeringWorkspaceMode === 'matrix' ? matrixMatchHost : standardMatchHost;
                if (targetHost && standardMatchCard.parentElement !== targetHost) targetHost.appendChild(standardMatchCard);
            }
            if (standard) standard.classList.toggle('hidden', !inCertification || engineeringWorkspaceMode !== 'standard');
            if (matrix) matrix.classList.toggle('hidden', !inCertification || engineeringWorkspaceMode !== 'matrix');
            if (standardSearchFilters) standardSearchFilters.classList.toggle('hidden', !inCertification || engineeringWorkspaceMode !== 'standard');
            if (standardMatchCard) standardMatchCard.classList.toggle('hidden', !inCertification);
            if (searchProductBtn) searchProductBtn.classList.toggle('hidden', !inCertification);
            if (standardBtn) standardBtn.className = engineeringWorkspaceMode === 'standard' ? 'px-4 py-2 rounded-lg text-xs font-black bg-slate-900 text-white' : 'px-4 py-2 rounded-lg text-xs font-black text-slate-500';
            if (matrixBtn) matrixBtn.className = engineeringWorkspaceMode === 'matrix' ? 'px-4 py-2 rounded-lg text-xs font-black bg-slate-900 text-white' : 'px-4 py-2 rounded-lg text-xs font-black text-slate-500';
            syncEngineeringCertificationEditChrome();
        }
        function syncEngineeringWorkspaceViewChrome() {
            const inProductMaster = engineeringWorkspaceView === 'productMaster';
            const certPanel = document.getElementById('engineering-certification-workspace-panel');
            const productPanel = document.getElementById('engineering-product-master-panel');
            const title = document.getElementById('engineering-workspace-title');
            const subtitle = document.getElementById('engineering-workspace-subtitle');
            const certBtn = document.getElementById('engineering-workspace-certification');
            const productBtn = document.getElementById('engineering-workspace-product-master');
            const summary = document.getElementById('engineering-summary');
            if (certPanel) certPanel.classList.toggle('hidden', inProductMaster);
            if (productPanel) productPanel.classList.toggle('hidden', !inProductMaster);
            summary?.classList.toggle('hidden', engineeringWorkspaceView !== 'certification');
            if (title) title.textContent = inProductMaster ? 'Product Master' : 'Certification Standards';
            if (subtitle) subtitle.textContent = inProductMaster
                ? 'Maintain engineering product master details by category, readiness, and technical data.'
                : 'Maintain Malaysia product certification requirements, product evidence, and class-based engineering readiness.';
            if (certBtn) certBtn.className = !inProductMaster ? 'px-4 py-2 rounded-lg text-xs font-black bg-purple-700 text-white shadow-sm' : 'px-4 py-2 rounded-lg text-xs font-black text-purple-700 brand-yellow-inactive';
            if (productBtn) productBtn.className = inProductMaster ? 'px-4 py-2 rounded-lg text-xs font-black bg-purple-700 text-white shadow-sm' : 'px-4 py-2 rounded-lg text-xs font-black text-purple-700 brand-yellow-inactive';
            syncEngineeringCertificationModeVisibility();
        }
        function setEngineeringWorkspaceView(view = 'certification') {
            engineeringWorkspaceView = view === 'productMaster' ? 'productMaster' : 'certification';
            renderEngineeringWorkspace();
        }
        window.setEngineeringWorkspaceView = setEngineeringWorkspaceView;
        function setEngineeringWorkspaceMode(mode = 'standard') {
            engineeringWorkspaceMode = mode === 'matrix' ? 'matrix' : 'standard';
            syncEngineeringCertificationModeVisibility();
            renderEngineeringWorkspace();
        }
        window.setEngineeringWorkspaceMode = setEngineeringWorkspaceMode;
        function certificationRequirementPrefixForCategory(category = '') {
            const source = normalizeCertificationSourceCategory(category);
            if (source === 'INVERTER') return 'INV';
            if (source === 'BATTERY') return 'BESS';
            return 'PV';
        }
        function nextCertificationRequirementIdForCategory(category = '') {
            const prefix = certificationRequirementPrefixForCategory(category);
            const max = certificationRequirementsCatalog.reduce((value, record) => {
                const match = String(record.id || '').match(new RegExp(`^${prefix}-(\\d+)$`));
                return match ? Math.max(value, parseInt(match[1], 10) || 0) : value;
            }, 0);
            return `${prefix}-${String(max + 1).padStart(3, '0')}`;
        }
        window.nextCertificationRequirementIdForCategory = nextCertificationRequirementIdForCategory;
        function certificationProductCategoryOptions(sourceCategory = 'PV_MODULE', selected = '') {
            const source = normalizeCertificationSourceCategory(sourceCategory);
            const existing = certificationRequirementsCatalog
                .filter(record => record.sourceCategory === source)
                .map(record => record.productCategory);
            return uniqueCertList([...(CERTIFICATION_PRODUCT_CATEGORY_DEFAULTS[source] || []), ...existing, selected]);
        }
        function renderCertificationProductCategoryOptions(sourceCategory = 'PV_MODULE', selected = '') {
            const normalizedSelected = String(selected || '').trim();
            const options = certificationProductCategoryOptions(sourceCategory, normalizedSelected);
            const selectedIsKnown = !normalizedSelected || options.some(option => option.toLowerCase() === normalizedSelected.toLowerCase());
            return [
                ...options.map(option => `<option value="${htmlSafe(option)}" ${option === normalizedSelected ? 'selected' : ''}>${htmlSafe(option)}</option>`),
                `<option value="__custom__" ${selectedIsKnown ? '' : 'selected'}>+ Add custom category</option>`
            ].join('');
        }
        function readEngineeringDetailProductCategory() {
            const select = document.getElementById('engineering-detail-product-category-select');
            if (!select) return String(document.getElementById('engineering-detail-product-category')?.value || '').trim();
            if (select.value === '__custom__') {
                return String(document.getElementById('engineering-detail-product-category-custom')?.value || '').trim();
            }
            return String(select.value || '').trim();
        }
        function syncEngineeringProductCategoryInput() {
            const select = document.getElementById('engineering-detail-product-category-select');
            const custom = document.getElementById('engineering-detail-product-category-custom');
            if (!select || !custom) return;
            const isCustom = select.value === '__custom__';
            custom.classList.toggle('hidden', !isCustom);
            if (isCustom && !custom.value) custom.focus();
        }
        window.syncEngineeringProductCategoryInput = syncEngineeringProductCategoryInput;
        function syncEngineeringRequirementEditorSourceCategory() {
            const source = document.getElementById('engineering-detail-source-category')?.value || 'PV_MODULE';
            const isNew = document.getElementById('engineering-detail-is-new')?.value === '1';
            const idInput = document.getElementById('engineering-detail-id');
            if (isNew && idInput) idInput.value = nextCertificationRequirementIdForCategory(source);
            const productCategorySelect = document.getElementById('engineering-detail-product-category-select');
            const productCategoryCustom = document.getElementById('engineering-detail-product-category-custom');
            if (!productCategorySelect) return;
            const previousValue = readEngineeringDetailProductCategory();
            const sourceOptions = certificationProductCategoryOptions(source);
            const nextValue = sourceOptions.some(option => option.toLowerCase() === previousValue.toLowerCase()) && previousValue
                ? previousValue
                : (sourceOptions[0] || '');
            productCategorySelect.innerHTML = renderCertificationProductCategoryOptions(source, nextValue);
            productCategorySelect.value = nextValue;
            if (productCategoryCustom) productCategoryCustom.value = '';
            syncEngineeringProductCategoryInput();
        }
        window.syncEngineeringRequirementEditorSourceCategory = syncEngineeringRequirementEditorSourceCategory;
        function getEngineeringRequirementLinkedProducts(recordId) {
            const id = String(recordId || '').trim();
            if (!id) return [];
            return products.filter(product => {
                const req = getProductCertificationRequirements(product);
                return (req.recordIds || []).map(v => String(v || '').trim()).includes(id);
            });
        }
        function getEngineeringRequirementEvidence(recordId) {
            const id = String(recordId || '').trim();
            return productCertificationEvidence.filter(item => item.requirementRecordId === id);
        }
        function engineeringSelectedLevels() {
            const checks = engineeringWorkspaceMode === 'standard'
                ? Array.from(document.querySelectorAll('#engineering-standard-level-filters input[data-engineering-level]:checked'))
                : Array.from(document.querySelectorAll('#engineering-level-filters input[data-engineering-level]:checked'));
            return checks.map(input => input.value).filter(Boolean);
        }
        function engineeringSelectedCategories() {
            const checks = engineeringWorkspaceMode === 'standard'
                ? Array.from(document.querySelectorAll('#engineering-standard-category-filters input[data-engineering-category]:checked'))
                : Array.from(document.querySelectorAll('#engineering-category-filters input[data-engineering-category]:checked'));
            return checks.map(input => input.value).filter(Boolean);
        }
        function renderEngineeringFilterChips() {
            const renderLevelBox = (levelBox) => {
                if (!levelBox || levelBox.dataset.ready) return;
                levelBox.innerHTML = CERTIFICATION_REQUIREMENT_LEVELS.map(level => `
                    <label class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 shadow-sm transition-colors hover:border-purple-200 hover:bg-white">
                        <input type="checkbox" data-engineering-level value="${htmlSafe(level)}" checked onchange="renderEngineeringWorkspace()" class="h-4 w-4 accent-purple-700">
                        <span>${htmlSafe(level)}</span>
                    </label>
                `).join('');
                levelBox.dataset.ready = '1';
            };
            const renderCategoryBox = (catBox) => {
                if (!catBox || catBox.dataset.ready) return;
                catBox.innerHTML = CERTIFICATION_SOURCE_CATEGORIES.map(category => `
                    <label class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 shadow-sm transition-colors hover:border-purple-200 hover:bg-white">
                        <input type="checkbox" data-engineering-category value="${htmlSafe(category)}" checked onchange="renderEngineeringWorkspace()" class="h-4 w-4 accent-purple-700">
                        <span>${htmlSafe(category)}</span>
                    </label>
                `).join('');
                catBox.dataset.ready = '1';
            };
            renderLevelBox(document.getElementById('engineering-standard-level-filters'));
            renderCategoryBox(document.getElementById('engineering-standard-category-filters'));
            renderLevelBox(document.getElementById('engineering-level-filters'));
            renderCategoryBox(document.getElementById('engineering-category-filters'));
        }
        function engineeringRecordMatchesClass(record, classId) {
            const cls = ENGINEERING_CLASS_DEFINITIONS[classId] || ENGINEERING_CLASS_DEFINITIONS.A1;
            if (Array.isArray(cls.recordIds) && cls.recordIds.length) {
                return cls.recordIds.map(id => String(id || '').trim()).includes(String(record.id || '').trim());
            }
            if (!cls.categories.includes(record.sourceCategory)) return false;
            const text = `${record.productCategory} ${record.standard} ${record.applicabilityCondition} ${record.projectApplicability}`.toLowerCase();
            if (classId === 'A1' && (record.sourceCategory === 'BATTERY' || text.includes('bess') || text.includes('pcs'))) return false;
            if (classId === 'C' && (text.includes('grid-connected only') || text.includes('grid interface') || text.includes('anti-islanding'))) return false;
            if (classId === 'D' && record.sourceCategory === 'BATTERY') return false;
            if (classId === 'E' && record.sourceCategory === 'PV_MODULE') return false;
            return true;
        }
        function engineeringVisibleRecords() {
            const classId = document.getElementById('engineering-class-filter')?.value || 'A1';
            const levels = new Set(engineeringSelectedLevels());
            const categories = new Set(engineeringSelectedCategories());
            const search = String(document.getElementById('engineering-search')?.value || '').trim().toLowerCase();
            return certificationRequirementsCatalog.filter(record => {
                if (engineeringWorkspaceMode === 'matrix') {
                    if (!engineeringRecordMatchesClass(record, classId)) return false;
                }
                if (levels.size && !levels.has(record.requirementLevel)) return false;
                if (categories.size && !categories.has(record.sourceCategory)) return false;
                if (!search) return true;
                const hay = [record.id, record.sourceCategory, record.productCategory, record.standard, record.requirementLevel, record.applicabilityCondition, record.evidenceType, record.projectApplicability].join(' ').toLowerCase();
                return hay.includes(search);
            });
        }
        function renderEngineeringStandardList(rows = []) {
            const list = document.getElementById('engineering-standard-list');
            if (!list) return;
            pruneEngineeringStandardSelectionToRows(rows);
            const allVisibleSelected = rows.length > 0 && rows.every(record => engineeringStandardSelectedIds.has(record.id));
            const selectAll = document.getElementById('engineering-standard-select-all');
            if (selectAll) selectAll.checked = allVisibleSelected;
            list.innerHTML = rows.map(record => {
                const linked = getEngineeringRequirementLinkedProducts(record.id);
                const checked = engineeringStandardSelectedIds.has(record.id);
                const editActions = engineeringCertificationEditMode ? `
                                <button data-engineering-action="edit" onclick="openEngineeringRequirementEditor('${htmlSafe(record.id)}')" class="text-xs font-black text-purple-700 hover:underline">Edit</button>
                                <button data-engineering-action="delete" onclick="deleteEngineeringRequirementRecord('${htmlSafe(record.id)}')" class="text-xs font-black text-red-600 hover:underline">Delete</button>
                ` : '';
                return `
                    <tr class="hover:bg-slate-50 transition-colors">
                        <td class="py-4 px-4"><input type="checkbox" data-engineering-standard-select value="${htmlSafe(record.id)}" ${checked ? 'checked' : ''} onchange="toggleEngineeringStandardSelection('${htmlSafe(record.id)}', this.checked)" class="h-4 w-4 accent-purple-700"></td>
                        <td class="py-4 px-4"><div class="font-black text-slate-700">${htmlSafe(record.id)}</div><div class="text-[10px] text-slate-400">${htmlSafe(record.seedVersion || 'manual')}</div></td>
                        <td class="py-4 px-4"><div class="text-xs font-bold text-slate-600">${htmlSafe(record.sourceCategory)}</div><div class="text-[10px] text-slate-400">${htmlSafe(record.productCategory || '-')}</div></td>
                        <td class="py-4 px-4"><div class="text-xs font-bold text-slate-700 max-w-[360px] truncate" title="${htmlSafe(record.standard)}">${htmlSafe(record.standard || '-')}</div><div class="text-[10px] text-slate-400 truncate max-w-[360px]" title="${htmlSafe(record.applicabilityCondition)}">${htmlSafe(record.applicabilityCondition || '-')}</div></td>
                        <td class="py-4 px-4"><span class="rounded-full border px-2 py-1 text-[10px] font-black ${certificationLevelTone(record.requirementLevel)}">${htmlSafe(record.requirementLevel || '-')}</span></td>
                        <td class="py-4 px-4 text-center"><button onclick="openEngineeringCertDetail('${htmlSafe(record.id)}')" class="text-xs font-black text-slate-700 hover:text-purple-700">${linked.length}</button></td>
                        <td class="py-4 px-4 text-center">
                            <div class="inline-flex items-center gap-2">
                                <button onclick="openEngineeringCertDetail('${htmlSafe(record.id)}')" class="text-xs font-black text-slate-700 hover:text-purple-700 hover:underline">Details</button>
                                ${editActions}
                            </div>
                        </td>
                    </tr>
                `;
            }).join('') || '<tr><td colspan="7" class="py-12 text-center text-slate-400 text-sm">No certification records match the current search.</td></tr>';
            const selectedNote = document.getElementById('engineering-standard-selection-note');
            if (selectedNote) selectedNote.textContent = `${engineeringStandardSelectedIds.size} records selected`;
            window.applyFrozenColumns('engineering-standard');
        }
        function pruneEngineeringStandardSelectionToRows(rows = []) {
            const visibleIds = new Set(rows.map(record => String(record.id || '').trim()).filter(Boolean));
            Array.from(engineeringStandardSelectedIds).forEach(id => {
                if (!visibleIds.has(id) || !getCertificationRequirementById(id)) engineeringStandardSelectedIds.delete(id);
            });
            return visibleIds;
        }
        function renderEngineeringMatrixList(rows = []) {
            const list = document.getElementById('engineering-cert-list');
            if (!list) return;
            pruneEngineeringStandardSelectionToRows(rows);
            const allVisibleSelected = rows.length > 0 && rows.every(record => engineeringStandardSelectedIds.has(record.id));
            const selectAll = document.getElementById('engineering-matrix-select-all');
            if (selectAll) selectAll.checked = allVisibleSelected;
            list.innerHTML = rows.map(record => {
                const linked = getEngineeringRequirementLinkedProducts(record.id);
                const checked = engineeringStandardSelectedIds.has(record.id);
                const sourceLink = record.sourceUrl ? `<a href="${htmlSafe(record.sourceUrl)}" target="_blank" rel="noopener" class="text-[10px] font-bold text-blue-600 hover:underline">Source</a>` : '<span class="text-[10px] text-slate-300">No source</span>';
                const editActions = engineeringCertificationEditMode ? `
                                <button data-engineering-action="edit" onclick="openEngineeringRequirementEditor('${htmlSafe(record.id)}')" class="text-xs font-black text-purple-700 hover:underline">Edit</button>
                                <button data-engineering-action="delete" onclick="deleteEngineeringRequirementRecord('${htmlSafe(record.id)}')" class="text-xs font-black text-red-600 hover:underline">Delete</button>
                ` : '';
                return `
                    <tr class="hover:bg-slate-50 transition-colors">
                        <td class="py-4 px-4"><input type="checkbox" data-engineering-standard-select value="${htmlSafe(record.id)}" ${checked ? 'checked' : ''} onchange="toggleEngineeringStandardSelection('${htmlSafe(record.id)}', this.checked)" class="h-4 w-4 accent-purple-700"></td>
                        <td class="py-4 px-4"><div class="font-black text-slate-700">${htmlSafe(record.id)}</div><div class="text-[10px] text-slate-400">${htmlSafe(record.seedVersion || '')}</div></td>
                        <td class="py-4 px-4"><div class="text-xs font-bold text-slate-600">${htmlSafe(record.sourceCategory)}</div><div class="text-[10px] text-slate-400">${htmlSafe(record.productCategory || '-')}</div></td>
                        <td class="py-4 px-4"><div class="text-xs font-bold text-slate-700 max-w-[260px] truncate" title="${htmlSafe(record.standard)}">${htmlSafe(record.standard)}</div>${sourceLink}</td>
                        <td class="py-4 px-4"><span class="rounded-full border px-2 py-1 text-[10px] font-black ${certificationLevelTone(record.requirementLevel)}">${htmlSafe(record.requirementLevel || '-')}</span></td>
                        <td class="py-4 px-4"><span class="text-xs text-slate-500 max-w-[340px] block truncate" title="${htmlSafe(record.applicabilityCondition)}">${htmlSafe(record.applicabilityCondition || '-')}</span></td>
                        <td class="py-4 px-4 text-xs text-slate-600">${htmlSafe(record.evidenceType || '-')}</td>
                        <td class="py-4 px-4 text-center"><button onclick="openEngineeringCertDetail('${htmlSafe(record.id)}')" class="text-xs font-black text-slate-700 hover:text-purple-700">${linked.length}</button></td>
                        <td class="py-4 px-4 text-center">
                            <div class="inline-flex items-center gap-2">
                                <button onclick="openEngineeringCertDetail('${htmlSafe(record.id)}')" class="text-xs font-black text-slate-700 hover:text-purple-700 hover:underline">Details</button>
                                ${editActions}
                            </div>
                        </td>
                    </tr>
                `;
            }).join('') || '<tr><td colspan="9" class="py-12 text-center text-slate-400 text-sm">No certification records match the current filters.</td></tr>';
            window.applyFrozenColumns('engineering-matrix');
        }
        function engineeringProductMasterFilterValue(id, fallback = 'all') {
            return String(document.getElementById(id)?.value || fallback).trim() || fallback;
        }
        function productMasterDetailValuePresent(value) {
            if (Array.isArray(value)) return value.length > 0;
            if (value && typeof value === 'object') return Object.keys(value).length > 0;
            return String(value ?? '').trim() !== '';
        }
        function productMasterDetailGroupValues(product = {}, groupId = 'all') {
            const group = productMasterDetailGroupDefinition(groupId);
            const md = getProductMasterData(product);
            const tech = getProductTechnicalSpecs(product);
            const sourcing = getProductSourcing(product);
            const certReq = getProductCertificationRequirements(product);
            const values = [
                ...(group.master || []).map(key => md[key]),
                ...(group.technical || []).map(key => tech[key])
            ];
            if ((group.extra || []).includes('certification')) {
                values.push(certReq.recordIds || [], certReq.standards || [], md.certificateLink);
            }
            if ((group.extra || []).includes('commercial')) {
                values.push(sourcing.sourceType, sourcing.commercialSupplierCode, sourcing.factorySupplierCode, sourcing.authorizationStatus, product.leadTime, product.priceBasisUnit, product.cost, product.price);
            }
            if ((group.extra || []).includes('documents')) {
                values.push(md.datasheetLink, md.certificateLink, productMasterAttachedCertFiles(product), productMasterAttachedSpecFiles(product));
            }
            if (groupId === 'all') {
                values.push(product.name, product.category, product.supplierCode, product.spec);
            }
            return values;
        }
        function productMasterDetailGroupStatus(product = {}, groupId = 'all') {
            const values = productMasterDetailGroupValues(product, groupId);
            const total = values.length;
            const filled = values.filter(productMasterDetailValuePresent).length;
            const missing = Math.max(total - filled, 0);
            return {
                label: productMasterDetailGroupLabel(groupId),
                total,
                filled,
                missing,
                complete: total > 0 && missing === 0
            };
        }
        function engineeringProductMasterSearchHaystack(product = {}) {
            const md = getProductMasterData(product);
            const tech = getProductTechnicalSpecs(product);
            const sourcing = getProductSourcing(product);
            const certReq = getProductCertificationRequirements(product);
            const certRecords = productCertificationSelectedRecords(product);
            return [
                product.id, product.name, product.category, product.scenario, product.spec, product.supplierCode, product.vendor,
                ...Object.values(md), ...Object.values(tech), ...Object.values(sourcing),
                ...(certReq.recordIds || []), ...(certReq.standards || []),
                ...certRecords.flatMap(record => [record.id, record.standard, record.requirementLevel, record.sourceCategory])
            ].join(' ').toLowerCase();
        }
        function engineeringProductMasterVisibleProducts() {
            ensureSupplierData();
            const typeView = engineeringProductMasterFilterValue('engineering-product-master-type-filter');
            const detailGroup = engineeringProductMasterFilterValue('engineering-product-master-detail-group');
            const detailState = engineeringProductMasterFilterValue('engineering-product-master-detail-state');
            const certFilter = engineeringProductMasterFilterValue('engineering-product-master-cert-filter');
            const query = String(document.getElementById('engineering-product-master-search')?.value || '').trim().toLowerCase();
            const typeGroup = PRODUCT_TYPE_GROUPS.find(group => group.id === typeView) || PRODUCT_TYPE_GROUPS[0];
            return products.filter(product => {
                if (typeGroup.id !== 'all' && getProductTypeGroup(product).id !== typeGroup.id) return false;
                const detailStatus = productMasterDetailGroupStatus(product, detailGroup);
                if (detailState === 'missing' && detailStatus.missing === 0) return false;
                if (detailState === 'complete' && detailStatus.missing > 0) return false;
                const certStatus = productMasterCertificationStatus(product);
                if (certFilter === 'ready' && certStatus.status !== 'Ready') return false;
                if (certFilter === 'gap' && certStatus.status !== 'Gap') return false;
                if (certFilter === 'none' && certStatus.status !== 'Not Set') return false;
                if (query && !engineeringProductMasterSearchHaystack(product).includes(query)) return false;
                return true;
            });
        }
        function renderEngineeringProductMasterSummary(rows = []) {
            const summary = document.getElementById('engineering-product-master-summary');
            if (!summary) return;
            const detailGroup = engineeringProductMasterFilterValue('engineering-product-master-detail-group');
            const activeCount = rows.filter(product => String(getProductMasterData(product).status || product.status || '').toLowerCase() === 'active').length;
            const missingCount = rows.filter(product => productMasterDetailGroupStatus(product, detailGroup).missing > 0).length;
            const readyCount = rows.filter(product => productMasterCertificationStatus(product).status === 'Ready').length;
            summary.innerHTML = [
                ['Products', rows.length],
                ['Active', activeCount],
                ['Missing Details', missingCount],
                ['Cert Ready', readyCount]
            ].map(([label, value]) => `<div class="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2"><div class="text-[10px] font-black uppercase text-slate-400">${label}</div><div class="text-lg font-black text-slate-800">${value}</div></div>`).join('');
        }
        function setEngineeringProductMasterMode(mode = 'product') {
            engineeringProductMasterMode = mode === 'detail' ? 'detail' : 'product';
            syncEngineeringProductMasterModeChrome();
            if (engineeringWorkspaceView === 'productMaster') renderEngineeringWorkspace();
        }
        function syncEngineeringProductMasterModeChrome() {
            const productPanel = document.getElementById('engineering-product-master-product-mode-panel');
            const detailPanel = document.getElementById('engineering-product-master-detail-mode-panel');
            const productBtn = document.getElementById('engineering-product-master-mode-product');
            const detailBtn = document.getElementById('engineering-product-master-mode-detail');
            if (productPanel) productPanel.classList.toggle('hidden', engineeringProductMasterMode !== 'product');
            if (detailPanel) detailPanel.classList.toggle('hidden', engineeringProductMasterMode !== 'detail');
            if (productBtn) productBtn.className = engineeringProductMasterMode === 'product' ? 'px-4 py-2 rounded-lg text-xs font-black bg-slate-900 text-white' : 'px-4 py-2 rounded-lg text-xs font-black text-slate-500';
            if (detailBtn) detailBtn.className = engineeringProductMasterMode === 'detail' ? 'px-4 py-2 rounded-lg text-xs font-black bg-slate-900 text-white' : 'px-4 py-2 rounded-lg text-xs font-black text-slate-500';
        }
        window.setEngineeringProductMasterMode = setEngineeringProductMasterMode;
        function saveProductMasterDetailTemplate(template = {}) {
            const normalized = normalizeProductMasterDetailTemplate(template);
            const idx = productMasterDetailTemplates.findIndex(item => item.id === normalized.id);
            if (idx >= 0) productMasterDetailTemplates[idx] = normalized;
            else productMasterDetailTemplates.push(normalized);
            productMasterDetailTemplates = normalizeProductMasterDetailTemplates(productMasterDetailTemplates);
            saveToLocal();
            persistEntityToD1('product_master_detail_template', normalized.id, normalized);
            return normalized;
        }
        function currentProductMasterDetailTemplate() {
            const category = document.getElementById('engineering-detail-template-category')?.value || 'PV Module';
            const detailGroup = normalizeProductMasterDetailGroupKey(document.getElementById('engineering-detail-template-group')?.value || 'basic');
            return getProductMasterDetailTemplate(category, detailGroup);
        }
        function resetProductMasterDetailFieldForm(template = currentProductMasterDetailTemplate()) {
            const form = document.getElementById('engineering-detail-template-field-form');
            const nameInput = document.getElementById('engineering-detail-template-field-name');
            const targetGroup = document.getElementById('engineering-detail-template-target-group');
            const customGroup = document.getElementById('engineering-detail-template-custom-group');
            const button = document.getElementById('engineering-detail-template-add-field');
            const save = document.getElementById('engineering-detail-template-save-field');
            if (form) {
                form.dataset.mode = 'add';
                form.dataset.editFieldKey = '';
                form.classList.add('hidden');
            }
            if (nameInput) nameInput.value = '';
            if (targetGroup) {
                targetGroup.disabled = false;
                targetGroup.innerHTML = productMasterDetailGroupSelectOptions(template.detailGroup, { includeNew: true });
                targetGroup.value = normalizeProductMasterDetailGroupKey(template.detailGroup);
            }
            if (customGroup) {
                customGroup.value = '';
                customGroup.classList.add('hidden');
            }
            if (button) button.textContent = 'Add Field';
            if (save) save.textContent = 'Save Field';
        }
        window.cancelProductMasterDetailTemplateFieldEdit = () => resetProductMasterDetailFieldForm();
        function syncProductMasterDetailTargetGroupUi() {
            const targetGroup = document.getElementById('engineering-detail-template-target-group');
            const customGroup = document.getElementById('engineering-detail-template-custom-group');
            const isCustom = targetGroup?.value === PRODUCT_MASTER_DETAIL_NEW_GROUP_VALUE;
            if (customGroup) {
                customGroup.classList.toggle('hidden', !isCustom);
                if (isCustom) customGroup.focus();
            }
        }
        window.syncProductMasterDetailTargetGroupUi = syncProductMasterDetailTargetGroupUi;
        function beginProductMasterDetailTemplateFieldAdd() {
            if (!canManageEngineeringRecord('edit')) return alert('No engineering edit permission.');
            const template = currentProductMasterDetailTemplate();
            const form = document.getElementById('engineering-detail-template-field-form');
            const nameInput = document.getElementById('engineering-detail-template-field-name');
            const targetGroup = document.getElementById('engineering-detail-template-target-group');
            const customGroup = document.getElementById('engineering-detail-template-custom-group');
            const save = document.getElementById('engineering-detail-template-save-field');
            if (!form || !nameInput || !targetGroup) return;
            form.dataset.mode = 'add';
            form.dataset.editFieldKey = '';
            form.classList.remove('hidden');
            nameInput.value = '';
            targetGroup.disabled = false;
            targetGroup.innerHTML = productMasterDetailGroupSelectOptions(template.detailGroup, { includeNew: true });
            targetGroup.value = normalizeProductMasterDetailGroupKey(template.detailGroup);
            if (customGroup) {
                customGroup.value = '';
                customGroup.classList.add('hidden');
            }
            if (save) save.textContent = 'Save Field';
            nameInput.focus();
        }
        window.beginProductMasterDetailTemplateFieldAdd = beginProductMasterDetailTemplateFieldAdd;
        function beginProductMasterDetailTemplateFieldEdit(fieldKey = '') {
            if (!canManageEngineeringRecord('edit')) return alert('No engineering edit permission.');
            const template = currentProductMasterDetailTemplate();
            const form = document.getElementById('engineering-detail-template-field-form');
            const nameInput = document.getElementById('engineering-detail-template-field-name');
            const targetGroup = document.getElementById('engineering-detail-template-target-group');
            const customGroup = document.getElementById('engineering-detail-template-custom-group');
            const save = document.getElementById('engineering-detail-template-save-field');
            if (!form || !nameInput || !targetGroup) return;
            form.dataset.mode = 'edit';
            form.dataset.editFieldKey = fieldKey;
            form.classList.remove('hidden');
            nameInput.value = productMasterDetailTemplateFieldLabel(fieldKey, template);
            targetGroup.innerHTML = productMasterDetailGroupSelectOptions(template.detailGroup, { includeNew: false });
            targetGroup.value = normalizeProductMasterDetailGroupKey(template.detailGroup);
            targetGroup.disabled = true;
            if (customGroup) customGroup.classList.add('hidden');
            if (save) save.textContent = 'Save Name';
            nameInput.focus();
            nameInput.select();
            renderEngineeringProductMasterDetailBulkList(template);
        }
        window.beginProductMasterDetailTemplateFieldEdit = beginProductMasterDetailTemplateFieldEdit;
        function renderEngineeringProductMasterDetailFields(template) {
            const box = document.getElementById('engineering-detail-template-fields');
            if (!box) return;
            resetProductMasterDetailFieldForm(template);
            const groupLabel = productMasterDetailGroupLabel(template.detailGroup);
            box.innerHTML = (template.fieldKeys || []).map(key => {
                return `<div class="flex items-center justify-between gap-3 px-4 py-3">
                    <div class="min-w-0">
                        <div class="text-xs font-black text-slate-700">${htmlSafe(productMasterDetailTemplateFieldLabel(key, template))}</div>
                        <div class="text-[10px] text-slate-400">${htmlSafe(key)} · ${htmlSafe(template.category)} · ${htmlSafe(groupLabel)}</div>
                    </div>
                    <div class="flex items-center gap-2">
                        <button type="button" data-engineering-action="edit" onclick="beginProductMasterDetailTemplateFieldEdit('${htmlSafe(key)}')" class="text-xs font-black text-purple-700 hover:underline">Edit</button>
                        <button type="button" data-engineering-action="delete" onclick="deleteProductMasterDetailTemplateField('${htmlSafe(key)}')" class="text-xs font-black text-red-600 hover:underline">Delete</button>
                    </div>
                </div>`;
            }).join('') || '<div class="p-6 text-center text-xs text-slate-400">No fields in this template yet.</div>';
        }
        function productsForProductMasterDetailTemplate(template) {
            return products.filter(product => normalizeProductCategory(product.category, '') === template.category);
        }
        function productMasterDetailSafeDomId(value = '') {
            return String(value || 'detail')
                .toLowerCase()
                .replace(/[^a-z0-9_-]+/g, '-')
                .replace(/^-+|-+$/g, '')
                .slice(0, 80) || 'detail';
        }
        function productMasterDetailFieldDatalistId(template = {}, fieldKey = '') {
            return `engineering-detail-values-${productMasterDetailSafeDomId(`${template.id || 'template'}-${fieldKey}`)}`;
        }
        function productMasterDetailFieldValueOptions(template = {}, fieldKey = '') {
            return uniqueCertList(productsForProductMasterDetailTemplate(template)
                .map(product => productMasterDetailValue(product, template.category, fieldKey))
                .filter(productMasterDetailValuePresent));
        }
        function productMasterDetailHiddenHistoryKey(template = {}, fieldKey = '') {
            const templateId = String(template?.id || productMasterDetailTemplateId(template?.category, template?.detailGroup)).trim() || 'template';
            return `${templateId}::${String(fieldKey || '').trim()}`;
        }
        function readProductMasterDetailHiddenHistory() {
            try {
                const parsed = JSON.parse(localStorage.getItem(PRODUCT_MASTER_DETAIL_HISTORY_HIDDEN_STORAGE_KEY) || '{}');
                return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
            } catch (e) {
                return {};
            }
        }
        function writeProductMasterDetailHiddenHistory(map = {}) {
            try { localStorage.setItem(PRODUCT_MASTER_DETAIL_HISTORY_HIDDEN_STORAGE_KEY, JSON.stringify(map || {})); } catch (e) {}
        }
        function productMasterDetailHiddenHistorySet(template = {}, fieldKey = '') {
            const hidden = readProductMasterDetailHiddenHistory()[productMasterDetailHiddenHistoryKey(template, fieldKey)] || [];
            return new Set((Array.isArray(hidden) ? hidden : []).map(value => String(value || '').trim().toLowerCase()).filter(Boolean));
        }
        function renderProductMasterDetailHistoryInputControl({
            inputId = '',
            value = '',
            choices = [],
            commonAttrs = '',
            placeholder = '',
            inputClass = '',
            template = {},
            fieldKey = '',
            disabled = false,
            inputType = 'text',
            extraAttrs = '',
            onInput = '',
            onChange = ''
        } = {}) {
            const hiddenChoices = productMasterDetailHiddenHistorySet(template, fieldKey);
            const rawChoices = Array.from(new Set([...(Array.isArray(choices) ? choices : []), value].map(option => String(option ?? '').trim()).filter(Boolean)));
            const visibleChoices = rawChoices.filter(choice => !hiddenChoices.has(choice.toLowerCase()));
            const hasHistoryChoices = rawChoices.length > 0 && !disabled;
            const resolvedInputId = inputId || `engineering-detail-history-${productMasterDetailSafeDomId(`${template.id || 'template'}-${fieldKey}`)}`;
            const baseClass = inputClass || 'w-full min-w-[160px] border border-slate-200 rounded-lg px-2 py-2 text-xs outline-none focus:border-purple-500 bg-white';
            const onInputAttr = [hasHistoryChoices ? 'filterProductMasterDetailBulkHistoryValues(this)' : '', onInput].filter(Boolean).join('; ');
            const onChangeAttr = String(onChange || '').trim();
            const input = `<input id="${htmlSafe(resolvedInputId)}" type="${htmlSafe(inputType)}" ${commonAttrs} value="${htmlSafe(value)}" placeholder="${htmlSafe(placeholder)}" ${disabled ? 'disabled' : ''} ${onInputAttr ? `oninput="${htmlSafe(onInputAttr)}"` : ''} ${onChangeAttr ? `onchange="${htmlSafe(onChangeAttr)}"` : ''} ${extraAttrs} class="${htmlSafe(baseClass)} ${visibleChoices.length && !disabled ? 'pr-8' : ''}">`;
            if (!disabled && visibleChoices.length) {
                return `<div class="relative min-w-[220px]">
                    ${input}
                    <button type="button" data-engineering-detail-history-target="${htmlSafe(resolvedInputId)}" onclick="toggleProductMasterDetailBulkHistoryMenu(this)" title="Show history values" class="absolute right-1 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-md hover:bg-slate-100">
                        <span aria-hidden="true" class="inline-block h-0 w-0 border-l-[4px] border-r-[4px] border-t-[6px] border-l-transparent border-r-transparent border-t-slate-700"></span>
                    </button>
                    <div data-engineering-detail-history-menu="${htmlSafe(resolvedInputId)}" class="hidden absolute right-0 top-full z-30 mt-1 max-h-44 min-w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
                        ${visibleChoices.map(choice => `<div data-engineering-detail-history-option data-engineering-detail-history-value="${htmlSafe(choice)}" class="flex items-center border-b border-slate-50 last:border-b-0">
                            <button type="button" data-engineering-detail-history-target="${htmlSafe(resolvedInputId)}" data-engineering-detail-history-value="${htmlSafe(choice)}" onclick="applyProductMasterDetailBulkHistoryValue(this)" class="min-w-0 flex-1 px-3 py-2 text-left text-xs font-bold text-slate-600 hover:bg-slate-50">${htmlSafe(choice)}</button>
                            <button type="button" data-engineering-detail-history-delete data-engineering-detail-history-target="${htmlSafe(resolvedInputId)}" data-engineering-detail-history-template="${htmlSafe(template.id || '')}" data-engineering-detail-history-field="${htmlSafe(fieldKey)}" data-engineering-detail-history-value="${htmlSafe(choice)}" onclick="deleteProductMasterDetailBulkHistoryValue(this)" title="Delete history value" class="px-3 py-2 text-[10px] font-black text-red-600 hover:bg-red-50">Delete</button>
                        </div>`).join('')}
                        <div data-engineering-detail-history-empty class="hidden px-3 py-2 text-xs font-bold text-slate-400">No matching history values.</div>
                    </div>
                </div>`;
            }
            return input;
        }
        function renderProductMasterDetailBulkEditorControl(product = {}, template = {}, fieldKey = '') {
            const value = String(productMasterDetailValue(product, template.category, fieldKey) ?? '');
            const disabled = productMasterDetailFieldKind(template.category, fieldKey) === 'previewOnly';
            const datalistId = productMasterDetailFieldDatalistId(template, fieldKey);
            const options = productMasterDetailFieldValueOptions(template, fieldKey);
            const rawChoices = Array.from(new Set([...options, value].map(option => String(option ?? '').trim()).filter(Boolean)));
            const inputId = `engineering-detail-bulk-${productMasterDetailSafeDomId(`${template.id || 'template'}-${product.id || 'product'}-${fieldKey}`)}`;
            const commonAttrs = `data-engineering-detail-product="${htmlSafe(product.id || '')}" data-engineering-detail-field="${htmlSafe(fieldKey)}" data-engineering-detail-template-field="${htmlSafe(fieldKey)}" data-engineering-detail-value-options="${htmlSafe(datalistId)}"`;
            return renderProductMasterDetailHistoryInputControl({
                inputId,
                value,
                choices: rawChoices,
                commonAttrs,
                template,
                fieldKey,
                disabled,
                inputClass: `w-full min-w-[160px] border border-slate-200 rounded-lg px-2 py-2 text-xs outline-none focus:border-purple-500 ${disabled ? 'bg-slate-50 text-slate-400' : 'bg-white'}`
            });
        }
        function toggleProductMasterDetailBulkHistoryMenu(button) {
            const targetId = button?.dataset?.engineeringDetailHistoryTarget || '';
            const menu = document.querySelector(`[data-engineering-detail-history-menu="${CSS.escape(targetId)}"]`);
            if (!menu) return;
            document.querySelectorAll('[data-engineering-detail-history-menu]').forEach(item => {
                if (item !== menu) item.classList.add('hidden');
            });
            menu.classList.toggle('hidden');
        }
        window.toggleProductMasterDetailBulkHistoryMenu = toggleProductMasterDetailBulkHistoryMenu;
        function filterProductMasterDetailBulkHistoryValues(input) {
            const inputId = input?.id || '';
            if (!inputId) return;
            const menu = document.querySelector(`[data-engineering-detail-history-menu="${CSS.escape(inputId)}"]`);
            if (!menu) return;
            const query = String(input.value || '').trim().toLowerCase();
            let shown = 0;
            menu.querySelectorAll('[data-engineering-detail-history-option]').forEach(option => {
                const valueText = String(option.dataset.engineeringDetailHistoryValue || '').toLowerCase();
                const match = !query || valueText.includes(query);
                option.classList.toggle('hidden', !match);
                if (match) shown += 1;
            });
            const empty = menu.querySelector('[data-engineering-detail-history-empty]');
            if (empty) empty.classList.toggle('hidden', shown > 0);
            menu.classList.toggle('hidden', !(query && shown > 0));
        }
        window.filterProductMasterDetailBulkHistoryValues = filterProductMasterDetailBulkHistoryValues;
        function applyProductMasterDetailBulkHistoryValue(button) {
            const target = document.getElementById(button?.dataset?.engineeringDetailHistoryTarget || '');
            const value = button?.dataset?.engineeringDetailHistoryValue || '';
            if (!target || !value) return;
            target.value = value;
            try { target.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
            document.querySelectorAll('[data-engineering-detail-history-menu]').forEach(item => item.classList.add('hidden'));
        }
        window.applyProductMasterDetailBulkHistoryValue = applyProductMasterDetailBulkHistoryValue;
        function deleteProductMasterDetailBulkHistoryValue(button) {
            const targetId = button?.dataset?.engineeringDetailHistoryTarget || '';
            const templateId = String(button?.dataset?.engineeringDetailHistoryTemplate || '').trim();
            const fieldKey = String(button?.dataset?.engineeringDetailHistoryField || '').trim();
            const value = String(button?.dataset?.engineeringDetailHistoryValue || '').trim();
            if (!templateId || !fieldKey || !value) return;
            if (!confirm(`Delete history value "${value}" from this field? Product data will not be changed.`)) return;
            const key = `${templateId}::${fieldKey}`;
            const map = readProductMasterDetailHiddenHistory();
            const hidden = new Set((Array.isArray(map[key]) ? map[key] : []).map(item => String(item || '').trim().toLowerCase()).filter(Boolean));
            hidden.add(value.toLowerCase());
            map[key] = Array.from(hidden);
            writeProductMasterDetailHiddenHistory(map);
            const option = button.closest('[data-engineering-detail-history-option]');
            if (option) option.remove();
            const input = document.getElementById(targetId);
            if (input) filterProductMasterDetailBulkHistoryValues(input);
        }
        window.deleteProductMasterDetailBulkHistoryValue = deleteProductMasterDetailBulkHistoryValue;
        function renderEngineeringProductMasterDetailBulkList(template) {
            const box = document.getElementById('engineering-detail-template-bulk-list');
            const scope = document.getElementById('engineering-detail-template-bulk-scope');
            if (!box) return;
            const rows = productsForProductMasterDetailTemplate(template);
            const fields = template.fieldKeys || [];
            if (scope) {
                scope.textContent = `Bulk Product Maintenance is editing ${template.category} / ${productMasterDetailGroupLabel(template.detailGroup)} for ${rows.length} product${rows.length === 1 ? '' : 's'}.`;
            }
            if (!rows.length) {
                box.innerHTML = `<div class="p-6 text-center text-xs text-slate-400">No products found for ${htmlSafe(template.category)}. Use Add Product to create one.</div>`;
                return;
            }
            const datalists = fields.map(key => {
                const datalistId = productMasterDetailFieldDatalistId(template, key);
                const options = productMasterDetailFieldValueOptions(template, key);
                return `<datalist id="${htmlSafe(datalistId)}">${options.map(value => `<option value="${htmlSafe(value)}"></option>`).join('')}</datalist>`;
            }).join('');
            const head = ['Product', ...fields.map(key => productMasterDetailTemplateFieldLabel(key, template))].map((label, index) => `<th class="py-3 px-3">${index === 0 ? `<div class="flex flex-col items-start gap-1"><span>${htmlSafe(label)}</span>${renderFreezeColumnButton('engineering-detail-bulk', 3)}</div>` : htmlSafe(label)}</th>`).join('');
            const body = rows.map(product => `<tr data-engineering-detail-product-row="${htmlSafe(product.id || '')}" class="hover:bg-slate-50 transition-colors">
                <td class="py-3 px-3 align-top">
                    <div class="font-black text-slate-700">${htmlSafe(product.id || '-')}</div>
                    <div class="text-[10px] text-slate-400 max-w-[180px] truncate" title="${htmlSafe(productListDisplayText(product.name))}">${htmlSafe(productListDisplayText(product.name))}</div>
                </td>
                ${fields.map(key => {
                    return `<td class="py-3 px-3 align-top">
                        ${renderProductMasterDetailBulkEditorControl(product, template, key)}
                    </td>`;
                }).join('')}
            </tr>`).join('');
            box.innerHTML = `${datalists}<table data-freeze-table="engineering-detail-bulk" class="w-full min-w-[980px] text-left whitespace-nowrap">
                <thead class="bg-slate-50/70"><tr class="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">${head}</tr></thead>
                <tbody class="divide-y divide-slate-50">${body}</tbody>
            </table>`;
            window.applyFrozenColumns('engineering-detail-bulk');
        }
        function renderEngineeringProductMasterDetailMode() {
            const selectedGroup = document.getElementById('engineering-detail-template-group')?.value || 'basic';
            syncProductMasterDetailSelectOptions('engineering-detail-template-group', selectedGroup, { includeNew: false });
            const template = currentProductMasterDetailTemplate();
            renderEngineeringProductMasterDetailFields(template);
            renderEngineeringProductMasterDetailBulkList(template);
            applyEngineeringPermissions();
        }
        window.renderEngineeringProductMasterDetailMode = renderEngineeringProductMasterDetailMode;
        function addProductMasterDetailTemplateField() {
            return beginProductMasterDetailTemplateFieldAdd();
        }
        window.addProductMasterDetailTemplateField = addProductMasterDetailTemplateField;
        function saveProductMasterDetailTemplateFieldForm() {
            if (!canManageEngineeringRecord('edit')) return alert('No engineering edit permission.');
            const form = document.getElementById('engineering-detail-template-field-form');
            const nameInput = document.getElementById('engineering-detail-template-field-name');
            const targetGroup = document.getElementById('engineering-detail-template-target-group');
            const customGroup = document.getElementById('engineering-detail-template-custom-group');
            const editFieldKey = String(form?.dataset?.editFieldKey || '').trim();
            const label = String(nameInput?.value || '').trim();
            if (!label) return alert('Field name is required.');
            if (editFieldKey) return saveProductMasterDetailTemplateFieldLabel(editFieldKey);
            const currentTemplate = currentProductMasterDetailTemplate();
            let detailGroup = normalizeProductMasterDetailGroupKey(targetGroup?.value || currentTemplate.detailGroup || 'basic');
            let detailGroupLabel = '';
            if (targetGroup?.value === PRODUCT_MASTER_DETAIL_NEW_GROUP_VALUE) {
                detailGroupLabel = String(customGroup?.value || '').trim();
                if (!detailGroupLabel) return alert('Custom group name is required.');
                detailGroup = normalizeProductMasterDetailGroupKey(detailGroupLabel);
            }
            const targetTemplate = getProductMasterDetailTemplate(currentTemplate.category, detailGroup);
            const fieldKey = nextProductMasterDetailCustomFieldKey(targetTemplate);
            const fieldKeys = [...(targetTemplate.fieldKeys || []), fieldKey];
            const fieldLabels = { ...(targetTemplate.fieldLabels || {}), [fieldKey]: label };
            const next = saveProductMasterDetailTemplate({
                ...targetTemplate,
                detailGroup,
                detailGroupLabel: detailGroupLabel || targetTemplate.detailGroupLabel || '',
                fieldKeys,
                fieldLabels,
                updatedAt: new Date().toISOString()
            });
            syncProductMasterDetailSelectOptions('engineering-detail-template-group', detailGroup, { includeNew: false });
            const groupSelect = document.getElementById('engineering-detail-template-group');
            if (groupSelect) groupSelect.value = detailGroup;
            renderEngineeringProductMasterDetailMode();
            return next;
        }
        window.saveProductMasterDetailTemplateFieldForm = saveProductMasterDetailTemplateFieldForm;
        window.editProductMasterDetailTemplateField = beginProductMasterDetailTemplateFieldEdit;
        function saveProductMasterDetailTemplateFieldLabel(fieldKey = '') {
            if (!canManageEngineeringRecord('edit')) return alert('No engineering edit permission.');
            const template = currentProductMasterDetailTemplate();
            const key = String(fieldKey || '').trim();
            if (!key || !(template.fieldKeys || []).includes(key)) return;
            const nameInput = document.getElementById('engineering-detail-template-field-name');
            const label = String(nameInput?.value || '').trim();
            if (!label) return alert('Field name is required.');
            const defaultLabel = productMasterDetailFieldLabel(key);
            const fieldLabels = { ...(template.fieldLabels || {}) };
            if (label === defaultLabel) delete fieldLabels[key];
            else fieldLabels[key] = label;
            const next = saveProductMasterDetailTemplate({ ...template, fieldLabels, updatedAt: new Date().toISOString() });
            renderEngineeringProductMasterDetailMode();
            return next;
        }
        window.saveProductMasterDetailTemplateFieldLabel = saveProductMasterDetailTemplateFieldLabel;
        function deleteProductMasterDetailTemplateField(fieldKey = '') {
            if (!canManageEngineeringRecord('delete')) return alert('No engineering delete permission.');
            const template = currentProductMasterDetailTemplate();
            if (!confirm(`Delete ${fieldKey} from this template?`)) return;
            const fieldKeys = (template.fieldKeys || []).filter(key => key !== fieldKey);
            const fieldLabels = { ...(template.fieldLabels || {}) };
            delete fieldLabels[fieldKey];
            if (!fieldKeys.length) {
                productMasterDetailTemplates = productMasterDetailTemplates.filter(item => item.id !== template.id);
                saveToLocal();
                deleteEntityFromD1('product_master_detail_template', template.id);
            } else {
                saveProductMasterDetailTemplate({ ...template, fieldKeys, fieldLabels, updatedAt: new Date().toISOString() });
            }
            renderEngineeringProductMasterDetailMode();
        }
        window.deleteProductMasterDetailTemplateField = deleteProductMasterDetailTemplateField;
        function previewEngineeringProductMasterBulkSave() {
            if (!canManageEngineeringRecord('edit')) return alert('No engineering edit permission.');
            const template = currentProductMasterDetailTemplate();
            const changes = [];
            document.querySelectorAll('#engineering-detail-template-bulk-list input[data-engineering-detail-product]').forEach(input => {
                if (input.disabled) return;
                const product = products.find(item => String(item.id || '') === input.dataset.engineeringDetailProduct);
                const fieldKey = input.dataset.engineeringDetailTemplateField || input.dataset.engineeringDetailField || '';
                if (!product || !fieldKey) return;
                const before = String(productMasterDetailValue(product, template.category, fieldKey) ?? '');
                const after = String(input.value ?? '').trim();
                if (before !== after) changes.push({ product, fieldKey, before, after });
            });
            if (!changes.length) return alert('No product detail changes to save.');
            const preview = changes.slice(0, 12).map(change => `${change.product.id} · ${change.fieldKey}: ${change.before || '-'} -> ${change.after || '-'}`).join('\n');
            if (!confirm(`Preview ${changes.length} product detail changes:\n\n${preview}${changes.length > 12 ? '\n...' : ''}\n\nSave these changes?`)) return;
            const touched = new Set();
            changes.forEach(change => {
                if (setProductMasterDetailValue(change.product, template.category, change.fieldKey, change.after)) touched.add(change.product.id);
            });
            saveToLocal();
            products.filter(product => touched.has(product.id)).forEach(product => persistEntityToD1('product', product.id, product));
            renderEngineeringProductMasterDetailMode();
        }
        window.previewEngineeringProductMasterBulkSave = previewEngineeringProductMasterBulkSave;
        function addEngineeringDetailModeProduct() {
            if (!canManageEngineeringRecord('edit')) return alert('No engineering edit permission.');
            const category = document.getElementById('engineering-detail-template-category')?.value || 'PV Module';
            openModal();
            setTimeout(() => {
                const cat = document.getElementById('m-category');
                if (cat) {
                    cat.value = category;
                    try { window.onCategoryChange?.(); } catch (e) {}
                    try { window.renderProductTechnicalFields?.(category, {}); } catch (e) {}
                }
            }, 0);
        }
        window.addEngineeringDetailModeProduct = addEngineeringDetailModeProduct;
        function openEngineeringDetailProductSearch() {
            if (!canManageEngineeringRecord('edit')) return alert('No engineering edit permission.');
            const modal = document.getElementById('engineering-detail-product-search-modal');
            const categorySelect = document.getElementById('engineering-detail-product-search-category');
            const groupSelect = document.getElementById('engineering-detail-product-search-group');
            if (categorySelect) categorySelect.value = document.getElementById('engineering-detail-template-category')?.value || 'PV Module';
            if (groupSelect) {
                const selectedGroup = document.getElementById('engineering-detail-template-group')?.value || 'basic';
                groupSelect.innerHTML = productMasterDetailGroupSelectOptions(selectedGroup, { includeNew: false });
                groupSelect.value = normalizeProductMasterDetailGroupKey(selectedGroup);
            }
            if (modal) {
                modal.classList.remove('hidden');
                modal.classList.add('flex');
            }
            loadEngineeringQuoteDefaultsToUi();
            renderEngineeringDetailProductSearchCriteria();
        }
        window.openEngineeringDetailProductSearch = openEngineeringDetailProductSearch;
        function closeEngineeringDetailProductSearch() {
            const modal = document.getElementById('engineering-detail-product-search-modal');
            if (!modal) return;
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
        window.closeEngineeringDetailProductSearch = closeEngineeringDetailProductSearch;
        function engineeringDetailProductSearchTemplate() {
            const category = document.getElementById('engineering-detail-product-search-category')?.value || 'PV Module';
            const detailGroup = document.getElementById('engineering-detail-product-search-group')?.value || 'basic';
            return getProductMasterDetailTemplate(category, detailGroup);
        }
        window.engineeringDetailProductSearchTemplate = engineeringDetailProductSearchTemplate;
        function parseEngineeringDetailNumber(value = '') {
            const match = String(value ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
            return match ? Number(match[0]) : NaN;
        }
        window.parseEngineeringDetailNumber = parseEngineeringDetailNumber;
        function isEngineeringDetailNumberField(template = {}, fieldKey = '') {
            const label = productMasterDetailTemplateFieldLabel(fieldKey, template);
            const token = `${fieldKey} ${label}`.toLowerCase();
            if (/\b(phase|status|country|brand|series|model|cooling|mounting|installation|indoor|outdoor|certificate|datasheet|remark)\b/.test(token)) return false;
            if (/(kw|kwh|power|capacity|energy|efficiency|voltage|current|range|qty|quantity|weight|dimension|temperature|temp|mm|kg|%|\bw\b|\bv\b|\ba\b)/i.test(token)) return true;
            const options = productMasterDetailFieldValueOptions(template, fieldKey);
            return options.length > 0 && options.every(value => Number.isFinite(parseEngineeringDetailNumber(value)));
        }
        function renderEngineeringDetailProductSearchCriteria(template = engineeringDetailProductSearchTemplate()) {
            const box = document.getElementById('engineering-detail-product-search-criteria');
            const results = document.getElementById('engineering-detail-product-search-results');
            if (!box) return;
            const fields = template.fieldKeys || [];
            box.innerHTML = fields.map(fieldKey => {
                const label = productMasterDetailTemplateFieldLabel(fieldKey, template);
                const safeKey = htmlSafe(fieldKey);
                if (isEngineeringDetailNumberField(template, fieldKey)) {
                    return `<div data-engineering-detail-search-field="${safeKey}" data-engineering-detail-search-kind="number" class="rounded-2xl border border-slate-200 p-3">
                        <label class="block text-[10px] font-black text-slate-400 uppercase mb-2">${htmlSafe(label)}</label>
                        <div class="grid grid-cols-2 gap-2">
                            <input data-engineering-detail-search-min="${safeKey}" type="number" step="any" placeholder="Min" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-purple-500">
                            <input data-engineering-detail-search-max="${safeKey}" type="number" step="any" placeholder="Max" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-purple-500">
                        </div>
                    </div>`;
                }
                const options = productMasterDetailFieldValueOptions(template, fieldKey);
                const inputId = `engineering-detail-search-${productMasterDetailSafeDomId(`${template.id || 'template'}-${fieldKey}`)}`;
                const input = renderProductMasterDetailHistoryInputControl({
                    inputId,
                    value: '',
                    choices: options,
                    commonAttrs: `data-engineering-detail-search-value="${safeKey}" data-engineering-detail-template-field="${safeKey}"`,
                    placeholder: 'Any',
                    template,
                    fieldKey,
                    inputClass: 'w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-purple-500 bg-white'
                });
                return `<div data-engineering-detail-search-field="${safeKey}" data-engineering-detail-search-kind="text" class="rounded-2xl border border-slate-200 p-3">
                    <label class="block text-[10px] font-black text-slate-400 uppercase mb-2">${htmlSafe(label)}</label>
                    ${input}
                </div>`;
            }).join('') || '<div class="md:col-span-2 rounded-2xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">No fields in this template yet.</div>';
            if (results) results.innerHTML = '<div class="p-6 text-center text-xs text-slate-400">Fill detail conditions, then search products.</div>';
        }
        window.renderEngineeringDetailProductSearchCriteria = renderEngineeringDetailProductSearchCriteria;
        function readEngineeringDetailProductSearchFilters() {
            const filters = [];
            let invalidMessage = '';
            document.querySelectorAll('#engineering-detail-product-search-criteria [data-engineering-detail-search-field]').forEach(row => {
                const fieldKey = row.dataset.engineeringDetailSearchField || '';
                const kind = row.dataset.engineeringDetailSearchKind || 'text';
                if (!fieldKey) return;
                if (kind === 'number') {
                    const minText = row.querySelector('[data-engineering-detail-search-min]')?.value || '';
                    const maxText = row.querySelector('[data-engineering-detail-search-max]')?.value || '';
                    if (!minText && !maxText) return;
                    const min = minText ? Number(minText) : null;
                    const max = maxText ? Number(maxText) : null;
                    if ((minText && !Number.isFinite(min)) || (maxText && !Number.isFinite(max))) {
                        invalidMessage = 'Please enter valid numeric ranges.';
                        return;
                    }
                    if (min !== null && max !== null && min > max) {
                        invalidMessage = 'Min value cannot be greater than Max value.';
                        return;
                    }
                    filters.push({ fieldKey, kind, min, max });
                    return;
                }
                const input = row.querySelector('[data-engineering-detail-search-value]');
                const value = String(input?.value || '').trim();
                if (!value) return;
                const options = Array.from(row.querySelectorAll('[data-engineering-detail-history-option]')).map(option => String(option.dataset.engineeringDetailHistoryValue || '').trim().toLowerCase()).filter(Boolean);
                filters.push({ fieldKey, kind: 'text', value, exact: options.includes(value.toLowerCase()) });
            });
            return { filters, invalidMessage };
        }
        window.readEngineeringDetailProductSearchFilters = readEngineeringDetailProductSearchFilters;
        function productMatchesEngineeringDetailFilters(product = {}, template = {}, filters = []) {
            return filters.every(filter => {
                const raw = productMasterDetailValue(product, template.category, filter.fieldKey);
                if (filter.kind === 'number') {
                    const value = parseEngineeringDetailNumber(raw);
                    if (!Number.isFinite(value)) return false;
                    if (filter.min !== null && value < filter.min) return false;
                    if (filter.max !== null && value > filter.max) return false;
                    return true;
                }
                const productText = String(raw ?? '').trim().toLowerCase();
                const target = String(filter.value ?? '').trim().toLowerCase();
                if (!target || !productText) return false;
                return filter.exact ? productText === target : productText.includes(target);
            });
        }
        window.productMatchesEngineeringDetailFilters = productMatchesEngineeringDetailFilters;
        function renderEngineeringDetailProductSearchResults(matches = [], template = engineeringDetailProductSearchTemplate(), filters = []) {
            const box = document.getElementById('engineering-detail-product-search-results');
            if (!box) return;
            const fields = template.fieldKeys || [];
            if (!filters.length) {
                box.innerHTML = '<div class="p-6 text-center text-xs text-slate-400">Fill at least one detail condition, then search products.</div>';
                return;
            }
            if (!matches.length) {
                box.innerHTML = '<div class="p-8 text-center"><div class="text-sm font-black text-slate-700">Unable to find products matching every selected detail condition.</div><div class="mt-2 text-xs text-slate-400">Adjust category, details group, or numeric range.</div></div>';
                return;
            }
            box.innerHTML = matches.map(product => {
                const stock = getTotalStockQty(product.id);
                const firstBatch = getFifoBatchesForProduct(product.id)[0];
                const supplier = getProductSupplierDisplay(product);
                const previewFields = filters.map(filter => filter.fieldKey).concat(fields).filter((fieldKey, index, list) => list.indexOf(fieldKey) === index).slice(0, 5);
                const preview = previewFields.map(fieldKey => {
                    const value = productMasterDetailValue(product, template.category, fieldKey);
                    return value ? `${productMasterDetailTemplateFieldLabel(fieldKey, template)}: ${value}` : '';
                }).filter(Boolean).join(' · ');
                return `<div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 p-4">
                    <div class="min-w-0">
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="font-black text-slate-800">${htmlSafe(product.id || '-')}</span>
                            <span class="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-500">${htmlSafe(normalizeProductCategory(product.category || '-'))}</span>
                            <span class="rounded-full ${stock > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'} px-2 py-1 text-[10px] font-black">Stock ${formatNumberAuto(stock, 4)}</span>
                        </div>
                        <div class="mt-1 text-sm font-bold text-slate-700 truncate">${htmlSafe(productListDisplayText(product.name))}</div>
                        <div class="text-[11px] text-slate-400 truncate">${htmlSafe(supplier)} · ${firstBatch ? `FIFO ${htmlSafe(firstBatch.batchNo || '-')}` : 'No active batch'}${preview ? ` · ${htmlSafe(preview)}` : ''}</div>
                    </div>
                    <button type="button" data-engineering-action="quote-add" onclick="addEngineeringDetailSearchProductToQuote('${htmlSafe(product.id || '')}')" class="rounded-xl bg-purple-700 px-4 py-2 text-xs font-black text-white hover:bg-purple-800">Add to Quotation Builder</button>
                </div>`;
            }).join('');
            applyEngineeringPermissions();
        }
        window.renderEngineeringDetailProductSearchResults = renderEngineeringDetailProductSearchResults;
        function searchEngineeringDetailProducts() {
            const template = engineeringDetailProductSearchTemplate();
            const { filters, invalidMessage } = readEngineeringDetailProductSearchFilters();
            const box = document.getElementById('engineering-detail-product-search-results');
            if (invalidMessage) {
                if (box) box.innerHTML = `<div class="p-6 text-center text-xs font-black text-red-500">${htmlSafe(invalidMessage)}</div>`;
                return;
            }
            const matches = products
                .filter(product => normalizeProductCategory(product.category, '') === template.category)
                .filter(product => productMatchesEngineeringDetailFilters(product, template, filters));
            renderEngineeringDetailProductSearchResults(matches, template, filters);
        }
        window.searchEngineeringDetailProducts = searchEngineeringDetailProducts;
        function clearEngineeringDetailProductSearch() {
            renderEngineeringDetailProductSearchCriteria();
        }
        window.clearEngineeringDetailProductSearch = clearEngineeringDetailProductSearch;
        async function openEngineeringDetailImportPreview(file) {
            const box = document.getElementById('engineering-detail-import-preview');
            if (!box) return;
            if (!file) {
                box.innerHTML = 'No file selected. CESC vertical key-value preview and Midea model matrix preview are supported.';
                return;
            }
            if (!window.XLSX) {
                box.innerHTML = 'Excel parser is not loaded. Please retry after the page finishes loading.';
                return;
            }
            try {
                const buffer = await file.arrayBuffer();
                const workbook = XLSX.read(buffer, { type: 'array' });
                const sheet = workbook.Sheets[workbook.SheetNames[0]];
                const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
                const width = Math.max(0, ...rows.map(row => row.length));
                const mode = width <= 3 ? 'CESC vertical key-value preview' : 'Midea model matrix preview';
                const template = currentProductMasterDetailTemplate();
                const fieldSet = new Set(template.fieldKeys || []);
                const previewKeys = rows.flat().map(value => String(value || '').trim()).filter(Boolean).slice(0, 120);
                const matched = previewKeys.filter(value => fieldSet.has(value) || fieldSet.has(value.replace(/\s+/g, '')));
                box.innerHTML = `<div class="font-black text-slate-700 mb-1">${htmlSafe(mode)}</div>
                    <div>${htmlSafe(file.name)} · ${rows.length} rows · ${width} columns</div>
                    <div class="mt-2">Matched existing template fields: <b>${matched.length}</b>. Unmatched fields stay in preview. No product fields are created automatically.</div>`;
            } catch (error) {
                box.innerHTML = `Unable to preview Excel file: ${htmlSafe(error.message || error)}`;
            }
        }
        window.openEngineeringDetailImportPreview = openEngineeringDetailImportPreview;
        function renderEngineeringProductMasterWorkspace() {
            syncEngineeringProductMasterModeChrome();
            if (engineeringProductMasterMode === 'detail') {
                renderEngineeringProductMasterDetailMode();
                return;
            }
            const list = document.getElementById('engineering-product-master-list');
            if (!list) return;
            const rows = engineeringProductMasterVisibleProducts();
            const detailGroup = engineeringProductMasterFilterValue('engineering-product-master-detail-group');
            const detailLabel = productMasterDetailGroupLabel(detailGroup);
            const note = document.getElementById('engineering-product-master-filter-note');
            renderEngineeringProductMasterSummary(rows);
            if (note) note.textContent = `${rows.length} products | ${detailLabel}`;
            list.innerHTML = rows.map(product => {
                const ctx = productMasterContext(product);
                const detailStatus = productMasterDetailGroupStatus(product, detailGroup);
                const certTone = ctx.certStatus.status === 'Ready' ? 'green' : (ctx.certStatus.status === 'Gap' ? 'amber' : 'slate');
                return `
                    <tr class="hover:bg-slate-50 transition-colors">
                        <td class="py-4 px-4"><div class="font-black text-slate-700">${htmlSafe(product.id || '-')}</div><div class="text-xs font-bold text-slate-600 max-w-[240px] truncate" title="${htmlSafe(productListDisplayText(product.name))}">${htmlSafe(productListDisplayText(product.name))}</div></td>
                        <td class="py-4 px-4"><div class="text-xs font-bold text-slate-600">${htmlSafe(productListDisplayText(product.category))}</div><div class="text-[10px] text-slate-400">${htmlSafe(getProductTypeGroup(product).label)}</div></td>
                        <td class="py-4 px-4"><div class="text-xs font-bold text-slate-700">${htmlSafe(detailStatus.label)}</div><div class="text-[10px] text-slate-400">${detailStatus.filled}/${detailStatus.total} fields maintained${detailStatus.missing ? ` · ${detailStatus.missing} missing` : ''}</div></td>
                        <td class="py-4 px-4">${productMasterStatusPill(ctx.certStatus.status, certTone)}<div class="text-[10px] text-slate-400 mt-1">${htmlSafe(ctx.certStatus.label)}</div></td>
                        <td class="py-4 px-4"><div class="text-xs text-slate-600">${htmlSafe(ctx.supplierName)}</div><div class="text-[10px] text-slate-400">${htmlSafe(ctx.sourcing.sourceType || 'Unknown')}</div></td>
                        <td class="py-4 px-4 text-center">
                            <div class="inline-flex items-center gap-2">
                                <button data-engineering-action="edit" onclick="editProduct('${htmlSafe(product.id || '')}')" class="rounded-xl bg-purple-700 px-3 py-2 text-xs font-black text-white hover:bg-purple-800">Details</button>
                                <button onclick="openProductCertificationEvidence('${htmlSafe(product.id || '')}')" class="rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-50">Evidence</button>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('') || '<tr><td colspan="6" class="py-12 text-center text-slate-400 text-sm">No products match the selected Product Master filters.</td></tr>';
            applyEngineeringPermissions();
            window.applyFrozenColumns('engineering-product-master');
        }
        function setEngineeringProductMasterFilter() {
            renderEngineeringWorkspace();
        }
        window.setEngineeringProductMasterFilter = setEngineeringProductMasterFilter;
        function renderEngineeringWorkspace() {
            syncEngineeringWorkspaceViewChrome();
            renderEngineeringFilterChips();
            renderEngineeringArchitectureClassOptions();
            certificationRequirementsCatalog = normalizeCertificationRequirementsCatalog(certificationRequirementsCatalog);
            productCertificationEvidence = normalizeProductCertificationEvidenceList(productCertificationEvidence);
            if (engineeringWorkspaceView === 'productMaster') {
                renderEngineeringProductMasterWorkspace();
                applyEngineeringPermissions();
                return;
            }
            syncEngineeringCertificationModeVisibility();
            const classId = document.getElementById('engineering-class-filter')?.value || 'A1';
            const cls = ENGINEERING_CLASS_DEFINITIONS[classId] || ENGINEERING_CLASS_DEFINITIONS.A1;
            const rows = engineeringVisibleRecords();
            const summary = document.getElementById('engineering-summary');
            const note = document.getElementById('engineering-filter-note');
            loadEngineeringQuoteDefaultsToUi();
            if (note) note.textContent = engineeringWorkspaceMode === 'matrix' ? `${cls.label} | ${cls.note}` : 'Standard mode | select record IDs and search matching products';
            if (summary) {
                const mandatory = rows.filter(record => record.requirementLevel === 'Mandatory').length;
                const evidenceCount = productCertificationEvidence.filter(record => record.evidenceAvailable === 'Yes' || (record.fileRefs || []).length).length;
                const selectedMandatory = rows.filter(record => record.requirementLevel === 'Mandatory');
                const gaps = selectedMandatory.filter(record => !productCertificationEvidence.some(e => e.requirementRecordId === record.id && (e.evidenceAvailable === 'Yes' || (e.fileRefs || []).length))).length;
                summary.innerHTML = [
                    ['Records', rows.length],
                    ['Mandatory', mandatory],
                    ['Evidence', evidenceCount],
                    ['Gaps', gaps]
                ].map(([label, value]) => `<div class="rounded-2xl border border-slate-100 bg-slate-50 p-3"><div class="text-[10px] font-black text-slate-400 uppercase">${label}</div><div class="text-xl font-black text-slate-800">${value}</div></div>`).join('');
            }
            renderEngineeringStandardList(engineeringWorkspaceMode === 'standard' ? rows : certificationRequirementsCatalog);
            renderEngineeringMatrixList(engineeringWorkspaceMode === 'matrix' ? rows : []);
            applyEngineeringPermissions();
        }
        window.renderEngineeringWorkspace = renderEngineeringWorkspace;
        window.toggleEngineeringStandardSelection = (recordId, checked) => {
            const id = String(recordId || '').trim();
            if (!id) return;
            if (checked) engineeringStandardSelectedIds.add(id);
            else engineeringStandardSelectedIds.delete(id);
            renderEngineeringWorkspace();
        };
        window.toggleEngineeringStandardSelectionAll = (checked) => {
            engineeringVisibleRecords().forEach(record => {
                if (checked) engineeringStandardSelectedIds.add(record.id);
                else engineeringStandardSelectedIds.delete(record.id);
            });
            renderEngineeringWorkspace();
        };
        window.toggleEngineeringMatrixSelectionAll = (checked) => {
            window.toggleEngineeringStandardSelectionAll(checked);
        };
        window.clearEngineeringStandardSelection = () => {
            engineeringStandardSelectedIds = new Set();
            renderEngineeringWorkspace();
            refreshEngineeringProductResults();
        };
        function refreshEngineeringProductResults() {
            const results = document.getElementById('engineering-standard-product-results');
            if (results) results.innerHTML = '<div class="p-8 text-center text-xs text-slate-400">Select standards, then search products.</div>';
            closeEngineeringStandardProductModal();
        }
        window.refreshEngineeringProductResults = refreshEngineeringProductResults;
        function engineeringSelectedStandardIds() {
            return Array.from(engineeringStandardSelectedIds).filter(id => getCertificationRequirementById(id));
        }
        function engineeringPriceLabel(type = 'clearance_home') {
            if (type === 'clearance_biz') return 'Clearance C&I';
            if (type === 'gray_home') return 'Grey RESI';
            if (type === 'gray_biz') return 'Grey C&I';
            return 'Clearance RESI';
        }
        function promptEngineeringPriceType(defaultType = 'clearance_home') {
            const text = prompt('Price type: clearance_home / clearance_biz / gray_home / gray_biz', defaultType);
            return ['clearance_home', 'clearance_biz', 'gray_home', 'gray_biz'].includes(text) ? text : defaultType;
        }
        function renderEngineeringMatchedProductRows(matches = [], ids = []) {
            if (!matches.length) {
                return `
                    <div class="p-8 text-center">
                        <div class="text-sm font-black text-slate-700">Unable to find products containing every selected standard record.</div>
                        <div class="mt-2 text-xs text-slate-400">${ids.length ? `Selected: ${htmlSafe(ids.join(', '))}` : 'Select at least one standard record.'}</div>
                    </div>
                `;
            }
            return matches.map(product => {
                const stock = getTotalStockQty(product.id);
                const firstBatch = getFifoBatchesForProduct(product.id)[0];
                const supplier = getProductSupplierDisplay(product);
                return `
                    <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 p-4">
                        <div class="min-w-0">
                            <div class="flex flex-wrap items-center gap-2">
                                <span class="font-black text-slate-800">${htmlSafe(product.id || '-')}</span>
                                <span class="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-500">${htmlSafe(normalizeProductCategory(product.category || '-'))}</span>
                                <span class="rounded-full ${stock > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'} px-2 py-1 text-[10px] font-black">Stock ${formatNumberAuto(stock, 4)}</span>
                            </div>
                            <div class="mt-1 text-sm font-bold text-slate-700 truncate">${htmlSafe(product.name || '-')}</div>
                            <div class="text-[11px] text-slate-400 truncate">${htmlSafe(supplier)} · ${firstBatch ? `FIFO ${htmlSafe(firstBatch.batchNo || '-')}` : 'No active batch'} · ${ids.length} standards matched</div>
                        </div>
                        <button data-engineering-action="quote-add" onclick="addEngineeringProductToQuote('${htmlSafe(product.id || '')}')" class="rounded-xl bg-purple-700 px-4 py-2 text-xs font-black text-white hover:bg-purple-800">Add to Quotation Builder</button>
                    </div>
                `;
            }).join('');
        }
        function openEngineeringStandardProductModal(ids = [], matches = [], message = '') {
            const modal = document.getElementById('engineering-standard-product-modal');
            const subtitle = document.getElementById('engineering-standard-product-modal-subtitle');
            const body = document.getElementById('engineering-standard-product-modal-body');
            if (!modal || !body) return;
            if (subtitle) {
                subtitle.textContent = ids.length
                    ? `${ids.length} selected record${ids.length > 1 ? 's' : ''}: ${ids.join(', ')}`
                    : 'Select standards, then search products.';
            }
            body.innerHTML = message
                ? `<div class="p-8 text-center"><div class="text-sm font-black text-slate-700">${htmlSafe(message)}</div><div class="mt-2 text-xs text-slate-400">${ids.length ? `Selected: ${htmlSafe(ids.join(', '))}` : 'No standard record selected.'}</div></div>`
                : renderEngineeringMatchedProductRows(matches, ids);
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            applyEngineeringPermissions();
        }
        window.openEngineeringStandardProductModal = openEngineeringStandardProductModal;
        function closeEngineeringStandardProductModal() {
            const modal = document.getElementById('engineering-standard-product-modal');
            if (!modal) return;
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
        window.closeEngineeringStandardProductModal = closeEngineeringStandardProductModal;
        function searchEngineeringStandardProducts() {
            pruneEngineeringStandardSelectionToRows(engineeringVisibleRecords());
            const ids = engineeringSelectedStandardIds();
            const box = document.getElementById('engineering-standard-product-results');
            if (!ids.length) {
                const message = 'Select at least one standard record.';
                if (box) box.innerHTML = `<div class="p-8 text-center text-xs text-slate-400">${message}</div>`;
                closeEngineeringStandardProductModal();
                return;
            }
            const matches = products.filter(product => {
                const selected = new Set(getProductCertificationRequirements(product).recordIds || []);
                return ids.every(id => selected.has(id));
            });
            const content = renderEngineeringMatchedProductRows(matches, ids);
            if (box) box.innerHTML = content;
            closeEngineeringStandardProductModal();
            applyEngineeringPermissions();
        }
        window.searchEngineeringStandardProducts = searchEngineeringStandardProducts;
        window.__engineeringQuoteAddAfterAdd = null;
        function runEngineeringQuoteAddCompletion(productId = '') {
            const afterAdd = window.__engineeringQuoteAddAfterAdd;
            if (typeof afterAdd !== 'function') return;
            window.__engineeringQuoteAddAfterAdd = null;
            try {
                afterAdd(productId);
            } catch (error) {
                console.warn('Engineering quote add completion failed', error);
            }
        }
        window.runEngineeringQuoteAddCompletion = runEngineeringQuoteAddCompletion;
        function confirmEngineeringDetailSearchQuoteAdded(productId = '') {
            const product = products.find(item => String(item.id || '') === String(productId || ''));
            const productName = productListDisplayText(product?.name || productId || 'Product');
            const ok = confirm(`Added to Quotation Builder. Open Quotation now?\n\n${productName}`);
            if (!ok) return;
            closeEngineeringDetailProductSearch();
            switchTab('quotation');
        }
        window.confirmEngineeringDetailSearchQuoteAdded = confirmEngineeringDetailSearchQuoteAdded;
        function addEngineeringDetailSearchProductToQuote(productId) {
            return addEngineeringProductToQuote(productId, { afterAdd: confirmEngineeringDetailSearchQuoteAdded });
        }
        window.addEngineeringDetailSearchProductToQuote = addEngineeringDetailSearchProductToQuote;
        function addEngineeringProductToQuote(productId, options = {}) {
            if (!canAddEngineeringProductToQuote()) return alert('No quotation edit permission.');
            const product = products.find(item => String(item.id || '') === String(productId || ''));
            if (!product) return alert('Product not found.');
            const defaults = getEngineeringQuoteDefaults();
            const afterAdd = typeof options.afterAdd === 'function' ? options.afterAdd : null;
            const queueCompletion = () => {
                if (afterAdd) window.__engineeringQuoteAddAfterAdd = afterAdd;
            };
            const addFromPriceList = (priceType = defaults.priceType) => {
                if (typeof window.pickPriceListProduct !== 'function') return false;
                queueCompletion();
                window.pickPriceListProduct(product.id, priceType);
                return true;
            };
            if (defaults.source === 'priceList') return addFromPriceList(defaults.priceType);
            const firstBatch = getFifoBatchesForProduct(productId)[0];
            if (firstBatch) {
                if (typeof window.pickProduct !== 'function') return false;
                queueCompletion();
                window.pickProduct(firstBatch.id, defaults.priceType);
                return true;
            }
            const ok = confirm('No stock is available. Add this product from Price List instead?');
            if (!ok) return false;
            return addFromPriceList(defaults.priceType);
        }
        window.addEngineeringProductToQuote = addEngineeringProductToQuote;
        function openEngineeringRequirementEditor(recordId = '') {
            const isNew = !recordId;
            const record = isNew
                ? normalizeCertificationRequirement({ id: nextCertificationRequirementIdForCategory('PV_MODULE'), sourceCategory: 'PV_MODULE', requirementLevel: 'Mandatory', seedVersion: 'Manual' })
                : getCertificationRequirementById(recordId);
            if (!record) return;
            const modal = document.getElementById('engineering-cert-detail-modal');
            const subtitle = document.getElementById('engineering-cert-detail-subtitle');
            const body = document.getElementById('engineering-cert-detail-body');
            if (!modal || !body) return;
            const canEdit = canManageEngineeringRecord('edit');
            const linked = getEngineeringRequirementLinkedProducts(record.id);
            const evidence = getEngineeringRequirementEvidence(record.id);
            const disabled = canEdit ? '' : 'disabled';
            if (subtitle) subtitle.textContent = isNew ? 'New certification requirement' : `${record.id} · ${record.sourceCategory} · ${record.requirementLevel}`;
            body.innerHTML = `
                <input id="engineering-detail-is-new" type="hidden" value="${isNew ? '1' : '0'}">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div><label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Record ID</label><input id="engineering-detail-id" value="${htmlSafe(record.id)}" readonly class="w-full border border-slate-200 rounded-xl p-3 text-sm bg-slate-50 font-black text-slate-700"></div>
                    <div><label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Source Category</label><select id="engineering-detail-source-category" ${disabled} onchange="syncEngineeringRequirementEditorSourceCategory()" class="w-full border border-slate-200 rounded-xl p-3 text-sm bg-white">${CERTIFICATION_SOURCE_CATEGORIES.map(category => `<option value="${htmlSafe(category)}" ${record.sourceCategory === category ? 'selected' : ''}>${htmlSafe(category)}</option>`).join('')}</select></div>
                    <div>
                        <label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Product Category</label>
                        <select id="engineering-detail-product-category-select" ${disabled} onchange="syncEngineeringProductCategoryInput()" class="w-full border border-slate-200 rounded-xl p-3 text-sm bg-white">${renderCertificationProductCategoryOptions(record.sourceCategory, record.productCategory)}</select>
                        <input id="engineering-detail-product-category-custom" ${disabled} value="" placeholder="Add custom product category" class="hidden mt-2 w-full border border-slate-200 rounded-xl p-3 text-sm">
                    </div>
                    <div><label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Requirement Level</label><select id="engineering-detail-level" ${disabled} class="w-full border border-slate-200 rounded-xl p-3 text-sm bg-white">${CERTIFICATION_REQUIREMENT_LEVELS.map(level => `<option value="${htmlSafe(level)}" ${record.requirementLevel === level ? 'selected' : ''}>${htmlSafe(level)}</option>`).join('')}</select></div>
                    <div class="md:col-span-2"><label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Standard</label><input id="engineering-detail-standard" ${disabled} value="${htmlSafe(record.standard)}" class="w-full border border-slate-200 rounded-xl p-3 text-sm"></div>
                    <div><label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Evidence Type</label><input id="engineering-detail-evidence-type" ${disabled} value="${htmlSafe(record.evidenceType)}" class="w-full border border-slate-200 rounded-xl p-3 text-sm"></div>
                    <div><label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Project Applicability</label><input id="engineering-detail-project-applicability" ${disabled} value="${htmlSafe(record.projectApplicability)}" class="w-full border border-slate-200 rounded-xl p-3 text-sm"></div>
                    <div class="md:col-span-2"><label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Source URL</label><input id="engineering-detail-source-url" ${disabled} value="${htmlSafe(record.sourceUrl)}" class="w-full border border-slate-200 rounded-xl p-3 text-sm"></div>
                    <div class="md:col-span-2"><label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Applicability</label><textarea id="engineering-detail-applicability" ${disabled} rows="3" class="w-full border border-slate-200 rounded-xl p-3 text-sm">${htmlSafe(record.applicabilityCondition)}</textarea></div>
                    <div class="md:col-span-2"><label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Remarks</label><textarea id="engineering-detail-remarks" ${disabled} rows="2" class="w-full border border-slate-200 rounded-xl p-3 text-sm">${htmlSafe(record.remarks)}</textarea></div>
                </div>
                <div class="border border-slate-200 rounded-2xl p-4">
                    <div class="text-sm font-black text-slate-700 mb-3">Linked Products</div>
                    ${linked.map(product => `<div class="flex items-center justify-between gap-3 py-2 border-t border-slate-100 first:border-t-0"><button onclick="editProduct('${htmlSafe(product.id)}')" class="text-xs font-black text-purple-700 hover:underline">${htmlSafe(product.id)}</button><span class="text-xs text-slate-500 truncate">${htmlSafe(product.name || '-')}</span><span class="text-[10px] text-slate-400">${htmlSafe(product.category || '-')}</span></div>`).join('') || '<div class="text-xs text-slate-400">No products explicitly select this record.</div>'}
                </div>
                <div class="border border-slate-200 rounded-2xl p-4">
                    <div class="text-sm font-black text-slate-700 mb-3">Linked Product Evidence</div>
                    ${evidence.map(item => `<div class="flex items-center justify-between gap-3 py-2 border-t border-slate-100 first:border-t-0"><span class="text-xs font-bold text-slate-600">${htmlSafe(item.productId)}</span><span class="text-[10px] text-slate-400">${htmlSafe(item.verificationStatus || item.status || '-')}</span><span class="text-xs font-black text-slate-700">${(item.fileRefs || []).length} files</span></div>`).join('') || '<div class="text-xs text-slate-400">No product evidence linked yet.</div>'}
                </div>
                <div class="flex gap-3">
                    <button data-engineering-action="edit" onclick="saveEngineeringRequirementEditor()" class="flex-1 rounded-2xl bg-slate-900 text-white py-3 text-sm font-black">Save Requirement</button>
                    <button onclick="closeEngineeringCertDetail()" class="flex-1 rounded-2xl border border-slate-200 text-slate-500 py-3 text-sm font-black">Close</button>
                </div>
            `;
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            syncEngineeringProductCategoryInput();
            applyEngineeringPermissions();
        }
        window.openEngineeringRequirementEditor = openEngineeringRequirementEditor;
        window.openEngineeringCertDetail = (recordId) => window.openEngineeringRequirementEditor(recordId);
        window.closeEngineeringCertDetail = () => {
            const modal = document.getElementById('engineering-cert-detail-modal');
            if (!modal) return;
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        };
        function saveEngineeringRequirementEditor() {
            if (!canManageEngineeringRecord('edit')) return alert('No engineering edit permission.');
            const recordId = String(document.getElementById('engineering-detail-id')?.value || '').trim();
            const isNew = document.getElementById('engineering-detail-is-new')?.value === '1';
            const idx = certificationRequirementsCatalog.findIndex(record => record.id === recordId);
            if (!recordId) return alert('Record ID is required.');
            if (isNew && idx >= 0) return alert('Record ID already exists. Change category or refresh the catalog.');
            const next = {
                ...(idx >= 0 ? certificationRequirementsCatalog[idx] : {}),
                id: recordId,
                sourceCategory: document.getElementById('engineering-detail-source-category')?.value || 'PV_MODULE',
                productCategory: readEngineeringDetailProductCategory(),
                standard: document.getElementById('engineering-detail-standard')?.value || '',
                requirementLevel: document.getElementById('engineering-detail-level')?.value || '',
                evidenceType: document.getElementById('engineering-detail-evidence-type')?.value || '',
                projectApplicability: document.getElementById('engineering-detail-project-applicability')?.value || '',
                sourceUrl: document.getElementById('engineering-detail-source-url')?.value || '',
                applicabilityCondition: document.getElementById('engineering-detail-applicability')?.value || '',
                remarks: document.getElementById('engineering-detail-remarks')?.value || '',
                seedVersion: idx >= 0 ? certificationRequirementsCatalog[idx].seedVersion : 'Manual'
            };
            const normalized = normalizeCertificationRequirement(next);
            if (!normalized.standard) return alert('Standard is required.');
            if (idx >= 0) certificationRequirementsCatalog[idx] = normalized;
            else certificationRequirementsCatalog.push(normalized);
            certificationRequirementsCatalog = normalizeCertificationRequirementsCatalog(certificationRequirementsCatalog);
            saveToLocal();
            persistEntityToD1('certification_requirement', normalized.id, normalized, { createOnly: isNew });
            renderEngineeringWorkspace();
            closeEngineeringCertDetail();
        }
        window.saveEngineeringRequirementEditor = saveEngineeringRequirementEditor;
        window.saveEngineeringCertDetail = (recordId) => {
            const idInput = document.getElementById('engineering-detail-id');
            if (idInput && recordId) idInput.value = recordId;
            window.saveEngineeringRequirementEditor();
        };
        function deleteEngineeringRequirementRecord(recordId) {
            if (!canManageEngineeringRecord('delete')) return alert('No engineering delete permission.');
            const record = getCertificationRequirementById(recordId);
            if (!record) return;
            const linked = getEngineeringRequirementLinkedProducts(record.id);
            const evidence = getEngineeringRequirementEvidence(record.id);
            if (linked.length || evidence.length) {
                return alert(`Cannot delete ${record.id}. Linked products: ${linked.length}; evidence records: ${evidence.length}. Remove links first.`);
            }
            if (!confirm(`Delete certification record ${record.id}?`)) return;
            certificationRequirementsCatalog = certificationRequirementsCatalog.filter(item => item.id !== record.id);
            engineeringStandardSelectedIds.delete(record.id);
            saveToLocal();
            deleteEntityFromD1('certification_requirement', record.id);
            renderEngineeringWorkspace();
        }
        window.deleteEngineeringRequirementRecord = deleteEngineeringRequirementRecord;
        function productCertificationEvidenceInputId(prefix, recordId) {
            return `${prefix}-${domSafeId(recordId)}`;
        }
        window.openProductCertificationEvidence = (productId, focusRecordId = '') => {
            const pid = String(productId || '').trim();
            if (!pid) return alert('Please save the product before maintaining certification evidence.');
            const product = products.find(item => String(item.id || '') === pid);
            if (!product) return alert('Product not found.');
            const modal = document.getElementById('engineering-cert-detail-modal');
            const subtitle = document.getElementById('engineering-cert-detail-subtitle');
            const body = document.getElementById('engineering-cert-detail-body');
            if (!modal || !body) return;
            const req = getProductCertificationRequirements(product);
            const selectedIds = (req.recordIds || []).length ? req.recordIds : defaultCertificationRequirementIdsForProduct(product);
            const records = selectedIds.map(getCertificationRequirementById).filter(Boolean);
            if (subtitle) subtitle.textContent = `${product.id} · ${product.name || ''} · Product Certification Evidence`;
            body.innerHTML = `
                <div class="flex flex-col gap-3">
                    <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div class="text-xs font-black text-slate-500 uppercase">Selected Requirement Records</div>
                        <div class="mt-1 text-2xl font-black text-slate-800">${records.length}</div>
                        <div class="text-xs text-slate-400">${htmlSafe(product.category || '-')} · files are stored under minova-data/certifications/products/${htmlSafe(product.id)}/&lt;recordId&gt;/</div>
                    </div>
                    ${records.length ? records.map(record => {
                        const evidence = productCertificationEvidenceFor(pid, record.id)[0] || normalizeProductCertificationEvidence({ productId: pid, requirementRecordId: record.id });
                        const fileRefs = Array.isArray(evidence.fileRefs) ? evidence.fileRefs : [];
                        const focusClass = focusRecordId === record.id ? 'ring-2 ring-purple-200 border-purple-200' : 'border-slate-200';
                        return `
                            <div class="rounded-2xl border ${focusClass} bg-white p-4" data-product-evidence-record="${htmlSafe(record.id)}">
                                <div class="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                                    <div class="min-w-0">
                                        <div class="flex flex-wrap items-center gap-2">
                                            <span class="font-black text-slate-800">${htmlSafe(record.id)}</span>
                                            <span class="rounded-full border px-2 py-1 text-[10px] font-black ${certificationLevelTone(record.requirementLevel)}">${htmlSafe(record.requirementLevel || '-')}</span>
                                        </div>
                                        <div class="mt-1 text-sm font-bold text-slate-600">${htmlSafe(record.standard || '-')}</div>
                                        <div class="mt-1 text-xs text-slate-400">${htmlSafe(record.applicabilityCondition || '-')}</div>
                                    </div>
                                    <button data-engineering-action="upload" onclick="openProductCertificationEvidenceUpload('${htmlSafe(pid)}', '${htmlSafe(record.id)}')" class="shrink-0 rounded-xl bg-purple-700 px-3 py-2 text-xs font-black text-white hover:bg-purple-800">Upload File</button>
                                </div>
                                <div class="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
                                    <div>
                                        <label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Status</label>
                                        <select id="${productCertificationEvidenceInputId('evidence-status', record.id)}" class="w-full rounded-xl border border-slate-200 p-2 text-xs bg-white">
                                            ${['Pending Evidence', 'Evidence Uploaded', 'Verified', 'Expired', 'Rejected'].map(status => `<option value="${htmlSafe(status)}" ${evidence.status === status ? 'selected' : ''}>${htmlSafe(status)}</option>`).join('')}
                                        </select>
                                    </div>
                                    <div>
                                        <label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Verification</label>
                                        <select id="${productCertificationEvidenceInputId('evidence-verification', record.id)}" class="w-full rounded-xl border border-slate-200 p-2 text-xs bg-white">
                                            ${['Not Reviewed', 'Pending Review', 'Verified', 'Needs Renewal', 'Rejected'].map(status => `<option value="${htmlSafe(status)}" ${evidence.verificationStatus === status ? 'selected' : ''}>${htmlSafe(status)}</option>`).join('')}
                                        </select>
                                    </div>
                                    <div><label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Certificate No.</label><input id="${productCertificationEvidenceInputId('evidence-cert-no', record.id)}" value="${htmlSafe(evidence.certificateNo || '')}" class="w-full rounded-xl border border-slate-200 p-2 text-xs"></div>
                                    <div><label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Report No.</label><input id="${productCertificationEvidenceInputId('evidence-report-no', record.id)}" value="${htmlSafe(evidence.reportNo || '')}" class="w-full rounded-xl border border-slate-200 p-2 text-xs"></div>
                                    <div><label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Issue Date</label><input id="${productCertificationEvidenceInputId('evidence-issue', record.id)}" type="date" value="${htmlSafe(evidence.issueDate || '')}" class="w-full rounded-xl border border-slate-200 p-2 text-xs"></div>
                                    <div><label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Expiry Date</label><input id="${productCertificationEvidenceInputId('evidence-expiry', record.id)}" type="date" value="${htmlSafe(evidence.expiryDate || '')}" class="w-full rounded-xl border border-slate-200 p-2 text-xs"></div>
                                    <div class="md:col-span-2"><label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Remarks</label><input id="${productCertificationEvidenceInputId('evidence-remarks', record.id)}" value="${htmlSafe(evidence.remarks || '')}" class="w-full rounded-xl border border-slate-200 p-2 text-xs"></div>
                                </div>
                                <div class="mt-3 rounded-xl bg-slate-50 p-3">
                                    <div class="text-[10px] font-black text-slate-400 uppercase mb-2">GitHub Files</div>
                                    ${fileRefs.length ? fileRefs.map(file => `<div class="flex items-center justify-between gap-3 py-1 text-xs"><button onclick="previewCertFile('${htmlSafe(file.path || '')}')" class="min-w-0 truncate text-blue-600 hover:underline">${htmlSafe(file.name || file.path || '-')}</button><span class="shrink-0 text-slate-400">${htmlSafe(file.sha256 ? file.sha256.slice(0, 10) : '')}</span></div>`).join('') : '<div class="text-xs text-slate-400">No files uploaded for this record yet.</div>'}
                                </div>
                                <div class="mt-3 flex justify-end">
                                    <button data-engineering-action="edit" onclick="saveProductCertificationEvidence('${htmlSafe(pid)}', '${htmlSafe(record.id)}')" class="rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-50">Save Metadata</button>
                                </div>
                            </div>
                        `;
                    }).join('') : '<div class="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">No requirement records selected for this product.</div>'}
                    <div class="flex gap-3">
                        <button onclick="closeEngineeringCertDetail()" class="flex-1 rounded-2xl border border-slate-200 text-slate-500 py-3 text-sm font-black">Close</button>
                    </div>
                </div>
            `;
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            applyEngineeringPermissions();
        };
        window.saveProductCertificationEvidence = (productId, recordId) => {
            if (!canManageEngineeringRecord('edit')) return alert('No engineering edit permission.');
            const existing = productCertificationEvidenceFor(productId, recordId)[0] || {};
            const next = {
                ...existing,
                id: existing.id || `${productId}:${recordId}`,
                productId,
                requirementRecordId: recordId,
                status: document.getElementById(productCertificationEvidenceInputId('evidence-status', recordId))?.value || existing.status || 'Pending Evidence',
                evidenceAvailable: evidenceHasFileOrAvailability(existing) ? 'Yes' : (existing.evidenceAvailable || 'No'),
                certificateNo: document.getElementById(productCertificationEvidenceInputId('evidence-cert-no', recordId))?.value || '',
                reportNo: document.getElementById(productCertificationEvidenceInputId('evidence-report-no', recordId))?.value || '',
                issueDate: document.getElementById(productCertificationEvidenceInputId('evidence-issue', recordId))?.value || '',
                expiryDate: document.getElementById(productCertificationEvidenceInputId('evidence-expiry', recordId))?.value || '',
                verificationStatus: document.getElementById(productCertificationEvidenceInputId('evidence-verification', recordId))?.value || 'Not Reviewed',
                fileRefs: Array.isArray(existing.fileRefs) ? existing.fileRefs : [],
                remarks: document.getElementById(productCertificationEvidenceInputId('evidence-remarks', recordId))?.value || '',
                updatedAt: new Date().toISOString()
            };
            upsertProductCertificationEvidence(next);
            window.openProductCertificationEvidence(productId, recordId);
        };
        function renderSupplierOptions(selectedCode = '') {
            ensureSupplierData();
            const cur = normalizeSupplierCode(selectedCode);
            const options = [`<option value="">SelectSupplier</option>`].concat((suppliers || []).map(s => {
                const label = `${s.code} · ${getSupplierDisplayName(s)}`;
                return `<option value="${htmlSafe(s.code)}" ${normalizeSupplierCode(s.code) === cur ? 'selected' : ''}>${htmlSafe(label)}</option>`;
            }));
            return options.join('');
        }
        function updateSupplierSelects(selectedCode = '') {
            const productSel = document.getElementById('m-supplier-code');
            if (productSel) {
                const cur = selectedCode || productSel.value || '';
                productSel.innerHTML = renderSupplierOptions(cur);
                if (cur && getSupplierByCode(cur)) productSel.value = normalizeSupplierCode(cur);
                try { setSupplyRouteSelectOptions(getProductSourcing({ supplierCode: cur }), cur); } catch (e) {}
                try { updateProductChannelPartnerOptions(); updateSupplyRouteVisibility(); } catch (e) {}
            }
        }
        window.__minovaGetProducts = () => products;
        window.__minovaGetInventory = () => inventory;
        window.__minovaSupplierUtils = {
            htmlSafe,
            getSupplierDisplayName,
            getSupplierDisplayNameForLang,
            getSupplierLogo,
            getSupplierByCode,
            findSupplierByDisplayName,
            getProductSupplier,
            getProductSupplierDisplay,
            getProductSupplierBrandForLang
        };
        function normalizeInstallerProfitSettings(next) {
            const base = next && typeof next === 'object' ? next : {};
            const cnPct = Number.isFinite(parseFloat(base.cnPct)) ? parseFloat(base.cnPct) : 0;
            const myPct = Number.isFinite(parseFloat(base.myPct)) ? parseFloat(base.myPct) : 0;
            return { cnPct, myPct };
        }
        // INSTALLER_QUOTE_MODEL_START
        const DEFAULT_INSTALLER_REGION_FEES = {
            installationRmPerKwp: 250,
            frameMountingRmPerKwp: 240,
            cableRmPerKwp: 60
        };
        const DEFAULT_INSTALLER_QUOTE_SETTINGS = {
            v: 2,
            ...DEFAULT_INSTALLER_REGION_FEES,
            regions: {
                peninsular: { ...DEFAULT_INSTALLER_REGION_FEES },
                sabahSarawak: { ...DEFAULT_INSTALLER_REGION_FEES }
            },
            home: {
                peEndorsement: 1200,
                powerStudyThresholdKwp: 15,
                powerStudyFee: 1000,
                designApplications: 2500,
                db: 2500,
                wireman: 500,
                chargeman: 500
            },
            biz: {
                peEndorsement: 1200,
                powerStudyMinKwp: 72,
                powerStudyMaxKwp: 425,
                powerStudyFee: 5000,
                designBaseThresholdKwp: 50,
                designBaseFee: 3000,
                designAdditionalPerKwp: 12,
                dbPer100Kwp: 10500,
                wireman: 800,
                chargeman: 0
            }
        };
        function installerNum(value, fallback = 0) {
            const n = parseFloat(value);
            return Number.isFinite(n) ? n : fallback;
        }
        function migrateInstallerRate(value, fallback) {
            const n = installerNum(value, fallback);
            return n > 0 && n < 10 ? n * 1000 : n;
        }
        function normalizeInstallerRegionKey(region) {
            const key = String(region || '').trim();
            return key === 'sabahSarawak' || key === 'sabah_sarawak' || key === 'eastMalaysia' ? 'sabahSarawak' : 'peninsular';
        }
        function normalizeInstallerRegionFees(next, fallback = DEFAULT_INSTALLER_REGION_FEES) {
            const base = next && typeof next === 'object' ? next : {};
            return {
                installationRmPerKwp: migrateInstallerRate(base.labor ?? base.installationRmPerKwp, fallback.installationRmPerKwp),
                frameMountingRmPerKwp: migrateInstallerRate(base.bracket ?? base.frameMountingRmPerKwp, fallback.frameMountingRmPerKwp),
                cableRmPerKwp: migrateInstallerRate(base.cable ?? base.cableRmPerKwp, fallback.cableRmPerKwp)
            };
        }
        function normalizeInstallerQuoteSettings(next) {
            const base = next && typeof next === 'object' ? next : {};
            const oldLabor = base.labor ?? base.installationRmPerKwp;
            const oldBracket = base.bracket ?? base.frameMountingRmPerKwp;
            const oldCable = base.cable ?? base.cableRmPerKwp;
            const d = DEFAULT_INSTALLER_QUOTE_SETTINGS;
            const oldTopLevel = {
                installationRmPerKwp: oldLabor,
                frameMountingRmPerKwp: oldBracket,
                cableRmPerKwp: oldCable
            };
            const baseRegions = base.regions && typeof base.regions === 'object' ? base.regions : {};
            const peninsular = normalizeInstallerRegionFees(baseRegions.peninsular || oldTopLevel, d.regions.peninsular);
            const sabahSarawak = normalizeInstallerRegionFees(baseRegions.sabahSarawak || baseRegions.sabah_sarawak || oldTopLevel, d.regions.sabahSarawak);
            const home = base.home && typeof base.home === 'object' ? base.home : {};
            const biz = base.biz && typeof base.biz === 'object' ? base.biz : {};
            return {
                v: 2,
                installationRmPerKwp: peninsular.installationRmPerKwp,
                frameMountingRmPerKwp: peninsular.frameMountingRmPerKwp,
                cableRmPerKwp: peninsular.cableRmPerKwp,
                regions: {
                    peninsular,
                    sabahSarawak
                },
                home: {
                    peEndorsement: installerNum(home.peEndorsement, d.home.peEndorsement),
                    powerStudyThresholdKwp: installerNum(home.powerStudyThresholdKwp, d.home.powerStudyThresholdKwp),
                    powerStudyFee: installerNum(home.powerStudyFee, d.home.powerStudyFee),
                    designApplications: installerNum(home.designApplications, d.home.designApplications),
                    db: installerNum(home.db, d.home.db),
                    wireman: installerNum(home.wireman, d.home.wireman),
                    chargeman: installerNum(home.chargeman, d.home.chargeman)
                },
                biz: {
                    peEndorsement: installerNum(biz.peEndorsement, d.biz.peEndorsement),
                    powerStudyMinKwp: installerNum(biz.powerStudyMinKwp, d.biz.powerStudyMinKwp),
                    powerStudyMaxKwp: installerNum(biz.powerStudyMaxKwp, d.biz.powerStudyMaxKwp),
                    powerStudyFee: installerNum(biz.powerStudyFee, d.biz.powerStudyFee),
                    designBaseThresholdKwp: installerNum(biz.designBaseThresholdKwp, d.biz.designBaseThresholdKwp),
                    designBaseFee: installerNum(biz.designBaseFee, d.biz.designBaseFee),
                    designAdditionalPerKwp: installerNum(biz.designAdditionalPerKwp, d.biz.designAdditionalPerKwp),
                    dbPer100Kwp: installerNum(biz.dbPer100Kwp, d.biz.dbPer100Kwp),
                    wireman: installerNum(biz.wireman, d.biz.wireman),
                    chargeman: installerNum(biz.chargeman, d.biz.chargeman)
                }
            };
        }
        function getInstallerRegionFees(settings, region = 'peninsular') {
            const s = normalizeInstallerQuoteSettings(settings);
            const key = normalizeInstallerRegionKey(region);
            return s.regions?.[key] || s.regions?.peninsular || normalizeInstallerRegionFees(s, DEFAULT_INSTALLER_REGION_FEES);
        }
        function computeInstallerCost(sizeKwp, scenario, settings, profit = {}, rateMyrCny = 1.53, region = 'peninsular') {
            const s = normalizeInstallerQuoteSettings(settings);
            const target = scenario === 'biz' ? 'biz' : 'home';
            const regionKey = normalizeInstallerRegionKey(region);
            const fees = getInstallerRegionFees(s, regionKey);
            const size = Math.max(0, installerNum(sizeKwp, 0));
            const rate = Math.max(0.0001, installerNum(rateMyrCny, 1.53));
            const detail = [
                { key: 'installation', label: 'Installation', amount: fees.installationRmPerKwp * size, formula: `${fees.installationRmPerKwp}/kWp × ${size.toFixed(2)}` },
                { key: 'frameMounting', label: 'Frame/Mounting', amount: fees.frameMountingRmPerKwp * size, formula: `${fees.frameMountingRmPerKwp}/kWp × ${size.toFixed(2)}` },
                { key: 'cable', label: 'DC and AC Cable', amount: fees.cableRmPerKwp * size, formula: `${fees.cableRmPerKwp}/kWp × ${size.toFixed(2)}` }
            ];
            detail.forEach(item => { item.amount = Math.round((installerNum(item.amount, 0) + Number.EPSILON) * 10000) / 10000; });
            const baseMyr = Math.round((detail.reduce((sum, item) => sum + item.amount, 0) + Number.EPSILON) * 10000) / 10000;
            const cnPct = installerNum(profit.cnPct, 0);
            const myPct = installerNum(profit.myPct, 0);
            const finalMyr = Math.round((baseMyr * (1 + (cnPct + myPct) / 100) + Number.EPSILON) * 10000) / 10000;
            return {
                scenario: target,
                region: regionKey,
                sizeKwp: size,
                baseMyr,
                baseCny: Math.round((baseMyr * rate + Number.EPSILON) * 10000) / 10000,
                finalMyr,
                finalCny: Math.round((finalMyr * rate + Number.EPSILON) * 10000) / 10000,
                unitFinalMyrPerKwp: size > 0 ? Math.round(((finalMyr / size) + Number.EPSILON) * 10000) / 10000 : 0,
                unitFinalCnyPerKwp: size > 0 ? Math.round(((finalMyr * rate / size) + Number.EPSILON) * 10000) / 10000 : 0,
                cnPct,
                myPct,
                detail
            };
        }
        // INSTALLER_QUOTE_MODEL_END
        function normalizeProfitSettings(next) {
            const base = next && typeof next === 'object' ? next : {};
            const companies = Array.isArray(base.companies) ? base.companies.filter(c => c && c.id && c.name) : [];
            const seeded = companies.length ? companies : [
                { id: 'cn_parent', name: 'CN Parent Company', locked: true },
                { id: 'my_sub', name: 'Malaysia Subsidiary' }
            ];
            const normalizedCompanies = [];
            const seenCompanyIds = new Set();
            const pushCompany = (company) => {
                const id = String(company?.id || '').trim();
                if (!id || seenCompanyIds.has(id)) return;
                seenCompanyIds.add(id);
                normalizedCompanies.push({
                    id,
                    name: id === 'cn_parent' ? 'CN Parent Company' : String(company?.name || '').trim(),
                    locked: id === 'cn_parent' || !!company?.locked
                });
            };
            seeded.forEach(pushCompany);
            if (!seenCompanyIds.has('cn_parent')) {
                normalizedCompanies.unshift({ id: 'cn_parent', name: 'CN Parent Company', locked: true });
                seenCompanyIds.add('cn_parent');
            }
            const settings = {
                v: 1,
                companies: normalizedCompanies,
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
                settings.categoryProfitPct[c.id].home = normalizeCategoryValueMap(settings.categoryProfitPct[c.id].home);
                settings.categoryProfitPct[c.id].biz = normalizeCategoryValueMap(settings.categoryProfitPct[c.id].biz);
                settings.subcatProfitPct[c.id].home = normalizeSubcatProfitMap(settings.subcatProfitPct[c.id].home);
                settings.subcatProfitPct[c.id].biz = normalizeSubcatProfitMap(settings.subcatProfitPct[c.id].biz);
            }
            settings.enabled = normalizeEnabledCategoryMap(settings.enabled);
            return settings;
        }
        function normalizeProductClassificationData() {
            normalizeProductUnitFields();
            marketPrices = normalizeMarketPrices(marketPrices);
            subcategoriesByCategory = normalizeSubcategoryMap(subcategoriesByCategory);
            profitSettings = normalizeProfitSettings(profitSettings || null);
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
        function getProfitPctBreakdown(target, category, subcategory) {
            profitSettings = normalizeProfitSettings(profitSettings || safeJsonParseLoose(localStorage.getItem('minova_profit_settings_v1'), null));
            return profitSettings.companies.map(company => ({
                id: company.id,
                name: company.name,
                pct: getProfitPct(company.id, target, category, subcategory)
            }));
        }
        function getTotalProfitPct(target, category, subcategory) {
            return getProfitPctBreakdown(target, category, subcategory).reduce((sum, company) => sum + (Number.isFinite(parseFloat(company.pct)) ? parseFloat(company.pct) : 0), 0);
        }
        function persistProfitSettings(reason = 'profit settings update') {
            try { localStorage.setItem('minova_profit_settings_v1', JSON.stringify(profitSettings)); } catch (e) {}
            persistQuoteSettingsToD1();
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
            if (!confirm(`Delete company entity: ${c.name}？`)) return;
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
                `<th class="py-3 px-4">Category</th>`,
                `<th class="py-3 px-4">Subcategory</th>`,
                `<th class="py-3 px-4 text-center">Enabled</th>`,
                ...profitSettings.companies.map(c => `<th class="py-3 px-4 text-right">${c.name} Margin%</th>`)
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
                            <td class="py-3 px-4 text-xs text-slate-400">（Category默认）</td>
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
                `<th class="py-3 px-4">Category</th>`,
                `<th class="py-3 px-4">Subcategory</th>`,
                ...profitSettings.companies.flatMap(c => [
                    `<th class="py-3 px-4 text-right">${c.name}SubcategoryMargin (RESI)%</th>`,
                    `<th class="py-3 px-4 text-right">${c.name}SubcategoryMargin (C&I)%</th>`
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
                    marketPrices = normalizeMarketPrices(embedded.data.marketPrices || marketPrices);
                    normalizeProductUnitFields();
                    if (inventoryHistory.length > 1000) inventoryHistory = inventoryHistory.slice(inventoryHistory.length - 1000);
                    salesRecords = Array.isArray(embedded.data.salesRecords) ? embedded.data.salesRecords : [];
                    historicalInventory = Array.isArray(embedded.data.historicalInventory) ? embedded.data.historicalInventory : [];
                    suppliers = Array.isArray(embedded.data.suppliers) ? embedded.data.suppliers : [];
                    channelPartners = Array.isArray(embedded.data.channelPartners) ? embedded.data.channelPartners : [];
                    certificationRequirementsCatalog = normalizeCertificationRequirementsCatalog(embedded.data.certificationRequirementsCatalog);
                    productCertificationEvidence = normalizeProductCertificationEvidenceList(embedded.data.productCertificationEvidence);
                    productMasterDetailTemplates = normalizeProductMasterDetailTemplates(embedded.data.productMasterDetailTemplates);
                    subcategoriesByCategory = embedded.data.subcategoriesByCategory && typeof embedded.data.subcategoriesByCategory === 'object' ? embedded.data.subcategoriesByCategory : {};
                    profitSettings = normalizeProfitSettings(embedded.data.profitSettings || null);
                    installerProfitSettings = normalizeInstallerProfitSettings(embedded.data.installerProfitSettings || installerProfitSettings || null);
                    installerQuoteSettings = normalizeInstallerQuoteSettings(embedded.data.installerQuoteSettings || installerQuoteSettings || null);
                    nonStockPricingStrategies = normalizeNonStockPricingStrategies(embedded.data.nonStockPricingStrategies || safeJsonParseLoose(localStorage.getItem('minova_non_stock_pricing_v1'), {}));
                    normalizeProductClassificationData();
                    try {
                        if (embeddedAt) localStorage.setItem('minova_embedded_updatedAt', String(embeddedAt));
                        localStorage.setItem('minova_products', JSON.stringify(products));
                        localStorage.setItem('minova_inventory', JSON.stringify(inventory));
                        localStorage.setItem('minova_inventory_history', JSON.stringify(inventoryHistory));
                        localStorage.setItem('minova_market_prices_v1', JSON.stringify(marketPrices));
                        localStorage.setItem('minova_sales_records_v1', JSON.stringify(salesRecords));
                        localStorage.setItem('minova_historical_inventory_v1', JSON.stringify(historicalInventory));
                        localStorage.setItem('minova_suppliers_v1', JSON.stringify(suppliers));
                        localStorage.setItem('minova_channel_partners_v1', JSON.stringify(channelPartners));
                        localStorage.setItem('minova_certification_requirements_v1', JSON.stringify(certificationRequirementsCatalog));
                        localStorage.setItem('minova_product_certification_evidence_v1', JSON.stringify(productCertificationEvidence));
                        localStorage.setItem('minova_product_master_detail_templates_v1', JSON.stringify(productMasterDetailTemplates));
                        localStorage.setItem('minova_subcategories_v1', JSON.stringify(subcategoriesByCategory));
                        localStorage.setItem('minova_profit_settings_v1', JSON.stringify(profitSettings));
                        localStorage.setItem('minova_installer_profit_v1', JSON.stringify(installerProfitSettings));
                        localStorage.setItem('minova_installer_quote_settings_v1', JSON.stringify(installerQuoteSettings));
                        localStorage.setItem('minova_non_stock_pricing_v1', JSON.stringify(nonStockPricingStrategies));
                    } catch (e) {}
                    companyCerts = embedded.data.companyCerts && typeof embedded.data.companyCerts === 'object' ? embedded.data.companyCerts : companyCerts;
                    transportRecords = Array.isArray(embedded.data.transportRecords) ? embedded.data.transportRecords : [];
                    fileDeleteLogs = Array.isArray(embedded.data.fileDeleteLogs) ? embedded.data.fileDeleteLogs : [];
                    compatibilityRules = Array.isArray(embedded.data.compatibilityRules) ? embedded.data.compatibilityRules : [];
                    try { localStorage.setItem('minova_compatibility_rules_v1', JSON.stringify(compatibilityRules)); } catch (e) {}
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
        try {
            const raw = localStorage.getItem('minova_compatibility_rules_v1');
            if (raw) compatibilityRules = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : compatibilityRules;
        } catch (e) {}
        try {
            const raw = localStorage.getItem('minova_certification_requirements_v1');
            if (raw && (!Array.isArray(certificationRequirementsCatalog) || certificationRequirementsCatalog.length === 0)) certificationRequirementsCatalog = normalizeCertificationRequirementsCatalog(JSON.parse(raw));
        } catch (e) {}
        try {
            const raw = localStorage.getItem('minova_product_certification_evidence_v1');
            if (raw) productCertificationEvidence = normalizeProductCertificationEvidenceList(JSON.parse(raw));
        } catch (e) {}
        try {
            const raw = localStorage.getItem('minova_product_master_detail_templates_v1');
            if (raw) productMasterDetailTemplates = normalizeProductMasterDetailTemplates(JSON.parse(raw));
        } catch (e) {}
        try {
            const raw = localStorage.getItem('minova_channel_partners_v1');
            if (raw) channelPartners = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : channelPartners;
        } catch (e) {}
        try {
            const raw = localStorage.getItem('minova_market_prices_v1');
            if (raw) marketPrices = normalizeMarketPrices(JSON.parse(raw));
        } catch (e) {}
        try {
            const raw = localStorage.getItem('minova_non_stock_pricing_v1');
            if (raw && (!nonStockPricingStrategies || Object.keys(nonStockPricingStrategies).length === 0)) {
                nonStockPricingStrategies = normalizeNonStockPricingStrategies(JSON.parse(raw));
            }
        } catch (e) {}
        normalizeProductUnitFields();
        try {
            const raw = localStorage.getItem('minova_suppliers_v1');
            if (raw && (!Array.isArray(suppliers) || suppliers.length === 0)) suppliers = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : suppliers;
        } catch (e) {}
        ensureSupplierData();
        function rebuildSubcategoryIndexFromProducts() {
            const map = {};
            products.forEach(p => {
                const cat = normalizeProductCategory(p.category, 'Uncategorized');
                const sub = normalizeProductSubcategory(p.scenario);
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
                    subcategoriesByCategory = normalizeSubcategoryMap(JSON.parse(raw) || {});
                    return;
                }
            } catch (e) {}
            rebuildSubcategoryIndexFromProducts();
            saveSubcategoryIndex();
        }
        window.updateSubcatSuggestions = () => {
            renderProductModalSubcategoryHistoryField(document.getElementById('m-scenario')?.value || '');
        };

        loadSubcategoryIndex();
        normalizeProductClassificationData();
        saveSubcategoryIndex();

        const TOP_LEVEL_TABS = ['quotation', 'database', 'engineering', 'pricelist', 'pvcalc', 'costcalc', 'inventory', 'transport', 'admin'];

        function getActiveTopLevelTab() {
            for (const tab of TOP_LEVEL_TABS) {
                const view = document.getElementById(`view-${tab}`);
                if (view && !view.classList.contains('hidden') && view.style.display !== 'none') return tab;
            }
            return 'database';
        }

        function renderTopLevelData(tab, opts = {}) {
            const key = String(tab || getActiveTopLevelTab());
            window.__minovaRenderedTabs = window.__minovaRenderedTabs || {};
            if (!opts.force && window.__minovaRenderedTabs[key]) return;
            try {
                if (key === 'database') {
                    renderSuppliers();
                    renderChannelPartners();
                    renderDb();
                    updateDatalists();
                } else if (key === 'engineering') {
                    renderEngineeringWorkspace();
                } else if (key === 'inventory') {
                    renderInventory();
                    renderNonStockPricingStrategies();
                    renderSalesRecords();
                    renderHistoricalInventory();
                    renderInventoryHistory();
                } else if (key === 'transport') {
                    renderTransport();
                } else if (key === 'pricelist') {
                    renderPriceList();
                } else if (key === 'costcalc') {
                    renderProfitSettingsUI();
                    renderCostCalcUI();
                } else if (key === 'quotation') {
                    updatePickerFilters();
                    updateDatalists();
                    try { renderQuoteSolarCustomerMode(); } catch (e) {}
                    renderPicker();
                    renderPriceListPicker();
                    try { renderPartBreakdown(); } catch (e) {}
                    try { calculateROI(); } catch (e) {}
                } else if (key === 'pvcalc') {
                    calculatePV();
                }
                window.__minovaRenderedTabs[key] = true;
            } catch (e) {
                console.warn(`Render failed for ${key}`, e);
            }
        }

        function scheduleDeferredTopLevelRenders() {
            if (window.__minovaDeferredRenderScheduled) return;
            window.__minovaDeferredRenderScheduled = true;
            const run = () => {
                window.__minovaDeferredRenderScheduled = false;
                const active = getActiveTopLevelTab();
                ['database', 'engineering', 'inventory', 'transport', 'pricelist', 'costcalc'].forEach(tab => {
                    if (tab !== active) renderTopLevelData(tab);
                });
            };
            if ('requestIdleCallback' in window) {
                window.requestIdleCallback(run, { timeout: 2500 });
            } else {
                setTimeout(run, 900);
            }
        }

        function refreshAfterDataChange() {
            window.__minovaRenderedTabs = {};
            updateDatalists();
            updatePickerFilters();
            try { renderCompanyCertUploadSelectors(); renderCompanyCertList(); } catch (e) {}
            try { if (getActiveTopLevelTab() === 'engineering') renderEngineeringWorkspace(); } catch (e) {}
            renderTopLevelData(getActiveTopLevelTab(), { force: true });
            scheduleDeferredTopLevelRenders();
        }

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
            marketPrices = normalizeMarketPrices(data?.marketPrices || marketPrices);
            normalizeProductUnitFields();
            if (inventoryHistory.length > 1000) inventoryHistory = inventoryHistory.slice(inventoryHistory.length - 1000);
            salesRecords = Array.isArray(data?.salesRecords) ? data.salesRecords : [];
            historicalInventory = Array.isArray(data?.historicalInventory) ? data.historicalInventory : [];
            suppliers = Array.isArray(data?.suppliers) ? data.suppliers : [];
            ensureSupplierData();
            channelPartners = normalizeChannelPartners(data?.channelPartners);
            compatibilityRules = normalizeCompatibilityRules(data?.compatibilityRules);
            const nextCertificationCatalog = normalizeCertificationRequirementsCatalog(data?.certificationRequirementsCatalog);
            if (nextCertificationCatalog.length || !certificationRequirementsCatalog.length) {
                certificationRequirementsCatalog = nextCertificationCatalog.length >= certificationRequirementsCatalog.length
                    ? nextCertificationCatalog
                    : mergeCertificationRequirementsCatalog(certificationRequirementsCatalog, nextCertificationCatalog);
            }
            productCertificationEvidence = normalizeProductCertificationEvidenceList(data?.productCertificationEvidence);
            productMasterDetailTemplates = normalizeProductMasterDetailTemplates(data?.productMasterDetailTemplates);
            subcategoriesByCategory = data?.subcategoriesByCategory && typeof data.subcategoriesByCategory === 'object' ? data.subcategoriesByCategory : {};
            profitSettings = normalizeProfitSettings(data?.profitSettings || profitSettings || null);
            installerProfitSettings = normalizeInstallerProfitSettings(data?.installerProfitSettings || installerProfitSettings || null);
            installerQuoteSettings = normalizeInstallerQuoteSettings(data?.installerQuoteSettings || installerQuoteSettings || null);
            nonStockPricingStrategies = normalizeNonStockPricingStrategies(data?.nonStockPricingStrategies || nonStockPricingStrategies || {});
            normalizeProductClassificationData();
            try {
                if (stampMs) localStorage.setItem('minova_embedded_updatedAt', String(stampMs));
                localStorage.setItem('minova_products', JSON.stringify(products));
                localStorage.setItem('minova_inventory', JSON.stringify(inventory));
                localStorage.setItem('minova_inventory_history', JSON.stringify(inventoryHistory));
                localStorage.setItem('minova_market_prices_v1', JSON.stringify(marketPrices));
                localStorage.setItem('minova_sales_records_v1', JSON.stringify(salesRecords));
                localStorage.setItem('minova_historical_inventory_v1', JSON.stringify(historicalInventory));
                localStorage.setItem('minova_suppliers_v1', JSON.stringify(suppliers));
                localStorage.setItem('minova_channel_partners_v1', JSON.stringify(channelPartners));
                localStorage.setItem('minova_compatibility_rules_v1', JSON.stringify(compatibilityRules));
                localStorage.setItem('minova_certification_requirements_v1', JSON.stringify(certificationRequirementsCatalog));
                localStorage.setItem('minova_product_certification_evidence_v1', JSON.stringify(productCertificationEvidence));
                localStorage.setItem('minova_product_master_detail_templates_v1', JSON.stringify(productMasterDetailTemplates));
                localStorage.setItem('minova_subcategories_v1', JSON.stringify(subcategoriesByCategory));
                localStorage.setItem('minova_profit_settings_v1', JSON.stringify(profitSettings));
                localStorage.setItem('minova_installer_profit_v1', JSON.stringify(installerProfitSettings));
                localStorage.setItem('minova_installer_quote_settings_v1', JSON.stringify(installerQuoteSettings));
                localStorage.setItem('minova_non_stock_pricing_v1', JSON.stringify(nonStockPricingStrategies));
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
            applyInstallerProfitSettingsToUi();
            applyInstallerQuoteSettingsToUi();
            try { recalcInstallerQuote(); } catch (e) {}
            suppressGitHubSync = false;
            refreshAfterDataChange();
        }

        async function tryLoadPublishedState(force = false, allowWhenConnected = false) {
            try {
                if (window.location.protocol === 'file:') return false;
                const isConnected = !!window.__minovaSync?.getStatus?.()?.connected;
                if (isConnected && !allowWhenConnected) return false;
                if (window.__minovaD1BusinessPrimary && !allowWhenConnected) return false;
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
            if (window.location.protocol === 'file:') return;
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
            ensureSupplierData();
            normalizeProductClassificationData();
            localStorage.setItem('minova_products', JSON.stringify(products));
            localStorage.setItem('minova_inventory', JSON.stringify(inventory));
            localStorage.setItem('minova_inventory_history', JSON.stringify(inventoryHistory));
            marketPrices = normalizeMarketPrices(marketPrices);
            localStorage.setItem('minova_market_prices_v1', JSON.stringify(marketPrices));
            localStorage.setItem('minova_sales_records_v1', JSON.stringify(salesRecords));
            localStorage.setItem('minova_historical_inventory_v1', JSON.stringify(historicalInventory));
            localStorage.setItem('minova_suppliers_v1', JSON.stringify(suppliers));
            channelPartners = normalizeChannelPartners(channelPartners);
            localStorage.setItem('minova_channel_partners_v1', JSON.stringify(channelPartners));
            localStorage.setItem('minova_company_certs', JSON.stringify(companyCerts));
            compatibilityRules = normalizeCompatibilityRules(compatibilityRules);
            certificationRequirementsCatalog = normalizeCertificationRequirementsCatalog(certificationRequirementsCatalog);
            productCertificationEvidence = normalizeProductCertificationEvidenceList(productCertificationEvidence);
            productMasterDetailTemplates = normalizeProductMasterDetailTemplates(productMasterDetailTemplates);
            try { localStorage.setItem('minova_compatibility_rules_v1', JSON.stringify(compatibilityRules)); } catch (e) {}
            try { localStorage.setItem('minova_certification_requirements_v1', JSON.stringify(certificationRequirementsCatalog)); } catch (e) {}
            try { localStorage.setItem('minova_product_certification_evidence_v1', JSON.stringify(productCertificationEvidence)); } catch (e) {}
            try { localStorage.setItem('minova_product_master_detail_templates_v1', JSON.stringify(productMasterDetailTemplates)); } catch (e) {}
            try { localStorage.setItem('minova_transport_records_v1', JSON.stringify(transportRecords)); } catch (e) {}
            try { localStorage.setItem('minova_file_delete_logs_v1', JSON.stringify(fileDeleteLogs)); } catch (e) {}
            rebuildSubcategoryIndexFromProducts();
            saveSubcategoryIndex();
            ensureProfitSettingsCoverage();
            nonStockPricingStrategies = normalizeNonStockPricingStrategies(nonStockPricingStrategies);
            try { localStorage.setItem('minova_profit_settings_v1', JSON.stringify(profitSettings)); } catch (e) {}
            try { localStorage.setItem('minova_installer_quote_settings_v1', JSON.stringify(normalizeInstallerQuoteSettings(installerQuoteSettings))); } catch (e) {}
            try { localStorage.setItem('minova_installer_profit_v1', JSON.stringify(normalizeInstallerProfitSettings(installerProfitSettings))); } catch (e) {}
            try { localStorage.setItem('minova_non_stock_pricing_v1', JSON.stringify(nonStockPricingStrategies)); } catch (e) {}
            refreshAfterDataChange();
            try { if (!suppressGitHubSync) window.__minovaSync?.enqueueSnapshot('state update'); } catch (e) {}
        }

        window.getMinovaBusinessStateSnapshot = () => ({
            v: 1,
            updatedAt: new Date().toISOString(),
            data: {
                products,
                suppliers,
                channelPartners,
                inventory,
                inventoryHistory,
                marketPrices,
                salesRecords,
                historicalInventory,
                transportRecords,
                compatibilityRules,
                certificationRequirementsCatalog,
                productCertificationEvidence,
                productMasterDetailTemplates,
                subcategoriesByCategory,
                profitSettings,
                installerProfitSettings,
                installerQuoteSettings,
                nonStockPricingStrategies
            }
        });

        window.applyBusinessDataFromD1 = (data = {}, quoteIndex = null) => {
            window.__minovaD1BusinessPrimary = true;
            const merged = {
                ...data,
                companyCerts,
                fileDeleteLogs
            };
            applyStateFromData(merged, Date.now());
            if (quoteIndex && typeof window.applyD1QuoteIndex === 'function') {
                window.applyD1QuoteIndex(quoteIndex);
            }
        };

        function cloneForD1(value) {
            try { return JSON.parse(JSON.stringify(value || {})); } catch (e) { return value || {}; }
        }

        function persistEntityToD1(domain, recordId, payload, options = {}) {
            try {
                if (!domain || !recordId || !payload || !window.__minovaBusiness?.upsertEntity) return;
                window.__minovaBusiness.upsertEntity(domain, String(recordId), cloneForD1(payload), options);
            } catch (e) {
                console.warn('D1 entity save queued/failed:', domain, recordId, e);
            }
        }

        function deleteEntityFromD1(domain, recordId) {
            try {
                if (!domain || !recordId || !window.__minovaBusiness?.deleteEntity) return;
                window.__minovaBusiness.deleteEntity(domain, String(recordId));
            } catch (e) {
                console.warn('D1 entity delete queued/failed:', domain, recordId, e);
            }
        }

        function persistSettingsToD1(settings) {
            try {
                if (!settings || !window.__minovaBusiness?.saveSettings) return;
                window.__minovaBusiness.saveSettings(cloneForD1(settings));
            } catch (e) {
                console.warn('D1 settings save queued/failed:', e);
            }
        }

        function persistQuoteSettingsToD1() {
            try {
                profitSettings = normalizeProfitSettings(profitSettings || null);
                installerProfitSettings = normalizeInstallerProfitSettings(installerProfitSettings || null);
                installerQuoteSettings = normalizeInstallerQuoteSettings(installerQuoteSettings || null);
                persistSettingsToD1({
                    profit_settings: profitSettings,
                    installer_profit_settings: installerProfitSettings,
                    installer_quote_settings: installerQuoteSettings
                });
            } catch (e) {
                console.warn('D1 quote settings save queued/failed:', e);
            }
        }

        function persistInventoryStateToD1() {
            try {
                if (!window.__minovaBusiness?.upsertEntities) return;
                const items = [
                    ...(Array.isArray(inventory) ? inventory : []).map(record => ({ domain: 'inventory', recordId: record.id, payload: record })),
                    ...(Array.isArray(inventoryHistory) ? inventoryHistory : []).map((record, index) => ({ domain: 'inventory_history', recordId: String(record.id || [record.ts, record.type, record.productId, record.batchNo, index].filter(Boolean).join(':')), payload: record })),
                    ...(Array.isArray(salesRecords) ? salesRecords : []).map(record => ({ domain: 'sales_record', recordId: record.id, payload: record })),
                    ...(Array.isArray(historicalInventory) ? historicalInventory : []).map((record, index) => ({ domain: 'historical_inventory', recordId: String(record.id || [record.ts, record.productId, record.batchNo, index].filter(Boolean).join(':')), payload: record }))
                ].filter(item => item.recordId);
                if (items.length) window.__minovaBusiness.upsertEntities(items);
            } catch (e) {
                console.warn('D1 inventory save queued/failed:', e);
            }
        }

        function persistMarketPricesToD1() {
            try {
                if (window.__minovaBusiness?.upsertEntities) {
                    const items = (marketPrices?.records || []).map(record => ({ domain: 'market_price', recordId: record.id, payload: record })).filter(item => item.recordId);
                    if (items.length) window.__minovaBusiness.upsertEntities(items);
                }
                persistSettingsToD1({
                    market_price_settings: {
                        categoryUnits: marketPrices?.categoryUnits || {},
                        deletedRecordIds: marketPrices?.deletedRecordIds || []
                    }
                });
            } catch (e) {
                console.warn('D1 market price save queued/failed:', e);
            }
        }

        let quoteRows = [{ id: Date.now(), description: '', vendor: '', spec: '', batchNo: '', quantity: 1, price: 0, cost: 0, productId: '', inventoryId: '' }];
        let dbGroupMode = 'category';
        let supplierStageFilter = 'all';
        let supplierSortMode = 'score_desc';
        let currentLang = 'en';
        let currentCurrency = 'MYR';
        let paymentTermsConfirmed = true;
        let quoteSplit = { enabled: false, afterRowId: null };
        let validityDays = 30;
        window.__getQuoteRows = () => quoteRows;
        window.__setQuoteRows = (rows) => {
            quoteRows = Array.isArray(rows) ? rows : [];
            window.quoteRows = quoteRows;
        };
        window.__getQuoteCurrency = () => currentCurrency;
        window.__getQuoteRate = () => parseFloat(document.getElementById('rate-myr-cny')?.value) || 1.53;
        window.__getValidityDays = () => validityDays;
        window.__setValidityDays = (n) => {
            const v = parseInt(n, 10);
            if (Number.isInteger(v) && v >= 1 && v <= 999) validityDays = v;
            renderValidityBadge();
        };
        const apiKey = "";
        const QUOTE_TERMS_DEFAULT_EN = "I.   Price                   : Price quoted as above are strictly for the above project with the models & quantity stated only.\nII.  Payment                 : Strictly base on Payment Terms above\nIII. Validity                : 30 days\nIV.  Delivery & Installation : As above unless stated otherwise, upon confirmation of date and time.\nV.   Order Amendments        : No cancellation or variation of an accepted customer's order shall be valid\n                               unless agreed upon in writing.\nVI.  Warranty Period         : 𝐈𝐧𝐯𝐞𝐫𝐭𝐞𝐫 - 60 months (5 years) upon installation date.\n                               𝐁𝐚𝐭𝐭𝐞𝐫𝐲 (if applicable) - 60 months (5 years) upon installation date.\nVII. Warranty Conditions     : The item is warranted against defects arising from faulty design or\n                               manufacturing defects for the period expressly stated in the Terms\n                               and Conditions in writing, except that no warranty is offered by\n                               SELLER in the case of:\n                               a. Replacement or repairs necessitated by normal wear and tear of\n                                  Goods, damage caused by lack of care, insufficient inspection or\n                                  maintenance, improper storage or use of Goods, or failure to follow\n                                  instructions on use, inspection, storage, or maintenance;\n                               b. Goods that have been repaired or modified by buyer or by third parties\n                               c. This warranty is limited to the repair, modification or replacement\n                                  subject to assessment.";
        const QUOTE_TERMS_WRAP_PREVIOUS_DEFAULT_EN = "I.   Price                   : Price quoted as above are strictly for the above project with the models & quantity stated only.\nII.  Payment                 : Strictly base on Payment Terms above\nIII. Validity                : 30 days\nIV.  Delivery & Installation : As above unless stated otherwise, upon confirmation of date and time.\nV.   Order Amendments        : No cancellation or variation of an accepted customer's order shall be valid unless agreed upon in writing.\nVI.  Warranty Period         : 𝐈𝐧𝐯𝐞𝐫𝐭𝐞𝐫 - 60 months (5 years) upon installation date.\n                               𝐁𝐚𝐭𝐭𝐞𝐫𝐲 (if applicable) - 60 months (5 years) upon installation date.\nVII. Warranty Conditions     : The item is warranted against defects arising from faulty design or\n                               manufacturing defects for the period expressly stated in the Terms\n                               and Conditions in writing, except that no warranty is offered by\n                               SELLER in the case of:\n                               a. Replacement or repairs necessitated by normal wear and tear of\n                                  Goods, damage caused by lack of care, insufficient inspection or\n                                  maintenance, improper storage or use of Goods, or failure to follow\n                                  instructions on use, inspection, storage, or maintenance;\n                               b. Goods that have been repaired or modified by buyer or by third parties\n                               c. This warranty is limited to the repair, modification or replacement subject to assessment.";
        const QUOTE_TERMS_ALIGNED_PREVIOUS_DEFAULT_EN = "I.   Price                   : Price quoted as above are strictly for the above project with the models & quantity stated only.\nII.  Payment                 : Strictly base on Payment Terms above\nIII. Validity                : 30 days\nIV.  Delivery & Installation : As above unless stated otherwise, upon confirmation of date and time.\nV.   Order Amendments        : No cancellation or variation of an accepted customer's order shall be valid unless agreed upon in writing.\nVI.  Warranty Period         : 𝐈𝐧𝐯𝐞𝐫𝐭𝐞𝐫 - 60 months (5 years) upon installation date.\n                               𝐁𝐚𝐭𝐭𝐞𝐫𝐲 (if applicable) - 60 months (5 years) upon installation date.\nVII. Warranty Conditions     : The item is warranted against defects arising from faulty design or manufacturing defects for the period\n                               expressly stated in the Terms and Conditions in writing, except that no warranty is offered by SELLER in the case of:\n                               a. Replacement or repairs necessitated by normal wear and tear of Goods, damage caused by lack of care,\n                                  insufficient inspection or maintenance, improper storage or use of Goods, or failure to follow instructions\n                                  on use, inspection, storage, or maintenance;\n                               b. Goods that have been repaired or modified by buyer or by third parties\n                               c. This warranty is limited to the repair, modification or replacement subject to assessment.";
        const QUOTE_TERMS_PREVIOUS_DEFAULT_EN = "I.   Price                   : Price quoted as above are strictly for the above project with the models & quantity stated only.\nII.  Payment                 : Strictly base on Payment Terms above\nIII. Validity                : 30 days\nIV.  Delivery & Installation : As above unless stated otherwise, upon confirmation of date and time.\nV.   Order Ammendments       : No cancellation or variation of an accepted customer's order shall be valid unless agreed upon in writing.\n\nVI.  Warranty Period         : Inverter - 60 months (5 years) upon installation date.\n                               Battery (if applicable) - 60 months (5 years) upon installation date.\nVII. Warranty Conditions     : The item against any defects in from faulty design or manufacturing defects, for a period to be expressly\n                               stated in the Terms and Conditions in writing, except that no warranty is offered by SELLER in the case of:\n                               a. Replacement or repairs necessitated by the normal wear and tear of Goods or by damage caused by lack of care,\n                                  insufficient inspection or maintenance or the improper storage of use of Goods (including failure to follow any instructions\n                                  on use, inspection, storage, or maintained);\n                               b. Goods that have been repaired or modified by buyer or by third parties\n                               c. This warranty is limited to the repair, modification or replacement subject to assessment.";
        const QUOTE_TERMS_LEGACY_DEFAULT_EN = "Terms:\nThis quotation is subject to a thorough site assessment. Costs may vary if non-standard installation is required, including but not limited to additional hacking, cabling, trunking, customization, or any work outside the standard installation scope.\n\nConfirmation:\nI / We, the undersigned, hereby accept the Solar PV with Battery + Inverter System and the aforementioned price, specifications, terms and conditions, and agree for Minova Holdings Sdn. Bhd. to commence the system design, procurement and installation.";
        const QUOTE_TERMS_OLD_DEFAULT_ZH = "条款：\n本Quote以现场全面勘察为准。如需采用非标准安装Method（包括但不限于额外开槽/破拆, 布线, 线槽/桥架, 定制加工或任何超出标准安装范围的工作），费用可能调整。\n\n确认：\n本人/本公司（签署人）确认接受“光伏+Battery+Inverter系统”及上述价格, Spec, 条款与条件，并同意由 Minova Holdings Sdn. Bhd. 开始进行系统设计, 采购与安装。";
        const QUOTE_TERMS_OLD_DEFAULT_EN = "Conditions:\nThis quotation is subject to a thorough site assessment. The cost may vary if non-standard installation is applied which require additional hacking, cabling, trunking, customization, or any other out of our standard installation.\n\nConfirmation:\nI / We, the undersigned hereby accept the Solar PV with Battery + Inverter System and the aforementioned price, specification, terms and conditions and would like to commence with the design, procurement and installation of the system by Minova Holdings. Sdn. Bhd.";
        const normalizeQuoteTermsDefaultText = (value, fallback = QUOTE_TERMS_DEFAULT_EN) => {
            const raw = String(value ?? '');
            const norm = raw.replace(/\r\n/g, '\n').trim();
            if (!norm) return fallback;
            if (norm === QUOTE_TERMS_WRAP_PREVIOUS_DEFAULT_EN.trim() || norm === QUOTE_TERMS_ALIGNED_PREVIOUS_DEFAULT_EN.trim() || norm === QUOTE_TERMS_PREVIOUS_DEFAULT_EN.trim() || norm === QUOTE_TERMS_LEGACY_DEFAULT_EN.trim() || norm === QUOTE_TERMS_OLD_DEFAULT_ZH.trim() || norm === QUOTE_TERMS_OLD_DEFAULT_EN.trim()) return fallback;
            return raw;
        };
        try {
            const savedSplit = localStorage.getItem('minova_quote_split');
            if (savedSplit) {
                const parsed = JSON.parse(savedSplit);
                quoteSplit = { enabled: !!parsed.enabled, afterRowId: parsed.afterRowId ?? null };
            }
        } catch (e) {}

        const i18n = {
            zh: {
                title: "Quotation", toCustomer: "致客户：", quoteNo: "单据编号:", quoteDate: "Quote日期:",
                thDesc: "产品", thVendor: "品牌", thSpec: "Spec Model", thBatch: "Purchase Batch", thQty: "Quantity", thPrice: "单价", thMargin: "毛利%", thAmount: "小计",
                terms: "Proposal Acceptance, Terms & Conditions", totalItems: "Item总数", avgMargin: "平均毛利率", grandTotal: "应付总额",
                authSign: "批准人签名", signDate: "日期",
                termPlaceholder: "I.   Price                   : Price quoted as above...",
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
                shippingHandling: "Transport与装卸",
                included: "INCLUDED",
                customerNamePlaceholder: "输入客户公司",
                customerContactPlaceholder: "Contact/职位",
                siteAddressLabel: "Site Address：",
                siteAddressPlaceholder: "填写现场地址",
                validityLabel: "Quote有效期：",
                validityUnit: "天",
                validityError: "请输入 1-999 之间的整数",
                signature: "签名",
                fullName: "姓名",
                contactNumber: "联系电话",
                email: "邮箱",
                nricPassport: "身份证/护照",
                signatureDate: "日期",
                termsDefault: QUOTE_TERMS_DEFAULT_EN,
                siteOverview: {
                    uploadBg: "上传背景",
                    addPv: "添加PV",
                    addComp: "OtherModule",
                    copy: "复制",
                    del: "Delete",
                    toTop: "置顶",
                    moveUp: "上移",
                    rotL: "左90°",
                    rotR: "右90°",
                    undo: "撤销",
                    redo: "重做",
                    clearMarks: "清除标注",
                    deleteMarks: "Delete标注",
                    clearAll: "清除All",
                    toolbarMode: "模式",
                    toolbarSelect: "SelectModule",
                    toolbarMarks: "Select标注",
                    toolbarDist: "测距",
                    toolbarArea: "面积",
                    toolbarEditVertices: "编辑顶点",
                    toolbarScaleLock: "缩放锁定",
                    toolbarMoveLock: "移动锁定",
                    toolbarRulers: "标尺",
                    toolbarSnap: "磁吸",
                    toolbarGrid: "网格",
                    cardModule: "Module",
                    cardText: "文字",
                    cardMeasure: "测距/面积",
                    moduleRoof: "屋顶 (m)",
                    moduleDims: "Module (m)",
                    qty: "Quantity",
                    opacity: "透明度",
                    vertexLock: "顶点锁定",
                    textSize: "字号",
                    textWeight: "粗细",
                    weightThin: "极细",
                    weightReg: "细",
                    weightSemi: "中",
                    weightBold: "粗",
                    textColor: "字色",
                    bg: "底色",
                    noBg: "None背景",
                    content: "内容",
                    distColor: "颜色",
                    distMarker: "端点",
                    markerCross: "十",
                    markerDot: "点",
                    markerDiamond: "菱",
                    markerArrowA: "起点箭头",
                    markerArrowB: "终点箭头",
                    markerArrowAB: "双端箭头",
                    distConstraint: "约束",
                    constraintFree: "自由",
                    constraintH: "水平",
                    constraintV: "垂直",
                    areaBg: "底色",
                    areaVerts: "顶点",
                    areaOpacity: "透明",
                    areaHatch: "底纹",
                    hatchSolid: "纯色",
                    hatchDiag: "斜线",
                    hatchCross: "交叉",
                    hatchGrid: "网格",
                    areaText: "文字",
                    customTitle: "添加OtherModule",
                    customText: "文字",
                    customShape: "图形",
                    shapeRect: "矩形",
                    shapeCircle: "圆形",
                    shapeTriangle: "三角形",
                    shapeDiamond: "菱形",
                    shapeHex: "六边形",
                    shapeArrow: "箭头",
                    shapePolygon: "多边形",
                    customPolyVerts: "顶点数",
                    customVLock: "顶点锁定",
                    customBg: "背景色",
                    customNoBg: "None背景",
                    customFg: "字体色",
                    cancel: "Cancel",
                    add: "添加"
                }
            },
            en: {
                title: "QUOTATION", toCustomer: "To Customer:", quoteNo: "Quote No.:", quoteDate: "Date:",
                thDesc: "Description", thVendor: "Brand", thSpec: "Specification", thBatch: "Batch", thQty: "Qty", thPrice: "Unit Price", thMargin: "Margin%", thAmount: "Amount",
                terms: "Proposal Acceptance, Terms & Conditions", totalItems: "Total Items", avgMargin: "Avg Margin", grandTotal: "Grand Total",
                authSign: "Authorized Signature", signDate: "Date",
                termPlaceholder: "I.   Price                   : Price quoted as above...",
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
                included: "INCLUDED",
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
                termsDefault: QUOTE_TERMS_DEFAULT_EN,
                siteOverview: {
                    uploadBg: "Upload BG",
                    addPv: "Add PV",
                    addComp: "Add Comp",
                    copy: "Copy",
                    del: "Delete",
                    toTop: "To Top",
                    moveUp: "Up",
                    rotL: "Left 90°",
                    rotR: "Right 90°",
                    undo: "Undo",
                    redo: "Redo",
                    clearMarks: "Clear Marks",
                    deleteMarks: "Delete Marks",
                    clearAll: "Clear All",
                    toolbarMode: "Mode",
                    toolbarSelect: "Select",
                    toolbarMarks: "Marks",
                    toolbarDist: "Dist",
                    toolbarArea: "Area",
                    toolbarEditVertices: "Edit vertices",
                    toolbarScaleLock: "Scale lock",
                    toolbarMoveLock: "Move lock",
                    toolbarRulers: "Rulers",
                    toolbarSnap: "Snap",
                    toolbarGrid: "Grid",
                    cardModule: "Module",
                    cardText: "Text",
                    cardMeasure: "Distance / Area",
                    moduleRoof: "Roof (m)",
                    moduleDims: "Module (m)",
                    qty: "Qty",
                    opacity: "Opacity",
                    vertexLock: "Vertex lock",
                    textSize: "Size",
                    textWeight: "Weight",
                    weightThin: "Thin",
                    weightReg: "Regular",
                    weightSemi: "Semi",
                    weightBold: "Bold",
                    textColor: "Text",
                    bg: "BG",
                    noBg: "No BG",
                    content: "Content",
                    distColor: "Color",
                    distMarker: "Marker",
                    markerCross: "Cross",
                    markerDot: "Dot",
                    markerDiamond: "Diamond",
                    markerArrowA: "Arrow A",
                    markerArrowB: "Arrow B",
                    markerArrowAB: "Double",
                    distConstraint: "Constraint",
                    constraintFree: "Free",
                    constraintH: "Horizontal",
                    constraintV: "Vertical",
                    areaBg: "BG",
                    areaVerts: "Verts",
                    areaOpacity: "Opacity",
                    areaHatch: "Hatch",
                    hatchSolid: "Solid",
                    hatchDiag: "Diag",
                    hatchCross: "Cross",
                    hatchGrid: "Grid",
                    areaText: "Text",
                    customTitle: "Add Component",
                    customText: "Text",
                    customShape: "Shape",
                    shapeRect: "Rect",
                    shapeCircle: "Circle",
                    shapeTriangle: "Triangle",
                    shapeDiamond: "Diamond",
                    shapeHex: "Hex",
                    shapeArrow: "Arrow",
                    shapePolygon: "Polygon",
                    customPolyVerts: "Verts",
                    customVLock: "Vertex lock",
                    customBg: "Background",
                    customNoBg: "No BG",
                    customFg: "Text color",
                    cancel: "Cancel",
                    add: "Add"
                }
            }
        };

        // --- Core UI Logic ---
        window.hideGlobalTooltip = () => {
            const tooltip = document.getElementById('global-tooltip');
            if (!tooltip) return;
            tooltip.classList.add('hidden');
            tooltip.innerHTML = '';
            tooltip.style.left = '';
            tooltip.style.top = '';
            tooltip.style.width = '';
            tooltip.style.maxWidth = '';
        };
        window.hidePriceListTooltip = window.hideGlobalTooltip;
        window.switchTab = (tab) => {
            window.hideGlobalTooltip?.();
            const localFileMode = window.location.protocol === 'file:';
            const connected = !!window.__minovaSync?.getStatus?.()?.connected;
            const authMode = !!window.__minovaAuth?.state?.user || document.body.classList.contains('minova-authenticated');
            const restrictedTabs = ['quotation', 'costcalc', 'database', 'engineering', 'pricelist', 'inventory', 'transport'];
            if (restrictedTabs.includes(tab) && !connected && !localFileMode && !authMode) {
                tab = 'pvcalc';
            }
            const tabs = TOP_LEVEL_TABS;
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
            renderTopLevelData(tab, { force: true });
            if(tab === 'costcalc') {
                const rateBtn = document.getElementById('btn-fetch-rate');
                if(rateBtn) fetchLiveRate(rateBtn);
            }
            if(tab === 'pricelist') {
                const rateBtn = document.getElementById('btn-fetch-rate');
                if(rateBtn) {
                    fetchLiveRate(rateBtn).finally(() => {
                        if (getActiveTopLevelTab() === 'pricelist') renderPriceList();
                    });
                }
            }
            if (tab === 'inventory') {
                window.refreshInventoryLiveFx?.({ render: true });
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

        window.renderCurrencyButton = () => {
            const btn = document.getElementById('btn-currency');
            if (!btn) return;
            btn.textContent = currentCurrency === 'CNY' ? '¥ / RM' : 'RM / ¥';
        };

        window.toggleCurrency = () => {
            currentCurrency = currentCurrency === 'CNY' ? 'MYR' : 'CNY';
            window.renderCurrencyButton?.();
            renderQuote();
        };

        window.toggleLanguage = () => {
            currentLang = 'en';
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

        window.resetPaymentTermsToDefault = () => {
            const c = document.getElementById('payment-confirmation-percent');
            const i = document.getElementById('payment-installation-percent');
            const t = document.getElementById('payment-testing-percent');
            const f = document.getElementById('payment-final-percent');
            if (c) c.value = 30;
            if (i) i.value = 40;
            if (t) t.value = 30;
            if (f) f.value = 0;

            const finalContainer = document.getElementById('payment-final-container');
            const addBtn = document.getElementById('btn-add-payment');
            if (finalContainer) finalContainer.classList.add('hidden');
            if (addBtn) addBtn.classList.remove('hidden');

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
                const t = i18n[currentLang];
                const label = document.getElementById('lbl-final');
                if (label && !String(label.value || '').trim()) {
                    label.value = t.final;
                }
                try { autosizeAllTextareas(container); } catch (e) {}
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
                btn.title = disabled ? 'QuoteDetails为空，None法分割' : '在QuoteDetails与Remark条款之间插入分割线，并在打印/PDF中分页';
            }

            if (lbl) lbl.textContent = quoteSplit.enabled ? 'Cancel分割' : '从此分割';
            if (preview) preview.classList.toggle('hidden', !quoteSplit.enabled);
            if (afterDetails) afterDetails.dataset.splitEnabled = quoteSplit.enabled ? 'true' : 'false';
        }

        window.toggleQuoteSplit = () => {
            if (isQuoteEffectivelyEmpty()) return alert('QuoteDetails为空，None法分割。请先添加Quote内容。');
            if (!quoteSplit.enabled) {
                if (!confirm('确定在QuoteDetails与Remark条款之间插入分割线，并在打印/PDF中从新页开始显示下方内容吗？')) return;
                quoteSplit.enabled = true;
                quoteSplit.afterRowId = quoteRows[quoteRows.length - 1]?.id || null;
                saveQuoteSplit();
                normalizeQuoteSplit();
                renderQuote();
                updateQuoteSplitUI();
                return;
            }
            if (!confirm('确定Cancel分割线吗？')) return;
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

        function quoteResolveProductForRow(row) {
            const r = row && typeof row === 'object' ? row : {};
            const productId = String(r.productId || '').trim();
            if (productId) {
                const product = (Array.isArray(products) ? products : []).find(p => String(p?.id || '') === productId);
                if (product) return product;
            }
            const inventoryId = String(r.inventoryId || '').trim();
            if (inventoryId) {
                const item = (Array.isArray(inventory) ? inventory : []).find(i => String(i?.id || '') === inventoryId);
                if (item) {
                    const product = (Array.isArray(products) ? products : []).find(p => String(p?.id || '') === String(item.productId || ''));
                    if (product) return product;
                }
            }
            return null;
        }

        function quoteResolveSupplierForRow(row) {
            const r = row && typeof row === 'object' ? row : {};
            return getSupplierByCode(r.supplierCode)
                || getProductSupplier(quoteResolveProductForRow(r))
                || findSupplierByDisplayName(r.vendor || '')
                || null;
        }

        function quoteSupplierAutoNameSet(supplier) {
            const labels = [
                getSupplierDisplayName(supplier),
                getSupplierDisplayNameForLang(supplier, 'zh'),
                getSupplierDisplayNameForLang(supplier, 'en'),
                supplier?.nameZh,
                supplier?.nameCn,
                supplier?.nameEn,
                supplier?.name,
                supplier?.code
            ];
            return new Set(labels.map(v => String(v || '').trim()).filter(Boolean));
        }

        function quoteBrandDisplayForRow(row) {
            const r = row && typeof row === 'object' ? row : {};
            const supplier = quoteResolveSupplierForRow(r);
            if (!supplier) return String(r.vendor || '').trim();
            const current = String(r.vendor || '').trim();
            const autoNames = quoteSupplierAutoNameSet(supplier);
            const isManual = !!r.vendorManualOverride && current && !autoNames.has(current);
            if (isManual) return current;
            const next = getSupplierDisplayNameForLang(supplier, currentLang);
            if (next) {
                r.supplierCode = r.supplierCode || supplier.code || '';
                r.vendor = next;
                r.vendorManualOverride = false;
                return next;
            }
            return current;
        }

        function normalizeQuoteShippingIncludedText(value) {
            const raw = String(value ?? '').trim();
            if (!raw || ['已包含', '以包含', 'included'].includes(raw.toLowerCase())) return 'INCLUDED';
            return raw;
        }
        window.normalizeQuoteShippingIncludedText = normalizeQuoteShippingIncludedText;

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
            const authSignEl = document.getElementById('lbl-auth-sign');
            if (authSignEl) authSignEl.textContent = t.authSign;
            const signDateEl = document.getElementById('lbl-sign-date');
            if (signDateEl) signDateEl.textContent = t.signDate;

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
                    localStorage.setItem(`minova_terms_text_${prevLang}`, normalizeQuoteTermsDefaultText(termsEl.value, t.termsDefault));
                    const storedVal = localStorage.getItem(`minova_terms_text_${currentLang}`);
                    const nextVal = storedVal == null ? t.termsDefault : normalizeQuoteTermsDefaultText(storedVal, t.termsDefault);
                    localStorage.setItem(`minova_terms_text_${currentLang}`, nextVal);
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
                    localStorage.setItem(`minova_shipping_${prevLang}`, normalizeQuoteShippingIncludedText(shipEl.value));
                    const storedShipping = localStorage.getItem(`minova_shipping_${currentLang}`);
                    const nextShipping = normalizeQuoteShippingIncludedText(storedShipping ?? t.included);
                    localStorage.setItem(`minova_shipping_${currentLang}`, nextShipping);
                    shipEl.value = nextShipping;
                } catch (e) {
                    shipEl.value = t.included;
                }
                shipEl.dataset.lang = currentLang;
                shipEl.dataset.dirty = 'false';
            }

            renderValidityBadge();
            calculateQuote();

            document.querySelectorAll('.unit-days').forEach(el => el.textContent = t.daysUnit);

            const langButton = document.getElementById('btn-lang');
            if (langButton) langButton.textContent = 'English';
            renderQuote();

            const p2 = document.getElementById('lbl-page2-title');
            if(p2) p2.textContent = currentLang === 'zh' ? '投资回报分析' : 'FINANCIAL ANALYSIS';
            const p3 = document.getElementById('lbl-page3-title');
            if(p3) p3.innerHTML = currentLang === 'zh' ? '产品Details与质保' : 'PART BREAKDOWN<br>&amp; WARRANTY';
            const p4 = document.getElementById('lbl-page4-title');
            if(p4) p4.textContent = currentLang === 'zh' ? '参考信息' : 'REFERENCE';
            const p5 = document.getElementById('lbl-page5-title');
            if(p5) p5.textContent = currentLang === 'zh' ? '现场概览' : 'SITE OVERVIEW';

            const so = t.siteOverview;
            if (so) {
                const set = (id, v) => {
                    const el = document.getElementById(id);
                    if (el) el.textContent = String(v ?? '');
                };
                const setOpt = (selectId, value, label) => {
                    const sel = document.getElementById(selectId);
                    if (!sel) return;
                    const opt = Array.from(sel.options || []).find(o => String(o.value) === String(value));
                    if (opt) opt.textContent = String(label ?? '');
                };

                set('so-btn-upload', so.uploadBg);
                set('so-btn-add-pv', so.addPv);
                set('so-btn-add-custom', so.addComp);
                set('so-btn-copy', so.copy);
                set('so-btn-delete', so.del);
                set('so-btn-to-top', so.toTop);
                set('so-btn-move-up', so.moveUp);
                set('so-btn-rot-l', so.rotL);
                set('so-btn-rot-r', so.rotR);
                set('so-btn-undo', so.undo);
                set('so-btn-redo', so.redo);
                set('so-btn-clear-measures', so.clearMarks);
                set('so-btn-delete-measures', so.deleteMarks);
                set('so-btn-clear-all', so.clearAll);

                set('so-toolbar-mode', so.toolbarMode);
                set('so-toolbar-lock-scale', so.toolbarScaleLock);
                set('so-toolbar-lock-move', so.toolbarMoveLock);
                set('so-toolbar-rulers', so.toolbarRulers);
                set('so-toolbar-snap', so.toolbarSnap);
                set('so-toolbar-grid', so.toolbarGrid);

                setOpt('roof-tool-mode', 'select_modules', so.toolbarSelect);
                setOpt('roof-tool-mode', 'select_measures', so.toolbarMarks);
                setOpt('roof-tool-mode', 'measure_dist', so.toolbarDist);
                setOpt('roof-tool-mode', 'measure_area', so.toolbarArea);
                setOpt('roof-tool-mode', 'edit_vertices', so.toolbarEditVertices);

                set('so-card-module-title', so.cardModule);
                set('so-card-text-title', so.cardText);
                set('so-card-measure-title', so.cardMeasure);

                set('so-module-roof', so.moduleRoof);
                set('so-module-dims', so.moduleDims);
                set('so-module-qty', so.qty);
                set('so-module-opacity', so.opacity);
                set('so-module-vertex-lock', so.vertexLock);

                set('so-text-size', so.textSize);
                set('so-text-weight', so.textWeight);
                set('so-text-color', so.textColor);
                set('so-text-bg', so.bg);
                set('so-text-content', so.content);

                setOpt('roof-label-weight', '200', so.weightThin);
                setOpt('roof-label-weight', '400', so.weightReg);
                setOpt('roof-label-weight', '600', so.weightSemi);
                setOpt('roof-label-weight', '900', so.weightBold);

                set('so-dist-color', so.distColor);
                set('so-dist-marker', so.distMarker);
                set('so-dist-constraint', so.distConstraint);

                setOpt('roof-dist-marker', 'cross', so.markerCross);
                setOpt('roof-dist-marker', 'dot', so.markerDot);
                setOpt('roof-dist-marker', 'diamond', so.markerDiamond);
                setOpt('roof-dist-marker', 'arrow_a', so.markerArrowA);
                setOpt('roof-dist-marker', 'arrow_b', so.markerArrowB);
                setOpt('roof-dist-marker', 'arrow_ab', so.markerArrowAB);

                setOpt('roof-dist-constraint', 'free', so.constraintFree);
                setOpt('roof-dist-constraint', 'horizontal', so.constraintH);
                setOpt('roof-dist-constraint', 'vertical', so.constraintV);

                set('so-area-bg', so.areaBg);
                set('so-area-verts', so.areaVerts);
                set('so-area-opacity', so.areaOpacity);
                set('so-area-pattern', so.areaHatch);
                set('so-area-text', so.areaText);

                setOpt('roof-area-pattern', 'none', so.hatchSolid);
                setOpt('roof-area-pattern', 'diag', so.hatchDiag);
                setOpt('roof-area-pattern', 'cross', so.hatchCross);
                setOpt('roof-area-pattern', 'grid', so.hatchGrid);

                set('so-custom-modal-title', so.customTitle);
                set('so-custom-modal-text-label', so.customText);
                set('so-custom-modal-shape-label', so.customShape);
                setOpt('roof-custom-shape', 'rect', so.shapeRect);
                setOpt('roof-custom-shape', 'circle', so.shapeCircle);
                setOpt('roof-custom-shape', 'triangle', so.shapeTriangle);
                setOpt('roof-custom-shape', 'diamond', so.shapeDiamond);
                setOpt('roof-custom-shape', 'hex', so.shapeHex);
                setOpt('roof-custom-shape', 'arrow', so.shapeArrow);
                setOpt('roof-custom-shape', 'polygon', so.shapePolygon);
                set('so-custom-modal-vertex-lock', so.customVLock);
                set('so-custom-modal-polygon-n-label', so.customPolyVerts);
                set('so-custom-modal-bg-label', so.customBg);
                set('so-custom-modal-bg-none', so.customNoBg);
                set('so-custom-modal-fg-label', so.customFg);
                set('so-custom-modal-cancel', so.cancel);
                set('so-custom-modal-add', so.add);
            }

            const lblBefore = document.getElementById('lbl-roi-before');
            if(lblBefore) lblBefore.textContent = currentLang === 'zh' ? `安装前月均电费 (${currentCurrency === 'CNY' ? '¥' : 'RM'})` : `Monthly Bill Before (${currentCurrency === 'CNY' ? '¥' : 'RM'})`;
            const lblAfter = document.getElementById('lbl-roi-after');
            if(lblAfter) lblAfter.textContent = currentLang === 'zh' ? `安装后月均电费 (${currentCurrency === 'CNY' ? '¥' : 'RM'})` : `Monthly Bill After (${currentCurrency === 'CNY' ? '¥' : 'RM'})`;
            const lblCost = document.getElementById('lbl-roi-cost');
            if(lblCost) lblCost.textContent = currentLang === 'zh' ? `系统总成本 (${currentCurrency === 'CNY' ? '¥' : 'RM'})` : `System Cost (${currentCurrency === 'CNY' ? '¥' : 'RM'})`;
        };

        // --- Quotation逻辑 ---
        const BATTERY_SOLAR_PROGRAMS = ['offgrid', 'hybrid', 'microgrid'];
        const NON_BATTERY_SOLAR_PROGRAMS = ['gridtied', 'directdrive'];
        window.__lastBatterySolarProgram = window.__lastBatterySolarProgram || 'offgrid';
        window.__pendingBatteryPick = null;
        window.__quoteQtyEditRowId = null;

        function resolveQuoteProduct(row) {
            const r = row && typeof row === 'object' ? row : {};
            const pid = String(r.productId || '').trim();
            if (pid) {
                const found = products.find(p => String(p?.id || '').trim() === pid);
                if (found) return found;
            }
            const invId = String(r.inventoryId || '').trim();
            if (invId) {
                const item = inventory.find(i => String(i?.id || '').trim() === invId);
                if (item?.productId) {
                    const found = products.find(p => String(p?.id || '').trim() === String(item.productId).trim());
                    if (found) return found;
                }
            }
            const desc = String(r.description || '').trim().toLowerCase();
            const spec = String(r.spec || '').trim().toLowerCase();
            if (!desc && !spec) return null;
            return products.find(p => {
                const name = String(p?.name || '').trim().toLowerCase();
                const id = String(p?.id || '').trim().toLowerCase();
                const pspec = String(p?.spec || '').trim().toLowerCase();
                return (name && (desc === name || desc.includes(name) || name.includes(desc)))
                    || (id && (desc === id || spec === id))
                    || (pspec && spec && spec === pspec);
            }) || null;
        }

        function resolveQuoteInventory(row) {
            const r = row && typeof row === 'object' ? row : {};
            const invId = String(r.inventoryId || '').trim();
            if (invId) {
                const found = inventory.find(i => String(i?.id || '').trim() === invId);
                if (found) return found;
            }
            const pid = String(r.productId || '').trim();
            if (pid) return inventory.find(i => String(i?.productId || '').trim() === pid) || null;
            return null;
        }

        function quoteProductHasBattery(product, item, row) {
            const hay = `${product?.category || ''} ${product?.name || ''} ${product?.spec || ''} ${product?.scenario || ''} ${item?.spec || ''} ${row?.description || ''} ${row?.spec || ''}`.toLowerCase();
            return hay.includes('Battery') || hay.includes('储能') || hay.includes('battery') || hay.includes('bess') || /\bk\s*w\s*h\b/i.test(hay) || /kwh/i.test(hay);
        }

        function quoteRowHasBattery(row) {
            const product = resolveQuoteProduct(row);
            const item = resolveQuoteInventory(row);
            return quoteProductHasBattery(product, item, row);
        }

        function quoteRowIsPvModule(row) {
            const product = resolveQuoteProduct(row);
            const hay = `${product?.category || ''} ${product?.name || ''} ${product?.spec || ''} ${row?.description || ''} ${row?.spec || ''}`.toLowerCase();
            return hay.includes('光伏Module') || hay.includes('PV Module') || hay.includes('photovoltaic') || hay.includes('solar panel') || hay.includes('pv module') || hay.includes('panel') || hay.includes('Module');
        }

        function quoteRowIsInverter(row) {
            const product = resolveQuoteProduct(row);
            const hay = `${product?.category || ''} ${product?.name || ''} ${product?.spec || ''} ${row?.description || ''} ${row?.spec || ''}`.toLowerCase();
            return hay.includes('Inverter') || hay.includes('inverter');
        }

        function quoteHasBatteryRows() {
            return quoteRows.some(r => r && !r.isBlank && quoteRowHasBattery(r));
        }
        window.quoteHasBatteryRows = quoteHasBatteryRows;

        window.updateQuoteSolarProgramAvailability = (opts = {}) => {
            const select = document.getElementById('select-solar-program');
            if (!select) return;
            const hasBattery = quoteHasBatteryRows();
            const previousValue = select.value;
            Array.from(select.options || []).forEach(option => {
                option.disabled = hasBattery && NON_BATTERY_SOLAR_PROGRAMS.includes(option.value);
            });
            if (BATTERY_SOLAR_PROGRAMS.includes(select.value)) {
                window.__lastBatterySolarProgram = select.value;
            }
            if (hasBattery && NON_BATTERY_SOLAR_PROGRAMS.includes(select.value)) {
                select.value = window.__lastBatterySolarProgram || 'offgrid';
            }
            if (select.value !== previousValue) {
                window.resetQuoteExportFactorForProgram?.({ recalc: false });
            }
            const hint = document.getElementById('quote-solar-program-hint');
            if (hint) {
                hint.textContent = '';
                hint.classList.add('hidden');
            }
            if (opts.fromUser && hasBattery && BATTERY_SOLAR_PROGRAMS.includes(select.value)) {
                window.__lastBatterySolarProgram = select.value;
            }
        };

        window.removeRow = (id) => {
            window.hideGlobalTooltip?.();
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
                row.vendorManualOverride = true;
            } else if (field === 'spec' || field === 'batchNo') {
                row[field] = val;
            } else if (field === 'quantity') {
                row.quantity = parseFloat(val) || 0;
                if (quoteRowIsPvModule(row) || quoteRowIsInverter(row)) {
                    row.qtyManualOverride = true;
                }
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

        function fitGrandTotalAmount() {
            const el = document.getElementById('grand-total');
            if (!el) return;
            const wrap = el.parentElement;
            const currencyEl = wrap?.querySelector('.currency-symbol');
            const compactLen = String(el.textContent || '').replace(/[^0-9.]/g, '').length;
            let size = 0.92;
            if (compactLen >= 15) size = 0.66;
            else if (compactLen >= 13) size = 0.74;
            else if (compactLen >= 11) size = 0.82;

            if (wrap) {
                wrap.style.setProperty('min-width', '0', 'important');
                wrap.style.setProperty('overflow', 'hidden', 'important');
                wrap.style.setProperty('white-space', 'nowrap', 'important');
                wrap.style.setProperty('gap', '0.18rem', 'important');
            }
            if (currencyEl) {
                currencyEl.style.setProperty('flex-shrink', '0', 'important');
                currencyEl.style.setProperty('font-size', `${Math.min(size * 0.76, 0.72).toFixed(2)}rem`, 'important');
                currencyEl.style.setProperty('line-height', '1', 'important');
            }
            el.style.setProperty('display', 'inline-block', 'important');
            el.style.setProperty('min-width', '0', 'important');
            el.style.setProperty('max-width', '100%', 'important');
            el.style.setProperty('font-size', `${size.toFixed(2)}rem`, 'important');
            el.style.setProperty('line-height', '1', 'important');
            if (!wrap || !wrap.clientWidth) return;
            const currencyWidth = currencyEl ? currencyEl.getBoundingClientRect().width : 0;
            const available = Math.max(24, wrap.clientWidth - currencyWidth - 8);
            while (size > 0.5 && el.scrollWidth > available) {
                size -= 0.04;
                el.style.setProperty('font-size', `${size.toFixed(2)}rem`, 'important');
                if (currencyEl) {
                    currencyEl.style.setProperty('font-size', `${Math.min(size * 0.76, 0.72).toFixed(2)}rem`, 'important');
                }
            }
        }
        window.fitGrandTotalAmount = fitGrandTotalAmount;

        function calculateQuote() {
            let total = 0, totalCost = 0;
            const rate = parseFloat(document.getElementById('rate-myr-cny').value) || 1.53;

            quoteRows.forEach(r => {
                if (r.isBlank) return;
                const priceInCurrentCurrency = currentCurrency === 'MYR' ? r.price / rate : r.price;
                const isIncluded = !!r.included;
                const sub = isIncluded ? 0 : r.quantity * priceInCurrentCurrency;
                total += sub;
                if (!isIncluded) totalCost += r.quantity * r.cost;
                const subEl = document.getElementById(`sub-${r.id}`);
                const marginTipEl = document.getElementById(`margin-tip-${r.id}`);
                const amountCellEl = document.getElementById(`amount-cell-${r.id}`);
                if(subEl) subEl.textContent = isIncluded ? 'INCLUDED' : sub.toFixed(2);
                if(amountCellEl) amountCellEl.title = '';
                if(marginTipEl) {
                    // 更新计算公式：(售价 - 成本) / 成本
                    const margin = r.cost > 0 ? ((r.price - r.cost) / r.cost * 100) : 0;
                    marginTipEl.textContent = `Margin ${margin.toFixed(1)}%`;
                    marginTipEl.className = `no-print hidden group-hover:block pointer-events-none absolute right-0 -top-7 rounded-lg text-white text-[10px] font-bold px-2 py-1 shadow-lg z-20 ${margin < 15 ? 'bg-red-600' : 'bg-slate-900'}`;
                    if(amountCellEl) amountCellEl.title = `Margin ${margin.toFixed(1)}%`;
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
            fitGrandTotalAmount();
            requestAnimationFrame(fitGrandTotalAmount);

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
            try { window.calculateROI?.(); } catch (e) {}
            try { window.updateQuoteA4PageBreakWarning?.(); } catch (e) {}
        }

        function quotePageIsVisible(page) {
            if (!page) return false;
            const style = page.ownerDocument?.defaultView?.getComputedStyle?.(page);
            return style?.display !== 'none' && !page.classList.contains('hidden');
        }

        function quoteA4PageHeightPx(page) {
            const rect = page?.getBoundingClientRect?.();
            const width = rect?.width || page?.clientWidth || 794;
            return Math.max(900, width * 297 / 210);
        }

        function quoteFindCrossingBlock(doc = document) {
            const page = doc.getElementById('quote-page-1');
            if (!quotePageIsVisible(page)) return null;
            const pageRect = page.getBoundingClientRect();
            const pageHeight = quoteA4PageHeightPx(page);
            const candidates = Array.from(page.querySelectorAll('#quote-body .quote-detail-row, .grand-total-container, #section-after-details, .signature-container'))
                .filter(el => {
                    if (el.classList.contains('quote-page-break-before')) return false;
                    const style = doc.defaultView?.getComputedStyle?.(el);
                    return style?.display !== 'none';
                });
            for (const el of candidates) {
                const rect = el.getBoundingClientRect();
                if (!rect.height || rect.height >= pageHeight * 0.94) continue;
                const top = rect.top - pageRect.top;
                const bottom = rect.bottom - pageRect.top;
                if (top < 0 || bottom <= pageHeight) continue;
                const topPage = Math.floor(Math.max(0, top) / pageHeight);
                const bottomPage = Math.floor(Math.max(0, bottom - 1) / pageHeight);
                if (topPage !== bottomPage && top % pageHeight > 24) return el;
            }
            return null;
        }

        window.updateQuoteA4PageBreakWarning = () => {
            const warning = document.getElementById('quote-a4-warning');
            if (!warning) return;
            const block = quoteFindCrossingBlock(document);
            if (!block) {
                warning.classList.add('hidden');
                warning.textContent = '';
                return;
            }
            const label = block.matches?.('.quote-detail-row')
                ? `Row ${block.querySelector('td')?.textContent?.trim() || ''}`
                : (block.classList.contains('grand-total-container') ? 'Grand Total' : 'Terms / Signature');
            warning.textContent = `A4 page break warning: ${label} may cross the page edge. It will be moved to the next PDF page automatically.`;
            warning.classList.remove('hidden');
        };

        window.applyQuotePdfPageBreaks = (doc) => {
            const clonedDoc = doc || document;
            const page = clonedDoc.getElementById('quote-page-1');
            if (!quotePageIsVisible(page)) return;
            Array.from(clonedDoc.querySelectorAll('.quote-auto-page-break-marker')).forEach(el => el.remove());
            Array.from(clonedDoc.querySelectorAll('.quote-page-break-before')).forEach(el => {
                el.classList.remove('quote-page-break-before');
                el.style.breakBefore = '';
                el.style.pageBreakBefore = '';
            });
            for (let i = 0; i < 12; i++) {
                const block = quoteFindCrossingBlock(clonedDoc);
                if (!block) break;
                block.classList.add('quote-page-break-before');
                block.style.breakBefore = 'page';
                block.style.pageBreakBefore = 'always';
                if (block.tagName === 'TR') {
                    const marker = clonedDoc.createElement('tr');
                    marker.className = 'quote-auto-page-break-marker html2pdf__page-break';
                    marker.innerHTML = '<td colspan="8" style="padding:0;border:0;height:0;line-height:0;"></td>';
                    block.parentNode?.insertBefore(marker, block);
                } else {
                    const marker = clonedDoc.createElement('div');
                    marker.className = 'quote-auto-page-break-marker html2pdf__page-break';
                    marker.style.height = '0';
                    block.parentNode?.insertBefore(marker, block);
                }
                void page.offsetHeight;
            }
        };

        function renderQuote() {
            window.hideGlobalTooltip?.();
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
                const brandVal = quoteBrandDisplayForRow(r);
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
                const qtyHtml = `<input id="quote-qty-${r.id}" type="number" value="${r.quantity}" oninput="updateRow(${r.id}, 'quantity', this.value)" class="w-full bg-transparent outline-none text-center text-sm">`;
                const priceHtml = r.included
                    ? `<span class="block text-right text-[10px] font-black text-slate-400 uppercase">Included</span>`
                    : `<input type="number" step="0.01" value="${formatNumberAuto(priceInCurrentCurrency, 4)}" oninput="updateRow(${r.id}, 'price', this.value)" class="w-full bg-transparent outline-none text-right text-sm font-bold">`;
                const amountHtml = r.included
                    ? `<span id="sub-${r.id}" class="text-slate-500">INCLUDED</span>`
                    : `<span class="currency-symbol mr-1"></span><span id="sub-${r.id}">0.00</span><div id="margin-tip-${r.id}" class="no-print hidden group-hover:block pointer-events-none absolute right-0 -top-7 rounded-lg bg-slate-900 text-white text-[10px] font-bold px-2 py-1 shadow-lg z-20">Margin 0%</div>`;
                const marketHoverAttrs = r.productId ? ` onmousemove="showMarketPriceTooltip(event, '${htmlSafe(r.productId)}')" onmouseleave="hidePriceListTooltip()"` : '';
                const rowHtml = r.isBlank ? `
                <tr class="quote-detail-row group transition-colors hover:bg-slate-50/50" data-quote-row-id="${r.id}">
                    <td class="py-4 px-2 text-center text-[10px] font-mono text-slate-200"></td>
                    <td class="py-4 px-2 select-none">&nbsp;</td>
                    <td class="py-4 px-2 select-none">&nbsp;</td>
                    <td class="py-4 px-2 select-none">&nbsp;</td>
                    <td class="py-4 px-2 text-center select-none">&nbsp;</td>
                    <td class="py-4 px-2 text-right select-none print:hidden no-print">&nbsp;</td>
                    <td class="py-4 px-2 text-right select-none">&nbsp;</td>
                    <td class="no-print py-4 px-2 text-center">
                        <div class="quote-row-actions flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                            <button type="button" onclick="moveRow(${r.id}, -1)" class="px-2 py-1 text-[10px] font-black text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-md border border-slate-200" title="上移">↑</button>
                            <button type="button" onclick="moveRow(${r.id}, 1)" class="px-2 py-1 text-[10px] font-black text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-md border border-slate-200" title="下移">↓</button>
                            <button type="button" onclick="removeRow(${r.id})" class="px-2 py-1 text-[10px] font-black text-red-500 bg-red-50 hover:bg-red-100 rounded-md border border-red-200" title="Delete">✕</button>
                        </div>
                    </td>
                </tr>
                ` : `
                <tr class="quote-detail-row border-b border-slate-50 group transition-colors hover:bg-slate-50/50" data-quote-row-id="${r.id}"${marketHoverAttrs}>
                    <td class="py-2 px-2 text-center text-[10px] font-mono text-slate-300">${displayNo}</td>
                    <td class="py-2 px-2" style="vertical-align:top;"><textarea rows="1" oninput="updateRow(${r.id}, 'description', this.value); this.style.height=''; this.style.height=this.scrollHeight + 'px';" class="quote-desc-textarea w-full bg-transparent outline-none text-sm font-medium focus:text-blue-600 resize-none overflow-hidden" placeholder="${currentLang === 'en' ? 'Description' : '描述'}">${htmlSafe(descVal)}</textarea></td>
                    <td class="py-2 px-2"><input type="text" value="${htmlSafe(brandVal)}" oninput="updateRow(${r.id}, 'vendor', this.value)" class="w-full bg-transparent outline-none text-center text-sm focus:text-blue-600" placeholder="${currentLang === 'en' ? 'Brand' : '品牌'}"></td>
                    <td class="py-2 px-2"><input type="text" value="${r.spec}" oninput="updateRow(${r.id}, 'spec', this.value)" class="w-full bg-transparent outline-none text-center text-sm focus:text-blue-600" placeholder="${currentLang === 'en' ? 'Spec' : 'Spec'}"></td>
                    <td class="py-2 px-2">${qtyHtml}</td>
                    <td class="py-2 px-2 print:hidden no-print whitespace-nowrap">${priceHtml}</td>
                    <td id="amount-cell-${r.id}" class="py-2 px-2 text-right font-black text-slate-700 text-sm whitespace-nowrap relative">${amountHtml}</td>
                    <td class="no-print py-2 px-2 text-center">
                        <div class="quote-row-actions flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                            <button type="button" onclick="moveRow(${r.id}, -1)" class="px-2 py-1 text-[10px] font-black text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-md border border-slate-200" title="上移">↑</button>
                            <button type="button" onclick="moveRow(${r.id}, 1)" class="px-2 py-1 text-[10px] font-black text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-md border border-slate-200" title="下移">↓</button>
                            <button type="button" onclick="removeRow(${r.id})" class="px-2 py-1 text-[10px] font-black text-red-500 bg-red-50 hover:bg-red-100 rounded-md border border-red-200" title="Delete">✕</button>
                        </div>
                    </td>
                </tr>
                `;

                const splitHtml = (quoteSplit.enabled && r.id === splitAfterId) ? `
                <tr id="quote-split-row" class="quote-split-row">
                    <td colspan="8" class="py-4 px-2">
                        <div class="flex items-center gap-3">
                            <div class="flex-grow border-t border-dashed border-purple-200"></div>
                            <div class="quote-row-actions no-print flex items-center gap-1">
                                <button type="button" onclick="moveQuoteSplit(-1)" class="px-2 py-1 text-[10px] font-black text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-md border border-slate-200" title="上移">↑</button>
                                <button type="button" onclick="moveQuoteSplit(1)" class="px-2 py-1 text-[10px] font-black text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-md border border-slate-200" title="下移">↓</button>
                                <button type="button" onclick="toggleQuoteSplit()" class="px-2 py-1 text-[10px] font-black text-red-500 bg-red-50 hover:bg-red-100 rounded-md border border-red-200" title="Delete">✕</button>
                            </div>
                        </div>
                    </td>
                </tr>
                ` : '';

                return rowHtml + splitHtml;
            }).join('');
            window.updateQuoteSolarProgramAvailability?.();
            requestAnimationFrame(() => window.autosizeAllTextareas?.(container));
            calculateQuote();
            updateQuoteSplitUI();
            requestAnimationFrame(() => window.updateQuoteA4PageBreakWarning?.());
        }
        window.renderQuote = renderQuote;
        window.calculateQuote = calculateQuote;

        // --- Supplier与库管理逻辑 ---
        async function readMinovaImageFile(file) {
            if (typeof window.handleImageUpload === 'function') return window.handleImageUpload(file);
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.readAsDataURL(file);
            });
        }

        function renderSupplierLogoPreview() {
            const el = document.getElementById('supplier-logo-preview');
            if (!el) return;
            const src = String(window.__supplierLogoDraft || '').trim();
            el.innerHTML = src
                ? `<img src="${htmlSafe(src)}" class="max-h-full max-w-full object-contain" alt="Supplier logo">`
                : 'No Logo';
        }

        function renderProductImagePreview() {
            const el = document.getElementById('m-product-image-preview');
            if (!el) return;
            const src = String(window.__productImageDraft || '').trim();
            el.innerHTML = src
                ? `<img src="${htmlSafe(src)}" class="max-h-full max-w-full object-contain" alt="Product image">`
                : 'No Product Image';
        }

        function getSupplierEvaluationDetails(supplier) {
            const s = supplier && typeof supplier === 'object' ? supplier : {};
            const evaluation = normalizeSupplierEvaluation(s.evaluation || {});
            const stage = capSupplierStage(s.stage || 'info', evaluation.evidence);
            const totalScore = calculateSupplierTotalScore(evaluation.scores);
            return {
                stage,
                evaluation: { ...evaluation, totalScore, suggestedStage: getSupplierSuggestedStage(evaluation.scores, evaluation.evidence) },
                totalScore,
                suggestedStage: getSupplierSuggestedStage(evaluation.scores, evaluation.evidence),
                evidenceMaxStage: getSupplierEvidenceMaxStage(evaluation.evidence),
                weakness: getSupplierWeakness(evaluation.scores)
            };
        }

        function renderSupplierFunnelSummary(allSuppliers) {
            const wrap = document.getElementById('supplier-funnel-summary');
            if (!wrap) return;
            const list = Array.isArray(allSuppliers) ? allSuppliers : [];
            const totalAll = list.length;
            wrap.innerHTML = SUPPLIER_STAGES.map(stage => {
                const rows = list.filter(s => getSupplierEvaluationDetails(s).stage === stage.key);
                const avg = rows.length
                    ? rows.reduce((sum, s) => sum + getSupplierEvaluationDetails(s).totalScore, 0) / rows.length
                    : 0;
                const active = supplierStageFilter === stage.key;
                const cls = active
                    ? 'border-purple-200 bg-white text-purple-800 shadow-sm'
                    : 'border-slate-200 bg-white/70 text-slate-600 hover:border-purple-200';
                return `
                    <button type="button" onclick="setSupplierStageFilter('${stage.key}')" class="text-left rounded-xl border px-4 py-3 transition-all ${cls}">
                        <div class="flex items-center justify-between gap-3">
                            <span class="text-xs font-black">${htmlSafe(stage.label)}</span>
                            <span class="text-lg font-black">${rows.length}</span>
                        </div>
                        <div class="mt-1 flex items-center justify-between gap-2 text-[10px] font-bold text-slate-400">
                            <span>${htmlSafe(stage.desc)}</span>
                            <span>Avg ${avg.toFixed(1)}</span>
                        </div>
                    </button>
                `;
            }).join('');
            const allBtn = document.getElementById('supplier-filter-all');
            if (allBtn) {
                allBtn.className = supplierStageFilter === 'all'
                    ? 'px-3 py-2 rounded-xl border border-purple-200 bg-white text-xs font-black text-purple-800 shadow-sm'
                    : 'px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-black text-slate-600 hover:border-purple-200';
                allBtn.textContent = `All Suppliers (${totalAll})`;
            }
        }

        window.setSupplierStageFilter = (stage) => {
            supplierStageFilter = stage === 'all' ? 'all' : normalizeSupplierStage(stage);
            renderSuppliers();
        };

        window.setSupplierSortMode = (mode) => {
            supplierSortMode = String(mode || 'score_desc');
            renderSuppliers();
        };

        function renderSuppliers() {
            const list = document.getElementById('supplier-list');
            if (!list) return;
            ensureSupplierData();
            renderSupplierFunnelSummary(suppliers);
            if (!suppliers.length) {
                list.innerHTML = `<tr><td colspan="14" class="py-12 text-center text-slate-400 text-sm">No suppliers yet. Add a supplier before maintaining product records.</td></tr>`;
                updateSupplierSelects();
                return;
            }
            const searchEl = document.getElementById('supplier-search');
            const sortEl = document.getElementById('supplier-sort');
            const query = String(searchEl?.value || '').trim().toLowerCase();
            supplierSortMode = String(sortEl?.value || supplierSortMode || 'score_desc');
            const rows = suppliers.map(s => {
                const details = getSupplierEvaluationDetails(s);
                const linked = products.filter(p => normalizeSupplierCode(p.supplierCode) === normalizeSupplierCode(s.code)).length;
                const channelCount = getChannelPartnersForBrand(s.code).length;
                const hay = [
                    s.code, s.nameZh, s.nameEn, s.country, s.contact, s.contactInfo, s.website, s.address, s.notes,
                    getSupplierStageDef(details.stage).label, getSupplierStageDef(details.suggestedStage).label
                ].filter(Boolean).map(v => String(v).toLowerCase()).join(' | ');
                return { supplier: s, details, linked, channelCount, hay };
            }).filter(row => {
                if (supplierStageFilter !== 'all' && row.details.stage !== supplierStageFilter) return false;
                return !query || row.hay.includes(query);
            });
            rows.sort((a, b) => {
                if (supplierSortMode === 'stage_desc') {
                    const stageDiff = supplierStageIndex(b.details.stage) - supplierStageIndex(a.details.stage);
                    if (stageDiff) return stageDiff;
                    return b.details.totalScore - a.details.totalScore;
                }
                if (supplierSortMode === 'name_asc') return getSupplierDisplayName(a.supplier).localeCompare(getSupplierDisplayName(b.supplier));
                return (b.details.totalScore - a.details.totalScore) || supplierStageIndex(b.details.stage) - supplierStageIndex(a.details.stage);
            });
            if (!rows.length) {
                list.innerHTML = `<tr><td colspan="14" class="py-12 text-center text-slate-400 text-sm">No suppliers match the current filters.</td></tr>`;
                updateSupplierSelects();
                return;
            }
            list.innerHTML = rows.map(row => {
                const s = row.supplier;
                const details = row.details;
                const linked = row.linked;
                const channelCount = row.channelCount;
                const logo = getSupplierLogo(s)
                    ? `<img src="${htmlSafe(getSupplierLogo(s))}" class="h-10 w-20 object-contain rounded-lg bg-white border border-slate-100" alt="${htmlSafe(getSupplierDisplayName(s))} logo">`
                    : `<div class="h-10 w-20 rounded-lg bg-slate-50 border border-dashed border-slate-200 flex items-center justify-center text-[10px] text-slate-300">No Logo</div>`;
                const website = s.website
                    ? `<a href="${htmlSafe(s.website)}" target="_blank" rel="noopener noreferrer" class="text-purple-700 hover:underline">${htmlSafe(s.website)}</a>`
                    : '-';
                return `
                    <tr class="hover:bg-slate-50 transition-colors group">
                        <td class="py-4 px-4 text-xs font-mono text-slate-600">${htmlSafe(s.code)}</td>
                        <td class="py-4 px-4">${logo}</td>
                        <td class="py-4 px-4 text-sm font-bold text-slate-700">${htmlSafe(s.nameZh || '-')}</td>
                        <td class="py-4 px-4 text-xs text-slate-600">${htmlSafe(s.nameEn || '-')}</td>
                        <td class="py-4 px-4">${supplierStageBadgeHtml(details.stage)}</td>
                        <td class="py-4 px-4 text-right">
                            <div class="font-black text-sm text-slate-800">${details.totalScore.toFixed(1)}</div>
                            <div class="text-[9px] text-slate-400 font-bold">Suggested ${htmlSafe(getSupplierStageDef(details.suggestedStage).shortLabel)}</div>
                        </td>
                        <td class="py-4 px-4 text-xs text-slate-500">${htmlSafe(details.weakness)}</td>
                        <td class="py-4 px-4 text-xs text-slate-500">${htmlSafe(s.country || '-')}</td>
                        <td class="py-4 px-4 text-xs text-slate-600">${htmlSafe(s.contact || '-')}</td>
                        <td class="py-4 px-4 text-xs text-slate-500">${htmlSafe(s.contactInfo || '-')}</td>
                        <td class="py-4 px-4 text-xs max-w-[180px] truncate">${website}</td>
                        <td class="py-4 px-4 text-center"><span class="text-[10px] font-black px-2 py-1 rounded-full bg-amber-50 text-amber-700">${channelCount}</span></td>
                        <td class="py-4 px-4 text-center"><span class="text-[10px] font-black px-2 py-1 rounded-full bg-purple-50 text-purple-700">${linked}</span></td>
                        <td class="py-4 px-4 text-center">
                            <div class="flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-all">
                                <button onclick="editSupplier('${htmlSafe(s.code)}')" class="text-purple-700 hover:bg-purple-50 p-1 rounded">✎</button>
                                <button onclick="deleteSupplier('${htmlSafe(s.code)}')" class="text-red-300 hover:text-red-500 p-1 rounded">🗑</button>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');
            updateSupplierSelects();
        }

        function renderSupplierScoreFields(evaluation = {}) {
            const wrap = document.getElementById('supplier-score-fields');
            if (!wrap) return;
            const scores = normalizeSupplierScores(evaluation.scores || {});
            wrap.innerHTML = SUPPLIER_SCORE_FIELDS.map(field => {
                const value = scores[field.key];
                return `
                    <div>
                        <label class="flex items-center justify-between gap-2 text-[10px] font-black text-slate-400 uppercase mb-1">
                            <span>${htmlSafe(field.label)}</span>
                            <span>${field.weight}%</span>
                        </label>
                        <input id="supplier-score-${field.key}" type="number" min="0" max="10" step="0.5" value="${value}" oninput="updateSupplierEvaluationPreview()" class="w-full border border-slate-200 rounded-xl p-2 text-sm outline-none focus:border-purple-600 bg-white">
                    </div>
                `;
            }).join('');
        }

        function setSupplierCheck(id, checked) {
            const el = document.getElementById(id);
            if (el) el.checked = !!checked;
        }

        function setSupplierInputValue(id, value) {
            const el = document.getElementById(id);
            if (el) el.value = String(value ?? '');
        }

        function readSupplierScoresFromModal() {
            return SUPPLIER_SCORE_FIELDS.reduce((acc, field) => {
                acc[field.key] = normalizeSupplierScore(document.getElementById(`supplier-score-${field.key}`)?.value);
                return acc;
            }, {});
        }

        function readSupplierEvidenceFromModal() {
            return normalizeSupplierEvidence({
                factoryVisited: !!document.getElementById('supplier-evidence-factory-visited')?.checked,
                accurateQuote: !!document.getElementById('supplier-evidence-accurate-quote')?.checked,
                firstOrderDone: !!document.getElementById('supplier-evidence-first-order')?.checked,
                longTermCooperation: !!document.getElementById('supplier-evidence-long-term')?.checked,
                preferredPrice: !!document.getElementById('supplier-evidence-preferred-price')?.checked,
                orderCount: document.getElementById('supplier-evidence-order-count')?.value || 0,
                creditTermDays: document.getElementById('supplier-evidence-credit-days')?.value || 0
            });
        }

        function readSupplierEvaluationDraft({ touch = false } = {}) {
            return normalizeSupplierEvaluation({
                scores: readSupplierScoresFromModal(),
                evidence: readSupplierEvidenceFromModal(),
                lastReviewedAt: touch ? new Date().toISOString() : String(window.__supplierLastReviewedAt || '')
            });
        }

        window.updateSupplierEvaluationPreview = () => {
            const preview = document.getElementById('supplier-evaluation-preview');
            if (!preview) return;
            const evaluation = readSupplierEvaluationDraft();
            const requestedStage = normalizeSupplierStage(document.getElementById('supplier-stage')?.value || 'info');
            const cappedStage = capSupplierStage(requestedStage, evaluation.evidence);
            const suggestedStage = getSupplierSuggestedStage(evaluation.scores, evaluation.evidence);
            const evidenceMaxStage = getSupplierEvidenceMaxStage(evaluation.evidence);
            const missing = getSupplierMissingEvidenceForStage(requestedStage, evaluation.evidence);
            const capNote = requestedStage === cappedStage
                ? `Can be saved as ${getSupplierStageDef(cappedStage).label}`
                : `Evidence is insufficient; it will be saved as ${getSupplierStageDef(cappedStage).label}`;
            const reviewedAt = window.__supplierLastReviewedAt ? new Date(window.__supplierLastReviewedAt).toLocaleDateString('en-US') : 'Not reviewed';
            preview.innerHTML = `
                <div class="flex flex-col md:flex-row md:items-center justify-between gap-2">
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="text-2xl font-black text-purple-800">${evaluation.totalScore.toFixed(1)}</span>
                        <span class="text-[10px] font-black text-slate-400 uppercase">/ 100</span>
                        <span class="text-xs font-bold text-slate-500">Suggested: ${htmlSafe(getSupplierStageDef(suggestedStage).label)}</span>
                        <span class="text-xs font-bold text-slate-500">Evidence Cap: ${htmlSafe(getSupplierStageDef(evidenceMaxStage).label)}</span>
                    </div>
                    <span class="text-[10px] font-bold text-slate-400">Last Reviewed: ${htmlSafe(reviewedAt)}</span>
                </div>
                <div class="mt-2 text-xs font-bold ${requestedStage === cappedStage ? 'text-emerald-700' : 'text-amber-700'}">${htmlSafe(capNote)}</div>
                ${missing.length ? `<div class="mt-1 text-[11px] text-red-500 font-bold">Missing: ${missing.map(htmlSafe).join(', ')}</div>` : ''}
            `;
        };

        function setSupplierEvaluationToModal(supplier) {
            const details = getSupplierEvaluationDetails(supplier || {});
            const evaluation = details.evaluation;
            window.__supplierLastReviewedAt = evaluation.lastReviewedAt || '';
            renderSupplierScoreFields(evaluation);
            setSupplierInputValue('supplier-stage', details.stage);
            const e = normalizeSupplierEvidence(evaluation.evidence);
            setSupplierCheck('supplier-evidence-factory-visited', e.factoryVisited);
            setSupplierCheck('supplier-evidence-accurate-quote', e.accurateQuote);
            setSupplierCheck('supplier-evidence-first-order', e.firstOrderDone);
            setSupplierCheck('supplier-evidence-long-term', e.longTermCooperation);
            setSupplierCheck('supplier-evidence-preferred-price', e.preferredPrice);
            setSupplierInputValue('supplier-evidence-order-count', e.orderCount);
            setSupplierInputValue('supplier-evidence-credit-days', e.creditTermDays);
            window.updateSupplierEvaluationPreview();
        }

        function readSupplierAssessmentFromModal() {
            const evaluation = readSupplierEvaluationDraft({ touch: true });
            const requestedStage = normalizeSupplierStage(document.getElementById('supplier-stage')?.value || 'info');
            const stage = capSupplierStage(requestedStage, evaluation.evidence);
            return {
                stage,
                evaluation: {
                    ...evaluation,
                    totalScore: calculateSupplierTotalScore(evaluation.scores),
                    suggestedStage: getSupplierSuggestedStage(evaluation.scores, evaluation.evidence)
                }
            };
        }

        window.openSupplierModal = (code = '') => {
            ensureSupplierData();
            window.__editingSupplierCode = normalizeSupplierCode(code || '');
            const supplier = window.__editingSupplierCode ? getSupplierByCode(window.__editingSupplierCode) : null;
            const modal = document.getElementById('supplier-modal');
            const title = document.getElementById('supplier-modal-title');
            if (title) title.textContent = supplier ? 'Edit Supplier' : 'New Supplier';
            const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
            setVal('supplier-code', supplier?.code || makeUniqueSupplierCode('SUP'));
            setVal('supplier-name-zh', supplier?.nameZh || '');
            setVal('supplier-name-en', supplier?.nameEn || '');
            setVal('supplier-country', supplier?.country || '');
            setVal('supplier-contact', supplier?.contact || '');
            setVal('supplier-contact-info', supplier?.contactInfo || '');
            setVal('supplier-website', supplier?.website || '');
            setVal('supplier-address', supplier?.address || '');
            setVal('supplier-notes', supplier?.notes || '');
            window.__supplierChannelPartnerDrafts = getSupplierChannelPartnerDraftsForCode(supplier?.code || code || '');
            renderSupplierChannelPartnerDrafts();
            setSupplierEvaluationToModal(supplier || {});
            window.__supplierLogoDraft = supplier ? getSupplierLogo(supplier) : '';
            const fileEl = document.getElementById('supplier-logo-file');
            if (fileEl) fileEl.value = '';
            renderSupplierLogoPreview();
            if (modal) modal.classList.remove('hidden');
        };

        window.closeSupplierModal = () => {
            const modal = document.getElementById('supplier-modal');
            if (modal) modal.classList.add('hidden');
            window.__editingSupplierCode = '';
            window.__supplierLogoDraft = '';
            window.__supplierLastReviewedAt = '';
            window.__supplierChannelPartnerDrafts = [];
        };

        window.uploadSupplierLogo = async (input) => {
            if (!input.files || !input.files[0]) return;
            window.__supplierLogoDraft = await readMinovaImageFile(input.files[0]);
            renderSupplierLogoPreview();
        };

        window.clearSupplierLogo = () => {
            window.__supplierLogoDraft = '';
            const fileEl = document.getElementById('supplier-logo-file');
            if (fileEl) fileEl.value = '';
            renderSupplierLogoPreview();
        };

        window.saveSupplier = () => {
            const oldCode = normalizeSupplierCode(window.__editingSupplierCode || '');
            const code = normalizeSupplierCode(document.getElementById('supplier-code')?.value || '');
            const nameZh = String(document.getElementById('supplier-name-zh')?.value || '').trim();
            const nameEn = String(document.getElementById('supplier-name-en')?.value || '').trim();
            if (!code) return alert('Please enter a supplier code.');
            if (!nameZh && !nameEn) return alert('Please enter at least a Chinese name or an English name.');
            const duplicate = suppliers.find(s => normalizeSupplierCode(s.code) === code && normalizeSupplierCode(s.code) !== oldCode);
            if (duplicate) return alert('This supplier code already exists. Please use another code.');
            const prev = oldCode ? getSupplierByCode(oldCode) : null;
            const prevDisplay = prev ? getSupplierDisplayName(prev) : '';
            const assessment = readSupplierAssessmentFromModal();
            const next = normalizeSupplierRecord({
                ...(prev || {}),
                id: prev?.id || `supplier_${code}`,
                code,
                nameZh,
                nameEn,
                stage: assessment.stage,
                evaluation: assessment.evaluation,
                logoDataUrl: String(window.__supplierLogoDraft || ''),
                country: document.getElementById('supplier-country')?.value || '',
                contact: document.getElementById('supplier-contact')?.value || '',
                contactInfo: document.getElementById('supplier-contact-info')?.value || '',
                website: document.getElementById('supplier-website')?.value || '',
                address: document.getElementById('supplier-address')?.value || '',
                notes: document.getElementById('supplier-notes')?.value || '',
                ts: Date.now()
            });
            const nextDisplay = getSupplierDisplayName(next);
            const idx = oldCode ? suppliers.findIndex(s => normalizeSupplierCode(s.code) === oldCode) : -1;
            if (idx >= 0) suppliers[idx] = next;
            else suppliers.push(next);
            if (oldCode && oldCode !== code) {
                channelPartners.forEach(partner => {
                    if (normalizeSupplierCode(partner.brandSupplierCode) === oldCode) partner.brandSupplierCode = code;
                });
            }
            const nextChannelPartners = readSupplierChannelPartnerDrafts(code);
            channelPartners = [
                ...channelPartners.filter(partner => normalizeSupplierCode(partner.brandSupplierCode) !== code),
                ...nextChannelPartners
            ];
            products.forEach(p => {
                if (oldCode && (normalizeSupplierCode(p.supplierCode) === oldCode || (!p.supplierCode && prevDisplay && p.vendor === prevDisplay))) {
                    p.supplierCode = next.code;
                    p.vendor = nextDisplay;
                }
            });
            (companyCerts.isoCerts || []).forEach(c => {
                if (prevDisplay && c.vendor === prevDisplay) c.vendor = nextDisplay;
            });
            closeSupplierModal();
            saveToLocal();
            persistEntityToD1('supplier', next.id || next.code, next);
            nextChannelPartners.forEach(partner => persistEntityToD1('channel_partner', partner.id, partner));
            try { renderCompanyCertUploadSelectors(); renderCompanyCertList(); } catch (e) {}
        };

        window.editSupplier = (code) => openSupplierModal(code);

        window.deleteSupplier = (code) => {
            ensureSupplierData();
            const c = normalizeSupplierCode(code);
            const supplier = getSupplierByCode(c);
            if (!supplier) return;
            const used = products.filter(p => normalizeSupplierCode(p.supplierCode) === c);
            if (used.length) return alert(`This supplier is linked to ${used.length} products and cannot be deleted. Adjust product records first.`);
            const channels = getChannelPartnersForBrand(c);
            if (channels.length) return alert(`This supplier is linked to ${channels.length} channel partners and cannot be deleted. Delete or reassign channel partners first.`);
            if (!confirm(`Delete supplier: ${getSupplierDisplayName(supplier)}?`)) return;
            suppliers = suppliers.filter(s => normalizeSupplierCode(s.code) !== c);
            saveToLocal();
            deleteEntityFromD1('supplier', supplier.id || supplier.code);
        };

        window.uploadProductImage = async (input) => {
            if (!input.files || !input.files[0]) return;
            window.__productImageDraft = await readMinovaImageFile(input.files[0]);
            renderProductImagePreview();
        };

        window.clearProductImage = () => {
            window.__productImageDraft = '';
            const fileEl = document.getElementById('m-product-image-file');
            if (fileEl) fileEl.value = '';
            renderProductImagePreview();
        };

        const CHANNEL_PARTNER_TYPES = ['Authorized Distributor', 'Dealer', 'EPC Partner'];
        function normalizeChannelPartner(partner = {}) {
            const id = String(partner.id || `channel_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`).trim();
            const type = CHANNEL_PARTNER_TYPES.includes(partner.type) ? partner.type : 'Authorized Distributor';
            return {
                id,
                type,
                brandSupplierCode: normalizeSupplierCode(partner.brandSupplierCode || partner.supplierCode || ''),
                name: String(partner.name || partner.nameEn || partner.nameZh || '').trim(),
                country: String(partner.country || partner.countryRegion || '').trim(),
                contact: String(partner.contact || '').trim(),
                contactInfo: String(partner.contactInfo || '').trim(),
                authorizationStatus: PRODUCT_AUTHORIZATION_STATUS.includes(partner.authorizationStatus) ? partner.authorizationStatus : '',
                authorizationExpiry: String(partner.authorizationExpiry || '').trim(),
                remark: String(partner.remark || partner.notes || '').trim(),
                ts: partner.ts || Date.now()
            };
        }
        function normalizeChannelPartners(partners = []) {
            return (Array.isArray(partners) ? partners : [])
                .map(normalizeChannelPartner)
                .filter(partner => partner.brandSupplierCode && partner.name);
        }
        function getChannelPartnerById(id) {
            const key = String(id || '').trim();
            return channelPartners.find(partner => partner.id === key) || null;
        }
        function getChannelPartnersForBrand(brandSupplierCode = '', type = '') {
            const brand = normalizeSupplierCode(brandSupplierCode);
            return channelPartners.filter(partner => {
                if (brand && partner.brandSupplierCode !== brand) return false;
                if (type && CHANNEL_PARTNER_TYPES.includes(type) && partner.type !== type) return false;
                return true;
            });
        }
        function channelPartnerLabel(partner) {
            if (!partner) return '-';
            return [partner.name, partner.country, partner.type].filter(Boolean).join(' · ');
        }
        function channelPartnerOptions(selectedId = '', brandSupplierCode = '', sourceType = '') {
            const selected = String(selectedId || '').trim();
            const partners = getChannelPartnersForBrand(brandSupplierCode, sourceType);
            return '<option value="">- Select Channel Partner -</option>' + partners.map(partner => `<option value="${htmlSafe(partner.id)}" ${partner.id === selected ? 'selected' : ''}>${htmlSafe(channelPartnerLabel(partner))}</option>`).join('');
        }
        function updateChannelPartnerBrandFilter(selectedCode = '') {
            const filter = document.getElementById('channel-partner-brand-filter');
            if (!filter) return;
            const current = selectedCode || filter.value || 'all';
            filter.innerHTML = '<option value="all">All Brands</option>' + suppliers.map(s => {
                const code = normalizeSupplierCode(s.code);
                return `<option value="${htmlSafe(code)}" ${current === code ? 'selected' : ''}>${htmlSafe(code)} · ${htmlSafe(getSupplierDisplayName(s))}</option>`;
            }).join('');
        }
        function renderChannelPartners() {
            const list = document.getElementById('channel-partner-list');
            if (!list) return;
            ensureSupplierData();
            channelPartners = normalizeChannelPartners(channelPartners);
            updateChannelPartnerBrandFilter();
            const query = String(document.getElementById('channel-partner-search')?.value || '').trim().toLowerCase();
            const type = document.getElementById('channel-partner-type-filter')?.value || 'all';
            const brand = normalizeSupplierCode(document.getElementById('channel-partner-brand-filter')?.value || '');
            const rows = channelPartners.filter(partner => {
                if (type !== 'all' && partner.type !== type) return false;
                if (brand && brand !== 'ALL' && partner.brandSupplierCode !== brand) return false;
                if (!query) return true;
                const hay = [partner.name, partner.type, partner.brandSupplierCode, supplierNameByCode(partner.brandSupplierCode), partner.country, partner.contact, partner.contactInfo, partner.authorizationStatus, partner.remark].map(v => String(v || '').toLowerCase()).join(' ');
                return query.split(/\s+/).filter(Boolean).every(term => hay.includes(term));
            });
            const summary = document.getElementById('channel-partner-summary');
            if (summary) summary.textContent = `${rows.length} visible / ${channelPartners.length} partners`;
            if (!rows.length) {
                list.innerHTML = `<tr><td colspan="9" class="py-12 text-center text-slate-400 text-sm">No channel partners match the current filters.</td></tr>`;
                return;
            }
            list.innerHTML = rows.map(partner => {
                const linked = products.filter(p => String(p?.sourcing?.channelPartnerId || '') === partner.id).length;
                return `<tr class="hover:bg-slate-50 transition-colors group">
                    <td class="py-4 px-4 text-sm font-bold text-slate-700">${htmlSafe(partner.name)}</td>
                    <td class="py-4 px-4 text-xs text-slate-600">${htmlSafe(partner.type)}</td>
                    <td class="py-4 px-4 text-xs text-slate-500">${htmlSafe(supplierNameByCode(partner.brandSupplierCode))}</td>
                    <td class="py-4 px-4 text-xs text-slate-500">${htmlSafe(partner.country || '-')}</td>
                    <td class="py-4 px-4">${productMasterStatusPill(partner.authorizationStatus || 'Unknown', partner.authorizationStatus === 'Authorized' ? 'green' : (partner.authorizationStatus === 'Expired' ? 'red' : 'slate'))}<div class="text-[10px] text-slate-400 mt-1">${htmlSafe(partner.authorizationExpiry || '-')}</div></td>
                    <td class="py-4 px-4 text-xs text-slate-500">${htmlSafe([partner.contact, partner.contactInfo].filter(Boolean).join(' / ') || '-')}</td>
                    <td class="py-4 px-4 text-xs text-slate-500 max-w-[220px] truncate" title="${htmlSafe(partner.remark || '')}">${htmlSafe(partner.remark || '-')}</td>
                    <td class="py-4 px-4 text-center"><span class="text-[10px] font-black px-2 py-1 rounded-full bg-purple-50 text-purple-700">${linked}</span></td>
                    <td class="py-4 px-4 text-center">
                        <button onclick="openChannelPartnerModal('${htmlSafe(partner.id)}')" class="text-purple-700 hover:bg-purple-50 p-1 rounded">✎</button>
                        <button onclick="deleteChannelPartner('${htmlSafe(partner.id)}')" class="text-red-300 hover:text-red-500 p-1 rounded">🗑</button>
                    </td>
                </tr>`;
            }).join('');
        }
        window.renderChannelPartners = renderChannelPartners;
        function readChannelPartnerModal() {
            return normalizeChannelPartner({
                id: document.getElementById('channel-partner-id')?.value || '',
                brandSupplierCode: document.getElementById('channel-partner-brand-code')?.value || '',
                type: document.getElementById('channel-partner-type')?.value || '',
                name: document.getElementById('channel-partner-name')?.value || '',
                country: document.getElementById('channel-partner-country')?.value || '',
                authorizationStatus: document.getElementById('channel-partner-auth-status')?.value || '',
                authorizationExpiry: document.getElementById('channel-partner-auth-expiry')?.value || '',
                contact: document.getElementById('channel-partner-contact')?.value || '',
                contactInfo: document.getElementById('channel-partner-contact-info')?.value || '',
                remark: document.getElementById('channel-partner-remark')?.value || ''
            });
        }
        window.openChannelPartnerModal = (partnerId = '', brandSupplierCode = '') => {
            ensureSupplierData();
            const partner = getChannelPartnerById(partnerId);
            const setVal = (id, value) => { const el = document.getElementById(id); if (el) el.value = value || ''; };
            const brandSelect = document.getElementById('channel-partner-brand-code');
            if (brandSelect) brandSelect.innerHTML = supplierSelectOptions(partner?.brandSupplierCode || brandSupplierCode, false);
            setVal('channel-partner-id', partner?.id || '');
            setVal('channel-partner-brand-code', partner?.brandSupplierCode || brandSupplierCode || suppliers[0]?.code || '');
            setVal('channel-partner-type', partner?.type || 'Authorized Distributor');
            setVal('channel-partner-name', partner?.name || '');
            setVal('channel-partner-country', partner?.country || '');
            setVal('channel-partner-auth-status', partner?.authorizationStatus || '');
            setVal('channel-partner-auth-expiry', partner?.authorizationExpiry || '');
            setVal('channel-partner-contact', partner?.contact || '');
            setVal('channel-partner-contact-info', partner?.contactInfo || '');
            setVal('channel-partner-remark', partner?.remark || '');
            document.getElementById('channel-partner-modal')?.classList.remove('hidden');
        };
        window.closeChannelPartnerModal = () => {
            document.getElementById('channel-partner-modal')?.classList.add('hidden');
        };
        window.saveChannelPartner = () => {
            const partner = readChannelPartnerModal();
            if (!partner.brandSupplierCode) return alert('Please select a brand supplier.');
            if (!partner.name) return alert('Please enter the channel partner name.');
            const idx = channelPartners.findIndex(p => p.id === partner.id);
            if (idx >= 0) channelPartners[idx] = partner;
            else channelPartners.push(partner);
            saveToLocal();
            persistEntityToD1('channel_partner', partner.id, partner);
            closeChannelPartnerModal();
            renderChannelPartners();
            renderSuppliers();
            updateProductChannelPartnerOptions();
        };
        window.deleteChannelPartner = (partnerId) => {
            const id = String(partnerId || '').trim();
            if (!id || !confirm('Delete this channel partner?')) return;
            channelPartners = channelPartners.filter(partner => partner.id !== id);
            products.forEach(p => {
                if (p?.sourcing?.channelPartnerId === id) {
                    p.sourcing = { ...p.sourcing, channelPartnerId: '', sourceRemark: [p.sourcing.sourceRemark, 'Channel partner removed'].filter(Boolean).join(' | ') };
                }
            });
            saveToLocal();
            deleteEntityFromD1('channel_partner', id);
            renderChannelPartners();
            renderSuppliers();
            renderDb();
        };
        function getSupplierChannelPartnerDraftsForCode(code = '') {
            const brand = normalizeSupplierCode(code);
            const drafts = getChannelPartnersForBrand(brand).map(p => ({ ...p }));
            return drafts.length ? drafts : [{ id: '', type: 'Authorized Distributor', brandSupplierCode: brand, name: '', country: '', contact: '', contactInfo: '', authorizationStatus: '', authorizationExpiry: '', remark: '' }];
        }
        function renderSupplierChannelPartnerDrafts() {
            const box = document.getElementById('supplier-channel-partner-editor');
            if (!box) return;
            const drafts = Array.isArray(window.__supplierChannelPartnerDrafts) ? window.__supplierChannelPartnerDrafts : [];
            box.innerHTML = drafts.map((draft, index) => `<div class="grid grid-cols-1 md:grid-cols-7 gap-2 rounded-xl border border-slate-200 bg-white p-2">
                <select id="supplier-channel-${index}-type" class="border border-slate-200 rounded-lg px-2 py-2 text-xs bg-white">
                    ${CHANNEL_PARTNER_TYPES.map(type => `<option value="${htmlSafe(type)}" ${draft.type === type ? 'selected' : ''}>${htmlSafe(type)}</option>`).join('')}
                </select>
                <input id="supplier-channel-${index}-name" value="${htmlSafe(draft.name || '')}" placeholder="Partner name" class="md:col-span-2 border border-slate-200 rounded-lg px-2 py-2 text-xs">
                <input id="supplier-channel-${index}-country" value="${htmlSafe(draft.country || '')}" placeholder="Country" class="border border-slate-200 rounded-lg px-2 py-2 text-xs">
                <input id="supplier-channel-${index}-contact" value="${htmlSafe(draft.contact || '')}" placeholder="Contact" class="border border-slate-200 rounded-lg px-2 py-2 text-xs">
                <select id="supplier-channel-${index}-auth" class="border border-slate-200 rounded-lg px-2 py-2 text-xs bg-white">
                    ${PRODUCT_AUTHORIZATION_STATUS.map(status => `<option value="${htmlSafe(status)}" ${draft.authorizationStatus === status ? 'selected' : ''}>${htmlSafe(status || '-')}</option>`).join('')}
                </select>
                <button type="button" onclick="removeSupplierChannelPartnerDraft(${index})" class="text-red-400 hover:text-red-600 text-xs font-black">Delete</button>
                <input id="supplier-channel-${index}-contact-info" value="${htmlSafe(draft.contactInfo || '')}" placeholder="Phone / Email" class="md:col-span-2 border border-slate-200 rounded-lg px-2 py-2 text-xs">
                <input id="supplier-channel-${index}-expiry" value="${htmlSafe(draft.authorizationExpiry || '')}" type="date" class="border border-slate-200 rounded-lg px-2 py-2 text-xs">
                <input id="supplier-channel-${index}-remark" value="${htmlSafe(draft.remark || '')}" placeholder="Remark" class="md:col-span-4 border border-slate-200 rounded-lg px-2 py-2 text-xs">
            </div>`).join('');
        }
        function readSupplierChannelPartnerDrafts(brandSupplierCode = '') {
            const brand = normalizeSupplierCode(brandSupplierCode);
            const drafts = Array.isArray(window.__supplierChannelPartnerDrafts) ? window.__supplierChannelPartnerDrafts : [];
            return drafts.map((draft, index) => normalizeChannelPartner({
                ...draft,
                brandSupplierCode: brand,
                type: document.getElementById(`supplier-channel-${index}-type`)?.value || draft.type,
                name: document.getElementById(`supplier-channel-${index}-name`)?.value || '',
                country: document.getElementById(`supplier-channel-${index}-country`)?.value || '',
                contact: document.getElementById(`supplier-channel-${index}-contact`)?.value || '',
                contactInfo: document.getElementById(`supplier-channel-${index}-contact-info`)?.value || '',
                authorizationStatus: document.getElementById(`supplier-channel-${index}-auth`)?.value || '',
                authorizationExpiry: document.getElementById(`supplier-channel-${index}-expiry`)?.value || '',
                remark: document.getElementById(`supplier-channel-${index}-remark`)?.value || ''
            })).filter(partner => partner.name);
        }
        window.addSupplierChannelPartnerDraft = () => {
            if (!Array.isArray(window.__supplierChannelPartnerDrafts)) window.__supplierChannelPartnerDrafts = [];
            window.__supplierChannelPartnerDrafts.push({ id: '', type: 'Authorized Distributor', name: '', country: '', contact: '', contactInfo: '', authorizationStatus: '', authorizationExpiry: '', remark: '' });
            renderSupplierChannelPartnerDrafts();
        };
        window.removeSupplierChannelPartnerDraft = (index) => {
            if (!Array.isArray(window.__supplierChannelPartnerDrafts)) return;
            window.__supplierChannelPartnerDrafts.splice(index, 1);
            if (!window.__supplierChannelPartnerDrafts.length) window.__supplierChannelPartnerDrafts.push({ id: '', type: 'Authorized Distributor', name: '', country: '', contact: '', contactInfo: '', authorizationStatus: '', authorizationExpiry: '', remark: '' });
            renderSupplierChannelPartnerDrafts();
        };

        window.setDbGroup = (mode) => {
            dbGroupMode = mode;
            document.getElementById('btn-group-category').className = mode === 'category' ? 'px-4 py-1.5 text-xs font-bold rounded-lg transition-all bg-white shadow-sm text-purple-700' : 'px-4 py-1.5 text-xs font-bold rounded-lg transition-all text-slate-500';
            document.getElementById('btn-group-vendor').className = mode === 'vendor' ? 'px-4 py-1.5 text-xs font-bold rounded-lg transition-all bg-white shadow-sm text-purple-700' : 'px-4 py-1.5 text-xs font-bold rounded-lg transition-all text-slate-500';
            renderDb();
        };
        const PRODUCT_MASTER_TYPE_STORAGE_KEY = 'minova_product_master_type_view_v1';
        const PRODUCT_MASTER_ROLE_STORAGE_KEY = 'minova_product_master_role_view_v1';
        const PRODUCT_MASTER_SEARCH_STORAGE_KEY = 'minova_product_master_search_v1';
        const PRODUCT_TYPE_GROUPS = [
            { id: 'all', label: 'All', categories: [] },
            { id: 'pv', label: 'PV Module', categories: ['PV Module'] },
            { id: 'inverter', label: 'Inverter', categories: ['Inverter'] },
            { id: 'battery', label: 'Battery', categories: ['Battery'] },
            { id: 'ess', label: 'ESS / Hybrid Storage', categories: ['All-in-One System', 'C&I Storage'] },
            { id: 'bos', label: 'BOS / Accessories', categories: ['Accessory'] }
        ];
        const PRODUCT_ROLE_VIEWS = [
            { id: 'sales', label: 'Sales', columns: ['id', 'name', 'quoteReadiness', 'supplyRoute', 'certificationReadiness', 'application', 'warranty', 'leadTime', 'quotePrice', 'actions'] },
            { id: 'engineering', label: 'Engineering / Technical', columns: ['id', 'name', 'category', 'technicalSummary', 'compatibilityStatus', 'technicalFit', 'efficiencyCapacity', 'dimensions', 'weight', 'attachedSpecs', 'certificationRequirements', 'actions'] },
            { id: 'procurement', label: 'Procurement', columns: ['id', 'name', 'category', 'sourceType', 'commercialSupplier', 'factoryBrandOwner', 'authorizationStatus', 'moq', 'leadTime', 'cost', 'priceBasis', 'contact', 'actions'] },
            { id: 'commercial', label: 'Commercial / Audit', columns: ['id', 'name', 'category', 'supplier', 'cost', 'price', 'margin', 'priceBasis', 'marketAlignment', 'sourceRisk', 'certificationGap', 'actions'] },
            { id: 'full', label: 'Full', columns: ['id', 'image', 'name', 'model', 'brand', 'series', 'category', 'subcategory', 'application', 'status', 'quoteReadiness', 'supplyRoute', 'sourceType', 'commercialSupplier', 'factoryBrandOwner', 'authorizationStatus', 'technicalSummary', 'compatibilityStatus', 'efficiencyCapacity', 'dimensions', 'weight', 'warranty', 'leadTime', 'datasheet', 'certificationRequirements', 'externalCertificateLink', 'attachedCerts', 'attachedSpecs', 'cost', 'price', 'margin', 'marketAlignment', 'remark', 'actions'] }
        ];
        const PRODUCT_SOURCE_TYPES = ['Unknown', 'Direct Factory', 'Authorized Distributor', 'Dealer', 'EPC Partner'];
        const PRODUCT_AUTHORIZATION_STATUS = ['', 'Authorized', 'Pending', 'Expired', 'Not Required', 'Unknown'];
        const COMPATIBILITY_RELATION_TYPES = ['PV ↔ Inverter', 'Inverter ↔ Battery', 'ESS ↔ Battery/PCS', 'BOS Required', 'System Bundle'];
        const COMPATIBILITY_STATUS_TYPES = ['Approved', 'Pending', 'Conditional', 'Blocked', 'Unknown'];
        const PRODUCT_ROLE_TO_DEFAULT_VIEW = {
            sales: 'sales',
            sales_management: 'sales',
            supply_chain: 'procurement',
            operation_management: 'engineering',
            price_auditor: 'commercial',
            admin: 'full',
            read_only: 'sales'
        };
        const PRODUCT_MASTER_COMMON_FIELD_KEYS = ['model', 'brand', 'series', 'application', 'voltageClass', 'phase', 'status', 'countryAvailable', 'datasheetLink', 'certificateLink', 'remark'];
        const PRODUCT_TECHNICAL_SPEC_GROUPS = {
            pv: [
                { id: 'powerW', label: 'Power_W', type: 'number' },
                { id: 'cellType', label: 'Cell_Type' },
                { id: 'moduleType', label: 'Module_Type' },
                { id: 'moduleEfficiencyPct', label: 'Module_Efficiency_%', type: 'number' },
                { id: 'vocV', label: 'Voc_V', type: 'number' },
                { id: 'vmpV', label: 'Vmp_V', type: 'number' },
                { id: 'iscA', label: 'Isc_A', type: 'number' },
                { id: 'impA', label: 'Imp_A', type: 'number' },
                { id: 'maxSystemVoltageV', label: 'Max_System_Voltage_V' },
                { id: 'tempCoeffPmax', label: 'Temp_Coeff_Pmax' },
                { id: 'dimensionsMm', label: 'Dimensions_mm' },
                { id: 'weightKg', label: 'Weight_kg', type: 'number' },
                { id: 'performanceWarrantyYears', label: 'Performance_Warranty_Years', type: 'number' },
                { id: 'certification', label: 'Certification' }
            ],
            inverter: [
                { id: 'inverterType', label: 'Inverter_Type' },
                { id: 'ratedAcPowerKw', label: 'Rated_AC_Power_kW', type: 'number' },
                { id: 'maxAcOutputPowerKw', label: 'Max_AC_Output_Power_kW', type: 'number' },
                { id: 'gridVoltageV', label: 'Grid_Voltage_V' },
                { id: 'frequencyHz', label: 'Frequency_Hz' },
                { id: 'ipRating', label: 'IP_Rating' },
                { id: 'coolingType', label: 'Cooling_Type' },
                { id: 'dimensionsMm', label: 'Dimensions_mm' },
                { id: 'weightKg', label: 'Weight_kg', type: 'number' },
                { id: 'maxPvInputPowerKw', label: 'Max_PV_Input_Power_kW', type: 'number' },
                { id: 'maxDcVoltageV', label: 'Max_DC_Voltage_V' },
                { id: 'startUpVoltageV', label: 'Start_Up_Voltage_V' },
                { id: 'mpptVoltageRangeV', label: 'MPPT_Voltage_Range_V' },
                { id: 'mpptQty', label: 'MPPT_Qty', type: 'number' },
                { id: 'stringPerMppt', label: 'String_Per_MPPT', type: 'number' },
                { id: 'batteryVoltageRangeV', label: 'Battery_Voltage_Range_V' },
                { id: 'batteryType', label: 'Battery_Type' },
                { id: 'batteryCommunication', label: 'Battery_Communication' },
                { id: 'compatibleBatterySeries', label: 'Compatible_Battery_Series' },
                { id: 'epsFunction', label: 'EPS_Function' },
                { id: 'epsRatedPowerKw', label: 'EPS_Rated_Power_kW', type: 'number' },
                { id: 'parallelQty', label: 'Parallel_Qty', type: 'number' },
                { id: 'generatorCompatible', label: 'Generator_Compatible' },
                { id: 'acCouplingSupport', label: 'AC_Coupling_Support' }
            ],
            battery: [
                { id: 'batteryType', label: 'Battery_Type' },
                { id: 'voltageClass', label: 'Voltage_Class' },
                { id: 'installationType', label: 'Installation_Type' },
                { id: 'indoorOutdoor', label: 'Indoor_Outdoor' },
                { id: 'ipRating', label: 'IP_Rating' },
                { id: 'nominalEnergyKwh', label: 'Nominal_Energy_kWh', type: 'number' },
                { id: 'usableEnergyKwh', label: 'Usable_Energy_kWh', type: 'number' },
                { id: 'nominalVoltageV', label: 'Nominal_Voltage_V' },
                { id: 'operatingVoltageRangeV', label: 'Operating_Voltage_Range_V' },
                { id: 'capacityAh', label: 'Capacity_Ah', type: 'number' },
                { id: 'dodPct', label: 'DOD_%', type: 'number' },
                { id: 'cycleLife', label: 'Cycle_Life' },
                { id: 'communication', label: 'Communication' },
                { id: 'bms', label: 'BMS' },
                { id: 'expansionQty', label: 'Expansion_Qty', type: 'number' },
                { id: 'dimensionsMm', label: 'Dimensions_mm' },
                { id: 'weightKg', label: 'Weight_kg', type: 'number' },
                { id: 'mountingMethod', label: 'Mounting_Method' },
                { id: 'operatingTemperature', label: 'Operating_Temperature' },
                { id: 'storageTemperature', label: 'Storage_Temperature' },
                { id: 'certification', label: 'Certification' }
            ],
            ess: [
                { id: 'essType', label: 'ESS_Type' },
                { id: 'coolingType', label: 'Cooling_Type' },
                { id: 'acDcCoupled', label: 'AC_Coupled_or_DC_Coupled' },
                { id: 'indoorOutdoor', label: 'Indoor_Outdoor' },
                { id: 'ipRating', label: 'IP_Rating' },
                { id: 'batteryChemistry', label: 'Battery_Chemistry' },
                { id: 'cellCapacityAh', label: 'Cell_Capacity_Ah', type: 'number' },
                { id: 'nominalEnergyKwh', label: 'Nominal_Energy_kWh', type: 'number' },
                { id: 'usableEnergyKwh', label: 'Usable_Energy_kWh', type: 'number' },
                { id: 'ratedDcVoltageV', label: 'Rated_DC_Voltage_V' },
                { id: 'dcVoltageRangeV', label: 'DC_Voltage_Range_V' },
                { id: 'batteryModuleQty', label: 'Battery_Module_Qty', type: 'number' },
                { id: 'packConfiguration', label: 'Pack_Configuration' },
                { id: 'dodPct', label: 'DOD_%', type: 'number' },
                { id: 'cycleLife', label: 'Cycle_Life' },
                { id: 'pcsRatedPowerKw', label: 'PCS_Rated_Power_kW', type: 'number' },
                { id: 'maxOutputPowerKw', label: 'Max_Output_Power_kW', type: 'number' },
                { id: 'acVoltageV', label: 'AC_Voltage_V' },
                { id: 'gridType', label: 'Grid_Type' },
                { id: 'pvInputSupport', label: 'PV_Input_Support' },
                { id: 'maxPvInputPowerKw', label: 'Max_PV_Input_Power_kW', type: 'number' },
                { id: 'mpptQty', label: 'MPPT_Qty', type: 'number' },
                { id: 'roundTripEfficiencyPct', label: 'Round_Trip_Efficiency_%', type: 'number' },
                { id: 'communication', label: 'Communication' },
                { id: 'emsIncluded', label: 'EMS_Included' },
                { id: 'fireSuppressionSystem', label: 'Fire_Suppression_System' },
                { id: 'safetyStandard', label: 'Safety_Standard' },
                { id: 'gridCode', label: 'Grid_Code' },
                { id: 'dimensionsMm', label: 'Dimensions_mm' },
                { id: 'weightKg', label: 'Weight_kg', type: 'number' },
                { id: 'footprintM2', label: 'Footprint_m2', type: 'number' },
                { id: 'installationMethod', label: 'Installation_Method' }
            ]
        };
        const PRODUCT_MASTER_TECHNICAL_IMPORT_KEYS = Array.from(new Set(Object.values(PRODUCT_TECHNICAL_SPEC_GROUPS).flat().map(field => field.id)));
        const PRODUCT_MASTER_TECHNICAL_LABEL_BY_KEY = Object.values(PRODUCT_TECHNICAL_SPEC_GROUPS).flat().reduce((acc, field) => {
            acc[field.id] = field.label;
            return acc;
        }, {});
        function getProductMasterTypeView() {
            let stored = '';
            try { stored = localStorage.getItem(PRODUCT_MASTER_TYPE_STORAGE_KEY) || ''; } catch (e) {}
            return PRODUCT_TYPE_GROUPS.some(group => group.id === stored) ? stored : 'all';
        }
        function getProductTypeGroup(product) {
            const category = normalizeProductCategory(product?.category || '');
            return PRODUCT_TYPE_GROUPS.find(group => group.id !== 'all' && group.categories.includes(category)) || PRODUCT_TYPE_GROUPS[0];
        }
        window.getProductTypeGroup = getProductTypeGroup;
        function getDefaultProductRoleView() {
            const auth = window.__minovaAuth || {};
            if (window.location?.protocol === 'file:' && !auth.state?.user) return 'full';
            const role = String(auth.state?.permission?.role || auth.state?.user?.role || 'read_only').trim().toLowerCase().replace(/[\s-]+/g, '_');
            const roleDefaults = PRODUCT_ROLE_TO_DEFAULT_VIEW;
            return roleDefaults[role] || 'sales';
        }
        function getProductMasterRoleView() {
            let stored = '';
            try { stored = localStorage.getItem(PRODUCT_MASTER_ROLE_STORAGE_KEY) || ''; } catch (e) {}
            return PRODUCT_ROLE_VIEWS.some(view => view.id === stored) ? stored : getDefaultProductRoleView();
        }
        function canViewProductMasterSensitiveField(field) {
            if (!field) return true;
            const auth = window.__minovaAuth || {};
            if (!auth.state?.user && window.location?.protocol === 'file:') return true;
            if (typeof auth.canViewSensitiveField === 'function') return !!auth.canViewSensitiveField(field);
            if (!auth.state?.user) return false;
            return false;
        }
        function getProductMasterVisibleColumns() {
            const roleView = PRODUCT_ROLE_VIEWS.find(view => view.id === getProductMasterRoleView()) || PRODUCT_ROLE_VIEWS.find(view => view.id === 'full');
            return roleView.columns
                .map(key => PRODUCT_MASTER_COLUMNS[key])
                .filter(Boolean)
                .filter(column => !column.sensitiveField || canViewProductMasterSensitiveField(column.sensitiveField));
        }
        function getProductMasterSearchQuery() {
            let stored = '';
            try { stored = localStorage.getItem(PRODUCT_MASTER_SEARCH_STORAGE_KEY) || ''; } catch (e) {}
            return String(stored || '').trim();
        }
        function getProductTechnicalSpecFieldsForCategory(category) {
            const group = getProductTypeGroup({ category });
            return PRODUCT_TECHNICAL_SPEC_GROUPS[group.id] || [];
        }
        function coerceProductMasterFieldValue(value, type = 'text') {
            const raw = String(value ?? '').trim();
            if (!raw) return '';
            if (type === 'number') {
                const n = parseFloat(raw);
                return Number.isFinite(n) ? n : raw;
            }
            return raw;
        }
        function compactProductMasterObject(obj) {
            const out = {};
            Object.entries(obj || {}).forEach(([key, value]) => {
                if (value === undefined || value === null || value === '') return;
                out[key] = value;
            });
            return out;
        }
        function getProductMasterData(product = {}) {
            const md = product?.masterData && typeof product.masterData === 'object' ? product.masterData : {};
            return {
                model: md.model || product.model || product.sku || '',
                brand: md.brand || product.brand || '',
                series: md.series || product.series || '',
                application: md.application || product.application || product.scenario || '',
                voltageClass: md.voltageClass || product.voltageClass || '',
                phase: md.phase || product.phase || '',
                status: md.status || product.status || '',
                countryAvailable: md.countryAvailable || product.countryAvailable || '',
                datasheetLink: md.datasheetLink || product.datasheetLink || '',
                certificateLink: md.certificateLink || product.certificateLink || '',
                remark: md.remark || product.remark || ''
            };
        }
        function getProductTechnicalSpecs(product = {}) {
            return product?.technicalSpecs && typeof product.technicalSpecs === 'object' ? product.technicalSpecs : {};
        }
        function getProductSourcing(product = {}) {
            const src = product?.sourcing && typeof product.sourcing === 'object' ? product.sourcing : {};
            const canonicalSupplierCode = normalizeSupplierCode(product?.supplierCode || '');
            return {
                sourceType: PRODUCT_SOURCE_TYPES.includes(src.sourceType) ? src.sourceType : 'Unknown',
                channelPartnerId: String(src.channelPartnerId || '').trim(),
                brandSupplierCode: normalizeSupplierCode(src.brandSupplierCode || product?.supplierCode || ''),
                commercialSupplierCode: normalizeSupplierCode(src.commercialSupplierCode || canonicalSupplierCode),
                factorySupplierCode: normalizeSupplierCode(src.factorySupplierCode || ''),
                brandOwnerSupplierCode: normalizeSupplierCode(src.brandOwnerSupplierCode || ''),
                authorizationStatus: PRODUCT_AUTHORIZATION_STATUS.includes(src.authorizationStatus) ? src.authorizationStatus : '',
                authorizationExpiry: String(src.authorizationExpiry || '').trim(),
                sourceRemark: String(src.sourceRemark || '').trim()
            };
        }
        function getProductSourceTypeLabel(product) {
            return getProductSourcing(product).sourceType || 'Unknown';
        }
        function readProductSourcingFromModal(canonicalSupplierCode = '') {
            const sourceType = document.getElementById('m-source-type')?.value || 'Unknown';
            if (sourceType === 'Direct Factory') {
                return compactProductMasterObject({
                    sourceType,
                    channelPartnerId: '',
                    brandSupplierCode: normalizeSupplierCode(canonicalSupplierCode),
                    commercialSupplierCode: normalizeSupplierCode(canonicalSupplierCode),
                    factorySupplierCode: normalizeSupplierCode(canonicalSupplierCode),
                    brandOwnerSupplierCode: normalizeSupplierCode(canonicalSupplierCode),
                    authorizationStatus: 'Not Required',
                    authorizationExpiry: '',
                    sourceRemark: String(document.getElementById('m-source-remark')?.value || '').trim()
                });
            }
            const partnerId = String(document.getElementById('m-channel-partner-id')?.value || '').trim();
            const partner = getChannelPartnerById(partnerId);
            const data = {
                sourceType,
                channelPartnerId: partnerId,
                brandSupplierCode: normalizeSupplierCode(canonicalSupplierCode),
                commercialSupplierCode: normalizeSupplierCode(document.getElementById('m-commercial-supplier-code')?.value || ''),
                factorySupplierCode: normalizeSupplierCode(document.getElementById('m-factory-supplier-code')?.value || canonicalSupplierCode),
                brandOwnerSupplierCode: normalizeSupplierCode(document.getElementById('m-brand-owner-supplier-code')?.value || canonicalSupplierCode),
                authorizationStatus: document.getElementById('m-authorization-status')?.value || partner?.authorizationStatus || '',
                authorizationExpiry: String(document.getElementById('m-authorization-expiry')?.value || partner?.authorizationExpiry || '').trim(),
                sourceRemark: String(document.getElementById('m-source-remark')?.value || '').trim()
            };
            return compactProductMasterObject(data);
        }
        function supplierSelectOptions(selectedCode = '', includeBlank = true) {
            const selected = normalizeSupplierCode(selectedCode);
            const blank = includeBlank ? '<option value="">-</option>' : '';
            return blank + suppliers
                .map(s => {
                    const code = normalizeSupplierCode(s.code);
                    const label = `${code} · ${getSupplierDisplayName(s)}`;
                    return `<option value="${htmlSafe(code)}" ${code === selected ? 'selected' : ''}>${htmlSafe(label)}</option>`;
                })
                .join('');
        }
        function setSupplyRouteSelectOptions(sourcing = {}, canonicalSupplierCode = '') {
            ['m-commercial-supplier-code', 'm-factory-supplier-code', 'm-brand-owner-supplier-code'].forEach(id => {
                const el = document.getElementById(id);
                if (!el) return;
                const selected = id === 'm-commercial-supplier-code'
                    ? (sourcing.commercialSupplierCode || canonicalSupplierCode)
                    : (id === 'm-factory-supplier-code' ? sourcing.factorySupplierCode : sourcing.brandOwnerSupplierCode);
                el.innerHTML = supplierSelectOptions(selected, true);
            });
        }
        function updateProductChannelPartnerOptions() {
            const select = document.getElementById('m-channel-partner-id');
            if (!select) return;
            const supplierCode = normalizeSupplierCode(document.getElementById('m-supplier-code')?.value || '');
            const sourceType = document.getElementById('m-source-type')?.value || '';
            const selected = select.value || '';
            select.innerHTML = channelPartnerOptions(selected, supplierCode, sourceType);
        }
        window.updateProductChannelPartnerOptions = updateProductChannelPartnerOptions;
        function updateSupplyRouteVisibility() {
            const sourceType = document.getElementById('m-source-type')?.value || 'Unknown';
            const direct = sourceType === 'Direct Factory';
            const partnerWrap = document.getElementById('m-channel-partner-wrap');
            const commercialWrap = document.getElementById('m-commercial-supplier-wrap');
            const factoryWrap = document.getElementById('m-factory-supplier-wrap');
            const brandWrap = document.getElementById('m-brand-owner-supplier-wrap');
            if (partnerWrap) partnerWrap.classList.toggle('hidden', direct || sourceType === 'Unknown');
            [commercialWrap, factoryWrap, brandWrap].forEach(wrap => wrap?.classList.add('hidden'));
            const note = document.getElementById('m-source-route-note');
            if (note) note.textContent = direct ? 'Direct factory uses selected Supplier as brand/factory' : 'Select a channel partner for non-direct supply';
            updateProductChannelPartnerOptions();
        }
        window.updateSupplyRouteVisibility = updateSupplyRouteVisibility;
        function fillProductSourcingDetails(product = {}) {
            const sourcing = getProductSourcing(product);
            const canonicalSupplierCode = normalizeSupplierCode(product?.supplierCode || '');
            setSupplyRouteSelectOptions(sourcing, canonicalSupplierCode);
            const setVal = (id, value) => { const el = document.getElementById(id); if (el) el.value = value || ''; };
            setVal('m-source-type', sourcing.sourceType || 'Unknown');
            updateProductChannelPartnerOptions();
            setVal('m-channel-partner-id', sourcing.channelPartnerId);
            setVal('m-commercial-supplier-code', sourcing.commercialSupplierCode || canonicalSupplierCode);
            setVal('m-factory-supplier-code', sourcing.factorySupplierCode);
            setVal('m-brand-owner-supplier-code', sourcing.brandOwnerSupplierCode);
            setVal('m-authorization-status', sourcing.authorizationStatus);
            setVal('m-authorization-expiry', sourcing.authorizationExpiry);
            setVal('m-source-remark', sourcing.sourceRemark);
            updateSupplyRouteVisibility();
        }
        function productModalHistoryTemplate(fieldKey = '', category = '') {
            const normalizedCategory = normalizeProductCategory(category || document.getElementById('m-category')?.value || '', '');
            const classification = ['category', 'scenario'].includes(String(fieldKey || ''));
            return {
                id: classification ? 'product-modal:classification' : `product-modal:${normalizedCategory || 'all'}`,
                category: normalizedCategory || 'PV Module',
                detailGroup: 'productModal'
            };
        }
        function productModalHistoryChoices(fieldKey = '', category = '') {
            const key = String(fieldKey || '').trim();
            const normalizedCategory = normalizeProductCategory(category || document.getElementById('m-category')?.value || '', '');
            if (key === 'category') {
                return uniqueCertList(['PV Module', 'Inverter', 'Battery', 'Accessory', 'All-in-One System', 'C&I Storage', ...products.map(product => normalizeProductCategory(product.category || '', ''))]);
            }
            if (key === 'scenario') {
                const scoped = normalizedCategory ? (subcategoriesByCategory[normalizedCategory] || []) : [];
                const all = Object.values(subcategoriesByCategory || {}).flat();
                return uniqueCertList([...scoped, ...all, ...products
                    .filter(product => !normalizedCategory || normalizeProductCategory(product.category || '', '') === normalizedCategory)
                    .map(product => normalizeProductSubcategory(product.scenario || ''))]);
            }
            const rows = products.filter(product => !normalizedCategory || normalizeProductCategory(product.category || '', '') === normalizedCategory);
            if (key === 'spec') {
                return uniqueCertList(rows.map(product => product.spec || getProductDisplaySpec(product)).filter(productMasterDetailValuePresent));
            }
            if (key === 'inverterKw') {
                return uniqueCertList(rows.map(product => formatCapacityValue(parseHybridStorageSpec(product).inverterKw)).filter(productMasterDetailValuePresent));
            }
            if (key === 'batteryKwh') {
                return uniqueCertList(rows.map(product => formatCapacityValue(parseHybridStorageSpec(product).batteryKwh)).filter(productMasterDetailValuePresent));
            }
            const values = rows.map(product => {
                if (PRODUCT_MASTER_COMMON_FIELD_KEYS.includes(key)) return getProductMasterData(product)[key];
                return getProductTechnicalSpecs(product)[key];
            });
            if (key === 'status') values.push('Active', 'Discontinued', 'Pending');
            return uniqueCertList(values.filter(productMasterDetailValuePresent));
        }
        function renderProductModalHistoryInput({
            id = '',
            fieldKey = '',
            value = '',
            choices = [],
            category = '',
            placeholder = '',
            inputType = 'text',
            extraAttrs = '',
            onInput = '',
            onChange = '',
            inputClass = 'w-full border border-slate-200 rounded-xl p-3 text-sm outline-none focus:border-blue-500 bg-white'
        } = {}) {
            return renderProductMasterDetailHistoryInputControl({
                inputId: id,
                value,
                choices,
                commonAttrs: `data-product-modal-history-field="${htmlSafe(fieldKey)}"`,
                placeholder,
                template: productModalHistoryTemplate(fieldKey, category),
                fieldKey,
                inputType,
                extraAttrs,
                onInput,
                onChange,
                inputClass
            });
        }
        function renderProductModalCategoryHistoryField(value = document.getElementById('m-category')?.value || '') {
            const box = document.getElementById('product-modal-category-field');
            if (!box) return;
            const sync = 'updateSubcatSuggestions(); window.renderProductModalSpecHistoryFields?.({ category: this.value }); updateProductPriceUnitNote(); renderProductModalMasterDetailFields(this.value, readProductMasterDataFromModal()); renderProductTechnicalFields(this.value); maybeFillProductCertificationDefaults()';
            box.innerHTML = renderProductModalHistoryInput({
                id: 'm-category',
                fieldKey: 'category',
                value,
                choices: productModalHistoryChoices('category', value),
                onInput: sync,
                onChange: sync,
                inputClass: 'w-full border border-slate-200 rounded-xl p-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50 bg-white'
            });
        }
        function renderProductModalSubcategoryHistoryField(value = document.getElementById('m-scenario')?.value || '') {
            const box = document.getElementById('product-modal-subcategory-field');
            if (!box) return;
            const category = document.getElementById('m-category')?.value || '';
            box.innerHTML = renderProductModalHistoryInput({
                id: 'm-scenario',
                fieldKey: 'scenario',
                value,
                category,
                choices: productModalHistoryChoices('scenario', category),
                placeholder: 'e.g. Rooftop / C&I Storage'
            });
        }
        function renderProductModalSpecHistoryField(value = document.getElementById('m-spec')?.value || '', category = document.getElementById('m-category')?.value || '') {
            const box = document.getElementById('product-modal-spec-field');
            if (!box) return;
            box.innerHTML = renderProductModalHistoryInput({
                id: 'm-spec',
                fieldKey: 'spec',
                value,
                category,
                choices: isHybridStorageCategory(category) ? [] : productModalHistoryChoices('spec', category),
                placeholder: 'e.g. 550W/48V',
                onInput: 'updateProductPriceUnitNote()',
                onChange: 'updateProductPriceUnitNote()',
                inputClass: 'w-full border border-slate-200 rounded-xl p-3 text-sm outline-none focus:border-blue-500 bg-white'
            });
        }
        function renderProductModalHybridCapacityHistoryFields(values = {}, category = document.getElementById('m-category')?.value || '') {
            const invBox = document.getElementById('product-modal-inverter-kw-field');
            const batBox = document.getElementById('product-modal-battery-kwh-field');
            const inverterKw = values.inverterKw ?? document.getElementById('m-inverter-kw')?.value ?? '';
            const batteryKwh = values.batteryKwh ?? document.getElementById('m-battery-kwh')?.value ?? '';
            if (invBox) {
                invBox.innerHTML = renderProductModalHistoryInput({
                    id: 'm-inverter-kw',
                    fieldKey: 'inverterKw',
                    value: inverterKw,
                    category,
                    choices: productModalHistoryChoices('inverterKw', category),
                    placeholder: 'e.g. 5.5',
                    inputType: 'number',
                    extraAttrs: 'step="0.01" min="0"',
                    onInput: 'syncHybridSpecFromInputs()',
                    onChange: 'syncHybridSpecFromInputs()',
                    inputClass: 'w-full border border-purple-100 rounded-xl p-3 text-sm outline-none focus:border-purple-500 bg-white'
                });
            }
            if (batBox) {
                batBox.innerHTML = renderProductModalHistoryInput({
                    id: 'm-battery-kwh',
                    fieldKey: 'batteryKwh',
                    value: batteryKwh,
                    category,
                    choices: productModalHistoryChoices('batteryKwh', category),
                    placeholder: 'e.g. 10',
                    inputType: 'number',
                    extraAttrs: 'step="0.01" min="0"',
                    onInput: 'syncHybridSpecFromInputs()',
                    onChange: 'syncHybridSpecFromInputs()',
                    inputClass: 'w-full border border-purple-100 rounded-xl p-3 text-sm outline-none focus:border-purple-500 bg-white'
                });
            }
        }
        function renderProductModalSpecHistoryFields(options = {}) {
            const category = options.category ?? document.getElementById('m-category')?.value ?? '';
            renderProductModalSpecHistoryField(options.spec ?? document.getElementById('m-spec')?.value ?? '', category);
            renderProductModalHybridCapacityHistoryFields({
                inverterKw: options.inverterKw ?? document.getElementById('m-inverter-kw')?.value ?? '',
                batteryKwh: options.batteryKwh ?? document.getElementById('m-battery-kwh')?.value ?? ''
            }, category);
            updateHybridSpecControls();
        }
        window.renderProductModalSpecHistoryFields = renderProductModalSpecHistoryFields;
        function renderProductModalClassificationHistoryFields(category = '', scenario = '') {
            renderProductModalCategoryHistoryField(category);
            renderProductModalSubcategoryHistoryField(scenario);
        }
        function productModalMasterFieldPlaceholder(key = '') {
            return {
                application: 'Residential / C&I / Utility',
                voltageClass: 'LV / HV / N/A',
                phase: 'Single / Three / N/A',
                countryAvailable: 'MY, VN, TH...'
            }[key] || '';
        }
        function renderProductModalMasterDetailFields(category = document.getElementById('m-category')?.value || '', values = {}) {
            const box = document.getElementById('product-master-details-fields');
            if (!box) return;
            const md = values || {};
            box.innerHTML = PRODUCT_MASTER_COMMON_FIELD_KEYS.map(key => {
                const label = productMasterDetailFieldLabel(key);
                const span = key === 'remark' ? 'md:col-span-2' : '';
                return `<div class="${span}">
                    <label class="block text-[10px] font-black text-slate-400 uppercase mb-1">${htmlSafe(label)}</label>
                    ${renderProductModalHistoryInput({
                        id: `m-master-${key}`,
                        fieldKey: key,
                        value: md[key] || '',
                        category,
                        choices: productModalHistoryChoices(key, category),
                        placeholder: productModalMasterFieldPlaceholder(key)
                    })}
                </div>`;
            }).join('');
        }
        function readProductMasterDataFromModal() {
            const data = {};
            PRODUCT_MASTER_COMMON_FIELD_KEYS.forEach(key => {
                data[key] = String(document.getElementById(`m-master-${key}`)?.value || '').trim();
            });
            return compactProductMasterObject(data);
        }
        function readProductTechnicalSpecsFromModal(category) {
            const specs = {};
            getProductTechnicalSpecFieldsForCategory(category).forEach(field => {
                specs[field.id] = coerceProductMasterFieldValue(document.getElementById(`m-tech-${field.id}`)?.value, field.type);
            });
            return compactProductMasterObject(specs);
        }
        function fillProductMasterDetails(product = {}) {
            const md = getProductMasterData(product);
            renderProductModalMasterDetailFields(product.category || document.getElementById('m-category')?.value || '', md);
        }
        window.renderProductTechnicalFields = (category, values = {}) => {
            const box = document.getElementById('product-master-technical-fields');
            const label = document.getElementById('product-master-technical-group-label');
            if (!box) return;
            const fields = getProductTechnicalSpecFieldsForCategory(category);
            const group = getProductTypeGroup({ category });
            if (label) label.textContent = fields.length ? group.label : 'No V2 fields for this category';
            if (!fields.length) {
                box.innerHTML = `<div class="md:col-span-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-xs text-slate-400">Accessory keeps the existing Product Master fields in this version.</div>`;
                return;
            }
            box.innerHTML = fields.map(field => {
                const value = values?.[field.id] ?? '';
                return `<div>
                    <label class="block text-[10px] font-black text-slate-400 uppercase mb-1">${htmlSafe(field.label)}</label>
                    ${renderProductModalHistoryInput({
                        id: `m-tech-${field.id}`,
                        fieldKey: field.id,
                        value,
                        category,
                        choices: productModalHistoryChoices(field.id, category),
                        inputType: field.type === 'number' ? 'number' : 'text',
                        extraAttrs: field.type === 'number' ? 'step="0.01"' : ''
                    })}
                </div>`;
            }).join('');
        };
        function flattenProductMasterValues(value) {
            if (value === undefined || value === null) return [];
            if (Array.isArray(value)) return value.flatMap(flattenProductMasterValues);
            if (typeof value === 'object') return Object.values(value).flatMap(flattenProductMasterValues);
            const text = String(value || '').trim();
            return text ? [text] : [];
        }
        function productMasterSearchHaystack(product) {
            const certReq = getProductCertificationRequirements(product);
            const certRecords = productCertificationSelectedRecords(product);
            const certEvidence = productCertificationEvidenceFor(product?.id || '');
            return [
                product?.id,
                product?.name,
                product?.category,
                product?.scenario,
                product?.spec,
                getProductSupplierDisplay(product),
                ...flattenProductMasterValues(getProductSourcing(product)),
                ...flattenProductMasterValues(product.masterData),
                ...flattenProductMasterValues(product.technicalSpecs),
                ...flattenProductMasterValues(certReq.recordIds),
                ...flattenProductMasterValues(certReq.standards),
                ...flattenProductMasterValues(certRecords.map(record => [record.id, record.standard, record.requirementLevel, record.sourceCategory])),
                ...flattenProductMasterValues(certEvidence),
                ...flattenProductMasterValues(productMasterAttachedCertFiles(product)),
                ...flattenProductMasterValues(productMasterAttachedSpecFiles(product)),
                ...flattenProductMasterValues(getProductCompatibilityRules(product))
            ].map(v => String(v || '').toLowerCase()).join(' ');
        }
        function productMatchesProductMasterSearch(product, query) {
            const q = String(query || '').trim().toLowerCase();
            if (!q) return true;
            const haystack = productMasterSearchHaystack(product);
            return q.split(/\s+/).filter(Boolean).every(term => haystack.includes(term));
        }
        function normalizeCompatibilityRule(rule = {}) {
            const relationType = COMPATIBILITY_RELATION_TYPES.includes(rule.relationType) ? rule.relationType : 'PV ↔ Inverter';
            const status = COMPATIBILITY_STATUS_TYPES.includes(rule.status) ? rule.status : 'Unknown';
            const id = String(rule.id || `compat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`).trim();
            return {
                id,
                relationType,
                sourceProductId: String(rule.sourceProductId || '').trim(),
                targetProductId: String(rule.targetProductId || '').trim(),
                systemScope: String(rule.systemScope || '').trim(),
                status,
                protocol: String(rule.protocol || '').trim(),
                constraints: String(rule.constraints || '').trim(),
                approvedBy: String(rule.approvedBy || '').trim(),
                updatedAt: String(rule.updatedAt || '').trim(),
                remark: String(rule.remark || '').trim()
            };
        }
        function normalizeCompatibilityRules(rules = []) {
            return (Array.isArray(rules) ? rules : []).map(normalizeCompatibilityRule).filter(rule => rule.sourceProductId || rule.targetProductId);
        }
        function getProductById(productId) {
            const id = String(productId || '').trim();
            return products.find(p => String(p.id || '').trim() === id) || null;
        }
        function getCompatibilityProductLabel(productId) {
            const p = getProductById(productId);
            return p ? `${p.id} · ${productListDisplayText(p.name)}` : String(productId || '-');
        }
        function getProductCompatibilityRules(product) {
            const productId = String(product?.id || '').trim();
            if (!productId) return [];
            return compatibilityRules.filter(rule => rule.sourceProductId === productId || rule.targetProductId === productId);
        }
        function getProductCompatibilitySummary(product) {
            const rules = getProductCompatibilityRules(product);
            if (!rules.length) return { status: 'Unknown', count: 0, label: 'No rules', title: 'No compatibility rules yet' };
            const blocked = rules.filter(rule => rule.status === 'Blocked').length;
            const conditional = rules.filter(rule => rule.status === 'Conditional').length;
            const pending = rules.filter(rule => rule.status === 'Pending').length;
            const approved = rules.filter(rule => rule.status === 'Approved').length;
            const status = blocked ? 'Blocked' : (conditional ? 'Conditional' : (pending ? 'Pending' : (approved ? 'Approved' : 'Unknown')));
            return {
                status,
                count: rules.length,
                label: `${status} (${rules.length})`,
                title: rules.map(rule => `${rule.relationType}: ${getCompatibilityProductLabel(rule.sourceProductId)} -> ${getCompatibilityProductLabel(rule.targetProductId)} | ${rule.status}`).join('\n')
            };
        }
        function productSelectOptions(selectedId = '') {
            const selected = String(selectedId || '').trim();
            return '<option value="">-</option>' + products.map(p => {
                const id = String(p.id || '').trim();
                return `<option value="${htmlSafe(id)}" ${id === selected ? 'selected' : ''}>${htmlSafe(getCompatibilityProductLabel(id))}</option>`;
            }).join('');
        }
        function openProductCompatibilityDetails(productId) {
            const searchEl = document.getElementById('compatibility-search');
            if (searchEl) searchEl.value = String(productId || '');
            renderCompatibilityMatrix();
            document.getElementById('compatibility-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        window.openProductCompatibilityDetails = openProductCompatibilityDetails;
        function setProductMasterControlState(prefix, activeId, ids) {
            const activeClass = 'px-3 py-2 rounded-xl border border-purple-200 bg-white text-xs font-black text-purple-800 shadow-sm';
            const idleClass = 'px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-black text-slate-500 hover:bg-slate-50';
            ids.forEach(id => {
                const el = document.getElementById(`${prefix}-${id}`);
                if (el) el.className = id === activeId ? activeClass : idleClass;
            });
        }
        function renderProductMasterControls(total = products.length, typeVisible = products.length, visible = typeVisible) {
            const typeView = getProductMasterTypeView();
            const roleView = getProductMasterRoleView();
            setProductMasterControlState('product-master-type', typeView, PRODUCT_TYPE_GROUPS.map(group => group.id));
            setProductMasterControlState('product-master-role', roleView, PRODUCT_ROLE_VIEWS.map(view => view.id));
            const typeLabel = (PRODUCT_TYPE_GROUPS.find(group => group.id === typeView) || PRODUCT_TYPE_GROUPS[0]).label;
            const roleLabel = (PRODUCT_ROLE_VIEWS.find(view => view.id === roleView) || PRODUCT_ROLE_VIEWS[0]).label;
            const search = getProductMasterSearchQuery();
            const searchEl = document.getElementById('product-master-search');
            if (searchEl && searchEl.value !== search) searchEl.value = search;
            const summary = document.getElementById('product-master-view-summary');
            if (summary) summary.textContent = `${visible} visible / ${typeVisible} type-filtered / ${total} total | ${typeLabel} | ${roleLabel} view${search ? ` | Search: ${search}` : ''}`;
        }
        window.renderProductMasterControls = renderProductMasterControls;
        window.setProductMasterTypeView = (typeId) => {
            const next = PRODUCT_TYPE_GROUPS.some(group => group.id === typeId) ? typeId : 'all';
            try { localStorage.setItem(PRODUCT_MASTER_TYPE_STORAGE_KEY, next); } catch (e) {}
            renderDb();
        };
        window.setProductMasterRoleView = (roleViewId) => {
            const next = PRODUCT_ROLE_VIEWS.some(view => view.id === roleViewId) ? roleViewId : getDefaultProductRoleView();
            try { localStorage.setItem(PRODUCT_MASTER_ROLE_STORAGE_KEY, next); } catch (e) {}
            renderDb();
        };
        window.setProductMasterSearch = (query) => {
            try { localStorage.setItem(PRODUCT_MASTER_SEARCH_STORAGE_KEY, String(query || '').trim()); } catch (e) {}
            renderDb();
        };
        const PRODUCT_LIST_DISPLAY_REPLACEMENTS = [
            ['联塑 LESSO', 'LESSO'],
            ['明匠', 'Mingjiang'],
            ['埃克森', 'Exxon'],
            ['汉伏', 'Hanfu'],
            ['未指定Supplier', 'Unassigned Supplier'],
            ['未指定位置', 'Unassigned Location'],
            ['马来西亚仓库', 'Malaysia Warehouse'],
            ['A 仓库', 'Warehouse A'],
            ['未分类', 'Uncategorized'],
            ['N-type Module', 'N-type Module'],
            ['N-type组件', 'N-type Module'],
            ['组件', 'Module'],
            ['逆变器', 'Inverter'],
            ['电池', 'Battery'],
            ['堆叠式单相逆变器', 'Stackable Single-Phase Inverter'],
            ['堆叠式家储', 'Stackable Home Storage'],
            ['堆叠式产品配件', 'Stackable Product Accessory'],
            ['堆叠式配件', 'Stackable Accessory'],
            ['单相一体机', 'Single-Phase All-in-One'],
            ['一体机', 'All-in-One System'],
            ['储能柜', 'Energy Storage Cabinet'],
            ['户外柜', 'Outdoor Cabinet'],
            ['光伏组件', 'PV Module'],
            ['光伏板', 'PV Module'],
            ['储能电池', 'Battery'],
            ['配件', 'Accessory'],
            ['工商储', 'C&I Storage'],
            ['工商业储能', 'C&I Storage'],
            ['采购入库', 'Stock In'],
            ['删除入库记录', 'Deleted stock-in record'],
            ['修改入库', 'Edited stock-in'],
            ['入库到', 'to'],
            ['存放', 'Stored at'],
            ['总成本', 'Total Cost'],
            ['批次', 'Batch'],
            ['三相', 'Three-Phase'],
            ['单相', 'Single-Phase'],
            ['双面', 'Bifacial'],
            ['天', 'days'],
            ['周', 'weeks']
        ];
        function productListDisplayText(value) {
            let text = String(value ?? '').trim();
            if (!text) return '-';
            PRODUCT_LIST_DISPLAY_REPLACEMENTS.forEach(([from, to]) => {
                text = text.split(from).join(to);
            });
            return text.replace(/\s+days\b/g, ' days').replace(/\s+weeks\b/g, ' weeks');
        }
        const FROZEN_TABLE_STORAGE_KEY = 'minova_frozen_table_columns_v1';
        function getFrozenTableState() {
            try {
                const raw = JSON.parse(localStorage.getItem(FROZEN_TABLE_STORAGE_KEY) || '{}');
                return raw && typeof raw === 'object' ? raw : {};
            } catch (e) {
                return {};
            }
        }
        function getFrozenColumnCount(tableKey) {
            const state = getFrozenTableState();
            const n = parseInt(state[tableKey], 10);
            return Number.isFinite(n) && n > 0 ? n : 0;
        }
        function setFrozenColumnCount(tableKey, count) {
            const state = getFrozenTableState();
            state[tableKey] = Math.max(0, parseInt(count, 10) || 0);
            try { localStorage.setItem('minova_frozen_table_columns_v1', JSON.stringify(state)); } catch (e) {}
        }
        function renderFreezeColumnButton(tableKey, maxColumns = 3) {
            const count = getFrozenColumnCount(tableKey);
            return `<button id="freeze-${htmlSafe(tableKey)}-btn" type="button" class="table-freeze-btn" onclick="window.cycleFrozenColumns('${htmlSafe(tableKey)}', ${maxColumns})" title="Cycle frozen columns">Freeze ${count}</button>`;
        }
        function updateFreezeColumnButton(tableKey) {
            const btn = document.getElementById(`freeze-${tableKey}-btn`);
            if (!btn) return;
            const count = getFrozenColumnCount(tableKey);
            btn.textContent = `Freeze ${count}`;
            btn.classList.toggle('bg-purple-50', count > 0);
            btn.classList.toggle('text-purple-700', count > 0);
            btn.classList.toggle('border-purple-200', count > 0);
        }
        window.cycleFrozenColumns = (tableKey, maxColumns = 3) => {
            const next = (getFrozenColumnCount(tableKey) + 1) % (maxColumns + 1);
            setFrozenColumnCount(tableKey, next);
            window.applyFrozenColumns(tableKey);
        };
        window.applyFrozenColumns = (tableKey) => {
            const table = document.querySelector(`[data-freeze-table="${tableKey}"]`);
            updateFreezeColumnButton(tableKey);
            if (!table) return;
            table.querySelectorAll('[data-frozen-cell="true"]').forEach(cell => {
                cell.dataset.frozenCell = '';
                cell.style.position = '';
                cell.style.left = '';
                cell.style.zIndex = '';
                cell.style.background = '';
                cell.style.boxShadow = '';
            });
            const count = getFrozenColumnCount(tableKey);
            if (!count) return;
            const headRow = table.tHead?.rows?.[0];
            if (!headRow) return;
            let left = 0;
            const offsets = [];
            for (let i = 0; i < Math.min(count, headRow.cells.length); i += 1) {
                const width = headRow.cells[i].getBoundingClientRect?.().width || headRow.cells[i].offsetWidth || 120;
                offsets.push(left);
                left += width;
            }
            Array.from(table.rows || []).forEach(row => {
                offsets.forEach((offset, index) => {
                    const cell = row.cells[index];
                    if (!cell || cell.colSpan > 1) return;
                    cell.dataset.frozenCell = 'true';
                    cell.style.position = 'sticky';
                    cell.style.left = `${offset}px`;
                    cell.style.zIndex = cell.tagName === 'TH' ? '30' : '20';
                    cell.style.background = cell.tagName === 'TH' ? '#f8fafc' : '#fff';
                    cell.style.boxShadow = '1px 0 0 rgba(226, 232, 240, 0.9)';
                });
            });
        };
        function productMasterCellClass(column) {
            const align = column.align ? ` ${column.align}` : '';
            return `py-4 px-4${align}`;
        }
        function productMasterHeaderHtml(column) {
            const align = column.align ? ` ${column.align}` : '';
            const label = htmlSafe(column.label || '');
            if (column.key === 'id') {
                return `<th class="py-4 px-4${align}">
                    <div class="flex flex-col items-start gap-1">
                        <span>${label}</span>
                        ${renderFreezeColumnButton('product-list', 3)}
                    </div>
                </th>`;
            }
            return `<th class="py-4 px-4${align}">${label}</th>`;
        }
        function productMasterActionsHtml(product) {
            const id = htmlSafe(product?.id || '');
            return `<div class="flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-all">
                <button onclick="editProduct('${id}')" class="text-purple-700 hover:bg-purple-50 p-1 rounded">✎</button>
                <button onclick="deleteProduct('${id}')" class="text-red-300 hover:text-red-500 p-1 rounded">🗑</button>
            </div>`;
        }
        function productMasterImageHtml(product) {
            const productImg = String(product?.productImageDataUrl || product?.imageDataUrl || '').trim();
            return productImg
                ? `<img src="${htmlSafe(productImg)}" class="h-10 w-16 object-contain rounded-lg border border-slate-100 bg-white" alt="${htmlSafe(product?.name || '')}">`
                : `<div class="h-10 w-16 rounded-lg border border-dashed border-slate-200 bg-slate-50 flex items-center justify-center text-[10px] text-slate-300">No Img</div>`;
        }
        function productMasterWarrantyHtml(product) {
            const warrantyY = product?.warrantyYears ? `${product.warrantyYears} years` : '-';
            const warrantyC = product?.warrantyCycles ? `${product.warrantyCycles} cycles` : '-';
            return `${htmlSafe(warrantyY)} / ${htmlSafe(warrantyC)}`;
        }
        function productMasterCertificationHtml(ctx) {
            return `<span title="${htmlSafe(ctx.certTitle)}">${htmlSafe(ctx.certBrief)}</span>`;
        }
        function productMasterAttachedCertFiles(product) {
            return [
                ...(Array.isArray(product?.certifications?.tuvCerts) ? product.certifications.tuvCerts : [])
            ].map(file => file?.name || file?.fileName || file?.path || file?.url || '').filter(Boolean);
        }
        function productMasterAttachedSpecFiles(product) {
            return [
                ...(Array.isArray(product?.certifications?.specSheets) ? product.certifications.specSheets : [])
            ].map(file => file?.name || file?.fileName || file?.path || file?.url || '').filter(Boolean);
        }
        function productMasterCertificationStatus(product) {
            const summary = productCertificationEvidenceSummary(product);
            const req = getProductCertificationRequirements(product);
            const selectedCount = summary.selectedCount;
            const uploadedCount = summary.uploadedRecords + productMasterAttachedCertFiles(product).length;
            const externalLink = String(getProductMasterData(product).certificateLink || '').trim();
            const missingMandatory = summary.missingMandatory.length;
            if (!selectedCount && !(req.standards || []).length && !uploadedCount && !externalLink) return { status: 'Not Set', label: 'No requirements', gap: 'Requirements missing' };
            if (selectedCount && missingMandatory) return { status: 'Gap', label: `${selectedCount} records / ${summary.fileCount} files`, gap: `${missingMandatory} mandatory missing` };
            if (selectedCount) return { status: 'Ready', label: `${selectedCount} records / ${summary.fileCount || uploadedCount} evidence`, gap: '' };
            if ((req.standards || []).length) return { status: uploadedCount || externalLink ? 'Ready' : 'Gap', label: `${(req.standards || []).length} legacy standards`, gap: uploadedCount || externalLink ? '' : 'Record IDs missing' };
            return { status: 'Evidence Only', label: uploadedCount ? `${uploadedCount} evidence` : 'External link only', gap: 'Requirements missing' };
        }
        function productMasterStatusPill(status, tone = 'slate') {
            const palette = {
                green: 'bg-green-50 text-green-700',
                amber: 'bg-amber-50 text-amber-700',
                red: 'bg-red-50 text-red-700',
                purple: 'bg-purple-50 text-purple-700',
                slate: 'bg-slate-50 text-slate-500'
            };
            return `<span class="text-[10px] font-black px-2 py-1 rounded ${palette[tone] || palette.slate}">${htmlSafe(status || '-')}</span>`;
        }
        function productMasterQuoteReadiness(product) {
            const md = getProductMasterData(product);
            const cert = productMasterCertificationStatus(product);
            const hasPrice = getProductPriceCny(product) > 0;
            const active = !md.status || md.status === 'Active';
            const hasLeadTime = !!String(product?.leadTime || '').trim();
            const ready = hasPrice && active && hasLeadTime && cert.status !== 'Gap' && cert.status !== 'Not Set';
            return ready
                ? { status: 'Quote Ready', tone: 'green', note: 'Price, lead time, cert evidence' }
                : { status: 'Check Before Quote', tone: 'amber', note: [hasPrice ? '' : 'price', active ? '' : 'status', hasLeadTime ? '' : 'lead time', cert.status === 'Gap' || cert.status === 'Not Set' ? 'certification' : ''].filter(Boolean).join(', ') || 'review' };
        }
        function productMasterSourceRisk(product) {
            const sourcing = getProductSourcing(product);
            const partner = getProductChannelPartner(product);
            if (partner?.authorizationStatus === 'Expired') return { status: 'High', tone: 'red', note: 'Channel authorization expired' };
            if (partner?.authorizationStatus === 'Authorized') return { status: 'Controlled', tone: 'green', note: partner.type };
            if (sourcing.sourceType === 'Direct Factory') return { status: 'Low', tone: 'green', note: 'Direct factory' };
            if (sourcing.sourceType === 'Authorized Distributor' && sourcing.authorizationStatus === 'Authorized') return { status: 'Controlled', tone: 'green', note: 'Authorized channel' };
            if (sourcing.sourceType === 'Dealer') return { status: 'Review', tone: 'amber', note: 'Dealer channel' };
            if (sourcing.authorizationStatus === 'Expired') return { status: 'High', tone: 'red', note: 'Authorization expired' };
            return { status: 'Unknown', tone: 'slate', note: sourcing.sourceRemark || 'Source not confirmed' };
        }
        function supplierNameByCode(code) {
            const supplier = getSupplierByCode(normalizeSupplierCode(code));
            return supplier ? getSupplierDisplayName(supplier) : (code || '-');
        }
        function getProductChannelPartner(product) {
            return getChannelPartnerById(getProductSourcing(product).channelPartnerId);
        }
        function productMasterCommercialSupplierName(product, ctx) {
            const partner = getProductChannelPartner(product);
            if (partner) return partner.name;
            return supplierNameByCode(ctx.sourcing.commercialSupplierCode || product?.supplierCode);
        }
        function productMasterSupplyRouteHtml(ctx) {
            const sourcing = ctx.sourcing;
            const source = sourcing.sourceType || 'Unknown';
            const partner = ctx.channelPartner;
            const route = partner ? channelPartnerLabel(partner) : supplierNameByCode(sourcing.factorySupplierCode || sourcing.brandOwnerSupplierCode || sourcing.brandSupplierCode);
            return `<div class="font-bold text-slate-700 text-xs">${htmlSafe(source)}</div><div class="text-[10px] text-slate-400">${htmlSafe(route !== '-' ? route : ctx.supplierName)}</div>`;
        }
        function productMasterQuotePriceHtml(product) {
            const pricing = priceListProductPricing(product || {});
            const selectedPrice = getPriceListSelectedPcsPrice(pricing);
            const selectedLabel = getPriceListSelectedPriceLabel();
            return `${renderDualCurrencyAmount(selectedPrice, 2, 'pcs')}<div class="text-[10px] text-slate-400">${htmlSafe(selectedLabel)} / quote-ready</div>`;
        }
        function productMasterTechnicalFitHtml(product) {
            const group = getProductTypeGroup(product);
            const inv = Number.isFinite(parseFloat(product?.inverterKw)) ? `${formatNumberAuto(product.inverterKw, 2)} kW inverter` : '';
            const bat = Number.isFinite(parseFloat(product?.batteryKwh)) ? `${formatNumberAuto(product.batteryKwh, 2)} kWh battery` : '';
            const capacity = [inv, bat].filter(Boolean).join(' / ');
            return `<div class="font-bold text-slate-700">${htmlSafe(group.label)}</div><div class="text-[10px] text-slate-400">${htmlSafe(capacity || getProductPricingMeta(product || {}).label || '-')}</div>`;
        }
        function productMasterMarketAlignmentHtml(product) {
            const summary = getMarketPriceSummary(product?.category || '', { days: 30 });
            if (!summary.records.length) return `<div class="font-bold text-slate-400">No 30D benchmark</div><div class="text-[10px] text-slate-400">Unit /${htmlSafe(summary.unit)}</div>`;
            return `${formatMarketPrice(summary.avgCny, summary.unit, getPriceListCurrencyPriority())}<div class="text-[10px] text-slate-400">30D market avg</div>`;
        }
        function productMasterValueHtml(value, fallback = '-') {
            return htmlSafe(String(value ?? '').trim() || fallback);
        }
        function productMasterLinkHtml(value, label = 'Open') {
            const url = String(value || '').trim();
            if (!url) return '<span class="text-xs text-slate-400">-</span>';
            return `<a href="${htmlSafe(url)}" target="_blank" rel="noopener" class="text-xs font-bold text-blue-600 hover:underline">${htmlSafe(label)}</a>`;
        }
        function productMasterTechnicalSummary(product) {
            const group = getProductTypeGroup(product).id;
            const t = getProductTechnicalSpecs(product);
            if (group === 'pv') {
                return [t.powerW ? `${t.powerW}W` : '', t.cellType, t.moduleType, t.maxSystemVoltageV ? `${t.maxSystemVoltageV}V max` : ''].filter(Boolean).join(' / ');
            }
            if (group === 'inverter') {
                return [t.ratedAcPowerKw ? `${t.ratedAcPowerKw}kW AC` : '', t.maxPvInputPowerKw ? `${t.maxPvInputPowerKw}kW PV` : '', t.mpptQty ? `${t.mpptQty} MPPT` : '', t.compatibleBatterySeries].filter(Boolean).join(' / ');
            }
            if (group === 'battery') {
                return [t.nominalEnergyKwh ? `${t.nominalEnergyKwh}kWh nominal` : '', t.usableEnergyKwh ? `${t.usableEnergyKwh}kWh usable` : '', t.batteryType, t.communication].filter(Boolean).join(' / ');
            }
            if (group === 'ess') {
                return [t.nominalEnergyKwh ? `${t.nominalEnergyKwh}kWh` : '', t.pcsRatedPowerKw ? `${t.pcsRatedPowerKw}kW PCS` : '', t.coolingType, t.emsIncluded ? `EMS ${t.emsIncluded}` : ''].filter(Boolean).join(' / ');
            }
            return '';
        }
        function productMasterEfficiencyCapacity(product) {
            const group = getProductTypeGroup(product).id;
            const t = getProductTechnicalSpecs(product);
            if (group === 'pv') return [t.moduleEfficiencyPct ? `${t.moduleEfficiencyPct}% eff.` : '', t.powerW ? `${t.powerW}W` : ''].filter(Boolean).join(' / ');
            if (group === 'inverter') return [t.ratedAcPowerKw ? `${t.ratedAcPowerKw}kW` : '', t.maxAcOutputPowerKw ? `${t.maxAcOutputPowerKw}kW max` : ''].filter(Boolean).join(' / ');
            if (group === 'battery') return [t.nominalEnergyKwh ? `${t.nominalEnergyKwh}kWh` : '', t.dodPct ? `${t.dodPct}% DOD` : '', t.cycleLife].filter(Boolean).join(' / ');
            if (group === 'ess') return [t.nominalEnergyKwh ? `${t.nominalEnergyKwh}kWh` : '', t.pcsRatedPowerKw ? `${t.pcsRatedPowerKw}kW` : '', t.roundTripEfficiencyPct ? `${t.roundTripEfficiencyPct}% RTE` : ''].filter(Boolean).join(' / ');
            return '';
        }
        function productMasterContext(product) {
            const costCny = getProductCostCny(product);
            const priceCny = getProductPriceCny(product);
            const pricingMeta = getProductPricingMeta(product);
            const margin = priceCny > 0 ? ((priceCny - costCny) / priceCny * 100).toFixed(1) : '0.0';
            const supplier = getProductSupplier(product);
            const supplierName = productListDisplayText(supplier ? getSupplierDisplayName(supplier) : (product?.vendor || '-'));
            const certReq = getProductCertificationRequirements(product);
            const certRecords = productCertificationSelectedRecords(product);
            const certTitle = [
                ...certRecords.map(record => `${record.id} · ${record.standard} · ${record.requirementLevel}`),
                ...(certReq.standards || [])
            ].join('\n');
            const certBrief = certRecords.length
                ? `${certRecords.length} records`
                : ((certReq.standards || []).slice(0, 2).join(', ') || '-');
            const contactHtml = product?.contact ? `<div class="relative group inline-block cursor-help"><span class="${product.contactInfo ? 'border-b border-dashed border-blue-400 text-blue-600' : ''}">${productListDisplayText(product.contact)}</span>${product.contactInfo ? `<div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block px-3 py-2 bg-slate-800 text-white text-xs rounded-lg z-50 whitespace-nowrap">Phone: ${htmlSafe(product.contactInfo)}</div>` : ''}</div>` : '-';
            const masterData = getProductMasterData(product);
            const technicalSpecs = getProductTechnicalSpecs(product);
            const sourcing = getProductSourcing(product);
            const channelPartner = getProductChannelPartner(product);
            const certStatus = productMasterCertificationStatus(product);
            const compatibility = getProductCompatibilitySummary(product);
            const quoteReadiness = productMasterQuoteReadiness(product);
            const sourceRisk = productMasterSourceRisk(product);
            return { costCny, priceCny, pricingMeta, margin, supplier, supplierName, certReq, certTitle, certBrief, contactHtml, masterData, technicalSpecs, sourcing, channelPartner, certStatus, compatibility, quoteReadiness, sourceRisk };
        }
        const PRODUCT_MASTER_COLUMNS = {
            id: { key: 'id', label: 'Product ID', render: p => htmlSafe(p.id || '-') },
            image: { key: 'image', label: 'Image', render: p => productMasterImageHtml(p) },
            name: { key: 'name', label: 'Product Name', render: p => `<span class="font-bold text-slate-700 text-sm max-w-[220px] block truncate" title="${htmlSafe(productListDisplayText(p.name))}">${htmlSafe(productListDisplayText(p.name))}</span>` },
            model: { key: 'model', label: 'Model', render: (p, ctx) => `<span class="text-xs font-mono text-slate-600">${productMasterValueHtml(ctx.masterData.model)}</span>` },
            brand: { key: 'brand', label: 'Brand', render: (p, ctx) => `<span class="text-xs text-slate-600">${productMasterValueHtml(ctx.masterData.brand || ctx.supplierName)}</span>` },
            series: { key: 'series', label: 'Series', render: (p, ctx) => `<span class="text-xs text-slate-600">${productMasterValueHtml(ctx.masterData.series)}</span>` },
            spec: { key: 'spec', label: 'Specification', render: (p, ctx) => `<div class="text-xs text-slate-600">${htmlSafe(getProductDisplaySpec(p) || '-')}</div><div class="text-[10px] text-slate-400 font-bold">${htmlSafe(ctx.pricingMeta.label)}</div>` },
            category: { key: 'category', label: 'Category ↕', render: p => `<span class="text-xs text-slate-500 uppercase tracking-tighter">${htmlSafe(productListDisplayText(p.category))}</span>` },
            subcategory: { key: 'subcategory', label: 'Subcategory', render: p => `<span class="text-xs text-slate-600">${htmlSafe(productListDisplayText(p.scenario))}</span>` },
            application: { key: 'application', label: 'Application', render: (p, ctx) => `<span class="text-xs text-slate-600">${htmlSafe(productListDisplayText(ctx.masterData.application || p.application || p.scenario || '-'))}</span>` },
            voltage: { key: 'voltage', label: 'Voltage', render: (p, ctx) => `<span class="text-xs text-slate-600">${productMasterValueHtml(ctx.masterData.voltageClass)}</span>` },
            phase: { key: 'phase', label: 'Phase', render: (p, ctx) => `<span class="text-xs text-slate-600">${productMasterValueHtml(ctx.masterData.phase)}</span>` },
            status: { key: 'status', label: 'Status', render: (p, ctx) => `<span class="text-[10px] font-black px-2 py-1 rounded ${ctx.masterData.status === 'Active' ? 'bg-green-50 text-green-600' : 'bg-slate-50 text-slate-500'}">${productMasterValueHtml(ctx.masterData.status)}</span>` },
            country: { key: 'country', label: 'Country', render: (p, ctx) => `<span class="text-xs text-slate-600">${productMasterValueHtml(ctx.masterData.countryAvailable)}</span>` },
            datasheet: { key: 'datasheet', label: 'Datasheet', render: (p, ctx) => productMasterLinkHtml(ctx.masterData.datasheetLink) },
            quoteReadiness: { key: 'quoteReadiness', label: 'Quote Readiness', render: (p, ctx) => `${productMasterStatusPill(ctx.quoteReadiness.status, ctx.quoteReadiness.tone)}<div class="text-[10px] text-slate-400 mt-1">${htmlSafe(ctx.quoteReadiness.note)}</div>` },
            supplyRoute: { key: 'supplyRoute', label: 'Supply Route', render: (p, ctx) => productMasterSupplyRouteHtml(ctx) },
            certificationReadiness: { key: 'certificationReadiness', label: 'Certification Status', render: (p, ctx) => `${productMasterStatusPill(ctx.certStatus.status, ctx.certStatus.status === 'Ready' ? 'green' : (ctx.certStatus.status === 'Gap' ? 'amber' : 'slate'))}<div class="text-[10px] text-slate-400 mt-1">${htmlSafe(ctx.certStatus.label)}</div>` },
            technicalSummary: { key: 'technicalSummary', label: 'Technical Summary', render: p => `<span class="text-xs text-slate-600 max-w-[260px] block truncate" title="${htmlSafe(productMasterTechnicalSummary(p))}">${productMasterValueHtml(productMasterTechnicalSummary(p))}</span>` },
            dimensions: { key: 'dimensions', label: 'Dimensions', render: (p, ctx) => `<span class="text-xs text-slate-600">${productMasterValueHtml(ctx.technicalSpecs.dimensionsMm)}</span>` },
            weight: { key: 'weight', label: 'Weight', render: (p, ctx) => `<span class="text-xs text-slate-600">${productMasterValueHtml(ctx.technicalSpecs.weightKg ? `${ctx.technicalSpecs.weightKg} kg` : '')}</span>` },
            efficiencyCapacity: { key: 'efficiencyCapacity', label: 'Efficiency / Capacity', render: p => `<span class="text-xs text-slate-600 max-w-[220px] block truncate" title="${htmlSafe(productMasterEfficiencyCapacity(p))}">${productMasterValueHtml(productMasterEfficiencyCapacity(p))}</span>` },
            warranty: { key: 'warranty', label: 'Warranty (Y/C)', align: 'text-center', render: p => `<span class="text-xs text-slate-500">${productMasterWarrantyHtml(p)}</span>` },
            leadTime: { key: 'leadTime', label: 'Lead Time', render: p => `<span class="text-xs text-slate-600">${htmlSafe(productListDisplayText(p.leadTime))}</span>` },
            supplier: { key: 'supplier', label: 'Supplier ↕', render: (p, ctx) => `<span class="text-xs text-slate-500">${htmlSafe(ctx.supplierName)}</span>` },
            contact: { key: 'contact', label: 'Contact', sensitiveField: 'supplierContact', render: (p, ctx) => `<span class="text-xs">${ctx.contactHtml}</span>` },
            certification: { key: 'certification', label: 'Certification', render: (p, ctx) => `<span class="text-xs text-slate-500 max-w-[220px] block truncate">${productMasterCertificationHtml(ctx)}</span>` },
            certificationRequirements: { key: 'certificationRequirements', label: 'Certification Requirements', render: (p, ctx) => `<span class="text-xs text-slate-500 max-w-[240px] block truncate" title="${htmlSafe(ctx.certTitle)}">${productMasterCertificationHtml(ctx)}</span>` },
            externalCertificateLink: { key: 'externalCertificateLink', label: 'External Certificate Link', render: (p, ctx) => productMasterLinkHtml(ctx.masterData.certificateLink, 'Certificate') },
            attachedCerts: { key: 'attachedCerts', label: 'Attached Certs', render: p => `<span class="text-xs font-bold text-slate-600">${productMasterAttachedCertFiles(p).length}</span><div class="text-[10px] text-slate-400">cert files</div>` },
            attachedSpecs: { key: 'attachedSpecs', label: 'Attached Specs', render: p => `<span class="text-xs font-bold text-slate-600">${productMasterAttachedSpecFiles(p).length}</span><div class="text-[10px] text-slate-400">spec sheets</div>` },
            cost: { key: 'cost', label: 'Base Cost', align: 'text-right', sensitiveField: 'cost', render: (p, ctx) => `<div class="text-sm font-mono text-slate-400">${formatProductBaseAmount(p, 'cost')}</div><div class="text-[10px] font-bold text-slate-300">/${htmlSafe(ctx.pricingMeta.priceBasisUnit)}</div>` },
            price: { key: 'price', label: 'Base Price', align: 'text-right', render: (p, ctx) => `<div class="text-sm font-bold text-purple-700">${formatProductBaseAmount(p, 'price')}</div><div class="text-[10px] font-bold text-purple-300">/${htmlSafe(ctx.pricingMeta.priceBasisUnit)}</div>` },
            margin: { key: 'margin', label: 'Margin', align: 'text-right', sensitiveField: 'margin', render: (p, ctx) => `<span class="text-[10px] font-black px-2 py-1 rounded ${parseFloat(ctx.margin) > 30 ? 'bg-green-50 text-green-600' : 'bg-slate-50 text-slate-400'}">${ctx.margin}%</span>` },
            quotePrice: { key: 'quotePrice', label: 'Quote Price', align: 'text-right', render: p => productMasterQuotePriceHtml(p) },
            priceBasis: { key: 'priceBasis', label: 'Price Basis', render: (p, ctx) => `<span class="text-xs font-bold text-slate-600">/${htmlSafe(ctx.pricingMeta.priceBasisUnit)}</span><div class="text-[10px] text-slate-400">${htmlSafe(ctx.pricingMeta.label)}</div>` },
            technicalFit: { key: 'technicalFit', label: 'Technical Fit', render: p => productMasterTechnicalFitHtml(p) },
            compatibility: { key: 'compatibility', label: 'Compatibility', render: (p, ctx) => `<button onclick="openProductCompatibilityDetails('${htmlSafe(p.id || '')}')" class="text-xs font-bold text-purple-700 hover:underline">${htmlSafe(ctx.compatibility.label)}</button>` },
            compatibilityStatus: { key: 'compatibilityStatus', label: 'Compatibility Status', render: (p, ctx) => `<button onclick="openProductCompatibilityDetails('${htmlSafe(p.id || '')}')" title="${htmlSafe(ctx.compatibility.title)}" class="text-xs font-bold text-purple-700 hover:underline">${htmlSafe(ctx.compatibility.label)}</button>` },
            marketAlignment: { key: 'marketAlignment', label: 'Market / Price List', align: 'text-right', render: p => productMasterMarketAlignmentHtml(p) },
            sourceType: { key: 'sourceType', label: 'Source Type', render: (p, ctx) => `<span class="text-xs font-bold text-slate-600">${htmlSafe(ctx.sourcing.sourceType || 'Unknown')}</span>` },
            commercialSupplier: { key: 'commercialSupplier', label: 'Commercial Supplier', render: (p, ctx) => `<span class="text-xs text-slate-600">${htmlSafe(productMasterCommercialSupplierName(p, ctx))}</span>` },
            factoryBrandOwner: { key: 'factoryBrandOwner', label: 'Factory / Brand Owner', render: (p, ctx) => `<div class="text-xs text-slate-600">${htmlSafe(supplierNameByCode(ctx.sourcing.factorySupplierCode || p.supplierCode))}</div><div class="text-[10px] text-slate-400">${htmlSafe(supplierNameByCode(ctx.sourcing.brandOwnerSupplierCode || p.supplierCode))}</div>` },
            authorizationStatus: { key: 'authorizationStatus', label: 'Authorization Status', render: (p, ctx) => `${productMasterStatusPill(ctx.sourcing.authorizationStatus || 'Unknown', ctx.sourcing.authorizationStatus === 'Authorized' ? 'green' : (ctx.sourcing.authorizationStatus === 'Expired' ? 'red' : 'slate'))}<div class="text-[10px] text-slate-400 mt-1">${htmlSafe(ctx.sourcing.authorizationExpiry || '-')}</div>` },
            sourceRisk: { key: 'sourceRisk', label: 'Source Risk', render: (p, ctx) => `${productMasterStatusPill(ctx.sourceRisk.status, ctx.sourceRisk.tone)}<div class="text-[10px] text-slate-400 mt-1">${htmlSafe(ctx.sourceRisk.note)}</div>` },
            certificationGap: { key: 'certificationGap', label: 'Certification Gap', render: (p, ctx) => `<span class="text-xs text-slate-600">${htmlSafe(ctx.certStatus.gap || 'No gap')}</span><div class="text-[10px] text-slate-400">${htmlSafe(ctx.certStatus.label)}</div>` },
            moq: { key: 'moq', label: 'MOQ', align: 'text-right', render: p => `<span class="text-xs text-slate-500">${htmlSafe(p.moq || p.MOQ || '-')}</span>` },
            remark: { key: 'remark', label: 'Remark', render: (p, ctx) => `<span class="text-xs text-slate-500 max-w-[240px] block truncate" title="${htmlSafe(ctx.masterData.remark || '')}">${productMasterValueHtml(ctx.masterData.remark)}</span>` },
            actions: { key: 'actions', label: 'Actions', align: 'text-center', render: p => productMasterActionsHtml(p) }
        };
        window.renderDb = () => {
            const list = document.getElementById('db-list');
            const head = document.getElementById('product-master-head-row');
            ensureSupplierData();
            const typeView = getProductMasterTypeView();
            const typeGroup = PRODUCT_TYPE_GROUPS.find(group => group.id === typeView) || PRODUCT_TYPE_GROUPS[0];
            const filteredProducts = typeGroup.id === 'all'
                ? [...products]
                : products.filter(p => getProductTypeGroup(p).id === typeGroup.id);
            const searchQuery = getProductMasterSearchQuery();
            const searchFilteredProducts = filteredProducts.filter(p => productMatchesProductMasterSearch(p, searchQuery));
            const columns = getProductMasterVisibleColumns();
            if (head) head.innerHTML = columns.map(productMasterHeaderHtml).join('');
            renderProductMasterControls(products.length, filteredProducts.length, searchFilteredProducts.length);
            if(!list) return;
            if(products.length === 0) {
                list.innerHTML = `<tr><td colspan="${columns.length || 1}" class="py-20 text-center text-slate-400 text-sm">No product records yet.</td></tr>`;
                window.applyFrozenColumns('product-list');
                return;
            }
            if(filteredProducts.length === 0) {
                list.innerHTML = `<tr><td colspan="${columns.length || 1}" class="py-20 text-center text-slate-400 text-sm">No products match this Product Master type view.</td></tr>`;
                window.applyFrozenColumns('product-list');
                return;
            }
            if(searchFilteredProducts.length === 0) {
                list.innerHTML = `<tr><td colspan="${columns.length || 1}" class="py-20 text-center text-slate-400 text-sm">No products match this Product Master search.</td></tr>`;
                window.applyFrozenColumns('product-list');
                return;
            }
            const sortValue = p => dbGroupMode === 'vendor' ? getProductSupplierDisplay(p) : (p?.[dbGroupMode] || '');
            const sorted = [...searchFilteredProducts].sort((a,b) => String(sortValue(a)).localeCompare(String(sortValue(b))));
            list.innerHTML = sorted.map(p => {
                const ctx = productMasterContext(p);
                return `
                    <tr class="hover:bg-slate-50 transition-colors group">
                        ${columns.map(column => `<td class="${productMasterCellClass(column)}">${column.render(p, ctx)}</td>`).join('')}
                    </tr>`;
            }).join('');
            window.applyFrozenColumns('product-list');
            try { renderCompatibilityMatrix(); } catch (e) {}
        };
        document.addEventListener('minova-auth-changed', () => {
            try { renderDb(); } catch (e) {}
        });

        function compatibilityRuleMatchesFilters(rule) {
            const q = String(document.getElementById('compatibility-search')?.value || '').trim().toLowerCase();
            const relation = document.getElementById('compatibility-relation-filter')?.value || 'all';
            const status = document.getElementById('compatibility-status-filter')?.value || 'all';
            if (relation !== 'all' && rule.relationType !== relation) return false;
            if (status !== 'all' && rule.status !== status) return false;
            if (!q) return true;
            const haystack = [
                rule.id,
                rule.relationType,
                rule.sourceProductId,
                rule.targetProductId,
                getCompatibilityProductLabel(rule.sourceProductId),
                getCompatibilityProductLabel(rule.targetProductId),
                rule.systemScope,
                rule.status,
                rule.protocol,
                rule.constraints,
                rule.approvedBy,
                rule.updatedAt,
                rule.remark
            ].map(v => String(v || '').toLowerCase()).join(' ');
            return q.split(/\s+/).filter(Boolean).every(term => haystack.includes(term));
        }
        function compatibilityStatusPill(status) {
            const tone = status === 'Approved' ? 'green' : (status === 'Blocked' ? 'red' : (status === 'Conditional' || status === 'Pending' ? 'amber' : 'slate'));
            return productMasterStatusPill(status || 'Unknown', tone);
        }
        function renderCompatibilityMatrix() {
            const list = document.getElementById('compatibility-list');
            const summary = document.getElementById('compatibility-summary');
            if (!list) return;
            compatibilityRules = normalizeCompatibilityRules(compatibilityRules);
            const visible = compatibilityRules.filter(compatibilityRuleMatchesFilters);
            if (summary) summary.textContent = `${visible.length} visible / ${compatibilityRules.length} rules`;
            if (!visible.length) {
                list.innerHTML = `<tr><td colspan="10" class="py-12 text-center text-slate-400 text-sm">No compatibility rules match the current filters.</td></tr>`;
                return;
            }
            list.innerHTML = visible.map(rule => `
                <tr class="hover:bg-slate-50 transition-colors">
                    <td class="py-4 px-4 text-xs font-bold text-slate-700">${htmlSafe(rule.relationType)}</td>
                    <td class="py-4 px-4 text-xs text-slate-600">${htmlSafe(getCompatibilityProductLabel(rule.sourceProductId))}</td>
                    <td class="py-4 px-4 text-xs text-slate-600">${htmlSafe(getCompatibilityProductLabel(rule.targetProductId))}</td>
                    <td class="py-4 px-4 text-xs text-slate-500">${htmlSafe(rule.systemScope || '-')}</td>
                    <td class="py-4 px-4">${compatibilityStatusPill(rule.status)}</td>
                    <td class="py-4 px-4 text-xs text-slate-500">${htmlSafe(rule.protocol || '-')}</td>
                    <td class="py-4 px-4 text-xs text-slate-500 max-w-[280px] truncate" title="${htmlSafe(rule.constraints || '')}">${htmlSafe(rule.constraints || '-')}</td>
                    <td class="py-4 px-4 text-xs text-slate-500">${htmlSafe(rule.approvedBy || '-')}</td>
                    <td class="py-4 px-4 text-xs text-slate-500">${htmlSafe(rule.updatedAt || '-')}</td>
                    <td class="py-4 px-4 text-center">
                        <button onclick="openCompatibilityModal('${htmlSafe(rule.id)}')" class="text-purple-700 hover:bg-purple-50 p-1 rounded">✎</button>
                        <button onclick="deleteCompatibilityRule('${htmlSafe(rule.id)}')" class="text-red-300 hover:text-red-500 p-1 rounded">🗑</button>
                    </td>
                </tr>
            `).join('');
        }
        window.renderCompatibilityMatrix = renderCompatibilityMatrix;
        window.openCompatibilityModal = (ruleId = '') => {
            const rule = compatibilityRules.find(r => r.id === ruleId) || null;
            const setVal = (id, value) => { const el = document.getElementById(id); if (el) el.value = value || ''; };
            const sourceSelect = document.getElementById('compat-source-product');
            const targetSelect = document.getElementById('compat-target-product');
            if (sourceSelect) sourceSelect.innerHTML = productSelectOptions(rule?.sourceProductId || '');
            if (targetSelect) targetSelect.innerHTML = productSelectOptions(rule?.targetProductId || '');
            setVal('compat-rule-id', rule?.id || '');
            setVal('compat-relation-type', rule?.relationType || 'PV ↔ Inverter');
            setVal('compat-source-product', rule?.sourceProductId || '');
            setVal('compat-target-product', rule?.targetProductId || '');
            setVal('compat-system-scope', rule?.systemScope || '');
            setVal('compat-status', rule?.status || 'Approved');
            setVal('compat-protocol', rule?.protocol || '');
            setVal('compat-constraints', rule?.constraints || '');
            setVal('compat-approved-by', rule?.approvedBy || '');
            setVal('compat-updated-at', rule?.updatedAt || new Date().toISOString().slice(0, 10));
            setVal('compat-remark', rule?.remark || '');
            document.getElementById('compatibility-modal')?.classList.remove('hidden');
        };
        window.closeCompatibilityModal = () => {
            document.getElementById('compatibility-modal')?.classList.add('hidden');
        };
        function readCompatibilityRuleFromModal() {
            return normalizeCompatibilityRule({
                id: document.getElementById('compat-rule-id')?.value || '',
                relationType: document.getElementById('compat-relation-type')?.value || '',
                sourceProductId: document.getElementById('compat-source-product')?.value || '',
                targetProductId: document.getElementById('compat-target-product')?.value || '',
                systemScope: document.getElementById('compat-system-scope')?.value || '',
                status: document.getElementById('compat-status')?.value || '',
                protocol: document.getElementById('compat-protocol')?.value || '',
                constraints: document.getElementById('compat-constraints')?.value || '',
                approvedBy: document.getElementById('compat-approved-by')?.value || '',
                updatedAt: document.getElementById('compat-updated-at')?.value || '',
                remark: document.getElementById('compat-remark')?.value || ''
            });
        }
        function saveCompatibilityRule() {
            const rule = readCompatibilityRuleFromModal();
            if (!rule.sourceProductId || !rule.targetProductId) return alert('Please select both source and target products.');
            const idx = compatibilityRules.findIndex(r => r.id === rule.id);
            if (idx >= 0) compatibilityRules[idx] = rule;
            else compatibilityRules.push(rule);
            saveToLocal();
            persistEntityToD1('compatibility_rule', rule.id, rule);
            closeCompatibilityModal();
            renderCompatibilityMatrix();
            renderDb();
        }
        window.saveCompatibilityRule = saveCompatibilityRule;
        window.deleteCompatibilityRule = (ruleId) => {
            const id = String(ruleId || '').trim();
            if (!id || !confirm('Delete this compatibility rule?')) return;
            compatibilityRules = compatibilityRules.filter(rule => rule.id !== id);
            saveToLocal();
            deleteEntityFromD1('compatibility_rule', id);
            renderCompatibilityMatrix();
            renderDb();
        };

        function getNonStockProductsForPricing() {
            return products
                .filter(p => String(p?.id || '').trim() && getTotalStockQty(p.id) <= 0)
                .sort((a, b) => String(a.category || '').localeCompare(String(b.category || '')) || String(a.id || '').localeCompare(String(b.id || '')));
        }
        window.renderNonStockPricingStrategies = () => {
            const list = document.getElementById('non-stock-pricing-list');
            const summary = document.getElementById('non-stock-pricing-summary');
            const currencyBtn = document.getElementById('non-stock-currency-toggle');
            const purchaseHead = document.getElementById('non-stock-purchase-price-head');
            if (currencyBtn) currencyBtn.textContent = getNonStockDisplayCurrency() === 'MYR' ? 'RM / ¥' : '¥ / RM';
            if (purchaseHead) purchaseHead.textContent = `Purchase Price (${getNonStockDisplayCurrency() === 'MYR' ? 'RM' : '¥'})`;
            updateNonStockProfitTargetButtons();
            if (!list) return;
            const rows = getNonStockProductsForPricing();
            const targetLabel = getNonStockProfitTarget() === 'biz' ? 'C&I' : 'RESI';
            if (summary) summary.textContent = `${rows.length} products | ${targetLabel} | ${getNonStockDisplayCurrency()} | 1 MYR = ${getInventoryFxRateCnyPerMyr().toFixed(4)} CNY`;
            if (!rows.length) {
                list.innerHTML = `<tr><td colspan="23" class="py-12 text-center text-slate-400 text-sm">No non-stock products need fallback pricing.</td></tr>`;
                window.__nonStockRenderedCurrency = getNonStockDisplayCurrency();
                window.__nonStockRenderedRateCnyPerMyr = getInventoryFxRateCnyPerMyr();
                window.applyFrozenColumns('non-stock-pricing');
                return;
            }
            const draftStrategies = window.__nonStockPricingDrafts && typeof window.__nonStockPricingDrafts === 'object' ? window.__nonStockPricingDrafts : {};
            list.innerHTML = rows.map(p => {
                const sid = domSafeId(p.id);
                const strategy = draftStrategies[p.id] ? normalizeNonStockPricingStrategy(draftStrategies[p.id]) : getNonStockPricingStrategy(p.id);
                const encodedId = encodeURIComponent(p.id);
                const def = getDefaultTaxInputsForProduct(p);
                const pricing = priceListProductPricing(p);
                const sourceType = getProductSourceTypeLabel(p);
                const unit = normalizeUnitLabel(pricing.costUnit || getMarketCategoryUnitMeta(p.category || '').unit || 'pcs');
                const purchaseCnyValue = Number.isFinite(parseFloat(strategy.purchasePrice)) ? parseFloat(strategy.purchasePrice) : (Number.isFinite(parseFloat(strategy.avgCostOverride)) ? parseFloat(strategy.avgCostOverride) : NaN);
                const purchaseValue = Number.isFinite(purchaseCnyValue) ? nonStockDisplayFromCny(purchaseCnyValue).toFixed(getNonStockDisplayCurrency() === 'MYR' ? 4 : 4) : '';
                const purchasePlaceholder = nonStockDisplayFromCny(getProductCostCny(p) || 0).toFixed(4);
                const shippingValue = Number.isFinite(parseFloat(strategy.shippingRatePct)) ? parseFloat(strategy.shippingRatePct) : def.shippingRatePct;
                const domesticValue = Number.isFinite(parseFloat(strategy.domesticTaxRatePct)) ? parseFloat(strategy.domesticTaxRatePct) : def.domesticTaxRatePct;
                const dutyValue = Number.isFinite(parseFloat(strategy.dutyPct)) ? parseFloat(strategy.dutyPct) : def.dutyPct;
                const sstValue = Number.isFinite(parseFloat(strategy.sstPct)) ? parseFloat(strategy.sstPct) : def.sstPct;
                const grayValue = Number.isFinite(parseFloat(strategy.grayPct)) ? parseFloat(strategy.grayPct) : def.grayPct;
                const selectedClearancePcs = (getNonStockProfitTarget() === 'biz' ? pricing.clearanceBizPrice : pricing.clearanceHomePrice) * (pricing.pcsMultiplier || 1);
                const selectedGrayPcs = (getNonStockProfitTarget() === 'biz' ? pricing.grayBizPrice : pricing.grayHomePrice) * (pricing.pcsMultiplier || 1);
                const pcsPurchasePrice = (pricing.basePurchaseCost || 0) * (pricing.pcsMultiplier || 1);
                const expectedPcsCost = (pricing.avgCost || 0) * (pricing.pcsMultiplier || 1);
                const clearanceTariffFee = expectedPcsCost * ((pricing.dutyPct || 0) + (pricing.sstPct || 0)) / 100;
                const greyTariffFee = expectedPcsCost * ((pricing.grayPct || 0) / 100);
                return `
                    <tr class="hover:bg-slate-50 transition-colors">
                        <td class="py-4 px-4 text-xs font-mono text-slate-500">${htmlSafe(p.id)}</td>
                        <td class="py-4 px-4 font-bold text-slate-700 text-sm max-w-[220px] truncate" title="${htmlSafe(productListDisplayText(p.name || ''))}">${htmlSafe(productListDisplayText(p.name || '-'))}</td>
                        <td class="py-4 px-4 text-xs text-slate-500 uppercase tracking-tighter">${htmlSafe(normalizeProductCategory(p.category || '-'))}</td>
                        <td class="py-4 px-4 text-xs font-bold text-slate-500">${htmlSafe(sourceType)}</td>
                        <td class="py-4 px-4 text-xs font-bold text-slate-500">${htmlSafe(unit)}</td>
                        <td class="py-4 px-4 text-right text-xs font-mono text-slate-500">${formatNonStockAmount(getProductCostCny(p), 4, unit)}</td>
                        <td class="py-3 px-3 text-right">
                            <input id="non-stock-purchase-${sid}" type="number" step="0.0001" min="0" value="${purchaseValue}" placeholder="${purchasePlaceholder}" class="w-28 px-3 py-2 rounded-lg border border-slate-200 text-right text-xs font-mono focus:outline-none focus:ring-2 focus:ring-purple-100">
                        </td>
                        <td class="py-4 px-4 text-right text-xs font-mono text-slate-400">${formatNonStockPriceUpdatedAt(strategy.updatedAt)}</td>
                        <td class="py-4 px-4 text-right text-xs font-bold text-slate-500">${htmlSafe(pricing.pricingMeta?.label || `${formatNumberAuto(pricing.pcsMultiplier, 4)} ${unit}/pcs`)}</td>
                        <td class="py-4 px-4 text-right text-xs font-mono text-slate-600">${formatNonStockAmount(pcsPurchasePrice, 2, 'pcs')}</td>
                        <td class="py-3 px-3 text-right">
                            <input id="non-stock-shipping-${sid}" type="number" step="0.01" min="0" value="${shippingValue}" class="w-20 px-3 py-2 rounded-lg border border-slate-200 text-right text-xs font-mono focus:outline-none focus:ring-2 focus:ring-purple-100">
                        </td>
                        <td class="py-3 px-3 text-right">
                            <input id="non-stock-domestic-${sid}" type="number" step="0.01" min="0" value="${domesticValue}" class="w-20 px-3 py-2 rounded-lg border border-slate-200 text-right text-xs font-mono focus:outline-none focus:ring-2 focus:ring-purple-100">
                        </td>
                        <td class="py-4 px-4 text-right text-xs font-black text-slate-700">${formatNonStockAmount(pricing.avgCost || 0, 4, unit)}</td>
                        <td class="py-4 px-4 text-right text-xs font-black text-slate-700">${formatNonStockAmount(expectedPcsCost, 2, 'pcs')}</td>
                        <td class="py-3 px-3 text-right">
                            <input id="non-stock-duty-${sid}" type="number" step="0.01" min="0" value="${dutyValue}" class="w-20 px-3 py-2 rounded-lg border border-slate-200 text-right text-xs font-mono focus:outline-none focus:ring-2 focus:ring-purple-100">
                        </td>
                        <td class="py-3 px-3 text-right">
                            <input id="non-stock-sst-${sid}" type="number" step="0.01" min="0" value="${sstValue}" class="w-20 px-3 py-2 rounded-lg border border-slate-200 text-right text-xs font-mono focus:outline-none focus:ring-2 focus:ring-purple-100">
                        </td>
                        <td class="py-3 px-3 text-right">
                            <input id="non-stock-gray-${sid}" type="number" step="0.01" min="0" value="${grayValue}" class="w-20 px-3 py-2 rounded-lg border border-slate-200 text-right text-xs font-mono focus:outline-none focus:ring-2 focus:ring-purple-100">
                        </td>
                        <td class="py-4 px-4 text-right text-xs">
                            <div class="font-black text-slate-800">${formatNonStockAmount(clearanceTariffFee, 2, 'pcs')}</div>
                            <div class="text-[10px] text-slate-400">Duty + SST</div>
                            <div class="mt-1 font-bold text-slate-600">${formatNonStockAmount(greyTariffFee, 2, 'pcs')}</div>
                            <div class="text-[10px] text-slate-400">Grey</div>
                        </td>
                        <td class="py-4 px-4 text-right text-xs">${renderNonStockProfitSplitCell(pricing, 'cn')}</td>
                        <td class="py-4 px-4 text-right text-xs">${renderNonStockProfitSplitCell(pricing, 'my')}</td>
                        <td class="py-4 px-4 text-right text-xs font-black text-purple-700">${formatNonStockAmount(selectedClearancePcs || 0, 2, 'pcs')}</td>
                        <td class="py-4 px-4 text-right text-xs font-black text-slate-700">${formatNonStockAmount(selectedGrayPcs || 0, 2, 'pcs')}</td>
                        <td class="py-3 px-4 text-center">
                            <div class="flex items-center justify-center gap-2">
                                <button onclick="saveNonStockPricingStrategy(decodeURIComponent('${htmlSafe(encodedId)}'))" class="px-3 py-2 rounded-lg bg-purple-700 text-white text-xs font-black hover:bg-purple-800">Save</button>
                                <button onclick="resetNonStockPricingStrategy(decodeURIComponent('${htmlSafe(encodedId)}'))" class="px-3 py-2 rounded-lg bg-slate-100 text-slate-600 text-xs font-black hover:bg-slate-200">Reset</button>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');
            window.__nonStockRenderedCurrency = getNonStockDisplayCurrency();
            window.__nonStockRenderedRateCnyPerMyr = getInventoryFxRateCnyPerMyr();
            window.applyFrozenColumns('non-stock-pricing');
        };
        window.saveNonStockPricingStrategy = (productId) => {
            const id = String(productId || '').trim();
            if (!id) return;
            const sid = domSafeId(id);
            const readNum = (field) => {
                const raw = document.getElementById(`non-stock-${field}-${sid}`)?.value;
                const n = parseFloat(raw);
                return Number.isFinite(n) && n >= 0 ? n : null;
            };
            const purchaseDisplay = readNum('purchase');
            const purchaseCny = purchaseDisplay === null ? null : nonStockCnyFromDisplay(purchaseDisplay);
            const next = normalizeNonStockPricingStrategy({
                purchasePrice: purchaseCny,
                avgCostOverride: purchaseCny,
                shippingRatePct: readNum('shipping'),
                domesticTaxRatePct: readNum('domestic'),
                dutyPct: readNum('duty'),
                sstPct: readNum('sst'),
                grayPct: readNum('gray'),
                updatedAt: new Date().toISOString()
            });
            nonStockPricingStrategies = normalizeNonStockPricingStrategies(nonStockPricingStrategies);
            if (Object.keys(next).length > 1) nonStockPricingStrategies[id] = next;
            else delete nonStockPricingStrategies[id];
            if (window.__nonStockPricingDrafts && typeof window.__nonStockPricingDrafts === 'object') delete window.__nonStockPricingDrafts[id];
            saveToLocal();
            persistSettingsToD1({ non_stock_pricing_strategies: nonStockPricingStrategies });
            renderNonStockPricingStrategies();
            renderPriceList();
            renderPriceListPicker();
        };
        window.resetNonStockPricingStrategy = (productId) => {
            const id = String(productId || '').trim();
            if (!id) return;
            nonStockPricingStrategies = normalizeNonStockPricingStrategies(nonStockPricingStrategies);
            delete nonStockPricingStrategies[id];
            if (window.__nonStockPricingDrafts && typeof window.__nonStockPricingDrafts === 'object') delete window.__nonStockPricingDrafts[id];
            saveToLocal();
            persistSettingsToD1({ non_stock_pricing_strategies: nonStockPricingStrategies });
            renderNonStockPricingStrategies();
            renderPriceList();
            renderPriceListPicker();
        };

        window.renderInventory = () => {
            const list = document.getElementById('inventory-list');
            const headRow = document.getElementById('inventory-head-row');
            if (headRow && !inventoryFullHeadHtml) inventoryFullHeadHtml = headRow.innerHTML;
            const btn = document.getElementById('btn-inv-summary');
            if (btn) btn.innerHTML = inventorySummaryMode ? '<span>Cancel Summary</span>' : '<span>Summary</span>';
            const currencyBtn = document.getElementById('inventory-currency-toggle');
            if (currencyBtn) currencyBtn.textContent = getInventoryDisplayCurrency() === 'MYR' ? 'RM / ¥' : '¥ / RM';
            if (inventorySummaryMode && headRow) {
                headRow.innerHTML = `
                    <th class="py-4 px-4"><div class="flex flex-col items-start gap-1"><span>Product ID</span>${renderFreezeColumnButton('inventory', 3)}</div></th>
                    <th class="py-4 px-4">Product Name</th>
                    <th class="py-4 px-4">Category</th>
                    <th class="py-4 px-4">Subcategory</th>
                    <th class="py-4 px-4">Supplier</th>
                    <th class="py-4 px-4">Qty/PCS</th>
                    <th class="py-4 px-4 text-center">Inventory Quantity (Summary)</th>
                    <th class="py-4 px-4 text-right">Average Inventory Cost</th>
                `;
            } else if (!inventorySummaryMode && headRow && inventoryFullHeadHtml) {
                headRow.innerHTML = inventoryFullHeadHtml;
            }

            if (inventorySummaryMode) {
                if (inventory.length === 0) {
                    list.innerHTML = `<tr><td colspan="8" class="py-20 text-center text-slate-400 text-sm">No inventory records yet...</td></tr>`;
                    window.applyFrozenColumns('inventory');
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
                    const pricingMeta = getProductPricingMeta(p, ref);
                    const qtyPerPcs = pricingMeta.unitQtyPerPcs || 1;
                    const avgCost = getAverageInventoryCostPerSpec(r.productId, qtyPerPcs);
                    const avgPcsCost = (parseFloat(avgCost) || 0) * qtyPerPcs;
                    return `
                        <tr class="hover:bg-slate-50 transition-colors">
                            <td class="py-4 px-4 text-xs font-mono text-slate-500">${r.productId}</td>
                            <td class="py-4 px-4 font-bold text-slate-700 text-sm">${htmlSafe(productListDisplayText(p.name || 'Unknown Product'))}</td>
                            <td class="py-4 px-4 text-xs text-slate-500 uppercase tracking-tighter">${p.category || '-'}</td>
                            <td class="py-4 px-4 text-xs text-slate-600">${p.scenario || '-'}</td>
                            <td class="py-4 px-4 text-xs text-slate-600">${htmlSafe(productListDisplayText(getProductSupplierDisplay(p)))}</td>
                            <td class="py-4 px-4 text-xs text-slate-600">${htmlSafe(pricingMeta.label)}</td>
                            <td class="py-4 px-4 text-center font-black text-green-700">${formatNumberAuto(r.quantity, 4)}</td>
                            <td class="py-4 px-4 text-right text-sm font-mono text-slate-700">
                                <div>${formatInventoryAmount(avgCost, 4, pricingMeta.priceBasisUnit)}</div>
                                <div class="text-[10px] text-slate-400">${formatInventoryAmount(avgPcsCost, 2, 'pcs')}</div>
                            </td>
                        </tr>
                    `;
                }).join('');
                window.applyFrozenColumns('inventory');
                return;
            }

            if(inventory.length === 0) {
                list.innerHTML = `<tr><td colspan="21" class="py-20 text-center text-slate-400 text-sm">No inventory records yet...</td></tr>`;
                window.applyFrozenColumns('inventory');
                return;
            }
            list.innerHTML = inventory.map(item => {
                const product = products.find(p => p.id === item.productId) || {};
                const locked = Array.isArray(item.transportIds) && item.transportIds.length > 0;
                if (locked) selectedInventoryForTransport.delete(item.id);
                const checked = !locked && selectedInventoryForTransport.has(item.id) ? 'checked' : '';
                const disabled = locked ? 'disabled' : '';
                const lockTitle = locked ? 'title="Transport order created"' : '';

                const pricingMeta = getProductPricingMeta(product, item);
                const spec = pricingMeta.unitQtyPerPcs || 1;
                const unitPrice = item.unitPurchasePrice || ((item.purchasePrice || 0) * spec);
                const purchaseDate = item.purchaseDate ? String(item.purchaseDate) : '-';
                const purchaseTotal = item.purchaseTotal || (unitPrice * (item.quantity || 0));
                const shippingRatePct = ((item.shippingRate ?? 0.08) * 100);
                const taxRatePct = ((item.domesticTaxRate ?? 0.06) * 100);
                const shippingCost = item.shippingCost ?? (purchaseTotal * (shippingRatePct / 100));
                const domesticTax = item.domesticTax ?? (purchaseTotal * (taxRatePct / 100));
                const totalCost = item.totalCost ?? (purchaseTotal + shippingCost + domesticTax);
                const avgCost = getAverageInventoryCostPerSpec(item.productId, spec);
                const avgPcsCost = (parseFloat(avgCost) || 0) * spec;

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
                        <td class="py-4 px-4 font-bold text-slate-700 text-sm">${htmlSafe(productListDisplayText(product.name || 'Unknown Product'))}</td>
                        <td class="py-4 px-4 text-xs text-slate-500 uppercase tracking-tighter">${product.category || '-'}</td>
                        <td class="py-4 px-4 text-xs text-slate-600">${product.scenario || '-'}</td>
                        <td class="py-4 px-4 text-xs text-slate-600">${htmlSafe(productListDisplayText(getProductSupplierDisplay(product)))}</td>
                        <td class="py-4 px-4 text-xs text-slate-600">${purchaseDate}</td>
                        <td class="py-4 px-4 text-center font-bold text-green-600">${item.quantity}</td>
                        <td class="py-4 px-4 text-xs text-slate-600">${item.batchNo || '-'}</td>
                        <td class="py-4 px-4 text-right text-sm font-mono text-slate-600">${formatInventoryAmount(item.purchasePrice || 0, 4, pricingMeta.priceBasisUnit)}</td>
                        <td class="py-4 px-4 text-right text-sm font-mono text-slate-600">${htmlSafe(pricingMeta.label)}</td>
                        <td class="py-4 px-4 text-right text-sm font-mono text-slate-600">${formatInventoryAmount(unitPrice, 2, 'pcs')}</td>
                        <td class="py-4 px-4 text-right text-sm font-mono text-slate-600">${formatInventoryAmount(purchaseTotal, 2)}</td>
                        <td class="py-4 px-4 text-right text-sm font-mono text-slate-600">${shippingRatePct.toFixed(1)}%</td>
                        <td class="py-4 px-4 text-right text-sm font-mono text-slate-600">${taxRatePct.toFixed(1)}%</td>
                        <td class="py-4 px-4 text-right text-sm font-mono text-slate-600">${formatInventoryAmount(shippingCost, 2)}</td>
                        <td class="py-4 px-4 text-right text-sm font-mono text-slate-600">${formatInventoryAmount(domesticTax, 2)}</td>
                        <td class="py-4 px-4 text-right text-sm font-mono text-slate-900 font-bold">${formatInventoryAmount(totalCost, 2)}</td>
                        <td class="py-4 px-4 text-right text-sm font-mono text-slate-700">
                            <div>${formatInventoryAmount(avgCost, 4, pricingMeta.priceBasisUnit)}</div>
                            <div class="text-[10px] text-slate-400">${formatInventoryAmount(avgPcsCost, 2, 'pcs')}</div>
                        </td>
                        <td class="py-4 px-4 text-xs text-slate-600">${htmlSafe(productListDisplayText(item.location || '-'))}</td>
                        <td class="py-4 px-4 text-center">
                            <div class="flex items-center justify-center gap-2">
                                <button onclick="openInventoryEditModal('${item.id}')" class="text-purple-700 hover:bg-purple-50 p-1 rounded text-xs">Pricing</button>
                                <button onclick="openInventoryModal('edit', '${item.id}')" class="text-blue-600 hover:bg-blue-50 p-1 rounded text-xs">Edit</button>
                                <button onclick="openInventoryModal('out', '${item.id}')" class="text-orange-500 hover:bg-orange-50 p-1 rounded text-xs">Stock Out</button>
                                <button onclick="deleteInventoryItem('${item.id}')" class="text-red-300 hover:text-red-500 p-1 rounded">🗑</button>
                            </div>
                        </td>
                    </tr>`;
            }).join('');
            window.applyFrozenColumns('inventory');
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
            if (v === 'sea') return 'Sea';
            if (v === 'air') return 'Air';
            if (v === 'land') return 'Land';
            if (v === 'other') return 'Other';
            return '-';
        }
        function getTransportStatusLabel(v) {
            if (v === 'draft') return 'Draft';
            if (v === 'in_transit') return 'In Transit';
            if (v === 'delivered') return 'Delivered';
            if (v === 'cancelled') return 'Cancelled';
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
                list.innerHTML = `<tr><td colspan="12" class="py-20 text-center text-slate-400 text-sm">No transport records yet...</td></tr>`;
                return;
            }

            const fmtNum = (n, d = 2) => (Number.isFinite(parseFloat(n)) ? parseFloat(n).toFixed(d) : (0).toFixed(d));
            const fmtMoney = (n) => `¥${fmtNum(n, 2)}`;

            list.innerHTML = filtered.map(r => {
                const created = r.createdAt ? String(r.createdAt).slice(0, 19).replace('T', ' ') : '-';
                const lines = Array.isArray(r.lines) ? r.lines : [];
                const totalWeight = Number.isFinite(parseFloat(r.totalWeightKg)) ? parseFloat(r.totalWeightKg) : lines.reduce((s, l) => s + (parseFloat(l.weightKg) || 0), 0);
                const totalVol = Number.isFinite(parseFloat(r.totalVolumeM3)) ? parseFloat(r.totalVolumeM3) : lines.reduce((s, l) => s + (parseFloat(l.volumeM3) || 0), 0);
                const brief = lines.slice(0, 2).map(l => `${l.productId || ''}×${l.quantity || 0}`).filter(Boolean).join(', ');
                const more = lines.length > 2 ? ` + ${lines.length} items` : (lines.length ? '' : 'None');
                const batches = [...new Set(lines.map(l => String(l.batchNo || '').trim()).filter(Boolean))];
                const batchFull = batches.join(', ');
                const batchBrief = batches.slice(0, 2).join(', ') + (batches.length > 2 ? ` + ${batches.length} batches` : (batches.length ? '' : 'None'));
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
                                <option value="draft" ${r.status === 'draft' ? 'selected' : ''}>Draft</option>
                                <option value="in_transit" ${r.status === 'in_transit' ? 'selected' : ''}>In Transit</option>
                                <option value="delivered" ${r.status === 'delivered' ? 'selected' : ''}>Delivered</option>
                                <option value="cancelled" ${r.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
                            </select>
                        </td>
                        <td class="py-4 px-4 text-right text-sm font-mono text-slate-700">${fmtMoney(r.freight)}</td>
                        <td class="py-4 px-4 text-right text-sm font-mono text-slate-700">${fmtNum(totalWeight, 2)}</td>
                        <td class="py-4 px-4 text-right text-sm font-mono text-slate-700">${fmtNum(totalVol, 3)}</td>
                        <td class="py-4 px-4 text-xs text-slate-600" title="${batchFull || ''}">${batchBrief}</td>
                        <td class="py-4 px-4 text-xs text-slate-600">${brief}${more}</td>
                        <td class="py-4 px-4 text-center">
                            <div class="flex items-center justify-center gap-3">
                                <button onclick="openTransportEditModal('${r.id}')" class="text-blue-600 hover:text-blue-800 text-xs font-bold">Edit</button>
                                <button onclick="deleteTransportRecord('${r.id}')" class="text-red-400 hover:text-red-600 text-xs font-bold">Delete</button>
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
            if (!ids.length) return alert('Please select transport records to delete first.');
            if (!confirm(`Delete the selected ${ids.length} transport records?`)) return;
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
            ids.forEach(id => deleteEntityFromD1('transport', id));
            persistInventoryStateToD1();
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
            persistEntityToD1('transport', rec.id, rec);
            renderTransport();
        };

        window.deleteTransportRecord = (id) => {
            if (!confirm('Delete this transport record?')) return;
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
            deleteEntityFromD1('transport', id);
            persistInventoryStateToD1();
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
                                <th class="py-3 px-3">Product ID</th>
                                <th class="py-3 px-3">Product Name</th>
                                <th class="py-3 px-3">Category</th>
                                <th class="py-3 px-3">Subcategory</th>
                                <th class="py-3 px-3">Supplier</th>
                                <th class="py-3 px-3 text-right">Transport Quantity</th>
                                <th class="py-3 px-3 text-right">Weight (kg)</th>
                                <th class="py-3 px-3 text-right">Volume (m³)</th>
                                <th class="py-3 px-3">Batch</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                            ${lines.map((l, i) => `
                                <tr>
                                    <td class="py-3 px-3 text-xs font-mono text-slate-600">${safe(l.productId)}</td>
                                    <td class="py-3 px-3 text-xs text-slate-700">${safe(productListDisplayText(l.productName))}</td>
                                    <td class="py-3 px-3 text-xs text-slate-600">${safe(l.category)}</td>
                                    <td class="py-3 px-3 text-xs text-slate-600">${safe(l.subcategory)}</td>
                                    <td class="py-3 px-3 text-xs text-slate-600">${safe(productListDisplayText(l.vendor))}</td>
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
                `<option value="">Select</option>`,
                ...carriers.map(c => `<option value="${safe(c)}">${safe(c)}</option>`),
                `<option value="__new__">Add...</option>`
            ].join('');
            const isEdit = !!(preset && typeof preset === 'object' && preset.id);
            const saveId = isEdit ? String(preset.id) : '';
            modal.innerHTML = `
                <div class="bg-white rounded-3xl p-6 w-full max-w-5xl shadow-2xl max-h-[90vh] overflow-y-auto">
                    <div class="flex items-center justify-between mb-4">
                        <div>
                            <h3 class="text-xl font-bold text-slate-800">${isEdit ? 'Edit Transport Order' : 'New Transport Order'}</h3>
                            <p class="text-xs text-slate-400 mt-1">Complete weight and volume before saving.</p>
                        </div>
                        <button onclick="closeTransportModal()" class="text-slate-400 hover:text-slate-600 text-2xl">×</button>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                        <div>
                            <div class="text-xs font-bold text-slate-500 mb-1">Transport Order No.</div>
                            <input id="tr-tracking-no" type="text" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none" placeholder="e.g. AWB / BL / Tracking No.">
                        </div>
                        <div>
                            <div class="text-xs font-bold text-slate-500 mb-1">Freight Company</div>
                            <select id="tr-carrier" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none" onchange="onTransportCarrierSelectChange(this.value)">
                                ${carrierOptions}
                            </select>
                            <input id="tr-carrier-new" type="text" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none mt-2" placeholder="Enter a new freight company" style="display:none">
                        </div>
                        <div>
                            <div class="text-xs font-bold text-slate-500 mb-1">Transport Method</div>
                            <select id="tr-method" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none">
                                <option value="">Select</option>
                                <option value="sea">Sea</option>
                                <option value="air">Air</option>
                                <option value="land">Land</option>
                                <option value="other">Other</option>
                            </select>
                        </div>
                        <div>
                            <div class="text-xs font-bold text-slate-500 mb-1">Freight Amount (¥)</div>
                            <input id="tr-freight" type="number" min="0" step="0.01" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none" value="0">
                        </div>
                    </div>
                    ${lines.length ? buildTransportLinesTable(lines) : `<div class="py-16 text-center text-slate-400 text-sm border border-dashed border-slate-200 rounded-2xl">Select inventory records and click "Create Transport Order"</div>`}
                    <div class="flex justify-end gap-3 mt-5">
                        <button onclick="closeTransportModal()" class="px-4 py-2 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50">Cancel</button>
                        <button onclick="saveTransportFromModal('${encodeURIComponent(JSON.stringify(lines))}', '${safe(saveId)}')" class="px-4 py-2 rounded-xl bg-purple-700 text-white font-bold hover:bg-purple-800">Save</button>
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
                const hay = [it.productId, p.name, getProductSupplierDisplay(p), it.batchNo, it.location].filter(Boolean).map(x => String(x).toLowerCase()).join(' | ');
                return hay.includes(q);
            });
            if (!filtered.length) {
                list.innerHTML = `<div class="py-16 text-center text-slate-400 text-sm">No available inventory records yet...</div>`;
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
                                <div class="text-sm font-bold text-slate-800 truncate">${htmlSafe(productListDisplayText(p.name || 'Unknown Product'))}</div>
                                <div class="text-[10px] text-slate-500 truncate">${it.productId || ''} | ${htmlSafe(productListDisplayText(getProductSupplierDisplay(p)))} | Batch ${it.batchNo || '-'} | Inventory ${formatNumberAuto(it.quantity, 4)}</div>
                            </div>
                        </div>
                        <div class="text-[10px] text-slate-400 text-right whitespace-nowrap">${htmlSafe(productListDisplayText(it.location || '-'))}</div>
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
                            <h3 class="text-xl font-bold text-slate-800">Create Transport Order from Inventory</h3>
                            <p class="text-xs text-slate-400 mt-1">Only inventory records without transport orders are shown（${eligibleCount} records）</p>
                        </div>
                        <button onclick="closeTransportInventoryPickerModal()" class="text-slate-400 hover:text-slate-600 text-2xl">×</button>
                    </div>
                    <div class="mb-3">
                        <input id="tr-inv-picker-search" type="text" placeholder="Search: product ID/name/supplier/batch/warehouse" oninput="renderTransportInventoryPickerList()" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none">
                    </div>
                    <div id="tr-inv-picker-list" class="border border-slate-200 rounded-2xl overflow-hidden"></div>
                    <div class="flex justify-end gap-3 mt-5">
                        <button onclick="closeTransportInventoryPickerModal()" class="px-4 py-2 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50">Cancel</button>
                        <button onclick="confirmTransportCreateFromInventoryPicker()" class="px-4 py-2 rounded-xl bg-purple-700 text-white font-bold hover:bg-purple-800">Next</button>
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
            if (!selected.length) return alert('Select inventory records to create a transport order.');
            const lines = selected.map(it => {
                const p = products.find(x => x.id === it.productId) || {};
                return {
                    inventoryId: it.id,
                    batchNo: it.batchNo || '',
                    productId: it.productId || '',
                    productName: p.name || '',
                    category: p.category || '',
                    subcategory: p.scenario || '',
                    vendor: getProductSupplierDisplay(p),
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
            if (!selected.length) return alert('Select inventory records in Inventory Management first.');
            const lines = selected.map(it => {
                const p = products.find(x => x.id === it.productId) || {};
                return {
                    inventoryId: it.id,
                    batchNo: it.batchNo || '',
                    productId: it.productId || '',
                    productName: p.name || '',
                    category: p.category || '',
                    subcategory: p.scenario || '',
                    vendor: getProductSupplierDisplay(p),
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
            if (!rec) return alert('Transport record not found.');
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
            if (!trackingNo) return alert('Transport Order No. is required.');
            if (!carrierCompany) return alert('Select or enter a freight company.');
            if (!method) return alert('Select a transport method.');
            if (!lines.length) return alert('Transport details are required.');

            const finalLines = [];
            let totalW = 0;
            let totalV = 0;
            for (let i = 0; i < lines.length; i++) {
                const base = lines[i] || {};
                const qty = parseFloat(document.getElementById(`tr-line-qty-${i}`)?.value || '0') || 0;
                const w = parseFloat(document.getElementById(`tr-line-w-${i}`)?.value || '') ;
                const v = parseFloat(document.getElementById(`tr-line-v-${i}`)?.value || '') ;
                if (!(qty > 0)) return alert(`Line ${i + 1}: transport quantity must be greater than 0.`);
                if (!Number.isFinite(w) || w < 0) return alert(`Line ${i + 1}: enter weight (kg).`);
                if (!Number.isFinite(v) || v < 0) return alert(`Line ${i + 1}: enter volume (m³).`);
                totalW += w;
                totalV += v;
                finalLines.push({ ...base, quantity: qty, weightKg: w, volumeM3: v });
            }

            const editId = String(editingId || '').trim();
            if (editId) {
                const idx = transportRecords.findIndex(r => r.id === editId);
                if (idx === -1) return alert('Transport record to edit was not found.');
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
            if (editId) persistEntityToD1('transport', editId, transportRecords.find(r => r.id === editId));
            else persistEntityToD1('transport', transportRecords[transportRecords.length - 1]?.id, transportRecords[transportRecords.length - 1]);
            persistInventoryStateToD1();
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
                <p class="font-bold text-base mb-2 border-b border-slate-600 pb-1">Inventory Summary: ${productId}</p>
                <div class="space-y-1">
                    <p class="flex justify-between"><span>Total Quantity:</span> <span class="font-bold text-green-400">${summary.totalQuantity}</span></p>
                    <p class="flex justify-between"><span>Average Purchase Price:</span> <span class="font-bold text-blue-400">¥${summary.avgPrice.toFixed(2)}</span></p>
                    <div class="pt-2">
                        <p class="font-bold text-slate-400 mb-1">Location Breakdown:</p>
                        ${Object.entries(summary.locations).map(([loc, qty]) =>
                            `<p class="flex justify-between text-[10px]"><span>${productListDisplayText(loc)}:</span> <span>${qty}</span></p>`
                        ).join('') || '<p class="italic text-slate-500 text-[10px]">No location information</p>'}
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

        // --- Inventory pricing logic ---
        function getDefaultImportDutyPercent(category) {
            const c = normalizeProductCategory(category);
            if (c === 'PV Module') return 0;
            if (c === 'All-in-One System') return 0;
            if (c === 'Battery') return 20;
            if (c === 'Inverter') return 20;
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
            const overrideCost = parseFloat(item?.avgCostOverride);
            const avgCost = Number.isFinite(overrideCost) ? overrideCost : getAverageInventoryCostPerSpec(item?.productId, spec);
            const dutyPct = Number.isFinite(parseFloat(item?.importDutyPct)) ? parseFloat(item.importDutyPct) : getDefaultImportDutyPercent(product?.category);
            const sstPct = Number.isFinite(parseFloat(item?.sstPct)) ? parseFloat(item.sstPct) : getDefaultSstPercent();
            const grayPct = Number.isFinite(parseFloat(item?.grayTaxPct)) ? parseFloat(item.grayTaxPct) : getDefaultGrayTaxPercent();

            const cat = String(product?.category || '').trim();
            const sub = String(product?.scenario || '').trim();
            profitSettings = normalizeProfitSettings(profitSettings || safeJsonParseLoose(localStorage.getItem('minova_profit_settings_v1'), null));
            const homeProfitBreakdown = getProfitPctBreakdown('home', cat, sub);
            const bizProfitBreakdown = getProfitPctBreakdown('biz', cat, sub);
            const findPct = (list, id) => {
                const row = list.find(item => item.id === id);
                return Number.isFinite(parseFloat(row?.pct)) ? parseFloat(row.pct) : 0;
            };
            const cnHomePct = findPct(homeProfitBreakdown, 'cn_parent');
            const myHomePct = findPct(homeProfitBreakdown, 'my_sub');
            const cnBizPct = findPct(bizProfitBreakdown, 'cn_parent');
            const myBizPct = findPct(bizProfitBreakdown, 'my_sub');
            const homeProfitPct = homeProfitBreakdown.reduce((sum, row) => sum + (Number.isFinite(parseFloat(row.pct)) ? parseFloat(row.pct) : 0), 0);
            const bizProfitPct = bizProfitBreakdown.reduce((sum, row) => sum + (Number.isFinite(parseFloat(row.pct)) ? parseFloat(row.pct) : 0), 0);
            const subsidiaryHomePct = homeProfitBreakdown
                .filter(row => row.id !== 'cn_parent')
                .reduce((sum, row) => sum + (Number.isFinite(parseFloat(row.pct)) ? parseFloat(row.pct) : 0), 0);
            const subsidiaryBizPct = bizProfitBreakdown
                .filter(row => row.id !== 'cn_parent')
                .reduce((sum, row) => sum + (Number.isFinite(parseFloat(row.pct)) ? parseFloat(row.pct) : 0), 0);

            const clearanceCost = avgCost * (1 + dutyPct / 100 + sstPct / 100);
            const grayCost = avgCost * (1 + grayPct / 100);
            const homeMul = 1 + homeProfitPct / 100;
            const bizMul = 1 + bizProfitPct / 100;

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
                homeProfitPct,
                bizProfitPct,
                subsidiaryHomePct,
                subsidiaryBizPct,
                profitBreakdown: {
                    home: homeProfitBreakdown,
                    biz: bizProfitBreakdown
                },
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
            set('edit-profit-my-home', r.subsidiaryHomePct);
            set('edit-profit-cn-biz', r.cnBizPct);
            set('edit-profit-my-biz', r.subsidiaryBizPct);
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
                productName: product.name || 'Unknown Product',
                quantity: item.quantity,
                batchNo: item.batchNo,
                note: `Pricing Tax rates - duty:${oldDuty.toFixed(2)}→${dutyPct.toFixed(2)} SST:${oldSst.toFixed(2)}→${sstPct.toFixed(2)} 灰清:${oldGray.toFixed(2)}→${grayPct.toFixed(2)} | Clearance RESI:${oldCh.toFixed(2)}→${r.clearanceHomePrice.toFixed(2)} Clearance C&I:${oldCb.toFixed(2)}→${r.clearanceBizPrice.toFixed(2)} Grey RESI:${oldGh.toFixed(2)}→${r.grayHomePrice.toFixed(2)} Grey C&I:${oldGb.toFixed(2)}→${r.grayBizPrice.toFixed(2)}`
            });

            saveToLocal();
            persistInventoryStateToD1();
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
            const c = normalizeProductCategory(category);
            if (c === 'PV Module') return 13;
            if (c === 'All-in-One System') return 0;
            if (c === 'Battery') return 6;
            if (c === 'Inverter') return 6;
            if (c === 'Accessory') return 6;
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

        function updateInventoryPricingLabels(product) {
            const productId = document.getElementById('inv-product-id')?.value || '';
            const p = product || products.find(x => x.id === productId) || {};
            const meta = getProductPricingMeta(p);
            const unit = meta.priceBasisUnit || 'unit';
            const setText = (id, text) => {
                const el = document.getElementById(id);
                if (el) el.textContent = text;
            };
            setText('inv-spec-label', `Qty per PCS (${meta.label})`);
            setText('inv-price-label', `Purchase Price (¥/${unit})`);
            setText('inv-unit-price-label', 'Unit Purchase Price (¥/pcs)');
            setText('inv-avg-cost-label', `Average Inventory Cost (¥/${unit})`);
        }

        window.onInventoryProductChange = () => {
            const productId = document.getElementById('inv-product-id')?.value || '';
            const p = products.find(x => x.id === productId);
            const vendorEl = document.getElementById('inv-vendor');
            const subEl = document.getElementById('inv-subcategory');
            if (vendorEl) vendorEl.value = p ? getProductSupplierDisplay(p) : '';
            if (subEl) subEl.value = p?.scenario || '';
            if (p) {
                const meta = getProductPricingMeta(p);
                const specEl = document.getElementById('inv-spec');
                if (specEl && (!specEl.value || parseFloat(specEl.value) === 1)) specEl.value = String(meta.unitQtyPerPcs || 1);
                const priceEl = document.getElementById('inv-price');
                if (priceEl && !priceEl.value) priceEl.value = String(getProductCostCny(p).toFixed(2));
                const taxEl = document.getElementById('inv-domestic-tax-rate');
                if (taxEl && !taxEl.value) taxEl.value = String(getDefaultDomesticTaxRatePercent(p.category));
            }
            updateInventoryPricingLabels(p);
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

        function getInstallerScenario() {
            return 'home';
        }
        function getInstallerRegionLabel(region = installerQuoteRegion) {
            return normalizeInstallerRegionKey(region) === 'sabahSarawak' ? 'Sabah / Sarawak' : 'Peninsular Malaysia';
        }
        function updateInstallerRegionButtons() {
            const activeClass = 'px-3 py-2 rounded-xl text-xs font-black border border-purple-200 bg-purple-700 text-white';
            const idleClass = 'px-3 py-2 rounded-xl text-xs font-black border border-slate-200 bg-white text-slate-700 hover:bg-slate-50';
            const region = normalizeInstallerRegionKey(installerQuoteRegion);
            const penBtn = document.getElementById('btn-installer-region-peninsular');
            const eastBtn = document.getElementById('btn-installer-region-sabahSarawak');
            if (penBtn) penBtn.className = region === 'peninsular' ? activeClass : idleClass;
            if (eastBtn) eastBtn.className = region === 'sabahSarawak' ? activeClass : idleClass;
        }
        window.setInstallerQuoteRegion = (region) => {
            installerQuoteRegion = normalizeInstallerRegionKey(region);
            updateInstallerRegionButtons();
            applyInstallerQuoteSettingsToUi();
            recalcInstallerQuote();
        };
        function getProposedSystemSizeKwp() {
            const direct = parseFloat(String(document.getElementById('input-proposed-size')?.value || '').replace(/,/g, ''));
            if (Number.isFinite(direct) && direct > 0) return direct;
            try {
                const ctx = typeof getQuoteSolarContext === 'function' ? getQuoteSolarContext() : null;
                const auto = parseFloat(ctx?.sizing?.pvSizeKwp);
                if (Number.isFinite(auto) && auto > 0) return auto;
            } catch (e) {}
            return 0;
        }
        function applyInstallerQuoteSettingsToUi() {
            installerQuoteSettings = normalizeInstallerQuoteSettings(installerQuoteSettings);
            const fees = getInstallerRegionFees(installerQuoteSettings, installerQuoteRegion);
            const set = (id, value) => {
                const el = document.getElementById(id);
                if (el) el.value = String(value);
            };
            set('installer-labor', fees.installationRmPerKwp);
            set('installer-bracket', fees.frameMountingRmPerKwp);
            set('installer-cable', fees.cableRmPerKwp);
            updateInstallerRegionButtons();
        }
        function renderInstallerCostDetail(result) {
            const scenarioEl = document.getElementById('installer-scenario-label');
            const sizeEl = document.getElementById('installer-size-label');
            const detailEl = document.getElementById('installer-cost-detail');
            if (scenarioEl) scenarioEl.textContent = `${getInstallerRegionLabel(result.region)} · ${result.scenario === 'biz' ? 'C&I' : 'RESI'}`;
            if (sizeEl) sizeEl.textContent = `${result.sizeKwp.toFixed(2)} kWp`;
            if (!detailEl) return;
            detailEl.innerHTML = result.detail.map(item => `
                <div class="rounded-xl bg-white border border-slate-100 px-3 py-2 flex items-center justify-between gap-3">
                    <div class="min-w-0">
                        <div class="font-black text-slate-700 truncate">${htmlSafe(item.label)}</div>
                        <div class="text-[10px] text-slate-400 truncate">${htmlSafe(item.formula || '')}</div>
                    </div>
                    <div class="font-mono font-black text-slate-700 text-right whitespace-nowrap">RM ${formatNumberAuto(item.amount, 2)}</div>
                </div>
            `).join('');
        }
        window.recalcInstallerQuote = () => {
            const labor = parseFloat(document.getElementById('installer-labor')?.value) || 0;
            const bracket = parseFloat(document.getElementById('installer-bracket')?.value) || 0;
            const cable = parseFloat(document.getElementById('installer-cable')?.value) || 0;
            installerQuoteSettings = normalizeInstallerQuoteSettings({
                ...(installerQuoteSettings || {}),
                regions: {
                    ...(installerQuoteSettings?.regions || {}),
                    [normalizeInstallerRegionKey(installerQuoteRegion)]: {
                        installationRmPerKwp: labor,
                        frameMountingRmPerKwp: bracket,
                        cableRmPerKwp: cable
                    }
                }
            });
            const rate = parseFloat(document.getElementById('rate-myr-cny')?.value) || 1.53;
            const cnPct = parseFloat(document.getElementById('installer-profit-cn')?.value) || 0;
            const myPct = parseFloat(document.getElementById('installer-profit-my')?.value) || 0;
            installerProfitSettings = normalizeInstallerProfitSettings({ cnPct, myPct });
            const result = computeInstallerCost(getProposedSystemSizeKwp(), getInstallerScenario(), installerQuoteSettings, installerProfitSettings, rate, installerQuoteRegion);

            const myrEl = document.getElementById('installer-total-myr');
            const cnyEl = document.getElementById('installer-total-cny');
            const feeEl = document.getElementById('installer-install-fee-cny');
            const feeMyrEl = document.getElementById('installer-install-fee-myr');
            if (myrEl) myrEl.value = result.baseMyr.toFixed(4);
            if (cnyEl) cnyEl.value = result.baseCny.toFixed(4);
            if (feeEl) feeEl.value = result.finalCny.toFixed(4);
            if (feeMyrEl) feeMyrEl.value = result.finalMyr.toFixed(4);
            renderInstallerCostDetail(result);
            try { localStorage.setItem('minova_installer_profit_v1', JSON.stringify(installerProfitSettings)); } catch (e) {}
            try { localStorage.setItem('minova_installer_quote_settings_v1', JSON.stringify(installerQuoteSettings)); } catch (e) {}
            persistQuoteSettingsToD1();
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
                if (p && normalizeProductCategory(p.category) === 'PV Module') {
                    total += qty;
                    continue;
                }
                if (desc.includes('光伏Module') || desc.includes('Module')) total += qty;
            }
            return total > 0 ? total : 1;
        }

        const DEFAULT_OVERSEAS_INSTALL_ITEMS = [
            'Skylift, Labour Installation, Testing & Commissioning',
            'Transportation',
            'Design & Planning',
            'Sturctural Assessment of Roof with Professional Engineer Endorsement',
            'ATAP & TNB Submission'
        ];
        window.__installOptionItems = DEFAULT_OVERSEAS_INSTALL_ITEMS.map((text, idx) => ({ id: Date.now() + idx, text, checked: true, locked: idx === 0 }));

        function resetInstallOptionItems() {
            window.__installOptionItems = DEFAULT_OVERSEAS_INSTALL_ITEMS.map((text, idx) => ({ id: Date.now() + idx, text, checked: true, locked: idx === 0 }));
            renderInstallOptionItems();
        }

        function renderInstallOptionItems() {
            const list = document.getElementById('install-overseas-item-list');
            if (!list) return;
            const items = Array.isArray(window.__installOptionItems) ? window.__installOptionItems : [];
            list.innerHTML = items.map((item, idx) => `
                <div class="flex items-center gap-2 rounded-xl bg-white border border-purple-100 p-2">
                    <input type="checkbox" ${item.checked ? 'checked' : ''} ${item.locked ? 'disabled' : ''} onchange="toggleInstallOptionItem(${item.id}, this.checked)" class="h-4 w-4 accent-purple-700">
                    <input type="text" value="${htmlSafe(item.text || '')}" oninput="updateInstallOptionItem(${item.id}, this.value)" class="flex-1 bg-transparent outline-none text-xs font-bold text-slate-700">
                    <span class="text-[9px] font-black ${idx === 0 ? 'text-purple-700 bg-purple-50 border-purple-100' : 'text-slate-400 bg-slate-50 border-slate-100'} border px-2 py-1 rounded-full">${idx === 0 ? 'AMOUNT' : 'INCLUDED'}</span>
                    ${idx >= DEFAULT_OVERSEAS_INSTALL_ITEMS.length ? `<button type="button" onclick="removeInstallOptionItem(${item.id})" class="text-red-400 hover:text-red-600 text-xs font-black px-1">×</button>` : ''}
                </div>
            `).join('');
        }

        window.toggleInstallOptionItem = (id, checked) => {
            const item = (window.__installOptionItems || []).find(x => x.id === id);
            if (!item || item.locked) return;
            item.checked = !!checked;
        };

        window.updateInstallOptionItem = (id, value) => {
            const item = (window.__installOptionItems || []).find(x => x.id === id);
            if (!item) return;
            item.text = String(value || '');
        };

        window.addInstallOptionItem = () => {
            window.__installOptionItems.push({ id: Date.now(), text: 'Others', checked: true, locked: false });
            renderInstallOptionItems();
        };

        window.removeInstallOptionItem = (id) => {
            window.__installOptionItems = (window.__installOptionItems || []).filter(x => x.id !== id);
            renderInstallOptionItems();
        };

        window.openInstallModal = (mode) => {
            const region = mode === 'domestic' ? 'sabahSarawak' : normalizeInstallerRegionKey(mode);
            window.installMode = region;
            const modal = document.getElementById('install-modal');
            if (!modal) return;
            modal.classList.remove('hidden');

            const titleEl = document.getElementById('install-title');
            const descEl = document.getElementById('install-desc');
            const unitEl = document.getElementById('install-unit-price');
            const qtyEl = document.getElementById('install-qty');
            const qtyUnitEl = document.getElementById('install-qty-unit');
            const itemsEl = document.getElementById('install-overseas-items');

            const regionLabel = getInstallerRegionLabel(region);
            if (titleEl) titleEl.textContent = `Installation Work · ${regionLabel}`;
            if (descEl) descEl.value = `${regionLabel} Installation Work`;
            if (qtyUnitEl) qtyUnitEl.textContent = 'kWp';
            if (itemsEl) itemsEl.classList.remove('hidden');
            resetInstallOptionItems();

            let overseasUnit = parseFloat(document.getElementById('installer-install-fee-cny')?.value) || 0;
            let overseasQty = getProposedSystemSizeKwp();
            installerQuoteSettings = normalizeInstallerQuoteSettings(installerQuoteSettings);
            const rate = parseFloat(document.getElementById('rate-myr-cny')?.value) || 1.53;
            const result = computeInstallerCost(overseasQty, getInstallerScenario(), installerQuoteSettings, installerProfitSettings, rate, region);
            overseasUnit = result.unitFinalCnyPerKwp;
            overseasQty = result.sizeKwp;
            if (unitEl) {
                unitEl.value = String(overseasUnit.toFixed(4));
                unitEl.readOnly = true;
                unitEl.classList.add('bg-slate-50');
            }
            if (qtyEl) qtyEl.value = String(overseasQty > 0 ? overseasQty.toFixed(2) : 0);
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
            const rate = parseFloat(document.getElementById('rate-myr-cny')?.value) || 1.53;
            const safeRate = rate > 0 ? rate : 1.53;
            const unitMyrEl = document.getElementById('install-unit-price-myr');
            const subMyrEl = document.getElementById('install-subtotal-myr');
            const el = document.getElementById('install-subtotal');
            if (unitMyrEl) unitMyrEl.value = (unit / safeRate).toFixed(4);
            if (subMyrEl) subMyrEl.value = (sub / safeRate).toFixed(4);
            if (el) el.value = sub.toFixed(4);
        };
        window.applyInstallToQuote = () => {
            const desc = String(document.getElementById('install-desc')?.value || '').trim() || 'Installation Work';
            const unit = parseFloat(document.getElementById('install-unit-price')?.value) || 0;
            const qty = Math.max(0, parseFloat(document.getElementById('install-qty')?.value) || 0);
            if (qty <= 0) return alert('Enter a valid quantity.');
            if (unit < 0) return alert('Unit price cannot be negative.');

            const firstBlankIdx = quoteRows.findIndex(r => r.isBlank);
            const insertIdx = firstBlankIdx === -1 ? quoteRows.length : firstBlankIdx;
            const items = (window.__installOptionItems || [])
                .filter(item => item.locked || item.checked)
                .map((item, idx) => String(item.text || '').trim() || (idx === 0 ? desc : 'Installation Item'))
                .filter(Boolean);
            if (!items.length) return alert('Select at least one installation item.');
            const rows = items.map((text, idx) => ({
                id: Date.now() + idx,
                description: idx === 0 ? desc : text,
                vendor: '--',
                spec: '--',
                batchNo: '',
                quantity: idx === 0 ? qty : 1,
                price: idx === 0 ? unit : 0,
                cost: 0,
                included: idx !== 0,
                isInstallItem: true
            }));
            quoteRows.splice(insertIdx, 0, ...rows);
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
                'Operation Time': new Date(h.ts).toLocaleString(),
                Type: h.type,
                'Product ID': h.productId,
                'Product Name': productListDisplayText(h.productName),
                Quantity: h.quantity,
                'Batch No.': h.batchNo || '',
                Notes: productListDisplayText(h.note || '')
            }));
            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Operation History');
            XLSX.writeFile(wb, 'InventoryOperation History.xlsx');
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
                list.innerHTML = `<tr><td colspan="7" class="py-10 text-center text-slate-400 text-sm">No operation records yet...</td></tr>`;
                const pageEl = document.getElementById('inventory-history-page');
                if (pageEl) pageEl.textContent = `1 / 1`;
                const sumEl = document.getElementById('inventory-history-summary');
                if (sumEl) sumEl.textContent = `0 records`;
                return;
            }
            const pageEl = document.getElementById('inventory-history-page');
            if (pageEl) pageEl.textContent = `${inventoryHistoryPage} / ${totalPages}`;
            const sumEl = document.getElementById('inventory-history-summary');
            if (sumEl) sumEl.textContent = `Total ${inventoryHistory.length} records (10 per page, keeping up to 1000 records)`;

            list.innerHTML = slice.map(h => `
                <tr class="hover:bg-slate-50 transition-colors">
                    <td class="py-3 px-4 text-xs text-slate-500">${new Date(h.ts).toLocaleString()}</td>
                    <td class="py-3 px-4 text-xs font-bold ${h.type === 'in' ? 'text-green-600' : h.type === 'out' ? 'text-orange-600' : (h.type === 'price' || h.type === 'edit') ? 'text-purple-600' : h.type === 'modify' ? 'text-blue-600' : 'text-red-600'}">${h.type === 'in' ? 'Stock In' : h.type === 'out' ? 'Stock Out' : (h.type === 'price' || h.type === 'edit') ? 'Pricing' : h.type === 'modify' ? 'Edit' : 'Delete'}</td>
                    <td class="py-3 px-4 text-xs font-mono text-slate-500">${h.productId}</td>
                    <td class="py-3 px-4 text-xs text-slate-700">${htmlSafe(productListDisplayText(h.productName))}</td>
                    <td class="py-3 px-4 text-xs font-bold">${h.type === 'in' ? '+' : h.type === 'out' ? '-' : ''}${h.quantity ?? ''}</td>
                    <td class="py-3 px-4 text-xs text-slate-500">${h.batchNo || '-'}</td>
                    <td class="py-3 px-4 text-xs text-slate-500 truncate max-w-[150px]" title="${htmlSafe(productListDisplayText(h.note || ''))}">${htmlSafe(productListDisplayText(h.note || '-'))}</td>
                </tr>
            `).join('');
        };

        window.renderSalesRecords = () => {
            const list = document.getElementById('sales-records-list');
            const sumEl = document.getElementById('sales-records-summary');
            if (!list || !sumEl) return;
            const rows = Array.isArray(salesRecords) ? salesRecords : [];
            sumEl.textContent = `Total ${rows.length} records`;
            if (rows.length === 0) {
                list.innerHTML = `<tr><td colspan="18" class="py-10 text-center text-slate-400 text-sm">No sales records yet...</td></tr>`;
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
                        <td class="py-3 px-4 text-xs font-bold text-slate-700 max-w-[180px] truncate" title="${htmlSafe(productListDisplayText(r.productName || ''))}">${htmlSafe(productListDisplayText(r.productName || '-'))}</td>
                        <td class="py-3 px-4 text-xs text-slate-600">${r.category || '-'}</td>
                        <td class="py-3 px-4 text-xs text-slate-600">${r.subcategory || '-'}</td>
                        <td class="py-3 px-4 text-xs text-slate-600">${htmlSafe(productListDisplayText(r.vendor || '-'))}</td>
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
                        <td class="py-3 px-4 text-xs text-slate-600">${htmlSafe(productListDisplayText(r.outWarehouse || '-'))}</td>
                        <td class="py-3 px-4 text-xs text-center">
                            <div class="flex items-center justify-center gap-2">
                                <button onclick="editSalesRecord('${r.id}')" class="text-blue-700 hover:bg-blue-50 p-1 rounded text-xs">Edit</button>
                                <button onclick="deleteSalesRecord('${r.id}')" class="text-red-600 hover:bg-red-50 p-1 rounded text-xs">Delete</button>
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
            sumEl.textContent = `Total ${rows.length} records`;
            if (rows.length === 0) {
                list.innerHTML = `<tr><td colspan="12" class="py-10 text-center text-slate-400 text-sm">No archived inventory yet...</td></tr>`;
                return;
            }
            list.innerHTML = rows.slice(0, 500).map(it => {
                const p = products.find(x => x.id === it.productId) || {};
                return `
                    <tr class="hover:bg-slate-50 transition-colors">
                        <td class="py-3 px-4 text-xs text-slate-500">${it.archivedAt ? new Date(it.archivedAt).toLocaleString() : '-'}</td>
                        <td class="py-3 px-4 text-xs font-mono text-slate-600">${it.productId || '-'}</td>
                        <td class="py-3 px-4 text-xs font-bold text-slate-700 max-w-[180px] truncate" title="${htmlSafe(productListDisplayText(p.name || ''))}">${htmlSafe(productListDisplayText(p.name || '-'))}</td>
                        <td class="py-3 px-4 text-xs text-slate-600">${p.category || '-'}</td>
                        <td class="py-3 px-4 text-xs text-slate-600">${p.scenario || '-'}</td>
                        <td class="py-3 px-4 text-xs text-slate-600">${htmlSafe(productListDisplayText(getProductSupplierDisplay(p)))}</td>
                        <td class="py-3 px-4 text-xs text-slate-500">${it.purchaseDate || '-'}</td>
                        <td class="py-3 px-4 text-xs text-slate-500">${it.batchNo || '-'}</td>
                        <td class="py-3 px-4 text-xs text-right font-mono text-slate-700">${(parseFloat(it.spec) || 1).toFixed(2)}</td>
                        <td class="py-3 px-4 text-xs text-right font-mono text-slate-700">¥${(parseFloat(it.purchasePrice) || 0).toFixed(4)}</td>
                        <td class="py-3 px-4 text-xs text-slate-600">${htmlSafe(productListDisplayText(it.location || '-'))}</td>
                        <td class="py-3 px-4 text-xs text-slate-500 truncate max-w-[160px]" title="${htmlSafe(productListDisplayText(it.archivedReason || ''))}">${htmlSafe(productListDisplayText(it.archivedReason || '-'))}</td>
                    </tr>
                `;
            }).join('');
        };
        window.exportHistoricalInventory = () => {
            const rows = (Array.isArray(historicalInventory) ? historicalInventory : []).map(it => {
                const p = products.find(x => x.id === it.productId) || {};
                return {
                    'Archived At': it.archivedAt ? new Date(it.archivedAt).toLocaleString() : '',
                    'Archive Reason': it.archivedReason || '',
                    'Product ID': it.productId || '',
                    'Product Name': productListDisplayText(p.name || ''),
                    Category: p.category || '',
                    Subcategory: p.scenario || '',
                    Supplier: productListDisplayText(getProductSupplierDisplay(p)),
                    'Stock-In Date': it.purchaseDate || '',
                    'Batch No.': it.batchNo || '',
                    Spec: parseFloat(it.spec) || 1,
                    'Batch Purchase Price': parseFloat(it.purchasePrice) || 0,
                    'Unit Purchase Price': parseFloat(it.unitPurchasePrice) || 0,
                    'Freight Rate': parseFloat(it.shippingRate) || 0,
                    'Domestic Tax Rate': parseFloat(it.domesticTaxRate) || 0,
                    Warehouse: productListDisplayText(it.location || ''),
                    'Raw Record': JSON.stringify(it)
                };
            });
            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Archived Inventory');
            XLSX.writeFile(wb, 'Archived Inventory.xlsx');
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
            if (!confirm('Delete this sales-out record and attempt to roll inventory back?')) return;
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
                note: `Deleted sales-out record and rolled inventory back | Contract: ${r.contractNo || '-'}`
            });
            saveToLocal();
            deleteEntityFromD1('sales_record', id);
            persistInventoryStateToD1();
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
            window.inventoryTargetId = targetId; // Tracks which batch is being stocked out
            const productEl = document.getElementById('inv-product-id');
            if (productEl) {
                productEl.readOnly = type === 'out' || type === 'edit';
                productEl.classList.toggle('bg-slate-50', productEl.readOnly);
            }
            const qtyLabel = document.getElementById('inv-quantity-label');
            const productNameWrap = document.getElementById('inv-product-name-container');
            const productNameEl = document.getElementById('inv-product-name');
            const outDateWrap = document.getElementById('inv-out-date-container');
            const outNatureWrap = document.getElementById('inv-out-nature-container');
            const transferFromWrap = document.getElementById('inv-transfer-from-container');
            const transferToWrap = document.getElementById('inv-transfer-to-container');
            if (productNameWrap) productNameWrap.style.display = type === 'edit' ? 'block' : 'none';
            if (productNameEl && type !== 'edit') productNameEl.value = '';
            if (outDateWrap) outDateWrap.style.display = type === 'out' ? 'block' : 'none';
            if (outNatureWrap) outNatureWrap.style.display = type === 'out' ? 'block' : 'none';
            if (transferFromWrap) transferFromWrap.style.display = 'none';
            if (transferToWrap) transferToWrap.style.display = 'none';

            if(type === 'in') {
                if (qtyLabel) qtyLabel.textContent = 'Purchase Quantity';
                document.getElementById('inv-title').innerText = 'Stock In';
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
                if (qtyLabel) qtyLabel.textContent = 'Purchase Quantity';
                document.getElementById('inv-title').innerText = 'Edit Stock-In';
                const item = inventory.find(i => i.id === targetId);
                if(item) {
                    const product = products.find(p => p.id === item.productId);
                    document.getElementById('inv-product-id').value = item.productId;
                    if (productNameEl) productNameEl.value = product?.name || '';
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
                if (qtyLabel) qtyLabel.textContent = 'Stock OutQuantity';
                document.getElementById('inv-title').innerText = 'Stock Out';
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
                const fromLoc = String(item?.location || '').trim() || 'Unspecified Location';
                if (transferFromEl) transferFromEl.value = fromLoc;
                if (transferFromWrap) transferFromWrap.style.display = 'block';
                if (transferToWrap) transferToWrap.style.display = 'block';

                const locations = [...new Set(inventory.map(i => String(i.location || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
                const opts = locations.filter(x => x !== fromLoc);
                if (transferToEl) {
                    transferToEl.innerHTML = `<option value="">Select</option>` + opts.map(x => `<option value="${x.replaceAll('"', '&quot;')}">${x}</option>`).join('');
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
            const nextProductName = String(document.getElementById('inv-product-name')?.value || '').trim();

            if(!productId) return alert("Select a product ID.");
            const product = products.find(p => p.id === productId);
            if(!product) return alert("Select a product ID from the product list.");
            if (window.inventoryType === 'out') {
                const outNature = String(document.getElementById('inv-out-nature')?.value || 'sale');
                if (outNature === 'sale') {
                    closeInventoryModal();
                    openSalesOutModal({ productId });
                    return;
                }
            }
            if(quantity <= 0) return alert("Enter a valid quantity.");

            const productName = product ? product.name : 'Unknown Product';

            if(window.inventoryType === 'in') {
                const purchaseDate = document.getElementById('inv-purchase-date').value;
                if (!purchaseDate) return alert("Select a stock-in date.");
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
                    note: `Stock In ${purchaseDate} | Received To ${location || 'Unspecified Location'} | Total Cost ¥${totalCost.toFixed(2)}`
                });
            } else if (window.inventoryType === 'edit') {
                const item = inventory.find(i => i.id === window.inventoryTargetId);
                if(!item) return alert("Stock-in record not found.");
                const purchaseDate = document.getElementById('inv-purchase-date').value;
                if (!purchaseDate) return alert("Select a stock-in date.");
                const batchNo = document.getElementById('inv-batch-no').value || '';
                if (!batchNo) return alert("Purchase Batch No. is required.");
                if (inventory.some(i => i.id !== item.id && String(i.batchNo || '') === String(batchNo))) {
                    return alert("Purchase Batch No. already exists. Adjust the stock-in date to generate a new batch no.");
                }
                const oldProductName = String(product.name || '').trim();
                let nameChangeNote = '';
                if (nextProductName && nextProductName !== oldProductName) {
                    product.name = nextProductName;
                    product.ts = Date.now();
                    nameChangeNote = ` | Product Name ${oldProductName || '-'} → ${nextProductName}`;
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
                    productName: product.name || productName,
                    quantity,
                    batchNo,
                    note: `Edit Stock-In ${purchaseDate} | Stored At ${location || 'Unspecified Location'} | Total Cost ¥${totalCost.toFixed(2)}${nameChangeNote}`
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
                    if (!item) return alert('Batch inventory record not found.');
                    const fromLoc = String(item.location || '').trim() || 'Unspecified Location';
                    const toLoc = String(document.getElementById('inv-transfer-to')?.value || '').trim();
                    if (!toLoc) return alert('Select a destination warehouse.');
                    if (!quantity || quantity <= 0) return alert('Enter a valid stock-out quantity.');
                    if (item.quantity < quantity) return alert('This batch does not have enough stock.');

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
                        note: `Stock-Out Type: Transfer Out | Stock-Out Date: ${outDate || '-'} | From: ${fromLoc} -> To: ${toLoc}`
                    });
                    pushInventoryHistory({
                        ts: Date.now(),
                        type: 'in',
                        productId,
                        productName,
                        quantity,
                        batchNo: item.batchNo,
                        note: `Stock-In Type: Transfer In | Stock-In Date: ${outDate || '-'} | To: ${toLoc} <- From: ${fromLoc}`
                    });
                    archiveZeroQtyInventoryItems(`Transfer Out | ${fromLoc} -> ${toLoc}`);
                    saveToLocal();
                    persistInventoryStateToD1();
                    closeInventoryModal();
                    return;
                }
                if(!item || item.quantity < quantity) return alert("This batch does not have enough stock.");
                item.quantity -= quantity;

                pushInventoryHistory({
                    ts: Date.now(),
                    type: 'out',
                    productId,
                    productName,
                    quantity,
                    batchNo: item.batchNo,
                    note: `Stock-Out Type: ${outNature} | Stock-Out Date: ${outDate || '-'} | From ${productListDisplayText(item.location || 'Unspecified Location')} stock out`
                });

                archiveZeroQtyInventoryItems(`Batch Stock-Out | ${outNature}`);
            }

            saveToLocal();
            persistInventoryStateToD1();
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
                alloc.push({ id: b.id, batchNo: b.batchNo || '-', purchaseDate: b.purchaseDate || '-', location: b.location || 'Unspecified Location', qty: take, spec: Number.isFinite(parseFloat(b.spec)) ? parseFloat(b.spec) : 1 });
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
            const lines = slice.map(a => `Batch ${a.batchNo} | ${a.purchaseDate} | ${a.location} | Quantity ${a.qty}`);
            if (list.length > maxLines) lines.push(`... ${list.length - maxLines} more batches`);
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
            if (getProductSourceTypeLabel(product) === 'Authorized Distributor') {
                return { shippingRatePct: 0, domesticTaxRatePct: 0, dutyPct: 0, sstPct: 0, grayPct: 0 };
            }
            return {
                shippingRatePct: 8,
                domesticTaxRatePct: getDefaultDomesticTaxRatePercent(p.category),
                dutyPct: getDefaultImportDutyPercent(p.category),
                sstPct: getDefaultSstPercent(),
                grayPct: getDefaultGrayTaxPercent()
            };
        }
        function normalizeNonStockPricingStrategy(raw = {}) {
            const source = raw && typeof raw === 'object' ? raw : {};
            const out = {};
            ['purchasePrice', 'avgCostOverride', 'shippingRatePct', 'domesticTaxRatePct', 'dutyPct', 'sstPct', 'grayPct'].forEach(key => {
                const n = parseFloat(source[key]);
                if (Number.isFinite(n) && n >= 0) out[key] = n;
            });
            if (String(source.updatedAt || '').trim()) out.updatedAt = String(source.updatedAt);
            return out;
        }
        function normalizeNonStockPricingStrategies(raw) {
            const source = raw && typeof raw === 'object' ? raw : {};
            const out = {};
            Object.entries(source).forEach(([productId, strategy]) => {
                const id = String(productId || '').trim();
                if (!id) return;
                const normalized = normalizeNonStockPricingStrategy(strategy);
                if (Object.keys(normalized).length) out[id] = normalized;
            });
            return out;
        }
        function getNonStockPricingStrategy(productId) {
            const id = String(productId || '').trim();
            if (!id) return {};
            nonStockPricingStrategies = normalizeNonStockPricingStrategies(nonStockPricingStrategies);
            return nonStockPricingStrategies[id] || {};
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
        function getInventoryFxRateCnyPerMyr() {
            const direct = parseFloat(document.getElementById('inventory-rate-myr-cny')?.value);
            if (Number.isFinite(direct) && direct > 0) return direct;
            return getSalesOutRateCnyPerMyr();
        }
        function getInventoryDisplayCurrency() {
            return window.inventoryDisplayCurrency === 'MYR' ? 'MYR' : 'CNY';
        }
        function getNonStockDisplayCurrency() {
            return window.nonStockDisplayCurrency === 'MYR' ? 'MYR' : 'CNY';
        }
        function getNonStockProfitTarget() {
            return window.nonStockProfitTarget === 'biz' ? 'biz' : 'home';
        }
        function formatAmountFromCnyForTable(valueCny, currency, digits = 2, unit = '', rateCnyPerMyr = getSalesOutRateCnyPerMyr()) {
            const suffix = unit ? `/${normalizeUnitLabel(unit)}` : '';
            const n = Number.isFinite(parseFloat(valueCny)) ? parseFloat(valueCny) : 0;
            const amount = String(currency || '').toUpperCase() === 'MYR'
                ? `RM ${(n / Math.max(0.0001, rateCnyPerMyr)).toFixed(digits)}`
                : `¥${n.toFixed(digits)}`;
            return `${amount}${suffix}`;
        }
        function formatInventoryAmount(valueCny, digits = 2, unit = '') {
            return formatAmountFromCnyForTable(valueCny, getInventoryDisplayCurrency(), digits, unit, getInventoryFxRateCnyPerMyr());
        }
        function formatNonStockAmount(valueCny, digits = 2, unit = '') {
            return formatAmountFromCnyForTable(valueCny, getNonStockDisplayCurrency(), digits, unit, getInventoryFxRateCnyPerMyr());
        }
        function nonStockDisplayFromCny(valueCny) {
            const n = Number.isFinite(parseFloat(valueCny)) ? parseFloat(valueCny) : 0;
            return getNonStockDisplayCurrency() === 'MYR' ? n / getInventoryFxRateCnyPerMyr() : n;
        }
        function nonStockCnyFromDisplay(value, currency = getNonStockDisplayCurrency(), rateCnyPerMyr = getInventoryFxRateCnyPerMyr()) {
            const n = Number.isFinite(parseFloat(value)) ? parseFloat(value) : 0;
            return currency === 'MYR' ? n * rateCnyPerMyr : n;
        }
        function readNonStockNumFromDom(field, sid) {
            const raw = document.getElementById(`non-stock-${field}-${sid}`)?.value;
            const n = parseFloat(raw);
            return Number.isFinite(n) && n >= 0 ? n : null;
        }
        function captureNonStockPricingDraftsFromDom() {
            const renderedCurrency = window.__nonStockRenderedCurrency === 'MYR' ? 'MYR' : 'CNY';
            const renderedRate = Number.isFinite(parseFloat(window.__nonStockRenderedRateCnyPerMyr))
                ? parseFloat(window.__nonStockRenderedRateCnyPerMyr)
                : getInventoryFxRateCnyPerMyr();
            const drafts = {};
            const rows = getNonStockProductsForPricing();
            rows.forEach(p => {
                const sid = domSafeId(p.id);
                const purchaseDisplay = readNonStockNumFromDom('purchase', sid);
                const shippingRatePct = readNonStockNumFromDom('shipping', sid);
                const domesticTaxRatePct = readNonStockNumFromDom('domestic', sid);
                const dutyPct = readNonStockNumFromDom('duty', sid);
                const sstPct = readNonStockNumFromDom('sst', sid);
                const grayPct = readNonStockNumFromDom('gray', sid);
                const existing = getNonStockPricingStrategy(p.id);
                drafts[p.id] = normalizeNonStockPricingStrategy({
                    ...existing,
                    purchasePrice: purchaseDisplay === null ? existing.purchasePrice : nonStockCnyFromDisplay(purchaseDisplay, renderedCurrency, renderedRate),
                    avgCostOverride: purchaseDisplay === null ? existing.avgCostOverride : nonStockCnyFromDisplay(purchaseDisplay, renderedCurrency, renderedRate),
                    shippingRatePct: shippingRatePct === null ? existing.shippingRatePct : shippingRatePct,
                    domesticTaxRatePct: domesticTaxRatePct === null ? existing.domesticTaxRatePct : domesticTaxRatePct,
                    dutyPct: dutyPct === null ? existing.dutyPct : dutyPct,
                    sstPct: sstPct === null ? existing.sstPct : sstPct,
                    grayPct: grayPct === null ? existing.grayPct : grayPct
                });
            });
            window.__nonStockPricingDrafts = drafts;
        }
        function formatNonStockPriceUpdatedAt(value) {
            const raw = String(value || '').trim();
            if (!raw) return '-';
            const d = new Date(raw);
            if (Number.isNaN(d.getTime())) return htmlSafe(raw);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        }
        window.toggleInventoryCurrency = () => {
            window.inventoryDisplayCurrency = getInventoryDisplayCurrency() === 'MYR' ? 'CNY' : 'MYR';
            renderInventory();
        };
        window.toggleNonStockCurrency = () => {
            captureNonStockPricingDraftsFromDom();
            window.nonStockDisplayCurrency = getNonStockDisplayCurrency() === 'MYR' ? 'CNY' : 'MYR';
            renderNonStockPricingStrategies();
        };
        window.setNonStockProfitTarget = (target) => {
            window.nonStockProfitTarget = target === 'biz' ? 'biz' : 'home';
            renderNonStockPricingStrategies();
        };
        function updateNonStockProfitTargetButtons() {
            const activeClass = 'px-3 py-2 rounded-xl bg-purple-700 text-white text-xs font-black border border-purple-700';
            const idleClass = 'px-3 py-2 rounded-xl bg-white text-slate-700 text-xs font-black border border-slate-200 hover:bg-slate-50';
            const home = document.getElementById('non-stock-target-home');
            const biz = document.getElementById('non-stock-target-biz');
            const target = getNonStockProfitTarget();
            if (home) home.className = target === 'home' ? activeClass : idleClass;
            if (biz) biz.className = target === 'biz' ? activeClass : idleClass;
        }
        function renderNonStockProfitSplitCell(pricing, companyKey) {
            const target = getNonStockProfitTarget();
            const subsidiaryPct = target === 'biz'
                ? (Number.isFinite(parseFloat(pricing.subsidiaryBizPct)) ? pricing.subsidiaryBizPct : pricing.myBizPct)
                : (Number.isFinite(parseFloat(pricing.subsidiaryHomePct)) ? pricing.subsidiaryHomePct : pricing.myHomePct);
            const pct = companyKey === 'cn'
                ? (target === 'biz' ? pricing.cnBizPct : pricing.cnHomePct)
                : subsidiaryPct;
            const p = Number.isFinite(parseFloat(pct)) ? parseFloat(pct) : 0;
            const multiplier = Number.isFinite(parseFloat(pricing.pcsMultiplier)) ? parseFloat(pricing.pcsMultiplier) : 1;
            const clearance = (Number.isFinite(parseFloat(pricing.clearanceCost)) ? parseFloat(pricing.clearanceCost) : 0) * multiplier * (p / 100);
            const grey = (Number.isFinite(parseFloat(pricing.grayCost)) ? parseFloat(pricing.grayCost) : 0) * multiplier * (p / 100);
            return `
                <div class="font-black text-slate-800">${formatNonStockAmount(clearance, 2, 'pcs')}</div>
                <div class="text-[10px] text-slate-400">Clearance | ${p.toFixed(2)}%</div>
                <div class="mt-1 font-bold text-slate-600">${formatNonStockAmount(grey, 2, 'pcs')}</div>
                <div class="text-[10px] text-slate-400">Grey | ${p.toFixed(2)}%</div>
            `;
        }
        window.renderNonStockProfitSplitCell = renderNonStockProfitSplitCell;
        window.refreshFxDependentPricingViews = () => {
            window.renderCostCalcUI?.();
            window.renderPriceList?.();
            window.renderPriceListPicker?.();
            window.recalcInstallerQuote?.();
        };
        window.refreshInventoryFxDependentViews = () => {
            captureNonStockPricingDraftsFromDom();
            window.renderInventory?.();
            window.renderNonStockPricingStrategies?.();
        };
        window.applyInventoryFxRate = (rate, { render = false, syncQuote = true } = {}) => {
            const n = parseFloat(rate);
            if (!Number.isFinite(n) || n <= 0) return false;
            if (render) {
                captureNonStockPricingDraftsFromDom();
            } else {
                window.__nonStockPricingDrafts = {};
            }
            const fixed = n.toFixed(4);
            const inventoryRateEl = document.getElementById('inventory-rate-myr-cny');
            if (inventoryRateEl) inventoryRateEl.value = fixed;
            if (syncQuote) {
                const quoteRateEl = document.getElementById('rate-myr-cny');
                if (quoteRateEl) quoteRateEl.value = fixed;
            }
            if (render) {
                window.renderInventory?.();
                window.renderNonStockPricingStrategies?.();
            } else {
                window.__nonStockRenderedRateCnyPerMyr = n;
                window.__nonStockRenderedCurrency = getNonStockDisplayCurrency();
            }
            return true;
        };
        window.syncInventoryFxRateFromQuoteSettings = ({ render = false } = {}) => {
            window.applyInventoryFxRate(getSalesOutRateCnyPerMyr(), { render, syncQuote: false });
        };
        window.refreshInventoryLiveFx = async ({ render = true, btn = null } = {}) => {
            const rateBtn = btn || document.getElementById('inventory-sync-quote-fx');
            const originalText = rateBtn?.innerHTML || '';
            if (rateBtn) {
                rateBtn.innerHTML = 'Fetching...';
                rateBtn.disabled = true;
            }
            try {
                const res = await fetch('https://api.exchangerate-api.com/v4/latest/MYR');
                const data = await res.json();
                if (data?.rates?.CNY && window.applyInventoryFxRate(data.rates.CNY, { render, syncQuote: true })) {
                    window.refreshFxDependentPricingViews?.();
                    return true;
                }
            } catch (e) {
                console.error('Failed to fetch inventory exchange rate:', e);
            } finally {
                if (rateBtn) {
                    rateBtn.innerHTML = originalText;
                    rateBtn.disabled = false;
                }
            }
            window.syncInventoryFxRateFromQuoteSettings({ render });
            return false;
        };
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
        let selectedPriceListProductIds = new Set();
        let currentPriceListVisibleIds = [];
        const PRICE_LIST_TYPES = [
            { key: 'clearanceHomePrice', label: 'Clearance RESI', costKey: 'clearanceCost', profitTarget: 'home' },
            { key: 'clearanceBizPrice', label: 'Clearance C&I', costKey: 'clearanceCost', profitTarget: 'biz' },
            { key: 'grayHomePrice', label: 'Grey RESI', costKey: 'grayCost', profitTarget: 'home' },
            { key: 'grayBizPrice', label: 'Grey C&I', costKey: 'grayCost', profitTarget: 'biz' }
        ];
        function getPriceListSelectedPriceType() {
            const basis = String(document.getElementById('price-list-price-basis')?.value || 'clearance') === 'gray' ? 'gray' : 'clearance';
            const target = String(document.getElementById('price-list-price-target')?.value || 'home') === 'biz' ? 'biz' : 'home';
            return `${basis}_${target}`;
        }
        function getPriceListSelectedPriceLabel() {
            const type = getPriceListSelectedPriceType();
            if (type === 'clearance_biz') return 'Clearance C&I';
            if (type === 'gray_home') return 'Grey RESI';
            if (type === 'gray_biz') return 'Grey C&I';
            return 'Clearance RESI';
        }
        function getPriceListSelectedPcsPrice(pricing = {}) {
            const type = getPriceListSelectedPriceType();
            let unitPrice = pricing.clearanceHomePrice || 0;
            if (type === 'clearance_biz') unitPrice = pricing.clearanceBizPrice || 0;
            else if (type === 'gray_home') unitPrice = pricing.grayHomePrice || 0;
            else if (type === 'gray_biz') unitPrice = pricing.grayBizPrice || 0;
            const multiplier = Number.isFinite(parseFloat(pricing.pcsMultiplier)) ? parseFloat(pricing.pcsMultiplier) : 1;
            return unitPrice * (multiplier > 0 ? multiplier : 1);
        }
        function formatCny(v, digits = 2) {
            const n = Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0;
            return `¥${n.toFixed(digits)}`;
        }
        function formatMyrFromCny(v, digits = 2) {
            const n = Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0;
            return `RM ${(n / getSalesOutRateCnyPerMyr()).toFixed(digits)}`;
        }
        function priceListProductPricing(product) {
            const p = product || {};
            const batches = getFifoBatchesForProduct(p.id);
            const pricingMeta = getProductPricingMeta(p, batches[0]);
            const spec = pricingMeta.unitQtyPerPcs || 1;
            const def = getDefaultTaxInputsForProduct(p);
            const inventoryAvg = getAverageInventoryCostPerSpec(p.id, spec);
            const strategy = getNonStockPricingStrategy(p.id);
            const hasInventoryCost = inventoryAvg > 0;
            const strategyPurchase = Number.isFinite(parseFloat(strategy.purchasePrice)) ? parseFloat(strategy.purchasePrice) : NaN;
            const strategyAvg = Number.isFinite(parseFloat(strategy.avgCostOverride)) ? parseFloat(strategy.avgCostOverride) : NaN;
            const basePurchaseCost = Number.isFinite(strategyPurchase) ? strategyPurchase : (Number.isFinite(strategyAvg) ? strategyAvg : getProductCostCny(p));
            const shippingRatePct = hasInventoryCost ? def.shippingRatePct : (Number.isFinite(parseFloat(strategy.shippingRatePct)) ? parseFloat(strategy.shippingRatePct) : def.shippingRatePct);
            const domesticTaxRatePct = hasInventoryCost ? def.domesticTaxRatePct : (Number.isFinite(parseFloat(strategy.domesticTaxRatePct)) ? parseFloat(strategy.domesticTaxRatePct) : def.domesticTaxRatePct);
            const expectedFreightCost = basePurchaseCost * (shippingRatePct / 100);
            const expectedDomesticTaxCost = basePurchaseCost * (domesticTaxRatePct / 100);
            const avgFallback = basePurchaseCost + expectedFreightCost + expectedDomesticTaxCost;
            const avgCost = inventoryAvg > 0 ? inventoryAvg : avgFallback;
            const dutyPct = hasInventoryCost ? def.dutyPct : (Number.isFinite(parseFloat(strategy.dutyPct)) ? parseFloat(strategy.dutyPct) : def.dutyPct);
            const sstPct = hasInventoryCost ? def.sstPct : (Number.isFinite(parseFloat(strategy.sstPct)) ? parseFloat(strategy.sstPct) : def.sstPct);
            const grayPct = hasInventoryCost ? def.grayPct : (Number.isFinite(parseFloat(strategy.grayPct)) ? parseFloat(strategy.grayPct) : def.grayPct);
            const costUnit = pricingMeta.priceBasisUnit;
            const pcsMultiplier = spec > 0 ? spec : 1;
            const pcsCost = avgCost * pcsMultiplier;
            const r = computeInventoryPricing({
                item: {
                    productId: p.id,
                    spec,
                    avgCostOverride: avgCost,
                    importDutyPct: dutyPct,
                    sstPct,
                    grayTaxPct: grayPct
                },
                product: p
            });
            return { ...r, spec, costUnit, pcsMultiplier, pcsCost, pricingMeta, stockQty: getTotalStockQty(p.id), usedInventoryCost: inventoryAvg > 0, basePurchaseCost, shippingRatePct, domesticTaxRatePct, expectedFreightCost, expectedDomesticTaxCost };
        }
        function getProductSpecMultiplierForUnit(product, fallbackSpec, unit) {
            const p = product || {};
            const u = normalizeUnitLabel(unit || '');
            if (u === 'pcs' || u === 'set') return 1;
            const text = `${p.spec || ''} ${p.name || ''}`;
            const escaped = u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const re = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${escaped}\\b`, 'i');
            const match = text.match(re);
            const parsed = match ? parseFloat(match[1]) : NaN;
            if (Number.isFinite(parsed) && parsed > 0) return parsed;
            const fallback = Number.isFinite(parseFloat(fallbackSpec)) ? parseFloat(fallbackSpec) : 1;
            return fallback > 0 ? fallback : 1;
        }
        function getPriceListCurrencyPriority() {
            return window.priceListDisplayCurrency === 'CNY' ? 'CNY' : 'MYR';
        }
        function formatCurrencyFromCny(valueCny, currency, digits = 2) {
            const n = Number.isFinite(parseFloat(valueCny)) ? parseFloat(valueCny) : 0;
            if (String(currency || '').toUpperCase() === 'MYR') return `RM ${(n / getSalesOutRateCnyPerMyr()).toFixed(digits)}`;
            return `¥${n.toFixed(digits)}`;
        }
        function renderDualCurrencyAmount(valueCny, digits = 2, unit = '') {
            const primary = getPriceListCurrencyPriority();
            const secondary = primary === 'MYR' ? 'CNY' : 'MYR';
            const suffix = unit ? `/${normalizeUnitLabel(unit)}` : '';
            return `
                <div class="font-black text-slate-800">${formatCurrencyFromCny(valueCny, primary, digits)}${suffix}</div>
                <div class="text-[10px] text-slate-400">${formatCurrencyFromCny(valueCny, secondary, digits)}${suffix}</div>
            `;
        }
        function priceListCountryLabel(code) {
            const labels = { PV_MODULE: 'PV Module', INVERTER: 'Inverter / PCS', BATTERY: 'Battery / BESS' };
            return labels[String(code || '').trim()] || code;
        }
        function renderPriceListFilters() {
            const catSel = document.getElementById('price-list-category-filter');
            const brandSel = document.getElementById('price-list-brand-filter');
            const countrySel = document.getElementById('price-list-country-filter');
            const certSel = document.getElementById('price-list-cert-filter');
            if (!catSel || !brandSel || !countrySel || !certSel) return;
            const keep = {
                cat: String(catSel.value || '').trim() ? normalizeProductCategory(catSel.value) : '',
                brand: brandSel.value,
                country: countrySel.value,
                cert: certSel.value
            };
            const cats = [...new Set(products.map(p => normalizeProductCategory(p.category)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
            const brands = [...new Set(products.map(p => getProductSupplierDisplay(p)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
            const countryOptions = CERTIFICATION_SOURCE_CATEGORIES.map(c => ({ value: c, label: priceListCountryLabel(c) }));
            const certSet = new Set();
            products.forEach(p => {
                const req = getProductCertificationRequirements(p);
                const country = keep.country;
                const records = productCertificationSelectedRecords(p);
                if (country && !records.some(record => record.sourceCategory === country)) return;
                records.forEach(record => certSet.add(record.standard || record.id));
                (req.standards || []).forEach(s => certSet.add(s));
            });
            const certs = [...certSet].sort((a, b) => a.localeCompare(b));
            catSel.innerHTML = `<option value="">All Categories</option>` + cats.map(v => `<option value="${htmlSafe(v)}">${htmlSafe(v)}</option>`).join('');
            brandSel.innerHTML = `<option value="">All Brands</option>` + brands.map(v => `<option value="${htmlSafe(v)}">${htmlSafe(v)}</option>`).join('');
            countrySel.innerHTML = `<option value="">All Certification Categories</option>` + countryOptions.map(c => `<option value="${c.value}">${c.label}</option>`).join('');
            certSel.innerHTML = `<option value="">All Certifications</option>` + certs.map(v => `<option value="${htmlSafe(v)}">${htmlSafe(v)}</option>`).join('');
            if (keep.cat && cats.includes(keep.cat)) catSel.value = keep.cat;
            if (keep.brand && brands.includes(keep.brand)) brandSel.value = keep.brand;
            if (keep.country && countryOptions.some(c => c.value === keep.country)) countrySel.value = keep.country;
            if (keep.cert && certs.includes(keep.cert)) certSel.value = keep.cert;
        }
        function getFilteredPriceListProducts() {
            const q = String(document.getElementById('price-list-search')?.value || '').trim().toLowerCase();
            const rawCategory = String(document.getElementById('price-list-category-filter')?.value || '').trim();
            const category = rawCategory ? normalizeProductCategory(rawCategory) : '';
            const brand = String(document.getElementById('price-list-brand-filter')?.value || '').trim();
            const country = String(document.getElementById('price-list-country-filter')?.value || '').trim();
            const cert = String(document.getElementById('price-list-cert-filter')?.value || '').trim();
            return products.filter(p => {
                const req = getProductCertificationRequirements(p);
                const records = productCertificationSelectedRecords(p);
                const recordStandards = records.map(record => record.standard || record.id);
                const text = `${p.id || ''} ${p.name || ''} ${p.spec || ''} ${p.category || ''} ${p.scenario || ''} ${getProductSupplierDisplay(p)} ${(req.recordIds || []).join(' ')} ${(req.standards || []).join(' ')} ${recordStandards.join(' ')}`.toLowerCase();
                if (q && !text.includes(q)) return false;
                if (category && normalizeProductCategory(p.category) !== category) return false;
                if (brand && getProductSupplierDisplay(p) !== brand) return false;
                if (country && !records.some(record => record.sourceCategory === country)) return false;
                if (cert && ![...recordStandards, ...(req.standards || [])].includes(cert)) return false;
                return true;
            }).sort((a, b) => String(a.category || '').localeCompare(String(b.category || '')) || String(a.name || '').localeCompare(String(b.name || '')));
        }
        function renderPriceCell(value, baseCost, unit = '') {
            const v = Number.isFinite(parseFloat(value)) ? parseFloat(value) : 0;
            const base = Number.isFinite(parseFloat(baseCost)) ? parseFloat(baseCost) : 0;
            const profit = v - base;
            const pct = v > 0 ? (profit / v) * 100 : 0;
            const suffix = unit ? `/${normalizeUnitLabel(unit)}` : '';
            return `
                ${renderDualCurrencyAmount(v, 2, unit)}
                <div class="text-[10px] ${profit >= 0 ? 'text-green-600' : 'text-red-500'}">Profit ${formatCurrencyFromCny(profit, getPriceListCurrencyPriority(), 2)}${suffix} / ${pct.toFixed(1)}%</div>
            `;
        }
        function renderMarketPriceForm() {
            const catSel = document.getElementById('market-price-category');
            const unitSel = document.getElementById('market-price-unit');
            const dateEl = document.getElementById('market-price-date');
            if (!catSel || !unitSel) return;
            marketPrices = normalizeMarketPrices(marketPrices);
            const keep = catSel.value;
            const cats = [...new Set(products.map(p => String(p.category || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
            catSel.innerHTML = cats.map(cat => `<option value="${htmlSafe(cat)}">${htmlSafe(cat)}</option>`).join('');
            const nextCat = keep && cats.includes(keep) ? keep : cats[0];
            if (nextCat) catSel.value = nextCat;
            const unit = getMarketCategoryUnitMeta(nextCat).unit;
            unitSel.value = [...unitSel.options].some(o => o.value === unit) ? unit : 'pcs';
            if (dateEl && !dateEl.value) dateEl.value = new Date().toISOString().slice(0, 10);
            renderMarketPriceFormHint();
        }
        function renderMarketPriceFormHint() {
            const hint = document.getElementById('market-price-form-hint');
            const cat = String(document.getElementById('market-price-category')?.value || '').trim();
            if (!hint || !cat) return;
            const meta = getMarketCategoryUnitMeta(cat);
            const summary = getMarketPriceSummary(cat, { days: 30 });
            const source = meta.source === 'manual' ? 'manual override' : 'auto from inventory/spec';
            const recent = summary.records.length
                ? `30D avg ${formatMarketPrice(summary.avgCny, summary.unit, 'CNY')} / ${formatMarketPrice(summary.avgCny, summary.unit, 'MYR')}`
                : 'No 30-day market price';
            hint.textContent = `${cat} unit: /${summary.unit} (${source}). ${recent}.`;
        }
        window.onMarketPriceCategoryChange = () => {
            const cat = String(document.getElementById('market-price-category')?.value || '').trim();
            const unitSel = document.getElementById('market-price-unit');
            if (cat && unitSel) unitSel.value = getMarketCategoryUnitMeta(cat).unit;
            renderMarketPriceFormHint();
        };
        window.onMarketPriceUnitChange = () => {
            const cat = String(document.getElementById('market-price-category')?.value || '').trim();
            const unit = String(document.getElementById('market-price-unit')?.value || '').trim();
            if (cat && unit) {
                upsertMarketCategoryUnit(cat, unit);
                try { localStorage.setItem('minova_market_prices_v1', JSON.stringify(marketPrices)); } catch (e) {}
                persistMarketPricesToD1();
                renderMarketPriceFormHint();
                renderPriceList();
            }
        };
        window.saveMarketPriceFromPriceList = () => {
            try {
                const category = String(document.getElementById('market-price-category')?.value || '').trim();
                const unit = String(document.getElementById('market-price-unit')?.value || '').trim();
                const currency = String(document.getElementById('market-price-currency')?.value || 'MYR').trim();
                const price = parseFloat(document.getElementById('market-price-value')?.value || '0') || 0;
                const quotedAt = String(document.getElementById('market-price-date')?.value || '').trim();
                const note = String(document.getElementById('market-price-note')?.value || '').trim();
                addMarketPriceRecord({ category, unit, currency, price, quotedAt, note, rateCnyPerMyr: getSalesOutRateCnyPerMyr() });
                const priceEl = document.getElementById('market-price-value');
                const noteEl = document.getElementById('market-price-note');
                if (priceEl) priceEl.value = '';
                if (noteEl) noteEl.value = '';
                saveToLocal();
                persistMarketPricesToD1();
                renderMarketPriceForm();
                renderPriceList();
                showToast('Market price saved', 'success');
            } catch (e) {
                alert(e?.message || 'Market price save failed');
            }
        };
        function renderMarketSummaryCell(category) {
            const summary = getMarketPriceSummary(category, { days: 30 });
            const trendClass = summary.trendCny > 0 ? 'text-red-500' : summary.trendCny < 0 ? 'text-green-600' : 'text-slate-400';
            const trendSign = summary.trendCny > 0 ? '+' : '';
            if (!summary.records.length) {
                const latest = summary.latest;
                return `
                    <button type="button" onclick="openMarketTrendModal('${htmlSafe(category)}')" class="text-right hover:underline">
                        <div class="font-black text-slate-400">No 30-day market price</div>
                        <div class="text-[10px] text-slate-400">${latest ? `Latest ${formatMarketPrice(latest.priceCny, latest.unit || summary.unit, 'CNY')}` : `Unit /${summary.unit}`}</div>
                    </button>
                `;
            }
            return `
                <button type="button" onclick="openMarketTrendModal('${htmlSafe(category)}')" class="text-right hover:underline">
                    ${renderDualCurrencyAmount(summary.avgCny, 4, summary.unit)}
                    <div class="text-[10px] ${trendClass}">${trendSign}${formatCurrencyFromCny(summary.trendCny, getPriceListCurrencyPriority(), 4)}/${summary.unit} / ${trendSign}${summary.trendPct.toFixed(1)}%</div>
                </button>
            `;
        }
        function marketTooltipHtml(category) {
            const summary = getMarketPriceSummary(category, { days: 30 });
            const latest = summary.latest;
            const trendSign = summary.trendCny > 0 ? '+' : '';
            const recentLine = summary.records.length
                ? `<p>30D Avg: <span class="font-black text-white">${formatMarketPrice(summary.avgCny, summary.unit, 'CNY')}</span> (${formatMarketPrice(summary.avgCny, summary.unit, 'MYR')})</p>`
                : '<p class="text-amber-200">No 30-day market price</p>';
            return `
                <p class="font-black text-sm mb-2 border-b border-slate-600 pb-1">${htmlSafe(category || '-')} Market</p>
                <div class="space-y-1">
                    ${recentLine}
                    <p>Unit: /${htmlSafe(summary.unit)}</p>
                    <p>Trend: <span class="font-black">${trendSign}${formatMarketPrice(summary.trendCny, summary.unit, 'CNY')} / ${trendSign}${summary.trendPct.toFixed(1)}%</span></p>
                    <p>Latest: ${latest ? `${formatMarketPrice(latest.priceCny, latest.unit || summary.unit, 'CNY')} on ${htmlSafe(latest.quotedAt || '-')}` : '-'}</p>
                    <p>FX display: 1 MYR = ${getSalesOutRateCnyPerMyr().toFixed(4)} CNY</p>
                </div>
            `;
        }
        window.showMarketPriceTooltip = (event, categoryOrProductId) => {
            const tooltip = document.getElementById('global-tooltip');
            if (!tooltip) return;
            const raw = String(categoryOrProductId || '').trim();
            const product = products.find(p => String(p.id) === raw);
            const category = product ? String(product.category || '').trim() : raw;
            if (!category) {
                window.hideGlobalTooltip?.();
                return;
            }
            tooltip.innerHTML = marketTooltipHtml(category);
            tooltip.classList.remove('hidden');
            const x = event.clientX + 16;
            const y = event.clientY + 16;
            tooltip.style.left = `${Math.min(x, window.innerWidth - 300)}px`;
            tooltip.style.top = `${Math.min(y, window.innerHeight - 240)}px`;
        };
        function marketRangeLabel(range) {
            if (range === 'year') return 'Year · 近5年';
            if (range === 'month') return 'Month · 近12个月';
            return 'Day · 近30天';
        }
        function renderMarketLineChart(records, options = {}) {
            const rows = (Array.isArray(records) ? records : []).slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
            if (rows.length < 2) return '<div class="h-48 flex items-center justify-center text-xs text-slate-400 border border-slate-100 rounded-xl bg-slate-50">Need at least 2 records for trend</div>';
            const currency = String(options.currency || getPriceListCurrencyPriority()).toUpperCase() === 'CNY' ? 'CNY' : 'MYR';
            const unit = normalizeUnitLabel(options.unit || rows[0]?.unit || 'pcs');
            const rate = getSalesOutRateCnyPerMyr();
            const values = rows.map(r => {
                const cny = parseFloat(r.priceCny) || 0;
                return currency === 'MYR' ? cny / rate : cny;
            });
            const times = rows.map(r => r.ts || Date.parse(r.quotedAt) || Date.now());
            const minV = Math.min(...values);
            const maxV = Math.max(...values);
            const minT = Math.min(...times);
            const maxT = Math.max(...times);
            const vPad = Math.max((maxV - minV) * 0.12, maxV * 0.03, 0.0001);
            const yMin = Math.max(0, minV - vPad);
            const yMax = maxV + vPad;
            const tSpan = Math.max(1, maxT - minT);
            const vSpan = Math.max(0.000001, yMax - yMin);
            const w = 720, h = 300, left = 72, right = 24, top = 24, bottom = 54;
            const plotW = w - left - right;
            const plotH = h - top - bottom;
            const xFor = t => left + ((t - minT) / tSpan) * plotW;
            const yFor = v => top + plotH - ((v - yMin) / vSpan) * plotH;
            const points = rows.map((r, idx) => `${xFor(times[idx]).toFixed(1)},${yFor(values[idx]).toFixed(1)}`).join(' ');
            const yTicks = [0, 1, 2, 3, 4].map(i => yMin + (vSpan * i / 4));
            const xTicks = rows.length <= 4 ? rows : [rows[0], rows[Math.floor(rows.length / 2)], rows[rows.length - 1]];
            const fmtTick = v => `${currency === 'MYR' ? 'RM ' : '¥'}${v.toFixed(v >= 10 ? 2 : 4)}`;
            return `
                <svg viewBox="0 0 ${w} ${h}" class="w-full h-72 rounded-xl bg-slate-50 border border-slate-100">
                    <line x1="${left}" y1="${top}" x2="${left}" y2="${top + plotH}" stroke="#94a3b8" stroke-width="1.5"></line>
                    <line x1="${left}" y1="${top + plotH}" x2="${left + plotW}" y2="${top + plotH}" stroke="#94a3b8" stroke-width="1.5"></line>
                    ${yTicks.map(v => {
                        const y = yFor(v);
                        return `<g><line x1="${left}" y1="${y}" x2="${left + plotW}" y2="${y}" stroke="#e2e8f0"></line><text x="${left - 10}" y="${y + 4}" text-anchor="end" font-size="11" fill="#64748b">${fmtTick(v)}</text></g>`;
                    }).join('')}
                    ${xTicks.map(r => {
                        const x = xFor(r.ts || Date.parse(r.quotedAt) || minT);
                        return `<g><line x1="${x}" y1="${top + plotH}" x2="${x}" y2="${top + plotH + 5}" stroke="#94a3b8"></line><text x="${x}" y="${top + plotH + 22}" text-anchor="middle" font-size="11" fill="#64748b">${htmlSafe(r.quotedAt || '')}</text></g>`;
                    }).join('')}
                    <text x="${left}" y="15" font-size="12" font-weight="800" fill="#475569">${currency}/${unit}</text>
                    <polyline fill="none" stroke="#582C83" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" points="${points}"></polyline>
                    ${rows.map((r, idx) => `<circle cx="${xFor(times[idx]).toFixed(1)}" cy="${yFor(values[idx]).toFixed(1)}" r="4" fill="#FFC107" stroke="#582C83" stroke-width="2"><title>${htmlSafe(r.quotedAt || '')}: ${fmtTick(values[idx])}/${unit}</title></circle>`).join('')}
                </svg>
            `;
        }
        function renderMarketTrendBody(category, range = 'day') {
            const cat = String(category || '').trim();
            const trend = getMarketTrendRecords(cat, range);
            const summary30 = getMarketPriceSummary(cat, { days: 30 });
            const rows = [...trend.records].reverse();
            const modal = document.getElementById('market-trend-modal');
            if (modal) {
                modal.dataset.category = cat;
                modal.dataset.range = trend.range;
            }
            document.getElementById('market-trend-title').textContent = `${cat} Market Trend`;
            document.getElementById('market-trend-subtitle').textContent = `Unit /${trend.unit} | ${marketRangeLabel(trend.range)} | ${trend.records.length} in range | ${trend.allRecords.length} total`;
            const rangeButtons = ['day', 'month', 'year'].map(mode => {
                const active = trend.range === mode;
                return `<button type="button" onclick="setMarketTrendRange('${mode}')" class="px-3 py-1.5 rounded-lg text-xs font-black border ${active ? 'bg-purple-700 text-white border-purple-700' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}">${marketRangeLabel(mode).split(' · ')[0]}</button>`;
            }).join('');
            document.getElementById('market-trend-body').innerHTML = `
                <div class="flex flex-wrap justify-between items-center gap-3 mb-4">
                    <div class="flex gap-2">${rangeButtons}</div>
                    <div class="text-[11px] font-bold text-slate-400">Chart display follows Price List: ${getPriceListCurrencyPriority()}</div>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                    <div class="border border-slate-100 rounded-xl p-3"><div class="text-[10px] uppercase font-black text-slate-400">30D Avg</div><div class="font-black text-slate-800 mt-1">${summary30.records.length ? formatMarketPrice(summary30.avgCny, summary30.unit, getPriceListCurrencyPriority()) : '-'}</div></div>
                    <div class="border border-slate-100 rounded-xl p-3"><div class="text-[10px] uppercase font-black text-slate-400">Current FX</div><div class="font-black text-slate-800 mt-1">1 MYR = ${getSalesOutRateCnyPerMyr().toFixed(4)} CNY</div></div>
                    <div class="border border-slate-100 rounded-xl p-3"><div class="text-[10px] uppercase font-black text-slate-400">Latest</div><div class="font-black text-slate-800 mt-1">${trend.latest ? formatMarketPrice(trend.latest.priceCny, trend.latest.unit || trend.unit, getPriceListCurrencyPriority()) : '-'}</div></div>
                </div>
                <div class="mb-4">${renderMarketLineChart(trend.records, { currency: getPriceListCurrencyPriority(), unit: trend.unit })}</div>
                <div class="overflow-x-auto border border-slate-100 rounded-xl">
                    <table class="w-full text-left whitespace-nowrap">
                        <thead class="bg-slate-50"><tr class="text-[10px] font-black uppercase text-slate-400"><th class="py-3 px-4">Date</th><th class="py-3 px-4 text-right">Original</th><th class="py-3 px-4 text-right">CNY</th><th class="py-3 px-4">Note</th><th class="py-3 px-4 text-right">Actions</th></tr></thead>
                        <tbody class="divide-y divide-slate-50 text-sm">
                            ${rows.length ? rows.map(r => `
                                <tr id="market-record-row-${htmlSafe(r.id)}">
                                    <td class="py-3 px-4 font-bold text-slate-700">${htmlSafe(r.quotedAt || '-')}</td>
                                    <td class="py-3 px-4 text-right font-mono">${r.currency === 'MYR' ? 'RM ' : '¥'}${(parseFloat(r.price) || 0).toFixed(4)}/${htmlSafe(r.unit || trend.unit)}</td>
                                    <td class="py-3 px-4 text-right font-mono">${formatMarketPrice(r.priceCny, r.unit || trend.unit, 'CNY')}</td>
                                    <td class="py-3 px-4 text-xs text-slate-500">${htmlSafe(r.note || '-')}</td>
                                    <td class="py-3 px-4 text-right">
                                        <button type="button" onclick="editMarketPriceRecord('${htmlSafe(r.id)}')" class="text-xs font-black text-purple-700 hover:underline mr-3">Edit</button>
                                        <button type="button" onclick="removeMarketPriceRecord('${htmlSafe(r.id)}')" class="text-xs font-black text-red-600 hover:underline">Delete</button>
                                    </td>
                                </tr>
                            `).join('') : `<tr><td colspan="5" class="py-8 text-center text-sm text-slate-400">No market price records in this range.</td></tr>`}
                        </tbody>
                    </table>
                </div>
            `;
        }
        window.openMarketTrendModal = (category) => {
            const cat = String(category || '').trim();
            if (!cat) return;
            let modal = document.getElementById('market-trend-modal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'market-trend-modal';
                modal.className = 'fixed inset-0 z-[220] hidden items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4';
                modal.innerHTML = `
                    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
                        <div class="p-5 border-b border-slate-100 flex items-center justify-between gap-3">
                            <div><h3 id="market-trend-title" class="text-lg font-black text-slate-800">Market Trend</h3><p id="market-trend-subtitle" class="text-xs text-slate-400 mt-1"></p></div>
                            <button onclick="closeMarketTrendModal()" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-xs font-black hover:bg-slate-200">Close</button>
                        </div>
                        <div id="market-trend-body" class="p-5 overflow-y-auto"></div>
                    </div>
                `;
                document.body.appendChild(modal);
            }
            renderMarketTrendBody(cat, 'day');
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        };
        window.setMarketTrendRange = (range) => {
            const modal = document.getElementById('market-trend-modal');
            const cat = modal?.dataset?.category || '';
            if (cat) renderMarketTrendBody(cat, range);
        };
        window.editMarketPriceRecord = (id) => {
            const recordId = String(id || '').trim();
            marketPrices = normalizeMarketPrices(marketPrices);
            const r = marketPrices.records.find(x => String(x.id) === recordId);
            const row = document.getElementById(`market-record-row-${recordId}`);
            if (!r || !row) return;
            row.innerHTML = `
                <td class="py-3 px-4"><input id="market-edit-date-${htmlSafe(recordId)}" type="date" value="${htmlSafe(r.quotedAt || '')}" class="border border-slate-200 rounded-lg px-2 py-1 text-xs"></td>
                <td class="py-3 px-4 text-right">
                    <div class="flex justify-end gap-2">
                        <select id="market-edit-currency-${htmlSafe(recordId)}" class="border border-slate-200 rounded-lg px-2 py-1 text-xs"><option value="CNY" ${r.currency === 'CNY' ? 'selected' : ''}>CNY ¥</option><option value="MYR" ${r.currency === 'MYR' ? 'selected' : ''}>MYR RM</option></select>
                        <input id="market-edit-price-${htmlSafe(recordId)}" type="number" step="0.0001" min="0" value="${htmlSafe(r.price)}" class="w-28 border border-slate-200 rounded-lg px-2 py-1 text-xs text-right font-mono">
                    </div>
                </td>
                <td class="py-3 px-4 text-right">
                    <select id="market-edit-unit-${htmlSafe(recordId)}" class="border border-slate-200 rounded-lg px-2 py-1 text-xs">
                        ${['W', 'kW', 'kWh', 'pcs', 'set', '件'].map(u => `<option value="${u}" ${normalizeUnitLabel(r.unit) === u ? 'selected' : ''}>/${u}</option>`).join('')}
                    </select>
                </td>
                <td class="py-3 px-4"><input id="market-edit-note-${htmlSafe(recordId)}" type="text" value="${htmlSafe(r.note || '')}" class="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs"></td>
                <td class="py-3 px-4 text-right">
                    <button type="button" onclick="saveMarketPriceRecordEdit('${htmlSafe(recordId)}')" class="text-xs font-black text-green-700 hover:underline mr-3">Save</button>
                    <button type="button" onclick="setMarketTrendRange(document.getElementById('market-trend-modal')?.dataset?.range || 'day')" class="text-xs font-black text-slate-500 hover:underline">Cancel</button>
                </td>
            `;
        };
        window.saveMarketPriceRecordEdit = (id) => {
            const recordId = String(id || '').trim();
            try {
                updateMarketPriceRecord(recordId, {
                    quotedAt: document.getElementById(`market-edit-date-${recordId}`)?.value || '',
                    currency: document.getElementById(`market-edit-currency-${recordId}`)?.value || 'CNY',
                    price: parseFloat(document.getElementById(`market-edit-price-${recordId}`)?.value || '0') || 0,
                    unit: document.getElementById(`market-edit-unit-${recordId}`)?.value || '',
                    note: document.getElementById(`market-edit-note-${recordId}`)?.value || '',
                    rateCnyPerMyr: getSalesOutRateCnyPerMyr()
                });
                saveToLocal();
                persistMarketPricesToD1();
                renderPriceList();
                const modal = document.getElementById('market-trend-modal');
                renderMarketTrendBody(modal?.dataset?.category || '', modal?.dataset?.range || 'day');
                showToast('市场价已更新', 'success');
            } catch (e) {
                alert(e?.message || '市场价更新失败');
            }
        };
        window.removeMarketPriceRecord = (id) => {
            const recordId = String(id || '').trim();
            if (!recordId || !confirm('Delete this market price record?')) return;
            deleteMarketPriceRecord(recordId);
            saveToLocal();
            deleteEntityFromD1('market_price', recordId);
            persistMarketPricesToD1();
            renderPriceList();
            const modal = document.getElementById('market-trend-modal');
            renderMarketTrendBody(modal?.dataset?.category || '', modal?.dataset?.range || 'day');
            showToast('市场价已Delete', 'success');
        };
        window.closeMarketTrendModal = () => {
            const modal = document.getElementById('market-trend-modal');
            if (modal) {
                modal.classList.add('hidden');
                modal.classList.remove('flex');
            }
        };
        window.renderPriceList = () => {
            ensureSupplierData();
            renderPriceListFilters();
            renderMarketPriceForm();
            const currencyBtn = document.getElementById('price-list-currency-toggle');
            if (currencyBtn) currencyBtn.textContent = getPriceListCurrencyPriority() === 'MYR' ? 'RM / ¥' : '¥ / RM';
            const body = document.getElementById('price-list-body');
            const summary = document.getElementById('price-list-summary');
            if (!body) return;
            const rows = getFilteredPriceListProducts();
            currentPriceListVisibleIds = rows.map(p => p.id).filter(Boolean);
            const selectedPriceLabel = getPriceListSelectedPriceLabel();
            if (summary) summary.textContent = `${rows.length} of ${products.length} products | PCS Price: ${selectedPriceLabel} | Display ${getPriceListCurrencyPriority()} first | Rate: 1 MYR = ${getSalesOutRateCnyPerMyr().toFixed(4)} CNY`;
            if (!rows.length) {
                body.innerHTML = `<tr><td colspan="15" class="py-12 text-center text-slate-400 text-sm">No products match the current filters.</td></tr>`;
                updatePriceListSelectionUi();
                window.applyFrozenColumns('price-list');
                return;
            }
            body.innerHTML = rows.map(p => {
                const req = getProductCertificationRequirements(p);
                const certRecords = productCertificationSelectedRecords(p);
                const pricing = priceListProductPricing(p);
                const homeProfit = Number.isFinite(parseFloat(pricing.homeProfitPct)) ? parseFloat(pricing.homeProfitPct) : ((pricing.cnHomePct || 0) + (pricing.myHomePct || 0));
                const bizProfit = Number.isFinite(parseFloat(pricing.bizProfitPct)) ? parseFloat(pricing.bizProfitPct) : ((pricing.cnBizPct || 0) + (pricing.myBizPct || 0));
                const categories = [...new Set(certRecords.map(record => record.sourceCategory).filter(Boolean))].map(priceListCountryLabel).join(', ');
                const certStandards = certRecords.map(record => record.standard || record.id);
                const certBrief = certRecords.length ? `${certRecords.length} records` : (req.standards || []).slice(0, 3).join(', ');
                const certTitle = [
                    ...certRecords.map(record => `${record.id} · ${record.standard} · ${record.requirementLevel}`),
                    ...(req.standards || [])
                ].join('\n');
                const checked = selectedPriceListProductIds.has(p.id) ? 'checked' : '';
                const selectedPcsPrice = getPriceListSelectedPcsPrice(pricing);
                return `
                    <tr class="hover:bg-purple-50/40 transition-colors" onmousemove="showPriceListTooltip(event, '${htmlSafe(p.id)}')" onmouseleave="hidePriceListTooltip()">
                        <td class="py-4 px-4 text-center"><input type="checkbox" class="price-list-row-check h-4 w-4 accent-purple-700" value="${htmlSafe(p.id)}" ${checked} onchange="togglePriceListProduct('${htmlSafe(p.id)}', this.checked)"></td>
                        <td class="py-4 px-4">
                            <div class="font-black text-slate-800 text-sm">${htmlSafe(p.name || '-')}</div>
                            <div class="text-[10px] font-mono text-slate-400">${htmlSafe(p.id || '-')} | ${htmlSafe(getProductDisplaySpec(p) || '-')} | ${htmlSafe(pricing.pricingMeta?.label || '')} | Stock ${formatNumberAuto(pricing.stockQty, 4)}</div>
                        </td>
                        <td class="py-4 px-4 text-xs text-slate-600">${htmlSafe(p.category || '-')}<div class="text-[10px] text-slate-400">${htmlSafe(p.scenario || '-')}</div></td>
                        <td class="py-4 px-4 text-xs text-slate-600">${htmlSafe(getProductSupplierDisplay(p))}</td>
                        <td class="py-4 px-4 text-right">${renderDualCurrencyAmount(selectedPcsPrice, 2, 'pcs')}<div class="text-[10px] text-slate-400">${htmlSafe(selectedPriceLabel)} × ${htmlSafe(pricing.pricingMeta?.label || `${formatNumberAuto(pricing.pcsMultiplier, 4)} ${pricing.costUnit}/pcs`)}</div></td>
                        <td class="py-4 px-4 text-right">${renderDualCurrencyAmount(pricing.pcsCost, 4, 'pcs')}<div class="text-[10px] text-slate-400">${htmlSafe(pricing.pricingMeta?.label || `${formatNumberAuto(pricing.pcsMultiplier, 4)} ${pricing.costUnit}/pcs`)}</div></td>
                        <td class="py-4 px-4 text-right">${renderDualCurrencyAmount(pricing.avgCost, 4, pricing.costUnit)}<div class="text-[10px] text-slate-400">${pricing.usedInventoryCost ? 'Inventory avg' : 'Base cost fallback'}</div></td>
                        <td class="py-4 px-4 text-right">${renderMarketSummaryCell(p.category || '')}</td>
                        <td class="py-4 px-4 text-right font-black text-green-700">${homeProfit.toFixed(2)}%</td>
                        <td class="py-4 px-4 text-right font-black text-blue-700">${bizProfit.toFixed(2)}%</td>
                        <td class="py-4 px-4 text-right">${renderPriceCell(pricing.clearanceHomePrice, pricing.clearanceCost, pricing.costUnit)}</td>
                        <td class="py-4 px-4 text-right">${renderPriceCell(pricing.clearanceBizPrice, pricing.clearanceCost, pricing.costUnit)}</td>
                        <td class="py-4 px-4 text-right">${renderPriceCell(pricing.grayHomePrice, pricing.grayCost, pricing.costUnit)}</td>
                        <td class="py-4 px-4 text-right">${renderPriceCell(pricing.grayBizPrice, pricing.grayCost, pricing.costUnit)}</td>
                        <td class="py-4 px-4 text-xs text-slate-500 max-w-[220px] truncate" title="${htmlSafe(certTitle)}">${htmlSafe(certBrief || '-')}<div class="text-[10px] text-slate-400">${htmlSafe(categories || certStandards.slice(0, 2).join(', ') || '-')}</div></td>
                    </tr>
                `;
            }).join('');
            updatePriceListSelectionUi();
            window.applyFrozenColumns('price-list');
        };
        window.togglePriceListCurrency = () => {
            window.priceListDisplayCurrency = getPriceListCurrencyPriority() === 'MYR' ? 'CNY' : 'MYR';
            renderPriceList();
        };
        window.updatePriceListSelectionUi = () => {
            const countEl = document.getElementById('price-list-selected-count');
            if (countEl) countEl.textContent = `${selectedPriceListProductIds.size} selected`;
            const selectVisible = document.getElementById('price-list-select-visible');
            if (selectVisible) {
                const visible = currentPriceListVisibleIds.filter(Boolean);
                selectVisible.checked = visible.length > 0 && visible.every(id => selectedPriceListProductIds.has(id));
                selectVisible.indeterminate = visible.some(id => selectedPriceListProductIds.has(id)) && !selectVisible.checked;
            }
        };
        window.togglePriceListProduct = (id, checked) => {
            if (checked) selectedPriceListProductIds.add(id);
            else selectedPriceListProductIds.delete(id);
            updatePriceListSelectionUi();
        };
        window.togglePriceListVisibleSelection = (checked) => {
            currentPriceListVisibleIds.forEach(id => {
                if (checked) selectedPriceListProductIds.add(id);
                else selectedPriceListProductIds.delete(id);
            });
            renderPriceList();
        };
        window.clearPriceListFilters = () => {
            ['price-list-search', 'price-list-category-filter', 'price-list-brand-filter', 'price-list-country-filter', 'price-list-cert-filter'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
            renderPriceList();
        };
        function priceVarianceClass(value, benchmark) {
            const v = parseFloat(value);
            const b = parseFloat(benchmark);
            if (!Number.isFinite(v) || !Number.isFinite(b) || b <= 0) return 'text-slate-200';
            const diff = (v - b) / b;
            if (diff >= 0.3) return 'text-green-300 font-black';
            if (diff >= 0.15) return 'text-green-400 font-black';
            if (diff >= 0.05) return 'text-green-500 font-bold';
            if (diff > -0.05) return 'text-slate-100 font-bold';
            if (diff > -0.15) return 'text-red-300 font-bold';
            if (diff > -0.3) return 'text-red-400 font-black';
            return 'text-red-500 font-black';
        }
        function renderPriceListTooltipPrice(value, unit, benchmark, digits = 2) {
            const n = parseFloat(value);
            if (!Number.isFinite(n)) return '<span class="text-slate-500">-</span>';
            return `<span class="${priceVarianceClass(n, benchmark)}">${formatCurrencyFromCny(n, getPriceListCurrencyPriority(), digits)}/${htmlSafe(unit)}</span>`;
        }
        function renderPriceListTooltipComparison(product, pricing, market) {
            const marketUnit = normalizeUnitLabel(market?.unit || pricing.costUnit || 'pcs');
            const marketUnitPrice = market?.records?.length ? parseFloat(market.avgCny) : NaN;
            const marketPcsMultiplier = getProductSpecMultiplierForUnit(product, pricing.pcsMultiplier, marketUnit);
            const marketPcsPrice = Number.isFinite(marketUnitPrice) ? marketUnitPrice * marketPcsMultiplier : NaN;
            const quoteUnit = normalizeUnitLabel(pricing.costUnit || marketUnit);
            const quotePcsMultiplier = Number.isFinite(parseFloat(pricing.pcsMultiplier)) ? parseFloat(pricing.pcsMultiplier) : 1;
            const quoteRows = [
                ['Clearance RESI', pricing.clearanceHomePrice],
                ['Clearance C&I', pricing.clearanceBizPrice],
                ['Grey RESI', pricing.grayHomePrice],
                ['Grey C&I', pricing.grayBizPrice]
            ];
            const marketUnitHtml = Number.isFinite(marketUnitPrice)
                ? `${formatCurrencyFromCny(marketUnitPrice, getPriceListCurrencyPriority(), 4)}/${htmlSafe(marketUnit)}`
                : 'No 30-day market price';
            const marketPcsHtml = Number.isFinite(marketPcsPrice)
                ? `${formatCurrencyFromCny(marketPcsPrice, getPriceListCurrencyPriority(), 2)}/pcs`
                : '-';
            return `
                <div class="mt-2 rounded-lg overflow-hidden border border-slate-700">
                    <div class="grid grid-cols-3 bg-slate-900/80 text-[10px] font-black uppercase tracking-widest text-slate-400">
                        <div class="px-2 py-1.5">Item</div>
                        <div class="px-2 py-1.5 text-right">Unit Price</div>
                        <div class="px-2 py-1.5 text-right">PCS Price</div>
                    </div>
                    <div class="grid grid-cols-3 border-t border-slate-700 text-[11px]">
                        <div class="px-2 py-1.5 text-amber-200 font-black">30D Market</div>
                        <div class="px-2 py-1.5 text-right text-amber-100">${marketUnitHtml}</div>
                        <div class="px-2 py-1.5 text-right text-amber-100">${marketPcsHtml}</div>
                    </div>
                    ${quoteRows.map(([label, unitPrice]) => {
                        const unit = parseFloat(unitPrice);
                        const pcs = Number.isFinite(unit) ? unit * quotePcsMultiplier : NaN;
                        return `
                            <div class="grid grid-cols-3 border-t border-slate-700 text-[11px]">
                                <div class="px-2 py-1.5 text-slate-200 font-bold">${htmlSafe(label)}</div>
                                <div class="px-2 py-1.5 text-right">${renderPriceListTooltipPrice(unit, quoteUnit, marketUnitPrice, 4)}</div>
                                <div class="px-2 py-1.5 text-right">${renderPriceListTooltipPrice(pcs, 'pcs', marketPcsPrice, 2)}</div>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        }
        window.showPriceListTooltip = (event, productId) => {
            const tooltip = document.getElementById('global-tooltip');
            const p = products.find(x => String(x.id) === String(productId));
            if (!tooltip || !p) {
                window.hideGlobalTooltip?.();
                return;
            }
            const r = priceListProductPricing(p);
            const market = getMarketPriceSummary(p.category || '', { days: 30 });
            tooltip.innerHTML = `
                <p class="font-black text-sm mb-2 border-b border-slate-600 pb-1">${htmlSafe(p.name || '-')}</p>
                ${renderPriceListTooltipComparison(p, r, market)}
            `;
            tooltip.style.width = 'auto';
            tooltip.style.maxWidth = `${Math.max(320, Math.min(560, window.innerWidth - 24))}px`;
            tooltip.classList.remove('hidden');
            const tooltipWidth = tooltip.offsetWidth || Math.min(560, window.innerWidth - 24);
            const tooltipHeight = tooltip.offsetHeight || 220;
            const gap = 14;
            const rightSpace = window.innerWidth - event.clientX;
            const belowSpace = window.innerHeight - event.clientY;
            const aboveSpace = event.clientY;
            const shouldOpenLeft = rightSpace < tooltipWidth + gap && event.clientX > tooltipWidth + gap;
            const shouldOpenUp = belowSpace < tooltipHeight + 18 && aboveSpace > belowSpace;
            const rawLeft = shouldOpenLeft ? event.clientX - tooltipWidth - gap : event.clientX + gap;
            const rawTop = shouldOpenUp ? event.clientY - tooltipHeight - gap : event.clientY + gap;
            tooltip.style.left = `${Math.max(12, Math.min(rawLeft, window.innerWidth - tooltipWidth - 12))}px`;
            tooltip.style.top = `${Math.max(12, Math.min(rawTop, window.innerHeight - tooltipHeight - 12))}px`;
        };
        window.hidePriceListTooltip = window.hideGlobalTooltip;
        window.exportSelectedPriceListExcel = () => {
            const selected = products.filter(p => selectedPriceListProductIds.has(p.id));
            if (!selected.length) return alert('Please select at least one product to export.');
            const rows = selected.map(p => {
                const r = priceListProductPricing(p);
                const req = getProductCertificationRequirements(p);
                const certRecords = productCertificationSelectedRecords(p);
                const evidence = productCertificationEvidenceFor(p.id || '');
                const market = getMarketPriceSummary(p.category || '', { days: 30 });
                const homeProfit = Number.isFinite(parseFloat(r.homeProfitPct)) ? parseFloat(r.homeProfitPct) : ((r.cnHomePct || 0) + (r.myHomePct || 0));
                const bizProfit = Number.isFinite(parseFloat(r.bizProfitPct)) ? parseFloat(r.bizProfitPct) : ((r.cnBizPct || 0) + (r.myBizPct || 0));
                const selectedPriceLabel = getPriceListSelectedPriceLabel();
                const selectedPcsPrice = getPriceListSelectedPcsPrice(r);
                const out = {
                    'Product ID': p.id || '',
                    'Product Name': p.name || '',
                    'Category': p.category || '',
                    'Subcategory': p.scenario || '',
                    'Brand': getProductSupplierDisplay(p),
                    'Spec': getProductDisplaySpec(p) || '',
                    'Stock Qty': r.stockQty || 0,
                    'Selected PCS Price Type': selectedPriceLabel,
                    'PCS Price CNY': selectedPcsPrice || 0,
                    'PCS Price MYR': (selectedPcsPrice || 0) / getSalesOutRateCnyPerMyr(),
                    'Avg Cost Unit': r.costUnit,
                    'Avg Cost CNY': r.avgCost || 0,
                    'Avg Cost MYR': (r.avgCost || 0) / getSalesOutRateCnyPerMyr(),
                    'PCS Cost CNY': r.pcsCost || 0,
                    'PCS Cost MYR': (r.pcsCost || 0) / getSalesOutRateCnyPerMyr(),
                    'PCS Multiplier': r.pcsMultiplier || 1,
                    'Market Unit': market.unit,
                    '30D Market Avg CNY': market.records.length ? market.avgCny : '',
                    '30D Market Avg MYR': market.records.length ? market.avgCny / getSalesOutRateCnyPerMyr() : '',
                    'Latest Market CNY': market.latest ? market.latest.priceCny : '',
                    'RESI Profit %': homeProfit,
                    'C&I Profit %': bizProfit,
                    'Clearance RESI CNY': r.clearanceHomePrice || 0,
                    'Clearance RESI MYR': (r.clearanceHomePrice || 0) / getSalesOutRateCnyPerMyr(),
                    'Clearance C&I CNY': r.clearanceBizPrice || 0,
                    'Clearance C&I MYR': (r.clearanceBizPrice || 0) / getSalesOutRateCnyPerMyr(),
                    'Grey RESI CNY': r.grayHomePrice || 0,
                    'Grey RESI MYR': (r.grayHomePrice || 0) / getSalesOutRateCnyPerMyr(),
                    'Grey C&I CNY': r.grayBizPrice || 0,
                    'Grey C&I MYR': (r.grayBizPrice || 0) / getSalesOutRateCnyPerMyr(),
                    'Formula Note': `Clearance cost = Avg Cost * (1 + duty ${r.dutyPct}% + SST ${r.sstPct}%); Grey cost = Avg Cost * (1 + grey tax ${r.grayPct}%); RESI profit = ${(r.homeProfitPct || 0).toFixed(2)}%; C&I profit = ${(r.bizProfitPct || 0).toFixed(2)}%; FX 1 MYR = ${getSalesOutRateCnyPerMyr().toFixed(4)} CNY`,
                    'Certification Record IDs': (req.recordIds || []).join('; '),
                    'Certification Source Categories': [...new Set(certRecords.map(record => record.sourceCategory).filter(Boolean))].map(priceListCountryLabel).join(', '),
                    'Certification Standards': [...certRecords.map(record => record.standard || record.id), ...(req.standards || [])].join('; '),
                    'Certification Evidence Files': evidence.reduce((sum, item) => sum + (Array.isArray(item.fileRefs) ? item.fileRefs.length : 0), 0)
                };
                return out;
            });
            const worksheet = XLSX.utils.json_to_sheet(rows);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Price List');
            XLSX.writeFile(workbook, 'Minova_Product_Price_List.xlsx');
        };
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
                    const label = `${id}（Inventory ${qty}）${p.name ? ` - ${p.name}` : ''}`;
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
            if (metaEl) metaEl.textContent = p ? `${p.category || '-'} / ${p.scenario || '-'} | ${getProductSupplierDisplay(p)}` : '-';
            const total = getTotalStockQty(productId);
            if (totalEl) totalEl.textContent = String(total || 0);

            if (breakdownEl) {
                const batches = getFifoBatchesForProduct(productId);
                const spec = batches.length ? (Number.isFinite(parseFloat(batches[0].spec)) ? parseFloat(batches[0].spec) : 1) : 1;
                if (specEl) specEl.value = String(spec);
                const lines = batches.slice(0, 3).map(b => `Batch ${b.batchNo || '-'} | ${b.purchaseDate || '-'} | ${productListDisplayText(b.location || 'Unspecified Location')} | Inventory ${b.quantity}`);
                if (batches.length > 3) lines.push(`... ${batches.length - 3} more batches`);
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
            if (homeProfitEl) homeProfitEl.value = (Number.isFinite(parseFloat(r.homeProfitPct)) ? parseFloat(r.homeProfitPct) : ((r.cnHomePct || 0) + (r.myHomePct || 0))).toFixed(2);
            if (bizProfitEl) bizProfitEl.value = (Number.isFinite(parseFloat(r.bizProfitPct)) ? parseFloat(r.bizProfitPct) : ((r.cnBizPct || 0) + (r.myBizPct || 0))).toFixed(2);
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
                if (previewEl) previewEl.innerHTML = `<div class="text-red-600 font-black">Insufficient inventory: short ${remaining}</div>` + (previewEl.innerHTML || '');
            }
        };
        window.confirmSalesOut = () => {
            const editingId = String(window.salesOutEditingRecordId || '').trim();
            const editingIdx = editingId ? salesRecords.findIndex(r => r.id === editingId) : -1;
            const editingPrev = editingIdx >= 0 ? salesRecords[editingIdx] : null;

            const productId = String(document.getElementById('sales-out-product-id')?.value || '').trim();
            if (!productId) return alert('Select a product ID.');
            const p = products.find(x => x.id === productId) || {};
            const productName = p.name || 'Unknown Product';
            const outDate = String(document.getElementById('sales-out-date')?.value || '').trim();
            const qty = parseInt(document.getElementById('sales-out-qty')?.value || '0', 10) || 0;
            if (qty <= 0) return alert('Enter a valid stock-out quantity.');

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
                    return alert('This sales record has no batch allocation details, so the stock-out quantity cannot be edited. Only contract, staff, and pricing fields can be edited.');
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
                    note: `Edit Sales Out (inventory not rolled back) | Stock-Out Date: ${outDate || '-'} | Contract: ${contractNo || '-'} | Price Type: ${priceType} ¥${unitPriceCny.toFixed(2)} | Contract Total: ¥${finalPriceCny.toFixed(2)} | Salesperson: ${salesperson || '-'}`
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
                persistInventoryStateToD1();
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
                return alert('Insufficient inventory.');
            }

            for (const a of allocations) {
                const item = inventory.find(i => i.id === a.id);
                if (!item) continue;
                item.quantity = (parseInt(item.quantity, 10) || 0) - (parseInt(a.qty, 10) || 0);
            }

            const allocLines = formatAllocationsPreview(allocations, 3).join('; ');
            const note = `Stock-Out Type: Sales Out | Stock-Out Date: ${outDate || '-'} | Contract: ${contractNo || '-'} | Price Type: ${priceType} ¥${unitPriceCny.toFixed(2)} | Contract Total: ¥${finalPriceCny.toFixed(2)} | Salesperson: ${salesperson || '-'} | Taxes: Freight ${shippingRatePct.toFixed(1)}% / Domestic Tax ${domesticTaxRatePct.toFixed(1)}% / Duty ${dutyPct.toFixed(1)}% / SST ${sstPct.toFixed(1)}% / Gray ${grayPct.toFixed(1)}% | Allocation: ${allocLines || '-'}`;
            if (editingPrev) {
                pushInventoryHistory({
                    ts: Date.now(),
                    type: 'modify',
                    productId,
                    productName,
                    quantity: qty,
                    batchNo: '',
                    note: `EditSales Out | ${note}`
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
                vendor: getProductSupplierDisplay(p),
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

            archiveZeroQtyInventoryItems(`Sales Out | Contract: ${contractNo || '-'} | Price Type: ${priceType}`);

            if (salesperson) {
                const list = getSalespeopleList();
                if (!list.includes(salesperson)) {
                    list.unshift(salesperson);
                    saveSalespeopleList(list.slice(0, 100));
                }
            }
            saveToLocal();
            persistInventoryStateToD1();
            closeSalesOutModal();
        };

        window.deleteInventoryItem = (id) => {
            const item = inventory.find(i => i.id === id);
            if(!item) return;
            if(confirm('Delete this stock-in record? The deletion will be recorded in history.')) {
                const product = products.find(p => p.id === item.productId) || {};
                pushInventoryHistory({
                    ts: Date.now(),
                    type: 'delete',
                    productId: item.productId,
                    productName: product.name || 'Unknown Product',
                    quantity: item.quantity,
                    batchNo: item.batchNo,
                    note: `Delete Stock-In Record | Batch ${item.batchNo || '-'}`
                });
                inventory = inventory.filter(i => i.id !== id);
                saveToLocal();
                deleteEntityFromD1('inventory', id);
                persistInventoryStateToD1();
            }
        };
        window.openModal = () => {
            ensureSupplierData();
            if (!suppliers.length) {
                alert('Please add a supplier before creating a product record.');
                openSupplierModal();
                return;
            }
            updateSupplierSelects(window.editId ? (products.find(p => p.id === window.editId)?.supplierCode || '') : '');
            updateProductCurrencyFromSupplier({ skipExisting: true });
            if (!window.editId) {
                renderProductModalClassificationHistoryFields('', '');
                renderProductModalSpecHistoryFields({ category: '' });
            }
            updateSubcatSuggestions();
            if (!window.editId) {
                fillProductMasterDetails({});
                fillProductSourcingDetails({ supplierCode: document.getElementById('m-supplier-code')?.value || '' });
                renderProductTechnicalFields(document.getElementById('m-category')?.value || '');
                ['tuv', 'specs'].forEach(type => {
                    const list = document.getElementById(`product-${type}-list`);
                    const empty = document.getElementById(`product-${type}-empty`);
                    if (list) list.innerHTML = '';
                    if (empty) empty.classList.remove('hidden');
                });
                window.__productImageDraft = '';
                renderProductImagePreview();
                const textarea = document.getElementById('m-cert-requirements');
                if (textarea) textarea.value = '';
                window.applyDefaultProductCertifications?.();
            }
            document.getElementById('modal').classList.remove('hidden');
        };
        window.closeModal = () => {
            document.getElementById('modal').classList.add('hidden');
            window.editId = null;
            ['m-name', 'm-category', 'm-supplier-code', 'm-spec', 'm-inverter-kw', 'm-battery-kwh', 'm-scenario', 'm-warranty-years', 'm-warranty-cycles', 'm-lead-time', 'm-contact', 'm-contact-info', 'm-price-basis-unit', 'm-unit-qty-per-pcs', 'm-cost', 'm-price', 'm-cert-requirements', 'm-source-type', 'm-commercial-supplier-code', 'm-factory-supplier-code', 'm-brand-owner-supplier-code', 'm-authorization-status', 'm-authorization-expiry', 'm-source-remark', ...PRODUCT_MASTER_COMMON_FIELD_KEYS.map(key => `m-master-${key}`)].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
            renderProductTechnicalFields('');
            renderProductModalSpecHistoryFields({ category: '', spec: '', inverterKw: '', batteryKwh: '' });
            const currencyEl = document.getElementById('m-price-currency');
            if (currencyEl) currencyEl.value = 'CNY';
            updateProductPriceCurrencyUi();
            renderProductModalClassificationHistoryFields('', '');
            renderProductModalSpecHistoryFields({ category: '', spec: '', inverterKw: '', batteryKwh: '' });
            fillProductMasterDetails({});
            renderProductCertificationRecordPicker({}, []);
            window.__productImageDraft = '';
            const fileEl = document.getElementById('m-product-image-file');
            if (fileEl) fileEl.value = '';
            renderProductImagePreview();
        };
        window.saveProduct = () => {
            const category = normalizeProductCategory(document.getElementById('m-category').value, 'Uncategorized');
            const supplierCode = normalizeSupplierCode(document.getElementById('m-supplier-code')?.value || '');
            const supplier = getSupplierByCode(supplierCode);
            if (!supplier) return alert('Please select a supplier from Supplier Master Data.');
            const productCurrency = normalizeProductPriceCurrency(document.getElementById('m-price-currency')?.value || inferSupplierPriceCurrency(supplier));
            const hybrid = isHybridStorageCategory(category);
            const hybridSpec = hybrid ? formatHybridStorageSpec({
                inverterKw: document.getElementById('m-inverter-kw')?.value,
                batteryKwh: document.getElementById('m-battery-kwh')?.value
            }) : '';
            const pricingDraft = getProductPricingMeta({
                category,
                spec: hybridSpec || document.getElementById('m-spec').value,
                priceBasisUnit: document.getElementById('m-price-basis-unit')?.value || '',
                unitQtyPerPcs: document.getElementById('m-unit-qty-per-pcs')?.value || ''
            });
            const certificationDraft = readProductCertificationRequirementsFromModal();
            const data = {
                id: window.editId || generateNextId(category),
                name: document.getElementById('m-name').value,
                category: category,
                supplierCode: supplier.code,
                vendor: getSupplierDisplayName(supplier),
                spec: hybridSpec || document.getElementById('m-spec').value,
                inverterKw: hybrid ? (parseFloat(document.getElementById('m-inverter-kw')?.value) || 0) : undefined,
                batteryKwh: hybrid ? (parseFloat(document.getElementById('m-battery-kwh')?.value) || 0) : undefined,
                priceBasisUnit: normalizePricingUnit(document.getElementById('m-price-basis-unit')?.value || pricingDraft.priceBasisUnit),
                unitQtyPerPcs: parseFloat(document.getElementById('m-unit-qty-per-pcs')?.value) || pricingDraft.unitQtyPerPcs,
                scenario: normalizeProductSubcategory(document.getElementById('m-scenario').value),
                warrantyYears: document.getElementById('m-warranty-years').value,
                warrantyCycles: document.getElementById('m-warranty-cycles').value,
                leadTime: document.getElementById('m-lead-time').value,
                contact: document.getElementById('m-contact').value,
                contactInfo: document.getElementById('m-contact-info').value,
                cost: parseFloat(document.getElementById('m-cost').value) || 0,
                costCurrency: productCurrency,
                price: parseFloat(document.getElementById('m-price').value) || 0,
                priceCurrency: productCurrency,
                sourcing: readProductSourcingFromModal(supplier.code),
                masterData: readProductMasterDataFromModal(),
                technicalSpecs: readProductTechnicalSpecsFromModal(category),
                certificationRequirementIds: certificationDraft.recordIds,
                certificationRequirements: certificationDraft,
                productImageDataUrl: String(window.__productImageDraft || ''),
                ts: Date.now()
            };
            // For existing products, preserve existing certifications
            if (window.editId) {
                const existing = products.find(p => p.id === window.editId);
                if (existing?.certifications) {
                    data.certifications = existing.certifications;
                }
            }
            // Ensure the certifications field exists.
            if (!data.certifications) {
                data.certifications = { tuvCerts: [], specSheets: [] };
            }
            if (!Object.keys(data.sourcing || {}).length || (data.sourcing.sourceType === 'Unknown' && !data.sourcing.factorySupplierCode && !data.sourcing.brandOwnerSupplierCode && !data.sourcing.authorizationStatus && !data.sourcing.authorizationExpiry && !data.sourcing.sourceRemark)) delete data.sourcing;
            if (!Object.keys(data.masterData || {}).length) delete data.masterData;
            if (!Object.keys(data.technicalSpecs || {}).length) delete data.technicalSpecs;
            if(!data.name) return alert("Please enter the product name.");
            const sub = normalizeProductSubcategory(data.scenario);
            const cat = normalizeProductCategory(data.category, 'Uncategorized');
            if (!subcategoriesByCategory[cat]) subcategoriesByCategory[cat] = [];
            if (sub && !subcategoriesByCategory[cat].includes(sub)) {
                subcategoriesByCategory[cat].push(sub);
                saveSubcategoryIndex();
            }
            const idx = products.findIndex(p => p.id === data.id);
            if(idx !== -1) products[idx] = data; else products.push(data);
            saveToLocal(); closeModal();
            persistEntityToD1('product', data.id, data);
        };
        window.editProduct = (id) => {
            const p = products.find(prod => prod.id === id);
            if(!p) return;
            window.editId = id;
            ensureSupplierData();
            document.getElementById('m-name').value = p.name || '';
            const category = p.category || '';
            renderProductModalClassificationHistoryFields(category, p.scenario || '');
            fillProductMasterDetails(p);
            renderProductTechnicalFields(category, p?.technicalSpecs || {});
            updateSupplierSelects(p.supplierCode || getProductSupplier(p)?.code || '');
            fillProductSourcingDetails(p);
            const hybridSpec = parseHybridStorageSpec(p);
            renderProductModalSpecHistoryFields({
                category,
                spec: p.spec || '',
                inverterKw: hybridSpec.inverterKw ? formatCapacityValue(hybridSpec.inverterKw) : '',
                batteryKwh: hybridSpec.batteryKwh ? formatCapacityValue(hybridSpec.batteryKwh) : ''
            });
            document.getElementById('m-spec').value = p.spec || '';
            const invEl = document.getElementById('m-inverter-kw');
            const batEl = document.getElementById('m-battery-kwh');
            if (invEl) invEl.value = hybridSpec.inverterKw ? formatCapacityValue(hybridSpec.inverterKw) : '';
            if (batEl) batEl.value = hybridSpec.batteryKwh ? formatCapacityValue(hybridSpec.batteryKwh) : '';
            updateSubcatSuggestions();
            updateHybridSpecControls();
            document.getElementById('m-scenario').value = p.scenario || '';
            document.getElementById('m-warranty-years').value = p.warrantyYears || '';
            document.getElementById('m-warranty-cycles').value = p.warrantyCycles || '';
            document.getElementById('m-lead-time').value = p.leadTime || '';
            document.getElementById('m-contact').value = p.contact || '';
            document.getElementById('m-contact-info').value = p.contactInfo || '';
            document.getElementById('m-cost').value = p.cost || 0;
            document.getElementById('m-price').value = p.price || 0;
            const pricingMeta = getProductPricingMeta(p);
            const unitEl = document.getElementById('m-price-basis-unit');
            const qtyEl = document.getElementById('m-unit-qty-per-pcs');
            if (unitEl) unitEl.value = p.priceBasisUnit ? pricingMeta.priceBasisUnit : '';
            if (qtyEl) qtyEl.value = p.unitQtyPerPcs ? pricingMeta.unitQtyPerPcs : '';
            if (document.getElementById('m-price-currency')) document.getElementById('m-price-currency').value = getProductCurrency(p, 'cost');
            updateProductPriceCurrencyUi();
            const certReq = getProductCertificationRequirements(p);
            renderProductCertificationRecordPicker(p, certReq.recordIds || []);
            const certTextarea = document.getElementById('m-cert-requirements');
            if (certTextarea) certTextarea.value = certificationText(certReq);
            const certNote = document.getElementById('m-cert-source-note');
            if (certNote) certNote.textContent = `${(certReq.recordIds || []).length} engineering records selected${certReq.updatedAt ? ` (${certReq.updatedAt})` : ''}.`;
            window.__productImageDraft = String(p.productImageDataUrl || p.imageDataUrl || '');
            renderProductImagePreview();
            openModal();
            renderProductCertsInModal();
        };
        window.deleteProduct = (id) => {
            if(confirm('Delete this product record?')) { products = products.filter(p => p.id !== id); saveToLocal(); deleteEntityFromD1('product', id); }
        };

        // --- 批量导入逻辑 ---
        let importStep = 1;
        let importData = [];
        let importHeaders = [];
        let importCompatibilityData = [];
        let importChannelPartnerData = [];
        const systemFields = {
            id: '产品编号',
            name: '产品全称',
            category: '类目',
            vendor: '供应商',
            spec: '规格型号',
            inverterKw: '逆变器kW',
            batteryKwh: '电池kWh',
            scenario: '应用场景',
            warrantyYears: '质保年限',
            warrantyCycles: '循环次数',
            leadTime: '供货周期',
            contact: '联系人',
            contactInfo: '联系方式',
            certificationRequirementIds: '认证Record IDs',
            certificationCountries: '产品认证国家',
            certificationStandards: '产品认证标准',
            costCurrency: '基准币种',
            priceBasisUnit: '计价单位',
            unitQtyPerPcs: '每PCS含量',
            cost: '基准采购价',
            price: '基准售价'
        };
        const systemFieldLabelsEnglish = {
            id: 'Product ID',
            name: 'Product Name',
            category: 'Category',
            vendor: 'Supplier',
            spec: 'Specification',
            inverterKw: 'Inverter kW',
            batteryKwh: 'Battery kWh',
            scenario: 'Subcategory',
            warrantyYears: 'Warranty Years',
            warrantyCycles: 'Cycle Count',
            leadTime: 'Lead Time',
            contact: 'Contact',
            contactInfo: 'Contact Info',
            certificationRequirementIds: 'Certification Record IDs',
            certificationCountries: 'Certification Countries',
            certificationStandards: 'Certification Standards',
            costCurrency: 'Base Currency',
            priceBasisUnit: 'Price Basis Unit',
            unitQtyPerPcs: 'Qty per PCS',
            cost: 'Base Cost',
            price: 'Base Price'
        };
        const PRODUCT_MASTER_IMPORT_MASTER_FIELDS = {
            masterModel: 'SKU / Model',
            masterBrand: 'Brand',
            masterSeries: 'Series',
            masterApplication: 'Application',
            masterVoltageClass: 'Voltage Class',
            masterPhase: 'Phase',
            masterStatus: 'Status',
            masterCountryAvailable: 'Country Available',
            masterDatasheetLink: 'Datasheet Link',
            masterCertificateLink: 'External Certificate Link',
            masterRemark: 'Remark'
        };
        const PRODUCT_MASTER_IMPORT_SOURCING_FIELDS = {
            sourceType: 'Source Type',
            channelPartnerId: 'Channel Partner ID',
            brandSupplierCode: 'Brand Supplier Code',
            commercialSupplierCode: 'Commercial Supplier Code',
            factorySupplierCode: 'Factory Supplier Code',
            brandOwnerSupplierCode: 'Brand Owner Supplier Code',
            authorizationStatus: 'Authorization Status',
            authorizationExpiry: 'Authorization Expiry',
            sourceRemark: 'Source Remark'
        };
        const COMPATIBILITY_IMPORT_FIELDS = {
            relationType: 'Relation Type',
            sourceProductId: 'Source Product ID',
            targetProductId: 'Target Product ID',
            systemScope: 'System Scope',
            status: 'Status',
            protocol: 'Protocol',
            constraints: 'Constraints',
            approvedBy: 'Approved By',
            updatedAt: 'Updated At',
            remark: 'Remark'
        };
        Object.assign(systemFields, PRODUCT_MASTER_IMPORT_MASTER_FIELDS);
        Object.assign(systemFields, PRODUCT_MASTER_IMPORT_SOURCING_FIELDS);
        Object.assign(systemFields, PRODUCT_MASTER_TECHNICAL_LABEL_BY_KEY);
        Object.assign(systemFieldLabelsEnglish, PRODUCT_MASTER_IMPORT_MASTER_FIELDS);
        Object.assign(systemFieldLabelsEnglish, PRODUCT_MASTER_IMPORT_SOURCING_FIELDS);
        Object.assign(systemFieldLabelsEnglish, PRODUCT_MASTER_TECHNICAL_LABEL_BY_KEY);

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
            // 重置Status
            goToStep(1, true);
            document.getElementById('excel-file-input').value = '';
            document.getElementById('file-name-display').textContent = '';
            importCompatibilityData = [];
            importChannelPartnerData = [];
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
                nextBtn.textContent = 'Next';
                nextBtn.onclick = () => goToStep(2);
                nextBtn.disabled = !document.getElementById('excel-file-input').files.length;
            } else if (step === 2) {
                nextBtn.textContent = 'Confirm Import';
                nextBtn.onclick = () => goToStep(3);
                nextBtn.disabled = false;
            } else if (step === 3) {
                nextBtn.textContent = 'Done';
                nextBtn.onclick = closeImportModal;
            }
        };

        window.handleFileSelect = (files) => {
            if (files.length === 0) return;
            const file = files[0];
            document.getElementById('file-name-display').textContent = `Selected: ${file.name}`;
            document.getElementById('import-next-btn').disabled = false;
            parseExcel(file);
        };

        function validateFile() {
            const fileInput = document.getElementById('excel-file-input');
            if (fileInput.files.length === 0) {
                alert('Please select a file.');
                return false;
            }
            const file = fileInput.files[0];
            if (file.size > 10 * 1024 * 1024) {
                alert('File size cannot exceed 10MB.');
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
                const compatibilitySheet = workbook.Sheets['Compatibility Matrix'];
                importCompatibilityData = [];
                importChannelPartnerData = [];
                const channelPartnerSheet = workbook.Sheets['Channel Partners'];
                if (channelPartnerSheet) {
                    const channelRows = XLSX.utils.sheet_to_json(channelPartnerSheet, { defval: '' });
                    importChannelPartnerData = channelRows.map(row => normalizeChannelPartner({
                        id: row.ID || row.Id || row.id || '',
                        brandSupplierCode: row['Brand Supplier Code'],
                        type: row['Partner Type'] || row.Type,
                        name: row['Partner Name'] || row.Name,
                        country: row['Country/Region'] || row.Country,
                        authorizationStatus: row['Authorization Status'],
                        authorizationExpiry: row['Authorization Expiry'],
                        contact: row.Contact,
                        contactInfo: row['Contact Info'],
                        remark: row.Remark
                    })).filter(partner => partner.brandSupplierCode && partner.name);
                }
                if (compatibilitySheet) {
                    const compatRows = XLSX.utils.sheet_to_json(compatibilitySheet, { defval: '' });
                    importCompatibilityData = compatRows.map(row => normalizeCompatibilityRule({
                        id: row.ID || row.Id || row.id || '',
                        relationType: row['Relation Type'],
                        sourceProductId: row['Source Product ID'],
                        targetProductId: row['Target Product ID'],
                        systemScope: row['System Scope'],
                        status: row.Status,
                        protocol: row.Protocol,
                        constraints: row.Constraints,
                        approvedBy: row['Approved By'],
                        updatedAt: row['Updated At'],
                        remark: row.Remark
                    })).filter(rule => rule.sourceProductId && rule.targetProductId);
                }

                if (json.length < 2) {
                    alert('The Excel file is empty or has no data.');
                    return;
                }

                importHeaders = json[0];
                importData = json.slice(1).map(row => {
                    let obj = {};
                    importHeaders.forEach((h, i) => obj[h] = row[i]);
                    return obj;
                });

                if (importData.length > 1000) {
                    alert('A single import supports up to 1000 records.');
                    importData = importData.slice(0, 1000);
                }

                renderFieldMapping();
                renderPreview();
            };
            reader.readAsArrayBuffer(file);
        }

        function renderFieldMapping() {
            const container = document.getElementById('field-mapping-container');
            const aliases = {
                category: ['类目', 'Category', 'Product Category'],
                inverterKw: ['逆变器kW', 'Inverter kW', 'Inverter Capacity', 'Inverter Capacity kW'],
                batteryKwh: ['电池kWh', 'Battery kWh', 'Battery Capacity', 'Battery Capacity kWh'],
                scenario: ['应用场景', 'Subcategory', 'Application Scenario'],
                certificationRequirementIds: ['认证Record IDs', '认证记录ID', 'Certification Record IDs', 'Certification Requirement IDs', 'Record IDs'],
                certificationCountries: ['产品认证国家', '认证国家', 'Certification Countries'],
                certificationStandards: ['产品认证标准', '产品认证', 'Certification Standards', 'Product Certification'],
                costCurrency: ['基准币种', 'Base Currency', 'Currency', 'Cost Currency', 'Price Currency'],
                priceBasisUnit: ['计价单位', 'Price Basis Unit', 'Pricing Unit', 'Unit'],
                unitQtyPerPcs: ['每PCS含量', 'Qty per PCS', 'Unit Qty per PCS', 'Qty/PCS']
            };
            Object.assign(aliases, {
                masterModel: ['SKU / Model', 'Model', 'SKU', 'Spec Model'],
                masterBrand: ['Brand', '品牌'],
                masterSeries: ['Series', '系列'],
                masterApplication: ['Application', '应用'],
                masterVoltageClass: ['Voltage Class', 'Voltage_Class'],
                masterPhase: ['Phase'],
                masterStatus: ['Status'],
                masterCountryAvailable: ['Country Available', 'Country_Available'],
                masterDatasheetLink: ['Datasheet Link', 'Datasheet_Link'],
                masterCertificateLink: ['External Certificate Link', 'Certificate Link', 'Certificate_Link'],
                masterRemark: ['Remark', '备注']
            });
            Object.assign(aliases, {
                sourceType: ['Source Type'],
                channelPartnerId: ['Channel Partner ID', 'Channel Partner'],
                brandSupplierCode: ['Brand Supplier Code', 'Brand Supplier'],
                commercialSupplierCode: ['Commercial Supplier Code', 'Commercial Supplier'],
                factorySupplierCode: ['Factory Supplier Code', 'Factory Supplier'],
                brandOwnerSupplierCode: ['Brand Owner Supplier Code', 'Brand Owner'],
                authorizationStatus: ['Authorization Status'],
                authorizationExpiry: ['Authorization Expiry'],
                sourceRemark: ['Source Remark']
            });
            PRODUCT_MASTER_TECHNICAL_IMPORT_KEYS.forEach(key => {
                aliases[key] = [PRODUCT_MASTER_TECHNICAL_LABEL_BY_KEY[key], key];
            });
            container.innerHTML = Object.keys(systemFields).map(key => `
                <div class="flex items-center">
                    <label class="w-28 font-bold text-slate-600">${systemFieldLabelsEnglish[key] || systemFields[key]}:</label>
                    <select id="map-${key}" class="flex-1 border border-slate-300 rounded-md p-1.5 outline-none focus:border-blue-500 bg-white">
                        <option value="">- Ignore this column -</option>
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

                // Skip rows without a product name.
                if (!newProduct.name) {
                    failCount++;
                    log.push(`<p class="text-red-500">Row ${i + 2}: import failed because Product Name is required.</p>`);
                    return;
                }

                // Generate a product ID when the import row does not provide one.
                newProduct.category = normalizeProductCategory(newProduct.category, 'Uncategorized');
                newProduct.scenario = normalizeProductSubcategory(newProduct.scenario);
                const importedMasterData = compactProductMasterObject({
                    model: newProduct.masterModel,
                    brand: newProduct.masterBrand,
                    series: newProduct.masterSeries,
                    application: newProduct.masterApplication,
                    voltageClass: newProduct.masterVoltageClass,
                    phase: newProduct.masterPhase,
                    status: newProduct.masterStatus,
                    countryAvailable: newProduct.masterCountryAvailable,
                    datasheetLink: newProduct.masterDatasheetLink,
                    certificateLink: newProduct.masterCertificateLink,
                    remark: newProduct.masterRemark
                });
                Object.keys(PRODUCT_MASTER_IMPORT_MASTER_FIELDS).forEach(key => delete newProduct[key]);
                const importedSourcing = compactProductMasterObject({
                    sourceType: PRODUCT_SOURCE_TYPES.includes(newProduct.sourceType) ? newProduct.sourceType : (newProduct.sourceType ? 'Unknown' : ''),
                    channelPartnerId: newProduct.channelPartnerId,
                    brandSupplierCode: normalizeSupplierCode(newProduct.brandSupplierCode || ''),
                    commercialSupplierCode: normalizeSupplierCode(newProduct.commercialSupplierCode || ''),
                    factorySupplierCode: normalizeSupplierCode(newProduct.factorySupplierCode || ''),
                    brandOwnerSupplierCode: normalizeSupplierCode(newProduct.brandOwnerSupplierCode || ''),
                    authorizationStatus: PRODUCT_AUTHORIZATION_STATUS.includes(newProduct.authorizationStatus) ? newProduct.authorizationStatus : '',
                    authorizationExpiry: newProduct.authorizationExpiry,
                    sourceRemark: newProduct.sourceRemark
                });
                Object.keys(PRODUCT_MASTER_IMPORT_SOURCING_FIELDS).forEach(key => delete newProduct[key]);
                const importedTechnicalSpecs = {};
                getProductTechnicalSpecFieldsForCategory(newProduct.category).forEach(field => {
                    if (newProduct[field.id] !== undefined && newProduct[field.id] !== '') {
                        importedTechnicalSpecs[field.id] = coerceProductMasterFieldValue(newProduct[field.id], field.type);
                    }
                });
                PRODUCT_MASTER_TECHNICAL_IMPORT_KEYS.forEach(key => delete newProduct[key]);
                if (Object.keys(importedMasterData).length) newProduct.masterData = importedMasterData;
                if (Object.keys(importedSourcing).length) newProduct.sourcing = importedSourcing;
                if (Object.keys(importedTechnicalSpecs).length) newProduct.technicalSpecs = importedTechnicalSpecs;
                if (isHybridStorageCategory(newProduct.category)) {
                    const parsedHybrid = parseHybridStorageSpec(newProduct);
                    if (parsedHybrid.inverterKw > 0) newProduct.inverterKw = parsedHybrid.inverterKw;
                    if (parsedHybrid.batteryKwh > 0) newProduct.batteryKwh = parsedHybrid.batteryKwh;
                    const formattedHybridSpec = formatHybridStorageSpec(newProduct);
                    if (formattedHybridSpec) newProduct.spec = formattedHybridSpec;
                }
                if (!newProduct.id) {
                    newProduct.id = generateNextId(newProduct.category || 'Generic');
                } else {
                    newProduct.id = String(newProduct.id);
                }

                const supplier = ensureSupplierForVendorName(newProduct.vendor || 'Unassigned Supplier');
                if (supplier) {
                    newProduct.supplierCode = supplier.code;
                    newProduct.vendor = getSupplierDisplayName(supplier);
                }
                const importedCurrency = normalizeProductPriceCurrency(newProduct.costCurrency || newProduct.priceCurrency || inferSupplierPriceCurrency(supplier));
                newProduct.costCurrency = importedCurrency;
                newProduct.priceCurrency = importedCurrency;
                const pricingMeta = getProductPricingMeta(newProduct);
                if (String(newProduct.priceBasisUnit || '').trim()) {
                    newProduct.priceBasisUnit = normalizePricingUnit(newProduct.priceBasisUnit);
                } else {
                    delete newProduct.priceBasisUnit;
                }
                const qtyPerPcs = parseFloat(newProduct.unitQtyPerPcs);
                if (Number.isFinite(qtyPerPcs) && qtyPerPcs > 0) {
                    newProduct.unitQtyPerPcs = qtyPerPcs;
                } else {
                    newProduct.unitQtyPerPcs = pricingMeta.unitQtyPerPcs;
                }
                const importedRecordIds = uniqueCertList(String(newProduct.certificationRequirementIds || '').split(/[\n;,/]+/))
                    .map(id => String(id || '').trim().toUpperCase())
                    .filter(id => getCertificationRequirementById(id));
                if (importedRecordIds.length || newProduct.certificationCountries || newProduct.certificationStandards) {
                    const countries = uniqueCertList(String(newProduct.certificationCountries || '').split(/[\n;,/]+/)).map(v => v.toUpperCase());
                    const standards = uniqueCertList(String(newProduct.certificationStandards || '').split(/[\n;,]+/));
                    newProduct.certificationRequirementIds = importedRecordIds;
                    newProduct.certificationRequirements = {
                        recordIds: importedRecordIds,
                        legacyCountries: countries,
                        standards,
                        source: 'import',
                        updatedAt: ''
                    };
                    if (!newProduct.certificationRequirementIds.length) delete newProduct.certificationRequirementIds;
                    delete newProduct.certificationCountries;
                    delete newProduct.certificationStandards;
                } else {
                    delete newProduct.certificationRequirementIds;
                }
                const existingIndex = products.findIndex(p => p.id === newProduct.id);
                if (existingIndex !== -1) {
                    products[existingIndex] = { ...products[existingIndex], ...newProduct, ts: Date.now() };
                } else {
                    products.push({ ...newProduct, ts: Date.now() });
                }
                successCount++;
            });

            const channelPartnerCount = processChannelPartnerImport();
            const compatibilityCount = processCompatibilityImport();

            saveToLocal();
            try {
                window.__minovaBusiness?.upsertEntities?.([
                    ...products.map(record => ({ domain: 'product', recordId: record.id, payload: cloneForD1(record) })),
                    ...channelPartners.map(record => ({ domain: 'channel_partner', recordId: record.id, payload: cloneForD1(record) })),
                    ...suppliers.map(record => ({ domain: 'supplier', recordId: record.id || record.code, payload: cloneForD1(record) })),
                    ...compatibilityRules.map(record => ({ domain: 'compatibility_rule', recordId: record.id, payload: cloneForD1(record) }))
                ]);
            } catch (e) {
                console.warn('D1 product import save queued/failed:', e);
            }
            if (channelPartnerCount) log.push(`<p class="text-green-600">Channel Partners imported: ${channelPartnerCount} records.</p>`);
            if (compatibilityCount) log.push(`<p class="text-green-600">Compatibility Matrix imported: ${compatibilityCount} rules.</p>`);
            renderImportLog(successCount, failCount, log);
            goToStep(3);
        }

        function processCompatibilityImport() {
            if (!Array.isArray(importCompatibilityData) || !importCompatibilityData.length) return 0;
            let count = 0;
            importCompatibilityData.forEach(rule => {
                if (!rule.sourceProductId || !rule.targetProductId) return;
                const idx = compatibilityRules.findIndex(r => r.id === rule.id);
                if (idx >= 0) compatibilityRules[idx] = rule;
                else compatibilityRules.push(rule);
                count += 1;
            });
            compatibilityRules = normalizeCompatibilityRules(compatibilityRules);
            return count;
        }

        function processChannelPartnerImport() {
            if (!Array.isArray(importChannelPartnerData) || !importChannelPartnerData.length) return 0;
            let count = 0;
            importChannelPartnerData.forEach(partner => {
                const idx = channelPartners.findIndex(p => p.id === partner.id);
                if (idx >= 0) channelPartners[idx] = partner;
                else channelPartners.push(partner);
                count += 1;
            });
            channelPartners = normalizeChannelPartners(channelPartners);
            return count;
        }

        function renderImportLog(success, failed, details) {
            const logContainer = document.getElementById('import-log');
            let summary = `<p>Import succeeded: <strong class="text-green-600">${success}</strong> records</p>`;
            if (failed > 0) {
                summary += `<p>Import failed: <strong class="text-red-600">${failed}</strong> records</p>`;
            }
            logContainer.innerHTML = summary + '<div class="mt-4 text-xs max-h-60 overflow-y-auto border p-2 rounded-md">' + details.join('') + '</div>';
        }

        window.downloadTemplate = () => {
            const masterHeaders = ['SKU / Model', 'Brand', 'Series', 'Application', 'Voltage Class', 'Phase', 'Status', 'Country Available', 'Datasheet Link', 'External Certificate Link', 'Remark'];
            const sourcingHeaders = ['Source Type', 'Channel Partner ID', 'Brand Supplier Code', 'Commercial Supplier Code', 'Factory Supplier Code', 'Brand Owner Supplier Code', 'Authorization Status', 'Authorization Expiry', 'Source Remark'];
            const technicalHeaders = PRODUCT_MASTER_TECHNICAL_IMPORT_KEYS.map(key => PRODUCT_MASTER_TECHNICAL_LABEL_BY_KEY[key]);
            const headers = ['Product ID', 'Product Name', 'Category', 'Supplier', 'Spec Model', 'Inverter kW', 'Battery kWh', 'Subcategory', 'Warranty Years', 'Cycle Count', 'Lead Time', 'Contact', 'Contact Method', 'Certification Record IDs', 'Product Certification Standards', 'Base Currency', 'Price Basis Unit', 'Qty per PCS', 'Base Cost', 'Base Price', ...masterHeaders, ...sourcingHeaders, ...technicalHeaders];
            const data = products.map(p => {
                const pricingMeta = getProductPricingMeta(p);
                const hybridSpec = isHybridStorageCategory(p.category) ? parseHybridStorageSpec(p) : { inverterKw: '', batteryKwh: '' };
                const md = getProductMasterData(p);
                const tech = getProductTechnicalSpecs(p);
                const sourcing = getProductSourcing(p);
                const certReq = getProductCertificationRequirements(p);
                return [
                p.id || '',
                p.name || '',
                p.category || '',
                getProductSupplierDisplay(p),
                getProductDisplaySpec(p) || '',
                hybridSpec.inverterKw || '',
                hybridSpec.batteryKwh || '',
                p.scenario || '',
                p.warrantyYears || '',
                p.warrantyCycles || '',
                p.leadTime || '',
                p.contact || '',
                p.contactInfo || '',
                (certReq.recordIds || []).join('; '),
                (certReq.standards || []).join('; '),
                getProductCurrency(p, 'cost'),
                pricingMeta.priceBasisUnit,
                pricingMeta.unitQtyPerPcs,
                p.cost || 0,
                p.price || 0,
                md.model || '',
                md.brand || '',
                md.series || '',
                md.application || '',
                md.voltageClass || '',
                md.phase || '',
                md.status || '',
                md.countryAvailable || '',
                md.datasheetLink || '',
                md.certificateLink || '',
                md.remark || '',
                sourcing.sourceType || '',
                sourcing.channelPartnerId || '',
                sourcing.brandSupplierCode || p.supplierCode || '',
                sourcing.commercialSupplierCode || '',
                sourcing.factorySupplierCode || '',
                sourcing.brandOwnerSupplierCode || '',
                sourcing.authorizationStatus || '',
                sourcing.authorizationExpiry || '',
                sourcing.sourceRemark || '',
                ...PRODUCT_MASTER_TECHNICAL_IMPORT_KEYS.map(key => tech[key] || '')
            ];
            });

            // 如果没数据，加一行示例
            if (data.length === 0) {
                data.push(['PROD001', 'Sample All-in-One', 'All-in-One System', 'Generic Supplier', '5.5 kW / 10 kWh', 5.5, 10, 'Single-Phase All-in-One', '10', '0', '15 days', 'Sales Manager', 'sales@example.com', 'INV-001; BESS-001', 'IEC 62619; IEC 62109-1/2', 'CNY', 'set', 1, 5000, 6500, 'AIO-5.5-10', 'Generic Brand', 'Hybrid Series', 'Residential', 'LV', 'Single', 'Active', 'MY', '', '', 'Sample V3 Product Master row', 'Direct Factory', '', 'SUP001', 'SUP001', 'SUP001', 'SUP001', 'Authorized', '', 'Factory source confirmed', ...PRODUCT_MASTER_TECHNICAL_IMPORT_KEYS.map(key => key === 'nominalEnergyKwh' ? 10 : (key === 'pcsRatedPowerKw' ? 5.5 : ''))]);
            }

            const worksheet = XLSX.utils.aoa_to_sheet([headers, ...data]);
            const compatibilityHeaders = ['ID', 'Relation Type', 'Source Product ID', 'Target Product ID', 'System Scope', 'Status', 'Protocol', 'Constraints', 'Approved By', 'Updated At', 'Remark'];
            const compatibilityRows = normalizeCompatibilityRules(compatibilityRules).map(rule => [
                rule.id,
                rule.relationType,
                rule.sourceProductId,
                rule.targetProductId,
                rule.systemScope,
                rule.status,
                rule.protocol,
                rule.constraints,
                rule.approvedBy,
                rule.updatedAt,
                rule.remark
            ]);
            if (!compatibilityRows.length) compatibilityRows.push(['compat_001', 'Inverter ↔ Battery', 'INV001', 'BAT001', 'Residential', 'Pending', 'CAN / RS485', 'Voltage and firmware check required', '', '', 'Sample compatibility row']);
            const compatibilityWorksheet = XLSX.utils.aoa_to_sheet([compatibilityHeaders, ...compatibilityRows]);
            const channelPartnerHeaders = ['ID', 'Brand Supplier Code', 'Partner Type', 'Partner Name', 'Country/Region', 'Authorization Status', 'Authorization Expiry', 'Contact', 'Contact Info', 'Remark'];
            const channelPartnerRows = normalizeChannelPartners(channelPartners).map(partner => [
                partner.id,
                partner.brandSupplierCode,
                partner.type,
                partner.name,
                partner.country,
                partner.authorizationStatus,
                partner.authorizationExpiry,
                partner.contact,
                partner.contactInfo,
                partner.remark
            ]);
            if (!channelPartnerRows.length) channelPartnerRows.push(['channel_001', 'SUP001', 'Authorized Distributor', 'Sample Distributor', 'MY', 'Authorized', '', 'Sales Manager', 'sales@example.com', 'Sample channel partner row']);
            const channelPartnerWorksheet = XLSX.utils.aoa_to_sheet([channelPartnerHeaders, ...channelPartnerRows]);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Product List');
            XLSX.utils.book_append_sheet(workbook, channelPartnerWorksheet, 'Channel Partners');
            XLSX.utils.book_append_sheet(workbook, compatibilityWorksheet, 'Compatibility Matrix');
            XLSX.writeFile(workbook, 'product-master-list.xlsx');
        };

        // --- Select器逻辑 ---
        function getPickerCurrency() {
            return window.pickerDisplayCurrency || currentCurrency || 'MYR';
        }
        function getPickerCostMode() {
            return window.pickerCostMode === 'gray' ? 'gray' : 'clearance';
        }
        function getPickerCustomerMode() {
            return window.pickerCustomerMode === 'biz' ? 'biz' : 'home';
        }
        function getPickerSelectedPriceType() {
            return `${getPickerCostMode()}_${getPickerCustomerMode()}`;
        }
        function getPickerSelectedPriceLabel() {
            const type = getPickerSelectedPriceType();
            if (type === 'clearance_biz') return 'Clearance C&I';
            if (type === 'gray_home') return 'Grey RESI';
            if (type === 'gray_biz') return 'Grey C&I';
            return 'Clearance RESI';
        }
        function getPickerSelectedPriceValue(pricing, type) {
            const r = pricing || {};
            if (type === 'clearance_biz') return r.clearanceBizPrice || 0;
            if (type === 'gray_home') return r.grayHomePrice || 0;
            if (type === 'gray_biz') return r.grayBizPrice || 0;
            return r.clearanceHomePrice || 0;
        }
        function getPickerSelectedButtonClass(type) {
            const base = 'px-3 py-1 text-white text-[10px] font-bold rounded-lg transition-all shadow-sm';
            if (type === 'clearance_biz') return `${base} bg-sky-700 hover:bg-sky-800`;
            if (type === 'gray_home') return `${base} bg-indigo-700 hover:bg-indigo-800`;
            if (type === 'gray_biz') return `${base} bg-violet-700 hover:bg-violet-800`;
            return `${base} bg-blue-700 hover:bg-blue-800`;
        }
        function updatePickerModeButtons() {
            const modeClass = 'px-2 py-1 rounded-md text-[10px] font-black transition-all';
            const activeClass = `${modeClass} bg-purple-700 text-white shadow-sm`;
            const idleClass = `${modeClass} text-slate-500 hover:text-slate-800 hover:bg-slate-100`;
            const costMode = getPickerCostMode();
            const customerMode = getPickerCustomerMode();
            const setClass = (id, active) => {
                const el = document.getElementById(id);
                if (el) el.className = active ? activeClass : idleClass;
            };
            setClass('picker-cost-clearance', costMode === 'clearance');
            setClass('picker-cost-gray', costMode === 'gray');
            setClass('picker-customer-home', customerMode === 'home');
            setClass('picker-customer-biz', customerMode === 'biz');
            setClass('price-list-picker-cost-clearance', costMode === 'clearance');
            setClass('price-list-picker-cost-gray', costMode === 'gray');
            setClass('price-list-picker-customer-home', customerMode === 'home');
            setClass('price-list-picker-customer-biz', customerMode === 'biz');
        }
        window.setPickerCostMode = (mode) => {
            window.pickerCostMode = mode === 'gray' ? 'gray' : 'clearance';
            renderPicker();
            renderPriceListPicker();
        };
        window.setPickerCustomerMode = (mode, opts = {}) => {
            const next = mode === 'biz' ? 'biz' : 'home';
            const solarMode = (typeof getQuoteSolarCustomerMode === 'function') ? getQuoteSolarCustomerMode() : 'home';
            if (!opts.force && next !== solarMode) {
                const solarLabel = solarMode === 'biz' ? 'C&I' : 'RESI';
                const nextLabel = next === 'biz' ? 'C&I' : 'RESI';
                const ok = confirm(`当前 Solar Calculation Inputs Select的是 ${solarLabel}，Product Picker 将切换为 ${nextLabel} Quote，可能与当前 Solar Status不一致。是否继续？`);
                if (!ok) {
                    updatePickerModeButtons();
                    return;
                }
            }
            window.pickerCustomerMode = next;
            renderPicker();
            renderPriceListPicker();
        };
        function formatPickerPrice(valueCny) {
            const v = Number.isFinite(parseFloat(valueCny)) ? parseFloat(valueCny) : 0;
            if (getPickerCurrency() === 'MYR') {
                const rate = parseFloat(document.getElementById('rate-myr-cny')?.value) || 1.53;
                return `RM ${formatNumberAuto(v / (rate > 0 ? rate : 1.53), 4)}`;
            }
            return `¥${formatNumberAuto(v, 4)}`;
        }
        function getPickerInventoryPcsPricing(item, product, priceType = getPickerSelectedPriceType()) {
            const p = product || {};
            const r = computeInventoryPricing({ item, product: p });
            const pricingMeta = getProductPricingMeta(p, item);
            const unit = pricingMeta.priceBasisUnit || 'pcs';
            const pcsMultiplier = pricingMeta.unitQtyPerPcs > 0 ? pricingMeta.unitQtyPerPcs : 1;
            const selectedUnitPrice = getPickerSelectedPriceValue({
                clearanceHomePrice: (item?.clearanceHomePrice ?? r.clearanceHomePrice) || 0,
                clearanceBizPrice: (item?.clearanceBizPrice ?? r.clearanceBizPrice) || 0,
                grayHomePrice: (item?.grayHomePrice ?? r.grayHomePrice) || 0,
                grayBizPrice: (item?.grayBizPrice ?? r.grayBizPrice) || 0
            }, priceType);
            const avgCost = Number.isFinite(parseFloat(r.avgCost)) ? parseFloat(r.avgCost) : 0;
            const fallbackCost = Number.isFinite(parseFloat(item?.purchasePrice)) ? parseFloat(item.purchasePrice) : 0;
            return {
                ...r,
                costUnit: normalizePricingUnit(unit),
                pcsMultiplier,
                pricingMeta,
                pcsPrice: selectedUnitPrice * pcsMultiplier,
                pcsCost: (avgCost > 0 ? avgCost : fallbackCost) * pcsMultiplier
            };
        }
        function formatPickerInventorySpec(item, product) {
            return getProductPricingMeta(product || {}, item).label;
        }
        function getPriceListProductPcsPricing(product, priceType = getPickerSelectedPriceType()) {
            const p = product || {};
            const pricingMeta = getProductPricingMeta(p);
            const pricing = priceListProductPricing(p);
            const multiplierRaw = Number.isFinite(parseFloat(pricing.pcsMultiplier)) ? parseFloat(pricing.pcsMultiplier) : 1;
            const pcsMultiplier = multiplierRaw > 0 ? multiplierRaw : 1;
            const selectedUnitPrice = getPickerSelectedPriceValue(pricing, priceType);
            return {
                ...pricing,
                costUnit: normalizePricingUnit(pricing.costUnit || pricingMeta.priceBasisUnit || 'pcs'),
                pcsMultiplier,
                pricingMeta: pricing.pricingMeta || pricingMeta,
                pcsPrice: selectedUnitPrice * pcsMultiplier,
                pcsCost: pricing.pcsCost || ((pricing.avgCost || 0) * pcsMultiplier),
                priceType
            };
        }
        function formatPriceListProductSpec(product) {
            return getProductPricingMeta(product || {}).label;
        }
        function getProductDeliveryTime(product) {
            return String(product?.leadTime || product?.deliveryTime || '').trim() || '-';
        }
        function getSupplierCountryLabelForProduct(product) {
            const supplier = getProductSupplier(product);
            return String(supplier?.country || supplier?.region || '').trim() || '-';
        }
        window.togglePickerCurrency = () => {
            window.pickerDisplayCurrency = getPickerCurrency() === 'MYR' ? 'CNY' : 'MYR';
            renderPicker();
            renderPriceListPicker();
        };
        window.renderPicker = () => {
            if (!window.pickerDisplayCurrency) window.pickerDisplayCurrency = currentCurrency || 'MYR';
            if (!window.pickerCostMode) window.pickerCostMode = 'clearance';
            if (!window.pickerCustomerMode) window.pickerCustomerMode = 'home';
            const currencyBtn = document.getElementById('picker-currency-toggle');
            if (currencyBtn) currencyBtn.textContent = getPickerCurrency() === 'MYR' ? 'RM / ¥' : '¥ / RM';
            const priceListCurrencyBtn = document.getElementById('price-list-picker-currency-toggle');
            if (priceListCurrencyBtn) priceListCurrencyBtn.textContent = getPickerCurrency() === 'MYR' ? 'RM / ¥' : '¥ / RM';
            updatePickerModeButtons();
            const selectedPriceType = getPickerSelectedPriceType();
            const selectedPriceLabel = getPickerSelectedPriceLabel();
            const query = (document.getElementById('picker-search')?.value || '').toLowerCase();
            const vendor = document.getElementById('picker-vendor')?.value || '';
            const rawCategory = document.getElementById('picker-category')?.value || '';
            const category = String(rawCategory).trim() ? normalizeProductCategory(rawCategory) : '';
            const list = document.getElementById('picker-list');
            if(!list) return;

            // Filter logic：必须在Inventory中有记录且Quantity > 0
            const availableBatches = inventory.filter(i => i.quantity > 0);

            const filtered = availableBatches.filter(item => {
                const p = products.find(prod => prod.id === item.productId);
                if (!p) return false;

                const pid = String(item.productId || '').toLowerCase();
                return (!vendor || getProductSupplierDisplay(p) === vendor) &&
                       (!category || normalizeProductCategory(p.category) === category) &&
                       (!query || p.name.toLowerCase().includes(query) || p.category.toLowerCase().includes(query) || pid.includes(query));
            });

            if(filtered.length === 0) { list.innerHTML = `<div class="p-8 text-center text-xs text-slate-400 italic">No in-stock products found...</div>`; return; }

            list.innerHTML = filtered.map(item => {
                const p = products.find(prod => prod.id === item.productId);
                const pickerPricing = getPickerInventoryPcsPricing(item, p || {}, selectedPriceType);
                const selectedPrice = pickerPricing.pcsPrice || 0;
                const specLabel = formatPickerInventorySpec(item, p || {});
                return `
                <div class="p-3 hover:bg-purple-50 transition-colors group border-b border-slate-50" onmousemove="showMarketPriceTooltip(event, '${htmlSafe(item.productId || '')}')" onmouseleave="hidePriceListTooltip()">
                    <div class="flex justify-between items-start">
                        <div class="min-w-0">
                            <div class="text-sm font-bold text-slate-700 truncate" title="${p.name}">${p.name}</div>
                            <div class="text-[10px] font-mono text-slate-400">${item.productId || ''}</div>
                        </div>
                        <div class="text-right">
                            <span class="text-[10px] text-slate-400 block">Warehouse: ${item.location || '-'} | Batch: ${item.batchNo}</span>
                            <span class="text-[10px] text-slate-400 block">Spec: <span class="font-black text-slate-600">${htmlSafe(specLabel)}</span></span>
                            <span class="text-[10px] text-slate-400 block">Stock: <span class="text-green-700 font-black">${formatNumberAuto(item.quantity, 4)}</span></span>
                        </div>
                    </div>
                    <div class="flex justify-between items-center mt-2">
                        <div class="flex gap-2">
                            <span class="text-[9px] uppercase px-1.5 py-0.5 bg-slate-100 text-slate-400 rounded">${normalizeProductCategory(p.category)}</span>
                            <span class="text-[9px] uppercase px-1.5 py-0.5 bg-slate-100 text-slate-400 rounded">${getProductSupplierDisplay(p)}</span>
                        </div>
                        <div class="flex flex-wrap gap-2 justify-end">
                            <button onclick="pickProduct('${item.id}', '${selectedPriceType}')" class="${getPickerSelectedButtonClass(selectedPriceType)}">${selectedPriceLabel} ${formatPickerPrice(selectedPrice)}/pcs</button>
                        </div>
                    </div>
                </div>`}).join('');
        };
        window.renderPriceListPicker = () => {
            if (!window.pickerDisplayCurrency) window.pickerDisplayCurrency = currentCurrency || 'MYR';
            if (!window.pickerCostMode) window.pickerCostMode = 'clearance';
            if (!window.pickerCustomerMode) window.pickerCustomerMode = 'home';
            const currencyBtn = document.getElementById('price-list-picker-currency-toggle');
            if (currencyBtn) currencyBtn.textContent = getPickerCurrency() === 'MYR' ? 'RM / ¥' : '¥ / RM';
            updatePickerModeButtons();
            const selectedPriceType = getPickerSelectedPriceType();
            const selectedPriceLabel = getPickerSelectedPriceLabel();
            const query = (document.getElementById('price-list-picker-search')?.value || '').toLowerCase();
            const vendor = document.getElementById('price-list-picker-vendor')?.value || '';
            const rawCategory = document.getElementById('price-list-picker-category')?.value || '';
            const category = String(rawCategory).trim() ? normalizeProductCategory(rawCategory) : '';
            const country = document.getElementById('price-list-picker-country')?.value || '';
            const list = document.getElementById('price-list-picker-list');
            if(!list) return;

            const filtered = products.filter(p => {
                const supplier = getProductSupplier(p);
                const supplierName = getProductSupplierDisplay(p);
                const supplierCountry = String(supplier?.country || supplier?.region || '').trim();
                const delivery = getProductDeliveryTime(p);
                const hay = [
                    p.id, p.name, p.category, p.scenario, getProductDisplaySpec(p),
                    supplierName, supplierCountry, delivery
                ].join(' ').toLowerCase();
                return (!vendor || supplierName === vendor) &&
                       (!category || normalizeProductCategory(p.category) === category) &&
                       (!country || supplierCountry === country) &&
                       (!query || hay.includes(query));
            });

            if(filtered.length === 0) { list.innerHTML = `<div class="p-8 text-center text-xs text-slate-400 italic">No price-list products found...</div>`; return; }

            list.innerHTML = filtered.map(p => {
                const pickerPricing = getPriceListProductPcsPricing(p, selectedPriceType);
                const selectedPrice = pickerPricing.pcsPrice || 0;
                const specLabel = formatPriceListProductSpec(p);
                const supplierName = getProductSupplierDisplay(p);
                const countryLabel = getSupplierCountryLabelForProduct(p);
                const deliveryLabel = getProductDeliveryTime(p);
                return `
                <div class="p-3 hover:bg-purple-50 transition-colors group border-b border-slate-50" onmousemove="showMarketPriceTooltip(event, '${htmlSafe(p.id || '')}')" onmouseleave="hidePriceListTooltip()">
                    <div class="flex justify-between items-start gap-3">
                        <div class="min-w-0">
                            <div class="text-sm font-bold text-slate-700 truncate" title="${htmlSafe(p.name || '')}">${htmlSafe(p.name || '')}</div>
                            <div class="text-[10px] font-mono text-slate-400">${htmlSafe(p.id || '')}</div>
                        </div>
                        <div class="text-right shrink-0">
                            <span class="text-[10px] text-slate-400 block">Supplier Country: <span class="font-black text-slate-600">${htmlSafe(countryLabel)}</span></span>
                            <span class="text-[10px] text-slate-400 block">Delivery: <span class="font-black text-slate-600">${htmlSafe(deliveryLabel)}</span></span>
                            <span class="text-[10px] text-slate-400 block">Spec: <span class="font-black text-slate-600">${htmlSafe(specLabel)}</span></span>
                        </div>
                    </div>
                    <div class="flex justify-between items-center mt-2 gap-2">
                        <div class="flex gap-2 min-w-0 flex-wrap">
                            <span class="text-[9px] uppercase px-1.5 py-0.5 bg-slate-100 text-slate-400 rounded">${htmlSafe(normalizeProductCategory(p.category))}</span>
                            <span class="text-[9px] uppercase px-1.5 py-0.5 bg-slate-100 text-slate-400 rounded">${htmlSafe(supplierName)}</span>
                        </div>
                        <div class="flex flex-wrap gap-2 justify-end">
                            <button onclick="pickPriceListProduct('${htmlSafe(p.id || '')}', '${selectedPriceType}')" class="${getPickerSelectedButtonClass(selectedPriceType)}">${selectedPriceLabel} ${formatPickerPrice(selectedPrice)}/pcs</button>
                        </div>
                    </div>
                </div>`}).join('');
        };
        function addProductToQuote(inventoryId, priceType) {
            const item = inventory.find(i => i.id === inventoryId); if(!item) return;
            const p = products.find(prod => prod.id === item.productId); if(!p) return;

            const pickerPricing = getPickerInventoryPcsPricing(item, p, priceType);
            const price = pickerPricing.pcsPrice || 0;
            const cost = pickerPricing.pcsCost || 0;

            const firstBlankIdx = quoteRows.findIndex(r => r.isBlank);
            const insertIdx = firstBlankIdx === -1 ? quoteRows.length : firstBlankIdx;
            const candidateIdx = Math.min(Math.max(insertIdx - 1, 0), quoteRows.length - 1);
            const candidate = quoteRows[candidateIdx];
            const supplier = getProductSupplier(p);
            const supplierCode = p.supplierCode || supplier?.code || '';
            const brand = getSupplierDisplayNameForLang(supplier, currentLang) || getProductSupplierBrandForLang(p, currentLang);

            if (candidate && !candidate.isBlank && !candidate.description && candidate.price === 0) {
                candidate.description = p.name;
                candidate.vendor = brand;
                candidate.vendorManualOverride = false;
                candidate.supplierCode = supplierCode;
                candidate.spec = getProductDisplaySpec(p) || '';
                candidate.batchNo = item.batchNo;
                candidate.price = price;
                candidate.cost = cost;
                candidate.productId = item.productId || '';
                candidate.inventoryId = item.id || '';
            } else {
                quoteRows.splice(insertIdx, 0, { id: Date.now(), description: p.name, vendor: brand, vendorManualOverride: false, supplierCode, spec: getProductDisplaySpec(p) || '', batchNo: item.batchNo, quantity: 1, price: price, cost: cost, productId: item.productId || '', inventoryId: item.id || '' });
            }
            renderQuote();
            window.runEngineeringQuoteAddCompletion?.(item.productId || '');
        }

        function addPriceListProductToQuote(productId, priceType) {
            const p = products.find(prod => String(prod.id || '') === String(productId || '')); if(!p) return;

            const pickerPricing = getPriceListProductPcsPricing(p, priceType);
            const price = pickerPricing.pcsPrice || 0;
            const cost = pickerPricing.pcsCost || 0;

            const firstBlankIdx = quoteRows.findIndex(r => r.isBlank);
            const insertIdx = firstBlankIdx === -1 ? quoteRows.length : firstBlankIdx;
            const candidateIdx = Math.min(Math.max(insertIdx - 1, 0), quoteRows.length - 1);
            const candidate = quoteRows[candidateIdx];
            const supplier = getProductSupplier(p);
            const supplierCode = p.supplierCode || supplier?.code || '';
            const brand = getSupplierDisplayNameForLang(supplier, currentLang) || getProductSupplierBrandForLang(p, currentLang);

            if (candidate && !candidate.isBlank && !candidate.description && candidate.price === 0) {
                candidate.description = p.name;
                candidate.vendor = brand;
                candidate.vendorManualOverride = false;
                candidate.supplierCode = supplierCode;
                candidate.spec = getProductDisplaySpec(p) || '';
                candidate.batchNo = '';
                candidate.price = price;
                candidate.cost = cost;
                candidate.productId = p.id || '';
                candidate.inventoryId = '';
            } else {
                quoteRows.splice(insertIdx, 0, { id: Date.now(), description: p.name, vendor: brand, vendorManualOverride: false, supplierCode, spec: getProductDisplaySpec(p) || '', batchNo: '', quantity: 1, price: price, cost: cost, productId: p.id || '', inventoryId: '' });
            }
            renderQuote();
            window.runEngineeringQuoteAddCompletion?.(p.id || '');
        }

        window.openBatteryProgramModal = (inventoryId, priceType) => {
            window.__pendingBatteryPick = { source: 'inventory', inventoryId, priceType };
            const select = document.getElementById('battery-program-select');
            const current = document.getElementById('select-solar-program')?.value || '';
            if (select) select.value = BATTERY_SOLAR_PROGRAMS.includes(current) ? current : (window.__lastBatterySolarProgram || 'offgrid');
            const modal = document.getElementById('battery-program-modal');
            if (modal) {
                modal.classList.remove('hidden');
                modal.classList.add('flex');
            }
        };

        window.openBatteryPriceListProgramModal = (productId, priceType) => {
            window.__pendingBatteryPick = { source: 'priceList', productId, priceType };
            const select = document.getElementById('battery-program-select');
            const current = document.getElementById('select-solar-program')?.value || '';
            if (select) select.value = BATTERY_SOLAR_PROGRAMS.includes(current) ? current : (window.__lastBatterySolarProgram || 'offgrid');
            const modal = document.getElementById('battery-program-modal');
            if (modal) {
                modal.classList.remove('hidden');
                modal.classList.add('flex');
            }
        };

        window.closeBatteryProgramModal = (options = {}) => {
            window.__pendingBatteryPick = null;
            if (!options.preserveEngineeringQuoteAdd) window.__engineeringQuoteAddAfterAdd = null;
            const modal = document.getElementById('battery-program-modal');
            if (modal) {
                modal.classList.add('hidden');
                modal.classList.remove('flex');
            }
        };

        window.confirmBatteryProgramPick = () => {
            const pending = window.__pendingBatteryPick;
            if (!pending) return window.closeBatteryProgramModal();
            const program = document.getElementById('battery-program-select')?.value || 'offgrid';
            const quoteProgram = document.getElementById('select-solar-program');
            if (quoteProgram) quoteProgram.value = BATTERY_SOLAR_PROGRAMS.includes(program) ? program : 'offgrid';
            window.__lastBatterySolarProgram = quoteProgram?.value || 'offgrid';
            window.resetQuoteExportFactorForProgram?.({ recalc: false });
            window.closeBatteryProgramModal({ preserveEngineeringQuoteAdd: true });
            if (pending.source === 'priceList') addPriceListProductToQuote(pending.productId, pending.priceType);
            else addProductToQuote(pending.inventoryId, pending.priceType);
            window.updateQuoteSolarProgramAvailability?.({ fromUser: true });
            try { window.calculateROI?.(); } catch (e) {}
        };

        window.pickProduct = (inventoryId, priceType) => {
            const item = inventory.find(i => i.id === inventoryId); if(!item) return;
            const p = products.find(prod => prod.id === item.productId); if(!p) return;
            if (quoteProductHasBattery(p, item, null)) {
                window.openBatteryProgramModal(inventoryId, priceType);
                return;
            }
            addProductToQuote(inventoryId, priceType);
        };

        window.pickPriceListProduct = (productId, priceType) => {
            const p = products.find(prod => String(prod.id || '') === String(productId || '')); if(!p) return;
            if (quoteProductHasBattery(p, null, null)) {
                window.openBatteryPriceListProgramModal(productId, priceType);
                return;
            }
            addPriceListProductToQuote(productId, priceType);
        };

        // --- Other工具 ---
        function updatePickerFilters() {
            ensureSupplierData();
            const vendors = [...new Set(products.map(p => getProductSupplierDisplay(p)).filter(Boolean))];
            const categories = [...new Set(products.map(p => normalizeProductCategory(p.category)).filter(Boolean))];
            const countries = [...new Set(products.map(p => {
                const supplier = getProductSupplier(p);
                return String(supplier?.country || supplier?.region || '').trim();
            }).filter(Boolean))].sort((a, b) => a.localeCompare(b));
            const vS = document.getElementById('picker-vendor'), cS = document.getElementById('picker-category');
            if(vS) vS.innerHTML = `<option value="">All Suppliers</option>` + vendors.map(v => `<option value="${htmlSafe(v)}">${htmlSafe(v)}</option>`).join('');
            if(cS) cS.innerHTML = `<option value="">All Categories</option>` + categories.map(c => `<option value="${htmlSafe(c)}">${htmlSafe(c)}</option>`).join('');
            const plVS = document.getElementById('price-list-picker-vendor'), plCS = document.getElementById('price-list-picker-category'), plCountry = document.getElementById('price-list-picker-country');
            if(plVS) plVS.innerHTML = `<option value="">All Suppliers</option>` + vendors.map(v => `<option value="${htmlSafe(v)}">${htmlSafe(v)}</option>`).join('');
            if(plCS) plCS.innerHTML = `<option value="">All Categories</option>` + categories.map(c => `<option value="${htmlSafe(c)}">${htmlSafe(c)}</option>`).join('');
            if(plCountry) plCountry.innerHTML = `<option value="">All Countries</option>` + countries.map(c => `<option value="${htmlSafe(c)}">${htmlSafe(c)}</option>`).join('');
        }
        function updateDatalists() {
            ensureSupplierData();
            if (document.getElementById('product-modal-category-field')) renderProductModalCategoryHistoryField(document.getElementById('m-category')?.value || '');
            updateSupplierSelects();
            updateSubcatSuggestions();

            const invProds = products.map(p => `<option value="${htmlSafe(p.id)}">${htmlSafe(p.name)} (${htmlSafe(getProductSupplierDisplay(p))})</option>`).join('');
            const invList = document.getElementById('inv-product-suggestions');
            if (invList) invList.innerHTML = invProds;

            const locations = [...new Set(inventory.map(i => i.location).filter(Boolean))];
            const locList = document.getElementById('location-suggestions');
            if (locList) locList.innerHTML = locations.map(l => `<option value="${htmlSafe(l)}">`).join('');
        }
        window.aiImproveName = async () => {
            const nameEl = document.getElementById('m-name'); if(!nameEl.value) return;
            try {
                const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
                    method: 'POST', body: JSON.stringify({ contents: [{ parts: [{ text: `将以下Product Name润色得更专业（15字内）：${nameEl.value}` }] }] })
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

        window.switchPvcalcPage = (page) => {
            const p = ['1', '2', '3', '4'].includes(String(page || '1')) ? String(page || '1') : '1';
            const s = document.getElementById('pvcalc-page-select');
            if (s && s.value !== p) s.value = p;
            ['1', '2', '3', '4'].forEach(n => {
                const el = document.getElementById(`pvcalc-page-${n}`);
                if (!el) return;
                if (n === p) {
                    el.classList.remove('hidden');
                    el.style.display = 'block';
                } else {
                    el.classList.add('hidden');
                    el.style.display = 'none';
                }
            });
            if (p === '1') {
                try { window.calculatePV?.(); } catch (e) {}
            } else if (p === '2') {
                try { window.recalcTnbFromActiveInput?.(); } catch (e) {}
            } else {
                try { window.recalcAtapViews?.(); } catch (e) {}
            }
        };

        window.tnbConstants = {
            tiers: [
                { cap: 200, rate: 0.218 },
                { cap: 100, rate: 0.334 },
                { cap: 300, rate: 0.516 },
                { cap: 300, rate: 0.546 },
                { cap: Infinity, rate: 0.571 }
            ],
            stRate: 0.08
        };

        window.getTnbIcptRate = (kwh) => {
            const k = Number(kwh) || 0;
            if (k <= 600) return -0.02;
            if (k <= 1500) return 0;
            return 0.10;
        };

        window.calcTnbForward = (kwh) => {
            const k = Math.max(0, Number(kwh) || 0);
            let remaining = k;
            const tierCharges = [];
            for (let i = 0; i < window.tnbConstants.tiers.length; i++) {
                const t = window.tnbConstants.tiers[i];
                const cap = Number.isFinite(t.cap) ? t.cap : remaining;
                const used = Math.min(remaining, cap);
                const charge = used * t.rate;
                tierCharges.push({ used, rate: t.rate, charge });
                remaining -= used;
                if (remaining <= 0) break;
            }
            const energyCharge = tierCharges.reduce((sum, x) => sum + (x.charge || 0), 0);
            const icptRate = window.getTnbIcptRate(k);
            const icpt = k * icptRate;
            const tier4Charge = tierCharges[3]?.charge || 0;
            const tier5Charge = tierCharges[4]?.charge || 0;
            const st = (tier4Charge + tier5Charge) * window.tnbConstants.stRate;
            const total = energyCharge + icpt + st;
            return { kwh: k, energyCharge, icpt, st, total, tierCharges };
        };

        window.calcTnbReverse = (bill) => {
            const b = Math.max(0, Number(bill) || 0);
            if (b >= 219.81 && b <= 232.38) return { bill: b, kwh: null, deadZone: '600' };
            if (b >= 778.72 && b <= 930) return { bill: b, kwh: null, deadZone: '1500' };
            if (b <= 39.60) return { bill: b, kwh: b / 0.198, deadZone: null };
            if (b <= 71.00) return { bill: b, kwh: (b - 39.60) / 0.314 + 200, deadZone: null };
            if (b <= 219.80) return { bill: b, kwh: (b - 71.00) / 0.496 + 300, deadZone: null };
            if (b <= 408.70) return { bill: b, kwh: (b - 232.39) / 0.58968 + 601, deadZone: null };
            if (b <= 778.71) return { bill: b, kwh: (b - 409.32) / 0.61668 + 901, deadZone: null };
            if (b > 930) return { bill: b, kwh: (b - 930) / 0.72468 + 1501, deadZone: null };
            return { bill: b, kwh: null, deadZone: '1500' };
        };

        window.atapInputDefaults = {
            monthlyConsumption: 1100,
            targetGeneration: 1100,
            peakSunHours: 4.5,
            panelRating: 640,
            lossFactor: 0.8,
            investmentBaseKw: 10,
            exportFactor: 0.6,
            exportEnergyRate: 0.2708
        };

        window.atapPlans = {
            solarOnly: {
                domKey: 'solar-only',
                label: 'Solar Only',
                exportFactor: 0.6,
                afaRate: -0.02,
                eeiRate: 0,
                exportEnergyRate: 0.2708,
                retailCharge: 10,
                pricePerKwp: 2500,
                effectiveTariffs: [0.357, 0.393, 0.393, 0.547, 0.586, 0.586, 0.581, 0.623, 0.623, 0.617, 0.664, 0.664, 0.658, 0.709, 0.709, 0.701, 0.757, 0.757, 0.749, 0.81, 0.81, 0.801, 0.868, 0.868, 0.858]
            },
            solarBattery: {
                domKey: 'solar-battery',
                label: 'Solar with Battery',
                exportFactor: 0.4,
                afaRate: -0.0215,
                eeiRate: 0.055,
                exportEnergyRate: 0.2708,
                retailCharge: 10,
                pricePerKwp: 3500,
                effectiveTariffs: [0.393, 0.393, 0.393, 0.586, 0.586, 0.586, 0.623, 0.623, 0.623, 0.664, 0.664, 0.664, 0.709, 0.709, 0.709, 0.757, 0.757, 0.757, 0.81, 0.81, 0.81, 0.868, 0.868, 0.868, 0.931]
            }
        };

        const atapRound = (n, digits = 2) => {
            const v = Number(n);
            if (!Number.isFinite(v)) return 0;
            const m = Math.pow(10, digits);
            return Math.round((v + Number.EPSILON) * m) / m;
        };

        const atapNum = (n, fallback = 0) => {
            const v = Number(n);
            return Number.isFinite(v) ? v : fallback;
        };

        const atapFmtMoney = (n) => atapNum(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const atapFmtWhole = (n) => atapNum(n).toLocaleString('en-MY', { maximumFractionDigits: 0 });
        const atapFmtKwh = (n) => atapNum(n).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const atapFmtPct = (n) => `${(atapNum(n) * 100).toFixed(1)}%`;

        window.__atapInvestmentManual = false;

        window.syncAtapInput = (source) => {
            const key = source?.dataset?.atapInput;
            if (!key) return;
            if (key === 'investmentBaseKw') {
                window.__atapInvestmentManual = true;
            } else if (['targetGeneration', 'peakSunHours', 'lossFactor'].includes(key)) {
                window.__atapInvestmentManual = false;
            }
            document.querySelectorAll(`[data-atap-input="${key}"]`).forEach(el => {
                if (el !== source) el.value = source.value;
            });
            window.recalcAtapViews?.();
        };

        window.__atapExportRateEditConfirmed = false;

        window.setAtapExportRateEditable = (isEditable) => {
            window.__atapExportRateEditConfirmed = !!isEditable;
            document.querySelectorAll('[data-atap-export-rate-input]').forEach(el => {
                el.readOnly = !isEditable;
                el.classList.toggle('bg-slate-50', !isEditable);
                el.classList.toggle('text-slate-500', !isEditable);
                el.classList.toggle('cursor-not-allowed', !isEditable);
                el.classList.toggle('bg-white', !!isEditable);
                el.classList.toggle('text-slate-800', !!isEditable);
            });
            document.querySelectorAll('[data-atap-export-rate-edit-btn]').forEach(btn => {
                btn.textContent = isEditable ? 'Editable' : 'Change';
                btn.disabled = !!isEditable;
                btn.classList.toggle('opacity-50', !!isEditable);
                btn.classList.toggle('cursor-not-allowed', !!isEditable);
            });
        };

        window.confirmAtapExportRateEdit = () => {
            if (window.__atapExportRateEditConfirmed) return;
            const ok = window.confirm?.('Export Energy Rate is fixed by TNB. Confirm you want to edit it?') ?? false;
            if (!ok) return;
            window.setAtapExportRateEditable(true);
        };

        window.resetAtapInputs = () => {
            window.__atapInvestmentManual = false;
            Object.entries(window.atapInputDefaults).forEach(([key, value]) => {
                document.querySelectorAll(`[data-atap-input="${key}"]`).forEach(el => { el.value = String(value); });
            });
            window.setAtapExportRateEditable(false);
            window.recalcAtapViews?.();
        };

        window.getAtapInputs = () => {
            const read = (key) => {
                const el = document.querySelector(`[data-atap-input="${key}"]`);
                const fallback = window.atapInputDefaults[key] ?? 0;
                return Math.max(0, atapNum(el?.value, fallback));
            };
            return {
                monthlyConsumption: read('monthlyConsumption'),
                targetGeneration: read('targetGeneration'),
                peakSunHours: read('peakSunHours'),
                panelRating: read('panelRating'),
                lossFactor: Math.max(0.01, read('lossFactor')),
                investmentBaseKw: read('investmentBaseKw'),
                exportFactor: Math.min(1, Math.max(0, read('exportFactor'))),
                exportEnergyRate: read('exportEnergyRate'),
                performanceRatio: 0.777765,
                daysPerMonth: 30,
                daysPerYear: 365
            };
        };

        window.calcPvSizing = (inputs) => {
            const targetMonthly = Math.max(0, atapNum(inputs?.targetGeneration));
            const dailyGeneration = targetMonthly / (inputs?.daysPerMonth || 30);
            const dailyWithLoss = dailyGeneration / Math.max(0.01, atapNum(inputs?.lossFactor, 0.8));
            const pvSizeKwp = atapNum(inputs?.peakSunHours) > 0 ? dailyWithLoss / inputs.peakSunHours : 0;
            const panelKw = atapNum(inputs?.panelRating) / 1000;
            const panelCountRaw = panelKw > 0 ? pvSizeKwp / panelKw : 0;
            const panelCount = panelCountRaw > 0 ? Math.ceil(panelCountRaw) : 0;
            const installedKwp = panelKw * panelCount;
            const yearOneGeneration = installedKwp * atapNum(inputs?.peakSunHours) * (inputs?.daysPerYear || 365) * atapNum(inputs?.performanceRatio, 0.777765);
            return { targetMonthly, dailyGeneration, dailyWithLoss, pvSizeKwp, panelKw, panelCountRaw, panelCount, installedKwp, yearOneGeneration };
        };

        window.syncAtapInvestmentToSizing = (sizing) => {
            if (window.__atapInvestmentManual) return false;
            const nextValue = String(Math.round(Math.max(0, atapNum(sizing?.pvSizeKwp))));
            let changed = false;
            document.querySelectorAll('[data-atap-input="investmentBaseKw"]').forEach(el => {
                if (el.value !== nextValue) {
                    el.value = nextValue;
                    changed = true;
                }
            });
            return changed;
        };

        window.syncAtapUsageFromTnb = (kwh) => {
            const value = Number(kwh);
            if (!Number.isFinite(value) || value < 0) return;
            const text = String(atapRound(value, 2));
            window.__atapInvestmentManual = false;
            ['monthlyConsumption', 'targetGeneration'].forEach(key => {
                document.querySelectorAll(`[data-atap-input="${key}"]`).forEach(el => { el.value = text; });
            });
            window.recalcAtapViews?.();
        };

        window.calcAtapBill = (plan, inputs) => {
            const before = window.calcTnbForward?.(inputs.monthlyConsumption) || { total: 0 };
            const exportFactor = atapNum(inputs.exportFactor, plan.exportFactor ?? 0.6);
            const exportEnergyRate = atapNum(inputs.exportEnergyRate, plan.exportEnergyRate ?? 0.2708);
            const exportedEnergy = inputs.targetGeneration * exportFactor;
            const selfConsumedSolar = Math.max(0, inputs.targetGeneration - exportedEnergy);
            const importedEnergy = Math.max(inputs.monthlyConsumption - selfConsumedSolar, 0);
            const blockKwh = [
                Math.min(importedEnergy, 200),
                Math.max(Math.min(importedEnergy - 201, 100), 0),
                Math.max(Math.min(importedEnergy - 300, 300), 0),
                Math.max(Math.min(importedEnergy - 600, 300), 0),
                Math.max(Math.min(importedEnergy - 900, 999999), 0)
            ];
            const rates = (window.tnbConstants?.tiers || []).map(t => t.rate);
            const powerCharge = atapRound(blockKwh.reduce((sum, kwh, idx) => sum + (kwh * (rates[idx] || 0)), 0), 2);
            const exportCredit = atapRound(Math.min(importedEnergy, exportedEnergy) * exportEnergyRate, 2);
            const afa = atapRound(importedEnergy * plan.afaRate, 2);
            const eei = atapRound(-importedEnergy * plan.eeiRate, 2);
            const st = powerCharge * 0.08;
            const kwtbb = powerCharge * 0.016;
            const afterBill = atapRound(powerCharge + eei + afa + plan.retailCharge - exportCredit + st + kwtbb, 2);
            const beforeBill = atapRound(before.total, 2);
            const saving = atapRound(beforeBill - afterBill, 2);
            const savingPct = beforeBill ? saving / beforeBill : 0;
            return { beforeBill, exportFactor, exportEnergyRate, exportedEnergy, selfConsumedSolar, importedEnergy, blockKwh, powerCharge, exportCredit, afa, eei, st, kwtbb, retailCharge: plan.retailCharge, afterBill, saving, savingPct };
        };

        window.calcAtap25Year = (plan, sizing, inputs) => {
            const initialInvestment = plan.pricePerKwp * inputs.investmentBaseKw;
            const baseGeneration = sizing.yearOneGeneration;
            let accumulated = 0;
            const rows = [];
            for (let year = 1; year <= 25; year++) {
                const generation = year === 1
                    ? baseGeneration
                    : year === 2
                        ? baseGeneration * 0.98
                        : baseGeneration * 0.98 * Math.pow(0.9975, year - 2);
                const effectiveTariff = plan.effectiveTariffs[year - 1] ?? plan.effectiveTariffs[plan.effectiveTariffs.length - 1] ?? 0;
                const energyCost = atapRound(generation * effectiveTariff, 2);
                const investment = year === 1 ? initialInvestment : 0;
                const annualSaving = atapRound(energyCost - investment, 2);
                accumulated = atapRound(accumulated + annualSaving, 2);
                rows.push({ year, generation, effectiveTariff, energyCost, investment, annualSaving, accumulated });
            }
            let paybackYear = null;
            for (let i = 0; i < rows.length; i++) {
                const current = rows[i];
                const previous = rows[i - 1];
                if (current.accumulated >= 0) {
                    if (!previous) {
                        paybackYear = current.year;
                    } else {
                        paybackYear = previous.year + ((-previous.accumulated) / (current.accumulated - previous.accumulated));
                    }
                    break;
                }
            }
            return { initialInvestment, baseGeneration, rows, paybackYear };
        };

        const atapSetOut = (key, value) => {
            document.querySelectorAll(`[data-atap-out="${key}"]`).forEach(el => { el.textContent = value; });
        };

        const atapRenderRows = (tbodyId, rows, cols) => {
            const tbody = document.getElementById(tbodyId);
            if (!tbody) return;
            tbody.innerHTML = rows.map(row => `<tr class="hover:bg-slate-50 transition-colors">${cols.map(col => `<td class="${col.className || 'py-3 px-5'}">${col.value(row)}</td>`).join('')}</tr>`).join('');
        };

        window.__atapCashflowExpanded = window.__atapCashflowExpanded || {
            solarOnly: { y4: false, y6to9: false, y11to24: false },
            solarBattery: { y4: false, y6to9: false, y11to24: false }
        };
        window.__atapSnapshotView = window.__atapSnapshotView || {
            solarOnly: '25',
            solarBattery: '25'
        };
        window.__atapFormulaUnlocked = false;

        const ensureAtapCashflowState = (planKey) => {
            if (!window.__atapCashflowExpanded) window.__atapCashflowExpanded = {};
            if (!window.__atapCashflowExpanded[planKey]) {
                window.__atapCashflowExpanded[planKey] = { y4: false, y6to9: false, y11to24: false };
            }
            return window.__atapCashflowExpanded[planKey];
        };

        window.toggleAtapCashflowRange = (planKey, rangeKey) => {
            const state = ensureAtapCashflowState(planKey);
            state[rangeKey] = !state[rangeKey];
            window.recalcAtapViews?.();
        };

        const ensureAtapSnapshotView = (planKey) => {
            if (!window.__atapSnapshotView) window.__atapSnapshotView = {};
            const view = window.__atapSnapshotView[planKey] === '10' ? '10' : '25';
            window.__atapSnapshotView[planKey] = view;
            return view;
        };

        window.setAtapSnapshotView = (planKey, viewKey) => {
            if (!window.__atapSnapshotView) window.__atapSnapshotView = {};
            window.__atapSnapshotView[planKey] = viewKey === '10' ? '10' : '25';
            window.recalcAtapViews?.();
        };

        const atapRenderSnapshotControls = (planKey) => {
            const view = ensureAtapSnapshotView(planKey);
            document.querySelectorAll(`[data-atap-snapshot-title="${planKey}"]`).forEach(el => {
                el.textContent = `${view}-Year Snapshot`;
            });
            document.querySelectorAll(`[data-atap-snapshot-plan="${planKey}"]`).forEach(btn => {
                const active = btn.dataset.atapSnapshotView === view;
                btn.classList.toggle('bg-[#582C83]', active);
                btn.classList.toggle('text-white', active);
                btn.classList.toggle('shadow-sm', active);
                btn.classList.toggle('text-slate-500', !active);
                btn.classList.toggle('hover:text-slate-600', !active);
            });
        };

        window.buildAtapCashflowDisplayRows = (planKey, analysis) => {
            const state = ensureAtapCashflowState(planKey);
            const view = ensureAtapSnapshotView(planKey);
            const rowsByYear = new Map((analysis.rows || []).map(row => [row.year, row]));
            const firstPositive = (analysis.rows || []).find(row => atapNum(row.accumulated) >= 0);
            const paybackPositiveYear = firstPositive?.year || null;
            const display = [];
            const addYear = (year) => {
                const row = rowsByYear.get(year);
                if (row) display.push({ type: 'year', row, isPayback: year === paybackPositiveYear });
            };
            const addToggle = (rangeKey, years, collapsedLabel, expandedLabel) => {
                const expanded = !!state[rangeKey];
                display.push({ type: 'toggle', planKey, rangeKey, years, expanded, label: expanded ? expandedLabel : collapsedLabel });
                if (expanded) years.forEach(addYear);
            };

            if (view === '10') {
                Array.from({ length: 10 }, (_, i) => i + 1).forEach(addYear);
                return display;
            }

            [1, 2, 3].forEach(addYear);
            addToggle('y4', [4], 'Show hidden Year 4', 'Hide Year 4');
            addYear(5);
            addToggle('y6to9', [6, 7, 8, 9], 'Show hidden Years 6-9', 'Hide Years 6-9');
            addYear(10);
            addToggle('y11to24', Array.from({ length: 14 }, (_, i) => i + 11), 'Show hidden Years 11-24', 'Hide Years 11-24');
            addYear(25);
            return display;
        };

        const atapRenderCashflow = (planKey, plan, analysis) => {
            atapRenderSnapshotControls(planKey);
            const tbody = document.getElementById(`atap-${plan.domKey}-cashflow`);
            if (!tbody) return;
            const displayRows = window.buildAtapCashflowDisplayRows(planKey, analysis);
            tbody.innerHTML = displayRows.map(item => {
                if (item.type === 'toggle') {
                    const icon = item.expanded ? '−' : '+';
                    return `<tr class="transition-colors">
                        <td colspan="4" class="py-2 px-5">
                            <button type="button" onclick="toggleAtapCashflowRange('${planKey}', '${item.rangeKey}')" class="w-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs font-black text-slate-600 hover:bg-purple-50 hover:text-purple-700">
                                <span class="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white border border-slate-200">${icon}</span>
                                <span>${item.label}</span>
                                <span class="text-slate-400">(${item.years.length} year${item.years.length > 1 ? 's' : ''})</span>
                            </button>
                        </td>
                    </tr>`;
                }
                const r = item.row;
                const rowClass = item.isPayback ? 'text-white' : 'hover:bg-slate-50 transition-colors';
                const rowStyle = item.isPayback ? 'background:#582C83;' : '';
                const mutedClass = item.isPayback ? 'text-white' : 'text-slate-700';
                const strongClass = item.isPayback ? 'text-white' : 'text-slate-800';
                return `<tr class="${rowClass}" style="${rowStyle}">
                    <td class="py-3 px-5 font-bold ${strongClass}">Year ${r.year}</td>
                    <td class="py-3 px-5 text-right font-mono ${mutedClass}">${atapFmtKwh(r.generation)}</td>
                    <td class="py-3 px-5 text-right font-mono ${mutedClass}">RM ${atapFmtMoney(r.annualSaving)}</td>
                    <td class="py-3 px-5 text-right font-black ${strongClass}">RM ${atapFmtMoney(r.accumulated)}</td>
                </tr>`;
            }).join('');
        };

        window.renderAtapFormulaLockPanels = () => {
            const unlocked = !!window.__atapFormulaUnlocked;
            document.querySelectorAll('[data-atap-formula-lock-panel]').forEach(el => {
                if (unlocked) {
                    el.classList.add('hidden');
                    el.style.display = 'none';
                } else {
                    el.classList.remove('hidden');
                    el.style.display = 'block';
                }
            });
            document.querySelectorAll('[data-atap-formula-table]').forEach(el => {
                if (unlocked) {
                    el.classList.remove('hidden');
                    el.style.display = 'block';
                } else {
                    el.classList.add('hidden');
                    el.style.display = 'none';
                }
            });
            document.querySelectorAll('[data-atap-formula-lock-action="lock"]').forEach(el => {
                if (unlocked) {
                    el.classList.remove('hidden');
                    el.style.display = 'inline-flex';
                } else {
                    el.classList.add('hidden');
                    el.style.display = 'none';
                }
            });
        };

        window.unlockAtapFormulaMap = (planKey) => {
            const input = document.querySelector(`[data-atap-formula-password="${planKey}"]`);
            const error = document.querySelector(`[data-atap-formula-error="${planKey}"]`);
            if (String(input?.value || '') !== '0409') {
                if (error) {
                    error.textContent = 'Password incorrect. Please try again.';
                    error.classList.remove('hidden');
                }
                return;
            }
            window.__atapFormulaUnlocked = true;
            document.querySelectorAll('[data-atap-formula-password]').forEach(el => { el.value = ''; });
            document.querySelectorAll('[data-atap-formula-error]').forEach(el => {
                el.textContent = '';
                el.classList.add('hidden');
            });
            window.renderAtapFormulaLockPanels();
            window.recalcAtapViews?.();
        };

        window.lockAtapFormulaMap = () => {
            window.__atapFormulaUnlocked = false;
            document.querySelectorAll('#atap-solar-only-formulas, #atap-solar-battery-formulas').forEach(el => { el.innerHTML = ''; });
            window.renderAtapFormulaLockPanels();
            window.recalcAtapViews?.();
        };

        const atapRenderPlan = (planKey, plan, inputs, sizing, bill, analysis) => {
            atapSetOut(`${planKey}.beforeBill`, atapFmtMoney(bill.beforeBill));
            atapSetOut(`${planKey}.afterBill`, atapFmtMoney(bill.afterBill));
            atapSetOut(`${planKey}.saving`, atapFmtMoney(bill.saving));
            atapSetOut(`${planKey}.savingPct`, atapFmtPct(bill.savingPct));
            atapSetOut(`${planKey}.pvSize`, sizing.pvSizeKwp.toFixed(2));
            atapSetOut(`${planKey}.panelCount`, atapFmtWhole(sizing.panelCount));
            atapSetOut(`${planKey}.initialInvestment`, atapFmtWhole(analysis.initialInvestment));
            atapSetOut(`${planKey}.payback`, analysis.paybackYear ? analysis.paybackYear.toFixed(2) : 'Not within 25Y');

            const breakdownRows = [
                ['Exported Energy', `${atapFmtKwh(bill.exportedEnergy)} kWh`, 'Total Generation x Export Factor'],
                ['Self-Consumed Solar', `${atapFmtKwh(bill.selfConsumedSolar)} kWh`, 'Total Generation - Exported Energy'],
                ['Imported Energy', `${atapFmtKwh(bill.importedEnergy)} kWh`, 'Monthly Usage - Self-Consumed Solar'],
                ['Power Consumption Charge', `RM ${atapFmtMoney(bill.powerCharge)}`, 'Imported Energy x TNB tariff blocks'],
                ['Generation Export Credit', `RM ${atapFmtMoney(bill.exportCredit)}`, `MIN(Imported, Exported) x RM${bill.exportEnergyRate}`],
                ['AFA', `RM ${atapFmtMoney(bill.afa)}`, 'Imported Energy x AFA Rate'],
                ['EEI Rebate', `RM ${atapFmtMoney(bill.eei)}`, '-Imported Energy x EEI Rate'],
                ['ST 8%', `RM ${atapFmtMoney(bill.st)}`, 'Power Consumption Charge x 8%'],
                ['KWTBB 1.6%', `RM ${atapFmtMoney(bill.kwtbb)}`, 'Power Consumption Charge x 1.6%'],
                ['Retail Charge', `RM ${atapFmtMoney(bill.retailCharge)}`, 'Fixed monthly charge']
            ];
            const lockedLogic = '<span class="inline-flex items-center rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Locked</span>';
            atapRenderRows(`atap-${plan.domKey}-breakdown`, breakdownRows, [
                { className: 'py-3 px-5 font-bold text-slate-700', value: r => r[0] },
                { className: 'py-3 px-5 text-right font-mono text-slate-800', value: r => r[1] },
                { className: 'py-3 px-5 text-xs text-slate-500', value: r => window.__atapFormulaUnlocked ? r[2] : lockedLogic }
            ]);

            atapRenderCashflow(planKey, plan, analysis);

            const formulaRows = [
                ['TNB', 'Before Bill', `calcTnbForward(${inputs.monthlyConsumption} kWh).total`, `RM ${atapFmtMoney(bill.beforeBill)}`],
                ['PV Sizing', 'Daily Generation', `Target Generation / 30`, `${sizing.dailyGeneration.toFixed(2)} kWh/day`],
                ['PV Sizing', 'PV Size', `(Daily Generation / Loss Factor) / Peak Sun Hours`, `${sizing.pvSizeKwp.toFixed(2)} kWp`],
                ['PV Sizing', 'Panel Count', `ROUNDUP(PV Size / (${inputs.panelRating} W / 1000), 0)`, `${atapFmtWhole(sizing.panelCount)} pcs`],
                ['ATAP Bill', 'Exported Energy', `Total Generation x ${bill.exportFactor}`, `${atapFmtKwh(bill.exportedEnergy)} kWh`],
                ['ATAP Bill', 'Export Credit', `MIN(Imported, Exported) x RM${bill.exportEnergyRate}`, `RM ${atapFmtMoney(bill.exportCredit)}`],
                ['ATAP Bill', 'Imported Energy', `MAX(Monthly Usage - Self-Consumed Solar, 0)`, `${atapFmtKwh(bill.importedEnergy)} kWh`],
                ['ATAP Bill', 'AFA RM', `Imported Energy x ${plan.afaRate}`, `RM ${atapFmtMoney(bill.afa)}`],
                ['ATAP Bill', 'After Bill', `Power + EEI + AFA + Retail - Export Credit + ST + KWTBB`, `RM ${atapFmtMoney(bill.afterBill)}`],
                ['25Y Analysis', 'Year 1 PV kWh', `Panel kW x Peak Sun Hours x Panels x 365 x 0.777765`, `${atapFmtKwh(analysis.baseGeneration)} kWh`],
                ['25Y Analysis', 'Year 2+ PV kWh', `Year 2 = Year 1 x 0.98; Year 3+ = Year 1 x 0.98 x 0.9975^(Year-2)`, `${atapFmtKwh(analysis.rows[1]?.generation || 0)} kWh in Year 2`],
                ['25Y Analysis', 'Payback Year', `Previous Year + (-Previous Cumulative) / (Current Cumulative - Previous Cumulative)`, analysis.paybackYear ? analysis.paybackYear.toFixed(2) : 'Not within 25Y']
            ];
            if (window.__atapFormulaUnlocked) {
                atapRenderRows(`atap-${plan.domKey}-formulas`, formulaRows, [
                    { className: 'py-3 px-5 font-black uppercase tracking-widest text-slate-400', value: r => r[0] },
                    { className: 'py-3 px-5 font-bold text-slate-700', value: r => r[1] },
                    { className: 'py-3 px-5 font-mono text-[11px] text-slate-600 whitespace-normal', value: r => r[2] },
                    { className: 'py-3 px-5 text-right font-black text-slate-800 whitespace-nowrap', value: r => r[3] }
                ]);
            } else {
                const tbody = document.getElementById(`atap-${plan.domKey}-formulas`);
                if (tbody) tbody.innerHTML = '';
            }
            window.renderAtapFormulaLockPanels();
        };

        window.recalcAtapViews = () => {
            let inputs = window.getAtapInputs();
            const sizing = window.calcPvSizing(inputs);
            if (window.syncAtapInvestmentToSizing?.(sizing)) {
                inputs = window.getAtapInputs();
            }
            Object.entries(window.atapPlans).forEach(([planKey, plan]) => {
                const bill = window.calcAtapBill(plan, inputs);
                const analysis = window.calcAtap25Year(plan, sizing, inputs);
                atapRenderPlan(planKey, plan, inputs, sizing, bill, analysis);
            });
        };

        window.__tnbMode = 'kwhToBill';
        window.__tnbLastEdited = null;

        const tnbPop = (el) => {
            if (!el) return;
            el.classList.remove('tnb-pop');
            void el.offsetWidth;
            el.classList.add('tnb-pop');
            el.addEventListener('animationend', () => el.classList.remove('tnb-pop'), { once: true });
        };

        const tnbSetText = (id, text) => {
            const el = document.getElementById(id);
            if (!el) return;
            const v = String(text);
            if (el.textContent !== v) {
                el.textContent = v;
                tnbPop(el);
            }
        };

        const tnbMoney = (n) => {
            const v = Number(n);
            if (!Number.isFinite(v)) return '0.00';
            return v.toFixed(2);
        };

        const tnbKwhFmt = (n) => {
            const v = Number(n);
            if (!Number.isFinite(v)) return '0.00';
            return v.toFixed(2);
        };

        const tnbAverageFmt = (bill, kwh) => {
            const b = Number(bill);
            const k = Number(kwh);
            if (!Number.isFinite(b) || !Number.isFinite(k) || k <= 0) return '0.0000';
            return (b / k).toFixed(4);
        };

        window.setTnbMode = (mode) => {
            const m = mode === 'billToKwh' ? 'billToKwh' : 'kwhToBill';
            window.__tnbMode = m;
            const btnK = document.getElementById('tnb-mode-btn-kwh');
            const btnB = document.getElementById('tnb-mode-btn-bill');
            const secK = document.getElementById('tnb-mode-kwh');
            const secB = document.getElementById('tnb-mode-bill');
            const setBtn = (btn, active) => {
                if (!btn) return;
                btn.classList.toggle('bg-[#582C83]', !!active);
                btn.classList.toggle('text-white', !!active);
                btn.classList.toggle('shadow-sm', !!active);
                btn.classList.toggle('text-slate-500', !active);
                btn.classList.toggle('hover:text-slate-600', !active);
            };

            setBtn(btnK, m === 'kwhToBill');
            setBtn(btnB, m === 'billToKwh');

            if (secK) {
                if (m === 'kwhToBill') {
                    secK.classList.remove('hidden');
                    secK.style.display = 'block';
                } else {
                    secK.classList.add('hidden');
                    secK.style.display = 'none';
                }
            }
            if (secB) {
                if (m === 'billToKwh') {
                    secB.classList.remove('hidden');
                    secB.style.display = 'block';
                } else {
                    secB.classList.add('hidden');
                    secB.style.display = 'none';
                }
            }
            window.recalcTnbFromActiveInput?.();
        };

        window.onTnbKwhInput = (raw) => {
            window.__tnbLastEdited = 'kwh';
            const s = String(raw ?? '');
            if (!s.trim()) {
                tnbSetText('tnb-out-bill-total', '0.00');
                tnbSetText('tnb-out-energy', '0.00');
                tnbSetText('tnb-out-icpt', '0.00');
                tnbSetText('tnb-out-st', '0.00');
                tnbSetText('tnb-out-total', '0.00');
                tnbSetText('tnb-out-average-kwh', '0.0000');
                return;
            }
            const kwh = Number(s);
            if (!Number.isFinite(kwh)) {
                tnbSetText('tnb-out-bill-total', '0.00');
                tnbSetText('tnb-out-energy', '0.00');
                tnbSetText('tnb-out-icpt', '0.00');
                tnbSetText('tnb-out-st', '0.00');
                tnbSetText('tnb-out-total', '0.00');
                tnbSetText('tnb-out-average-kwh', '0.0000');
                return;
            }
            const r = window.calcTnbForward(kwh);
            tnbSetText('tnb-out-bill-total', tnbMoney(r.total));
            tnbSetText('tnb-out-energy', tnbMoney(r.energyCharge));
            tnbSetText('tnb-out-icpt', tnbMoney(r.icpt));
            tnbSetText('tnb-out-st', tnbMoney(r.st));
            tnbSetText('tnb-out-total', tnbMoney(r.total));
            tnbSetText('tnb-out-average-kwh', tnbAverageFmt(r.total, kwh));
            window.syncAtapUsageFromTnb?.(kwh);
        };

        window.onTnbBillInput = (raw) => {
            window.__tnbLastEdited = 'bill';
            const s = String(raw ?? '');
            const tip = document.getElementById('tnb-deadzone-tip');
            if (!s.trim()) {
                if (tip) {
                    tip.classList.add('hidden');
                    tip.textContent = '';
                }
                tnbSetText('tnb-out-kwh', '0.00');
                tnbSetText('tnb-out-average-bill', '0.0000');
                return;
            }
            const bill = Number(s);
            if (!Number.isFinite(bill)) {
                tnbSetText('tnb-out-kwh', '0.00');
                tnbSetText('tnb-out-average-bill', '0.0000');
                return;
            }
            const r = window.calcTnbReverse(bill);
            if (r.deadZone) {
                if (tip) {
                    tip.classList.remove('hidden');
                    tip.textContent = r.deadZone === '600'
                        ? "This amount is rare due to TNB's 600kWh ICPT policy jump."
                        : "This amount is rare due to TNB's 1500kWh ICPT policy jump.";
                }
                tnbSetText('tnb-out-kwh', 'N/A');
                tnbSetText('tnb-out-average-bill', 'N/A');
                return;
            }
            if (tip) {
                tip.classList.add('hidden');
                tip.textContent = '';
            }
            tnbSetText('tnb-out-kwh', tnbKwhFmt(r.kwh));
            tnbSetText('tnb-out-average-bill', tnbAverageFmt(bill, r.kwh));
            window.syncAtapUsageFromTnb?.(r.kwh);
        };

        window.recalcTnbFromActiveInput = () => {
            if (window.__tnbMode === 'billToKwh') {
                const v = document.getElementById('tnb-bill-input')?.value ?? '';
                window.onTnbBillInput(v);
            } else {
                const v = document.getElementById('tnb-kwh-input')?.value ?? '';
                window.onTnbKwhInput(v);
            }
        };

        let costData = {
            pv: [{ name: 'PV Module', price: 1, freight: 5, importTax: 0, sst: 10, profit: 1.1 }, { name: 'Mounting Structure', price: 0.4, freight: 5, importTax: 0, sst: 10, profit: 1.1 }, { name: 'Inverter', price: 0.275, freight: 5, importTax: 0, sst: 10, profit: 1.1 }, { name: 'Auxiliary Materials', price: 0.2, freight: 5, importTax: 0, sst: 10, profit: 1.1 }, { name: 'Grid Connection Cabinet', price: 0.1, freight: 5, importTax: 0, sst: 10, profit: 1.1 }, { name: 'Installation Management Fee', price: 0.3, freight: 0, importTax: 0, sst: 0, profit: 1.1 }, { name: 'Other Management Fee', price: 0.1, freight: 0, importTax: 0, sst: 0, profit: 1.1 }, { name: 'Installation Fee', price: 0.4, freight: 0, importTax: 0, sst: 0, profit: 1.1 }],
            bat: [{ name: 'Battery Cell', price: 0.55, freight: 5, importTax: 20, sst: 10, profit: 1.2 }, { name: 'Parallel Cabinet & Anti-Reverse Flow', price: 0.2, freight: 5, importTax: 0, sst: 10, profit: 1.2 }, { name: 'Other Materials', price: 0.15, freight: 5, importTax: 0, sst: 10, profit: 1.2 }]
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
                tF.innerHTML = `<tr><td colspan="5" class="py-4 px-4 text-right text-slate-500">Total:</td><td class="py-4 px-4 text-right bg-slate-200/50 font-mono text-slate-800">${sTC.toFixed(4)}</td><td class="py-4 px-4"></td><td class="py-4 px-4 text-right bg-blue-100/50 font-black text-blue-800 text-lg">${sQRmb.toFixed(4)}</td><td class="py-4 px-4 text-right bg-green-100/50 font-black text-green-700">${sQRm.toFixed(4)}</td></tr>`;
            };
            renderG('pv', 'cost-pv-body', 'cost-pv-foot'); renderG('bat', 'cost-bat-body', 'cost-bat-foot');
            recalcInstallerQuote();
        };
        window.fetchLiveRate = async (btn) => {
            if(!btn) return; const oT = btn.innerHTML; btn.innerHTML = 'Fetching...'; btn.disabled = true;
            try { const res = await fetch('https://api.exchangerate-api.com/v4/latest/MYR'); const data = await res.json(); if(data?.rates?.CNY) { document.getElementById('rate-myr-cny').value = data.rates.CNY.toFixed(4); window.refreshFxDependentPricingViews(); } }
            catch(e) { console.error('Failed to fetch exchange rate:', e); } finally { btn.innerHTML = oT; btn.disabled = false; }
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
        try { window.switchPvcalcPage?.('1'); } catch (e) {}
        try { window.setTnbMode?.('kwhToBill'); } catch (e) {}
        try { window.setAtapExportRateEditable?.(false); } catch (e) {}
        try { window.recalcAtapViews?.(); } catch (e) {}
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
        window.renderCurrencyButton?.();
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
            shipEl.value = normalizeQuoteShippingIncludedText(shipEl.value);
            shipEl.addEventListener('input', () => {
                try { localStorage.setItem(`minova_shipping_${currentLang}`, normalizeQuoteShippingIncludedText(shipEl.value)); } catch (e) {}
            });
        }
        try {
            const raw = localStorage.getItem('minova_installer_quote_settings_v1') || localStorage.getItem('minova_installer_quote_v1');
            installerQuoteSettings = normalizeInstallerQuoteSettings(raw ? JSON.parse(raw) : installerQuoteSettings);
            applyInstallerQuoteSettingsToUi();
            localStorage.setItem('minova_installer_quote_settings_v1', JSON.stringify(installerQuoteSettings));
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
        try { recalcInstallerQuote(); } catch (e) {}

        window.__minovaSync = initGitHubSync({
            getLocalState: () => ({
                products,
                inventory,
                inventoryHistory,
                marketPrices,
                salesRecords,
                historicalInventory,
                suppliers,
                channelPartners,
                companyCerts,
                transportRecords,
                fileDeleteLogs,
                compatibilityRules,
                certificationRequirementsCatalog,
                productCertificationEvidence,
                productMasterDetailTemplates,
                subcategoriesByCategory,
                profitSettings,
                installerProfitSettings,
                installerQuoteSettings,
                nonStockPricingStrategies
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
                    marketPrices,
                    salesRecords,
                    historicalInventory,
                    suppliers,
                    channelPartners,
                    companyCerts,
                    transportRecords,
                    fileDeleteLogs,
                    compatibilityRules,
                    certificationRequirementsCatalog,
                    productCertificationEvidence,
                    productMasterDetailTemplates,
                    subcategoriesByCategory,
                    profitSettings,
                    installerProfitSettings,
                    installerQuoteSettings,
                    nonStockPricingStrategies
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
        renderTopLevelData(getActiveTopLevelTab(), { force: true });
        scheduleDeferredTopLevelRenders();
        startPublishedStatePolling();
        tryLoadPublishedState(true);

        window.toggleCompanyCertPanel = () => {
            const body = document.getElementById('company-cert-body');
            const btn = document.getElementById('btn-toggle-company-cert');
            const isHidden = body.classList.contains('hidden');
            body.classList.toggle('hidden', !isHidden);
            btn.textContent = isHidden ? 'Collapse' : 'Expand';
            if (isHidden) renderCompanyCertList();
        };

        window.renderCompanyCertUploadSelectors = () => {
            const safe = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

            const isoSel = document.getElementById('iso-cert-vendor-select');
            if (isoSel) {
                const cur = String(isoSel.value || '');
                ensureSupplierData();
                const vendors = [...new Set((Array.isArray(suppliers) ? suppliers : []).map(s => getSupplierDisplayName(s)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
                isoSel.innerHTML = `<option value="">SelectSupplier</option>` + vendors.map(v => `<option value="${safe(v)}">${safe(v)}</option>`).join('') + `<option value="未指定">未指定</option>`;
                if (cur && (vendors.includes(cur) || cur === '未指定')) isoSel.value = cur;
                isoSel.onchange = () => { try { renderCompanyCertList(); } catch (e) {} };
            }

            const trSel = document.getElementById('transport-cert-transport-select');
            if (trSel) {
                const cur = String(trSel.value || '');
                const rows = (Array.isArray(transportRecords) ? transportRecords : []).slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
                trSel.innerHTML = `<option value="">SelectTransport Order No.</option>` + rows.map(r => {
                    const lines = Array.isArray(r?.lines) ? r.lines : [];
                    const batches = [...new Set(lines.map(l => String(l?.batchNo || '').trim()).filter(Boolean))];
                    let batchBrief = '';
                    if (batches.length === 0) batchBrief = 'None批次';
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
                        empty.textContent = '请先SelectSupplier后查看已上传文件';
                    } else {
                        const vendorK = normKey(vendor);
                        files = files.filter(f => normKey(f?.vendor) === vendorK);
                        empty.textContent = files.length ? '' : `未找到该Supplier已上传的文件（${vendor}）`;
                    }
                } else {
                    const transportId = norm(document.getElementById('transport-cert-transport-select')?.value || '');
                    if (!transportId) {
                        files = [];
                        empty.textContent = '请先SelectTransport Order No.后查看已上传文件';
                    } else {
                        const rec = (Array.isArray(transportRecords) ? transportRecords : []).find(r => norm(r?.id) === transportId) || {};
                        const trackingNo = norm(rec?.trackingNo);
                        files = files.filter(f => norm(f?.transportId) === transportId || (trackingNo && norm(f?.trackingNo) === trackingNo));
                        empty.textContent = files.length ? '' : '未找到该Transport Order No.已上传的文件';
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
                        btn.textContent = 'Delete';
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
                if (!vendor) return alert('请先SelectSupplier');
                meta.vendor = vendor;
            } else if (t === 'transport') {
                const transportId = String(document.getElementById('transport-cert-transport-select')?.value || '').trim();
                if (!transportId) return alert('请先SelectTransport Order No.');
                const rec = (Array.isArray(transportRecords) ? transportRecords : []).find(r => String(r.id) === transportId) || {};
                const trackingNo = String(rec.trackingNo || '').trim();
                if (!trackingNo) return alert('This transport record has no transport order no.');
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
            if (!m) throw new Error('None法提取 state 快照');
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
            if (!owner || !repo) throw new Error('缺少Warehouse配置');

            const html = window.buildUpdatedHtml?.();
            if (!html) throw new Error('None法生成更新后的 HTML');
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
            if (!confirm('确定Delete该文件？')) return;
            const s = window.__minovaSync?.getStatus?.();
            if (!s?.connected) return alert('请先连接 GitHub（需要同步Delete线上文件）');

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
                alert('Delete失败：' + String(e?.message || e || ''));
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
                persistEntityToD1('product', p.id, p);
                renderProductCertsInModal();
            } catch (err) {
                alert('上传失败: ' + err.message);
            }
        };

        window.openProductCertificationEvidenceUpload = (productId, recordId) => {
            if (!canManageEngineeringRecord('upload')) return alert('No engineering upload permission.');
            const pid = String(productId || '').trim();
            const rid = String(recordId || '').trim();
            if (!pid || !rid) return;
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx';
            input.onchange = async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                await window.uploadProductCertificationEvidence(pid, rid, file);
            };
            input.click();
        };

        window.uploadProductCertificationEvidence = async (productId, recordId, file) => {
            if (!canManageEngineeringRecord('upload')) return alert('No engineering upload permission.');
            const pid = String(productId || '').trim();
            const rid = String(recordId || '').trim();
            if (!pid || !rid || !file) return;
            const status = window.__minovaSync?.getStatus?.();
            if (!status?.connected || !window.__minovaSync?.repo?.commitTextFiles) {
                alert('Please connect GitHub before uploading certification evidence files.');
                return;
            }
            try {
                const arrayBuffer = await file.arrayBuffer();
                const bytes = new Uint8Array(arrayBuffer);
                const digest = await crypto.subtle.digest('SHA-256', arrayBuffer);
                const hashHex = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
                let binary = '';
                for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
                const content = btoa(binary);
                const safeRecordId = rid.replace(/[^A-Za-z0-9_-]/g, '_');
                const path = `minova-data/certifications/products/${pid}/${safeRecordId}/${file.name}`;
                const { owner, repo, branch } = window.__minovaSync.config || {};
                await window.__minovaSync.repo.commitTextFiles({
                    owner, repo, branch,
                    message: `minova: upload certification evidence ${pid} ${rid} ${file.name}`,
                    files: [{ path, content, encoding: 'base64' }]
                });
                const existing = productCertificationEvidenceFor(pid, rid)[0] || {};
                const fileRef = {
                    id: crypto.randomUUID(),
                    name: file.name,
                    path,
                    size: file.size,
                    contentType: file.type || '',
                    sha256: hashHex,
                    uploadedAt: new Date().toISOString()
                };
                upsertProductCertificationEvidence({
                    ...existing,
                    id: existing.id || `${pid}:${rid}`,
                    productId: pid,
                    requirementRecordId: rid,
                    status: existing.status && existing.status !== 'Pending Evidence' ? existing.status : 'Evidence Uploaded',
                    evidenceAvailable: 'Yes',
                    verificationStatus: existing.verificationStatus && existing.verificationStatus !== 'Not Reviewed' ? existing.verificationStatus : 'Pending Review',
                    fileRefs: [...(Array.isArray(existing.fileRefs) ? existing.fileRefs : []), fileRef],
                    updatedAt: new Date().toISOString()
                });
                window.openProductCertificationEvidence(pid, rid);
            } catch (err) {
                alert('Evidence upload failed: ' + String(err?.message || err || ''));
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
            if (!confirm('确定Delete？')) return;
            const s = window.__minovaSync?.getStatus?.();
            if (!s?.connected) return alert('请先连接 GitHub（需要同步Delete线上文件）');

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
                persistEntityToD1('product', p.id, p);
                renderProductCertsInModal();
                try { if (document.getElementById('cert-attachment-modal')) renderProductCertCheckboxes(); } catch (e) {}
                try { if (document.getElementById('cert-attachment-modal')) updateCertSelectedSummary(); } catch (e) {}
            } catch (e) {
                try { arr.splice(0, arr.length, ...JSON.parse(before)); } catch (e2) {}
                try { fileDeleteLogs = JSON.parse(beforeLogs); } catch (e2) {}
                saveToLocal();
                renderProductCertsInModal();
                alert('Delete失败：' + String(e?.message || e || ''));
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
                isoContainer.innerHTML = '<p class="text-xs text-slate-400">Quote表未Select Product，暂不显示公司级认证文件</p>';
                transportContainer.innerHTML = '<p class="text-xs text-slate-400">Quote表未Select Product，暂不显示公司级认证文件</p>';
                updateCertSectionCount('company');
                return;
            }
            if (isoCerts.length === 0) {
                isoContainer.innerHTML = '<p class="text-xs text-slate-400">暂None文件</p>';
            } else {
                if (vendorsInQuote.size) {
                    const matchedIso = isoCerts.filter(f => vendorsInQuote.has(norm(f?.vendor)));
                    if (!matchedIso.length) {
                        isoContainer.innerHTML = `<p class="text-xs text-slate-400">未找到匹配的工厂ISO认证文件（Supplier：${[...vendorsInQuote].join(', ')}）。请先上传并绑定Supplier。</p>`;
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
                transportContainer.innerHTML = '<p class="text-xs text-slate-400">暂None文件</p>';
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
                        transportContainer.innerHTML = `<p class="text-xs text-slate-400">未找到匹配的Transport Files（Purchase Batch：${[...batchesInQuote].join(', ')}）。请先创建Transport单并上传Transport Files绑定到对应Transport Order No.。</p>`;
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
                                <span class="text-xs text-slate-400">Spec书</span>
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
                        const vv = String(getProductSupplierDisplay(p) || '').trim();
                        if (vv) vendors.add(vv);
                    } else {
                        const descVal = String(r.description || '').trim().toLowerCase();
                        if (descVal) {
                            for (const p of (Array.isArray(products) ? products : [])) {
                                if (!p || !p.name) continue;
                                const pName = String(p.name || '').toLowerCase();
                                const pId = String(p.id || '').toLowerCase();
                                if (descVal.includes(pName) || descVal === pId || (pId && descVal.startsWith(pId))) {
                                    const vv = String(getProductSupplierDisplay(p) || '').trim();
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

        window.onRotateSiteOverviewPrintChanged = (checked) => {
            if (checked) showToast('已开启：Export PDF 时第 5 页画布将向右旋转 90°（仅影响PDF，不影响网页显示）', 'info');
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
            if (!owner || !repo) throw new Error('未连接 GitHub，None法下载附件');
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
            const rotateSiteOverview = !!document.getElementById('qa-rotate-siteoverview')?.checked;
            if (rotateSiteOverview) showToast('提示：本次Export第 5 页画布将向右旋转 90°（仅影响PDF）', 'info');

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
                showToast('当前环境未加载 PDFLib，None法生成合并文件', 'error');
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
                const StandardFonts = PDFLibRef.StandardFonts;
                const rgb = PDFLibRef.rgb;
                const degrees = PDFLibRef.degrees;
                let pdfHeaderFont = null;
                let pdfHeaderFontBold = null;
                let pdfHeaderLogoImg = null;
                let pdfHeaderLogoDims = null;
                let pdfHeaderLogoTried = false;

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
                            const exportingPageNum = parseInt(String(window.__pdfExportingPageNum ?? ''), 10);
                            const roofSnap = String(window.__pdfRoofSnapshotDataUrl || '');
                            const useRoofSnap = exportingPageNum === 5 && !!roofSnap;

                            const wrappers = clonedDoc.querySelectorAll('.quote-page');
                            wrappers.forEach(page => {
                                if (page.style.display !== 'none' && !page.classList.contains('hidden')) {
                                    page.style.boxShadow = 'none';
                                    page.style.border = 'none';
                                    page.style.margin = '0 auto';
                                    page.style.borderRadius = '0';
                                    page.style.boxSizing = 'border-box';
                                    page.style.minHeight = exportingPageNum === 1 ? 'auto' : '297mm';
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
                            clonedDoc.querySelectorAll('#quote-body tr.quote-detail-row').forEach(row => {
                                try {
                                    const rowId = String(row.getAttribute('data-quote-row-id') || '').trim();
                                    const liveRow = (Array.isArray(quoteRows) ? quoteRows : []).find(r => String(r?.id || '') === rowId) || null;
                                    const product = liveRow?.productId ? (Array.isArray(products) ? products : []).find(p => String(p?.id || '') === String(liveRow.productId)) : null;
                                    const descField = row.querySelector('textarea');
                                    const desc = String(descField?.value || descField?.textContent || row.children?.[1]?.textContent || '').trim().toLowerCase();
                                    const qtyCell = row.children?.[4];
                                    if (!qtyCell) return;
                                    if (desc.includes('skylift, labour installation, testing & commissioning')) {
                                        qtyCell.innerHTML = '<span class="block text-center font-medium text-slate-700">1</span>';
                                        return;
                                    }
                                    const rowSpec = String(liveRow?.spec || row.children?.[3]?.textContent || '').trim();
                                    const hay = `${product?.category || ''} ${product?.name || ''} ${product?.spec || ''} ${liveRow?.description || ''} ${liveRow?.spec || ''} ${desc} ${rowSpec}`.toLowerCase();
                                    const hasPanelRating = /(\d+(?:\.\d+)?)\s*(?:wp|w)(?!h)/i.test(hay) || /(\d+(?:\.\d+)?)\s*瓦/.test(hay);
                                    const isPv = hay.includes('光伏Module') || hay.includes('PV Module') || hay.includes('photovoltaic') || hay.includes('solar panel') || hay.includes('pv module') || (hay.includes('panel') && hasPanelRating) || (hay.includes('Module') && hasPanelRating);
                                    const isInverter = hay.includes('Inverter') || hay.includes('inverter');
                                    if (isPv) {
                                        const panelCount = String(document.getElementById('quote-panel-count')?.textContent || '').trim() || String(liveRow?.quantity || '');
                                        qtyCell.innerHTML = `<span class="block text-center font-medium text-slate-700">${panelCount}</span>`;
                                    } else if (isInverter) {
                                        const currentQty = String(liveRow?.quantity ?? qtyCell.textContent ?? '').trim();
                                        qtyCell.innerHTML = `<span class="block text-center font-medium text-slate-700">${currentQty}</span>`;
                                    }
                                } catch (e) {}
                            });

                            const style = clonedDoc.createElement('style');
                            style.innerHTML = `
                                @page { size: A4; margin: 0; }
                                input, textarea { overflow-wrap: break-word !important; word-break: normal !important; hyphens: none !important; }
                                textarea { white-space: pre-wrap !important; overflow: visible !important; }
                                #val-terms { white-space: pre-wrap !important; }
                                tr, h1, h2, h3, h4, h5, h6 { page-break-inside: avoid !important; break-inside: avoid !important; }
                                .grand-total-container, .grand-total-container * { page-break-inside: avoid !important; break-inside: avoid !important; }
                                .total-pill { page-break-inside: avoid !important; break-inside: avoid !important; }
                                .signature-container { page-break-inside: avoid !important; break-inside: avoid !important; margin-bottom: 0 !important; }
                                .reference-hero-media { display: flex !important; align-items: center !important; justify-content: center !important; width: 100% !important; height: 390px !important; background: #f8fafc !important; }
                                .reference-hero-media img { width: auto !important; height: auto !important; max-width: 100% !important; max-height: 390px !important; object-fit: contain !important; object-position: center center !important; }
                                .pv-module .resize-handle, .pv-module .delete-btn { display: none !important; }
                            `;
                            clonedDoc.head.appendChild(style);

                            try {
                                const win = clonedDoc.defaultView || window;
                                try {
                                    if (useRoofSnap) {
                                        const grid = clonedDoc.getElementById('roof-editor-grid');
                                        if (grid) {
                                            grid.innerHTML = '';
                                            grid.style.display = 'block';
                                            const img = clonedDoc.createElement('img');
                                            img.src = roofSnap;
                                            img.style.position = 'absolute';
                                            img.style.left = '0';
                                            img.style.top = '0';
                                            img.style.right = '0';
                                            img.style.bottom = '0';
                                            img.style.width = '100%';
                                            img.style.height = '100%';
                                            img.style.objectFit = 'contain';
                                            img.style.objectPosition = 'left top';
                                            img.style.display = 'block';
                                            const prevPos = grid.style.position;
                                            if (!prevPos) grid.style.position = 'relative';
                                            grid.appendChild(img);
                                        }
                                    }
                                } catch (e) {}
                                try {
                                    if (!useRoofSnap) {
                                        const viewport = clonedDoc.getElementById('roof-viewport');
                                        const img = clonedDoc.getElementById('roof-image');
                                        if (viewport && img) {
                                            const vr = viewport.getBoundingClientRect ? viewport.getBoundingClientRect() : null;
                                            const vw = (vr?.width || 0) || (viewport.clientWidth || 0);
                                            const vh = (vr?.height || 0) || (viewport.clientHeight || 0);
                                            const iw = parseFloat(String(img.dataset.iw || img.naturalWidth || '0')) || 0;
                                            const ih = parseFloat(String(img.dataset.ih || img.naturalHeight || '0')) || 0;
                                            if (vw && vh && iw && ih) {
                                                const s = Math.min(vw / iw, vh / ih);
                                                const w = iw * s;
                                                const h = ih * s;
                                                img.style.right = 'auto';
                                                img.style.bottom = 'auto';
                                                img.style.left = '0';
                                                img.style.top = '0';
                                                img.style.width = `${w}px`;
                                                img.style.height = `${h}px`;
                                                img.style.objectFit = 'contain';
                                                img.style.objectPosition = 'left top';
                                            }
                                        }
                                    }
                                } catch (e) {}
                                try {
                                    if (!useRoofSnap) {
                                        const parseClipPoly = (s) => {
                                            const m = String(s || '').match(/polygon\((.+)\)/);
                                            if (!m) return null;
                                            const pts = m[1].split(',').map((raw) => {
                                                const parts = String(raw || '').trim().split(/\s+/).filter(Boolean);
                                                if (parts.length < 2) return null;
                                                const x = parseFloat(parts[0]);
                                                const y = parseFloat(parts[1]);
                                                if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
                                                return { x, y };
                                            }).filter(Boolean);
                                            return pts.length >= 3 ? pts : null;
                                        };
                                        const shapes = Array.from(clonedDoc.querySelectorAll('.pv-module.is-custom .pv-module-shape'));
                                        shapes.forEach((shape) => {
                                            const cs = win.getComputedStyle ? win.getComputedStyle(shape) : null;
                                            const clip = shape.style.clipPath || (cs ? cs.clipPath : '') || '';
                                            const pts = parseClipPoly(clip);
                                            if (!pts) return;
                                            const svg = clonedDoc.createElementNS('http://www.w3.org/2000/svg', 'svg');
                                            svg.setAttribute('viewBox', '0 0 100 100');
                                            svg.setAttribute('preserveAspectRatio', 'none');
                                            svg.style.position = 'absolute';
                                            svg.style.inset = '0';
                                            svg.style.width = '100%';
                                            svg.style.height = '100%';
                                            const poly = clonedDoc.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                                            poly.setAttribute('points', pts.map(p => `${p.x},${p.y}`).join(' '));
                                            const fill = cs ? String(cs.backgroundColor || 'transparent') : 'transparent';
                                            const stroke = cs ? String(cs.borderTopColor || 'rgba(15,23,42,0.25)') : 'rgba(15,23,42,0.25)';
                                            const sw = cs ? (parseFloat(String(cs.borderTopWidth || '1')) || 1) : 1;
                                            poly.setAttribute('fill', fill);
                                            poly.setAttribute('stroke', stroke);
                                            poly.setAttribute('stroke-width', String(sw));
                                            poly.setAttribute('vector-effect', 'non-scaling-stroke');
                                            svg.appendChild(poly);
                                            shape.replaceWith(svg);
                                        });
                                    }
                                } catch (e) {}
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
                                    repl.style.overflowWrap = 'break-word';
                                    repl.style.wordBreak = 'normal';
                                    repl.style.hyphens = 'none';
                                    repl.style.overflow = 'visible';
                                    repl.style.background = 'transparent';
                                    repl.style.height = 'auto';
	                                    ta.replaceWith(repl);
	                                });
	                                try { window.applyQuotePdfPageBreaks?.(clonedDoc); } catch (e) {}
	                            } catch (e) {}
	                        }
                    },
                    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait', compress: true }
                };

                const buildRoofSnapshotForPdf = async () => {
                    try {
                        const grid = document.getElementById('roof-editor-grid');
                        const viewport = document.getElementById('roof-viewport');
                        const img = document.getElementById('roof-image');
                        if (!grid || !viewport || !img || !siteOverview) return '';
                        const r0 = grid.getBoundingClientRect ? grid.getBoundingClientRect() : null;
                        const w0 = r0?.width || grid.offsetWidth || 0;
                        const h0 = r0?.height || grid.offsetHeight || 0;
                        if (!w0 || !h0) return '';

                        const scale = 4;
                        const canvas = document.createElement('canvas');
                        canvas.width = Math.max(1, Math.round(w0 * scale));
                        canvas.height = Math.max(1, Math.round(h0 * scale));
                        const ctx = canvas.getContext('2d');
                        if (!ctx) return '';
                        ctx.scale(scale, scale);
                        ctx.imageSmoothingEnabled = true;
                        ctx.imageSmoothingQuality = 'high';

                        const ruler = 20;
                        const vp = { x: ruler, y: ruler, w: Math.max(0, w0 - ruler), h: Math.max(0, h0 - ruler) };

                        const roofWm = parsePositiveFloat(siteOverview.roof?.widthM, 1);
                        const roofHm = parsePositiveFloat(siteOverview.roof?.heightM, 1);

                        ctx.fillStyle = '#ffffff';
                        ctx.fillRect(0, 0, w0, h0);

                        const drawRoundRect = (x, y, w, h, r) => {
                            const rr = Math.max(0, Math.min(r, w / 2, h / 2));
                            ctx.beginPath();
                            ctx.moveTo(x + rr, y);
                            ctx.arcTo(x + w, y, x + w, y + h, rr);
                            ctx.arcTo(x + w, y + h, x, y + h, rr);
                            ctx.arcTo(x, y + h, x, y, rr);
                            ctx.arcTo(x, y, x + w, y, rr);
                            ctx.closePath();
                        };

                        const computeBgRect = (vw, vh, iw, ih) => {
                            const s = Math.min(vw / iw, vh / ih);
                            const w = iw * s;
                            const h = ih * s;
                            return { x: 0, y: 0, w, h, vw, vh };
                        };

                        const bgIw = img.naturalWidth || parseFloat(String(img.dataset.iw || '0')) || 0;
                        const bgIh = img.naturalHeight || parseFloat(String(img.dataset.ih || '0')) || 0;
                        if (!img.complete) {
                            await new Promise(r => {
                                img.onload = () => r();
                                img.onerror = () => r();
                            });
                        }
                        const bgRect = (vp.w && vp.h && bgIw && bgIh) ? computeBgRect(vp.w, vp.h, bgIw, bgIh) : { x: 0, y: 0, w: vp.w, h: vp.h, vw: vp.w, vh: vp.h };
                        const pxPerM = Math.min((bgRect.w || 1) / roofWm, (bgRect.h || 1) / roofHm);
                        const worldToPxExport = (xM, yM) => ({ x: vp.x + bgRect.x + xM * pxPerM, y: vp.y + bgRect.y + yM * pxPerM });

                        const show = !!siteOverview.settings?.showRulers;
                        const step = parsePositiveFloat(siteOverview.settings?.gridStepM, 1);
                        let minorStep = step / 10;
                        const minorPx = minorStep * pxPerM;
                        if (!Number.isFinite(minorPx) || minorPx < 4) minorStep = 0;
                        const tickEvery = minorStep ? minorStep : step;
                        const maxTicksX = tickEvery > 0 ? Math.ceil(roofWm / tickEvery) : 0;
                        const maxTicksY = tickEvery > 0 ? Math.ceil(roofHm / tickEvery) : 0;
                        if (maxTicksX > 6000 || maxTicksY > 6000) minorStep = 0;
                        const majorPx = step * pxPerM;
                        const labelEvery = majorPx > 0 ? Math.ceil(40 / majorPx) : 1;

                        if (show) {
                            ctx.strokeStyle = 'rgba(148,163,184,0.25)';
                            ctx.lineWidth = 1;
                            for (let m = 0; m <= roofWm + 1e-6; m += step) {
                                const x = vp.x + m * pxPerM;
                                ctx.beginPath();
                                ctx.moveTo(x, vp.y);
                                ctx.lineTo(x, vp.y + vp.h);
                                ctx.stroke();
                            }
                            for (let m = 0; m <= roofHm + 1e-6; m += step) {
                                const y = vp.y + m * pxPerM;
                                ctx.beginPath();
                                ctx.moveTo(vp.x, y);
                                ctx.lineTo(vp.x + vp.w, y);
                                ctx.stroke();
                            }

                            ctx.fillStyle = '#ffffff';
                            ctx.fillRect(0, 0, w0, ruler);
                            ctx.fillRect(0, 0, ruler, h0);
                            ctx.strokeStyle = 'rgba(148,163,184,0.7)';
                            ctx.beginPath();
                            ctx.moveTo(ruler, ruler);
                            ctx.lineTo(w0, ruler);
                            ctx.moveTo(ruler, ruler);
                            ctx.lineTo(ruler, h0);
                            ctx.stroke();

                            const drawTicksX = minorStep ? minorStep : step;
                            for (let m = 0, idx = 0; m <= roofWm + 1e-6; m += drawTicksX, idx++) {
                                const isMajor = Math.abs((m / step) - Math.round(m / step)) < 1e-6;
                                const x = vp.x + m * pxPerM;
                                ctx.strokeStyle = isMajor ? 'rgba(100,116,139,0.45)' : 'rgba(148,163,184,0.35)';
                                ctx.lineWidth = 1;
                                ctx.beginPath();
                                ctx.moveTo(x, isMajor ? 0 : ruler * 0.6);
                                ctx.lineTo(x, ruler);
                                ctx.stroke();
                                if (isMajor) {
                                    const majorIdx = Math.round(m / step);
                                    if (majorIdx % labelEvery === 0) {
                                        ctx.fillStyle = 'rgba(71,85,105,0.9)';
                                        ctx.font = '700 8px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
                                        ctx.fillText(String(Math.round(m * 1000) / 1000), x + 2, 10);
                                    }
                                }
                            }

                            const drawTicksY = minorStep ? minorStep : step;
                            for (let m = 0, idx = 0; m <= roofHm + 1e-6; m += drawTicksY, idx++) {
                                const isMajor = Math.abs((m / step) - Math.round(m / step)) < 1e-6;
                                const y = vp.y + m * pxPerM;
                                ctx.strokeStyle = isMajor ? 'rgba(100,116,139,0.45)' : 'rgba(148,163,184,0.35)';
                                ctx.lineWidth = 1;
                                ctx.beginPath();
                                ctx.moveTo(isMajor ? 0 : ruler * 0.6, y);
                                ctx.lineTo(ruler, y);
                                ctx.stroke();
                                if (isMajor) {
                                    const majorIdx = Math.round(m / step);
                                    if (majorIdx % labelEvery === 0) {
                                        ctx.fillStyle = 'rgba(71,85,105,0.9)';
                                        ctx.font = '700 8px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
                                        ctx.fillText(String(Math.round(m * 1000) / 1000), 2, y - 2);
                                    }
                                }
                            }
                        }

                        if (bgIw && bgIh) {
                            ctx.drawImage(img, vp.x + bgRect.x, vp.y + bgRect.y, bgRect.w, bgRect.h);
                        }

                        const alpha = clamp(parseFloat(String(siteOverview.settings?.moduleOpacity ?? 0.35)), 0.05, 1.0);
                        const drawPoly = (pts, fill, stroke, sw) => {
                            if (!Array.isArray(pts) || pts.length < 3) return;
                            ctx.beginPath();
                            ctx.moveTo(pts[0].x, pts[0].y);
                            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
                            ctx.closePath();
                            if (fill && fill !== 'transparent') {
                                ctx.fillStyle = fill;
                                ctx.fill();
                            }
                            if (stroke) {
                                ctx.strokeStyle = stroke;
                                ctx.lineWidth = sw || 1;
                                ctx.stroke();
                            }
                        };

                        const modules = Array.isArray(siteOverview.modules) ? siteOverview.modules : [];
                        modules.forEach((m) => {
                            const type = String(m?.type || 'pv');
                            const dims = getModuleDimsM(m);
                            if (type === 'pv') {
                                const p = worldToPxExport(parsePositiveFloat(m.xM, 0), parsePositiveFloat(m.yM, 0));
                                const w = dims.wM * pxPerM;
                                const h = dims.hM * pxPerM;
                                ctx.fillStyle = `rgba(88, 44, 131, ${alpha})`;
                                ctx.fillRect(p.x, p.y, w, h);
                                ctx.strokeStyle = '#4B236F';
                                ctx.lineWidth = 2;
                                ctx.strokeRect(p.x, p.y, w, h);
                                ctx.fillStyle = '#ffffff';
                                ctx.font = '900 14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
                                const t = 'PV';
                                const tw = ctx.measureText(t).width;
                                ctx.fillText(t, p.x + (w - tw) / 2, p.y + h / 2 + 5);
                                return;
                            }
                            if (type === 'custom') {
                                const bg = m.bgColor ? hexToRgba(m.bgColor, alpha) : 'transparent';
                                const stroke = 'rgba(15,23,42,0.25)';
                                const shape = String(m.shape || (m.polyN ? 'polygon' : 'rect'));
                                const ptsW = (Array.isArray(m.points) && m.points.length >= 3)
                                    ? m.points
                                    : getCustomShapePointsFromRect(shape, m.xM, m.yM, dims.wM, dims.hM, m.polyN);
                                const pts = ptsW.map(p => worldToPxExport(p.xM, p.yM));
                                drawPoly(pts, bg, stroke, 2);
                                const labelText = String(m.text || '').trim();
                                if (labelText) {
                                    const c0 = polygonCentroidM(ptsW) || { xM: m.xM + dims.wM / 2, yM: m.yM + dims.hM / 2 };
                                    const cp = worldToPxExport(c0.xM, c0.yM);
                                    ctx.fillStyle = String(m.textColor || siteOverview.settings?.labelColor || '#FFFFFF');
                                    ctx.font = '900 12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
                                    const tw = ctx.measureText(labelText).width;
                                    ctx.fillText(labelText, cp.x - tw / 2, cp.y + 4);
                                }
                            }
                        });

                        const drawMarkerCanvas = (p, style, color) => {
                            const s = String(style || 'cross');
                            ctx.strokeStyle = color;
                            ctx.fillStyle = color;
                            ctx.lineWidth = 2;
                            if (s === 'diamond') {
                                ctx.save();
                                ctx.translate(p.x, p.y);
                                ctx.rotate(Math.PI / 4);
                                ctx.fillRect(-5, -5, 10, 10);
                                ctx.restore();
                                return;
                            }
                            if (s === 'cross') {
                                ctx.beginPath();
                                ctx.moveTo(p.x - 6, p.y);
                                ctx.lineTo(p.x + 6, p.y);
                                ctx.moveTo(p.x, p.y - 6);
                                ctx.lineTo(p.x, p.y + 6);
                                ctx.stroke();
                                return;
                            }
                            ctx.beginPath();
                            ctx.arc(p.x, p.y, 5, 0, 2 * Math.PI);
                            ctx.fill();
                        };

                        const drawArrowCanvas = (tip, toward, color) => {
                            const dx = (toward?.x ?? tip.x) - tip.x;
                            const dy = (toward?.y ?? tip.y) - tip.y;
                            const ang = Math.atan2(dy, dx);
                            ctx.save();
                            ctx.translate(tip.x, tip.y);
                            ctx.rotate(ang);
                            ctx.fillStyle = color;
                            ctx.beginPath();
                            ctx.moveTo(0, 0);
                            ctx.lineTo(10, 4);
                            ctx.lineTo(10, -4);
                            ctx.closePath();
                            ctx.fill();
                            ctx.restore();
                        };

                        const drawPill = (x, y, text) => {
                            ctx.font = '700 10px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
                            const tw = ctx.measureText(text).width;
                            const padX = 6;
                            const padY = 3;
                            const w = tw + padX * 2;
                            const h = 16;
                            drawRoundRect(x - w / 2, y - h / 2, w, h, 8);
                            ctx.fillStyle = 'rgba(15,23,42,0.82)';
                            ctx.fill();
                            ctx.fillStyle = '#ffffff';
                            ctx.fillText(text, x - tw / 2, y + 3);
                        };

                        const ms = Array.isArray(siteOverview.measurements) ? siteOverview.measurements : [];
                        ms.forEach((m) => {
                            if (m?.type === 'dist' && m.a && m.b) {
                                const p1 = worldToPxExport(m.a.xM, m.a.yM);
                                const p2 = worldToPxExport(m.b.xM, m.b.yM);
                                const style = m.markerStyle || siteOverview.settings?.distMarkerStyle || 'cross';
                                const base = String(m.color || siteOverview.settings?.distColor || '#582C83');
                                const c = hexToRgba(base, 0.95) || 'rgba(88,44,131,0.95)';
                                ctx.beginPath();
                                ctx.moveTo(p1.x, p1.y);
                                ctx.lineTo(p2.x, p2.y);
                                ctx.strokeStyle = 'rgba(0,0,0,0.35)';
                                ctx.lineWidth = 6;
                                ctx.stroke();
                                ctx.strokeStyle = c;
                                ctx.lineWidth = 3;
                                ctx.stroke();
                                if (String(style) === 'arrow_a') {
                                    drawArrowCanvas(p1, p2, 'rgba(0,0,0,0.35)');
                                    drawArrowCanvas(p1, p2, c);
                                } else if (String(style) === 'arrow_b') {
                                    drawArrowCanvas(p2, p1, 'rgba(0,0,0,0.35)');
                                    drawArrowCanvas(p2, p1, c);
                                } else if (String(style) === 'arrow_ab') {
                                    drawArrowCanvas(p1, p2, 'rgba(0,0,0,0.35)');
                                    drawArrowCanvas(p2, p1, 'rgba(0,0,0,0.35)');
                                    drawArrowCanvas(p1, p2, c);
                                    drawArrowCanvas(p2, p1, c);
                                } else {
                                    drawMarkerCanvas(p1, style, 'rgba(0,0,0,0.35)');
                                    drawMarkerCanvas(p2, style, 'rgba(0,0,0,0.35)');
                                    drawMarkerCanvas(p1, style, c);
                                    drawMarkerCanvas(p2, style, c);
                                }
                                const dx = m.b.xM - m.a.xM;
                                const dy = m.b.yM - m.a.yM;
                                const d = Math.sqrt(dx * dx + dy * dy);
                                const text = formatDistanceM(d + getDistExtraLenM(style));
                                drawPill((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, text);
                            }
                            if (m?.type === 'area') {
                                const vc = clamp(parseInt(String(siteOverview.settings?.areaVertexCount ?? 4), 10) || 4, 4, 12);
                                const ptsW = Array.isArray(m.points) && m.points.length >= 3 ? m.points : (m.a && m.b ? (vc === 4 ? getRectPointsFromAB(m.a, m.b) : getRegularPolygonPointsFromRect(m.a, m.b, vc)) : []);
                                if (ptsW.length < 3) return;
                                const pts = ptsW.map(p => worldToPxExport(p.xM, p.yM));
                                const baseFill = String(m.bgColor || siteOverview.settings?.areaDefaultBgColor || '#FFC107');
                                const opacity0 = clamp(parseFloat(String(m.opacity ?? siteOverview.settings?.areaDefaultOpacity ?? 0.18)), 0.05, 1);
                                const opacity = Math.max(0.22, opacity0);
                                const fill = hexToRgba(baseFill, opacity) || 'rgba(255,193,7,0.18)';
                                ctx.beginPath();
                                ctx.moveTo(pts[0].x, pts[0].y);
                                for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
                                ctx.closePath();
                                ctx.fillStyle = fill;
                                ctx.fill();
                                ctx.strokeStyle = 'rgba(0,0,0,0.35)';
                                ctx.lineWidth = 6;
                                ctx.stroke();
                                ctx.strokeStyle = 'rgba(88,44,131,0.95)';
                                ctx.lineWidth = 3;
                                ctx.stroke();
                                const area0 = polygonAreaM2(ptsW);
                                const perim0 = polygonPerimeterM(ptsW);
                                const area = getAreaOuterAreaM2(area0, perim0, 2);
                                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                                pts.forEach((p) => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
                                const areaStr = `${(Math.round(area * 100) / 100).toFixed(2)}m²`;
                                const label = String(m.label || '').trim();
                                drawPill((minX + maxX) / 2, (minY + maxY) / 2, label ? `${label} ${areaStr}` : areaStr);
                            }
                        });

                        try {
                            return canvas.toDataURL('image/png');
                        } catch (e) {
                            return '';
                        }
                    } catch (e) {
                        return '';
                    }
                };

                const dataUrlToBytes = (dataUrl) => {
                    try {
                        const parts = String(dataUrl || '').split(',');
                        if (parts.length < 2) return null;
                        const bin = atob(parts[1]);
                        const bytes = new Uint8Array(bin.length);
                        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                        return bytes;
                    } catch (e) {
                        return null;
                    }
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
                    if (pageNum === 5) {
                        try { renderRoof(); } catch (e) {}
                        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
                        await new Promise(r => setTimeout(r, 120));
                    } else {
                        await new Promise(r => setTimeout(r, 100));
                    }

                    const container = document.getElementById('pdf-content-wrapper');
                    if (pageNum === 5) {
                        try {
                            const dataUrl = await buildRoofSnapshotForPdf();
                            const bytes = dataUrlToBytes(dataUrl);
                            if (bytes) {
                                const img = await mergedDoc.embedPng(bytes);
                                const dims = img.scale(1);
                                const A4 = [595.28, 841.89];
                                const page = mergedDoc.addPage(A4);
                                const pw = page.getWidth();
                                const ph = page.getHeight();
                                if (!pdfHeaderFont && StandardFonts?.Helvetica) {
                                    try { pdfHeaderFont = await mergedDoc.embedFont(StandardFonts.Helvetica); } catch (e) {}
                                }
                                if (!pdfHeaderFontBold && StandardFonts?.HelveticaBold) {
                                    try { pdfHeaderFontBold = await mergedDoc.embedFont(StandardFonts.HelveticaBold); } catch (e) {}
                                }
                                if (!pdfHeaderLogoImg && !pdfHeaderLogoTried) {
                                    pdfHeaderLogoTried = true;
                                    try {
                                        let res = await fetch('./logo-horizontal.png', { cache: 'no-store' });
                                        if (!res.ok) res = await fetch('./logo.png', { cache: 'no-store' });
                                        if (res.ok) {
                                            const logoBytes = await res.arrayBuffer();
                                            const u8 = new Uint8Array(logoBytes);
                                            pdfHeaderLogoImg = await mergedDoc.embedPng(u8);
                                            pdfHeaderLogoDims = pdfHeaderLogoImg.scale(1);
                                        }
                                    } catch (e) {}
                                }

                                const padX = 48;
                                const padTop = 56;
                                const padBottom = 24;
                                const headerH = 120;
                                const topY = ph - padTop;
                                const titleText = String(document.getElementById('lbl-page5-title')?.textContent || 'SITE OVERVIEW').trim() || 'SITE OVERVIEW';
                                const tagline = 'Solar System Solution | Storage Battery';

                                if (pdfHeaderLogoImg && pdfHeaderLogoDims) {
                                    const logoH = 36;
                                    const s = logoH / Math.max(1e-9, pdfHeaderLogoDims.height);
                                    const logoW = pdfHeaderLogoDims.width * s;
                                    page.drawImage(pdfHeaderLogoImg, { x: padX, y: topY - logoH, width: logoW, height: logoH });
                                }
                                if (pdfHeaderFontBold && rgb) {
                                    page.drawText(tagline, { x: padX, y: topY - 58, size: 10, font: pdfHeaderFontBold, color: rgb(0.651, 0.478, 0.796) });
                                }
                                if (pdfHeaderFont && rgb) {
                                    const titleSize = 36;
                                    const tw = pdfHeaderFont.widthOfTextAtSize(titleText, titleSize);
                                    page.drawText(titleText, { x: Math.max(padX, pw - padX - tw), y: topY - 34, size: titleSize, font: pdfHeaderFont, color: rgb(0.796, 0.835, 0.882) });
                                }

                                const availH = Math.max(1, ph - headerH - padBottom);
                                if (rotateSiteOverview && degrees) {
                                    const ratio = Math.min(pw / dims.height, availH / dims.width);
                                    const w = dims.width * ratio;
                                    const h = dims.height * ratio;
                                    const x = (pw - h) / 2;
                                    const y = padBottom + (availH + w) / 2;
                                    page.drawImage(img, { x, y, width: w, height: h, rotate: degrees(-90) });
                                } else {
                                    const ratio = Math.min(pw / dims.width, availH / dims.height);
                                    const w = dims.width * ratio;
                                    const h = dims.height * ratio;
                                    const x = (pw - w) / 2;
                                    const y = padBottom + (availH - h) / 2;
                                    page.drawImage(img, { x, y, width: w, height: h });
                                }
                                continue;
                            }
                        } catch (e) {}
                    }

                    let pdfData;
                    try {
                        pdfData = await html2pdf().set(opt).from(container).toPdf().get('pdf').then(pdf => {
                            const isNearBlankPdfPage = (pageNo) => {
                                const page = pdf.internal.pages?.[pageNo];
                                if (!page) return true;
                                const raw = Array.isArray(page) ? page.join('\n') : String(page || '');
                                const compact = raw.replace(/\s+/g, '');
                                if (!compact) return true;
                                const hasText = /\b(?:BT|Tj|TJ)\b/.test(raw);
                                const hasImage = /\/I\d+\s+Do\b|\bDo\b/.test(raw);
                                if (hasText || hasImage) return false;
                                return page.length <= 2 || compact.length < 180;
                            };
                            let total = pdf.internal.getNumberOfPages();
                            for (let p = total; p >= 1; p--) {
                                if (total <= 1) break;
                                if (isNearBlankPdfPage(p)) {
                                    pdf.deletePage(p);
                                    total -= 1;
                                }
                            }
                            return pdf.output('arraybuffer');
                        });
                    } finally {
                        if (pageNum === 5) {
                            try { renderRoof(); } catch (e) {}
                        }
                    }

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
