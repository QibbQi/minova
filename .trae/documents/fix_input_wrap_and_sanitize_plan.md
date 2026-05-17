# 修复文字超长无法换行及 sanitizePositiveInt 报错的计划

## 1. 现状分析
**问题 1：可修改的文字在打印后无法自动换行显示**
- **原因**：目前网页中用户输入文字的地方，绝大多数使用的是 `<input type="text">` 标签。HTML 中的 `input` 标签在任何情况下（即使在 CSS 中设置了宽度）都是**绝对不会自动换行**的。当用户输入很长的地址或备注（例如截图中 `lakdfkljahd...`）时，超出的部分在网页和 PDF 中都会被截断隐藏，导致打印出来内容不完整。
- **目标**：需要将可能输入长文本的输入框，替换为 `<textarea>` 标签，或者让它们在打印时表现为支持多行的元素。由于这些输入框的样式目前都是单行，最平滑的做法是将 `input` 替换为 `<textarea rows="1">`，并通过 CSS/JS 让它根据内容自动撑高，或者添加专门的打印样式让其换行。对于截图中具体的 `input-site-address` 和付款条款等，均需要修改为 `textarea`。

**问题 2：`ReferenceError: sanitizePositiveInt is not defined` 报错**
- **原因**：在 ID 为 `input-proposed-size` 的元素中（第 479 行左右），绑定了 `oninput="sanitizePositiveInt(this)"`。但在后续或前期的代码重构中，这个全局函数 `sanitizePositiveInt` 被移除或者从未定义，导致用户在输入数值时触发 `oninput` 事件直接抛出 JS 异常。

## 2. 具体修改方案

### 2.1 修复 `sanitizePositiveInt` 报错
- **处理方式**：在 `index.html` 的顶层 `<script id="multi-page-script">` 块的开头（或全局作用域），补充定义这个丢失的辅助函数。
  ```javascript
  window.sanitizePositiveInt = (el) => {
      let val = el.value.replace(/[^0-9]/g, ''); // 移除非数字字符
      if (val !== '') {
          val = parseInt(val, 10);
          if (val < 1) val = 1; // 保证大于0
      }
      el.value = val;
  };
  ```

### 2.2 将关键长文本 `input` 替换为 `textarea` 以支持换行
- 检索所有长文本输入框（如 `Site Address`、付款条款名称等），将 `<input type="text">` 替换为 `<textarea rows="1">`。
- **自动高度调整**：在 `textarea` 上增加一个 `oninput` 处理器，使其在输入时自动调整高度：`oninput="this.style.height = ''; this.style.height = this.scrollHeight + 'px'"`
- **关键修改点（基于截图和业务逻辑）**：
  1. `input-site-address` (地址栏)
  2. `input-timeline-desc-1`, `input-timeline-desc-2`, `input-timeline-desc-3` (Timeline 描述)
  3. `input-payment-desc-1`, `input-payment-desc-2`, `input-payment-desc-3` (Payment Terms 描述)
  4. `Conditions` 区域的输入框（如果是 input 的话，也改为 textarea）
- **CSS 优化**：在全局或 `textarea` 的行内样式中增加 `resize: none; overflow: hidden;`，使其在视觉上与原来的 `input` 保持一致，但在多行时能自然撑开，从而在生成 PDF 时能够把所有的文字渲染出来。

## 3. 假设与决策
- 不修改原有的 Tailwind CSS 类名（字体大小、颜色等），只把 `input` 标签换成 `textarea`，以保持样式完美统一。
- 在 `html2pdf` 生成 PDF 时，`textarea` 只要其高度是被内容撑开的（通过我们加的 `scrollHeight` 调整），就能完整展示多行文字。

## 4. 验证步骤
1. 刷新页面，在 `Site Address` 或 `Payment Terms` 栏输入一段极长极长的随机字母。
2. 验证：输入框是否随着文字增多而自动换行向下撑开，不再被截断隐藏。
3. 在 `Proposed System Size` 中输入字符或负数，检查控制台是否不再出现 `sanitizePositiveInt is not defined` 的报错，并且输入被自动修正为正整数。
4. 生成一次 PDF，确认这些长文本在导出的 PDF 中也能正常折行显示。
