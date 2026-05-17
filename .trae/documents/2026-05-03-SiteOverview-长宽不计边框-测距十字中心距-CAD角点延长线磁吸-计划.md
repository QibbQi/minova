## Summary

在 SITE OVERVIEW（第 5 页 Roof 编辑器）实现 4 项交互/口径修正：

1. **控件长宽口径**：长宽计算与显示/写回 **都不计入任何边框**（包括模块边框、选中 outline、custom 形状描边等），完全按几何尺寸（m.wM / m.hM）处理。
2. **非选中视觉**：在未选中任何控件时，控件周围不显示浅色“被选择边框”（取消默认 outline）。
3. **测距端点十字**：端点为 **十(Cross)** 时，距离按 **中心到中心** 计算（不做额外加成）。
4. **测距 CAD 磁吸**：测距过程中，光标在距离控件角点较远时也能出现虚线参考线并吸附，效果类似 CAD（按“模块角点延长线”）。

## Current State Analysis (Grounded)

- Module 长宽输入目前通过 `getModuleOuterPadM()` 做了额外加减（将边框/outline 口径计入尺寸）：
  - [syncModuleUIFromSelection](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9490-L9510)
  - [applyModuleDimsEdits](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9528-L9568)
  - `getModuleOuterPadM()`：[index.html:L10313-L10315](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L10313-L10315)
- 模块渲染默认会给所有控件加浅色 outline（即使未选中）：
  - [renderModules outline](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L11013-L11020)
- 测距显示当前使用 `formatDistanceM(d + getDistExtraLenM(style))`；Cross 也会加额外长度：
  - [renderRoofMeasurements dist label](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L10636-L10641)
  - [getDistExtraLenM](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L10304-L10306)
- 测距磁吸目前主要基于“靠近模块边线段”的容差判断（`p.x`/`p.y` 需落在边段范围内），离角点很远时不会出现 CAD 那种“延长虚线”提示：
  - [snapMeasurePointToModulesEx](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L10168-L10240)
  - 测距移动时的虚线仅在发生边线 snap 时生成 `roofMeasureSnapLines`：
    - [updateDistMeasureLength](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L10112-L10153)
    - [pointermove dist draft](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L11432-L11438)

## Decisions (from user)

- “不计算框选的边框”= **边框都不算**（完全按几何尺寸）。
- Cross 端点测距 = **中心到中心**。
- CAD 磁吸 = **模块角点延长线**（远距离也能吸附 + 虚线提示）。

## Proposed Changes

修改文件：
- [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)

### 1) 长宽口径：完全按几何尺寸（不计任何边框）

#### 1.1 渲染层：让 CSS 边框不改变几何尺寸

为 `.pv-module` 增加 `box-sizing: border-box;`，确保：
- JS 设置的 `div.style.width/height` 即最终可见外框尺寸
- `border` 不再额外撑大外框

同时确认 custom 形状层（`.pv-module-shape`）的描边不影响 `pv-module` 外框。

#### 1.2 Module 控件显示/写回去掉 pad 逻辑

- `syncModuleUIFromSelection()`：
  - 删除 `pad = getModuleOuterPadM()` 相关加成
  - 直接显示 `dims.wM / dims.hM`（按 0.001 精度）
- `applyModuleDimsEdits()`：
  - 删除 `w0 = w - 2*pad` / `h0 = h - 2*pad`
  - 直接把输入值写到 `siteOverview.module.widthM/heightM` 与选中模块的 `m.wM/m.hM`（仍保留旋转 90° 的互换逻辑）
- 保留 `getModuleOuterPadM()` 但改为返回 0（或不再使用），避免其他测算误用。

**成功标准**：不论控件是否选中、是否有边框/描边，Module (m) 的数字仅代表几何尺寸，不随边框变化。

### 2) 非选中态不显示浅色“被选择边框”

在 `renderModules()`：
- 删除默认 `div.style.outline = '2px solid rgba(15,23,42,0.15)'` 与 `outlineOffset`
- 仅在以下情况设置 outline：
  - `roofSelection.has(m.id)`：高亮实线
  - `roofSnapHighlightIds.has(m.id)`：高亮虚线

