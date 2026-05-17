## Summary

本计划针对 SITE OVERVIEW（第 5 页）在不引入新依赖的前提下完成 4 类改造：

1. 合并文字控件：把“其他组件”才出现的内容/字色/底色与原“文字”卡片（字号/粗细/颜色）合并；删除原“字体颜色下拉”控件；并按你确认的规则实现“选中则改选中、无选中改默认”。
2. 边框/描边纳入数值口径：组件 Module(m) 数值、测距长度、面积值都按“可见外轮廓（包含描边/端点图形/面积描边）”口径显示与编辑。
3. 面积增强：加入透明度调节、可输入文字、CAD 常用底纹（斜线/交叉/网格）并保持每个面积独立配置。
4. UI 布局优化：左侧动作栏按钮增加 SVG 图示并整体缩小；把“模式/开关（锁定/标尺/磁吸）”下移到 ROOF IMAGE AREA 上方（作为画布内悬浮工具条），便于操作。

## Current State Analysis (Grounded)

### 文字控件现状

- “文字”卡片提供字号/粗细/颜色（颜色为下拉 `roof-label-color`）：
  - [index.html:L795-L815](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L795-L815)
- 自定义组件（type=custom）额外编辑区 `roof-custom-edit`（内容/字色/底色/无背景）仅在选中 custom 时显示：
  - [index.html:L816-L831](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L816-L831)
- 渲染时组件文字颜色来源为 `m.textColor || settings.labelColor`，字号/粗细来自 settings（当前已同时影响 PV 与 custom）：
  - [renderModules](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9807-L9848)

### 测距/面积口径现状

- 测距显示使用 `formatDistanceM()`，目前已经统一为 3 位小数米单位：
  - [formatDistanceM](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9494-L9497)
- dist 气泡可编辑，会固定 A 调整 B，但当前编辑值基于几何长度（未考虑端点图形/描边外轮廓的“口径修正”）：
  - [addMeasureLabel](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9791-L9842)
  - [updateDistMeasureLength](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9508-L9548)
- area 已升级为 polygon，支持顶点拖拽，但面积值当前为几何面积（未考虑 polygon stroke 外扩口径，也未包含透明度/底纹/文字）：
  - [renderRoofMeasurements area](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L10059-L10101)

### UI 布局现状

- 左侧动作栏（w-44）为纯文字按钮，无图标：
  - [index.html:L721-L742](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L721-L742)
- “模式/开关”一行目前位于属性卡片上方（不在画布附近）：
  - [index.html:L744-L771](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L744-L771)

## Decisions (from user)

- 文字颜色：有选中组件时直接修改选中组件（支持多选统一），无选中时修改全局默认。
- 边框口径：Module(m) + 测距/面积的显示与编辑数值都需要按“包含描边/边框”的可见外轮廓口径。
- 面积底纹预设：斜线 + 交叉斜线 + 网格，并保留纯色无底纹。
- 左侧动作栏：图标 + 文字，并整体缩小。

## Proposed Changes

修改文件：
- [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)

### 1) 合并文字控件并删除原“字体颜色下拉”

#### 1.1 UI 合并方案

- 删除 `roof-label-color` 下拉（原来的“白/黄/紫/黑/红/蓝”）。
- 在“文字”卡片内改为统一的控制组（同一块区域内呈现）：
  - 字号（保留 `roof-label-size`）
  - 粗细（保留 `roof-label-weight`）
  - 文字颜色：新增 `input[type=color]`（建议 id：`roof-text-color`）
  - 内容输入：新增 `roof-text-content`
  - 背景色：新增 `roof-text-bg-color` + `roof-text-bg-none`

交互规则：
- PV（type=pv）：
  - 内容输入禁用（或显示固定“PV”不可编辑）
  - 背景色控件禁用（PV 不需要底色）
  - 文字颜色可用（写入 pv 模块的 `textColor`）
- 其他组件（type=custom）：
  - 内容/字色/底色全部可用（写入 custom 的 `text/textColor/bgColor`）
- 未选中组件：
  - 字号/粗细继续作为全局设置（settings）
  - 文字颜色修改全局默认 `settings.labelColor`

