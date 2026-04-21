# 认证文件附选弹窗实现计划（Phase 2）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在点击"生成报价 PDF"时弹出文件附选弹窗，用户勾选后 PDF 末尾附加可点击的文件链接列表。

**Architecture:** 修改 `index.html`：在 `generateQuotationPDF()` 入口处拦截，弹出附选弹窗，用户确认后将附件 HTML 注入 `.print-container` 底部再调用 html2pdf。附件链接使用 `window.previewCertFile` 的 URL 构造逻辑。

**Tech Stack:** 纯原生 JS + Tailwind CSS，html2pdf 生成 PDF，GitHub API 存储文件（Phase 1 已实现）。

---

## 文件结构

- 修改: `index.html`
  - 弹窗 HTML: 插在 `github-sync-modal` 创建之后（约 2550 行）
  - `generateQuotationPDF` 拦截: 约 3402 行，改为调用 `openCertAttachmentModal`
  - JS 函数: 所有函数追加到文件末尾 `</script>` 之前

---

## Task 1: 插入弹窗 HTML

**Files:**
- Modify: `index.html`（在 `github-sync-modal` 创建逻辑之后添加新弹窗）

- [ ] **Step 1: 在 `github-sync-modal` 创建逻辑之后添加 cert-attachment-modal**

找到约 2550 行附近，`github-sync-modal` 创建之后：

```javascript
const certModal = el('div', { id: 'cert-attachment-modal', class: 'fixed inset-0 bg-slate-900/60 backdrop-blur-sm hidden items-center justify-center z-[300] p-4' });
document.body.appendChild(certModal);
```

在这之后插入弹窗 HTML 模板：

```javascript
certModal.innerHTML = `
<div class="bg-white rounded-3xl p-8 w-full max-w-xl shadow-2xl max-h-[90vh] overflow-y-auto">
    <h3 class="text-xl font-bold text-slate-800 mb-2">选择附上认证文件</h3>
    <p class="text-xs text-slate-400 mb-5">勾选本次报价需要附上的认证文件，将以链接形式出现在 PDF 末尾</p>

    <!-- 公司级认证 -->
    <div class="border border-slate-200 rounded-xl mb-4">
        <div class="flex items-center justify-between p-4 cursor-pointer" onclick="toggleCertSection('company')">
            <span class="text-sm font-bold text-slate-700">【公司级认证】</span>
            <span id="company-cert-count" class="text-xs text-slate-400">0 项</span>
            <span id="company-cert-arrow">▶</span>
        </div>
        <div id="company-cert-body" class="hidden px-4 pb-4">
            <div class="mb-3">
                <p class="text-xs font-bold text-slate-500 mb-2">工厂ISO认证</p>
                <div id="iso-cert-checkboxes"></div>
            </div>
            <div>
                <p class="text-xs font-bold text-slate-500 mb-2">运输文件 (UN38.3/MSDS)</p>
                <div id="transport-cert-checkboxes"></div>
            </div>
        </div>
    </div>

    <!-- 产品级认证 -->
    <div class="border border-slate-200 rounded-xl mb-4">
        <div class="flex items-center justify-between p-4 cursor-pointer" onclick="toggleCertSection('product')">
            <span class="text-sm font-bold text-slate-700">【产品级认证】</span>
            <span id="product-cert-count" class="text-xs text-slate-400">0 项</span>
            <span id="product-cert-arrow">▶</span>
        </div>
        <div id="product-cert-body" class="hidden px-4 pb-4">
            <div id="product-cert-list"></div>
            <p id="product-cert-empty" class="text-xs text-slate-400 hidden">报价单中暂无有认证文件的产品</p>
        </div>
    </div>

    <!-- 底部按钮 -->
    <div class="flex justify-between items-center mt-4">
        <span id="cert-selected-summary" class="text-xs text-slate-500">已选 0 个文件</span>
        <div class="flex gap-3">
            <button onclick="closeCertAttachmentModal()" class="px-4 py-2 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50">取消</button>
            <button onclick="confirmAndGeneratePDF()" class="px-4 py-2 rounded-xl bg-purple-700 text-white font-bold hover:bg-purple-800">生成 PDF</button>
        </div>
    </div>
