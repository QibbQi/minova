# 修复保存报错与多页 PDF 下载空白问题计划

## 1. 现状分析
1. **`prompt() / confirm() / alert()` 不支持**：在特定的预览环境或嵌入式浏览器中，原生的 `prompt` 等对话框函数被拦截或不支持，导致点击“保存”报价单时直接抛出 `Error: prompt() is not supported.` 从而中断保存流程。
2. **多页 PDF 下载空白/内容缺失**：在 `window.confirmAndGeneratePDF` 函数中，使用了 `document.querySelector('.print-container')`。由于 `querySelector` 仅返回文档中匹配的**第一个**元素（也就是第一页 Quotation），当 PDF 引擎尝试基于此容器生成多页时，由于外层没有包裹所有页，导致只渲染第一页或者在当前视图非第一页时渲染出空白。

## 2. 具体修改方案

### 2.1 修复 PDF 生成目标容器
- 将 `index.html` 中的 `confirmAndGeneratePDF` 函数里的：
  `const container = document.querySelector('.print-container');`
  修改为：
  `const container = document.getElementById('pdf-content-wrapper');`
- 由于 `#pdf-content-wrapper` 包裹了所有的 `#quote-page-1` 到 `#quote-page-5`，将其作为目标容器传给 `html2pdf()`，配合已经写好的 `onclone` 选择与分页逻辑，即可完美导出被选中的所有页面。

### 2.2 替换原生 Dialog 函数为自定义 UI
- **新增 Toast 提示系统**：
  - 编写一个轻量级的 `window.showToast(message, type)` 函数，在屏幕上方或右下角弹出 Tailwind 样式的提示条（自动消失），用于替换所有的 `alert()`。
- **新增保存输入模态框 (Save Modal)**：
  - 在 HTML 中插入一个隐藏的模态框 `#quote-save-modal`，包含一个 `input` 和确认/取消按钮。
  - 修改导航栏上的保存按钮，使其先调用 `window.openSaveQuoteModal()` 展开该模态框，并将默认的“客户名称”填入。
  - 用户点击“确认保存”后，调用新的 `window.executeSaveQuote(name)` 将数据存入 IndexedDB 并触发 `showToast('保存成功')`。
- **新增删除确认模态框 (Delete Confirm Modal)**：
  - 在 HTML 中插入一个 `#quote-delete-modal`，提示“是否确认删除？”。
  - 点击“删除”按钮时展开此模态框，确认后再执行 IndexedDB 删除操作并 `showToast('删除成功')`。
- 替换现有的 `loadSavedQuote()` 成功/失败时的 `alert()` 为 `showToast()`。

## 3. 假设与决策
- 继续使用纯原生 JavaScript 和 Tailwind CSS 构建自定义模态框，不引入任何外部 UI 库库。
- 将保存和删除操作从同步的 `prompt/confirm` 改为基于模态框事件驱动的异步流程，完全规避环境限制问题。

## 4. 验证步骤
1. 点击导航栏“保存”按钮，检查是否弹出了网页内部渲染的“请输入报价保存名称”模态框（而非浏览器原生弹窗）。
2. 输入名称并点击保存，检查是否在屏幕上看到了“保存成功”的提示条（Toast）。
3. 选择一个保存的报价单，点击“加载”和“删除”按钮，检查是否弹出了提示条或自定义删除确认框，不再出现任何 Console 报错。
4. 切换当前视图到“2. ROI / Financial Analysis”。
5. 点击“生成报价（PDF）”，勾选附加页，生成 PDF 并下载。
6. 打开 PDF，检查是否正确包含了第 1 页和附加页内容，不再是空白。
