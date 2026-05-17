## Summary

本计划针对 Site Overview（第 5 页 Roof 编辑器）完成 4 项需求：

1. 撤销/重做覆盖图片区域内所有操作（组件 + 标注）；“清除标注”“清除全部”增加确认弹窗。
2. 测距标注不允许键盘输入，仅允许点击上下步进调节（避免指针变成输入光标引发闪烁）。
3. 测距颜色调整后，新建的第一条距离使用调整后的颜色（不再回落到默认色）。
4. 进入测距模式后，鼠标在图片区域移动时显示“虚拟端点”跟随并吸附，提前显示磁吸虚线辅助对齐（无需点击就能预览对齐）。

## Current State Analysis (Grounded)

### A) Undo/Redo 仅覆盖模块，不含标注

- 历史快照由 [pushRoofHistory](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9715-L9726) 生成，目前只保存：
  - `roof/module/modules/settings`
- `siteOverview.measurements` 没有进入快照，因此 [undoRoofEdit/redoRoofEdit](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9740-L9753) 无法回滚“标注/测距/面积”等操作。

### B) 清除标注 / 清除全部无确认

- 清除标注：[clearRoofMeasurements](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L10117-L10128) 直接清空。
- 清除全部：[clearRoof](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L12631)（附近）直接执行，未做确认。

### C) 测距编辑与闪烁/指针样式

- 距离可编辑输入框由 [addMeasureLabel](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L10688-L10776) 生成，目前为 `input type=number`，支持键盘输入，鼠标悬停会出现文本输入光标（I-beam），用户反馈可能与闪烁有关。

### D) 新建第一条距离颜色不跟随 UI

- `roof-dist-color` 目前是 `onchange="updateRoofSettingsFromUI()"`，如果用户在颜色选择器里选完颜色后直接开始测距（未触发 change），则 `siteOverview.settings.distColor` 仍是旧值。
- 测距起点点击时读取 `siteOverview.settings.distColor`：
  - [measure_dist pointerdown](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L11654-L11692)

### E) 测距“虚拟端点预览”目前不存在

- 当前只有在第一次点击后才创建 `roofMeasureDraft` 并在 pointermove 中更新 b 点、计算磁吸虚线，再 `renderRoofMeasurements()`。
- 没有“未点击前的 hover 吸附端点 + 虚线对齐预览”状态。

## Assumptions & Decisions

- 确认弹窗实现：采用原生 `window.confirm()`（满足“弹窗提醒、确认后执行”的要求，且无需引入额外 UI 组件）。
- “仅允许点击上下调节，不能输入数字”实现：
  - 仍保留 number input 的 stepper（浏览器自带上下按钮）；
  - 禁止键盘输入（keydown 全拦截数字/退格等），并设置 `readOnly + caretColor: transparent + cursor: ns-resize`，避免出现文本输入光标；
  - 仍允许 Tab 切换焦点（可选）。
- “虚拟端点预览”范围：
  - 仅在 `roofToolMode === 'measure_dist'` 且 `roofMeasureDraft === null` 时启用；
  - 吸附规则与正式测距一致（corner/edge、Cross offset=0、磁吸虚线同色同样式）。

## Proposed Changes

修改文件：
- [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)

### 1) Undo/Redo 覆盖标注与背景（图片区域全量）

1. 扩展 `pushRoofHistory()` 快照字段：
   - 增加 `measurements: deepClone(siteOverview.measurements || [])`
   - 增加 `roofBackground`（全局变量）以覆盖“清除全部/上传背景”等图片区操作
2. 扩展 `applyRoofHistoryState(state)`：
   - 恢复 `roofBackground`
   - 恢复 `siteOverview.measurements`
   - 清理交互态：`roofMeasureDraft/roofMeasureDrag/roofMeasureSelection/roofMeasureSnapLines/...` 置空，避免恢复后残留拖拽状态
3. 确保以下路径在修改标注数组后都有 `pushRoofHistory()`：
   - 新建/删除/拖拽/编辑距离与面积
   - 清除标注

### 2) 清除标注 / 清除全部增加确认弹窗

1. 将按钮行为改为“带确认的 wrapper”：
   - `clearRoofMeasurements()` 改为 `window.clearRoofMeasurements()` 并在内部先 `confirm`；
   - `window.clearRoof()` 同理。
