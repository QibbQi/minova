# 替换并重新排列 Logo 计划

## 1. 目标 (Summary)
将用户上传的 `logo.png` (包含上下排列的图标和“MINOVA”文字) 处理成左右排列的形式，并替换 `index.html` 中目前位于左上角的 SVG Logo。在替换过程中，保持原有的排版和大小不受影响。

## 2. 当前状态分析 (Current State Analysis)
- **目标文件**：`index.html`。
- **当前代码**：大约在第 92-105 行，Logo 是使用 `<svg>` 标签直接绘制的，设置了 `class="h-12 w-auto"`，包含一个 `viewBox="0 0 200 60"`。
- **原图状态**：用户提供的 `logo.png` 是上下结构的（上面是图标，下面是文字）。
- **环境分析**：由于是 macOS 环境，我们可以通过编写一个简单的 Python 脚本（利用 `Pillow` 库）将 `logo.png` 切割并左右拼接为 `logo-horizontal.png`。

## 3. 拟定更改 (Proposed Changes)

### 步骤 1：处理图片 (Python 脚本)
- 创建并运行一个 Python 脚本 `process_logo.py`。
- 脚本逻辑：
  1. 读取根目录的 `logo.png`。
  2. 自动寻找中间的空白/透明区域，将图片切分为上（Logo 图标）和下（MINOVA 文本）两部分。
  3. 创建一张新的透明背景图片，将 Logo 图标放在左侧，文本放在右侧，并垂直居中对齐。
  4. 导出为 `logo-horizontal.png`。

### 步骤 2：替换网页中的 Logo
- **修改文件**：`index.html`
- **修改内容**：
  删除原有的 `<svg>` 块：
  ```html
  <svg width="200" height="60" viewBox="0 0 200 60" xmlns="http://www.w3.org/2000/svg" class="h-12 w-auto">
      ...
  </svg>
  ```
  替换为新的 `<img>` 标签，同时保留原有的尺寸控制类名：
  ```html
  <img src="logo-horizontal.png" alt="MINOVA Logo" class="h-12 w-auto object-contain" />
  ```
  *说明：使用 `h-12 w-auto` 可以确保新图片的高度与原 SVG 完全一致（约 48px），宽度自适应，不会破坏现有的 Header 排版。*

### 步骤 3：清理与验证
- 确认 `logo-horizontal.png` 已成功生成且显示正常。
- 删除临时的 `process_logo.py` 脚本。
- 使用浏览器或预览工具确认网页左上角的显示效果。

## 4. 假设与决策 (Assumptions & Decisions)
- **假设**：用户已将上传的图片保存为项目根目录的 `logo.png`。
- **决策**：采用物理裁剪拼接（Python 脚本）而不是纯 CSS 裁剪显示，因为前者生成的资源更规范，后续维护或在打印/PDF导出时不会出现兼容性问题。

## 5. 验证步骤 (Verification steps)
- 运行 `python3 -m http.server 8080`，并在浏览器中查看左上角的 Logo 是否为左右排列，且大小与原 SVG 相似。