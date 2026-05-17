# PDF 每个视图至少占一页（不连续拼接）调整计划

## **Summary**
- 调整生成报价 PDF 的分页规则：每个视图页（quote-page-1..5）在 PDF 中至少占据 1 个 A4 页面空间；若该视图内容超长，则在该视图内部正常断页，但下一个视图必须从新的一页开始，避免出现“内容不够时下一个视图被接到同一页底部”的情况。

## **Current State Analysis**
- PDF 生成核心逻辑集中在 [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html) 的 `window.confirmAndGeneratePDF` 内，使用 `html2pdf` 的 `pagebreak: { mode: ['css','legacy'] }` 以及 `html2canvas.onclone` 注入打印样式：
  - `confirmAndGeneratePDF`：[index.html:L7998-L8214](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L7998-L8214)
  - `onclone` 样式与页面处理：[index.html:L8061-L8112](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L8061-L8112)
- 当前 `onclone` 会把每个保留的 `.quote-page` 强制设为 `minHeight = 'auto'`，导致“短内容页面”不会占满一整页：[index.html:L8083-L8085](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L8083-L8085)
- 代码会给第 2 页及以后追加 `pdf-page-break` 类（意图是让每个视图独占新页），但没有对应的 CSS 规则，分页效果依赖库的默认行为，不稳定：
  - 追加 class：[index.html:L8088-L8091](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L8088-L8091)
  - 注入样式未包含 `.pdf-page-break`：[index.html:L8103-L8112](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L8103-L8112)

## **Proposed Changes**

### 1) 强制“视图之间”分页（避免内容连续接上）
**文件**： [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)  
**位置**：`html2canvas.onclone` 的 `style.innerHTML` 注入处：[index.html:L8103-L8112](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L8103-L8112)

**修改内容**
- 在注入的 CSS 中新增 `.pdf-page-break` 的强制分页规则：
  - `break-before: page;`
  - `page-break-before: always;`
  - 为兼容性补充 `break-before: always;`（部分引擎对 `page`/`always` 有差异）

**理由**
- 当前仅加 class 不加 CSS，库不一定会把它当作分页锚点；补齐 CSS 后，“第 2~5 个视图一定从新页开始”会变成确定行为。

### 2) 强制“每个视图至少占一页 A4 高度”
**文件**： [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)  
**位置**：`onclone` 对 `.quote-page` 的逐页样式设置处：[index.html:L8077-L8087](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L8077-L8087)

**修改内容**
- 将 `page.style.minHeight = 'auto'` 替换为 `page.style.minHeight = '297mm'`（A4 高度）。
- 保留 `page.style.height = 'auto'`，确保超长内容可在该视图内部自然断页（不会被强制压缩或截断）。
- 增加 `page.style.boxSizing = 'border-box'`，确保 `width: 210mm` 时包含内边距，避免布局溢出导致的渲染异常。

**理由**
- `min-height: 297mm` 让“内容少的视图”也至少撑满一张 A4，这样后续视图即使被强制换页，也不会出现“上一页底部空一截，但下一视图被挤到同页底部”的视觉错误。
- 不使用 `page-break-inside: avoid` 施加在 `.quote-page` 上，避免阻止长内容在视图内部断页（你的需求是“超长则在该页断页”）。

## **Assumptions & Decisions**
- 采用 A4 无页边距（当前 `@page { margin: 0 }`）作为基准，因此最小高度使用 `297mm`；内容区域的左右留白继续由现有 Tailwind 的 `p-12 md:p-16` 控制（保持与网页一致）。
- 只做“视图之间强制换页”和“视图最小高度”两类调整，不改变附件（PDF/图片）合并逻辑、不改页面选择 UI。

## **Verification**
1. 在页面中选择“生成报价（PDF）”，勾选 **全选 5 页**，生成 PDF：应保证每个视图至少占 1 页，且视图之间不在同一页连续拼接。
2. 让 Quotation（第 1 页）内容变长（例如增加更多报价行或将条款文本拉长），再次生成：应保证第 1 视图内部可跨页断开，且第 2 视图从“第 1 视图结束后的下一页”开始。
3. 将第 3/4/5 页保持“几乎无内容”（或只保留页眉），生成 PDF：应仍各自占据独立的一整页（不会出现多个页眉挤在同一页的情况）。
4. 同时勾选并合并至少 1 个认证 PDF 与 1 张图片附件：最终 PDF 应包含 5 页视图 + 附件页，且视图分页规则仍满足上述要求。

