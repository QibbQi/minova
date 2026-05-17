## Summary

本计划在 Site Overview（第 5 页）继续增强“其他组件”和“测距工具”，并对工具栏/属性区做一次整体 UI 重排以符合设计师使用逻辑，包含：

1. “+添加其他组件”支持选择背景色与字体色，并加入颜色限制：背景与字体不可同色（用户确认：只禁止同色）。
2. 测距工具修复“无法单独选中并整体移动”的问题：增加“选择标注/选择组件”的模式分离，并让标注可被点击选中后拖动。
3. 测距拖动支持三种操作：整体移动、单独拖动起点、单独拖动终点，拖动时分别吸附。
4. 测距标注图层置顶：永远在所有组件上方显示且不被覆盖。
5. 测距吸附时增加判断辅助线（在拖动过程中可视化提示吸附到哪条边/留距）。
6. 增加测距颜色选择（用户确认：任意颜色选择器）。
7. 测距起点/终点样式调整：
   - 移除“环/方”；
   - 默认样式改为“十”；
   - 增加“箭头”端点样式（起点/终点分别可显示箭头）；
   - 距离值仍使用现有“气泡文字”呈现（用户确认）。
8. 组件字体粗细从 400/700/900 改为：极细/细/中/粗，并保持全局控制（影响 PV + 其他组件）。
9. UI 优化：对第 5 页所有按钮与控制项做“完全重做布局”，重新分组与摆放。

## Current State Analysis (Grounded)

### 现有控件与弹窗

- Site Overview 工具栏目前为两行，包含：添加 PV/其他组件、复制/删除、旋转、锁定、吸附、Opacity、字体、测距样式/约束、网格间距等：
  - [index.html:L721-L827](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L721-L827)
- “其他组件”弹窗目前只有文字与颜色（单一颜色即文字色），无背景色与约束逻辑：
  - [index.html:L8630-L8653](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L8630-L8653)
  - 相关逻辑：`openRoofCustomModuleModal/confirmAddRoofCustomModule` 等：
    - [index.html:L10571-L10672](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L10571-L10672)

### 测距图层与交互现状

- measure layer DOM 位于 modules layer 之前，默认 class 为 `pointer-events-none`，导致图层层级与交互容易受影响：
  - [index.html:L799-L807](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L799-L807)
- `renderRoofMeasurements()` 已在 dist 测距线与 marker 上输出 `data-mid`，并绘制 marker（当前含 ring/square 等）：
  - [index.html:L9377-L9460](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9377-L9460)
- measure 的拖动逻辑目前主要在 `viewport.pointerdown` 的 `measure_dist` 分支尝试命中 `data-mid` 后启动拖动；但用户反馈仍不可稳定选中整体移动，需要更明确的“标注选择模式”和命中处理。

### 已有吸附能力（可复用）

- 模块磁力吸附与引导线/高亮逻辑已存在（guides layer）：
  - [applySnappingForMove](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9591-L9677)
- 测距点吸附到模块边旁并留距的逻辑函数已存在（可继续扩展显示辅助线）：
  - [snapMeasurePointToModules](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9313-L9363)

## Decisions (from user)

- 距离数值：保留现有气泡文字展示。
- 颜色规则：只禁止同色（背景与字体不可同色）。
- 测距颜色：任意颜色选择器。
- UI：完全重做布局。

## Proposed Changes

修改文件：
- [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)

### 1) “其他组件”弹窗：增加背景色 + 字体色 + 同色限制

#### 1.1 数据结构扩展

对 `type:'custom'` 模块新增字段：
- `bgColor`：背景色（支持透明/无背景）
- `textColor`：字体色（已存在）

渲染时：
- `.pv-module` 背景色继续由 `rgba(88,44,131,var(--pv-alpha))` 控制作为“组件底纹”；
- 对 custom 模块额外在 `.pv-module-content` 或 `.pv-module` 上叠加 `background-color: bgColor`（若 bgColor 为空则不覆盖），保持 opacity 的一致体验（需要确定是 bgColor 也受 opacity 影响，建议：bgColor 也乘以 `--pv-alpha`，否则会显得突兀）。

