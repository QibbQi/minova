# Phase 2 Bug 修复完整计划

> **Date:** 2026-04-21
> **Goal:** 修复认证文件弹窗无法显示已上传文件的问题，并清除静态 HTML 残留

---

## 问题诊断

### Bug 1（核心）: `window.companyCerts` 在 embedded state 加载后失效

**现象：** 上传公司认证文件后，公司信息面板显示正常（因为 `renderCompanyCertList` 直接读本地 `companyCerts`），但 PDF 弹窗里显示空白（因为 `renderCompanyCertCheckboxes` 读 `window.companyCerts`）。

**根因：**

```javascript
// Line 2918: window.companyCerts 指向原始空对象
window.companyCerts = companyCerts;  // → { isoCerts: [], transportCerts: [] }

// Line 3198: companyCerts 被重新赋值为 embedded state（含上传的文件）
companyCerts = embedded.data.companyCerts ... || companyCerts;
// 此时：window.companyCerts = { isoCerts: [] }（旧）
//      本地 companyCerts = { isoCerts: [上传的文件] }（新）

// Line 6517:  || 永远不触发
const certs = window.companyCerts || companyCerts;
// window.companyCerts 是 {}（truthy），所以永远用它
```

**修复：** 在 `companyCerts` 每次被重新赋值后，同步更新 `window.companyCerts`。

---

### Bug 2: 静态 HTML 弹窗残留导致 ID 重复

**现象：** 第 6851 行存在另一个 `id="cert-attachment-modal"` 的静态 HTML，内含硬编码测试数据。JS 创建的弹窗（Line 2762）和静态 HTML 弹窗 ID 相同，浏览器 `getElementById('cert-attachment-modal')` 可能返回错误的元素。

**修复：** 删除静态 HTML 残留（Lines 6851–6912）。

---

### Bug 3: `getQuotedProductIds` 正则过于严格

**现象：** 产品级认证弹窗空白。用户输入 `"Solar Panel"` 作为描述，无法提取产品 ID。

**根因：** 正则要求产品 ID 前缀（如 `P001`），但很多产品描述没有此格式。

**修复：** 改用 `products` 数组做精确匹配——获取 `quoteRows` 的 description 值，与 `products` 数组中的 `name` 字段逐一匹配。

---

### Bug 4: `applyStateFromData` 未处理 `companyCerts`

**现象：** 从 GitHub 远程加载状态后，`companyCerts` 不会被更新。

**修复：** 在 `applyStateFromData` 中添加 `companyCerts` 的处理。

---

## 修复计划

### Task 1: 修复 `window.companyCerts` 失效问题

**Files:**
- Modify: `index.html`

**Step 1: 在 `companyCerts` 重新赋值后同步 window**

找到 Line 3198（在 embedded state 加载逻辑中）：

```javascript
// 原来（Line 3198）：
companyCerts = embedded.data.companyCerts && typeof embedded.data.companyCerts === 'object' ? embedded.data.companyCerts : companyCerts;

// 改为：
companyCerts = embedded.data.companyCerts && typeof embedded.data.companyCerts === 'object' ? embedded.data.companyCerts : companyCerts;
window.companyCerts = companyCerts; // 同步 window 引用
```

同样在 Line 3206（localStorage 加载后）：

```javascript
// 原来（Line 3206）：
companyCerts = JSON.parse(savedCerts);

// 改为：
companyCerts = JSON.parse(savedCerts);
window.companyCerts = companyCerts; // 同步 window 引用
```

**Step 2: 移除 Line 2918 的 `window.companyCerts = companyCerts`**

由于 `companyCerts` 会在后续被重新赋值，那行初始赋值没有意义，反而误导调试。删除它：

```javascript
// 删除这一行：
// window.companyCerts = companyCerts; // 暴露到 window 以便弹窗 JS 函数访问
```

**Step 3: Commit**

```bash
git add index.html
git commit -m "fix(certs): sync window.companyCerts after reassignment"
```

---

### Task 2: 删除静态 HTML 弹窗残留

**Files:**
- Modify: `index.html`

**Step 1: 找到并删除静态 HTML 弹窗**

```bash
grep -n "id=\"cert-attachment-modal\"" index.html
```

预期输出：
- Line 2762: JS 创建的弹窗（正确，保留）
- Line 6851: 静态 HTML 残留（删除）

