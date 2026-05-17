## Summary

在保持当前“第 5 页画布导出已稳定且完整”的成果基础上，为报价 PDF 的第 5 页顶部增加公司表头：左侧 **LOGO + Solar System Solution | Storage Battery**，右侧 **SITE OVERVIEW**（随中英切换）。

约束：

- 不影响其他页面导出与查看（只改导出第 5 页的 PDFLib 绘制分支）。
- 不影响 Site Overview 工具的正常使用（只在导出时绘制 PDF 内容，不改真实页面 DOM）。

## Current State Analysis（基于仓库现状）

- 第 5 页在页面 DOM 中已存在表头（用于屏幕显示/非第 5 页 PDF 导出截图时可见）：
  - `#quote-page-5` 顶部包含 `logo-horizontal.png`、tagline、`#lbl-page5-title`：[index.html:L705-L719](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L705-L719)
- 当前 PDF 导出时，第 5 页走 PDFLib 直接 `embedPng + addPage(A4) + drawImage` 的路径，仅绘制“画布快照图片”，因此不会带上 DOM 表头：
  - pageNum===5 分支：[index.html:L9258-L9276](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html#L9258-L9276)

## Proposed Changes

### 1) 在 pageNum===5 的 PDFLib 分支绘制表头（不改画布快照）

**文件**： [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github%20Project/minova/index.html)

**改动点**：`confirmAndGeneratePDF()` 的 `if (pageNum === 5)` 分支（PDFLib `drawImage` 之前）

**实现方式**

1) 预备字体（仅用于第 5 页）
   - 使用 PDFLib 内置字体：`StandardFonts.Helvetica`、`StandardFonts.HelveticaBold`
   - 只需 `await mergedDoc.embedFont(...)` 一次，可放在循环外缓存（避免重复 embed）。

2) 读取标题文本（随语言切换）
   - `const titleText = document.getElementById('lbl-page5-title')?.textContent?.trim() || 'SITE OVERVIEW'`

3) 获取并嵌入 LOGO 图片
   - 优先 fetch `./logo-horizontal.png` → `arrayBuffer` → `embedPng`
   - 失败则 fallback `./logo.png`
   - 为避免重复下载：在导出函数作用域内缓存 `logoBytes/logoImage`

4) 布局参数（A4 points）
   - page size：`A4 = [595.28, 841.89]`
   - 预留顶部表头高度：`headerH = 72`（可按视觉微调）
   - 左右边距：`padX = 36`
   - LOGO 高度：`logoH = 28`（宽度按图片比例缩放）
   - tagline 字号：`10`，颜色接近页面样式（`#6B21A8` 透明可用灰紫）
   - title 字号：`28~32`，颜色浅灰（`#CBD5E1`），右对齐

5) 绘制顺序（PDFLib 坐标原点在左下）
   - 计算 `topY = ph - padY`（例如 `padY = 36`）
   - 左侧：
     - drawImage(logo) 于 `(padX, topY - logoH)`
     - drawText(tagline) 于 logo 下方（`topY - logoH - 18`）
   - 右侧：
     - drawText(titleText) 于右上角（根据文本宽度右对齐到 `pw - padX`）

6) 调整画布快照的绘制区域
   - 将快照图片绘制到 “表头下方的剩余区域”：
     - `availH = ph - headerH - padBottom`
     - `ratio = min(pw / imgW, availH / imgH)`
     - y 从 `padBottom` 起，整体居中到剩余区域内（避免压缩/裁切）
   - 这样表头与画布同时存在且不变形。

### 2) 不影响现有成果的保护措施

- 保持 `buildRoofSnapshotForPdf()` 完全不变（画布导出稳定部分不动）。
- 仅对第 5 页 PDFLib 分支新增 “表头绘制 + 画布图片下移” 的布局逻辑。
- 其它页仍走原导出流程（html2pdf + copyPages），不受影响。

## Assumptions & Decisions

- 表头内容与页面现有样式一致：
  - LOGO 使用项目内 `logo-horizontal.png`（失败 fallback `logo.png`）
  - tagline 固定为 `Solar System Solution | Storage Battery`
  - 右侧标题使用 `#lbl-page5-title` 当前文本（支持中英）

## Verification

- 导出 PDF：
  - 第 5 页顶部出现 LOGO、tagline、SITE OVERVIEW（或中文“现场概览”）
  - 画布快照保持当前完整性（组件/标注/标尺网格不丢失、不变形）
  - 其它页导出不受影响

