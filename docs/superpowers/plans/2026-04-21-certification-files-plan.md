# 认证文件支持实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在产品清单页增加公司信息面板（公司级认证文件管理），在产品编辑弹窗增加产品级认证文件上传/删除/预览功能。

**Architecture:** 单文件 HTML 应用，所有逻辑在 `index.html` 内。认证文件通过 `repo.commitTextFiles()` 提交到 GitHub 仓库 `minova-data/certifications/` 目录，状态随 `state.json` 一起通过 `saveToLocal()` + `enqueueSnapshot()` 持久化。预览 URL 通过拼接 GitHub Pages URL 实现。

**Tech Stack:** 纯原生 JS + Tailwind CSS，html2pdf 生成 PDF，GitHub API 存储文件。

---

## 文件结构

- 修改: `index.html`
  - 公司信息面板: 插在 `#view-database` 的 `<div class="bg-white rounded-2xl...">` 之前
  - 产品编辑弹窗认证区块: 插在 `#modal > div > .space-y-5` 末尾
  - JS 逻辑: 所有函数追加到文件末尾 `</script>` 之前

---

## Task 1: 数据模型初始化

**Files:**
- Modify: `index.html:3046-3050`（加载逻辑）

- [ ] **Step 1: 在 state 加载逻辑中初始化 `companyCerts`**

找到约 3046 行 `embedded = safeJsonParse(...)` 区块，在 `applyEmbeddedOrLocal()` 调用后确认 `companyCerts` 存在。

在 `index.html` 约 3050 行（`applyEmbeddedOrLocal` 之后）插入：

```javascript
// 确保 companyCerts 存在
if (!state.data.companyCerts) {
    state.data.companyCerts = { isoCerts: [], transportCerts: [] };
}
```

- [ ] **Step 2: 确认 saveToLocal 包含 companyCerts**

找到 `saveToLocal` 函数（约 3189 行），在 `localStorage.setItem('minova_products', ...)` 之后添加：

```javascript
localStorage.setItem('minova_company_certs', JSON.stringify(state.data.companyCerts));
```

- [ ] **Step 3: 确认加载逻辑读取 companyCerts**

在加载逻辑中 `companyCerts` 从 localStorage 读取：

```javascript
const savedCerts = localStorage.getItem('minova_company_certs');
if (savedCerts) {
    try { state.data.companyCerts = JSON.parse(savedCerts); } catch {}
}
```

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(certs): init companyCerts data model"
```

---

## Task 2: 公司信息面板（产品清单页顶部）

**Files:**
- Modify: `index.html:948`（在 `<main id="view-database">` 内部，产品列表 `<div class="bg-white rounded-2xl...">` 之前）
- Modify: `index.html` 末尾 JS 区域（新增 `renderCompanyCertPanel` 和 `openCompanyCertUpload` 函数）

- [ ] **Step 1: 在产品清单页顶部插入公司信息面板 HTML**

在 `index.html` 约 948 行 `<main id="view-database">` 内部，在现有的 `<div class="bg-white rounded-2xl shadow-sm...">`（产品列表 wrapper）**之前**插入：

```html
<!-- 公司信息 & 认证文件面板 -->
<div id="company-cert-panel" class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden mb-4">
    <div class="p-6 border-b border-slate-100 flex items-center justify-between">
        <div>
            <h2 class="text-xl font-bold text-slate-800">公司信息</h2>
            <p class="text-xs text-slate-400 mt-1">管理公司级认证文件</p>
        </div>
        <button onclick="toggleCompanyCertPanel()" id="btn-toggle-company-cert" class="text-sm bg-slate-100 text-slate-600 px-4 py-2 rounded-xl hover:bg-slate-200 font-bold">
            展开
        </button>
    </div>
    <div id="company-cert-body" class="p-6 hidden">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <!-- 工厂ISO认证 -->
            <div class="border border-slate-200 rounded-xl p-4">
                <div class="flex items-center justify-between mb-3">
                    <h3 class="text-sm font-bold text-slate-700">工厂ISO认证</h3>
                    <button onclick="openCertUpload('iso')" class="text-xs bg-purple-700 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-purple-800">+ 上传</button>
                </div>
                <div id="iso-cert-list" class="space-y-2"></div>
                <p id="iso-cert-empty" class="text-xs text-slate-400 hidden">暂无文件</p>
            </div>
            <!-- 运输文件 -->
            <div class="border border-slate-200 rounded-xl p-4">
                <div class="flex items-center justify-between mb-3">
                    <h3 class="text-sm font-bold text-slate-700">运输文件 (UN38.3/MSDS)</h3>
                    <button onclick="openCertUpload('transport')" class="text-xs bg-purple-700 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-purple-800">+ 上传</button>
                </div>
                <div id="transport-cert-list" class="space-y-2"></div>
                <p id="transport-cert-empty" class="text-xs text-slate-400 hidden">暂无文件</p>
            </div>
        </div>
    </div>