#### 1.2 弹窗 UI

在 `roof-custom-module-modal` 中新增：
- 背景色选择：`<input type="color" id="roof-custom-bg">` + “无背景” checkbox
- 字体色选择：`<input type="color" id="roof-custom-fg">`

#### 1.3 颜色限制（只禁止同色）

规则：
- 若用户选择了相同的 bg 与 fg：
  - 立即将字体色自动调整为 `#FFFFFF`（若 bg 为白则改为 `#000000`），并 toast 提示“背景色与字体色不能相同，已自动调整”；
  - 提交时再次校验，保证不会保存同色。

验收：
- 背景选黄（#FFC107）时，字体不能为同黄；
- 可选“无背景”，此时只控制字体色。

### 2) 测距图层置顶 + 交互可靠性修复（选择标注/选择组件分离）

#### 2.1 图层置顶

将 `#roof-measure-layer` 放到 `#roof-modules-layer` 之后（DOM 顺序），或为各 layer 统一加 z-index：
- grid < guides < modules < measure（最高）

并确保 measure layer `pointer-events` 在需要时开启。

#### 2.2 工具模式拆分

在 “工具” 下拉增加两项：
- `select_modules`：选择组件（默认）
- `select_measures`：选择标注

策略：
- 处于 `select_measures` 时：
  - 点击组件不改变 selection（或仅清空标注选中），优先命中标注；
  - 标注可被点击选中（保存 `roofMeasureSelectionId`），选中后可整体拖动。
- 处于 `select_modules`/其它模式时：
  - 标注默认不抢事件（pointer-events:none 或命中后立即 return），避免影响组件选择。

验收：
- “选择标注”模式下，标注可稳定点击选中并整体移动。

### 3) 测距拖动增强：整体/起点/终点分别拖动并分别吸附

#### 3.1 数据与状态

新增：
- `roofMeasureSelectionId: number | null`
- `roofMeasureDrag: { id, role: 'all'|'a'|'b', startPx, initial }`

#### 3.2 命中与拖动

在 `renderRoofMeasurements()` 中：
- dist 的线段继续带 `data-mid`
- 起点/终点 marker 增加 `data-role="a|b"`（已有 role 字段但目前 drag 只做整体）

在 pointerdown（measure 相关处理）中：
- 命中 marker：进入 role='a' 或 role='b'
- 命中线段：进入 role='all'

pointermove：
- role='all'：平移 a/b 同步移动；对 a 执行吸附并将偏移量同样作用到 b（保持整体刚性），并渲染辅助线
- role='a'：只移动 a，执行吸附与辅助线；然后按 constraint 纠正 b（若 horizontal/vertical）
- role='b'：只移动 b，执行吸附与辅助线；然后按 constraint 纠正 a（或保持 a，取决于 UX；建议保持 a 不动，仅修正 b 以满足 constraint）

constraint 处理（保持与创建时一致）：
- horizontal：强制 `a.yM=b.yM`（拖动 a 时带动 b 的 y；拖动 b 时带动 a 的 y）
- vertical：强制 `a.xM=b.xM`
- free：不处理

pointerup：
- 结束拖动，pushHistory 并 render。

验收：
- 能整体移动测距；
- 能单独拖动起点/终点；
- 拖动时会吸附到组件边旁并保留 0.05m 留距。

### 4) 测距吸附辅助线（判断提示）

当发生吸附（点位被 snapMeasurePointToModules 调整）时：
- 在 `roof-guides-layer`（或新建 `roof-measure-guides-layer`）绘制辅助线：
  - 一条短线表示吸附到的边（与边平行）
  - 一条垂线表示留距方向（从组件边到测距点）
- 辅助线仅在拖动过程中显示，拖动结束清除。

实现上需要让 `snapMeasurePointToModules` 返回更多信息（被吸附的模块 id、边类型、原点/目标点、留距值），供渲染辅助线使用。

验收：
- 吸附时出现辅助线提示；离开吸附范围提示消失。

