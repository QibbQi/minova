## Summary

本计划在不引入新依赖、且不改变现有布局骨架（仅替换文案/微调控件排列）的前提下，为 SITE OVERVIEW（第 5 页）完成以下增强：

1. “添加其他组件”弹窗增加图形选择（基础 6 种：矩形、圆形、三角形、菱形、六边形、箭头）。
2. “添加其他组件”弹窗增加“顶点锁定（默认锁定）”，并在 Module 卡片中增加同样选项，用于控制其他组件的等比缩放（锁形状比例）。
3. Module 卡片的 Opacity 滑条右侧增加数字与 `%`（全局透明度，内部仍按 0~1 存储）。
4. 文字控件：将“底色 + 无背景”搬到上半部分、放在“字色”右侧；内容输入仍在下半部分。
5. Site Overview 内所有控件/功能键文案默认英文，并受顶栏 “EN/中” 按钮控制切换为中文；不影响现有布局（不新增会撑开布局的长文本）。

## Current State Analysis (Grounded)

### 其他组件（custom module）现状

- 自定义组件弹窗仅支持：文字、背景色/无背景、字体色：
  - 弹窗 HTML：[index.html:L8706-L8729](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L8706-L8729)
  - 打开/确认逻辑：[openRoofCustomModuleModal / confirmAddRoofCustomModule](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L11443-L11535)
- custom module 渲染为矩形 div；可有底色（bgColor）与文字（text），并有 resize handle：
  - [renderModules](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L10640-L10693)

### 语言切换机制现状

- 全局已有 `currentLang`、`i18n` 与 `updateLanguageLabels()`，通过 `btn-lang` 控制：
  - `currentLang` + `i18n`：[index.html:L3923-L4025](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L3923-L4025)
  - `updateLanguageLabels()`：[index.html:L4280-L4398](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L4280-L4398)
- 目前 `updateLanguageLabels()` 已覆盖页面标题（包括 page5 SITE OVERVIEW），但未覆盖 page5 内部控件文案。

### Module Opacity 现状

- Module 卡片的 Opacity 为 range（0.05~0.9），无数字/% 展示：
  - [index.html:L769-L774](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L769-L774)
- `siteOverview.settings.moduleOpacity` 内部按 0~1 存储并用于渲染：
  - [getDefaultSiteOverview settings.moduleOpacity](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9150)
  - 读写：[syncRoofUIFromState / updateRoofSettingsFromUI](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9450-L9537)

### 文字控件现状

- “文字”卡片上半部分：字号/粗细/字色；下半部分：内容/底色/无背景：
  - [index.html:L773-L800](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L773-L800)

## Decisions (from user)

- 图形预设：基础 6 种（矩形、圆形、三角形、菱形、六边形、箭头）。
- 顶点锁定语义：锁形状比例（锁定后强制等比缩放，保证规则形状不被拉伸）。
- Module 卡片 Opacity 数字：全局透明度（影响 PV 与其他组件渲染透明度）。

## Proposed Changes

修改文件：
- [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)

### 1) “添加其他组件”弹窗：形状选择 + 顶点锁定 + 更紧凑布局

#### 1.1 UI 结构调整（不改变弹窗整体尺寸）

在 `#roof-custom-module-modal` 内：

- 新增 Shape 选择（`select#roof-custom-shape`），选项（value 建议）：
  - `rect` / `circle` / `triangle` / `diamond` / `hex` / `arrow`
- 新增“顶点锁定”复选框（默认勾选）：
  - `input#roof-custom-vertex-lock`（checked 默认 true）
- 布局更紧凑：
  - 使用两列 grid：左侧“文字/形状/顶点锁定”，右侧“颜色区（bg/fg）”
  - 仍保留现有颜色互斥（背景色与字色不能同色）与“无背景”逻辑

#### 1.2 数据结构扩展（custom module）

在 `confirmAddRoofCustomModule()` 创建的 module 对象上新增字段：
- `shape: 'rect' | 'circle' | 'triangle' | 'diamond' | 'hex' | 'arrow'`
- `vertexLocked: boolean`（默认 true）

并在 `openRoofCustomModuleModal()` 初始化：
- shape 默认 `rect`
- vertexLocked 默认 true

#### 1.3 顶点锁定（等比缩放）规则

当 `vertexLocked === true` 且组件为 custom 时：
- 在拖拽 resize handle 的交互逻辑中强制等比缩放：
  - 取 resize 开始时的 `ratio = wM / hM`（若非法则 1）
  - 以用户拖拽后的目标宽/高为基准，调整另一边保持 ratio
- 对“规则形状”（circle/triangle/diamond/hex/arrow）在创建时直接用正方形尺寸（w=h=min(w,h)），保证默认观感正确。
- 对 rect：vertexLocked=true 也按“起始 ratio”保持等比（更符合“锁形状比例”的统一语义）。

### 2) custom module 渲染支持形状

