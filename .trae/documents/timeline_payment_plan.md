# 时间表与支付条款样式改进计划 (Timeline & Payment Terms Plan)

## 1. 目标 (Summary)
根据您的需求，对报价单中的“预计时间表 (ESTIMATED TIMELINE)”和“支付条款 (PAYMENT TERMS)”两个组件进行样式和逻辑调整：
1. **预计时间表**：将步骤数字 (1, 2, 3) 的背景颜色修改为与 LOGO 相同的紫色（`bg-[#582C83]`）。
2. **支付条款**：
   - 将各个选项卡的上下间距缩窄，使其更紧凑。
   - 缩小百分比符号 `%` 前的数字字号，并将其颜色修改为与 LOGO 相同的紫色（`text-[#582C83]`）。
   - 新增一个可编辑的支付选项（例如“调试完成后”等，共计4项），并将底部的逻辑校验“3项相加等于100%”修改为“4项相加等于100%”。

## 2. 当前状态分析 (Current State Analysis)
1. **时间表**：
   目前数字圆圈使用了 `bg-purple-600`（即 `#9333ea`），而 LOGO 上的深紫色是 `#582C83`。
2. **支付条款样式**：
   - 目前各项高度由外层包裹容器的 `py-1.5 px-2` 和内部输入框的高度决定。
   - 输入框目前是 `text-xs font-bold text-purple-600`。
3. **支付条款逻辑**：
   目前 `index.html` 中在 `calculateQuote()` (约第 3911 行附近) 硬编码了 `confirmationPercent`, `installationPercent`, `testingPercent` 3个变量，并要求 `totalPercent === 100`。

## 3. 拟定更改 (Proposed Changes)

### 3.1 样式调整 (Styles)
- **时间表数字背景**：将 `bg-purple-600` 全部替换为 `bg-[#582C83]`。
- **支付条款高度缩窄**：将各项包裹层 `py-1.5 px-2` 修改为 `py-1 px-2`（如果还需要更窄，可以将输入框文字稍作调整）。
- **支付条款百分比颜色与大小**：
  将 `<input type="number" ... class="w-10 text-xs font-bold text-purple-600 ...">` 
  修改为 `<input type="number" ... class="w-10 text-[10px] font-black text-[#582C83] ...">`（缩小字号并改色）。

### 3.2 增加第 4 个支付条款 (Add 4th Payment Term)
- **HTML 结构**：
  在“测试与调试后” (`payment-testing`) 的下方，复制并新增一个块，命名为 `payment-final`（例如：验收后/Final Acceptance）。
- **JS 逻辑修改 (`calculateQuote` 函数)**：
  - 新增获取 `finalPercent` 的逻辑。
  - 将 `totalPercent` 计算公式改为 4 项相加。
  - 在更新 UI 时（如金额计算和红框警告重置），将 `payment-final` 及其对应的百分比输入框 `payment-final-percent` 纳入 `percentInputs` 数组中统一处理。

## 4. 假设与决策 (Assumptions & Decisions)
- **假设**：LOGO 的紫色提取值为 `#582C83`，这在原先的代码里出现过（如有效期徽章的背景）。
- **假设**：第 4 项支付条款的默认名称我们暂定为中文“交付验收后”/ 英文“Upon Final Acceptance”，默认百分比设为 `0`（以便用户可以自由配置如 30,40,20,10 或 30,30,30,10 等）。
- **决策**：统一将原本的 `text-purple-600` 替换为自定义颜色 `text-[#582C83]` 保持品牌色一致。

## 5. 验证步骤 (Verification steps)
- 修改完毕后，在浏览器中打开，确认：
  1. 时间表数字 1, 2, 3 背景变为深紫色。
  2. 支付条款变为 4 项，整体看起来比以前更扁更紧凑。
  3. 支付条款中的数字变小并变为深紫色。
  4. 随便输入数字，当 4 项之和不等于 100 时显示红框警告，等于 100 时自动计算出每项的具体金额。