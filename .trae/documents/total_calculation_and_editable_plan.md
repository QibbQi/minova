# 报价生成页及PDF展示优化计划

## 1. 目标 (Summary)
根据您的最新要求，我们将进行以下几项优化：
1. **预计时间表 (Timeline) 和支付条款 (Payment Terms) 标题可编辑**：将时间表中的 3 个阶段名称以及支付条款的选项名称改为可编辑输入框，同时保留中英文翻译切换功能。
2. **汇总区域 (Grand Total) 逻辑与展示调整**：
   - 增加一行 `Sub-Total` (小计)，数值等于之前原有的计算总和。
   - 增加一行 `SST (6%)` (销售服务税)，数值等于 `Sub-Total` × 0.06。
   - 重新定义 `Grand Total` = `Sub-Total` + `SST (6%)`。
   - 在 UI 展示上，保持 `Shipping & Handling` 在原有位置；将 `Sub-Total` 和 `SST (6%)` 以普通行显示（类似于目前“项目总数”或“运输与装卸”的样式）；最后在最底部的紫黄药章 (Pill) 设计中只突出最终的 `GRAND TOTAL`。

## 2. 当前状态分析 (Current State Analysis)
1. **时间表和支付条款名称**：
   - 目前在时间表中，阶段名称（如 `val-step1`）使用的是 `<span>` 标签。
   - 在支付条款中，前三项也是使用 `<span>` 标签（例如 `lbl-confirmation`），只有第四项使用的是 `<input>` 标签。
   - 在 JavaScript 的 `updateLanguageLabels` 中，通过 `textContent` 来直接替换这些 `<span>` 的文本。
2. **汇总区域**：
   - 目前在 `grand-total-container` 区域（约第 474 行）包含：项目总数、平均毛利率、运输与装卸，以及最底部的 `GRAND TOTAL` 块。
   - 在 `calculateQuote()` 函数中，变量 `total` 即为当前所有明细相加之和。最终赋值给 `#grand-total` 和 `#payment-grand-total`。

## 3. 拟定更改 (Proposed Changes)

### 3.1 预计时间表和支付条款改为可编辑输入框
- **修改 HTML 结构**：
  将时间表的 3 个 `<span>` 标签（`id="val-step1"` 到 `step3`）修改为 `<input type="text">` 标签，添加 `w-full bg-transparent outline-none placeholder-slate-400` 等类名。
  将支付条款的前 3 个 `<span>` 标签（`id="lbl-confirmation"` 等）也修改为 `<input type="text">`。
- **修改 JavaScript 语言更新逻辑**：
  在 `updateLanguageLabels` 函数中，由于这些元素现在是 `<input>`，所以需要将 `element.textContent = ...` 更改为 `element.value = ...`。这样既能让用户手动修改内容，又能在点击翻译时重置为标准的双语词汇。

### 3.2 汇总区域 (Sub-Total & SST & Grand Total) 增加计算与展示
- **修改 HTML 结构**：
  在 `grand-total-container`（第 486 行，紧跟在“运输与装卸”后面）插入两行新结构：
  ```html
  <div class="flex justify-between items-center text-slate-500 font-bold text-sm">
      <span id="lbl-sub-total" class="uppercase">Sub-Total</span>
      <div><span class="currency-symbol mr-1">¥</span><span id="val-sub-total">0.00</span></div>
  </div>
  <div class="flex justify-between items-center text-slate-500 font-bold text-sm">
      <span id="lbl-sst" class="uppercase">SST (6%)</span>
      <div><span class="currency-symbol mr-1">¥</span><span id="val-sst">0.00</span></div>
  </div>
  ```
- **多语言字典增加 (i18n)**：
  在 `i18n` 字典中增加 `subTotal: "小计 (Sub-Total)"`，`sst: "销售服务税 (SST 6%)"` 等词条，并在 `updateLanguageLabels` 中更新这两个 `<span>`。
- **修改 `calculateQuote()` 核心计算逻辑**：
  1. `subTotal` = 遍历所有行的金额相加之和（原本的 `total`）。
  2. `sst` = `subTotal * 0.06`。
  3. `grandTotal` = `subTotal + sst`。
  4. 将这三个值格式化后分别赋给页面上的 `#val-sub-total`、`#val-sst` 和 `#grand-total`（以及 `#payment-grand-total` 用于支付条款百分比的计算基数）。

## 4. 假设与决策 (Assumptions & Decisions)
- **决策 1**：时间表和支付条款名称变为 `<input>` 后，我们依然绑定它们的多语言切换。如果用户自己输入了“特定名称”，只要点击“中/EN”切换，就会被系统的标准翻译覆盖。这符合您“保留英文可翻译”的要求。
- **决策 2**：`SST (6%)` 的税率目前在代码里硬编码为 0.06，这是最符合您“SST(6%) [请用 Sub-total 计算]”直观描述的做法，暂时不作为一个可下拉修改的税率框处理，以保持界面简洁。支付条款的百分比计算，也将以新的 `Grand Total` (含税) 作为总基数计算。

## 5. 验证步骤 (Verification steps)
- 刷新页面。
- 确认时间表 3 个步骤名称和支付条款 3 个阶段名称变成了可以点击和打字的输入框。
- 切换语言，确认它们的内容能随之改变。
- 在产品表中添加几项，确认右下角汇总区依次出现：运输与装卸（保持在一行）、小计（Sub-Total）、SST(6%)，并在最底部的紫黄高亮框中只突出 GRAND TOTAL。
- 检查各项数字之间的加法逻辑是否完全正确：`Sub-Total` + `SST` 是否等于 `Grand Total`。