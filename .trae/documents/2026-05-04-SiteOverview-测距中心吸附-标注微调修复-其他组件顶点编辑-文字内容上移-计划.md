## Summary

本计划对 SITE OVERVIEW（第 5 页 Roof 编辑器）做 4 项增强/修复：

1. **测距磁吸虚线对齐 Cross 中心**：磁吸对齐点以“十(Cross)”交叉中心为准，不再因为 offset 导致看起来在“十”的四端跳动。
2. **测距标注微调可用**：在“选择标注 / 测距”下，点击距离标注的数字输入（含上下微调箭头）能正常修改并实时生效；同时磁吸延长线效果可正常显示。
3. **其他组件顶点编辑**：取消顶点锁定后，支持像“面积测量”一样拖拽顶点编辑形状（除圆形外：Rect/Triangle/Diamond/Hex/Arrow），并使用独立工具模式进入顶点编辑。
4. **文字组件内容上移**：将“Content + 输入框”移动到与 Size 同一行，减少空间占用。

## Current State Analysis (Grounded)

### 1) Cross 磁吸对齐跳动

- 角点磁吸会使用 `distSnapOffsetM` 产生偏移（`off`），导致吸附点并非落在理论对齐线的交点；视觉上会在四个方向来回切换：
  - [snapMeasurePointToCornersEx](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L10171-L10233)
  - 各测距流程都传入 `siteOverview.settings.distSnapOffsetM` 作为 offset（草稿、拖拽、编辑长度写回）。

### 2) 距离标注输入框/上下微调不可用

- `addMeasureLabel` 在可编辑时会给 label 内插入 `<input type="number">`，但 pointerdown 事件在 `select_measures` 分支会直接拿 `data-mid` 启动拖拽并 `preventDefault()`，导致无法聚焦/无法使用输入框与步进按钮：
  - [addMeasureLabel](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L10447-L10512)
  - [viewport pointerdown select_measures](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L11236-L11280)
- 输入值变化目前仅在 Enter/Blur 时写回，点击原生上下微调箭头通常不会触发（或不会及时触发）期望的写回与延长线更新。

### 3) 其他组件“顶点锁定”目前仅做等比缩放

- 当前 `vertexLocked` 仅在 resize 时强制等比（比例锁），不支持“自由移动顶点”：
  - [resize 等比逻辑](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L11620-L11639)
- custom module 仍按 `xM/yM/wM/hM` 的矩形框 + clip-path 生成规则图形，缺少可编辑顶点数据结构。

### 4) 文字组件内容行目前在下半部分

- Text 卡片 Content 在下一行（border-t 分隔），需要移动到同一行：
  - [Text 卡片](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L784-L814)

## Decisions (from user)

- 顶点编辑支持范围：除圆形外都支持（Rect/Triangle/Diamond/Hex/Arrow）。
- 顶点编辑入口：使用独立工具模式进入（不在常规 Select 模式里展示顶点手柄）。

## Proposed Changes

修改文件：
- [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)

### 1) Cross 磁吸：对齐点以 Cross 中心为准（避免四端跳动）

核心策略：当 markerStyle 为 `cross` 时，角点/边线磁吸计算使用 `effectiveOffsetM = 0`，保持吸附点落在几何对齐线的交点（Cross 中心），而不是被 offset 推到某一侧。

落点：
- 草稿态测距（pointermove dist draft）：使用 `roofMeasureDraft.markerStyle` 判断，传入 `effectiveOffsetM` 给 `snapMeasurePointToCornersEx/snapMeasurePointToModulesEx`。
- 拖拽测距标注（role all/a/b）：使用标注自身 `m.markerStyle` 判断，同样使用 `effectiveOffsetM`。
- 编辑长度写回（updateDistMeasureLength）：使用标注自身 `m.markerStyle` 判断，同样使用 `effectiveOffsetM`。

验收：
- Cross 端点下进行角点延长线磁吸时，虚线对齐点稳定在 Cross 交叉中心，不再在四个方向来回跳动。

### 2) 距离标注“上下微调/数字输入”可用 + 延长线可更新

#### 2.1 允许在 label 输入框上交互（不启动拖拽）

在 `viewport pointerdown` 的 `select_measures` 与 `measure_dist` 分支里：
- 若 `target` 为 `input/select/button/textarea` 或其祖先是这些控件，则直接 `return`，不进入 `roofMeasureDrag` 逻辑，也不 `preventDefault()`。
- 为稳妥起见，在 `addMeasureLabel` 创建 input 时额外：
  - 给 input 加 `pointerdown` 监听：`stopPropagation()`（仅阻止事件上冒，不改变其它逻辑）。

#### 2.2 步进按钮/输入变化实时写回

在 `addMeasureLabel` 创建 input 时增加：
- `input` 事件：节流（requestAnimationFrame 或简单 debounce），调用 `updateDistMeasureLength(mid, value)`
- `change` 事件：兜底调用一次 `updateDistMeasureLength`

