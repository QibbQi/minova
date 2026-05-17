# 时间表与支付条款字号一致化计划

## 1. 目标 (Summary)
在报价生成页与生成的 PDF 中，实现以下视觉一致性（其他区域不改动）：
- **预计时间表**三项文字（Step 1/2/3 的名称）的字体、字号、颜色与**支付条款**三项文字（确认后/安装后/测试与调试后 的名称）完全一致，并且英文状态下也强制大写（Uppercase）。
- **生成报价（PDF）**中：
  - 缩小预计时间表中“天数”前的数字输入（≈ 后面的数字）。
  - 缩小支付条款中“%”前的数字输入。
  - 确保 PDF 中显示出来的字号与网页中看到的字号一致（避免 PDF 里字号被放大或样式丢失）。

## 2. 当前状态分析 (Current State Analysis)
### 2.1 时间表三项文字与支付条款三项文字样式不一致
- 预计时间表三项输入框（`#val-step1/#val-step2/#val-step3`）目前样式为 `text-xs font-bold text-slate-700 ...`（示例见 [index.html:L139-L165](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L139-L165)）。
- 支付条款三项的“名称”输入框（`#lbl-confirmation/#lbl-installation/#lbl-testing`）实际由外层 `span` 提供样式：`text-[10px] font-bold text-slate-500 uppercase`（见 [index.html:L177-L205](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L177-L205)）。

### 2.2 PDF 中字号与网页不一致的根因
生成 PDF 时会克隆 DOM 并把所有 `textarea/input` 替换成 `span`（见 [index.html:L7836-L7867](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L7836-L7867)）。
- 目前替换逻辑只拷贝少量 class（`classesToCopy`），不包含 `text-[10px]`、`text-[9px]`、`text-xs` 等字号类，也不包含 `w-8/w-12` 等宽度类（见 [index.html:L7840-L7845](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L7840-L7845)）。
- 结果：网页端靠 Tailwind class 控制的字号/宽度，在 PDF 替换为 `span` 后丢失，导致 PDF 字号与网页不一致。

## 3. 拟定修改 (Proposed Changes)
目标文件均为 [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html)。

### 3.1 时间表三项文字样式对齐支付条款三项文字样式（含英文强制大写）
在预计时间表的 Step 1/2/3 行中：
- 将 `#val-step1/#val-step2/#val-step3` 输入框外包一层 `span`，复用支付条款同款样式：
  - `text-[10px] font-bold text-slate-500 uppercase`
- 同时将 `#val-step1/#val-step2/#val-step3` 输入框本身增加/保留：
  - `uppercase`（保证英文强制大写）
  - `bg-transparent outline-none`（保持可编辑但无边框）
  - `w-full`（避免使用 `w-24` 导致时间表项太窄）

修改位置参考：预计时间表区块 [index.html:L139-L165](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L139-L165)。

### 3.2 缩小时间表“天数”前的数字输入
当前 Step 1/2/3 的天数输入为：
- `input[type="number"]`（无 id），class 包含 `text-xs`（见 [index.html:L142-L164](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L142-L164)）

改动：
- 为 3 个天数输入分别补充 id，便于精确定位/后续维护：
  - `timeline-days-1 / timeline-days-2 / timeline-days-3`
- 将其字号从 `text-xs` 调整为更小的 `text-[9px]`（或 `text-[10px]` → 若希望更保守；本计划按“缩小”采用 `text-[9px]`），并保持品牌紫色：
  - `text-[9px] font-black text-[#582C83]`

### 3.3 缩小支付条款“%”前的数字输入
当前支付条款百分比输入为：
- `#payment-*-percent` class 含 `text-[10px] font-black text-[#582C83]`（见 [index.html:L181-L204](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L181-L204)）

改动：
- 将这 3 个输入（以及可选的第 4 项 `#payment-final-percent`）的字号改为 `text-[9px]`，并保持 `text-[#582C83]` 不变。
- `%` 符号本身保持现状（仍为 `text-[10px]`），以做到“只缩小数字”。

### 3.4 修复 PDF 克隆替换导致的字号丢失：扩展 classesToCopy
在 `generateQuotationPDF()` 的 `html2canvas.onclone` 中，扩展 `classesToCopy`，确保替换成 `span` 后仍然保留网页端的关键字号与布局类：
- 新增拷贝前缀：
  - `text-[`：覆盖 `text-[9px]`、`text-[10px]`、`text-[#582C83]` 等 Tailwind 任意值写法
  - `text-xs`：覆盖 Tailwind 语义字号（若后续仍使用）
  - `w-`：覆盖 `w-8/w-12/...` 等宽度类，使替换后的 `span` 在 flex 布局中宽度与网页一致

修改位置参考：PDF 替换逻辑 [index.html:L7836-L7867](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L7836-L7867)。

## 4. 假设与决策 (Assumptions & Decisions)
- 已确认：时间表英文也需要强制大写（Uppercase）。
- 字号选择：数字输入统一缩小到 `text-[9px]`，并通过第 3.4 条确保 PDF 与网页保持一致。
- 修改范围：仅限时间表/支付条款区域、以及 PDF 克隆替换的 class 拷贝白名单；不改动其他布局与颜色逻辑。

## 5. 验证步骤 (Verification Steps)
1. 本地打开报价生成页，确认：
   - 时间表三项文字的字号/颜色/字重与支付条款三项文字一致（目测对齐）。
   - 切换到英文（EN）后，时间表三项为大写显示。
   - 时间表“≈ 天数”的数字与支付条款“%”前的数字均明显更小。
2. 点击“生成报价（PDF）”，打开生成的 PDF，确认：
   - 时间表三项文字样式与网页一致。
   - “天数”数字与“%”数字的字号与网页一致（不会在 PDF 中变大或变回默认字号）。
   - 其它区域未出现意外字号变化（重点扫一遍客户信息、表格、汇总区）。