**成功标准**：未选中任何控件时，所有控件只呈现自身边框/形状描边，不出现额外浅色 outline。

### 3) Cross 端点：测距按中心到中心（extra=0）

调整 `getDistEndpointPadPx(style)` 或 `getDistExtraLenM(style)`：
- 当 style 为 `cross` 时返回 0
- 其他端点样式保持现有逻辑不变

并同步更新：
- 显示值（label）
- 编辑长度（`updateDistMeasureLength` 中的 `extra`）
- “测距/面积”卡片中对 marker 切换后的实时显示一致

**成功标准**：端点选 Cross 时，显示距离等于两端中心点间几何距离。

### 4) 测距 CAD 磁吸：角点延长线 + 远距离虚线提示

目标：在 `measure_dist` 过程中（含拖拽/草稿态）实现：
- 光标只要在 **角点的 x 或 y** 方向接近（|dx|<=tol 或 |dy|<=tol），即吸附到该 x/y
- 同时渲染“延长虚线参考线”（从角点到吸附点的投影线）

#### 4.1 新增/改造 snap 函数（建议新增，不破坏旧逻辑）

新增 `snapMeasurePointToCornersEx(p, offsetM)`：
- 遍历所有模块，计算 4 个角点：
  - (left,top), (right,top), (left,bottom), (right,bottom)
- 对每个角点计算：
  - `dx = p.xM - corner.xM`
  - `dy = p.yM - corner.yM`
- 若 `|dx|<=tol`：候选吸附 x
- 若 `|dy|<=tol`：候选吸附 y
- 当 x/y 同时命中（在同一个角点），则优先吸附到角点（或吸附到 x,y 两个维度同时锁定）
- 返回：
  - `p`：吸附后的点
  - `snapLines`：用于 `roofMeasureSnapLines` 的虚线段（至少 1 条，命中 x/y 两维可输出 2 条）
  - `highlightModuleId`：用于 `roofSnapHighlightIds`

#### 4.2 接入测距流程

在以下路径接入角点延长线吸附：
- 草稿态 pointermove：
  - [pointermove dist draft](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L11432-L11438)
- 拖拽已存在的 dist 标注（role all/a/b）：
  - [pointermove dist drag](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L11335-L11393)
- `updateDistMeasureLength()` 写回后也使用同样的 corner snap（保证编辑输入后也能落到吸附点）

吸附优先级（建议）：
1. 若 snapMagnet 开启：先尝试 **角点延长线吸附**（本需求核心）
2. 若未命中：回退到现有 `snapMeasurePointToModulesEx`（边线段吸附）
3. 若都未命中：不吸附

#### 4.3 虚线参考线渲染

复用 `roofMeasureSnapLines` 与 `renderRoofMeasurements()` 中的 line 渲染：
- 角点延长线命中 x：画一条从 corner 到 `(corner.x, p.y)` 的线
- 命中 y：画一条从 corner 到 `(p.x, corner.y)` 的线
- 颜色沿用 distColor 的 rgba（与现有一致）

**成功标准**：在角点很远位置，只要 x 或 y 对齐接近角点坐标，就会出现虚线并吸附。

## Verification

1. **长宽不计边框**
   - 选中与未选中时，Module (m) 显示值不变化；
   - 修改 Module (m) 写回后，实际渲染尺寸与输入一致（边框不导致偏差）。
2. **未选中无浅色 outline**
   - 清空选择后，所有控件不再出现浅色 outline。
3. **Cross 测距中心距**
   - 端点为 Cross 时显示值等于两点几何距离；切换 marker 不会出现额外加成。
4. **CAD 角点延长线磁吸**
   - 测距时光标远离模块但接近角点 x/y 时出现虚线并吸附；
   - 释放鼠标后距离标注端点落在吸附后的点位；
   - 关闭 snapMagnet 时不进行该吸附（仅按基础约束/自由移动）。