</div>
```

- [ ] **Step 2: 实现 `toggleCompanyCertPanel` 函数**

在文件末尾 JS 区域（`</script>` 之前）添加：

```javascript
window.toggleCompanyCertPanel = () => {
    const body = document.getElementById('company-cert-body');
    const btn = document.getElementById('btn-toggle-company-cert');
    const isHidden = body.classList.contains('hidden');
    body.classList.toggle('hidden', !isHidden);
    btn.textContent = isHidden ? '收起' : '展开';
    if (isHidden) renderCompanyCertList();
};
```

- [ ] **Step 3: 实现 `renderCompanyCertList` 函数**

```javascript
window.renderCompanyCertList = () => {
    const certs = state.data.companyCerts;
    ['iso', 'transport'].forEach(type => {
        const list = document.getElementById(`${type}-cert-list`);
        const empty = document.getElementById(`${type}-cert-empty`);
        const files = type === 'iso' ? certs.isoCerts : certs.transportCerts;
        if (!files || files.length === 0) {
            list.innerHTML = '';
            empty.classList.remove('hidden');
        } else {
            empty.classList.add('hidden');
            list.innerHTML = files.map(f => `
                <div class="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
                    <a href="#" onclick="previewCertFile('${f.path}'); return false;" class="text-sm text-purple-700 hover:underline flex-1 truncate">${f.name}</a>
                    <button onclick="deleteCompanyCert('${type}', '${f.id}')" class="text-red-400 hover:text-red-600 ml-2 text-xs font-bold">删除</button>
                </div>
            `).join('');
        }
    });
};
```

- [ ] **Step 4: 实现 `openCertUpload` 函数**

```javascript
window.openCertUpload = (type) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.jpg,.jpeg,.png,.doc,.docx';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        await uploadCompanyCert(type, file);
    };
    input.click();
};
```

- [ ] **Step 5: 实现 `uploadCompanyCert` 函数**

```javascript
window.uploadCompanyCert = async (type, file) => {
    const reader = new FileReader();
    reader.onload = async () => {
        try {
            const base64 = reader.result.split(',')[1];
            const path = `minova-data/certifications/${type}/${file.name}`;
            const content = atob(base64);
            await repo.commitTextFiles({
                owner: config.owner,
                repo: config.repo,
                branch: config.branch,
                message: `minova: upload cert ${file.name}`,
                files: [{ path, content }]
            });
            const certEntry = {
                id: crypto.randomUUID(),
                name: file.name,
                path: path,
                uploadedAt: new Date().toISOString()
            };
            if (type === 'iso') {
                state.data.companyCerts.isoCerts.push(certEntry);
            } else {
                state.data.companyCerts.transportCerts.push(certEntry);
            }
            saveToLocal();
            enqueueSnapshot('upload cert');
            renderCompanyCertList();
        } catch (err) {
            alert('上传失败: ' + err.message);
        }
    };
    reader.readAsDataURL(file);
};
```

- [ ] **Step 6: 实现 `deleteCompanyCert` 函数**

```javascript
window.deleteCompanyCert = (type, certId) => {
    if (!confirm('确定删除该文件？')) return;
    const certs = type === 'iso' ? state.data.companyCerts.isoCerts : state.data.companyCerts.transportCerts;
    const idx = certs.findIndex(c => c.id === certId);
    if (idx !== -1) certs.splice(idx, 1);
    saveToLocal();
    enqueueSnapshot('delete cert');
    renderCompanyCertList();
};
```

- [ ] **Step 7: 实现 `previewCertFile` 函数**

```javascript
window.previewCertFile = (path) => {
    const url = `https://${config.owner}.github.io/${config.repo}/${path}`;
    const win = window.open(url, '_blank');
    if (!win) {
        navigator.clipboard.writeText(url);
        alert('链接已复制到剪贴板，请在浏览器中打开');
    }
};
```

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "feat(certs): add company cert panel in database tab"
```