读取 Lines 6848–6915 确认是残留后，删除整个 `<div id="cert-attachment-modal" ...>...</div>` 块。

**Step 2: Commit**

```bash
git add index.html
git commit -m "fix(certs): remove duplicate static cert-attachment-modal HTML"
```

---

### Task 3: 修复 `getQuotedProductIds` — 用 products 数组精确匹配

**Files:**
- Modify: `index.html`

**Step 1: 重写 `getQuotedProductIds` 函数**

原来的方法：从 DOM 提取产品 ID 并用正则匹配，容易失败。

新方法：从 DOM 提取产品描述文本，与 `products` 数组的 `name` 字段做模糊匹配。

```javascript
window.getQuotedProductIds = () => {
    const quotedProductIds = new Set();

    // 从报价单输入表格获取产品描述
    const rows = document.querySelectorAll('#quote-body tr');
    rows.forEach(row => {
        // 获取描述列的值
        const descEl = row.querySelector('td:nth-child(2) input');
        const descVal = descEl ? descEl.value.trim().toLowerCase() : '';

        if (!descVal) return;

        // 与 products 数组精确匹配
        // 匹配规则：描述文本中包含产品名称或产品 ID
        products.forEach(p => {
            if (!p || !p.name) return;
            const pName = p.name.toLowerCase();
            // 描述中包含完整产品名称，或描述是产品 ID
            if (descVal.includes(pName) || descVal === p.id.toLowerCase()) {
                quotedProductIds.add(p.id);
            }
        });
    });

    return quotedProductIds;
};
```

**Step 2: Commit**

```bash
git add index.html
git commit -m "fix(quote-attachment): use products array for product ID matching"
```

---

### Task 4: 在 `applyStateFromData` 中处理 `companyCerts`

**Files:**
- Modify: `index.html`

**Step 1: 在 `applyStateFromData` 中添加 companyCerts 处理**

在 Line 3256 附近（`applyStateFromData` 函数内，`try { ... localStorage ... } catch (e) {}` 块之后）添加：

```javascript
// 处理 companyCerts
if (data.companyCerts && typeof data.companyCerts === 'object') {
    companyCerts = data.companyCerts;
    window.companyCerts = companyCerts; // 保持同步
    try {
        localStorage.setItem('minova_company_certs', JSON.stringify(companyCerts));
    } catch (e) {}
}
```

**Step 2: Commit**

```bash
git add index.html
git commit -m "fix(certs): restore companyCerts in applyStateFromData"
```

---

### Task 5: 自检与验证

**Files:**
- 无测试文件，纯人工测试

**Step 1: 测试公司级认证弹窗**

1. 连接 GitHub（如果未连接）
2. 在产品清单页展开公司信息面板
3. 上传 2-3 个 ISO 认证 PDF
4. 确认公司信息面板显示文件名
5. 切换到报价生成页
6. 点击"生成报价 PDF"
7. 打开【公司级认证】下拉
8. **确认**：显示所有上传的文件（不是空白）
9. 勾选 1-2 个，确认计数更新

**Step 2: 测试产品级认证弹窗**

1. 进入产品清单
2. 点击已有产品（随便一个）
3. 在编辑弹窗的认证文件区块上传 TUV 和规格书
4. 保存
5. 切换到报价生成页
6. 在报价表格描述列输入该产品名称（如 "210R N-type组件"）
7. 点击"生成报价 PDF"
8. 打开【产品级认证】下拉
9. **确认**：显示该产品及其认证文件

**Step 3: 测试 PDF 生成**

1. 勾选一些认证文件
2. 点击"生成 PDF"
3. **确认**：PDF 下载成功，末尾有附件区域，链接可点击

**Step 4: Commit**

```bash
git add index.html
git commit -m "test(certs): verify cert modal shows uploaded files E2E"
```

---

## 修复总结

| Bug | 修复方法 |
|-----|---------|
| `window.companyCerts` 失效 | 在每次 `companyCerts` 重新赋值后同步 `window.companyCerts` |
| 静态 HTML 弹窗残留 | 删除 Lines 6851–6912 |
| `getQuotedProductIds` 匹配失败 | 改用 `products` 数组做精确匹配 |
| `applyStateFromData` 未处理 `companyCerts` | 添加 companyCerts 加载逻辑 |
