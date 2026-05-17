# 彻底隔离视图的 PDF 独立渲染与合并计划

## 1. 现状分析
当前，虽然设定了 `minHeight: '297mm'` 并且加了 CSS 的硬分页控制，但在实际利用 `html2pdf` 一次性渲染长达数页甚至十几页的长 HTML 容器（包含多个互相叠加或尺寸不定的视图）时，由于底层 `html2canvas` 会将整块 DOM 画在一张巨型 Canvas 上，再由 jsPDF 强行按 A4 尺寸进行切片分页。
这种机制有一个天然缺陷：当上一个页面（如 Quotation）高度超出 1 页且未凑满 2 页时，在切片处必然会产生“半页空白”，而 `html2canvas` 的流式排版可能会让后续页面（如页面 2、3）在 DOM 流中紧紧贴着页面 1 的尾巴被渲染在这张巨型 Canvas 的“空白缝隙”里，这就导致最终切出来的 A4 页出现了“多个视图的页眉和内容被诡异地挤在一张纸上”的重叠/粘连现象。

## 2. 具体修改方案：采用 PDFLib 进行视图级别合并
**思路：完全抛弃“将 5 个页面放进一个容器里让 html2pdf 一次性长图截断”的做法。**
既然我们已经引入了强大的 `PDFLib` 来合并外部认证文件（PDF/图片），我们完全可以将这 5 个内部视图也当做“独立的 PDF”来处理。
即：对选中的每一个视图，我们依次执行 `html2pdf()`。对于每一个视图，在渲染它的瞬间，强行把其余所有的视图隐藏掉（彻底移出文档流），这样 `html2canvas` 生成的巨型 Canvas 永远只属于当前这一个视图。生成完它的 ArrayBuffer 之后，利用 `PDFLib` 把这几个独立的 ArrayBuffer 合并成一个完整的文件。

**实施步骤：**
1. **获取引用**：在 `confirmAndGeneratePDF` 函数开始处，确保拿到 `window.PDFLib`。
2. **初始化合并文档**：`const mergedDoc = await PDFDocument.create();`
3. **遍历选中的内部页面**（`window.selectedPrintPages`，例如 `[1, 2, 4]`）：
   - 每次循环，先将所有的 5 个页面 `display: none`。
   - 仅将当前的循环目标 `quote-page-X` 设置为 `display: block`。
   - 调用 `html2pdf().set(opt).from(pageElement).output('arraybuffer')`。
   - 此时不需要 `pdf-page-break` 逻辑，因为只有一个页面。
   - 拿到该单页（可能跨两页）的独立 PDF 字节流后，使用 `PDFDocument.load()` 加载，再使用 `mergedDoc.copyPages()` 和 `addPage()` 追加到 `mergedDoc` 里。
4. **追加外部文件**：继续复用原有的 `selectedFiles` 循环，把外部下载的 PDF 或图片追加到 `mergedDoc` 末尾。
5. **恢复原状并保存**：
   - 恢复页面原本的隐藏状态。
   - `const finalBytes = await mergedDoc.save();`
   - 调用 `savePdfBytes(finalBytes)` 下载。

## 3. 假设与决策
- 由于渲染过程需要经历多次 DOM 重排重绘和 `html2pdf` 的异步执行，原先的同步代码必须改成通过 `async/await` 按序执行，以保证每个视图的隐藏/显示能够及时在浏览器中生效被截屏。
- 我们会在界面上展示详细的进度，比如“正在处理视图 1/5...”，因为拆分渲染可能会多花一两秒的时间，良好的进度提示可以消除用户的等待焦虑。

## 4. 验证步骤
1. 点击“生成报价（PDF）”，勾选全部 5 个内部视图以及至少 1 份外部图片。
2. 点击确认，观察是否出现“正在处理视图...”的动态进度提示。
3. 下载成功后打开 PDF，检查第 1 页 Quotation 和第 2 页明细质保。
4. 验证：无论第 1 页多长、多短，第 2 页都必定干净利落地从新的一页的顶部开始，绝对不可能和第 1 页的内容挤在同一张纸上。
