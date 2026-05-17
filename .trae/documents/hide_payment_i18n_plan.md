# 隐藏第四项支付条款及多语言支持计划 (Hide 4th Payment Term & i18n Plan)

## 1. 目标 (Summary)
根据您的需求，对刚添加的第四项支付条款（`payment-final`）进行以下修改：
1. **默认隐藏**：第四项在默认情况下不显示，并在列表底部增加一个“+”号按钮（或者文字链接），用户点击后才会显示该项。
2. **多语言支持 (i18n)**：第四项的标签名称必须支持中英文切换。点击网页顶部的 "中 / EN" 按钮时，该项的名称（例如："交付验收后" / "Upon Final Acceptance"）能自动跟随切换。

## 2. 当前状态分析 (Current State Analysis)
1. **第四项的 HTML 结构**：目前在 `index.html` 的 211-221 行，第四项的标签是一个输入框：`<input type="text" id="lbl-final" value="交付验收后" ...>`，目前它是始终显示的。
2. **多语言切换逻辑**：系统中的中英文切换逻辑集中在 `i18n` 字典对象（3464-3533行）以及 `updateLanguageLabels` 函数（3724-3809行）中。目前 `i18n` 字典和更新函数中尚未包含第四项（`final`）的字段。

## 3. 拟定更改 (Proposed Changes)

### 3.1 修改 HTML 结构以支持折叠
- **隐藏第四项**：在第四项的最外层 `<div class="flex justify-between... group/pay">` 上添加一个 `id="payment-final-container"` 以及 `hidden` 类名，使其默认不可见。
- **添加“+ 增加支付阶段”按钮**：在第四项的下方（但仍在包围所有支付条款的容器内），添加一个居中的、带有虚线边框或浅色背景的小按钮（带有 `id="btn-add-payment"`），点击该按钮后触发一个 JS 函数来显示第四项。
- **增加“删除”功能**：在第四项内添加一个“移除”小按钮（类似于“✕”），点击后可重新隐藏该项，并将百分比重置为 0，同时触发重新计算总和。

### 3.2 增加多语言 (i18n) 支持
- **修改 `i18n` 字典**：
  - 在 `zh` 下增加：`final: "交付验收后", addPayment: "+ 增加阶段"`
  - 在 `en` 下增加：`final: "Upon Final Acceptance", addPayment: "+ Add Phase"`
- **更新 `updateLanguageLabels` 函数**：
  - 增加代码，使得在切换语言时，自动更新第四项的 `value`（因为它是 input 标签）以及增加按钮的文本：
    ```javascript
    document.getElementById('lbl-final').value = t.final;
    document.getElementById('btn-add-payment').textContent = t.addPayment;
    ```

### 3.3 新增控制逻辑
- 新增 JS 函数 `toggleFinalPayment(show)`：
  - 如果 `show` 为 `true`：移除 `payment-final-container` 的 `hidden` 类，隐藏 `btn-add-payment` 按钮。
  - 如果 `show` 为 `false`：添加 `hidden` 类，显示 `btn-add-payment` 按钮，将 `payment-final-percent` 的值重置为 0，并调用 `calculateQuote()` 重新计算和验证 100% 的总和逻辑。

## 4. 假设与决策 (Assumptions & Decisions)
- **假设**：由于用户需要“第四项”，这暗示系统最多支持 4 项支付条款，不再无限制增加。因此通过简单的显示/隐藏逻辑来控制这唯一一个额外的条目是最稳定和可控的方案。
- **决策**：虽然第四项是一个 `input type="text"`（允许用户手动修改名字），但当用户点击中英文切换时，我们会用 `i18n` 中的默认中英文词汇（“交付验收后”/“Upon Final Acceptance”）去覆盖它，以保证翻译行为的正确触发。

## 5. 验证步骤 (Verification steps)
- 修改完成后，刷新页面，确认：
  1. 默认情况下只有前三项支付条款，下方有一个“+ 增加阶段”的按钮。
  2. 此时修改前三项的比例相加等于 100 即可通过验证。
  3. 点击“+ 增加阶段”后，第四项出现，且必须 4 项相加等于 100 才通过验证。
  4. 点击右上角“中 / EN”按钮，观察第四项的名字以及“+ 增加阶段”按钮的文字是否随之正确切换语言。