## Summary

本计划针对 Site Overview（第 5 页 Roof 编辑器）完成 5 项修复/增强：

1. 测距数字上下微调：点击一次即 ±0.001，且不闪烁（当前仍闪烁）。
2. 修复“添加其他组件”无法添加的问题；同时删除“文字控件”的无背景选项，并把 Content 输入框保持在 Content 右侧同一行（更紧凑）。
3. 自定义组件的文字内容在编辑顶点/变形时，保持在**组件几何中心（多边形质心）**，而不是 bbox 中心。
4. 动作栏在“置顶”旁新增“上移”按钮（上移一层），与置顶同层排列。
5. 组件透明度最大值调整为 100%（当前上限为 90%）。

## Current State Analysis (Grounded)

### 1) 测距步进与闪烁

- 可编辑测距 input 由 [addMeasureLabel](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L10688-L10756) 动态创建；当前配置为：
  - `input.step = '0.01'`（不符合你最新要求的 0.001）
  - `triggerLive -> updateDistMeasureLengthInternal(..., commit=false)`
- `commit=false` 目前走 `updateDistMeasureDom(id)`，理论上避免重建 DOM，但用户仍感知“闪烁”，高概率与**编辑中持续移动 label 容器（包含 input）**或频繁重绘 snap-lines 引发的抖动有关：
  - [updateDistMeasureLengthInternal](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L10155)
  - [updateDistMeasureDom](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L10211)

### 2) “添加其他组件”无法添加（实际代码错误）

- [confirmAddRoofCustomModule](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L12369-L12431) 内仍引用了已删除的变量 `bgNone`：
  - `if (!bgNone && bgColor ... ) { ... }`
- 这会触发 `ReferenceError: bgNone is not defined`，导致点击 Add 按钮直接失败，所以“其他组件无法添加”。

### 3) 自定义组件文字中心

- 目前自定义组件文字使用 `.pv-module-label { inset:0; display:flex; justify-content:center; align-items:center; }`，本质是**bbox 居中**：
  - [CSS pv-module-label](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L8914-L8926)
- 当顶点编辑使形状不规则时，bbox 中心不等于多边形几何中心（质心），因此视觉上可能偏离你期望的“像面积数字一样居中”。

### 4) 动作栏：当前只有“置顶”

- 已存在置顶按钮与逻辑：
  - [btn-roof-to-top](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L737)
  - [bringSelectedToTop](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L12516)
- 需要新增一个“上移一层”（相对提升 1 个层级，而不是直接置顶）。

### 5) 透明度上限 90%

- UI 输入上限为 `max="90"`：
  - [module-opacity / module-opacity-num](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L774-L775)
- 逻辑与渲染也 clamp 到 0.9：
  - [opacityPct clamp 90](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9790)
  - [moduleOpacity clamp 0.9](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L11337)

## Assumptions & Decisions

- “上移一层”定义：在同一数组（modules 或 measurements）内，将选中项整体与其后一个未选中项做一次稳定交换（组整体上移 1 层）；若已在顶层则不变。
- 测距输入显示精度：与步进一致，统一为 3 位小数（0.001）。
- 自定义组件“几何中心”按多边形质心计算（shoelace/centroid 公式），当 points 不存在或点数不足时退回 bbox 中心。

## Proposed Changes

修改文件：
- [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)

### A) 测距步进改为 0.001 且消除闪烁

1. 调整 editable input 的 step 与显示：
   - `input.step = '0.001'`
   - `input.value = ...toFixed(3)`
2. `updateDistMeasureLengthInternal` 内 rounding 维持/恢复 0.001 精度（避免步进后被 round 到 0.01）。
3. 消除闪烁的关键策略（避免编辑中“移动/重绘 input 容器”）：
   - 在 `updateDistMeasureDom(id)` 中：
     - 若当前处于编辑态（`document.activeElement` 是该 label 的 input），则**不更新 label 的 left/top**，仅更新 SVG 主线/端点/辅助线（必要时也可跳过 snapLines 重建，改为仅更新已有 line 的坐标）。
   - 保留 Enter/Blur 的 commit=true 路径：一次性 push history 并完整 render，确保最终位置正确。