#### 1.2 数据写入规则（选中则改选中）

新增统一入口函数（示例命名）：
- `applyTextControlsFromUI()`：
  - 若 `roofSelection.size > 0`：对所有选中 module 写入：
    - `m.textColor = pickedColor`
    - 若 module.type === 'custom'：额外写 `m.text/bgColor`
  - 若未选中：仅写入 `siteOverview.settings.labelColor = pickedColor`
  - 同时保留现有“同色限制”逻辑：若 bgColor 与 textColor 同色则自动纠正 textColor（沿用现有规则）。

并调整 `syncCustomEditUIFromSelection()`：
- 移除/废弃 `roof-custom-edit` 区块（或只作为兼容壳，但实际不再使用）。
- 统一由 `syncTextControlsFromSelection()` 回填上述控件（根据选中类型控制 enable/disable）。

### 2) “边框/描边计入数值口径”的实现

该需求本质是：数值显示/编辑要包含“可见外轮廓”，而当前几何数据（点/边/面积）是不含描边与端点图形的。

#### 2.1 通用换算

新增辅助函数（不改变存储的世界坐标）：
- `pxToM(px) => px / pxPerM`（pxPerM 由 `getPxPerM(getImageRect())` 获取）

#### 2.2 测距（dist）口径修正

定义 dist 的“外轮廓加成”：
- `lineStrokePx`：测距线 stroke width（当前 2 或选中 3）
- `endpointPadPx`：端点图形的可见半径/长度（按 markerStyle 取值：cross/dot/diamond/arrow_* 分别给常量）
- `extraLenM = 2 * pxToM(endpointPadPx)`（端点贡献）
- 可选再加上与线条 stroke 相关的微调（若你希望严格把 stroke 也算进长度，可再 + `pxToM(lineStrokePx)`）

调整点：
- 渲染显示长度：`displayLenM = geoLenM + extraLenM`
- 气泡编辑输入值也显示 `displayLenM`（三位小数）
- `updateDistMeasureLength(id, newLenM)`：把输入的 `newLenM` 视为 displayLenM，先反推 `geoTarget = max(0, newLenM - extraLenM)` 再按“固定 A 改 B”的规则设置 B。

验收：
- 同一条测距在不同 markerStyle 下显示值会按端点外轮廓口径变化；
- 直接输入 2.345 后可得到肉眼一致的外轮廓长度。

#### 2.3 面积（area）口径修正

面积 polygon 的外扩面积近似（Minkowski sum）：
- `t = pxToM(strokePx) / 2`（stroke 以两侧各扩 t）
- `A_out ≈ A + P * t + π * t²`
  - A：几何面积（shoelace）
  - P：几何周长（逐边距离求和）

调整点：
- 面积显示值用 `A_out`（仍保留 2 位小数 m² 或你若希望也 3 位，可统一到 3 位）
- 面积编辑（顶点拖动）仍改 points（几何），但显示按外扩口径实时更新。

#### 2.4 Module(m) 口径修正

对 Module(m) 显示/输入值进行“外轮廓修正”：
- 约定组件外轮廓边框厚度使用固定像素常量（例如 2px，对齐目前组件选中 outline 视觉），转换成 `borderM = pxToM(borderPx)`
- UI 显示：`displayW = geoW + 2*borderM`，`displayH = geoH + 2*borderM`
- UI 应用：把用户输入的 displayW/H 反推回几何 wM/hM：`geoW = max(0, displayW - 2*borderM)`

注意：该修正只影响“数值口径”，不会改变模块在画布上的像素宽高表现（避免 UI 抖动）。

### 3) 面积增强：透明度 / 文字 / CAD 底纹

#### 3.1 数据结构（每个面积独立）

对 `type:'area'` 增加字段：
- `bgColor`：底色（已存在）
- `opacity`：0~1（新增）
- `pattern`：`'none' | 'diag' | 'cross' | 'grid'`（新增）
- `label`：字符串（新增）

并在 settings 增加默认值用于新建面积：
- `areaDefaultOpacity`
- `areaDefaultPattern`
- `areaDefaultLabel`（可空）