---

## Task 3: 产品编辑弹窗增加认证文件区块

**Files:**
- Modify: `index.html:1607-1609`（modal 弹窗内部，在 `</div>` 之前）
- Modify: `index.html` JS 区域（新增 `renderProductCertsInModal`、`openProductCertUpload`、`uploadProductCert`、`deleteProductCert` 函数）

- [ ] **Step 1: 在产品编辑弹窗底部添加认证文件区块 HTML**

在 `index.html` 约 1609 行 `<div class="bg-white rounded-3xl p-8...">` 内部，找到 `</div>` 结束标签（在 `</div>` 之前 `.space-y-5` 结束后）插入：

```html
<!-- 认证文件区块 -->
<div class="border-t border-slate-200 mt-6 pt-6">
    <h4 class="text-sm font-bold text-slate-700 mb-4">产品认证文件</h4>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <!-- TUV/IEC认证 -->
        <div class="border border-slate-200 rounded-xl p-3">
            <div class="flex items-center justify-between mb-2">
                <span class="text-xs font-bold text-slate-500">TUV/IEC 认证</span>
                <button onclick="openProductCertUpload('tuv')" class="text-xs bg-blue-600 text-white px-2 py-1 rounded-lg font-bold hover:bg-blue-700">+ 上传</button>
            </div>
            <div id="product-tuv-list" class="space-y-1"></div>
            <p id="product-tuv-empty" class="text-xs text-slate-400 hidden">暂无</p>
        </div>
        <!-- 产品规格书 -->
        <div class="border border-slate-200 rounded-xl p-3">
            <div class="flex items-center justify-between mb-2">
                <span class="text-xs font-bold text-slate-500">产品规格书</span>
                <button onclick="openProductCertUpload('specs')" class="text-xs bg-blue-600 text-white px-2 py-1 rounded-lg font-bold hover:bg-blue-700">+ 上传</button>
            </div>
            <div id="product-specs-list" class="space-y-1"></div>
            <p id="product-specs-empty" class="text-xs text-slate-400 hidden">暂无</p>
        </div>
    </div>
</div>
```

- [ ] **Step 2: 实现 `openProductCertUpload` 函数**

```javascript
window.openProductCertUpload = (type) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.jpg,.jpeg,.png,.doc,.docx';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        await uploadProductCert(type, file);
    };
    input.click();
};
```

- [ ] **Step 3: 实现 `uploadProductCert` 函数**

```javascript
window.uploadProductCert = async (type, file) => {
    const pid = window.editId;
    if (!pid) { alert('请先保存产品后再上传认证文件'); return; }
    const reader = new FileReader();
    reader.onload = async () => {
        try {
            const base64 = reader.result.split(',')[1];
            const subDir = type === 'tuv' ? 'tuv' : 'specs';
            const path = `minova-data/certifications/products/${pid}/${subDir}/${file.name}`;
            const content = atob(base64);
            await repo.commitTextFiles({
                owner: config.owner,
                repo: config.repo,
                branch: config.branch,
                message: `minova: upload product cert ${file.name}`,
                files: [{ path, content }]
            });
            const certEntry = {
                id: crypto.randomUUID(),
                name: file.name,
                path: path,
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
            enqueueSnapshot('upload product cert');
            renderProductCertsInModal();
        } catch (err) {
            alert('上传失败: ' + err.message);
        }
    };
    reader.readAsDataURL(file);
};
```

- [ ] **Step 4: 实现 `renderProductCertsInModal` 函数**

```javascript
window.renderProductCertsInModal = () => {
    const pid = window.editId;
    if (!pid) return;
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
            list.innerHTML = files.map(f => `
                <div class="flex items-center justify-between bg-slate-50 rounded-lg px-2 py-1.5">
                    <a href="#" onclick="previewCertFile('${f.path}'); return false;" class="text-xs text-blue-600 hover:underline flex-1 truncate">${f.name}</a>
                    <button onclick="deleteProductCert('${type}', '${f.id}')" class="text-red-400 hover:text-red-600 ml-2 text-xs font-bold">×</button>
                </div>
            `).join('');
        }
    });
};
```