2. 文案：
   - 清除标注：`确认清除所有标注？`
   - 清除全部：`确认清除全部（背景图、组件、标注）？`
   - 若需要英文模式，复用现有语言切换状态输出对应英文（本次可先用中文固定文案，或加入 i18n key）。

### 3) 测距标注只允许步进，不允许输入

在 `addMeasureLabel` 的 dist input 创建逻辑中：

1. 禁止键盘输入：
   - `input.readOnly = true`
   - `input.style.caretColor = 'transparent'`
   - `input.style.cursor = 'ns-resize'`（避免 I-beam）
   - `keydown` 事件：除 Tab 外全部 `preventDefault()`（或仅允许 ArrowUp/ArrowDown 也可）
2. 仅通过 stepper 触发数值变化：
   - 保留 `input.step = '0.001'`
   - `input` 事件仍调用 `updateDistMeasureLengthInternal(mid, value, false)` 做即时预览，不触发全量重渲染
3. 解决 history 记录：
   - 用 debounce（如 250–400ms）在最后一次 step 结束后调用 `pushRoofHistory()`（不调用 render），从而：
     - 连续点击不会生成过多历史点
     - Undo/Redo 仍能回退到最近一次调整

### 4) 测距颜色：保证第一条使用最新颜色

双保险：

1. 将 `roof-dist-color` 的事件从 `onchange` 改为 `oninput`（颜色选择器拖动/点选时立即同步到 settings）。
2. 在 `measure_dist` 的 pointerdown 创建 draft 时，颜色读取优先用 DOM 值：
   - `const color = String(document.getElementById('roof-dist-color')?.value || siteOverview.settings.distColor || '#582C83');`
   - 同步写回 `siteOverview.settings.distColor = color`，确保后续一致

### 5) 测距 hover 虚拟端点 + 磁吸虚线预览（点击前可见）

1. 新增状态：
   - `let roofMeasureHover = null;` 形如 `{ p:{xM,yM}, markerStyle, color }`
2. 在 viewport `pointermove` 中新增分支：
   - 条件：`roofToolMode === 'measure_dist' && !roofMeasureDraft && !roofMeasureDrag`
   - 计算流程：
     - `roofMeasureSnapLines = []`
     - `markerStyle = siteOverview.settings.distMarkerStyle`
     - `offsetM = markerStyle==='cross' ? 0 : siteOverview.settings.distSnapOffsetM`
     - `w0 = clampWorldToRoof(pxPointToWorld(pos))`
     - 若 `snapMagnet` 开启：优先走 `snapMeasurePointToCornersEx(w0, offsetM)`，否则 `snapMeasurePointToModulesEx(w0, offsetM)`
     - 若命中 snap：调用 `addOrthoSnapLines(edgePoint/corner, snappedPoint, axis, color)` 生成虚线
     - 设置 `roofMeasureHover = { p: snappedPoint, markerStyle, color }`
     - `renderRoofMeasurements()`
3. 在 `renderRoofMeasurements()` 中绘制 hover 端点：
   - 当 `roofMeasureHover` 存在且 `roofMeasureDraft` 不存在时：
     - `drawMarker(worldToPx(hover.p), markerStyle, rgba(color, alpha), '', 'hover')`
     - 注意 `data-mid` 传空，避免被 pointerdown 当作可拖拽标注
4. 清理时机：
   - pointerleave/切换工具模式/开始 draft 后，将 `roofMeasureHover = null` 且清空 `roofMeasureSnapLines`

## Verification

1. Undo/Redo：
   - 新建标注、移动标注、删除标注、编辑距离长度 → Undo/Redo 都能回滚
   - 清除标注、清除全部 → Undo 可恢复
2. 清除确认：
   - 点击“清除标注/清除全部”会弹 confirm；取消不执行；确认才执行
3. 测距仅步进：
   - 标注数值无法键盘输入（无 I-beam），只能点上下按钮，每次步进 0.001
   - 编辑过程中不闪烁
4. 首条颜色：
   - 调整颜色后立即开始测距，新建第一条距离颜色正确
5. Hover 预览：
   - 进入测距模式后，鼠标移动即出现虚拟端点与磁吸虚线；点击时起点落在预览点位
6. 基础校验：
   - `python3 check_js.py index.html` 通过
   - 控制台无新增运行时错误（忽略既有 state.json 网络报错）