在 `renderModules()` 的 custom 分支中：
- 为每个 custom module 添加一个 shape 层（例如 `div.pv-module-shape`）作为背景图形
- shape 通过 CSS 实现（不引入 svg 资源）：
  - `rect`：默认（无 clip-path）
  - `circle`：`border-radius: 9999px`
  - `triangle`：`clip-path: polygon(50% 0%, 0% 100%, 100% 100%)`
  - `diamond`：`clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)`
  - `hex`：`clip-path: polygon(25% 5%, 75% 5%, 100% 50%, 75% 95%, 25% 95%, 0% 50%)`
  - `arrow`：`clip-path`（短箭头，避免太细导致不可见）
- shape 层填充色来源：
  - `bgColor` 存在则使用 `hexToRgba(bgColor, alpha)`
  - bgColor 为空则透明
- label 层保持现有逻辑（text/textColor/字号/粗细）

### 3) Module 卡片：Opacity 增加数字与 %（全局）

目标：UI 显示/输入为 5~90（%），内部仍为 0.05~0.9。

#### 3.1 UI

在 `#module-opacity` 后新增：
- `input#module-opacity-num`（number，min=5 max=90 step=1）
- `span` 文案：`%`

并为 range 改为：
- min=5 max=90 step=1（UI 层）

#### 3.2 JS

调整 `syncRoofUIFromState()` 与 `updateRoofSettingsFromUI()`：
- 回填时：`pct = round(moduleOpacity * 100)` 写入 range 与 number
- 写回时：从 UI 读 pct，存储 `moduleOpacity = pct / 100`

新增同步函数：
- `syncModuleOpacityNumberFromRange()`
- `syncModuleOpacityRangeFromNumber()`

### 4) 文字卡片：将“底色 + 无背景”搬到上半部分

UI 调整：
- 上半部分（字号 | 粗细 | 字色 | 底色 | 无背景）
- 下半部分仅保留“内容”输入

逻辑调整：
- 复用现有 `applyTextControlsFromUI()` 与 `syncTextControlsFromSelection()` 的字段（仅 DOM 重排，id 不变：`roof-text-bg-color`, `roof-text-bg-none`）

### 5) Site Overview 控件文案：默认英文 + 受 EN/中 切换为中文

#### 5.1 覆盖范围（仅 page5）

需要被切换的文案来源主要包括：
- 左侧动作栏按钮文本（Upload, Add PV, Add Other, Copy, Delete, Rotate, Undo/Redo, Clear/Delete measures, Clear all, …）
- Module/Text/Distance&Area 卡片内各 label（Roof, Module, Qty, Opacity, Font size, Weight, Text color, BG, No BG, …）
- 工具条（Mode, Scale lock, Move lock, Rulers, Snap, Grid）
- 其他组件弹窗（标题、字段 label、按钮 Cancel/Add、形状名、顶点锁定 label）

#### 5.2 实现方式（不影响布局）

- HTML 默认直接写英文短词（避免撑开布局）。
- 对需要切换的文案元素添加稳定定位（推荐用 `id` 或 `data-so-i18n`）：
  - 例如给按钮内部 `<span>` 加 `id="lbl-roof-upload"` 等
- 扩展 `i18n.zh / i18n.en` 增加 `siteOverview` 子对象（或平铺 key），包含上述所有文案短词。
- 在 `updateLanguageLabels()` 末尾增加 `updateSiteOverviewLabels()`：
  - 读取 `const t = i18n[currentLang]`
  - 批量更新这些 id 的 `textContent`
  - modal 的标题/label/button 同样更新

注意：仅替换文本，不改 class，不引入换行 `<br>`，确保布局不受影响。

## Assumptions & Edge Cases

- clip-path 在现代浏览器可用；若极端环境不支持，fallback 为矩形显示（可接受）。
- 顶点锁定的“等比缩放”仅对 custom module 生效；PV 组件仍按现有逻辑缩放。
- 多选时 Module 卡片的“顶点锁定”策略：
  - 若多选且包含 custom：切换时对所有选中的 custom 批量写入 `vertexLocked`
  - 若未选中 custom：写入 `siteOverview.settings.customVertexLockedDefault` 作为新建默认

## Verification

1. 其他组件弹窗：
   - 可选择 6 种形状；默认 rect；
   - 顶点锁定默认勾选；
   - UI 更紧凑且功能不丢（无背景/颜色互斥仍有效）。
2. 形状渲染：
   - 新建 custom 后在画布上呈现对应形状；
   - bgColor 为空时为透明图形；
   - 文字仍居中显示，字色可调。
3. 顶点锁定（等比缩放）：
   - 锁定时拖拽 resize 不会拉伸变形（保持比例）；
   - 取消锁定后允许自由拉伸。
4. Module Opacity：
   - range 与 number 双向同步；
   - 以 % 显示与输入，写回后影响 PV/其他组件透明度一致。
5. 文字控件重排：
   - 底色/无背景在上半部分且逻辑正常；
   - 不改变既有“只有单选 custom 才能编辑内容/底色”的约束。
6. 中英切换（仅 Site Overview）：
   - 默认英文；
   - 点击 `EN/中` 后 Site Overview 内文案切换中文，再点击切回英文；
   - 不出现布局溢出/换行导致错位。

