# 报价单规格型号居中对齐计划 (Spec Alignment Plan)

## 1. 目标 (Summary)
将报价单中“规格型号 (SPEC)”这一列在打印/PDF中的内容对齐方式进行调整，使其从目前的偏左对齐（可能是默认的左对齐或没有显式指定而受输入框影响）更改为居中对齐（Center Alignment），与表头（`<th class="text-center">`）保持一致。

## 2. 当前状态分析 (Current State Analysis)
目前 `index.html` 中对于表格的 `SPEC` (规格型号) 列：
- 表头 `<th>` 使用了 `text-center`（第 224 行）：`<th class="py-2 px-2 w-24 text-center" id="th-spec">SPEC</th>`
- 静态表格行（第 237 行）以及 JavaScript 中动态渲染的模板（第 4016 行）中的 `<td>`：
  `<td class="py-2 px-2"><input ... class="w-full bg-transparent outline-none text-sm focus:text-blue-600"></td>`
- 从上述代码可以看出，输入框（`<input>`）并没有设置 `text-center`，默认是靠左对齐的。这就导致了在浏览器以及生成的 PDF 中，输入的内容略微偏左，而没有与居中的表头完全对齐。

## 3. 拟定更改 (Proposed Changes)
我们只需要在对应 `SPEC` 列的输入框 `<input>` 的 `class` 属性中添加 Tailwind 的居中对齐类 `text-center` 即可。

### 具体修改：
- **修改静态行（第 237 行左右）**：
  从 `<input type="text" value="5kWh" ... class="w-full bg-transparent outline-none text-sm focus:text-blue-600"`
  改为 `<input type="text" value="5kWh" ... class="w-full bg-transparent outline-none text-center text-sm focus:text-blue-600"`
- **修改动态渲染模板（第 4016 行左右）**：
  从 `<input type="text" value="${r.spec}" ... class="w-full bg-transparent outline-none text-sm focus:text-blue-600"`
  改为 `<input type="text" value="${r.spec}" ... class="w-full bg-transparent outline-none text-center text-sm focus:text-blue-600"`

## 4. 假设与决策 (Assumptions & Decisions)
- **决策**：通过直接在输入框的 `class` 列表中添加 `text-center`，可以确保无论是在网页浏览模式下，还是在打印生成 PDF 的模式下，规格文本都将完美居中对齐于表头。

## 5. 验证步骤 (Verification steps)
- 替换代码后，启动本地服务器并刷新页面。
- 观察页面上表格中“规格型号 (SPEC)”列的内容是否已水平居中。
- 可使用浏览器的“打印预览”功能，确认在 PDF 生成视角下该列的内容是否居中对齐。