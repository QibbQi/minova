# 报价生成页多页与保存功能开发计划

## 1. 现状分析
当前 `index.html` 的“报价生成”标签页（`#view-quotation`）仅包含一页（报价明细及条款），且所有的状态（报价行、客户信息等）均保存在内存变量或散落于 `localStorage`。打印/生成 PDF 功能直接读取该页的 `.print-container`。
为了满足新增的 4 个页面的需求（且不相互干扰、统一打印、统一保存），我们需要：
1. 重构 DOM 结构，在 `#view-quotation` 内引入多个平级的 `.print-container`。
2. 引入 IndexedDB 以存储包含大量 Base64 图片（产品图、屋顶图、参考图）的报价单，突破 `localStorage` 的 5MB 限制。
3. 增加打印页选择弹窗，让用户勾选要生成的页面。

## 2. 具体修改方案

### 2.1 UI 导航与重构
- 在 `#view-quotation` 顶部新增**“报价保存管理”与“视图切换”操作栏**。
- 创建一个包层 `#pdf-content-wrapper`。
- 将原本的报价表单放入 `#quote-page-1`（第一页）。
- 依次创建 `#quote-page-2` 到 `#quote-page-5`，默认隐藏，通过下拉框或标签栏切换显示。
- **公共页眉**：为第 2~5 页的顶部添加与第一页一致的 Logo 与 `Solar System Solution | Storage Battery` 副标题，并在右上角显示对应的英文/中文页面标题（如 "ROI / FINANCIAL ANALYSIS"）。

### 2.2 第 2 页：ROI / Financial Analysis
- **输入区域**：安装前月均电费（Before）、安装后月均电费（After）、系统总成本（System Cost，默认联动第一页的 Grand Total，但可修改）。
- **计算表格**：生成 **10年** 的投资回报预测表。
- **展示字段**：Year（年份）、Annual Saving（年度节省）、Cumulative Saving（累计节省）、ROI %（投资回报率）。
- 编写 `calculateROI()` 实时更新表格数据。

### 2.3 第 3 页：Part Breakdown & Warranty
- 编写 `renderPartBreakdown()` 函数，每次切换到该页时，基于第一页的 `quoteRows`（产品清单）动态生成列表。
- 每个产品卡片包含：
  - 产品名称与规格文本。
  - **Brand Image (品牌图)** 上传按钮及预览区。
  - **Product Image (产品图)** 上传按钮及预览区。
  - **Warranty (质保期)** 文本输入框。
- 图片上传后转为 Base64 在本地显示，以便存入 IndexedDB。

### 2.4 第 4 页：Reference
- 提供一个灵活的**参考信息块列表**，初始为空。
- 用户可点击“新增参考块”，每个块包含：
  - 标题输入（例如：“APP 控制页界面”）。
  - 图片上传区域。
  - 多行文本描述区域。
- 同样支持图片 Base64 转换与预览。

### 2.5 第 5 页：Site Overview
- 提供“上传屋顶图片”功能，上传后将图片设为一个相对定位容器 `#roof-canvas` 的背景。
- 提供“添加光伏组件”按钮，点击后在 `#roof-canvas` 内生成一个小方块（代表光伏板）。
- 使用原生 JavaScript 为光伏板方块添加**拖拽（Drag）**与**调节大小（Resize）**事件。
- 保存报价时，将记录屋顶背景图的 Base64 以及每个光伏板的相对位置 (x, y) 和尺寸 (width, height)。

### 2.6 生成报价（PDF）与打印逻辑优化
- 修改 `generateQuotationPDF()` 流程：
  1. 弹出一个全新的**“打印页面选择”弹窗**（勾选 1~5 页）。
  2. 确认后，保存选中的页面数组，接着调用原有的资质附件选择弹窗 `openCertAttachmentModal()`。
  3. 最后生成 PDF 时，修改 `html2canvas.onclone` 逻辑：遍历所有的 `#quote-page-X`，**移除未勾选的页面**，将选中的页面 `classList.remove('hidden')`，并为第二个及之后的页面添加 `page-break-before: always !important` 强制分页。

### 2.7 IndexedDB 本地保存与加载系统
- 在 `index.html` 中内嵌一段 IndexedDB 操作逻辑，数据库名 `MinovaQuotesDB`，对象仓库名 `quotes`。
- **保存功能 (`saveCurrentQuote`)**：
  - 收集第 1 页表单数据（`quoteRows`, 总价, 客户信息等）。
  - 收集第 2 页的电费输入与成本。
  - 收集第 3 页各产品的 Base64 图片与质保期。
  - 收集第 4 页的参考图与文本。
  - 收集第 5 页的屋顶背景与组件坐标。
  - 将所有数据组合为 JSON 对象，存入 IndexedDB，更新下拉列表。
- **加载功能 (`loadSavedQuote`)**：
  - 从 IndexedDB 读取对象，还原所有的输入框、变量、表格和图片预览，重新渲染光伏组件 DOM。
- **重置/新建功能**：清空所有状态与页面输入，准备新的报价。

## 3. 假设与决策
- **语言一致性**：新增加的页面标题和表格表头将支持中/EN 切换，在 `updateLanguageLabels()` 中增加对应字段。
- **数据安全**：不使用 `localStorage` 存储图片，仅存轻量级配置，所有“已保存报价单”统一放入 IndexedDB，保证浏览器不会因体积过大而报错。
- **无依赖**：拖拽和缩放组件不引入额外的第三方库（如 jQuery UI），直接使用原生 DOM `mousedown/mousemove/mouseup` 事件实现，保证项目轻量化。

## 4. 验证步骤
1. 打开页面，确认“报价生成”页顶部出现“视图切换”和“已存报价”下拉框。
2. 切换至第 2 页，输入安装前后电费，检查 10 年 ROI 表格是否正确计算并更新。
3. 切换至第 3 页，确保显示了第 1 页添加的产品，并尝试上传图片和输入质保期。
4. 切换至第 4 页，新增参考图块，上传图片并输入描述。
5. 切换至第 5 页，上传屋顶图背景，添加多个光伏组件，测试拖拽和大小调节。
6. 点击“保存当前报价”，然后点击“新建”，再从下拉框选择刚保存的报价点击“加载”，确认所有页面的图片、输入、拖拽位置均完美还原。
7. 点击“生成报价（PDF）”，勾选第 1、2、5 页，生成 PDF，检查 PDF 内是否只有这三页，且每一页均有 Logo 与副标题，排版未乱。
