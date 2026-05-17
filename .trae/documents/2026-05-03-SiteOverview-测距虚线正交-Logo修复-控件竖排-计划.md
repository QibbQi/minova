## Summary

针对 SITE OVERVIEW（第 5 页）完成三项修复与布局约束：

1. 测距磁吸时的虚线辅助线强制为水平/垂直（不再出现“歪线”）。
2. 修复 MINOVA Logo 无法显示的问题（图片加载失败时可自动 fallback）。
3. “Module / Text / Distance / Area”三张卡片在网页端强制上下纵向排列（不随屏幕变宽变为并排）。

## Current State Analysis (Grounded)

### 1) 虚线辅助线出现歪线

- 虚线参考线使用 `roofMeasureSnapLines` 渲染为 SVG `<line>`：
  - [index.html:L10499-L10512](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L10499-L10512)
- 角点吸附（CAD 风格）在命中时，会把虚线从角点直接连到吸附点（两点 x/y 同时变化时，线段会倾斜）：
  - 角点吸附函数：[snapMeasurePointToCornersEx](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L10165)
  - 虚线生成点位在测距草稿/拖拽/编辑长度等多处写入 `roofMeasureSnapLines`（目前存在 corner->snap 的直连线）。

### 2) MINOVA Logo 无法显示

- 第 5 页顶部 logo 使用相对路径：
  - [index.html:L710](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L710)
- 仓库内存在图片文件：
  - [logo-horizontal.png](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/logo-horizontal.png)
  - [logo.png](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/logo.png)
- 但用户截图表现为浏览器图片加载失败（显示 broken icon + alt 文案），需要在执行阶段通过网络面板确认是 404、解码失败还是路径解析问题，并给出兜底处理。

### 3) 控件卡片网页端并排

- 当前卡片容器使用响应式列数：`grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3`，因此宽屏会并排：
  - [index.html:L751-L863](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L751-L863)

## Proposed Changes

修改文件：
- [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)

### A) 测距磁吸虚线强制正交（水平/垂直）

目标：虚线每一段都必须是水平或垂直，不允许单段斜线。

实施方式：

1. 新增一个统一的“写入虚线”的辅助函数（例如 `pushOrthoSnapLines(...)`），根据吸附类型生成 1~2 段线：
   - **角点吸附 axis=x**：画一条竖线 `corner -> (corner.x, snap.y)`，再画一条横线 `(corner.x, snap.y) -> snap`
   - **角点吸附 axis=y**：画一条横线 `corner -> (snap.x, corner.y)`，再画一条竖线 `(snap.x, corner.y) -> snap`
   - **角点吸附 axis=xy**：以 L 形两段线连接（任选一种固定顺序，确保两段都是正交）
   - **边线吸附**：保持现有单段线（通常已正交）；若发现仍会倾斜，则同样改为投影两段线（按 edge 方向拆分）。
2. 将测距相关写入 `roofMeasureSnapLines` 的位置统一改为调用该函数：
   - 草稿态 pointermove（measure_dist）：[index.html:L11432-L11438](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L11432-L11438)
   - 拖拽 dist 标注（role all/a/b）：[index.html:L11406-L11417](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L11406-L11417)
   - 编辑距离写回（updateDistMeasureLength）：[index.html:L10112-L10150](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L10112-L10150)
3. 颜色、线宽、虚线样式仍复用当前渲染逻辑（不改视觉规格，只修几何）。

验收标准：
- 在任何角点磁吸情况下，屏幕上的虚线均为水平/垂直线段组合，不出现斜线。

### B) MINOVA Logo 显示修复

目标：保证 logo 在不同访问路径/缓存条件下都能显示；若主图加载失败，自动切到备用图。

实施步骤（执行阶段完成并验证）：

1. 先确认失败原因：
   - 在浏览器 Network 中检查 `logo-horizontal.png` 的请求状态码与内容类型
   - 若是 404：修正路径（改为 `./logo-horizontal.png` 或绝对路径策略）
   - 若是解码失败/内容异常：改用 `logo.png` 或将 logo 转为更稳定格式（如 SVG）后引用
2. 在 HTML 上添加 fallback（不改变布局）：
   - 给 `<img>` 增加 `onerror`：当 `logo-horizontal.png` 失败时切换为 `logo.png`
   - 同时把 `src` 统一改为 `./logo-horizontal.png` 以避免相对路径在某些部署场景下被错误解析

验收标准：
- logo 在用户复现环境下可正常显示；若主图失败自动回退到备用图，不再出现 broken icon。

### C) 卡片强制纵向排列（网页端）

目标：无论屏幕宽度，三张卡片固定按以下顺序上下排：
- Module
- Text
- Distance / Area

改动：
- 将卡片容器 class 从 `grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3` 改为 **固定单列**（`grid-cols-1`），并保持 `gap-3` 不变：
  - 位置：[index.html:L751](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L751)

验收标准：
- 网页端与打印端均为纵向排列；宽屏不再出现并排。

## Assumptions & Decisions

- 虚线“完全垂直或平行”的定义按“每一段线都必须是水平或垂直”处理，允许用两段 L 形线表达 CAD 对齐提示。
- Logo 修复优先采取最小改动（路径规范化 + onerror fallback），避免引入额外构建流程。
- 卡片纵向排列只调整容器列数，不改卡片内部布局，以避免影响既有控件对齐。

## Verification

1. 虚线正交：
   - 进入 Dist 测距模式，靠近模块角点做远距离吸附，观察虚线为水平/垂直组成，无斜线。
2. Logo：
   - 刷新页面并清缓存后，logo 正常显示；模拟主图 404/阻断时自动回退备用图。
3. 卡片纵向排列：
   - 桌面宽屏下仍为 Module→Text→Distance/Area 纵向排列，不再并排。