</div>
`;
```

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "feat(quote-attachment): add cert attachment modal HTML"
```

---

## Task 2: 拦截 generateQuotationPDF，改为调用附选弹窗

**Files:**
- Modify: `index.html:3402`（`window.generateQuotationPDF` 函数）

- [ ] **Step 1: 将 `generateQuotationPDF` 入口改为调用 `openCertAttachmentModal`**

找到 `window.generateQuotationPDF = () => {`，将函数体改为：

```javascript
window.generateQuotationPDF = () => {
    openCertAttachmentModal();
};
```

（即只保留函数签名，函数体调用 `openCertAttachmentModal`）

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "feat(quote-attachment): intercept PDF generation to show cert modal first"
```

---

## Task 3: 实现核心 JS 函数

**Files:**
- Modify: `index.html` 末尾 JS 区域（在 `</script>` 之前）

- [ ] **Step 1: 实现 `openCertAttachmentModal`**

```javascript
window.openCertAttachmentModal = () => {
    const modal = document.getElementById('cert-attachment-modal');
    if (!modal) return;

    // 渲染公司级认证勾选列表
    renderCompanyCertCheckboxes();

    // 渲染产品级认证勾选列表
    renderProductCertCheckboxes();

    // 显示弹窗
    modal.classList.remove('hidden');
    modal.classList.add('flex');
};

window.renderCompanyCertCheckboxes = () => {
    const isoContainer = document.getElementById('iso-cert-checkboxes');
    const transportContainer = document.getElementById('transport-cert-checkboxes');
    if (!isoContainer || !transportContainer) return;

    // ISO 认证
    const isoCerts = companyCerts.isoCerts || [];
    if (isoCerts.length === 0) {
        isoContainer.innerHTML = '<p class="text-xs text-slate-400">暂无文件</p>';
    } else {
        isoContainer.innerHTML = isoCerts.map(f => `
            <label class="flex items-center gap-2 py-1 cursor-pointer">
                <input type="checkbox" class="cert-checkbox" data-type="iso" data-id="${f.id}" data-path="${f.path}" data-name="${f.name}">
                <span class="text-sm text-slate-700 truncate flex-1">${f.name}</span>
            </label>
        `).join('');
    }

    // 运输文件
    const transportCerts = companyCerts.transportCerts || [];
    if (transportCerts.length === 0) {
        transportContainer.innerHTML = '<p class="text-xs text-slate-400">暂无文件</p>';
    } else {
        transportContainer.innerHTML = transportCerts.map(f => `
            <label class="flex items-center gap-2 py-1 cursor-pointer">
                <input type="checkbox" class="cert-checkbox" data-type="transport" data-id="${f.id}" data-path="${f.path}" data-name="${f.name}">
                <span class="text-sm text-slate-700 truncate flex-1">${f.name}</span>
            </label>
        `).join('');
    }

    // 更新计数
    updateCertSectionCount('company');

    // 绑定 checkbox 事件
    document.querySelectorAll('.cert-checkbox').forEach(cb => {
        cb.addEventListener('change', updateCertSelectedSummary);
    });
};

window.renderProductCertCheckboxes = () => {
    const list = document.getElementById('product-cert-list');
    const empty = document.getElementById('product-cert-empty');
    if (!list || !empty) return;

    const productIds = getQuotedProductIds();
    const quotedProducts = products.filter(p => productIds.has(p.id));

    // 过滤出有认证文件的产品
    const productsWithCerts = quotedProducts.filter(p => {
        const certs = p.certifications || {};
        return (certs.tuvCerts && certs.tuvCerts.length > 0) ||
               (certs.specSheets && certs.specSheets.length > 0);
    });

    if (productsWithCerts.length === 0) {
        list.innerHTML = '';
        empty.classList.remove('hidden');
        document.getElementById('product-cert-count').textContent = '0 项';
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
```

- [ ] **Step 2: 实现 `getQuotedProductIds`**

```javascript
window.getQuotedProductIds = () => {
    const quotedProductIds = new Set();
    const rows = document.querySelectorAll('.print-container table tbody tr');
    rows.forEach(row => {
        const productId = row.querySelector('[data-product-id]')?.dataset?.productId
            || row.cells[0]?.textContent?.trim();
        if (productId) quotedProductIds.add(productId);
    });
    return quotedProductIds;
};
```

- [ ] **Step 3: 实现 `toggleCertSection`**

```javascript
window.toggleCertSection = (name) => {
    const body = document.getElementById(`${name}-cert-body`);
    const arrow = document.getElementById(`${name}-cert-arrow`);
    if (!body || !arrow) return;
    const isHidden = body.classList.contains('hidden');
    body.classList.toggle('hidden', !isHidden);
    arrow.textContent = isHidden ? '▼' : '▶';
};
```

- [ ] **Step 4: 实现辅助函数 `updateCertSectionCount` 和 `updateCertSelectedSummary`**

```javascript
window.updateCertSectionCount = (section) => {
    const countEl = document.getElementById(`${section}-cert-count`);
    if (!countEl) return;
    const checkboxes = document.querySelectorAll(`#${section}-cert-body .cert-checkbox`);
    const checked = document.querySelectorAll(`#${section}-cert-body .cert-checkbox:checked`);
    countEl.textContent = `${checked.length}/${checkboxes.length} 项`;
};

