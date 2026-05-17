## Summary

本计划针对 Site Overview（第 5 页 Roof 编辑器）实现 5 项改动：

1. **Cross（十字）磁吸稳定对齐中心**：测距磁吸与虚线辅助线对齐“十”的交叉中心，并通过“吸附锁定/滞回”避免在四端跳动。
2. **“其他组件”新增“多边形”**：可输入顶点数；移除“无背景”选项；相关参数写入组件数据，支持渲染与后续顶点编辑。
3. **动作栏新增“上移一层/移到最上方”**：对选中组件或标注生效，调整它们在各自图层内的绘制顺序。
4. **测距标注步进一次生效 0.01 且不闪烁**：点击一次上下微调即 ±0.01，不需要多次点击；修复因为重渲染导致的闪烁/丢焦问题。
5. **其他组件选中外框贴合图形**：圆形/三角形/多边形等选中高亮应贴合图形轮廓（不再是矩形）；编辑顶点时高亮随形状同步变化。

## Current State Analysis (Grounded)

### A) Cross 磁吸仍会“在四端跳动”

- 当前角点吸附使用 `snapMeasurePointToCornersEx(p, offsetM)`，当命中时会返回 `axis: x/y/xy`，并由 `addOrthoSnapLines` 画 L 形辅助线：
  - [snapMeasurePointToCornersEx](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L10188-L10233)
  - [addOrthoSnapLines](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L10169-L10186)
- 虽然 Cross 已在多个路径将 `offsetM` 设为 0，但当前吸附选择是“每次取最近的 x/y/xy 候选”，当指针接近阈值边界时 `axis`、corner 选择会频繁切换，导致视觉上“对齐点在四个方向跳”。

### B) “其他组件”弹窗现状

- Shape 列表目前为 rect/circle/triangle/diamond/hex/arrow：
  - [roof-custom-shape](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9010-L9018)
- 存在 “No BG” 复选框与 bgColor 控制：
  - [roof-custom-bg-none](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9026-L9035)
- confirmAddRoofCustomModule 读取 bg-none 并写入 module：
  - [confirmAddRoofCustomModule](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L12184-L12241)

### C) 图层顺序与渲染顺序

- modules 与 measurements 在不同 DOM layer，z-index 固定（modules 40、measure 60）：
  - [roof layers](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L915-L918)
- 同一层内部绘制顺序由数组顺序决定（modules 遍历、measurements 遍历渲染）。

### D) 测距输入步进需要多次点击且闪烁

- 标注输入框由 `addMeasureLabel` 每次 `renderRoofMeasurements()` 重新创建；当前 input `step=0.001`：
  - [addMeasureLabel input.step](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L10556-L10603)
- `triggerLive` 会调用 `updateDistMeasureLengthInternal(..., commit=false)`，而其 commit=false 会触发 `renderRoofMeasurements()`（重建 DOM），导致：
  - 点击微调箭头时 input 立即被销毁/重建 → 视觉闪烁
  - 连续点击/按住行为被打断 → 需要多次点击才累积到期望变化

### E) 其他组件选中外框仍是矩形

- 选中高亮目前对 `.pv-module` 容器使用 `outline`，容器是矩形框：
  - [renderModules outline](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L11183-L11190)
- custom 图形本身在 `.pv-module-shape` 上用 `clip-path/border-radius`；但 outline 不会贴合 clip-path。

## Assumptions & Decisions

- **多边形顶点数范围**：3–12（与面积顶点范围一致），默认 6。
- **“上移一层/置顶”按钮作用域**：
  - 若当前工具为 `select_measures` 且有标注选中 → 置顶标注；
  - 否则若有组件选中 → 置顶组件；
  - 两者都空则 no-op。
- **贴合外框表现**：采用“图形轮廓高亮”（drop-shadow/滤镜描边）而不是矩形 outline；视觉效果为实线高亮（不强制虚线样式）。

## Proposed Changes

修改文件：
- [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)

### 1) Cross 中心磁吸稳定：引入“吸附锁定/滞回”

