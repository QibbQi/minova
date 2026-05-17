## Summary

在 Site Overview（第 5 页）实现 4 组改动：
1. 删除光伏板组件内部的 **V 型连线**（仅移除该装饰，不影响选择/移动/缩放/旋转/复制/删除/吸附/锁定/透明度等功能）。
2. 增加光伏组件（以及“其他组件”文字）**字体大小 / 颜色 / 粗细**的全局控制：
   - 颜色默认白色；
   - 颜色选项必须包含 LOGO 黄色 `#FFC107`。
3. 增加“+添加其他组件”按钮：弹窗输入文字与颜色，生成可编辑组件，交互能力与光伏组件一致（同用户确认）。
4. 测距工具增强：
   - 起始点样式可选（至少 5 种）；
   - 可选择“自由 / 水平 / 垂直”测距；
   - 测量生成后可拖动（整体移动标注）；
   - 起始点可吸附到组件边旁并保留间距（默认 0.05m，用户确认）。

## Current State Analysis (Grounded)

### 光伏组件渲染

- 组件由 `renderModules()` 渲染，当前内部 V 连线为 `<svg><line>...</line></svg>`：
  - [index.html:L9773](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9773)
- 组件统一使用 `.pv-module`，内部文字为 `.pv-module-label`：
  - [index.html:L8492-L8560](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L8492-L8560)

### 测距工具现状

- 工具模式在 `roof-tool-mode` 中包含 `measure_dist`，交互通过 `roofMeasureDraft` 完成两次点击生成 `type:'dist'`：
  - [index.html:L9854-L9866](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9854-L9866)
- 测量渲染在 `renderRoofMeasurements()`，当前只画线与标签，marker 不存在，measure layer 为 `pointer-events:none`，因此无法拖动：
  - [index.html:L9377-L9456](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9377-L9456)

### 可复用的品牌色

- 已存在品牌黄色 class：`.text-brand-yellow` / `.bg-brand-yellow`，色值 `#FFC107`：
  - [index.html:L27-L34](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L27-L34)

## Decisions (from user)

- 字体控制范围：全局（统一影响所有光伏板组件 + “其他组件”）。
- “其他组件”能力：同 PV 全能力（选择/多选、移动、缩放、旋转、复制、删除、吸附、锁定、Opacity）。
- 测距吸附间距：0.05m。

## Proposed Changes

修改文件：
- [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)

### A) 删除 PV 组件内 V 连线（不影响其它功能）

1. `renderModules()` 中 PV/legacy 分支移除 `<svg class="pv-module-lines">...</svg>` 的输出。
2. 保留 `.pv-module-content` 与 `.pv-module-label`（用于旋转文本、统一字体控制）。

验收：
- PV 组件内部不再显示 V 连线，删除/缩放/拖动/旋转/吸附/复制等不受影响。

### B) 增加全局字体控制（大小/颜色/粗细）

#### B1. settings 扩展

在 `siteOverview.settings` 增加默认值：
- `labelFontSizePx`（默认 12）
- `labelFontWeight`（默认 900）
- `labelColor`（默认 `#FFFFFF`）

#### B2. UI 增加控制项

在 Site Overview 第二行工具栏增加：
- 字号：number 或 range（建议 8–24）
- 粗细：select（400/700/900）
- 颜色：select（至少：白色 `#FFFFFF`、LOGO 黄 `#FFC107`、紫 `#582C83`、黑 `#000000`；可额外提供几种常用色）

并接入 `updateRoofSettingsFromUI()`，使更改会立刻 `renderRoof()`。

#### B3. 渲染应用

在 `renderModules()` 中对 `.pv-module-label` 设置：
- `font-size: ${settings.labelFontSizePx}px`
- `font-weight: ${settings.labelFontWeight}`
- `color: ${computedColor}`

颜色优先级：
- 若模块自身带 `textColor`（用于“其他组件”自定义颜色），优先使用该值；
- 否则使用全局 `settings.labelColor`。

验收：
- 调整字号/粗细/颜色会即时影响 PV 与其他组件文字；
- 默认颜色为白色，且可选项包含 `#FFC107`。

### C) “+添加其他组件”按钮 + 弹窗输入文字/颜色

#### C1. 数据模型

将 `siteOverview.modules` 的元素扩展为兼容多类型：
- PV 模块：`{ id, type: 'pv', xM, yM, wM, hM, rotDeg }`
- 其他组件：`{ id, type: 'custom', text, textColor, xM, yM, wM, hM, rotDeg }`

