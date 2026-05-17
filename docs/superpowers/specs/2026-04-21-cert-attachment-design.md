# 报价文件附选弹窗设计方案（Phase 2）

> **Date:** 2026-04-21
> **Topic:** 报价生成时增加认证文件附选弹窗，PDF 末尾附加可点击文件链接

---

## 1. 需求概述

在报价生成时（点击"生成报价 PDF"按钮后），弹出文件附选弹窗，用户可勾选要附上的认证文件，确认后 PDF 末尾附加可点击的文件链接列表。

---

## 2. UI 变更

### 2.1 文件附选弹窗（新增）

**触发时机：** `generateQuotationPDF()` 执行时，先弹出此弹窗，用户确认后再生成 PDF。

**弹窗结构：**
- 标题：`选择附上认证文件`
- 两个区块：

**【公司级认证】**（默认折叠，可展开）
- ISO 认证（多选 checkbox，默认不勾选）
- 运输文件 UN38.3/MSDS（多选 checkbox，默认不勾选）

**【产品级认证】**（按报价单产品分组，默认折叠）
- 每个产品一行：产品编号 + 名称 + TUV 勾选 + 规格书勾选
- 有认证文件的默认勾选，无认证文件的产品不显示

**底部：**
- 全选/取消全选（公司级）
- 全选/取消全选（产品级）
- 已选文件数量汇总
- 确认按钮（`生成 PDF`） + 取消按钮

### 2.2 PDF 附加格式

确认后在 `.print-container` 底部追加附件区域（再调用 html2pdf）：

```
附件：

【公司级认证】
□ ISO9001.pdf  →  https://QibbQi.github.io/minova/minova-data/certifications/iso/ISO9001.pdf
□ UN38.3_Test.pdf  →  https://QibbQi.github.io/minova/minova-data/certifications/transport/UN38.3_Test.pdf

【产品级认证】
P001 - Solar Panel 400W：
  □ TUV_IEC61215.pdf  →  https://QibbQi.github.io/minova/minova-data/certifications/products/P001/tuv/TUV_IEC61215.pdf
  □ 400W_Datasheet.pdf  →  https://QibbQi.github.io/minova/minova-data/certifications/products/P001/specs/400W_Datasheet.pdf
```

实际只列出**打勾的**文件，每个显示为可点击链接（`_blank` 新窗口打开）。

---

## 3. 数据获取

### 3.1 从 DOM 解析报价单产品

遍历 `.print-container` 内报价表格的行，提取 productId：

```javascript
const rows = document.querySelectorAll('.print-container table tbody tr');
const quotedProductIds = new Set();
rows.forEach(row => {
    const productId = row.querySelector('[data-product-id]')?.dataset?.productId
        || row.cells[0]?.textContent?.trim();
    if (productId) quotedProductIds.add(productId);
});
```

### 3.2 公司级认证

从全局 `companyCerts` 变量读取（Phase 1 已实现）：
- `companyCerts.isoCerts`
- `companyCerts.transportCerts`

### 3.3 产品级认证

从全局 `products` 数组匹配：
```javascript
const p = products.find(x => x.id === productId);
const certs = p?.certifications || {};
// certs.tuvCerts[], certs.specSheets[]
```

### 3.4 预览 URL 构造

复用现有 `previewCertFile` 的 URL 构造逻辑：
```javascript
const baseUrl = `https://${config.owner}.github.io/${config.repo}/`;
const url = baseUrl + path;
```

---

## 4. 实现流程

```
用户点击"生成报价"按钮
    ↓
openCertAttachmentModal() ← 新增：渲染弹窗 UI
    ↓
用户勾选文件 → 点击"生成 PDF"
    ↓
获取所有勾选的文件列表（companyCerts + products.certifications）
    ↓
生成附件 HTML 片段（分组列表，可点击链接）
    ↓
将片段注入 .print-container 底部
    ↓
调用 html2pdf().from(element) 生成 PDF
    ↓
PDF 下载完成（末尾自带附件链接）
```

---

## 5. 弹窗 HTML 结构

```html
<div id="cert-attachment-modal" class="fixed inset-0 bg-slate-900/60 backdrop-blur-sm hidden items-center justify-center z-[300] p-4">
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
</div>
```

---

## 6. JS 函数清单

| 函数 | 职责 |
|------|------|
| `openCertAttachmentModal()` | 解析报价单产品 + 渲染公司级/产品级认证勾选列表 + 显示弹窗 |
| `toggleCertSection(name)` | 折叠/展开公司级或产品级区块 |
| `getQuotedProductIds()` | 从 DOM 报价表格解析 productId 列表 |
| `buildAttachmentHtml(selectedFiles)` | 生成 PDF 末尾附件 HTML 片段 |
| `confirmAndGeneratePDF()` | 收集勾选项 → 生成附件 HTML → 注入 DOM → 调用 html2pdf |
| `closeCertAttachmentModal()` | 关闭弹窗 |

---

## 7. 错误处理

- 报价表格无法解析：无 productId → 跳过，显示提示"无法解析报价单产品"
- 产品无认证文件：该产品不在列表中显示
- GitHub Pages URL 失效：链接点击后 404，用户自行处理

---

## 8. 实现优先级

**Phase 2.1（核心）：** 文件附选弹窗 + PDF 附件注入
**Phase 2.2（体验）：** 加载状态、URL 失效提示