验收：
- 点击输入框能聚焦，原生上下微调箭头生效；
- 数字变化后标注长度实时更新，并能触发磁吸延长线提示（由 `updateDistMeasureLength` 内部逻辑负责）。

### 3) 其他组件顶点编辑（独立模式）

#### 3.1 新增工具模式：Edit Vertices

- 在 `roof-tool-mode` 增加一个 option（例如 `edit_vertices`）。
- `i18n.siteOverview` 增加该模式的中英文显示名，并在 `updateLanguageLabels` 里同步更新 option 文案。
- 行为约束：
  - 仅在该模式中显示/允许拖拽 custom 顶点手柄；
  - 其它模式保持现有交互（移动/缩放/选择/测距等）。

#### 3.2 custom module 数据结构：引入 points

为 custom module 增加可选字段：
- `points?: Array<{xM:number,yM:number}>`（世界坐标）

规则：
- `vertexLocked === true`：不使用 points（或清空 points），按规则形状渲染（现有 clip-path 逻辑保留）。
- `vertexLocked === false`：若 points 不存在，则从当前 `shape + xM/yM/wM/hM` 初始化 points：
  - rect：4 点（矩形四角）
  - triangle：3 点
  - diamond：4 点（上下左右）
  - hex：6 点（规则六边形）
  - arrow：7 点（与现有 clip-path 对应的拐点）
  - circle：不支持顶点编辑（保持锁定效果；或进入 edit_vertices 时禁用该组件顶点手柄）

#### 3.3 渲染：points -> clip-path polygon

当 custom module 存在 `points` 且 `vertexLocked === false`：
- 计算 points 的 bbox（minX/minY/maxX/maxY），用 bbox 作为模块外框：
  - `m.xM = minX`, `m.yM = minY`
  - `m.wM = maxX - minX`, `m.hM = maxY - minY`
- 渲染时生成 `clip-path: polygon(...)`：
  - 将每个点归一到 bbox 内百分比坐标：`px = ((x - minX)/w)*100%`, `py = ((y - minY)/h)*100%`
- 继续复用现有 `pv-module-shape` 作为填充层（bgColor/opacity 等不变）。

并同步调整尺寸相关函数以兼容 points：
- `getModuleDimsM(m)`：若 `m.type==='custom' && m.points?.length>=3 && !m.vertexLocked`，返回 bbox 尺寸（忽略 rotDeg，因为 custom 当前不旋转外框）。
- `clampModuleToRoof(m)`：当 points 模式下，改为 clamp 每个点到 roof 范围，并重新计算 bbox。

#### 3.4 交互：顶点拖拽（类似 area 的 v0/v1...）

新增状态：
- `roofCustomVertexDrag = { id, idx, startPx, initialPoints }`

在 `viewport pointerdown` 中，当 `roofToolMode === 'edit_vertices'`：
- 单击 custom module：设置 `roofSelection = new Set([id])` 并刷新 UI
- 若点击命中顶点手柄（例如 `.custom-vertex-handle`，带 data-id/data-vidx）：
  - 若该 custom `vertexLocked === false` 且 `shape !== 'circle'`：开始拖拽 `roofCustomVertexDrag`

在 `pointermove`：
- 若 `roofCustomVertexDrag` 存在：
  - 将指针位置转换为 world 坐标，更新对应 points[idx]（clamp 到 roof）
  - 重新计算 bbox 并 `renderModules()`

在 `pointerup/cancel`：
- 结束拖拽，push history，清空 drag 状态

顶点手柄显示规则：
- 仅当 `roofToolMode === 'edit_vertices'` 且单选 custom 且 `vertexLocked === false` 且非 circle 时显示。

验收：
- 进入 Edit Vertices 模式，取消顶点锁定后可拖拽顶点改变形状；
- 再次开启顶点锁定，恢复规则形状（points 被清空或不再参与渲染）。

### 4) Text 卡片：Content 上移到同一行

调整 Text 卡片 DOM：
- 将 `Content` label + input 从下半部分移入上半部分 flex 行；
- 为 content input 设置 `flex-1 min-w[...]`，保证在同一行时尽量占用剩余空间；在极窄情况下允许自动换行，但默认桌面端与 Size 同行。
- 删除原下半部分的 border-t 容器（或仅保留空容器并移除 padding）。

## Verification

1. Cross 磁吸中心稳定：
   - marker=Cross，snapMagnet 开启，角点远距离吸附时不再出现“四端跳动”。
2. 标注输入可用：
   - select_measures 下点击数字输入框可聚焦；
   - 点击上下微调箭头能改变数值并实时更新标注长度；
   - 能触发延长线/磁吸提示更新。
3. 顶点编辑：
   - 切换到 Edit Vertices 模式；
   - custom（非 circle）取消锁定后出现顶点手柄且可拖拽；
   - 开启锁定后恢复规则形状。
4. Text 内容同行：
   - Content 与 Size 同行显示，整体高度降低，不影响其它控件交互。
5. 基础校验：
   - `python3 check_js.py index.html` 通过；
   - 浏览器控制台无新增运行时错误（忽略既有 state.json 轮询的网络报错）。