#### 3.2 UI 控件

在“测距/网格”卡片中，扩展“面积”控件区：
- 背景色（已有 `roof-area-bg-color`）
- 顶点数（已有 `roof-area-vertex-count`）
- 透明度 slider + number（建议 id：`roof-area-opacity` + `roof-area-opacity-num`）
- 底纹选择（select：纯色/斜线/交叉/网格）
- 文字输入（用于 label）

行为：
- 若当前选中主标注为 area：控件编辑写入该 area（每个面积独立）
- 若未选中 area：控件修改写入 settings 默认，用于后续新建面积

#### 3.3 SVG 底纹实现

在 `renderRoofMeasurements()` 的 svg 内 `<defs>` 定义 3 种 pattern：
- diag：45° 斜线
- cross：交叉斜线
- grid：网格

并使用：
- polygon fill 使用 `url(#pattern-xxx)` 或纯色
- pattern 线条颜色建议由 `bgColor` 派生（或固定为紫/灰），并叠加 `opacity`

#### 3.4 面积文字渲染

在 area label 位置显示：
- 若 label 非空：`{label}  {areaValue}`（或换行显示）
- 若 label 为空：仅显示面积值

（保持 label 仍可在“选择标注”模式下被拖动整体移动时跟随 polygon）

### 4) UI 调整：左侧动作栏 SVG + 缩小 + 模式/开关下移到画布上方

#### 4.1 左侧动作栏按钮图标化

为左侧按钮加入 inline SVG（参考库存页面按钮已有 SVG 用法）：
- 上传、添加 PV、添加其他组件、复制、删除、旋转、撤销/重做、清除标注、删除标注、清除全部、转换比例模式

并统一按钮样式：
- `flex items-center gap-2`
- icon 16~18px
- 减少 padding（px-3 py-2）
- 左侧栏宽度从 `w-44` 缩到 `w-36`（或更小，确保文字不换行）

#### 4.2 模式/开关移动到 ROOF IMAGE AREA 上方

将当前位于属性卡片上方的那行（模式 select + 锁定/标尺/磁吸）改为画布内悬浮工具条：
- 在 `#roof-viewport` 内新增一个 `absolute` 容器（z-index 高于 measure layer，no-print）
- 放置在 ROOF IMAGE AREA 上方、靠左或居中（不遮挡主要内容）
- 保持现有 id 不变（如 `roof-tool-mode`, `roof-lock-scale`, `roof-show-rulers` 等），以最小化 JS 改动

## Assumptions & Notes

- “边框/描边纳入数值口径”采用“像素描边换算成米”的方式实现（px→m 依赖当前 pxPerM），保证在当前画布比例下与可见外轮廓一致。
- PV 组件不支持编辑 label 内容（仍显示 PV），但支持被统一设置文字颜色（通过选中写入 `m.textColor`）。
- 面积 label 的“可拖动位置”复用现有标注整体移动能力：移动 area 时 label 跟随 bbox 中心；暂不做 label 单独拖拽（若需要可后续扩展）。

## Verification

1. 文字控件合并：
   - 删除原字体颜色下拉后，新的颜色选择器可在“选中组件时修改该组件颜色”，无选中时修改默认色；
   - 选中 PV 与 custom 均可修改文字颜色；选中 custom 可编辑内容/底色；PV 内容不可编辑。
2. 边框口径：
   - 测距显示值与编辑值包含端点外轮廓修正；输入长度后视觉外轮廓与数值一致；
   - 面积显示值包含描边外扩修正；
   - Module(m) 输入/显示包含边框口径修正，并能通过 ✓ 应用、✕ 取消。
3. 面积增强：
   - 可对单个面积设置底色、透明度、底纹与文字；
   - 新建面积会继承默认顶点数/底色/透明度/底纹/文字设置。
4. UI：
   - 左侧按钮带 SVG 且整体更紧凑；
   - 模式/开关工具条出现在 ROOF IMAGE AREA 上方，交互不受影响（测距/面积/选择组件/选择标注等均正常）。

