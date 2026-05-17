## Summary

本计划在现有 Site Overview 工程示意编辑器基础上继续增强（不改变其它页面/报价逻辑），实现：
1. 网格间距下拉增加：5m、10m、20m、50m、100m、200m、500m、1000m。
2. 在 Module 规格旁新增数量输入（Qty），点击“添加光伏板”后按数量批量添加；批量添加时自动排列；并默认开启磁力吸附以便工程化对齐。
3. 磁力吸附增强为更接近工程 CAD：吸附到组件边缘/中心线；显示对齐距离标注；支持方向键微调 1cm/5cm。
4. 修复“复制”按钮不可用/效果不明显的问题（复制/粘贴结果应出现在原选区附近，且支持快捷键）。
5. 缩窄参考轴/标尺占用空间，并增加类似尺子的“小刻度”（按网格间距细分 10 等份）。
6. 给出持续优化建议清单（不在本次必做范围，但形成路线图）。

## Current State Analysis

### 1) 网格间距选项

- 当前 `#roof-grid-step` 仅有 0.1/0.2/0.5/1：
  - [index.html:L758-L766](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L758-L766)

### 2) Module 输入区缺少数量

- 当前只提供 Module (m) 的宽高输入：
  - [index.html:L734-L743](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L734-L743)
- `addPVModule()` 目前一次仅添加一个模块（比例模式下会 `newModuleAtCenter()`）：
  - Site Overview 逻辑区（`window.addPVModule`）：[index.html:L8851-L9640](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L8851-L9640)

### 3) 磁力吸附与辅助线现状

- 当前 `applySnappingForMove()` 只在容差内对齐 bbox 边/中心线并返回 dx/dy，且只画一条简单 guide line：
  - [index.html:L9185-L9413](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9185-L9413)
- 没有“距离标注”、没有“吸附到边缘/中心线的可视化提示”细节，也没有方向键微调。

### 4) 复制按钮问题根因

- 当前“复制”按钮调用 `duplicateSelectedPVModules()`：
  - [index.html:L727-L733](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L727-L733)
- 实现中粘贴基准点固定从 `(0,0)+offset` 计算（而不是在原选区旁），导致复制后新模块可能跑到屋顶左上角、不易察觉：
  - `pastePVModulesFromClipboard()`：`baseX/baseY` 计算 [index.html:L9589-L9610](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9589-L9610)

### 5) 标尺占用空间与小刻度

- 标尺区域当前占用 44px×44px（grid-template）：
  - [index.html:L769-L783](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L769-L783)
- 标尺刻度目前按“每 1m”画线并标注数字，缺少更细的“小刻度”：
  - [index.html:L9073-L9166](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9073-L9166)

## Decisions (from user)

- 数量输入：固定 Qty 输入框（常驻），每次点击“添加光伏板”按该数量批量添加。
- 批量添加起始位置：从“当前选中模块旁”开始排布（若无选中，则从屋顶原点或视图中心作为兜底）。
- 标尺小刻度：按“网格间距细分 10 等份”显示。

## Proposed Changes

### A) 网格间距增加大尺度选项

修改文件：
- [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)

改动点：
1. 扩展 `#roof-grid-step` 的 `<option>`：
   - 保留：0.1 / 0.2 / 0.5 / 1
   - 新增：5 / 10 / 20 / 50 / 100 / 200 / 500 / 1000
2. `updateRoofSettingsFromUI()` 不需要改解析逻辑（已用 `parsePositiveFloat`），但在 `syncRoofUIFromState()` 中要确保当 gridStepM 是这些值时 select 能正确回显（option 必须存在）。

验收：
- 网格间距可选择到 1000m，切换后网格/标尺重绘正常且不卡顿。

### B) Module 规格旁新增 Qty，并按数量批量添加 + 自动排列

修改文件：
- [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)

UI 改动：
1. 在 `Module (m)` 宽高输入旁增加 Qty：
   - `#module-qty`（默认 1，min=1，max=5000，step=1）

逻辑改动：
1. 新增 `getModuleQtyFromUI()`：
   - 读取 `#module-qty`，做边界裁剪（例如 1~2000），避免一次添加过多导致卡顿。
2. 修改 `window.addPVModule`：
   - 批量添加 N 个模块，而不是只添加 1 个。
   - 批量添加前强制开启 `siteOverview.settings.snapMagnet = true`（满足“添加的组件均为磁力吸附”）。
3. 自动排列算法（从选中模块旁开始）：
   - 若当前 selection 非空，取其 bbox：
     - 起点 `startX = bbox.maxX + gapM`，`startY = bbox.minY`
   - 若 selection 为空：
     - 起点 `startX = 0`，`startY = 0`
   - 以模块当前旋转方向的尺寸计算列数：
     - `cols = floor((roofWidthM - startX + gapM) / (moduleW + gapM))`，最少 1
   - 逐行铺开：第 k 个模块放在
     - `x = startX + (k % cols) * (moduleW + gapM)`
     - `y = startY + floor(k/cols) * (moduleH + gapM)`
   - 若超出 roofHeightM：停止添加并 toast 提示“超出屋顶范围，已添加 X 个”。
   - gapM 默认值：取 `min(0.05, gridStepM/10)`，确保既可区分，又不会影响工程示意密度。
4. 批量添加后：
   - 自动选中新添加的一组模块（便于立即批量移动/旋转/复制）。
   - push history（一次性 push，而非每个模块一次）。

