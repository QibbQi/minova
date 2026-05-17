## Summary

本计划修复 Site Overview（第 5 页 Roof 编辑器）7 项问题：标注多选拖动、测距微调面板恢复、置顶/上移图标方向、删除间距模式、标尺原点从左上开始、PDF 导出图片不变形、PDF 中自定义多边形（顶点编辑后的 clip-path）正常显示。

## Current State Analysis（基于仓库实测）

- 主实现集中在 [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html)
  - Roof 编辑器结构（包含 `#roof-image/#roof-viewport/#roof-measure-layer/#roof-ruler-x/#roof-ruler-y`）：[index.html:L820-L924](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L820-L924)
  - 标注选择/拖动交互（`select_measures` / `roofMeasureSelection` / `roofMeasureDrag`）：[initRoofEditorOnce](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L11592-L12220)
  - 测距 label 渲染（`addMeasureLabel`）与可编辑条件： [addMeasureLabel](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L10726-L10810)
  - 全局 CSS 禁用 number input 的上下调节按钮：`input::-webkit-inner-spin-button { -webkit-appearance:none; }`（导致“上下调节面板”不出现）：[index.html:L24](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L24)
  - 标尺/网格渲染： [renderRulersAndGrid](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L11104-L11217)
  - 图片矩形计算采用“contain + 居中留白”（`x=(vw-w)/2, y=(vh-h)/2`）：[getImageRect](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L9996-L10010)
  - PDF 生成（html2pdf/html2canvas onclone）：[confirmAndGeneratePDF](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L8609-L8814)
  - 自定义组件形状靠 `div + clip-path: polygon(...)`，顶点编辑时会写入 `shapeDiv.style.clipPath`：[renderModules](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L11384-L11542)
  - 工具栏含 `measure_spacing`，并在 pointerdown 中创建 `type:'spacing'` 标注： [tool mode option & pointerdown](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L862-L11763)
  - 置顶/上移按钮的 SVG path 目前是“箭头向下”：[buttons](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L738-L739)

## Proposed Changes

### 1) 标注多选拖动：拖动时移动全部选中的标注

**目标**
- 在 `Marks(select_measures)` 模式下：
  - 框选/Shift 多选多个标注后，按住任意一个已选标注拖动，应整体平移所有选中标注，而不是只动其中一个。
  - 单个标注拖动逻辑保持不变（点未选中的标注则切换为单选后拖动）。

**修改点**
- 文件： [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html)
- 位置：pointerdown/pointermove 的 `roofToolMode === 'select_measures'` 分支
  - [initRoofEditorOnce:pointerdown](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L11649-L11687)
  - [initRoofEditorOnce:pointermove](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L11844-L11937)

**实现方式**
- pointerdown（select_measures）：
  - 若点击的标注 id 已在 `roofMeasureSelection` 且未按 shift：不重置 selection，仅进入拖动。
  - 若点击的标注 id 不在 selection 且未按 shift：重置为单选并拖动（维持当前体验）。
  - 新增 `roofMeasureDrag.ids`（数组/Set），记录本次拖动需要平移的所有 measurement id；并缓存每个 id 的 initial 快照（dist: a/b；area: points）。
- pointermove（dragging）：
  - 当 `roofMeasureDrag.ids.size > 1 && role === 'all'`：对所有选中标注应用同一平移向量。
  - 对 dist 的吸附：以“当前点击的那个标注”为锚点计算 snap（仍用现有 `snapMeasurePointToCornersEx/snapMeasurePointToModulesEx + addOrthoSnapLines`），得到 ddx/ddy 后将相同 ddx/ddy 应用到其它 dist/area（保证群组保持相对位置）。
  - 仅当 role 为 `a/b/v#` 时保持单个标注编辑（多选时点击端点仍视为单标注编辑，避免意外批量改端点）。

### 2) 测距上下微调面板恢复：只在 Marks 模式可用（且不可键入）

**用户决策**
- “上下调节面板”仅在 `Marks(select_measures)` 模式下可用。

**问题根因**
- 全局 CSS 禁用了 number input 的 spin buttons，导致浏览器原生上下调节 UI 不再显示：[index.html:L24](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L24)

**修改点**
- 文件： [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html)
- 位置： [addMeasureLabel](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L10726-L10810)

**实现方式**
- 保留现有“pill”样式与 `input.readOnly + 禁键盘` 的约束（符合“只能点击调节不能输入”）。
- 用自定义 stepper 取代浏览器 spinner：
  - 在 label 内新增一组垂直小按钮（▲/▼ 或 SVG），点击一次让长度 ±0.001。
  - 逻辑复用 `updateDistMeasureLengthInternal(mid, nextLen, false)`，并沿用现有 debounce commit（320ms）+ blur commit。
  - 点击按钮需 `stopPropagation()`，避免触发标注拖动。
- 仍保留数值展示（input）但仅作展示与被按钮修改的容器。

### 3) “置顶/上移”按钮 SVG 箭头方向改为向上

**修改点**
- 文件： [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html)
- 位置： [buttons](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L738-L739)

**实现方式**
- 替换为向上箭头的 path（或对现有 path 做 180° 旋转），确保图形语义一致（置顶/上移都应向上）。

### 4) 删除“间距（Space）”模式并清理 spacing 标注

**用户决策**
- 删除模式后：不再显示并清理 `type:'spacing'` 标注。