window.updateCertSelectedSummary = () => {
    const all = document.querySelectorAll('.cert-checkbox');
    const checked = document.querySelectorAll('.cert-checkbox:checked');
    const summary = document.getElementById('cert-selected-summary');
    if (summary) {
        summary.textContent = `已选 ${checked.length} 个文件`;
    }
    updateCertSectionCount('company');
    updateCertSectionCount('product');
};
```

- [ ] **Step 5: 实现 `buildAttachmentHtml`**

```javascript
window.buildAttachmentHtml = (selectedFiles) => {
    if (!selectedFiles || selectedFiles.length === 0) return '';

    const { owner, repo } = window.__minovaSync.config;
    const baseUrl = `https://${owner}.github.io/${repo}/`;

    // 分组
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

    // 按产品分组显示产品级认证
    if (productTuv.length + productSpecs.length > 0) {
        html += '<div>';
        html += '<p style="font-size: 13px; font-weight: bold; color: #475569; margin-bottom: 8px;">【产品级认证】</p>';

        // 按 productId 分组
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
```

- [ ] **Step 6: 实现 `confirmAndGeneratePDF`**

```javascript
window.confirmAndGeneratePDF = () => {
    // 收集所有勾选的文件
    const checked = document.querySelectorAll('.cert-checkbox:checked');
    const selectedFiles = Array.from(checked).map(cb => ({
        type: cb.dataset.type,
        id: cb.dataset.id,
        path: cb.dataset.path,
        name: cb.dataset.name,
        productId: cb.dataset.productId || null
    }));

    // 关闭弹窗
    closeCertAttachmentModal();

    // 生成附件 HTML 并注入
    const attachmentHtml = buildAttachmentHtml(selectedFiles);

    // 将附件注入 .print-container 底部
    const container = document.querySelector('.print-container');
    if (!container) return;

    // 保存原有内容并注入附件
    const attachmentDiv = document.createElement('div');
    attachmentDiv.id = 'cert-attachment-section';
    attachmentDiv.innerHTML = attachmentHtml;
    container.appendChild(attachmentDiv);

    // 调用 html2pdf
    const element = container;
    const quoteNo = document.getElementById('quote-no').value || 'Quotation';

    const opt = {
        margin: 0,
        filename: `${quoteNo}.pdf`,
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
                const cont = clonedDoc.querySelector('.print-container');
                clonedDoc.documentElement.style.margin = '0';
                clonedDoc.documentElement.style.padding = '0';
                clonedDoc.body.style.margin = '0';
                clonedDoc.body.style.padding = '0';
                clonedDoc.body.style.width = '210mm';
                clonedDoc.body.style.maxWidth = '210mm';
                if (cont) {
                    cont.style.boxShadow = 'none';
                    cont.style.border = 'none';
                    cont.style.padding = '0';
                    cont.style.margin = '0';
                    cont.style.borderRadius = '0';
                    cont.style.minHeight = 'auto';
                    cont.style.height = 'auto';
                    cont.style.overflow = 'visible';
                    cont.style.width = '210mm';
                    cont.style.maxWidth = '210mm';
                }
                clonedDoc.querySelectorAll('.no-print').forEach(el => el.style.display = 'none');

                const style = clonedDoc.createElement('style');
                style.innerHTML = `
                    @page { size: A4; margin: 0; }
                    tr, h1, h2, h3, h4, h5, h6 { page-break-inside: avoid !important; break-inside: avoid !important; }
                    .grand-total-container, .grand-total-container * { page-break-inside: avoid !important; break-inside: avoid !important; }
                    .total-pill { page-break-inside: avoid !important; break-inside: avoid !important; }
                    .signature-container { page-break-inside: avoid !important; break-inside: avoid !important; margin-bottom: 0 !important; }
                    .terms-container { page-break-inside: auto !important; }
                    .pdf-page-break { page-break-before: always !important; break-before: page !important; }
                    .header-item-p {
                        display: flex;
                        justify-content: space-between;
                        width: 100%;
                    }
                `;
                clonedDoc.head.appendChild(style);

                clonedDoc.getElementById('quote-no').parentElement.classList.add('header-item-p');
                clonedDoc.getElementById('currentDate').parentElement.classList.add('header-item-p');
                const afterDetailsSection = clonedDoc.getElementById('section-after-details');
                if (afterDetailsSection?.dataset?.splitEnabled === 'true') afterDetailsSection.classList.add('pdf-page-break');
                const signature = clonedDoc.querySelector('.signature-container');
                if (signature && signature.parentElement) {
                    let n = signature.nextElementSibling;
                    while (n) {
                        const next = n.nextElementSibling;
                        n.remove();
                        n = next;
                    }
                }

                clonedDoc.querySelectorAll('textarea, input').forEach(el => {
                    const replacement = clonedDoc.createElement('span');
                    replacement.innerText = el.value;

                    const classesToCopy = ['font-bold', 'text-slate-700', 'uppercase', 'tracking-tighter', 'font-black', 'text-slate-900', 'text-sm', 'text-slate-500'];
                    el.classList.forEach(c => {
                        if(classesToCopy.some(prefix => c.startsWith(prefix))) {
                            replacement.classList.add(c);
                        }
                    });

                    if (el.classList.contains('text-right')) {
                        replacement.style.textAlign = 'right';
                    }
                    if (el.classList.contains('text-center')) {
                        replacement.style.textAlign = 'center';
                    }
                    const inTable = !!el.closest('table');
                    replacement.style.width = inTable ? '100%' : 'auto';
                    if (inTable) replacement.style.display = 'block';
                    if (!inTable && (el.classList.contains('block') || el.classList.contains('w-full'))) {
                        replacement.style.display = 'block';
                        replacement.style.width = '100%';
                    }
                    if (el.tagName === 'TEXTAREA') {
                        replacement.style.whiteSpace = 'pre-wrap';
                        replacement.style.display = 'block';
                        replacement.style.width = '100%';
                    }

                    el.parentNode.replaceChild(replacement, el);
                });
            }
        },
        jsPDF: { unit: 'mm', format: [210, 297], orientation: 'portrait' }
    };

    html2pdf().set(opt).from(element).toPdf().get('pdf').then((pdf) => {
        const total = pdf.internal.getNumberOfPages();
        const last = pdf.internal.pages?.[total];
        if (last && last.length <= 1) pdf.deletePage(total);
        // 移除注入的附件 HTML
        const injected = document.getElementById('cert-attachment-section');
        if (injected) injected.remove();
    }).save();
};
```

- [ ] **Step 7: 实现 `closeCertAttachmentModal`**

```javascript
window.closeCertAttachmentModal = () => {
    const modal = document.getElementById('cert-attachment-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
};
```

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "feat(quote-attachment): implement cert attachment modal JS functions"
```

---

## Task 4: 自检与验证

**Files:**
- 测试文件: 无（纯人工测试）

- [ ] **Step 1: 测试弹窗显示**

1. 打开"报价生成"标签
2. 填写任意报价内容
3. 点击"生成报价 PDF"按钮
4. 确认弹出 cert-attachment-modal，显示"选择附上认证文件"
5. 确认公司级认证（ISO + 运输文件）和产品级认证区块都可见

- [ ] **Step 2: 测试勾选和折叠**

1. 点击【公司级认证】箭头，确认折叠/展开
2. 点击【产品级认证】箭头，确认折叠/展开
3. 勾选一个 ISO 文件，确认底部"已选 1 个文件"更新

- [ ] **Step 3: 测试 PDF 生成**

1. 勾选 2-3 个文件
2. 点击"生成 PDF"
3. 确认 PDF 下载成功
4. 打开 PDF，确认末尾有附件区域，包含可点击链接

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "test(quote-attachment): verify modal and PDF attachment E2E"
```

---

## 总结

Phase 2 完成 4 个 task，实现：
- 报价 PDF 生成前拦截，弹出文件附选弹窗
- 公司级认证（ISO + 运输文件）多选
- 产品级认证按报价单产品分组显示，TUV + 规格书
- PDF 末尾附加可点击的文件链接（分组显示）
- 原有 `generateQuotationPDF` 逻辑完整迁移到 `confirmAndGeneratePDF`