兼容旧数据：
- 若 `type` 为空，按 `pv` 处理；
- PV 模块文字仍显示“PV”（沿用现有行为）。

#### C2. UI/交互

1. 在 `+ 添加光伏板` 旁新增按钮：`+ 添加其他组件`。
2. 新增 modal（参考现有 modal 结构，如 [install-modal](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L1932)）：
   - 输入框：文字内容（必填）
   - 颜色选择：下拉（至少包含白色与 LOGO 黄）
   - 确认/取消按钮
3. 确认后创建 `type:'custom'` 模块：
   - 初始尺寸使用当前 Module (m) 默认尺寸（与“新增 PV”一致的默认逻辑）
   - 初始位置使用当前策略（靠近左上/或按现有添加策略平铺）

#### C3. 渲染逻辑

在 `renderModules()` 中：
- `type:'pv'`：label 固定 “PV”
- `type:'custom'`：label 显示 `m.text`
- 二者共享 `.pv-module` 外观、透明度、缩放手柄、删除按钮、旋转、吸附与锁定等交互

验收：
- 可新增自定义文字组件；其移动/缩放/旋转/复制/删除/吸附等行为与 PV 一致；
- 文字颜色按弹窗设置生效，同时字号/粗细受全局控制影响。

### D) 测距工具增强（起点样式/水平垂直/拖动/吸附）

#### D1. UI 增加测距参数

仅在工具模式为“测距”时显示/或常显均可（实现时选择一致方案）：
- 起点样式 select：至少 5 个选项（例如：dot、ring、square、diamond、cross）
- 测距方向 select：free / horizontal / vertical

这些值写入 `siteOverview.settings`（例如 `distMarkerStyle`、`distConstraint`），并在创建 measurement 时复制到 measurement 对象中（确保历史测量保持当时样式）。

#### D2. measurement 数据结构扩展

对 `type:'dist'` 的 measurement 增加字段：
- `markerStyle`
- `constraint`（free/horizontal/vertical）

#### D3. 约束测距实现

在 `measure_dist` 的 draft 更新与 finalize 时：
- horizontal：`b.yM = a.yM`
- vertical：`b.xM = a.xM`
- free：不约束

#### D4. 起点/终点 marker 绘制（至少 5 种）

在 `renderRoofMeasurements()` 对 dist 类型绘制：
- 线段：保持现有
- 起点/终点 marker：根据 `markerStyle` 用 SVG 元素组合实现（circle/rect/line），并使用 `vector-effect="non-scaling-stroke"` 保持线宽不随缩放变化。

#### D5. 吸附到组件边旁（留距离 0.05m）

在测距放置/拖动时对点位执行吸附：
- 遍历 `siteOverview.modules`，基于 axis-aligned bbox（使用 `getModuleDimsM`）计算四条边；
- 若点到某边距离在容差内，则吸附到该边外侧 `0.05m`（沿法线方向偏移），确保标注不压在边框上；
- 吸附后仍需 `clampWorldToRoof()` 保证在屋顶范围内。

#### D6. 测距结果可拖动（整体移动）

新增 `roofMeasureDrag` 状态与命中检测：
- 将 `roof-measure-layer` 从 `pointer-events:none` 改为可接收事件（必要时仅在 select/measure_dist 模式打开）。
- 对 dist measurement：
  - 在 SVG 线段与 marker 上加 `data-mid` 或 `data-measure-id`
  - `pointerdown` 命中测距元素时进入拖动（整体平移 a/b 同步移动）
  - `pointermove` 平移过程中持续应用吸附（尤其对起点）
  - `pointerup` 结束后 `pushRoofHistory()`

验收：
- 测距时可选择起点样式与方向约束；
- 测距生成后可拖动整体位置；
- 起点在靠近组件边时能吸附并保持 0.05m 间距；
- 不影响面积测量、间距测量与原有编辑功能。

## Verification

1. PV V 线删除：新增 PV 模块不显示 V 连线；旋转/缩放/拖动/删除正常。
2. 字体控制：调整字号/粗细/颜色（包含 #FFC107）对 PV 与其他组件均生效。
3. 其他组件：通过弹窗新增文字组件，颜色生效、可移动/缩放/旋转/复制/删除/吸附。
4. 测距增强：
   - 5 种 marker 样式可切换且渲染正确；
   - horizontal/vertical 约束生效；
   - 测距结果可拖动；
   - 起点可吸附到组件边旁且保持 0.05m 偏移。

