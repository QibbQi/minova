## Summary

在 Site Overview（第 5 页）继续增强组件属性编辑与标注系统，覆盖：

1. 增加“删除标注”按钮：可删除当前选中的单个/多个标注（目前只能清除全部）。
2. 自定义组件（非光伏板）被选中时，Module（m）与文字相关控件同样能编辑该自定义组件（尺寸/文字内容/颜色等）。
3. Module（m）输入改为“输入后勾选确认生效/叉号取消”，解决当前只能通过上下微调才能触发的问题（勾选同时更新新增默认尺寸）。
4. 测距标注气泡：数字显示到小数点后 3 位；支持直接编辑数值以调整线段长度（固定起点 A，移动终点 B）。
5. 选择标注模式：支持拖拽框选多个标注（测距/面积），并可批量删除。
6. 面积测量：新增的面积可被选中/删除/拖动/调整大小。
7. 面积控件升级：可设置背景底色（每个面积独立）；支持“顶点数”生成不规则多边形面积（默认矩形=4 顶点），并可拖动顶点编辑形状与面积。
8. 选择标注模式可同时选择测距与面积控件。

## Current State Analysis (Grounded)

### 标注与选择

- 已有“选择标注”模式 `select_measures`，并有单选状态 `roofMeasureSelectionId`，但仅对 `type:'dist'` 生效：
  - 模式入口与事件命中：[index.html:L10180-L10219](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L10180-L10219)
- 目前只有“清除标注”按钮 `clearRoofMeasurements()`，会清空全部 measurements：
  - UI 按钮：[index.html:L747-L748](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L747-L748)
  - 清空逻辑：[index.html:L9380-L9392](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9380-L9392)

### 测距气泡与格式

- 测距显示格式在 `formatDistanceM()`，目前为 2 位小数并且 <1m 会显示 cm：
  - [index.html:L9404-L9408](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9404-L9408)
- 测距气泡由 `addMeasureLabel()` 生成，是不可编辑的 div 文本：
  - [index.html:L9557-L9573](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9557-L9573)

### 面积测量现状

- `measure_area` 模式通过拖拽生成矩形面积（a/b 两点），创建后只是静态绘制，未进入可选中/可拖动/可编辑顶点的交互：
  - 创建草稿：[index.html:L10246-L10252](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L10246-L10252)
  - 完成写入 measurements：[index.html:L10508-L10520](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L10508-L10520)

### 组件属性编辑现状

- Module（m）尺寸编辑逻辑在 `syncModuleUIFromSelection()` 与 `updateSelectedModuleDimsFromModuleUI()`：
  - [index.html:L9108-L9168](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9108-L9168)
- 目前 Module 输入框为“oninput 立刻应用”，缺乏明确确认/取消动作（用户要求勾叉确认）。
- 自定义组件 `type:'custom'` 已存在，具有 `text/textColor/bgColor` 等字段，但缺少在“属性区”对选中自定义组件的文字内容/颜色进行二次编辑入口：
  - 渲染分支可见：[renderModules](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L10044-L10109)

## Decisions (from user)

- 测距数字编辑：固定起点 A，调整终点 B（沿约束方向或当前方向）。
- 不规则面积创建方式：拖拽外接矩形 + 按“顶点数”生成规则多边形，之后可拖动顶点微调。
- 面积底色：每个面积独立可设置。
- Module 勾选确认：应用到选中组件，同时更新“新增组件默认尺寸”。

## Proposed Changes

修改文件：
- [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)

### 1) 标注选择模型升级：支持多选（dist + area）

新增状态：
- `roofMeasureSelection = new Set<number>()`：当前选中标注集合
- `roofMeasureLasso = { startPx, curPx } | null`：标注框选状态
- 保留 `roofMeasureSelectionId` 作为“主选中项”（= Set 的第一个），用于加粗/属性面板显示

行为规则（select_measures 模式）：
- 点击命中标注：选中单个（清空旧集合）；按住 Shift 则 toggle。
- 空白处按下并拖拽：进入标注框选，松开后把落入框内的 dist/area 加入 selection。
- 键盘 Delete/Backspace：若处于 select_measures 且 selection 非空，删除所选标注；否则维持原逻辑删除组件。

