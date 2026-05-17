## Summary

在 Site Overview（第 5 页）实现两项改动：
1. “旋转 90°”改为**真实可见的旋转**：组件内部的 PV 文本与紫色“V”连线随 `rotDeg` 旋转（而不是仅交换宽高数值）。
2. 将 `Display` 后的两个尺寸从只读改为**可编辑输入框**：通过编辑这两项（旋转后的显示宽/高）来修改当前单选组件的大小；多选时不允许编辑。

## Current State Analysis (Grounded)

- 旋转按钮只修改 `m.rotDeg`，并在 `getModuleDimsM(m)` 中通过交换 `wM/hM` 来影响外框尺寸，但 `renderModules()` 中：
  - `div.style.transform = ''`，内部 SVG/文本没有任何旋转，所以用户看到 “PV 与 V 线条没有旋转”：
  - [renderModules](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9695-L9727)
  - [rotateSelectedPVModules](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L10257-L10269)
- Display 目前是两个 `<span id="module-display-w/h">`，只显示，不可编辑：
  - [index.html:L739-L747](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L739-L747)
- 单选回显逻辑在 `syncModuleUIFromSelection()`，目前会写 Module 输入框与 Display span：
  - [syncModuleUIFromSelection](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9009-L9039)

## Proposed Changes

修改文件：
- [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)

### 1) 真实旋转：仅旋转“内部内容层”，保持现有外框/碰撞/吸附逻辑不变

目标：
- 不改变现有“轴对齐 bbox + swap 尺寸”的布局方式（保持拖动、缩放、吸附、测量、框选等逻辑稳定）。
- 让用户视觉上看到旋转：PV 字符与内部 V 线条随着 `rotDeg` 旋转 90°。

实现方案：
1. 在 pv-module 内新增一个内容容器（例如 `.pv-module-content`），将 SVG 与 label 包裹进去：
   - `<div class="pv-module-content"> ...svg... label... </div>`
2. `renderModules()` 中根据 `m.rotDeg` 给 `.pv-module-content` 设置：
   - `transform: rotate(${m.rotDeg}deg); transform-origin: 50% 50%;`
3. 注意保留 `.resize-handle` 与 `.delete-btn` 在最上层，避免被旋转影响命中区域。
4. legacy `pvModules` 分支也做同样包裹（rotDeg 默认为 0，可不处理或保持一致结构）。

验收：
- 点击“旋转 90°”后，组件内部的 PV 与 V 连线明显旋转 90°。

### 2) Display 尺寸改为可编辑：编辑 Display 即修改当前单选组件尺寸

目标：
- 单选时 Display 输入框可编辑，输入即修改该组件大小（米单位）。
- 多选/空选时 Display 禁用并显示 `--`。
- Display 表示“旋转后的显示宽高”，因此写回时需按 rotDeg 做一次反变换。

实现方案：
1. 将 Display 的两个 `<span>` 替换为 `<input type="number">`：
   - `#module-display-w` / `#module-display-h`
   - `step="0.001"`，并用现有样式保持紧凑（text-[11px] + 小宽度）。
2. 新增函数 `updateSelectedModuleDimsFromDisplayUI()`：
   - 仅当 `roofSelection.size === 1` 时生效；
   - 读取 displayW/displayH（正数校验）；
   - 若 `m.rotDeg % 180 === 90`：
     - `m.wM = displayH`
     - `m.hM = displayW`
   - 否则：
     - `m.wM = displayW`
     - `m.hM = displayH`
   - clamp 后 `pushRoofHistory()` 并 `renderRoof()`，再 `syncModuleUIFromSelection()`。
3. 更新 `syncModuleUIFromSelection()`：
   - 单选：Module 输入框继续回显原始 `m.wM/m.hM`；Display 输入框回显 `getModuleDimsM(m)`；
   - 多选/空选：Display 输入框禁用并显示 `--`；不改 Module 输入框。

验收：
- 单选组件时修改 Display W/H，组件立即缩放到对应尺寸；
- 旋转 90° 后修改 Display，依然按“显示宽高”改变（即会正确反写到 wM/hM）；
- 多选时 Display 不可编辑。

## Assumptions & Notes

- “真实旋转”解释为：视觉内容（PV/内部线条）随 rotDeg 旋转；不改变外框 axis-aligned 的编辑模型，以避免引入旋转矩形的命中/碰撞复杂度。
- Display 输入用于改“选中组件尺寸”，Module 输入仍保留“默认规格/或回显原始规格”，不用于直接改选中组件（除非未来再扩展）。

## Verification

1. 旋转验证
   - 添加组件 → 点击“旋转 90°” → PV 与内部 V 连线明显旋转。
2. Display 编辑验证
   - 单选组件，修改 Display W/H：组件外框大小变化符合输入值；
   - rotDeg=90 时修改 Display：组件仍按显示宽高变化且回显一致。
3. 多选限制
   - 选中两个组件：Display 输入禁用并显示 `--`；Module 输入不被覆盖。

