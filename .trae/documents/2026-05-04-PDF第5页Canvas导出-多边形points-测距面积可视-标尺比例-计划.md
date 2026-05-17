## Summary

在“第 5 页只要画布 + PDFLib 直接嵌入 PNG”的基础上（背景图已能完整显示），继续修复剩余 3 个问题：

1) **多边形/自定义组件仍导出为矩形**：必须按 Edit Vtx 编辑后的 points 形状输出。
2) **测距线/面积图形不可见**：不能只剩黑色胶囊数字，线段/端点/面积填充与边界必须清晰可见。
3) **标尺横向与画布不一致（疑似横向压缩）**：标尺刻度/网格与画布坐标系严格一致，且导出到 A4 后保持比例不变形。

约束：只影响 PDF 导出第 5 页，不影响其他页面导出/查看，不影响 Site Overview 日常交互。

## Current State Analysis（基于现有实现）

- 第 5 页导出当前路径为：Canvas 合成快照 → `embedPng` → PDFLib `drawImage`（不再走 html2pdf 二次截图），背景图完整显示说明该路径已生效。
- 多边形仍矩形/线面缺失说明：Canvas 合成渲染逻辑在“自定义组件 points 判定/测距面积描边可视性/标尺刻度算法”上仍与编辑器渲染存在偏差，或可视性不足。
- 自定义组件数据结构已确认：Edit Vtx 只在 `!(m.vertexLocked ?? customVertexLockedDefault)` 时使用 `m.points`（world 坐标）；[getCustomShapePointsFromRect](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L11026-L11038)

## Proposed Changes

### 1) 自定义组件：导出优先使用 points（不受 vertexLocked 标志影响）

**目标**

- 只要组件带有 `m.points.length>=3`，导出就按 points 绘制 polygon（这对应你“已编辑顶点”的组件）。
- 如果 points 不存在，才 fallback 到 `shape/polyN` 生成规则形状。

**实现细节（index.html / buildRoofSnapshotForPdf）**

- custom 绘制逻辑改为：
  - `if (Array.isArray(m.points) && m.points.length>=3) ptsW = m.points`
  - `else ptsW = getCustomShapePointsFromRect(shapeOrPolyFallback, ...)`
- shape 兜底：
  - `shapeOrPolyFallback = m.shape || (m.polyN ? 'polygon' : 'rect')`
  - 避免 shape 丢失时 polygon 退回 rect。

### 2) 测距线/面积：做“描边双层 + 提高线宽 + 对比色兜底”，保证肉眼可见

**目标**

- dist：线段/端点/箭头清晰可见，且不被背景/网格吞没。
- area：填充在复杂背景上仍可辨识（不透明度/描边需要更强对比）。

**实现细节**

- dist 线段绘制改为两层：
  - 先画一层黑色半透明底线（例如 `rgba(0,0,0,0.35)`，lineWidth=6）
  - 再画彩色主线（现有 color，lineWidth=3）
  - marker/arrow 同样采用“黑底 + 彩色”或加 `shadowBlur=2`，确保可见。
- area polygon：
  - stroke 改为双层（黑底+彩色），并把 strokeWidth 提到 3
  - fill 的 opacity 下限提高（例如最少 0.22），并允许对非常亮的底图自动提高（可选：检测背景亮度后调整；或固定提高即可）
- 保持黑色胶囊数字不变（你已确认需要保留）。

### 3) 标尺/网格：复刻 renderRulersAndGrid 的刻度算法，保证与画布坐标一致

**目标**

- 标尺刻度与网格线完全对齐，横向/纵向比例与编辑器一致。

**实现细节**

- 在 Canvas 导出中不再用 `for i=0..ceil(widthM)` 的简化刻度：
  - 直接复刻 [renderRulersAndGrid](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L11548) 的 major/minor step 计算与 tick 密度限制逻辑
  - 以同一 `pxPerM` 绘制：
    - minor tick：短刻度 + 细线
    - major tick：长刻度 + 数字
- 若用户关闭标尺/网格（settings.showRulers=false），导出也应同步隐藏（与编辑器一致）。

### 4) “疑似横向压缩”：确保 A4 嵌入保持比例且不裁切

**目标**

- PDFLib drawImage 始终用 `ratio = min(pw/imgW, ph/imgH)` 方式 fit，并保持居中，不改变宽高比。

**实现细节**

- 第 5 页 drawImage margin 从 10px 调整为 0 或 5（避免用户误判为裁切/压缩）。
- 明确以 `img.scale(1)` 的原始像素宽高计算 fit，杜绝非等比缩放。

## Assumptions & Decisions

- 导出范围：按画布全区（你已确认）。
- 自定义组件：是 Edit Vtx 编辑过顶点的 points 形状（你已确认）。
- 需要保留：标尺+网格、黑色胶囊数字（你已确认）。

## Verification

- 在第 5 页准备：至少 1 个已编辑顶点的自定义组件、1 条 dist、1 个 area。
- 生成 PDF 后检查第 5 页：
  - 自定义组件按 points 形状导出（不再矩形退化）
  - dist 线段/端点可见，area fill+stroke 可见
  - 标尺/网格与画布对齐，横向不压缩、不变形
  - 其它页导出/查看不受影响

