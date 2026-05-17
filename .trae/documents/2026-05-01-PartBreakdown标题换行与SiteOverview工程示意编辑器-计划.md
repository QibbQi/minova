## Summary

本计划覆盖两项需求：
1. **Part Breakdown & Warranty 页标题**在生成报价 PDF 时因过长挤压到左侧 LOGO：将 `& WARRANTY` 换行展示（两行标题），且不影响下方“根据报价单物品生成 Part Breakdown 组件”的逻辑。
2. **Site Overview**：基于屋顶背景图+光伏板组件，升级为可用于家用/工商业工程示范的“按真实尺寸等比例排布”编辑器：支持输入屋顶长宽、组件长宽（单位 m）、等比例渲染；在图片区域外增加 X/Y 轴参考线；支持框选/多选/批量拖动/批量复制；支持可勾选的网格吸附、组件吸附（磁力）；支持 0°/90° 旋转；补齐边界约束、键盘快捷键、撤销/重做等工程化能力。

## Current State Analysis

### 1) Part Breakdown 标题

- Part Breakdown 页标题元素：`#lbl-page3-title`，当前为单行大字号并有 `whitespace-nowrap`，英文为 `PART BREAKDOWN & WARRANTY`：
  - DOM：[index.html:L672-L672](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L672)
- 语言切换时通过 `updateLanguageLabels()` 以 `textContent` 赋值：
  - [index.html:L4198-L4205](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L4198-L4205)
- 由于 `whitespace-nowrap` 强制不换行，PDF 渲染时标题宽度过长会侵入左侧 LOGO 区域。

### 2) Site Overview 当前能力

- 当前 Site Overview 为“背景图 + 绝对定位 div”：
  - 状态：`roofBackground`、`pvModules`（每个模块 `{id,x,y,w,h}`，单位像素）[index.html:L8790-L8897](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L8790-L8897)
  - 能力：单个模块拖动、缩放、删除；无多选、无批量拖动、无复制、无吸附、无真实尺寸比例、无参考轴/标尺。
- 当前保存到报价的 memory 中：
  - [index.html:L8547-L8570](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L8547-L8570)
  - 这使得不同屏幕/缩放下复现排布不稳定（像素坐标与实际尺寸无关）。

## Decisions (from user)

- 屋顶/组件尺寸输入单位：**米 (m)**。
- 背景图与屋顶长宽比例不一致时：**保持图片比例（contain）**，不拉伸。
- 组件旋转：需要 **0° / 90°**。

## Proposed Changes

### A) Part Breakdown & Warranty 标题：只改标题渲染，不改组件生成逻辑

修改文件：
- [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)

实现方案：
1. 将 `#lbl-page3-title` 的 `whitespace-nowrap` 移除，允许换行。
2. 将 `updateLanguageLabels()` 对 `#lbl-page3-title` 的赋值由 `textContent` 改为 `innerHTML`，输出两行：
   - EN：`PART BREAKDOWN <br>& WARRANTY`
   - ZH：保持单行（例如 `产品明细与质保`），或同样支持拆分（可选）。
3. 确保仅改标题节点，不改 Part Breakdown 下方渲染逻辑（`partBreakdownData` / `renderPartBreakdown` 等），从而不影响“下方调取报价单物品生成组件”。

验收标准：
- 生成 PDF 时 Part Breakdown 页标题不会覆盖/挤压 LOGO；标题显示为两行，第二行以 `& WARRANTY` 开头。
- 切换语言后标题正确更新；Part Breakdown 组件仍按报价单条目正常生成。

### B) Site Overview：升级为“按真实尺寸等比例排布”的工程示意编辑器

#### B1) 数据模型（以米为单位，保证跨屏一致）

目标：
- “保存/加载报价”时 Site Overview 排布可稳定复现，不受屏幕分辨率影响。

方案：
1. 在 `snapshot.memory` 中新增结构（兼容保留原字段）：
   - `siteOverview = {`
     - `roof: { widthM, heightM }`
     - `module: { widthM, heightM }`
     - `modules: [{ id, xM, yM, wM, hM, rotDeg }]`（rotDeg ∈ {0,90}）
     - `settings: { gridStepM, showRulers, snapGrid, snapMagnet, snapToleranceM }`
   - `}`
2. 向后兼容：
   - 若历史报价仅有 `pvModules`（像素版）且没有 `siteOverview`：
     - 仍按旧像素逻辑渲染（保证旧报价不“丢图/丢布局”）。
     - 增加一个“转换为比例模式”的按钮（需要先输入屋顶/组件尺寸），执行一次性转换：将当前像素布局按当前显示比例换算为米单位并写入 `siteOverview`，此后以米单位渲染。

#### B2) UI 输入与布局（屋顶/组件尺寸 + 辅助工具栏）

新增/调整 Site Overview 区域 UI（同页内完成）：
1. 尺寸输入（单位 m）：
   - Roof Width (m)、Roof Height (m)
   - Module Width (m)、Module Height (m)
2. 参考线/吸附开关：
   - 显示参考轴/标尺（showRulers）
   - 网格吸附（snapGrid）
   - 组件吸附（snapMagnet）
   - 网格间距（gridStepM，默认 0.5m；可选 0.1/0.2/0.5/1.0）
3. 编辑器操作：
   - 添加光伏板（按 module 尺寸生成）
   - 复制（按钮 + Ctrl/Cmd+C/V）
   - 删除（按钮 + Delete/Backspace）
   - 撤销/重做（Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z）
   - 旋转（R 键或按钮，0°/90°切换）

#### B3) 渲染与坐标映射（图片保持比例 + 米→像素）

