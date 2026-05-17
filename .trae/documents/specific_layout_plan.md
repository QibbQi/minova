# 报价单局部样式与表格排版调整计划 (Specific Layout Adjustment Plan)

## 1. 目标 (Summary)
根据您的具体要求，我们将对报价单进行三项精确调整：
1. **缩短顶部公司地址与客户信息之间的间距**：删除两者之间的多余空白并移除边框分隔。
2. **调整产品明细表列宽与表头名称**：将表头文本修改为您手写的英文（DESCRIPTION, BRAND, SPEC, QTY），并根据图片比例重新分配各列的宽度。
3. **隐藏 PDF 打印中的单价 (UNIT PRICE)**：通过 CSS 的打印媒体查询，使“单价”列在网页端可见，但在生成的 PDF / 打印版本中隐藏。

## 2. 当前状态分析 (Current State Analysis)
1. **间距与分隔线**：在公司 Web 地址之后，目前有一个 `<div class="flex justify-between items-start mb-6 border-b-4 border-slate-1000 pb-4">` 的闭合标签，以及随后致客户区域上方的 `<div class="grid grid-cols-1 gap-12 mb-6">`。这导致了较大的垂直空白和一条很粗的底边框。
2. **表格列宽**：目前的产品列 (`th-desc`) 占据了 `w-[55%]` 或 `min-w-[30ch]`，而其他列宽度分配较为平均。表头文本目前为中文（如：产品、品牌、规格型号、数量）。
3. **单价显示**：目前的 `th-price` 列和对应的输入框列并没有设置针对打印隐藏的 CSS 类。

## 3. 拟定更改 (Proposed Changes)

### 修改项 1：移除多余间距与粗边框 (Header to Customer Gap)
- **目标文件**：`index.html`
- **操作**：
  将原本包含 `border-b-4 border-slate-1000 pb-4` 的 `<div>` 简化，去除边框，并将底边距 `mb-6` 改为 `mb-2`。
  将致客户上方的外层网格容器 `<div class="grid grid-cols-1 gap-12 mb-6">` 彻底移除或精简为无间距包裹层，紧凑连接两个区域。

### 修改项 2：表格列宽分配与英文表头 (Table Columns & Headers)
- **目标文件**：`index.html`
- **操作**：
  - 修改 `<thead>` 中的文字：
    - "产品" -> "DESCRIPTION"
    - "品牌" -> "BRAND"
    - "规格型号" -> "SPEC"
    - "数量" -> "QTY"
  - 调整类名控制的宽度比例（参考图片比例）：
    - `DESCRIPTION`: 设为 `w-[35%]` 或 `w-[40%]` (适当缩减)。
    - `BRAND`: 设为 `w-32`。
    - `SPEC`: 设为 `w-24`。
    - `QTY`: 设为 `w-16`。
    - `UNIT PRICE`: 设为 `w-28`。
    - `AMOUNT`: 设为 `w-32`。

### 修改项 3：PDF 中隐藏单价列 (Hide Unit Price in Print)
- **目标文件**：`index.html`
- **操作**：
  - 在“单价 (¥)”的 `<th>` 标签上添加 Tailwind 打印隐藏类 `print:hidden`（或者项目中已有的自定义类 `no-print`）。
  - 在渲染单价输入框的 `<td>` 标签上同步添加 `print:hidden` / `no-print`。
  - 需要同时修改静态的 `<tr>` 行以及在 JavaScript 中动态渲染行时的字符串模板（`renderQuote` 函数内部）。

## 4. 假设与决策 (Assumptions & Decisions)
- **决策**：对于单价隐藏，项目中已有现成的 `.no-print` CSS 类。我们将直接复用 `no-print` 类加在单价的 `th` 和 `td` 上，这样不仅生成的 PDF 看不到，使用浏览器的“打印”功能也看不到，符合预期。
- **假设**：表格宽度的绝对完美像素级对齐需要不断微调，目前先采用 Tailwind 预设的百分比与固定宽度组合（如 `w-[40%]`，`w-32` 等），保证视觉上趋近于手写图片的比例。

## 5. 验证步骤 (Verification steps)
- 修改完成后，启动 `python3 -m http.server 8080`，打开页面检查：
  1. 公司 Web 网址与 "TO CUSTOMER" (致客户) 之间的间距是否紧凑且没有粗黑线。
  2. 表格的列头是否变成了 DESCRIPTION, BRAND, SPEC, QTY，且列宽分布合理。
  3. 使用浏览器的“打印预览” (Cmd+P / Ctrl+P)，确认“单价”这一列彻底消失，但小计金额依然存在。