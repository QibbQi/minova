## Summary

本计划针对 Site Overview（第 5 页）完成三类增强：
1. **光伏板组件视觉与交互重做**：去掉右下角白色缩放方块；改为“鼠标移动到右下角热区才可缩放”，且缩放与移动互斥不重叠；将组件填充改为 **LOGO 紫色系半透明**，并增加全局透明度调节；组件内部增加两条不透明连线（左下→上中、右下→上中），线宽恒定且等于外边框粗细；“PV”白色并居中。
2. **磁力吸附重做**：确保组件之间能稳定吸附，并在吸附过程中提供明显的视觉反馈（吸附线/高亮/距离标注），支持边缘/中心线吸附与“吸附锁定”体验。
3. **测量工具新增**：点到点测距、拖拽矩形面积估算、模块间距标注（以画面标注为主），并可清除标注。

## Current State Analysis

### 光伏板组件现状（样式与缩放）

- 当前组件 DOM 由 `renderModules()` 拼接，包含 `PV` 文本 + 删除按钮 + 右下角 `.resize-handle`：
  - [index.html:L9400-L9426](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9400-L9426)
- CSS 中 `.pv-module .resize-handle` 使用白色 10×10 方块作为缩放手柄：
  - [index.html:L8475-L8521](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L8475-L8521)
- 目前缩放触发方式是 `pointerdown` 判断 `data-action="resize"`：
  - [index.html:L9494-L9522](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9494-L9522)

### 磁力吸附现状

- 吸附入口为 `applySnappingForMove()`，对 selection bbox 与其它模块/屋顶边界线做容差内对齐，返回 dx/dy：
  - [index.html:L9303-L9398](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9303-L9398)
- 吸附的视觉反馈目前仅依赖 guides layer 绘制简单线条/标签：
  - [index.html:L9124-L9168](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9124-L9168)
- 用户反馈“无法做到组件吸附，需要明显吸附过程”，说明当前策略在交互体验上不够“粘”，以及缺少对齐对象/锁定状态提示。

### 测量工具现状

- 当前仅有编辑（拖动/缩放/复制/网格/吸附/标尺），没有测量模式与标注数据结构。

## Decisions (from user)

- 透明度调节：**全局**（工具栏一个滑杆影响所有组件）。
- 面积估算：**拖拽矩形**。
- 测距/间距结果：**仅画面标注**（线段 + 数值标签）。

## Proposed Changes

### A) 光伏板组件 UI/交互重做（去手柄 + 紫色半透明 + 内部连线 + 居中文本）

修改文件：
- [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)

#### A1. 移除白色缩放方块，改为右下角“热区缩放”

1. CSS：删除或不再使用 `.pv-module .resize-handle` 规则，并移除 DOM 里 `<div class="resize-handle">`。
2. `pointermove`：在 hover 时根据鼠标在模块内的位置切换 cursor：
   - 若位于右下角热区（例如离右边与下边 <= 12px），显示 `se-resize`；
   - 否则显示 `move`。
3. `pointerdown`：只依据“热区命中”决定进入 resize 或 drag：
   - 若热区命中：仅允许单选时进入 resize（保持现有规则）；
   - 否则进入拖动（批量拖动保持）。
4. 互斥保障：热区判定优先于拖动，确保“移动与缩放不能重合”。

#### A2. 组件色彩改为半透明紫色 + 全局透明度滑杆

1. 将 `.pv-module` 的背景从当前蓝色 `rgba(30, 64, 175, 0.7)` 改为紫色系（参考现有紫色按钮 `#582C83`）：
   - `--pv-alpha` 由全局滑杆控制；
   - `background-color: rgba(88, 44, 131, var(--pv-alpha))`（或运行时用 style 直接写入 rgba）。
2. 工具栏新增透明度滑杆（建议范围 0.05–0.9，步进 0.05），并保存到 `siteOverview.settings.moduleOpacity`，用于：
   - 重新渲染时应用到所有模块；
   - 保存/加载报价时持久化。

#### A3. 内部两条不透明连线 + 线宽恒定

1. 在每个 pv-module 内部增加 SVG 覆盖层（`position:absolute; inset:0; pointer-events:none`）：
   - Line1：左下角 → 上中；
   - Line2：右下角 → 上中；
2. 线条要求：
   - 不透明（alpha=1）；
   - 线宽不随组件缩放变粗：使用 `vector-effect="non-scaling-stroke"`；
   - 线宽 = 外边框线宽（建议将边框从 1px 提升为 2px，以更贴合工程示意），strokeWidth 同步设置为 2。

#### A4. PV 文本居中与样式

1. “PV”文本改为纯白色，居中（flex 或 absolute 居中均可）。
2. 确保文本在 SVG 之上（z-index），并且不被删除按钮覆盖。