关键：背景图保持比例（contain），模块在“背景图实际显示区域”上按米等比例绘制。

实现步骤：
1. 背景图使用 `<img>` 元素而非 `background-image`（方便读取 naturalWidth/naturalHeight，并计算 contain 后的绘制区域 rect）。
2. 计算背景图在容器中的显示区域（imageRect）：
   - 已知容器尺寸 `canvasRect`（clientWidth/Height）
   - 已知图片 natural 尺寸 `imgW/imgH`
   - contain 算法得出 `drawW/drawH/offsetX/offsetY`
3. 米→像素比例：
   - `pxPerM = min(drawW / roofWidthM, drawH / roofHeightM)`
   - 世界坐标（m）转换为画布像素：
     - `xPx = offsetX + xM * pxPerM`
     - `yPx = offsetY + yM * pxPerM`
4. 边界约束：
   - 模块移动/缩放时，确保 `(xM,yM,wM,hM)` 始终落在 `[0, roofWidthM] × [0, roofHeightM]` 内；旋转时交换 w/h 或使用 rotDeg 表达。

#### B4) 选择与多选（框选、Shift 多选、批量拖动）

交互规则（默认不与现有单模块拖动冲突）：
1. 单击模块：选中该模块；再次单击空白：清空选择。
2. Shift+单击：切换该模块是否被选中（多选）。
3. 框选（lasso）：
   - 在空白区域按下鼠标拖动，显示选择矩形；
   - 松开后选中所有与矩形相交的模块（可选策略：相交即选中）。
4. 批量拖动：
   - 在任一“已选模块”上按下拖动：移动整个 selection（按 dx/dy 同步更新所有模块的 xM/yM）。

#### B5) 批量复制与粘贴

1. Ctrl/Cmd+C：将当前选中的 modules 深拷贝到内存剪贴板（保留相对位置）。
2. Ctrl/Cmd+V：在原位置基础上做一个固定偏移（例如 +0.2m,+0.2m）粘贴，生成新 id，选中新粘贴结果。

#### B6) 吸附（磁力吸附 + 网格吸附）

1. 网格吸附（snapGrid）：
   - 仅对最终落点进行：`xM/yM` 四舍五入到 `gridStepM` 的倍数。
2. 组件吸附（snapMagnet）：
   - 对移动中的 selection，计算“当前 selection 的外包框”与其它模块边缘/中心线的差值；
   - 在 `snapToleranceM`（默认 0.05m）内对齐到最近边缘/中心线；
   - 吸附优先级：组件吸附 > 网格吸附（或可配置；本计划默认组件优先）。
3. 视觉反馈：
   - 吸附触发时在对齐边缘绘制临时 guide line（例如细蓝线）。

#### B7) 参考轴/标尺（图片区域外部 X/Y）

实现：
1. 在 roof-canvas 外层增加一个“标尺框架”：
   - 顶部 X 轴标尺（显示 0→roofWidthM 的刻度）
   - 左侧 Y 轴标尺（显示 0→roofHeightM 的刻度）
2. 标尺刻度：
   - 主刻度：每 1m
   - 次刻度：每 0.5m（可选）
3. 标尺与背景图对齐：
   - 标尺起点对应 imageRect 的 offsetX/offsetY；非图片区域（留白）不画刻度或画灰色留白。

#### B8) 旋转（0°/90°）

1. 每个模块存 `rotDeg`（0 或 90）。
2. 渲染时：
   - rot=0：宽=moduleWidthM，高=moduleHeightM
   - rot=90：宽=moduleHeightM，高=moduleWidthM
3. 单选状态按 `R` 或按钮切换 rot；批量旋转（多选）可选支持（本计划支持批量旋转：对 selection 内所有模块切换 rot，并做边界约束）。

#### B9) 撤销/重做（工程示意必备）

实现：
1. 维护 history 栈（最多 100 步）：
   - push 时只记录 Site Overview 的可序列化数据（modules + settings + roof/module 尺寸），不记录背景大图字符串（避免内存爆炸）。
2. 操作触发点：
   - 拖动结束（mouseup）
   - 缩放结束
   - 旋转
   - 复制/粘贴
   - 删除
   - 尺寸/设置变更

## Files to Change

- [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)
  - `#lbl-page3-title` DOM 与 `updateLanguageLabels()` 的标题赋值策略
  - Site Overview DOM：增加尺寸输入、工具栏、标尺容器
  - Site Overview JS：替换/扩展 `roofBackground/pvModules/renderRoof`，引入 world-unit 模型、选择/吸附/复制/旋转/撤销重做等
  - snapshot memory 保存/加载：新增 `siteOverview`，保留旧 `pvModules` 的兼容路径

## Verification

### 1) Part Breakdown PDF 标题
- 选择生成 PDF，勾选包含 page3。
- 期望：`PART BREAKDOWN` 与 `& WARRANTY` 分两行，且不会覆盖 LOGO。
- 验证：page3 下方 Part Breakdown 列表仍正常生成。

### 2) Site Overview 工程示意
- 输入屋顶尺寸（m）与组件尺寸（m），上传任意背景图（比例任意）。
- 添加若干组件，验证：
  - 组件尺寸按 m 等比例显示（缩放窗口后仍一致）
  - X/Y 标尺可见并与图片区域对齐
  - 框选/Shift 多选生效
  - 批量拖动、批量复制（Ctrl/Cmd+C/V）生效
  - 吸附开关（网格/磁力）生效，并有对齐辅助线
  - 旋转 0°/90° 生效且有边界约束
  - 撤销/重做可回退/恢复操作