目标：Cross 端点时，吸附点稳定落在几何对齐线（corner x / y）交点，且当指针在阈值附近移动时不会在不同 corner/axis 间抖动。

实施：

1. 新增状态 `roofMeasureSnapLock`（与 modules 的 `roofSnapLock` 区分）：
   - `{ type:'corner', moduleId, corner:{xM,yM}, axis:'x'|'y'|'xy' }` 或 null
2. 在 `snapMeasurePointToCornersEx` 中引入 hysteresis：
   - 若已有 lock：
     - 计算当前指针与 lock.corner 的 dx/dy；
     - 当 `abs(dx) <= tol * 1.5` 或 `abs(dy) <= tol * 1.5` 时优先保持 lock.axis 与 lock.corner（不重新选新候选）；
     - 超出两轴都 > tol*1.5 时释放 lock，重新搜索最佳候选。
   - 若无 lock 且命中候选：设置 lock（corner + axis），返回 lock 结果。
3. Cross 特殊规则维持：
   - markerStyle 为 cross 时 `offsetM = 0`（现有逻辑保留），并保证 lock 时不做任何 sign 偏移。
4. 在以下路径调用时维护/清理 lock：
   - measure_dist 草稿 pointermove / pointerdown 开始测距：初始化 lock=null
   - measure_dist/ select_measures 拖拽标注时：拖拽开始 lock=null，拖拽结束释放 lock

验收：
- Cross 端点下，角点延长线磁吸时“十字中心”稳定对齐，不再在四端跳动。

### 2) “其他组件”新增“多边形” + 顶点数输入 + 删除无背景

#### 2.1 Modal UI 变更

在 `#roof-custom-module-modal`：
- 在 shape 下拉中新增：
  - `<option value="polygon">Polygon</option>`
- 新增“顶点数”输入（仅当 shape=polygon 时显示/启用）：
  - `id="roof-custom-poly-n" type="number" min="3" max="12" step="1" value="6"`
- 删除 “No BG” 复选框（`roof-custom-bg-none`）及相关文案/布局
- 背景色始终从 `roof-custom-bg` 取值（允许用户选透明不现实，因此背景色必选；若需要透明由 moduleOpacity 解决，不再提供“无背景”）

#### 2.2 数据写入与渲染

- `confirmAddRoofCustomModule`：
  - 去掉 bgNone 逻辑，始终写 `bgColor`
  - polygon 时读取 `polyN` 写入 module（字段名建议：`polyN`）
  - 若 vertexLocked=false 且 shape=polygon：初始化 `points` 为规则多边形 points（使用 `getRegularPolygonPointsFromRect` 或新函数从 rect 生成 n 边形）
- `renderModules` custom shape 渲染：
  - vertexLocked=true 且 shape=polygon：设置 `clip-path: polygon(...)`（规则 n 边形）
  - vertexLocked=false 且 points 存在：继续复用 points → clip-path polygon（已有路径）

#### 2.3 i18n

在 `i18n.siteOverview` 增加：
- `shapePolygon`、`polygonVerts`（顶点数 label）
- 同步 `updateLanguageLabels` 的 `setOpt('roof-custom-shape', 'polygon', ...)`
- 删除或不再使用 `customNoBg`/`so-custom-modal-bg-none` 文案（为兼容可保留 key 但 UI 不再引用）

验收：
- 弹窗可选 Polygon 并输入顶点数；
- 不再显示“无背景”；
- 新增组件后能正确渲染 polygon，顶点编辑模式下可拖拽顶点改变形状。

### 3) 动作栏新增“置顶（上移一层/移到最上方）”

实现：

1. UI：
   - 在 Site Overview 左侧动作按钮组增加一个按钮（靠近 Copy/Delete）：
     - 文案：中文“置顶”、英文“To Top”
     - id：`btn-roof-to-top`
     - onclick：`bringSelectedToTop()`
2. 逻辑：
   - 若 `roofToolMode==='select_measures'` 且 `roofMeasureSelection.size>0`：
     - 对 `siteOverview.measurements` 做稳定重排：未选中的保持原相对顺序；选中的按原相对顺序移动到数组末尾（=绘制最上方）
   - 否则若 `roofSelection.size>0`：
     - 对 `siteOverview.modules` 同样稳定重排
   - push history + renderRoof
