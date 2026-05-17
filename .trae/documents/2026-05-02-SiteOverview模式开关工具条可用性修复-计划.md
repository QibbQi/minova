## Summary

将「模式/开关（模式选择、缩放锁定、移动锁定、标尺、磁吸）」从 ROOF IMAGE AREA（`#roof-viewport`）内部移出，放置到「测距/网格」控件区与 ROOF IMAGE AREA 之间的空白区域，并靠近屋顶网格边缘，保证控件可点击可用。

## Current State Analysis (Grounded)

- 当前「模式/开关」被渲染在 `#roof-viewport` 内部的一个绝对定位容器中：
  - [index.html:L853-L884](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L853-L884)
- `#roof-viewport` 绑定了 `pointerdown` 事件，并在多数模式下会 `setPointerCapture + e.preventDefault()` 来处理编辑交互：
  - [index.html:L10739-L10831](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L10739-L10831)
- 因为工具条在 `#roof-viewport` 内，点击 `<select>` / `<input>` 时同样会触发 viewport 的 pointerdown，并被 `preventDefault` 影响，导致用户反馈「放在 ROOF IMAGE AREA 上方无法使用」。

## Proposed Changes

修改文件：
- [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)

### 1) 将工具条从 `#roof-viewport` 内移除

- 删除/移动 `#roof-viewport` 内部的这段 DOM：
  - `div.absolute.left-2.right-2.top-2 ...`（包含 `roof-tool-mode / roof-lock-* / roof-show-rulers / roof-snap-magnet`）
- 关键约束：
  - **保留现有控件 id 不变**（`roof-tool-mode`, `roof-lock-scale`, `roof-lock-move`, `roof-show-rulers`, `roof-snap-magnet`），避免改动 `syncRoofUIFromState()` / `updateRoofSettingsFromUI()` 及 `setRoofEditorEnabled()` 的启用逻辑。

### 2) 在「测距/网格」与 ROOF IMAGE AREA 之间新增工具条容器

- 在布局结构中，`roof-editor-grid` 之前新增一个工具条区域（位于控件卡片 grid 与 roof-editor-grid 之间）。
  - 现状可定位的插入点：
    - 控件区域结束：[index.html:L747-L847](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L747-L847)
    - `roof-editor-grid` 开始：[index.html:L849](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L849)
- 新工具条容器建议样式（不引入新依赖）：
  - `no-print flex flex-wrap items-center gap-3`
  - 背景：`bg-white/90 backdrop-blur border border-slate-200 rounded-lg`
  - 位置与对齐：
    - 放置在 `roof-editor-grid` 上方
    - 通过 `pl-[20px]` 或 `ml-[20px]` 与 `roof-editor-grid` 的 20px 参考轴区域对齐，让工具条靠近网格边缘（满足你“靠着网格边缘”的要求）

### 3) 可用性验证点（无需改 JS）

- 工具条移出 `#roof-viewport` 后，将不再触发 viewport 的 pointerdown `preventDefault`，从而恢复：
  - `<select>` 可下拉
  - `<checkbox>` 可点击切换
- 由于 id 不变，现有函数无需改动：
  - `syncRoofUIFromState()`（回填状态）
  - `updateRoofSettingsFromUI()`（写回状态并渲染）
  - `setRoofEditorEnabled()`（启用/禁用控件）

## Assumptions & Decisions

- 本次修复以「移动 DOM 到 viewport 外」为主，不改 `pointerdown` 编辑逻辑（避免引入新的编辑回归）。
- 工具条最终位置以“测距/网格与 ROOF IMAGE AREA 中间空白区域”作为唯一固定点，且在视觉上贴近屋顶网格边缘（与 `roof-editor-grid` 的边缘对齐）。

## Verification

1. 切到第 5 页 Roof 编辑器后：
   - 工具条位于「测距/网格」卡片下方、屋顶图上方的空白区域，不覆盖 ROOF IMAGE AREA。
2. 交互可用性：
   - `roof-tool-mode` 下拉可正常打开并切换模式；
   - 缩放锁定/移动锁定/标尺/磁吸 checkbox 可正常点击；
   - 不会触发画布的拖拽/框选误操作。
3. 功能回归：
   - 各模式下屋顶编辑交互（选择组件、选择标注、测距、面积）不受影响。