- [ ] **Step 5: 实现 `deleteProductCert` 函数**

```javascript
window.deleteProductCert = (type, certId) => {
    if (!confirm('确定删除？')) return;
    const pid = window.editId;
    const p = products.find(x => x.id === pid);
    if (!p || !p.certifications) return;
    const arr = type === 'tuv' ? p.certifications.tuvCerts : p.certifications.specSheets;
    const idx = arr.findIndex(c => c.id === certId);
    if (idx !== -1) arr.splice(idx, 1);
    saveToLocal();
    enqueueSnapshot('delete product cert');
    renderProductCertsInModal();
};
```

- [ ] **Step 6: 在 `editProduct` 函数末尾调用 `renderProductCertsInModal`**

找到 `window.editProduct = (id) => {` 函数，在弹窗显示后调用渲染：

```javascript
window.editProduct = (id) => {
    // ... 现有逻辑 ...
    document.getElementById('modal').classList.remove('hidden');
    renderProductCertsInModal();  // 新增
};
```

- [ ] **Step 7: 在 `openModal`（新增产品）中清空认证显示**

```javascript
window.openModal = () => {
    updateSubcatSuggestions();
    document.getElementById('modal').classList.remove('hidden');
    window.editId = null;
    // 清空现有字段 ...
    // 清空认证文件显示
    ['tuv', 'specs'].forEach(type => {
        document.getElementById(`product-${type}-list`).innerHTML = '';
        document.getElementById(`product-${type}-empty`).classList.remove('hidden');
    });
};
```

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "feat(certs): add product cert upload in edit modal"
```

---

## Task 4: 产品新增时初始化 certifications 字段

**Files:**
- Modify: `index.html`（`saveProduct` 函数）

- [ ] **Step 1: 在 `saveProduct` 函数中确保 certifications 字段存在**

找到 `window.saveProduct = () => {` 函数（约 5619 行），在构建 `data` 对象后、新增到 `products` 数组之前，添加：

```javascript
// 确保 certifications 字段存在
if (!data.certifications) {
    data.certifications = { tuvCerts: [], specSheets: [] };
}
```

完整 context：

```javascript
window.saveProduct = () => {
    const category = document.getElementById('m-category').value || '未分类';
    const data = {
        id: window.editId || generateNextId(category),
        name: document.getElementById('m-name').value,
        // ... 其他字段 ...
    };
    if (!data.certifications) {
        data.certifications = { tuvCerts: [], specSheets: [] };
    }
    if(!data.name) return alert("请输入产品全称！");
    // ...
};
```

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "feat(certs): init certifications field on product create"
```

---

## Task 5: 自检与验证

**Files:**
- 测试文件: `github-sync/test/cert-upload.test.mjs`（新建）

- [ ] **Step 1: 验证 data model**

在浏览器控制台执行：
```javascript
console.log(state.data.companyCerts);  // 应显示 { isoCerts: [], transportCerts: [] }
```

- [ ] **Step 2: 测试公司级文件上传**

1. 打开"产品清单"页，点击"展开"公司信息面板
2. 点击"上传"ISO认证，选择一个 PDF 文件
3. 确认文件列表出现名称，点击名称可预览
4. 刷新页面，数据保留

- [ ] **Step 3: 测试产品级文件上传**

1. 点击"入库新产品"，填写名称后保存
2. 在列表中双击该产品进入编辑
3. 在认证文件区块上传一个 TUV 认证文件
4. 确认显示在 TUV 列表，可点击预览
5. 刷新页面，数据保留

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "test(certs): verify cert upload/delete/preview E2E"
```

---

## 总结

Phase 1 完成 4 个 task，实现：
- 公司级认证文件（ISO + 运输文件）管理面板
- 产品级认证文件（TUV + 规格书）上传/删除/预览
- 数据随 state.json + localStorage 持久化
- 文件通过 GitHub API 存储

Phase 2（报价集成 + 文件附选弹窗）将在 Phase 1 验收后单独计划。