命中/框选的 hit-test：
- dist：使用 a/b 端点+线段 bbox（worldToPx 后）与框选 rect 相交判断。
- area：使用 polygon 的 bbox（见第 6/7 节数据结构）与框选 rect 相交判断。

### 2) 增加“删除标注”按钮（单个/多个）

UI：
- 在左侧动作栏增加按钮 `btn-roof-delete-measure`：删除选中的标注（select_measures 下更常用；其它模式下也可用但需有 selection）。
- 按钮启用/禁用与提示：
  - selection 为空：按钮 disabled 或点击 toast“请先选择标注”
  - selection 非空：删除并 `pushRoofHistory()` + `renderRoof()`

逻辑：
- `deleteSelectedRoofMeasures()`：
  - 从 `siteOverview.measurements` 过滤掉 id 在 `roofMeasureSelection` 内的记录
  - 清空 selection 状态

### 3) Module（m）输入改为“勾/叉确认”

UI 改造（Module 卡片内）：
- Module 宽高输入右侧增加勾/叉（两个小按钮或 icon）：
  - 勾：`applyModuleDimsEdits()`
  - 叉：`cancelModuleDimsEdits()`
- 输入框 oninput 不再直接应用到组件，而是进入“待确认”状态（记录 pending 值，显示勾/叉）。
- 支持 Enter = 勾，Esc = 叉。

数据与逻辑：
- 新增 `roofModuleDimsDraft = { wM, hM } | null`：
  - 用户修改输入框时更新 draft（四舍五入到 3 位）
  - 点击勾：
    - 若单选组件：按 rotDeg 反写到 `m.wM/m.hM` 并 clamp
    - 同时更新 `siteOverview.module.widthM/heightM`（用于新增默认）
    - `pushRoofHistory()` + `renderRoof()` + `syncModuleUIFromSelection()`
  - 点击叉：
    - 丢弃 draft，并 `syncModuleUIFromSelection()` 回填当前选中组件值

边界：
- 多选时：隐藏勾/叉并禁用输入（或只允许修改默认尺寸但不改现有组件；为避免歧义，本计划采用“多选禁用编辑并提示请单选”）。

### 4) 自定义组件也可被 Module/文字控件编辑

#### 4.1 Module（m）

确保选中 `type:'custom'` 时：
- `syncModuleUIFromSelection()` 回填显示其旋转后的显示尺寸
- 勾选确认时同样写回该 custom 组件尺寸

#### 4.2 自定义组件文字内容与颜色编辑

在“文字”卡片内增加“内容”输入框，仅在单选且 `type:'custom'` 时显示：
- `roof-custom-text-edit`：编辑 `m.text`
- `roof-custom-text-color`（颜色选择器，可选）：编辑 `m.textColor`
- `roof-custom-bg-color` + “无背景”：编辑 `m.bgColor`
- 同色限制：若 bgColor 与 textColor 同色则自动纠正 textColor（沿用新增时的规则）

渲染联动：
- 修改后立即 `renderRoof()` 并 `pushRoofHistory()`（或在失焦/回车时提交以减少 history 噪音；本计划采用“失焦/回车提交”）。

### 5) 测距气泡：3 位小数 + 可编辑调整长度

#### 5.1 数值格式

修改 `formatDistanceM()`：
- 统一输出为米单位：`${v.toFixed(3)}m`（三位小数）
- 不再用 cm 显示（满足“取到小数点后三位数”的一致性）

#### 5.2 气泡可编辑（选中时）

改造 `addMeasureLabel()`：
- 当处于 `select_measures`，且该 label 关联的 `mid` 属于当前 selection：
  - 用 `<input type="number" step="0.001">` 替代纯文本 div
  - 显示当前长度（m，三位小数）
  - Enter/blur 提交：调用 `updateDistMeasureLength(mid, newLenM)`

