## Summary

在生成报价 PDF 时，Site Overview（第 5 页）的画布（背景图 + PV/自定义组件 + 面积多边形 + 测距线/标记 + 标尺/网格）仍无法稳定完整输出。按你的要求，本计划改为：**先把整个画布区域渲染成一张单独的图片（dataURL），再把这张图片渲染进 PDF**，以避免 html2canvas 在隐藏/显示页面切换、SVG/clip-path、叠加层等场景下丢失内容或比例失真。

## Current State Analysis（基于代码现状）

- PDF 生成入口：`window.confirmAndGeneratePDF`：[index.html:L8605-L8937](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L8605-L8937)
- 当前机制：循环隐藏所有页 → 显示当前页 → `html2pdf().from(#pdf-content-wrapper)` 截图生成临时 PDF → 再用 PDFLib 合并。
- Site Overview 画布 DOM 结构：`#roof-editor-grid`（含 20px 标尺区 + `#roof-viewport` 内背景图、网格、模块层、标注层）：[index.html:L907-L917](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L907-L917)
- 问题表现（用户反馈）：导出时缺少多顶角控件/面积多边形、缺少测距线/标记，且背景图出现横向压缩。
- 已有 onclone 修正（roof-image 尺寸/clip-path→SVG 等）仍不足以保证“整张画布完整呈现”：onclone 只在 clone 里改样式，无法避免某些层在导出前已被清空/未重新渲染，或 html2canvas 对复杂叠加层的兼容性问题。

## Proposed Changes

### 核心策略：第 5 页导出时将画布转为位图，再让 html2pdf 截图这个位图

**目标**
- PDF 第 5 页输出与屏幕上“完整画布”一致：背景比例不变形；PV/自定义组件、面积多边形、测距线/端点/文字、标尺/网格都在。

**实现方案（index.html / confirmAndGeneratePDF）**

1) 新增一个异步辅助函数 `captureRoofEditorSnapshotDataUrl()`（或内联在 confirmAndGeneratePDF 内）
   - 前置条件：第 5 页已显示、`renderRoof()` 已执行、布局稳定（至少等待两帧）。
   - 调用 `html2canvas(roofEditorGrid, { scale, useCORS:true, backgroundColor:'#fff', scrollX:0, scrollY:0 })`
   - 生成 `dataUrl = canvas.toDataURL('image/jpeg', 0.98)`（如对透明/锐利边缘要求更高可改 png）
   - 为避免重复计算：在一次导出流程中缓存 `roofSnapshotDataUrl`，只生成一次。

2) 在 PDF 页循环里，专门处理 `pageNum === 5`
   - 显示 page 5 后：
     - `renderRoof()` + 等待两帧
     - `roofSnapshotDataUrl = await captureRoofEditorSnapshotDataUrl()`
   - 将 **实际 DOM** 的 `#roof-editor-grid` 临时替换为一个 `<img>`（或在 grid 内插入 img 覆盖层并隐藏原内容），以确保后续 `html2pdf` 只会截到这张位图：
     - 保存原始节点：`const original = roofEditorGrid.cloneNode(true)` 或保存 `innerHTML`（优先 cloneNode，避免丢监听/状态）
     - `roofEditorGrid.innerHTML = ''`，插入 `img.src = roofSnapshotDataUrl`
     - img 样式：`display:block; width:100%; height:auto;` 并让 grid 自身保留原高度/宽度（不改变布局），必要时设置 `img.style.height='100%'` 且 `objectFit='contain'`，确保比例一致
   - 完成 `html2pdf` 截图后：把 `#roof-editor-grid` 恢复为原始 DOM（用保存的 original 替换回去），并再调用一次 `renderRoof()` 保证交互层恢复正常。

3) 兜底保护（避免失败导致页面被破坏）
   - 对 page 5 的 DOM 替换/恢复用 `try/finally` 包裹，确保即使 PDF 生成失败也会恢复画布 DOM。
   - 若 `html2canvas` 不存在或 snapshot 失败，则回退到原先流程（仍走 html2pdf + onclone），并提示 toast 说明导出可能不完整。

### 兼容性与取舍

- 位图化会牺牲矢量精度，但能换取“稳定完整呈现”，符合本需求优先级。
- scale 建议与当前 `html2canvas.scale=3` 一致，避免清晰度下降；如果导出文件过大，可降到 2 并做对比。

## Assumptions & Decisions

- “完整打印画布”包含：背景图、模块/自定义组件、面积多边形、测距线/端点/文字、标尺/网格（以你截图中的画布区域为准）。
- 仅针对 PDF 导出流程做临时 DOM 位图替换；不改变编辑器日常交互与状态结构。

## Verification

- 页面验证
  - 打开第 5 页：确保画布上有 PV、自定义多边形、测距线与标尺网格。
- 导出验证
  - 点击生成 PDF：检查第 5 页画布是否完整呈现（多边形与测距线都在），且背景图无横向压缩/比例一致。
  - 导出后回到页面：画布仍可继续编辑/拖动/测距（说明 DOM 已正确恢复）。