**修改点**
- 文件： [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html)
- 位置：
  - 工具栏下拉选项移除 `measure_spacing`：[tool mode option](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L862-L873)
  - `updateRoofSettingsFromUI()` 内移除对该模式的 setOpt 处理（目前有 `setOpt('roof-tool-mode','measure_spacing',...)`）：[index.html:L4600-L4604](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L4600-L4604)
  - pointerdown 的 `roofToolMode === 'measure_spacing'` 分支删除：[index.html:L11743-L11763](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L11743-L11763)
  - `createSpacingMeasurementsFromSelection()` 删除或保留但不再被调用：[index.html:L10684-L10724](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L10684-L10724)
  - `renderRoofMeasurements()` 中 `type==='spacing'` 的绘制分支一并删除，避免旧数据继续显示。

**数据清理策略**
- 在以下入口对 `siteOverview.measurements` 执行一次过滤：移除 `m.type === 'spacing'`
  - `ensureSiteOverview()` 或 `renderRoof()` 前置校验处（选择对全局影响最小的入口）
  - `applyQuoteSnapshot()` / `applyRoofHistoryState()` 恢复历史后也做过滤，避免 undo/redo 还原 spacing

### 5) 标尺 X/Y 原点从图片区域左上角开始（不再居中）

**用户决策**
- 图片贴左上对齐。

**修改点**
- 文件： [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html)
- 位置：
  - Roof 图片元素：`#roof-image`（当前 `object-contain` 默认居中）：[index.html:L912-L917](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L912-L917)
  - 坐标计算： [getImageRect](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L9996-L10010)

**实现方式**
- 将 `#roof-image` 的对齐从居中改为左上：
  - CSS：增加 `object-position: left top;`
- 同步修改 `getImageRect()`：
  - 保留 contain 缩放 `s = min(vw/iw, vh/ih)`，但返回 `x=0, y=0`（不再居中）。
- 影响面：`worldToPx/pxPointToWorld`、标尺 tick 定位、模块/标注渲染与交互都会随 `rect.x/y` 变化而统一对齐，确保“视觉上的 0,0”与交互坐标一致。

### 6) 生成 PDF 时 Site Overview 图片不拉伸变形

**问题推断（结合现象与实现）**
- 屏幕端依赖 `object-fit: contain`，但 html2canvas 在某些情况下对 object-fit 支持不稳定，可能导致按元素盒子直接拉伸绘制。

**修改点**
- 文件： [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html)
- 位置： [confirmAndGeneratePDF:onclone](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L8689-L8771)

**实现方式**
- 在正常页面中（图片 load 后）把 `roof-image` 的真实尺寸写入 `data-iw/data-ih`（naturalWidth/naturalHeight），确保 clone 中可读取。
- 在 onclone 中对 `#roof-image` 做“显式尺寸 + 显式定位”的打印专用修正：
  - 读取 `data-iw/data-ih` 与 clone 中 viewport 的 clientWidth/clientHeight。
  - 计算 contain 后的 `w/h`，并给 clone 的 img 设置 `style.width/height/left/top`，避免依赖 object-fit。
  - 同时保证与第 5 项一致采用左上对齐。

### 7) PDF 中自定义多边形（顶点编辑后）显示为矩形：修复 clip-path 打印

**根因**
- 自定义组件形状依赖 `clip-path: polygon(...)`（百分比点集）。html2canvas 对 clip-path 支持不完整时会回退为完整矩形。

**修改点**
- 文件： [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html)
- 位置：
  - shape 渲染来源： [renderModules](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L11443-L11493)
  - PDF onclone： [confirmAndGeneratePDF:onclone](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L8689-L8771)

**实现方式（仅影响导出，不改变编辑器实时渲染）**
- 在 onclone 中遍历 `.pv-module.is-custom .pv-module-shape`：
  - 若检测到 `style.clipPath` 为 `polygon(...)`：
    - 解析 polygon 百分比点，转换为 `0..100` 坐标系。
    - 将该 shapeDiv 替换为 inline SVG（`<svg viewBox="0 0 100 100" preserveAspectRatio="none">` + `<polygon ...>`），填充色使用原 background，描边使用原 border。
  - circle/无 clip-path 时按需替换为 `<circle>/<rect>`，保证打印一致。
- 这样 html2canvas 直接绘制 SVG，多边形不会退化为矩形。

## Assumptions & Decisions

- “间距模式”删除后：清理并不再显示 spacing 标注（用户已确认）。
- “测距微调面板”仅在 Marks 模式下可用（用户已确认）。
- 标尺原点：图片贴左上（用户已确认），并同步调整坐标计算，保证交互与渲染一致。
- PDF 修复聚焦在“导出阶段 onclone 处理”，避免对日常编辑体验产生副作用。

## Verification

- 静态校验
  - 运行 `python3 check_js.py index.html`，确保语法与常见结构检查通过。
- 浏览器回归（页面 5：SITE OVERVIEW）
  - Marks 模式：框选多个标注后，拖动任一已选标注，全部标注同步平移；Shift 点击可增删选择集。
  - Marks 模式：点击测距标注后出现上下微调按钮；单击一次精确 ±0.001；不能键入修改数值；不触发拖动抖动。
  - 工具栏：不再出现 Space/间距 模式；历史/加载后 spacing 标注不会再显示。
  - 标尺：0,0 位于图片区域左上（viewport 左上），并随缩放/容器尺寸变化稳定。
- PDF 回归
  - 生成 PDF：Site Overview 背景图不被拉伸（保持原始宽高比）。
  - 自定义多边形（顶点编辑后）在 PDF 中形状与屏幕一致（非矩形退化）。