`updateDistMeasureLength(mid, newLenM)` 规则（用户确认）：
- 固定 A 点：
  - horizontal：B.x = A.x + newLenM（方向取原向量符号，若原为 0 则默认 +）
  - vertical：B.y = A.y + newLenM（同上）
  - free：沿当前向量方向调整（单位向量 * newLenM），若原长度 0 则默认水平向右
- 调整后对 B 执行 `snapMeasurePointToModulesEx()`（保留 0.05m 留距）并更新辅助线
- `pushRoofHistory()` + `renderRoof()`

### 6) 面积测量可选中/删除/拖动/调整大小

#### 6.1 数据结构统一

将 `type:'area'` measurement 统一为：
- `{ id, type:'area', points:[{xM,yM}...], bgColor, ... }`

兼容旧数据：
- 若存在 `a/b` 而无 `points`：渲染与交互前将其视作 4 点矩形 points（不写回也可；写回可在首次编辑时转换）。

#### 6.2 渲染

在 `renderRoofMeasurements()`：
- area 绘制 polygon（SVG `<polygon>`），填充色来自 `m.bgColor`（alpha 固定如 0.25 或随一个全局透明度）
- 绘制顶点 handle（小圆点或十字），每个顶点带 `data-mid` + `data-role="v0/v1..."`，用于拖动
- area 被选中时高亮边框（stroke 更粗或加虚线）

#### 6.3 交互（select_measures）

命中规则：
- 点击 polygon 内部：选中该 area，并进入整体拖动（role='all'）
- 点击顶点 handle：选中该 area，并进入顶点拖动（role='v{i}'）

拖动行为：
- role='all'：平移所有 points
- role='v{i}'：仅移动该点；必要时 clamp 到 roof 范围

删除：
- deleteSelectedRoofMeasures() 支持删 dist 与 area

### 7) 面积控件升级：背景底色 + 顶点数生成不规则面积 + 顶点可拖动

在右侧“测距/网格”卡片或新卡片 “面积” 中增加：
- 面积背景色选择器（仅在选中 area 时显示，写入该 area 的 `bgColor`）
- “顶点数”输入（min 4，max 12，默认 4）用于 **新建面积** 时决定 points 数

创建逻辑（measure_area）：
- 仍沿用“拖拽框”交互；
- pointerup 时：
  - 若顶点数 = 4：生成矩形 points（四角）
  - 若顶点数 > 4：以拖拽矩形中心为圆心，取 `r = min(w,h)/2` 生成规则 n 边形 points
  - 写入 measurement：`{id, type:'area', points, bgColor: currentAreaBgColor }`

备注：创建后用户可在 select_measures 中拖动顶点把规则多边形变成不规则形状（满足“不规则面积”）。

### 8) 选择标注模式覆盖测距+面积

将 select_measures 的命中：
- 从仅 `type:'dist'` 扩展为 `type:'dist' | 'area'`
- 框选同样覆盖两类

## Verification

1. 删除标注：
   - 选择单个 dist/area 后点击“删除标注”能删除该标注，不影响组件；
   - 框选多个标注后可一次删除；
   - Delete/Backspace 在“选择标注”模式下优先删除标注。
2. Module 勾叉：
   - 输入新尺寸后不立即生效；点勾后生效，点叉后恢复；
   - 勾选会同步更新新增默认尺寸；
   - 自定义组件选中时同样可用。
3. 自定义组件文字编辑：
   - 选中 custom 后可改文字内容/字体色/背景色；
   - 背景与字体同色会被自动纠正。
4. 测距气泡编辑：
   - 距离显示为 3 位小数；
   - 编辑距离后，固定 A 调整 B，约束模式下只沿对应轴变化；
   - 终点吸附与辅助线仍生效。
5. 框选标注：
   - “选择标注”模式下拖拽框选可以选中多个 dist 与 area；
   - 选中态高亮清晰。
6. 面积控件：
   - 新建面积可被选中、拖动整体、拖动顶点；
   - 可单独设置该面积背景色；
   - 顶点数>4 时创建为规则多边形，之后可拖动顶点形成不规则面积。