### 5) 测距颜色选择（任意颜色）

在工具栏新增：
- `input type="color"`：`roof-dist-color`
- settings 默认 `distColor: '#582C83'`（或沿用当前紫色）

创建 dist measurement 时把颜色写入 measurement：
- `color`

渲染 dist 时优先使用 `m.color`，否则使用 `settings.distColor`。

验收：
- 选择任意颜色后，新建测距使用该颜色；已有测距保持创建时颜色不变。

### 6) 测距样式调整：移除环/方，默认十，新增箭头端点

#### 6.1 Marker 选项更新

将 marker 样式选项改为（至少 5 个且默认十）：
- `cross`（默认）
- `dot`
- `diamond`
- `arrow_a`（起点箭头）
- `arrow_b`（终点箭头）
- `arrow_ab`（双端箭头）

并从 UI 中移除 ring/square。

#### 6.2 SVG 绘制

在 `renderRoofMeasurements()` 中：
- cross/dot/diamond：绘制对应图形
- arrow_*：使用 SVG `marker` 或绘制三角形 path 作为箭头，绑定到起点/终点

距离气泡文字继续保留（用户确认）。

验收：
- 默认 marker 为“十”；
- 可选择箭头端点样式且显示正确；
- 环/方不再出现。

### 7) 字体粗细从数字改为极细/细/中/粗

UI：把 `roof-label-weight` 的 options 从 400/700/900 改为：
- 极细（200）
- 细（300 或 400）
- 中（600）
- 粗（900）

settings 仍存储数值（便于直接应用到 CSS）。

验收：
- 选择不同粗细时 PV 与 custom 文本粗细变化符合预期。

### 8) UI 全面重排（设计师逻辑）

目标：将“动作/工具/属性”分区，减少横向拥挤，降低学习成本。

实施方案（不引入新依赖）：
- 将第 5 页顶部区域改为三块：
  1. **左侧纵向工具栏（no-print）**：上传背景、添加 PV、添加其他组件、复制、删除、撤销/重做、清除、转换比例模式
  2. **顶部工具区（no-print）**：工具模式（选择组件/选择标注/测距/面积/间距）+ 锁定/吸附/显示标尺开关
  3. **右侧属性面板（no-print）**：分组卡片
     - Module：Roof(m)、Module(m)、Qty、Opacity
     - 文本：字号、粗细（极细/细/中/粗）、颜色
     - 测距：颜色选择器、marker 样式、约束方向
     - 网格：网格间距

约束：
- 保持现有 id 不变或提供兼容映射，避免大量逻辑改动；
- Print/PDF 不显示所有控制面板（保持 no-print）。

验收：
- 控件分区清晰、不会换行挤压；
- 常用动作与模式切换更易触达。

## Assumptions & Notes

- “标注整体移动/端点移动”只针对 `type:'dist'`，不改变 area/spacing 的行为（除非后续继续扩展）。
- “标注置顶”以不影响组件交互为前提：只有在 `select_measures` 或 `measure_dist` 模式下才让标注接受 pointer events。
- 颜色选择器使用原生 `<input type="color">`（浏览器原生支持，无新增依赖）。

## Verification

1. 其他组件配色限制：
   - 设置背景色与字体色同色时会被阻止/自动调整；
   - 黄底（#FFC107）时字体不可同黄。
2. 测距选择与拖动：
   - “选择标注”模式下可点击选中标注并整体移动；
   - 可拖动起点/终点，吸附与留距生效；
   - 标注始终在组件上方显示不被遮挡。
3. 测距辅助线：
   - 吸附时出现辅助线，离开吸附范围消失。
4. 测距颜色与样式：
   - 任意颜色选择器生效，新建标注用新色；
   - marker 默认十；环/方不再出现；箭头样式可选且显示正确；
   - 距离数值仍用气泡文字。
5. 字体粗细：
   - 极细/细/中/粗切换影响 PV 与 custom 文本。
6. UI 重排：
   - 控件分组合理且不影响既有功能（添加/删除/旋转/缩放/吸附/锁定/测量等）。

