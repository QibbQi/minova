## Summary

本计划修复两类问题：

1) **Page 3（PART BREAKDOWN & WARRANTY）组件卡片不再自动出现**：恢复为在第一页报价录入/修改时即可生成对应卡片（至少在切换到第 3 页时必定正确显示）。

2) **生成 PDF 时 Site Overview（第 5 页）未完整打印**：修复多边形（面积）与测距线条在 PDF 中缺失的问题，并解决导出后背景图横向压缩（保持与页面显示一致的比例）。

## Current State Analysis（基于仓库代码现状）

### Part Breakdown 渲染依赖的数据源不稳定

- 第 3 页容器：`#part-breakdown-container`：[index.html:L660-L679](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L660-L679)
- 渲染函数 `renderPartBreakdown()` 读取的是 `window.quoteRows`：[renderPartBreakdown](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L9331-L9372)
  - 但 `window.quoteRows` 只在初始化 `__setQuoteRows` 时被赋值一次：[index.html:L3931-L3934](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L3931-L3934)
  - 后续在多处会 **重新赋值 quoteRows（新数组引用）**（如删除/移动/插入空白行等），导致 `window.quoteRows` 与真实 `quoteRows` 脱钩，进而 `renderPartBreakdown()` 认为“没有 items”。

### PDF 导出时 Site Overview 交互层易在“隐藏页切换”中被清空

- PDF 导出主流程会循环“隐藏所有页 → 只显示当前页 → 等待 100ms → html2pdf 截图”：[confirmAndGeneratePDF](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L8609-L8814)
- Site Overview 的测距/面积渲染在 `renderRoofMeasurements()` 会先清空 `measureLayer.innerHTML = ''`，随后如果 viewport 尺寸为 0（页面被隐藏 display:none 时常见）会提前 return，导致 **层被清空且不再恢复**（直到下一次主动 render）。该函数位置：[renderRoofMeasurements](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L10812-L11102)
- 同理，网格/标尺/模块等层也存在“先清空再依赖尺寸”的路径，页面隐藏时可能被清空。
- 目前 onclone 中对 `#roof-image` 做了显式宽高设置，但使用 `objectFit='fill'` 且依赖 clone 时的 clientWidth/clientHeight，存在与页面显示不一致的风险（用户反馈横向压缩）：[onclone roof-image](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L8730-L8753)

## Proposed Changes

### 1) 修复 Part Breakdown 卡片不出现

**目标**
- 在第一页输入/修改报价后，Part Breakdown 的卡片数据源始终正确，切换到第 3 页时必定显示对应卡片。
- 不改变你当前 Part Breakdown 的 UI 样式与上传逻辑（`partBreakdownData[rowId]` 仍可绑定图片与 warranty）。

**修改点（index.html）**
- `renderPartBreakdown()`：改为读取“真实 quoteRows”，而不是依赖 `window.quoteRows`。
  - 优先使用 `window.__getQuoteRows?.()`（始终返回当前 quoteRows 变量），fallback 到局部变量或 `window.quoteRows`。
- 在报价发生变化后触发渲染：
  - 在 `calculateQuote()` 或 `window.calculateQuote` 包装器中，增加 `renderPartBreakdown()` 调用（与现有 ROI 关联逻辑同级）。
  - 同时在删除/移动/插入等会 **重新赋值 quoteRows** 的入口（如 `removeRow/moveRow/addBlankRow` 等）确保渲染被触发（如果已经统一放到 calculateQuote 里则可不重复）。

**数据一致性**
- 当 quoteRows 行被删除时，Part Breakdown 渲染应忽略已不存在 rowId 的 `partBreakdownData`（可选：在渲染前做一次“只保留仍存在的 rowId”过滤，避免内存持续膨胀）。

### 2) PDF 导出完整打印 Site Overview（面积多边形/测距线条不丢失）

**目标**
- PDF 第 5 页输出必须与屏幕上第二张图一致：包含面积多边形、测距线条/端点、标尺/网格等，避免导出后只剩 PV 模块和少量标签的情况。

**修改点（index.html）**
- 调整 Roof 渲染函数在 viewport 尺寸为 0 时的行为，避免“隐藏页切换”清空图层：
  - `renderRoofMeasurements()`：若 `vw/vh` 为 0 或获取不到 rect，则直接 return，且不要先清空 `measureLayer.innerHTML`。
  - 同理评估 `renderRulersAndGrid()`、`renderModules()`：在尺寸不可用时不清空、不重建，避免隐藏页时擦除。
- 在 PDF 生成循环中，对 page 5 显示后显式触发一次 `renderRoof()`（以及必要的布局等待）：
  - 在 `pn === 5` 且页面刚被显示后：`renderRoof()` → `requestAnimationFrame`/短延迟，确保 svg viewBox 与各层内容已生成，再交给 html2pdf 截图。
  - 这样即使 ResizeObserver 在隐藏/显示过程中没有触发，也能保证打印前最终态正确。

### 3) PDF 导出保持背景图比例一致（修复横向压缩）

**目标**
- PDF 中 roof 背景图宽高比与页面显示一致，不出现横向压缩/拉伸。

**修改点（index.html onclone）**
- onclone 的 `#roof-image` 修正逻辑改为“与页面一致的 contain 渲染”：
  - 继续使用 `data-iw/data-ih`（已在图片 load 时写入）。
  - 使用 `getBoundingClientRect()` 或 clientWidth/clientHeight 获取 clone 中 viewport 实际可用尺寸。
  - 计算 contain 后的 w/h，并设置：
    - `img.style.width/height/left/top` 为计算结果
    - `img.style.objectFit = 'contain'`（避免 fill 造成潜在失真）
    - 同时保证 `object-position: left top` 与页面一致

## Assumptions & Decisions

- “Part Breakdown 卡片出现”的判定：以当前报价表 `quoteRows` 为准；空白行（isBlank）不生成卡片。
- PDF 导出要求以“页面上可见效果”为准：不额外隐藏测距/面积 overlay（这些本来就不是 no-print），并确保页面隐藏切换不会擦除它们。
- 不在本计划中改动 Site Overview 的功能逻辑（编辑/吸附/撤销等），仅修复导出与渲染时机/尺寸依赖问题。

## Verification

- 交互验证
  - 第 1 页输入/修改报价（新增描述/规格/数量等），切换到第 3 页应立即看到对应的 Part Breakdown 卡片列表。
  - 删除/移动报价行后再切换第 3 页，卡片列表应与当前报价行一致，不残留已删除行。
- PDF 验证
  - 导出 PDF：第 5 页应包含面积多边形、测距线条/端点、标尺网格等，与页面显示一致。
  - 背景图宽高比保持正确，不出现横向压缩。

