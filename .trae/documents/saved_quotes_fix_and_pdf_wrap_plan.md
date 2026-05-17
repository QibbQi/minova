# 已存报价（GitHub）体验修复 + PDF 文字完整显示计划

## **Summary**
- 修复“已存报价”在 GitHub 模式下的 3 个一致性问题：连接后立即加载旧记录、保存后下拉默认选中当前报价、加载后报价表格内容与跨视图文本不丢失。
- 修复 PDF 生成时“备注与条款 / 预计时间表 / 支付条款”文本在输出里截断或不换行的问题，确保长文本自动折行并完整渲染。
- 保证不影响现有页面点击交互、不影响现有“生成报价 PDF（含附件合并）”主流程逻辑，只做数据桥接、渲染前处理与打印样式兜底。

## **Current State Analysis**
- “已存报价”UI 与逻辑集中在 [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)：
  - UI：下拉 `#saved-quotes-select` 与按钮 [index.html:L87-L110](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L87-L110)
  - GitHub 同步 UI 的 PAT 连接按钮逻辑：`btnConnectPat.onclick` [index.html:L2898-L2917](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L2898-L2917)
  - PDF 内“备注与条款”是 textarea（带 `overflow-hidden`，高度依赖 autosize）：[index.html:L533-L542](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L533-L542)
- 当前“报价表格”的数据源 `quoteRows` 定义在 `<script type="module">` 内，是 **模块私有变量**：
  - `let quoteRows = ...` [index.html:L3652](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L3652)
  - 表格渲染 `renderQuote()` 也在 module 内并直接引用该私有变量：[index.html:L4237-L4332](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L4237-L4332)
- 但“GitHub 已存报价快照”的 capture/apply 逻辑在普通 script（`multi-page-script`）里，无法直接读写 module 私有变量，导致：
  - 读取不到真实 `quoteRows` → 保存后的表格为空/不完整
  - apply 只改了 `window.quoteRows` → module 内渲染依旧用旧值 → 加载后表格内容无法恢复
- PDF 生成时使用 html2pdf/html2canvas 的 `onclone` 注入打印样式，但缺少对长文本换行/textarea 溢出的兜底；同时 textarea 的高度若未在生成前重算，容易被 `overflow-hidden` 裁剪（尤其是“程序性赋值”或“加载后未触发 input”场景）。

## **Proposed Changes**

### 1) 连接 GitHub（输入 PAT）后立刻拉取旧有报价列表
**文件**： [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)  
**位置**：PAT 连接按钮成功分支 `btnConnectPat.onclick`：[index.html:L2898-L2917](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L2898-L2917)

**修改内容**
- 在连接成功（`storeToken + selfCheck` 完成）后追加：
  - `await window.refreshSavedQuotesList?.();`
  - 若 `window.currentSavedQuoteId` 存在，刷新后 `#saved-quotes-select.value = currentSavedQuoteId`

**预期**
- 用户刚输入 PAT 连接后，下拉马上出现 GitHub 上已有记录，而不需要先保存新报价触发刷新。

### 2) 修复“加载已存报价后表格内容不恢复”（module 私有 quoteRows 问题）
**文件**： [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)

**改造策略（最小改动、低风险）**
- 在 module 内 `quoteRows` 定义后暴露桥接 API（getter/setter），让非 module 的 snapshot 代码可以读写 module 私有变量：
  - 位置：紧跟 [index.html:L3652](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L3652) 后
  - 新增：
    - `window.__getQuoteRows = () => quoteRows;`
    - `window.__setQuoteRows = (rows) => { quoteRows = Array.isArray(rows) ? rows : []; };`
    - 同理对 `validityDays`（与 badge 渲染相关）：
      - `window.__getValidityDays = () => validityDays;`
      - `window.__setValidityDays = (n) => { validityDays = ...; }`