3. i18n：
   - `siteOverview.toTop` 文案键，并在 `updateLanguageLabels` 更新按钮文字。

验收：
- 选中组件点击置顶后，该组件覆盖同层其它组件；
- 选中标注点击置顶后，该标注覆盖同层其它标注；
- 不改变 modules-layer 与 measure-layer 的 z-index 关系（标注仍在组件之上）。

### 4) 测距输入步进：单击一次 ±0.01 且不闪烁

实现：

1. input step 改为 `0.01`，显示精度改为 2 位（或保持 3 位但步进 0.01；本计划选择 **2 位显示** 以匹配 0.01 目标）：
   - `addMeasureLabel` 中 `input.step='0.01'`
   - `input.value` 用 `toFixed(2)`
   - `updateDistMeasureLengthInternal` 对 `len` 的 round 改为 0.01 精度（或保持 0.001 但显示 0.01；本计划选择将 `len` round 到 0.01）
2. 去除导致闪烁的“live 更新重建 DOM”：
   - `updateDistMeasureLengthInternal(commit=false)` 不再调用 `renderRoofMeasurements()`（会重建 label/input）
   - 改为：
     - 更新 measurement 数据（m.b + snapLines）
     - **仅更新已有 SVG 元素与 label 位置**（按 `data-mid` 查询）：
       - 更新 dist 主线的 x1/y1/x2/y2
       - 更新 label 的 left/top
       - 更新 snapLines svg（可允许重建 snapLines，因为它不含 input）
   - commit=true 时才 `pushRoofHistory()+renderRoof()`
3. 输入事件触发策略：
   - `input`/`change` 直接调用 `updateDistMeasureLengthInternal(..., false)`，不再 raf 节流（避免延迟/闪烁）

验收：
- 点击一次上下微调箭头，数值立即变化 0.01 且图形立即更新；
- 输入框不闪烁、不丢焦、不需要多次点击。

### 5) 选中外框贴合图形（含顶点编辑中随形状变化）

目标：circle/triangle/polygon 等选中高亮沿图形轮廓描边，而不是矩形 outline。

实现：

1. 渲染时区分 custom 与 pv：
   - PV（矩形）仍可使用 `.pv-module` outline
   - custom：取消容器 outline，改为在 `.pv-module-shape` 上做“轮廓高亮”
2. 轮廓高亮实现方式：
   - 对 `.pv-module-shape` 设置 `filter: drop-shadow(0 0 0 2px <color>)`（drop-shadow 会沿 clip-path/圆角 alpha mask 贴合轮廓）
   - 选中时颜色 `rgba(88,44,131,0.95)`；吸附高亮可使用更浅颜色（不强制虚线）
3. 顶点编辑同步：
   - points 模式下 shapeDiv clip-path 每次变更；drop-shadow 自动随 clip-path 变化，无需额外处理

验收：
- 添加并选中 circle/triangle/polygon 等组件时，高亮贴合形状；
- Edit Vertices 拖拽顶点时，高亮随形状实时变化。

## Verification

1. Cross 中心磁吸：
   - marker=Cross，靠近角点/对齐线时吸附稳定，不抖动。
2. Polygon 组件：
   - 弹窗可选 Polygon，输入顶点数，新增后正确渲染；
   - Edit Vertices 下可拖拽顶点变形（非 circle）。
3. 置顶：
   - 多组件/多标注重叠时，置顶后选中对象覆盖同层其它对象。
4. 步进 0.01 与无闪烁：
   - 点击一次上下微调即 ±0.01；输入框不闪烁、不丢焦。
5. 贴合外框：
   - circle/triangle/polygon 选中高亮贴合轮廓，顶点编辑时高亮随形状变化。
6. 基础校验：
   - `python3 check_js.py index.html` 通过；
   - 控制台无新增运行时错误（忽略既有 state.json 网络报错）。

