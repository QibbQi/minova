## Summary

在 SITE OVERVIEW（第 5 页）对 UI 做一次以“工程/CAD 操作效率”为目标的布局微调：

1. 将“测距/网格”卡片改名为“测距/面积”，并把“测距控制”放上半、“面积控制”放下半，用分割线隔开。
2. 在“顶点数”数字控件前补充“顶点”说明。
3. 面积透明度数字控件以百分比（%）显示与输入（内部仍以 0~1 存储）。
4. 将网格控件（`roof-grid-step`）从卡片移到“模式/开关”工具条中。
5. 左侧动作栏：将复制/删除、左转90°/右转90°两组按钮各压缩成一行（2 列网格），由 4 行变 2 行。
6. “Module / 文字 / 测距/面积”卡片内不同功能间用浅色的 `|` 分隔。
7. 隐藏“比例模式”动作键（`btn-roof-convert`）。

## Current State Analysis (Grounded)

- “测距/网格”卡片当前同时包含测距与面积与网格控件，未分区：
  - [index.html:L797-L845](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L797-L845)
- 网格控件当前在卡片中（`roof-grid-step`），而模式/开关工具条中仅包含模式与锁定/标尺/磁吸：
  - 卡片内网格：[index.html:L832-L843](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L832-L843)
  - 工具条：[index.html:L849-L877](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L849-L877)
- 面积透明度目前为 0.05~1 的小数输入（`roof-area-opacity-num`），没有 %：
  - [index.html:L820-L822](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L820-L822)
- 左侧动作栏复制/删除/两种旋转为 4 个独立按钮，纵向占 4 行：
  - [index.html:L733-L736](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L733-L736)
- “比例模式”按钮存在：
  - [index.html:L744](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L744)

## Proposed Changes

修改文件：
- [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)

### 1) “测距/面积”卡片重排（上测距、下面积）

在当前卡片 `div.text-xs.font-black ...` 处：
- 标题由“测距/网格”改为“测距/面积”。
- 将 `div.flex.flex-wrap...` 内内容拆成两段：
  - **上半部分（测距）**：颜色 / 端点 / 约束
  - **分割线**：`div class="w-full border-t border-slate-100 my-2"`
  - **下半部分（面积）**：底色 / 顶点 / 透明度(%) / 底纹 / 文字

### 2) 顶点数前增加“顶点”

把面积顶点输入改为：
- `span` 文案：`顶点`
- 保留输入 id：`roof-area-vertex-count`（保证现有 `updateRoofSettingsFromUI()` 读取不变）

### 3) 面积透明度输入改为百分比（%）

目标：UI 显示/输入为 5~100（%），存储仍为 0.05~1（float）。

#### 3.1 UI

- `roof-area-opacity` range：min=5 max=100 step=1 value=18（表示 18%）
- `roof-area-opacity-num` number：min=5 max=100 step=1 value=18
- 在数字框右侧追加一个浅色 `%`（作为视觉单位），例如：
  - `span class="text-[11px] font-bold text-slate-300 select-none">%</span`

#### 3.2 JS（现有函数基础上做换算）

需要调整 4 个位置，让它们理解“百分比 UI”：

- `syncRoofUIFromState()`：
  - 读取 area opacity（selectedArea 或 default）的 0~1 值 `op`
  - 写入控件为 `Math.round(op * 100)`（5~100）
- `updateRoofSettingsFromUI()`：
  - 从 UI 读取 `pct = clamp(parseInt(value), 5, 100)`
  - 存储 `areaOpacity = pct / 100`
  - 写回 `settings.areaDefaultOpacity` 与选中 area 的 `m.opacity`
- `syncAreaOpacityNumberFromRange()` / `syncAreaOpacityRangeFromNumber()`：
  - 互相同步时按百分比整数同步（不再用 0~1 小数）

### 4) 网格控件移动到“模式/开关”工具条

- 从“测距/面积”卡片中移除：
  - `span 网格` + `select#roof-grid-step`
- 在工具条（`#roof-tool-mode` 旁）插入网格选择：
  - 展示形态：`|` 分隔后显示 `网格` + `select#roof-grid-step`
- 保持 id `roof-grid-step` 不变，使：
  - `syncRoofUIFromState()` 继续回填
  - `updateRoofSettingsFromUI()` 继续读取并写入 `settings.gridStepM`

### 5) 左侧动作栏按钮压缩为两行

将以下 4 个按钮改为 2 组两列网格：

- 第一行：复制 / 删除（2 列）
- 第二行：左转90° / 右转90°（2 列）

实现方式：
- 用两个 `div class="grid grid-cols-2 gap-2"` 包裹对应按钮。
- 对这 4 个按钮做“缩窄”样式：
  - 文案缩短：`复制`、`删除`、`左90°`、`右90°`
  - padding 改小（例如 `px-2`）并保持图标

### 6) 卡片内使用浅色 `|` 分隔不同功能

对以下卡片内部的 `flex flex-wrap` 行，按功能组插入分隔符：
- Module 卡片：[index.html:L748-L767](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L748-L767)
- 文字卡片：[index.html:L771-L795](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L771-L795)
- 测距/面积卡片（调整后）：在“测距组”与“面积组”的内部功能之间同样用 `|` 分隔

分隔符建议统一为：
- `span class="text-slate-200 font-black select-none">|</span`

### 7) 隐藏“比例模式”动作键

- `btn-roof-convert` 保留 id（避免 JS 查找出错），但增加 `hidden` 类或内联 `style="display:none"`。
- 同时在 `setRoofEditorEnabled()` 的控件 id 列表中保留它也不影响，但如需更干净可移出 ids 数组（本计划默认“只隐藏，不改逻辑列表”，减少回归风险）。

## Assumptions & Decisions

- 百分比透明度 UI 与内部存储分离：UI 使用 5~100 的整数，存储仍用 0.05~1，避免影响渲染函数对 `opacity` 的期望范围。
- 网格控件移动只改 DOM 位置，不改 id，确保既有逻辑（回填/写回/渲染）不需要新增分支。
- `|` 分隔符仅做视觉分隔，不改变布局语义；在空间不足时允许换行，但仍保持分隔符颜色浅，不抢视线。

## Verification

1. “测距/面积”卡片：
   - 标题正确；测距控件在上、面积控件在下，中间有分割线。
   - 顶点数前显示“顶点”。
2. 面积透明度：
   - 数字框显示如 `18` 且旁边有 `%`，拖动滑条会同步数字框；
   - 修改数字框会同步滑条；
   - 新建面积继承默认透明度；选中面积修改透明度仅影响该面积。
3. 网格控件：
   - 不再出现在“测距/面积”卡片；
   - 出现在“模式/开关”工具条中，并可正常改变网格渲染。
4. 左侧动作栏：
   - 复制/删除同一行（两列）；左90°/右90°同一行（两列）；
   - “比例模式”按钮不可见。
5. `|` 分隔符：
   - Module/文字/测距/面积卡片内各功能间有浅色 `|` 分隔，观感一致。