验收：
- 输入 Qty=20 点击添加：一次性出现 20 个模块，按行列在选中模块右侧自动排列；磁力吸附默认开启。

### C) CAD 级磁力吸附：边缘/中心线吸附 + 距离标注 + 方向键微调

修改文件：
- [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)

1) 吸附目标与策略增强
- 将 `applySnappingForMove()` 扩展为返回更丰富的结果：
  - `{ dx, dy, snapX?: { type, from, to }, snapY?: { type, from, to } }`
- Snap 候选线：
  - 其它模块：left/right/centerX 与 top/bottom/centerY
  - 屋顶边界：x=0、x=roofWidthM、y=0、y=roofHeightM（工程示意常见需求）
- 对每个轴选择“最小 |delta| 且在 tolerance 内”的候选。

2) 吸附视觉反馈：辅助线 + 距离标注
- 新增 `addGuideLabel({ x, y, text })`，在 guidesLayer 画一个小标签（半透明深色底+白字）。
- 当 snapX/snapY 生效：
  - 继续画 guide line
  - 同时显示距离（单位 m，保留 2 位小数；当 < 1m 时可显示 cm，例如 0.05m 显示 5cm，可作为增强项）

3) 方向键微调（1cm/5cm）
- 在 `document.keydown` 中新增 ArrowUp/Down/Left/Right：
  - stepSmall = 0.01m（1cm）
  - stepBig = 0.05m（5cm，Shift+箭头）
- 仅当当前在 Site Overview 页且 selection 非空时生效。
- 微调后同样执行 clamp、吸附（可选：按住 Alt 禁用吸附，作为增强项），并在 keyup/节流后 push history。

验收：
- 拖动模块靠近另一个模块边缘/中心线时会吸附，并出现对齐线与距离标注。
- 用方向键可精确移动 1cm；Shift+方向键移动 5cm。

### D) 修复“复制”按钮：复制结果出现在原选区旁，且与快捷键一致

修改文件：
- [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)

改动点：
1. 修正 `pastePVModulesFromClipboard()` 的基准点：
   - 由固定 `(0,0)+offset` 改为以“当前 selection bbox”或“clipboard bbox”作为参考：
     - 若当前仍有 selection：`baseX = selectionBBox.minX + offset`，`baseY = selectionBBox.minY + offset`
     - 否则：`baseX = offset`，`baseY = offset`
2. 当无选中模块时点击复制：
   - 触发 toast 提示“请先选中光伏板再复制”，避免用户误以为按钮失效。
3. 保持 Ctrl/Cmd+C / Ctrl/Cmd+V 与按钮行为一致：
   - Ctrl/Cmd+C：仅写入 clipboard，不自动粘贴
   - 按钮“复制”：执行 copy + paste（快速复制）
   - Ctrl/Cmd+V：执行 paste

验收：
- 选中模块后点“复制”，新模块出现在原位置附近（偏移 0.2m），肉眼可见。

### E) 标尺/参考轴优化：缩窄占用 + 小刻度（step/10）

修改文件：
- [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)

改动点：
1. 将 `roof-editor-grid` 的标尺占用从 44px 调整为更窄（例如 28px）：
   - 调整 `grid-template-columns/rows` 与相关字体大小、label 位置。
2. `renderRulersAndGrid()` 小刻度规则：
   - major：每 `gridStepM` 一根长刻度 + 数字标注
   - minor：每 `gridStepM/10` 一根短刻度（颜色更淡、长度更短），不标数字
3. 性能保护：
   - 若 `minorPx` 太小（例如 < 4px）则自动降级（只画 major），避免大屋顶+小刻度导致 DOM 过多。

验收：
- 标尺占用明显变窄，屋顶背景图显示区域更大。
- 在 1m 网格时显示 0.1m 小刻度；在 10m 网格时显示 1m 小刻度；密度过高时自动降级不至于卡顿。

### F) 持续优化建议（路线图）

本次实现后建议的下一阶段能力（不强制立刻做）：
1. **模块类型库**：不同规格组件（多种尺寸/颜色/名称）并支持混排。
2. **对齐/分布工具**：左对齐、右对齐、水平等间距、垂直等间距。
3. **障碍物/禁布区**：天窗、烟囱、女儿墙区域（矩形/多边形）。
4. **测量工具**：点到点测距、面积估算、模块间距标注输出。
5. **导出**：导出 PNG/SVG（用于工程汇报），或导出简化 JSON 模板供复用。
6. **性能**：模块数 > 2000 时切换 canvas 渲染（DOM→Canvas），保持交互流畅。

## Verification

1. 网格间距
   - 选择 5m/100m/1000m，确认网格与标尺能正常重绘。
2. 批量添加
   - Qty=1/20/200，点击添加，确认按选中模块旁自动排布；超出屋顶高度时提示并停止。
3. 磁力吸附 + 标注
   - 拖动模块接近其它模块边/中心线，出现吸附与距离标注。
4. 微调
   - 选中模块后方向键移动 1cm；Shift+方向键移动 5cm；移动后仍在屋顶范围内。
5. 复制
   - 选中后点击复制：新模块出现在原位置旁；Ctrl/Cmd+C/V 行为一致。
6. 标尺
   - 标尺占用缩窄；小刻度按 step/10 展示；密度过高时自动降级。

