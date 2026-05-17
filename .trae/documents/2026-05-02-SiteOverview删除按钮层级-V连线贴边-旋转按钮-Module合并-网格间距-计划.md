## Summary

在 Site Overview（第 5 页）完成以下 UI/交互修正：
1. 组件被选中时，右上角删除按钮始终处于最上层（可点击、不被内容层遮挡）。
2. 修复旋转后“V 型连线离开外框”的问题：保证 V 连线始终贴合外边框，随旋转正确变化且不跑出外框。
3. 旋转按钮改为：顺时针旋转 90°（可连续 90° 累加 0→90→180→270→0），并新增逆时针旋转 90° 按钮（同样可连续累加）。
4. Opacity 拉杆移动到工具栏下方（第二行）。
5. Module (m) 输入限制显示为小数点后 3 位；并合并 Module/Display 功能：
   - 删除 Display；
   - Module (m) 在单选时显示“旋转后的显示尺寸”，编辑即可改变当前选中组件大小；
   - Module 值会被记住并作为新增组件的默认尺寸（与用户确认一致）。
6. 网格间距下拉删除 0.1m/0.2m/0.5m，并将默认值设为 1m（与用户确认一致）。

## Current State Analysis (Grounded)

- 删除按钮为 `.delete-btn`，目前无 z-index，且组件内部存在带 `transform` 的内容层（`.pv-module-content`），可能造成层叠上下文/点击区域问题。
  - 样式：[index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)
- 旋转目前通过 `m.rotDeg` + `getModuleDimsM(m)`（交换宽高）影响外框；内部内容此前通过旋转容器实现，但 V 线条在非正方形外框下会出现溢出/不贴边问题。
  - [renderModules](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9695-L9727)
- 旋转函数当前 `((rotDeg)+90)%180`，导致只能在 0/90 间切换，无法连续旋转。
  - [rotateSelectedPVModules](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L10257-L10269)
- Display 目前为输入框并直接改选中组件尺寸；用户希望删除 Display，将其能力合并进 Module。
  - Module/Display 区域：[index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L734-L748)

## Decisions (from user)

- 删除 Display 后，Module 显示并编辑“旋转后的显示尺寸”。
- Module 作为新增组件默认尺寸。
- 网格间距默认 1m，并移除 0.1/0.2/0.5。

## Proposed Changes

修改文件：
- [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)

### 1) 删除按钮层级置顶

1. CSS 为 `.pv-module .delete-btn` 增加 `z-index`（例如 30）。
2. 为 `.resize-handle` 设置较低 `z-index`（例如 20），内容层更低（例如 0）。
3. 选中时删除按钮保持可见（可选：仅选中时 `opacity:1`，否则 hover 才显示；按用户体验决定）。

验收：
- 选中任意组件，右上角删除按钮始终在最上层且可点击。

### 2) V 型连线贴边：用“按 rotDeg 计算端点坐标”替代整体旋转

核心思路：
- 不对 SVG 整体做 rotate（会在非正方形时产生溢出/贴边失效）；
- 直接在 SVG 的 0..100 坐标系内，按 rotDeg 计算 3 个关键点（两个底角 + 顶点）旋转后的坐标，并绘制两条线段。

实现步骤：
1. 新增工具函数：
   - `rotatePoint(x, y, deg, cx=50, cy=50)`（deg 仅取 0/90/180/270）
2. 在 `renderModules()` 中为每个模块生成 SVG 时：
   - 原始点：A(0,100) B(100,100) C(50,0)
   - 将 A/B/C 旋转到对应 deg 后得到 A’/B’/C’
   - SVG 使用 `preserveAspectRatio="none"` 保持贴边
3. PV 文本旋转：
   - 仅对 `.pv-module-label` 做 `transform: rotate(deg)`（居中旋转不会溢出）

验收：
- 任意长宽比下，旋转后 V 线条始终紧贴外框边缘，不出现离开外框的情况。

### 3) 旋转按钮：顺/逆时针 + 连续旋转

1. UI：
   - 原“旋转 90°”改名为“顺时针 90°”
   - 新增按钮“逆时针 90°”
2. 逻辑：
   - 新增 `rotateSelectedPVModulesBy(deltaDeg)`，deltaDeg 为 +90 或 -90
   - `m.rotDeg = (m.rotDeg + deltaDeg + 360) % 360`（支持 0/90/180/270）
3. 现有 `getModuleDimsM(m)`：
   - 仍以 `rotDeg % 180` 决定是否交换外框尺寸（保持 axis-aligned 编辑模型）

验收：
- 连续点击顺时针/逆时针按钮可持续旋转 90° 累加，不会“恢复”。

### 4) Opacity 拉杆移到第二行工具栏

1. 从第一行（Module/Qty 旁）移除 Opacity。
2. 在第二行（工具/锁定/吸附等）中加入 Opacity，并保持原 oninput 行为不变。

验收：
- UI 位置符合需求且功能不变。

### 5) Module 小数 3 位 + 合并 Module/Display（删除 Display）

1. UI：
   - 删除 Display 两个输入框
   - Module 两个输入框继续保留，并设置 `step="0.001"`（已存在）+ 显示 3 位（通过赋值时 `toFixed(3)`）。
2. 单选回显：
   - `syncModuleUIFromSelection()` 在 `roofSelection.size===1` 时，将 Module 输入框显示为 `getModuleDimsM(m)`（旋转后的显示尺寸，按用户确认）。
3. 编辑改变选中组件尺寸：
   - 新增/改造 `updateSelectedModuleDimsFromModuleUI()`：
     - 若单选：读取 Module 输入（displayW/displayH 语义）并按 rotDeg 反写到 `m.wM/m.hM`
     - 同时更新 `siteOverview.module.widthM/heightM` 作为新增默认尺寸（按用户确认）
4. 多选/空选：
   - Module 输入不再被覆盖（保持“上次选中值”），但编辑时不作用于组件（可 toast 提示“请单选组件调整尺寸”）。

验收：
- 单选组件时 Module 显示旋转后的尺寸且可编辑，编辑后组件大小变化正确。
- 取消选中/多选时 Module 保留上次单选数值。
- 新增组件使用当前 Module 数值作为默认尺寸。

### 6) 网格间距移除 0.1/0.2/0.5，默认 1m

1. 下拉选项删除 0.1/0.2/0.5。
2. 默认选中 1m，并在 `getDefaultSiteOverview().settings.gridStepM` 中默认值改为 1。

验收：
- 下拉中不再出现 0.1/0.2/0.5；默认 1m。

## Verification

1. 删除按钮层级：选中组件后删除按钮可见且可点击（不被旋转内容遮挡）。
2. V 贴边：对长宽比差异较大的组件，连续旋转 0/90/180/270，V 线条始终贴边。
3. 旋转按钮：顺/逆时针连续点击均按 90° 累加，不回退。
4. Module 合并：
   - 单选：Module 显示旋转后尺寸（3 位小数），编辑可改该组件大小；
   - 多选：Module 不变化；
   - 新增组件：继承 Module 当前值。
5. 网格间距：选项与默认值正确。

