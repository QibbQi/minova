## Summary

在 Site Overview（第 5 页）中重做“添加光伏板组件”的交互，使其满足：
- **保留右下角正方形缩放手柄用于改变大小**，但该手柄默认**隐藏不可见**（仅作为命中区域存在）。
- **恢复拖动移动**：点击组件非手柄区域应进入拖动（支持单选/多选批量拖动），不再出现“只能缩放无法拖动”的情况。
- **移动与缩放互斥**：缩放只在命中右下角手柄时触发；其它区域只触发移动/选择。

## Current State Analysis (Grounded)

- 当前组件渲染 `renderModules()` 中已移除 `.resize-handle` DOM，只通过 `inResizeCorner()`（右下角 12px 热区）判断是否进入缩放：
  - [renderModules](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9654-L9686)
  - [pointerdown inResizeCorner](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9757-L9852)
- 该热区判定在组件尺寸较小时会覆盖几乎全区域（例如组件像素宽/高 < 12px 时，任何点击都会满足 `r.width - x <= 12 && r.height - y <= 12`），导致用户无法触发拖动，只能进入缩放。
- PDF 打印样式中仍存在 `.pv-module .resize-handle` 的隐藏规则（历史遗留），但目前 DOM 没有手柄元素：
  - [PDF onclone style](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L8327-L8339)

## Proposed Changes

修改文件：
- [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)

### 1) 恢复“右下角正方形缩放手柄”，但默认隐藏

1. 在 `renderModules()` 的组件 innerHTML 中恢复插入：
   - `<div class="resize-handle no-print" data-action="resize"></div>`
2. CSS 调整 `.pv-module .resize-handle`：
   - 固定右下角定位（width/height 10px 或 12px）
   - `opacity: 0`（隐藏方块）
   - `cursor: se-resize`
   - `pointer-events: auto`（确保可命中）
3. Legacy `pvModules` 渲染分支也同步插入该隐藏手柄（保持一致交互）。

验收：
- 右下角看不到白色方块（视觉隐藏），但鼠标移到右下角仍能触发缩放（见第 2 点）。

### 2) 重做 pointerdown 判断：仅命中缩放手柄才进入缩放，其余进入拖动

1. 在 `pointerdown` 的 module 分支中：
   - 判断 `target?.closest?.('[data-action=\"resize\"]')` 是否存在（或 `target.classList.contains('resize-handle')`）
   - 若命中 resize-handle：
     - 单选时进入 `roofResize`
   - 否则：
     - 进入 `roofDrag`（保持现有批量拖动逻辑）
2. 删除/停用 `inResizeCorner()` 这种基于像素宽高的热区判定，避免小组件时误判。

验收：
- 点击组件主体区域：可拖动移动（单选/多选均可）。
- 点击组件右下角（命中隐藏手柄）：进入缩放。
- 同一次 pointer 操作不会同时触发拖动与缩放。

### 3) hover 光标反馈：移动到右下角才显示 se-resize

1. 在 `pointermove` 的非拖动/非缩放状态下：
   - 若 hover 的目标是 `resize-handle`：将对应 `.pv-module` 或手柄设置为 `cursor: se-resize`
   - 否则：`cursor: move`
2. 这样即便手柄不可见，用户仍能通过光标明确知道“此处可缩放”。

验收：
- 右下角出现 `se-resize` 光标，其它区域为 move 光标。

### 4) “添加光伏板组件重做”的范围界定

本次仅对“组件的拖动/缩放命中方式”重做，不改变以下现有能力：
- 批量添加与自动排列（Qty）
- 复制/粘贴/旋转/撤销重做
- 组件样式（紫色半透明、内部连线、PV 居中）
- 其它测量/吸附工具

## Assumptions & Decisions

- 隐藏手柄默认不可见（opacity=0），不在 hover 时显形；通过 cursor 变化提示用户。
- 手柄尺寸固定（10–12px），不会因组件太小而覆盖全组件区域（从根因上避免“只能缩放不能拖动”）。

## Verification

1. 在 Site Overview 上传背景图后添加一个很小的组件（缩放到很小）。
2. 点击组件主体区域：可拖动移动（应不进入缩放）。
3. 移到右下角观察光标变为 `se-resize`，按下拖动：可缩放。
4. 选择多个组件：主体区域拖动应批量移动；右下角缩放仅在单选时允许。