验收：
- 右下角白色方块消失；鼠标移动到右下角热区才出现 `se-resize` 光标并可缩放；其它区域拖动不触发缩放。
- 组件填充为半透明紫色；透明度滑杆能实时改变所有组件透明度且保存/加载后保持。
- 内部两条连线可见、完全不透明、线宽恒定，且等于外边框线宽。
- “PV”白色并在组件正中央。

### B) 磁力吸附重做（可吸附 + 明显过程）

修改文件：
- [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)

实现要点：
1. 吸附算法升级为“可锁定吸附”：
   - 计算候选线（其它模块的 left/right/center、top/bottom/center + 屋顶边界线）；
   - 对 X/Y 分别选取最优候选；
   - 当进入容差时进入“吸附锁定”状态（sticky），即使鼠标微小抖动也保持对齐，直到超出释放阈值（hysteresis：进入阈值 < 释放阈值）。
2. 明显吸附反馈：
   - 吸附线：对齐对象线用更高对比度（紫色或蓝色）；
   - 对齐对象高亮：被吸附到的目标模块边缘可临时高亮（在目标模块 DOM 上加 outline 或在 guides layer 画对应线）；
   - 距离标注：维持现有 label 机制，并增加“对齐类型”提示（如 Center/Edge）。
3. 容差与体验：
   - 默认 `snapToleranceM` 从当前 0.05m 调整为更工程化的值（例如 0.10m），并新增“吸附强度/容差”可选项（后续可做）。

验收：
- 模块在靠近其它模块边缘/中心线时能可靠吸附，且吸附过程可直观看到（对齐线 + 目标提示 + 距离标注）。
- 吸附在小范围内不会抖动；移出释放阈值后解除吸附。

### C) 测量工具：测距 / 面积 / 模块间距标注

修改文件：
- [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)

#### C1. 工具模式与 UI

1. 在 Site Overview 工具栏新增工具模式选择：
   - Select（默认编辑/选择）
   - Measure Distance（测距）
   - Measure Area（矩形面积）
   - Measure Spacing（模块间距标注）
2. 新增“清除标注”按钮：清空测量结果。

#### C2. 数据结构（可持久化）

1. 在 `siteOverview` 下新增 `measurements`：
   - `measurements: [{ id, type: 'dist'|'area'|'spacing', ... }]`
2. 保存/加载：在 snapshot memory 中随 `siteOverview` 一并持久化。

#### C3. 点到点测距（dist）

1. 在测距模式下：
   - 第一次点击记录起点（世界坐标 m）；
   - 鼠标移动显示预览线与实时距离；
   - 第二次点击固定终点并生成 measurement。
2. 渲染：
   - 在 guides layer 绘制线段；
   - 在中点位置显示距离标签（m/cm）。

#### C4. 拖拽矩形面积（area）

1. 在面积模式下：
   - pointerdown 记录起点；
   - pointermove 绘制半透明矩形；
   - pointerup 固化并计算面积：
     - `area = widthM * heightM`；
2. 渲染：
   - 矩形边框 + 半透明填充；
   - 中心标签显示 `xx.xx m²`。

#### C5. 模块间距标注（spacing）

1. 使用方式（简单且工程化）：
   - 选中两块模块后点击“标注间距”或进入 spacing 模式点击两块模块；
   - 计算它们在 X 与 Y 方向的最近间距（edge-to-edge），并绘制标注线 + 数值。
2. 输出：仅画面标注，可清除。

验收：
- 测距：两次点击生成距离标注；拖动/缩放画布后标注仍对齐正确位置。
- 面积：拖拽矩形生成面积标注（m²）。
- 间距：两模块生成间距标注，数值合理并可清除。

## Assumptions & Decisions

- 内部连线使用 SVG 的 `vector-effect="non-scaling-stroke"` 实现恒定线宽；边框线宽提升到 2px 以匹配工程示意观感。
- 透明度滑杆为全局，写入 `siteOverview.settings.moduleOpacity`，所有模块共享该值。
- 测量标注以 guides layer 绘制，不参与模块选择/拖拽命中（pointer-events:none），避免干扰编辑。

## Verification

1. 组件样式
   - 添加组件后检查：紫色半透明、PV 白色居中、两条连线存在且线宽恒定、无右下角白色缩放方块。
2. 缩放/移动互斥
   - 鼠标移至右下角热区可缩放；移至其它区域仅可拖动；缩放时不触发拖动。
3. 磁力吸附
   - 拖动模块靠近另一模块边缘/中心线：出现明显吸附过程（对齐线/高亮/标签），并能稳定锁定/释放。
4. 测量工具
   - 测距：两次点击生成距离标签；
   - 面积：拖拽矩形生成面积标签；
   - 间距：两模块生成间距标注；
   - 清除标注按钮清空所有测量图层。

