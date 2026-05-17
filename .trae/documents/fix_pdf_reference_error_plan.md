# 修复 savePdfBytes 未定义及 PDF 下载失败计划

## 1. 现状分析
在此前重构 `window.confirmAndGeneratePDF` 逻辑时，直接覆盖了该函数的整个内容。但是原本的 `savePdfBytes` 函数和 `downloadFile` 函数是定义在旧的 `confirmAndGeneratePDF` 函数内部（或者外部紧邻的作用域）的。覆盖代码时，没有将这两个依赖的辅助函数包含进去，导致 JavaScript 执行到 `savePdfBytes(quoteBytes)` 时直接抛出 `ReferenceError: savePdfBytes is not defined` 从而彻底中断了 PDF 的生成和下载流程。

## 2. 具体修改方案
- 重新定义丢失的辅助函数 `savePdfBytes` 和 `downloadFile`。
- 将这两个函数插入到 `window.confirmAndGeneratePDF` 函数的开头部分（就在读取 `quoteNo` 之后），以确保 `html2pdf.then(...)` 闭包内部可以正常访问到这两个函数。
  - `savePdfBytes(bytes)`: 将 `ArrayBuffer` 转为 `Blob`，并通过创建临时的 `<a>` 标签触发浏览器下载。
  - `downloadFile(type, path, name)`: 利用 Fetch API 从 GitHub 仓库读取原始图片或 PDF 文件的 ArrayBuffer，用于多文件合并。

## 3. 假设与决策
- 这两个函数原本就是用来支持文件合并和字节流下载的。
- 考虑到它们仅在生成 PDF 的阶段被调用，将其作为局部变量/函数声明在 `confirmAndGeneratePDF` 内是非常合理且安全的，不会污染全局命名空间。

## 4. 验证步骤
1. 刷新页面，点击“生成报价（PDF）”。
2. 不勾选任何附加文件（仅勾选页面），点击生成，验证能否正常弹出下载框下载 PDF。
3. 勾选 1 个或多个认证附件（例如图片或 PDF），点击生成，验证是否能够成功合并并下载最终的 PDF。
4. 检查浏览器 Console 确认不再有 `ReferenceError` 报错。
