## Summary

本计划针对 Site Overview（第 5 页）实现 4 项交互增强：
1. 单选组件时，将该组件尺寸回显到 `Module (m)` 的宽高输入框中，便于查看当前选中组件大小；多选时不改变输入框。同时按你的选择 **“同时显示两套”**：输入框保持“原始规格 wM/hM”，新增只读显示“显示尺寸(旋转后)”。
2. 删除“网格吸附”（UI 与逻辑完全移除）。
3. 增加“缩放锁定”开关：选中后所有组件不能缩放（默认不选）。
4. 增加“移动锁定”开关：选中后所有组件不能移动（默认不选；包含拖动与方向键微调）。

## Current State Analysis (Grounded)

### Module 输入与选中逻辑

- Module 宽高输入框：
  - `#module-width-m` / `#module-height-m` 位于工具栏右侧：[index.html:L734-L747](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L734-L747)
- 单选/多选由 `roofSelection` 控制，点击模块时会更新 selection 并 `renderModules()`：
  - [index.html:L9820-L9855](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9820-L9855)
- 当前输入框只用于修改默认 module 尺寸（新增组件尺寸），不会随选中组件变化。
- 显示尺寸（旋转后的宽高）已有可用工具函数 `getModuleDimsM(m)`（rot=90 会交换）：
  - `getModuleDimsM` 在 Site Overview 脚本区定义（与 `getModuleQtyFromUI` 同区域）。

### 网格吸附现状

- UI：`#roof-snap-grid` 复选框存在且默认选中：[index.html:L760-L771](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L760-L771)
- settings：`siteOverview.settings.snapGrid` 存在：[index.html:L8966-L8973](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L8966-L8973)
- 吸附逻辑：`applySnappingForMove()` 仍读取 `snapGrid` 并在单模块时执行网格吸附：[index.html:L9510-L9603](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9510-L9603)

### 缩放/移动入口

- 缩放：pointerdown 命中 `.resize-handle` 后进入 `roofResize`：[index.html:L9833-L9845](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9833-L9845)
- 移动：pointerdown 命中模块主体后进入 `roofDrag`；以及方向键微调会移动 selection：
  - 拖动入口：[index.html:L9847-L9855](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9847-L9855)
  - 方向键微调：在 document keydown 内（Site Overview 逻辑区）

## Decisions (from user)

- 尺寸回显：**同时显示两套**（输入框显示原始规格，另加“显示尺寸(旋转后)”只读值）。

## Proposed Changes

修改文件：
- [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)

### 1) 单选组件尺寸回显（两套显示）

#### 1.1 UI：新增“显示尺寸(旋转后)”只读显示

- 在 Module 输入框后新增两段只读展示（不使用注释）：
  - `Display W (m)`：只读 `<span id="module-display-w"></span>`
  - `Display H (m)`：只读 `<span id="module-display-h"></span>`

#### 1.2 逻辑：新增 `syncModuleUIFromSelection()`

- 行为：
  - 当 `roofSelection.size === 1`：
    - 找到选中模块 `m`
    - 将 `#module-width-m/#module-height-m` 设置为 `m.wM/m.hM`（原始规格）
    - 将显示尺寸设置为 `getModuleDimsM(m)` 的 `wM/hM`（旋转后）
  - 当 size != 1：不改输入框；但可以清空/保留 display 值（推荐清空为 `--`，避免误解）
- 注意避免触发 `updateRoofDimensionsFromUI()` 的副作用（不要 dispatch input/change）。

#### 1.3 触发时机

- 在 pointerdown 选择更新并 `renderModules()` 后调用一次 `syncModuleUIFromSelection()`（仅在 Select 模式且确实点到模块时）。
- 在 `roofResize` 的 pointerup（缩放结束）后也调用一次（保证缩放后尺寸显示准确）。
- 旋转按钮 `rotateSelectedPVModules()` 执行后若单选，也调用一次。

验收：
- 单击任意组件：Module 输入框会变成该组件“原始规格”；旁边显示“显示尺寸(旋转后)”。
- 多选或空选：Module 输入框不变；显示尺寸为 `--`（或空）。

### 2) 删除网格吸附

#### 2.1 UI 删除

- 移除 `#roof-snap-grid` 的 checkbox 与文案“网格吸附”。

#### 2.2 settings 与逻辑删除

- 从 `getDefaultSiteOverview().settings` 移除 `snapGrid`。
- 从 `syncRoofUIFromState()` / `updateRoofSettingsFromUI()` / `setRoofEditorEnabled()` 移除 `roof-snap-grid` 相关读写与禁用处理。
- 从 `applySnappingForMove()` 中移除 grid snap 分支（只保留磁力吸附；必要时可保留仅用于“网格显示”的 gridStepM，但不再用于吸附）。
- 对旧数据兼容：
  - 加载 snapshot 时即便存在 `snapGrid` 字段也忽略，不影响渲染。

验收：
- 页面不再出现“网格吸附”选项。
- 拖动模块不再出现网格对齐吸附行为（仅磁力吸附生效）。

### 3) 增加“缩放锁定”（默认关闭）

#### 3.1 UI

- 在工具栏增加 checkbox：
  - `#roof-lock-scale` 文案“缩放锁定”

#### 3.2 数据与持久化

- 在 `siteOverview.settings` 增加 `lockScale: false` 默认值。
- `updateRoofSettingsFromUI()` 读取该值并保存；`syncRoofUIFromState()` 回显。
- snapshot 保存/加载 `siteOverview` 已整体持久化，字段随之保存即可。

#### 3.3 生效点

- 在 pointerdown 命中 `.resize-handle` 分支前判断：
  - 若 `siteOverview.settings.lockScale === true`：直接 return（可提示 toast “已开启缩放锁定”）。
- 在 legacy 模式（pvModules）如仍允许缩放，也同样阻止（保持一致）。

验收：
- 勾选“缩放锁定”后，右下角缩放手柄无法触发缩放；取消后恢复。

### 4) 增加“移动锁定”（默认关闭）

#### 4.1 UI

- 增加 checkbox：
  - `#roof-lock-move` 文案“移动锁定”

#### 4.2 数据与持久化

- 在 `siteOverview.settings` 增加 `lockMove: false` 默认值。
- `updateRoofSettingsFromUI()` / `syncRoofUIFromState()` 支持读写与回显。

#### 4.3 生效点

- 在 pointerdown 进入 `roofDrag` 之前判断：
  - 若 `lockMove` 为 true：不进入拖动（可 toast “已开启移动锁定”）。
- 在方向键微调（Arrow keys）逻辑里加判断：
  - 若 `lockMove` 为 true：不执行微调。

验收：
- 勾选“移动锁定”后，组件无法拖动、无法方向键微调；取消后恢复。

## Assumptions & Notes

- “多选时不变”解释为：当 `roofSelection.size !== 1`，不覆写 `#module-width-m/#module-height-m`，以避免批量选择时界面跳动。
- “显示尺寸(旋转后)”仅展示，不参与输入；用户若想修改选中组件尺寸，仍通过缩放手柄实现。

## Verification

1. 尺寸回显
   - 单选：Module 输入显示为该组件原始 wM/hM；显示尺寸为旋转后 w/h。
   - 多选：Module 输入不变；显示尺寸为 `--`。
2. 删除网格吸附
   - UI 无“网格吸附”；拖动不再网格吸附。
3. 缩放锁定
   - 开启后无法缩放；关闭后可缩放。
4. 移动锁定
   - 开启后无法拖动与方向键微调；关闭后恢复。