### B) 修复“其他组件无法添加”

- 在 `confirmAddRoofCustomModule` 删除对 `bgNone` 的引用：
  - 直接用 `bgColor` 与 `textColor` 做“同色保护”判断。
- 同时增加输入校验兜底：
  - 若 `bgColor` 为空（极端情况下），给默认值 `#FFC107`（避免写入空字符串导致对比逻辑异常）。

### C) 文字控件：删除“无背景”选项 + Content 输入保持同行

1. UI：
   - 删除 `roof-text-bg-none` checkbox 与 `so-text-no-bg` 文案节点。
2. 逻辑：
   - `applyTextControlsFromUI` / `syncTextControlsFromSelection`（以及任何引用 `roof-text-bg-none` 的路径）移除 bgNone 分支。
   - “无背景”的能力改为：背景色选择器 `roof-text-bg-color` 支持透明策略（若当前实现不支持透明色值，则保留为实色背景；本次按你的要求删除选项，不额外引入透明色输入）。
3. Content 输入框布局：
   - 保持 Content label 与输入框同行（当前已在同一行），仅在删除 bgNone 后重新分配 flex 空间，确保内容输入在 Content 右侧且更紧凑。

### D) 自定义组件文字随顶点编辑保持几何中心

1. 新增 `polygonCentroid(points)`：
   - 对 points（world 坐标）计算多边形质心（shoelace）。
   - 若面积接近 0 或点数 < 3，回退 bbox 中心。
2. 在 `renderModules` 中 custom points 模式：
   - 计算 centroidWorld（xM,yM）并转换为 bbox 内百分比定位：
     - `left = ((cx - bb.minX)/bb.wM)*100%`
     - `top = ((cy - bb.minY)/bb.hM)*100%`
   - label 改为 `position:absolute; left/top; transform: translate(-50%,-50%)`，从而稳定贴合形状中心。
3. 对 vertexLocked=true（规则形状）仍可保持原 bbox 居中（或同样用规则多边形 points 计算 centroid；二者效果一致）。

### E) 新增“上移一层”按钮（与置顶并排）

1. UI：
   - 在 `btn-roof-to-top` 旁新增 `btn-roof-move-up`，同一层级布局。
2. 逻辑：
   - `moveSelectedUpOneLayer()`：
     - 若 `roofToolMode === 'select_measures'` 且选中了标注：在 `siteOverview.measurements` 内将选中集合整体上移一位；
     - 否则若选中了组件：在 `siteOverview.modules` 内将选中集合整体上移一位；
     - push history + renderRoof。
3. i18n：
   - 增加 `moveUp`（中文“上移”、英文“Up”）。

### F) 组件透明度上限调为 100%

1. UI：
   - `module-opacity` 与 `module-opacity-num` 的 `max` 从 90 改为 100。
2. 数据与渲染：
   - 所有 `clamp(..., 5, 90)` 改为 `clamp(..., 5, 100)`；
   - `moduleOpacity` 的上限从 0.9 改为 1.0（对应 100%）。

## Verification

1. 测距步进与无闪烁：
   - 选中 dist 标注，点击上下微调一次即变化 0.001；
   - 输入框不闪烁、不丢焦、不需要多次点击。
2. 其他组件可添加：
   - 点击 Add Comp，填写文字，点击 Add 成功创建组件（无控制台 ReferenceError）。
3. 文字控件 UI：
   - No BG 选项消失；Content 输入仍在 Content 右侧同一行；功能不回归。
4. 文字随顶点编辑居中：
   - 在 Edit Vertices 模式拖拽顶点，文字始终保持在形状几何中心附近（不再随 bbox 偏移）。
5. 上移一层：
   - 多个组件重叠时，点击“上移”只上移一层；点击“置顶”移到最上方；
   - 标注在 Marks 模式同样生效。
6. 透明度 100%：
   - slider 与 number 可设置到 100；渲染 alpha 达到 1.0。
7. 基础校验：
   - `python3 check_js.py index.html` 通过；
   - 控制台无新增运行时错误（忽略既有 state.json 网络报错）。

