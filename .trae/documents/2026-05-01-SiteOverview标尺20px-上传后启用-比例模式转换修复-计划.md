## Summary

本计划在不影响其它报价页面的前提下，继续优化 Site Overview（第 5 页）：
1. 标尺占用进一步缩窄到 **20px**，同时同步缩短小刻度显示。
2. **所有组件编辑相关功能仅在上传屋顶背景图后可用**（含：添加/复制/删除/旋转/撤销重做/网格与吸附设置/尺寸输入/转换为比例模式等），并在图片加载后根据图片比例动态调整工作区高度与渲染区域。
3. 修复“转换为比例模式”按钮不可用的问题：恢复“旧 pvModules 像素布局”兼容路径，并在具备旧数据且已加载图片时才允许转换。

## Current State Analysis (Grounded)

### 标尺占用

- 目前标尺占用通过 `#roof-editor-grid` 的 inline style 控制，当前为 `28px`：
  - [index.html:L779](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L779)
- 标尺与小刻度逻辑在 `renderRulersAndGrid()`，已支持 `minorStep = step/10` 并做密度降级：
  - [index.html:L9073-L9170](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9073-L9170)

### 上传后才能使用

- Site Overview 的工具栏按钮与输入目前无禁用逻辑，页面加载即存在：
  - [index.html:L721-L793](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L721-L793)
- 当前初始化逻辑在脚本末尾会直接 `ensureSiteOverview(); initRoofEditorOnce(); renderRoof();`，导致“未上传图也进入比例模式”的状态：
  - [index.html:L9832-L9836](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9832-L9836)

### “转换为比例模式”不可用的原因

- 该按钮调用 `window.convertLegacyRoofToScaleMode()`：
  - DOM：[index.html:L777](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L777)
  - 实现：[index.html:L9807-L9830](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L9807-L9830)
- 转换函数仅在 `pvModules.length > 0` 时才会进行转换；但当前页面加载阶段就进入了比例模式，后续基本不会再产生 legacy `pvModules`（导致按钮看似“无法使用”）。

## Proposed Changes

### 1) 标尺进一步缩窄到 20px

修改文件：
- [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)

改动点：
1. 将 `#roof-editor-grid` 的 `grid-template-columns/rows` 从 `28px` 调整为 `20px`。
2. 在 `renderRulersAndGrid()` 内同步缩短小刻度长度：
   - X 标尺：minor tick height 从 `55%` 调整到更短（如 `40%`），major 保持 `100%`。
   - Y 标尺：minor tick width 从 `55%` 调整到更短（如 `40%`），major 保持 `100%`。
3. 字体与 label 位置适配 20px：
   - 将 ruler label 的 font-size 由 `9px` 下调至 `8px`，top/left 偏移微调，避免挤出。

验收：
- 标尺占用变窄且不遮挡刻度数字；小刻度可见但不抢占空间。

### 2) 仅在上传屋顶背景图后启用所有编辑组件 + 按图片调整工作区

修改文件：
- [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)

实现方案：
1. 增加一个统一的启用/禁用函数 `setRoofEditorEnabled(enabled)`：
   - 目标控件：添加/复制/删除/旋转/撤销/重做/清除/尺寸输入/吸附开关/网格间距/转换按钮。
   - 处理方式：给相关 button/input/select 设置 `disabled` 属性，并附加 `opacity-50 cursor-not-allowed` 类（尽量不改变布局）。
2. 初始状态：
   - 页面加载时（无 `roofBackground`）调用 `setRoofEditorEnabled(false)`。
3. 上传图片时：
   - `uploadRoofBackground()` 完成 `roofBackground` 写入后：
     - 先 `setRoofEditorEnabled(true)`
     - 再初始化编辑器（比例模式或 legacy 模式，见第 3 点）
4. 根据图片比例调整工作区（“根据上传屋顶背景图调整工作区”）：
   - 在 `roof-image` 的 `load` 事件里读取 `naturalWidth/naturalHeight`，按容器宽度计算建议高度：
     - `idealH = clamp(containerW * (imgH/imgW), 420, 760)`
   - 设置 `#roof-editor-grid` 高度为 `idealH`（保持宽度不变，只调高度），并触发 `renderRoof()`。

验收：
- 未上传图片时，所有编辑按钮/输入均不可用；上传图片后全部解锁。
- 上传横向/纵向图片时，工作区高度会自适应变化，减少大量留白。

### 3) 修复“转换为比例模式”：恢复 legacy 渲染路径 + 仅在满足条件时启用转换

目标：
- 兼容旧报价：只保存了 `roofBackground` + `pvModules`（像素坐标），没有 `siteOverview`。
- 只有在“已加载图片”且“存在 legacy pvModules”时，“转换为比例模式”按钮可用且转换成功。

实现方案：
1. 移除/改造当前“页面加载即 ensureSiteOverview()”的逻辑：
   - 不再在页面启动时强制进入比例模式；
   - 改为：当且仅当满足以下之一时初始化比例模式：
     - 用户上传了图片后，第一次进入 Site Overview（新建场景）；
     - 加载的报价 snapshot 中存在 `siteOverview`（新结构）。
2. 引入 legacy 渲染分支（不影响现有比例模式逻辑）：
   - 当 `siteOverview == null` 且 `pvModules.length > 0` 时：
     - 使用一个独立的 `renderRoofLegacy()` 在 `#roof-modules-layer` 中按像素渲染旧模块（不使用米↔像素映射）。
     - 在 legacy 模式下允许拖动/缩放/删除（可复用旧逻辑或简化版），但仍受“必须有图片”约束。
3. 转换按钮启用规则：
   - `enabled = !!roofBackground && !siteOverview && pvModules.length > 0`
4. 修复转换算法的坐标基准：
   - legacy 模式下模块像素坐标应以“图片实际显示区域 imageRect”为基准（而不是以前的整个 canvas）。
   - 转换时使用 `pxPerM = min(imageRect.w/roofWidthM, imageRect.h/roofHeightM)`，并将 legacy 的 `{x,y,w,h}` 转为 `{xM,yM,wM,hM}`：
     - `xM = (x - imageRect.x)/pxPerM`
     - `yM = (y - imageRect.y)/pxPerM`
     - `wM = w/pxPerM`, `hM = h/pxPerM`
   - 转换后 clamp 到屋顶范围，清空 `pvModules`，写入 `siteOverview.modules`，进入比例模式渲染。

验收：
- 加载旧报价（有 pvModules、无 siteOverview）后，“转换为比例模式”按钮可点击且转换后模块位置基本一致。
- 无 pvModules 时按钮禁用（并可给 toast 提示“无可转换的旧布局”）。

## Assumptions & Decisions

- “图片上传后才能使用”解释为：Site Overview 的编辑功能均以 `roofBackground` 存在为前提；从已保存报价加载进来的 `roofBackground` 视作“已上传/已具备背景图”。
- 工作区自适应仅调整高度，不改变布局结构（仍为右侧主视图 + 标尺框架）。
- legacy 模式仅作为兼容入口；推荐用户转换到比例模式后继续编辑。

## Verification

1. 标尺 20px
   - 进入 Site Overview，确认标尺占用 20px，小刻度缩短且数字不溢出。
2. 上传前禁用
   - 刷新页面：Site Overview 编辑按钮与输入均禁用。
   - 上传屋顶背景图：全部启用，且工作区高度按图片比例变化。
3. 转换按钮
   - 构造/加载一个旧报价（有 `pvModules`、无 `siteOverview`）：按钮可用，点击后完成转换并切换到比例模式。
   - 无旧数据时按钮禁用且不报错。