- 调整快照逻辑：
  - capture：优先使用 `window.__getQuoteRows?.()` 取 rows（而不是 `window.quoteRows`）
  - apply：使用 `window.__setQuoteRows?.(rows)` 写入，并在写入后调用现有 `renderQuote()` / `calculateQuote()`（可通过在 module 内额外暴露 `window.renderQuote = renderQuote`、`window.calculateQuote = calculateQuote` 实现）

**预期**
- 保存到 GitHub 的报价会包含完整的表格明细；加载后表格在 UI 中立即恢复，不需要额外“在报价页再次加载”。

### 3) 修复“从其他页面点击加载后，报价页预计时间表/支付条款文字丢失”
**文件**： [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)

**原因推断（基于现状）**
- timeline/payment 的字段在 DOM 上是 textarea，内容若是程序性赋值但未做高度重算或后续某次初始化覆盖，视觉上可能表现为“空/被裁剪”。尤其在页面隐藏时（view-quotation display none）更容易出现未重排导致高度为 0/1 行的情况。

**修改内容**
- 新增通用函数 `autosizeAllTextareas(root)`：遍历 root 内所有 textarea，执行 `el.style.height=''; el.style.height=el.scrollHeight+'px'`。
- 在两个关键时机调用：
  1) `applyQuoteSnapshot(...)` 完成字段写回后，对 `#pdf-content-wrapper` 执行一次 autosize；
  2) 切换到报价页或切换 quote-page 时（`switchTab('quotation')` / `switchQuotePage(page)`），对当前可见页执行 autosize（只处理当前页，避免不必要重排）。

**预期**
- 无论用户在哪个 tab 点击“加载”，再切回报价页时 timeline/payment 文字不会消失或被裁剪。

### 4) 修复 PDF 中“条款/时间表/支付条款”文字显示不完整 + 不换行
**文件**： [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)

**修改点 A：生成 PDF 前确保 textarea 高度正确（避免 overflow-hidden 裁剪）**
- 在每次单页渲染前（逐页生成 PDF 的循环中，渲染当前页面之前），对“当前要渲染的 quote-page-X”执行 autosizeAllTextareas。

**修改点 B：onclone 注入打印 CSS 增加换行兜底**
- 在 html2canvas `onclone` 注入 `<style>` 的位置追加规则（与现有 `break-inside` 同一段）：  
  - 位置：`onclone` 注入处：[index.html:L8109-L8118](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L8109-L8118)
  - 追加（示例，按现有模板字符串风格写入）：
    - `input, textarea { overflow-wrap:anywhere !important; word-break:break-word !important; }`
    - `textarea { white-space: pre-wrap !important; overflow: visible !important; }`
    - 对条款区：`#val-terms { white-space: pre-wrap !important; }`

**预期**
- PDF 中“备注与条款”多段文字完整显示、自动折行；timeline/payment 的文本同样完整折行，不再截断。

## **Assumptions & Decisions**
- 采用“module 暴露 get/set 桥接”的最小改造方案，不做全局重构（不把 module 全部变量迁移到 window），以降低风险并确保不影响现有交互与 PDF 逻辑。
- GitHub 上的报价索引文件使用 `minova-data/quotes/index.json`；连接后立即读取该文件作为下拉来源。
- 对 textarea 的 autosize 仅改变 `style.height`，不改动布局结构；对 PDF 的换行只在 clone 注入 CSS，不会影响页面日常显示。

## **Verification**
1. **连接即显示历史**：刷新页面 → 输入 PAT 连接 → “已存报价”下拉立即出现仓库已有记录（无需先保存）。
2. **保存后选中当前**：保存新报价 → 下拉选中项应是刚保存的报价名（不是旧项/空）。
3. **表格恢复**：加载已存报价 → 报价表格（quote-body）明细行完整恢复（描述/品牌/规格/数量/价格等）。
4. **跨页面加载不丢字**：在非报价 tab 触发加载 → 再切回报价页 → timeline/payment/条款文字不消失。
5. **PDF 完整折行**：生成报价 PDF → “备注与条款”与 timeline/payment 文本完整显示且自动换行（不截断）。
