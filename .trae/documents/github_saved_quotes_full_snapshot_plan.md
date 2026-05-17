# 已存报价：保存/加载/删除改为 GitHub 仓库存储（含 5 页全部文字与图片）计划

## **Summary**
- 将“已存报价”的持久化从本地 IndexedDB（仅本机可见，且当前保存字段不完整）升级为 **GitHub 仓库存储**：点击保存时把报价 5 个视图的所有可编辑文字与图片统一提交到仓库；加载时从仓库读取并恢复到页面；删除时同步删除仓库内对应报价文件并更新列表。
- 实现方式与现有“公司级/产品级认证上传”一致：复用 `window.__minovaSync.repo.commitTextFiles(...)` 的多文件原子提交能力，不影响页面点击交互，也不影响现有生成报价 PDF 的逻辑（PDF 仍读取同一套内存状态与 DOM）。

## **Current State Analysis**
- 报价视图的“已存报价”UI 在 [index.html:L87-L110](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L87-L110)：下拉框 `#saved-quotes-select` + 按钮 `loadSavedQuote/openSaveQuoteModal/openDeleteQuoteModal`。
- 当前保存/加载/删除实现基于 IndexedDB：
  - DB：`MinovaQuotesDB`，store：`quotes`，[index.html:L8602-L8854](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L8602-L8854)
  - `executeSaveQuote()` 只保存了部分字段（尽管已包含 `quoteRows/partBreakdownData/referenceBlocks/roofBackground/pvModules`，但仍遗漏大量可编辑文本：例如 `contenteditable` 的地址块、条款/备注、多处输入框等）。
- GitHub 同步能力已存在且可用：
  - 同步对象：`window.__minovaSync = initGitHubSync(...)`，[index.html:L7138-L7155](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L7138-L7155)
  - 原子提交多文件：`repo.commitTextFiles(...)`，[index.html:L2701-L2744](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L2701-L2744)
  - 认证文件上传示例（将二进制转 base64 并以 `encoding:'base64'` 提交 blob）：[index.html:L7380-L7417](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L7380-L7417)
- 限制：当前 `createRepoStore` 内部虽实现了 `getFile(...)`（读 contents），但对外只暴露了 `{ upsertText, commitTextFiles }`，[index.html:L2665-L2745](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L2665-L2745)。因此“从 GitHub 读取已存报价列表/报价内容”需要补齐一个可复用的读取方法。

## **Proposed Changes**

### 1) 扩展 GitHub Repo API：暴露读取文本文件能力
**文件**： [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)  
**位置**：`createRepoStore({ api })` 内，[index.html:L2665-L2745](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L2665-L2745)

**修改内容**
- 将内部的 `getFile({ owner, repo, path, branch })` 暴露出去（例如返回对象里增加 `getFile` 或新增 `getText` 方法）。
- 读取结果至少包含：
  - `sha`（用于需要时做并发处理）
  - `content`（纯文本）

**理由**
- 报价列表与报价文件需要在“加载/刷新列表”时通过带授权的 GitHub API 获取；仅靠 Raw URL 无法兼容私有仓库/细粒度 PAT。

### 2) 定义 GitHub 侧的报价存储结构（可删除、可列表、可加载）
**存储路径（约定）**
- 报价索引：`minova-data/quotes/index.json`
- 单份报价：`minova-data/quotes/<quoteId>.json`

**`index.json` 结构（建议）**
- `v`: 版本号
- `updatedAt`
- `quotes`: `[{ id, name, customerName, quoteNo, updatedAt }]`（只放列表需要的轻量字段）

**`<quoteId>.json` 结构（建议）**
- `v`, `id`, `name`, `createdAt`, `updatedAt`
- `snapshot`：完整报价快照（见下一节）

**理由**
- 不依赖目录 listing（当前 repo store 未提供 list API），只需读取一个 `index.json` 即可渲染下拉列表。
- 删除时可一次 commit：删除 `<quoteId>.json` + 更新 `index.json`（原子提交，避免列表与文件不一致）。

### 3) 生成“5 页全部文字与图片”的通用快照（不靠手写字段）
**文件**： [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)  
**位置**：`multi-page-script` 或保存逻辑附近（与 `executeSaveQuote/loadSavedQuote` 同一作用域），参考：[index.html:L8305-L8601](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L8305-L8601)

**新增函数**
- `captureQuoteSnapshot()`：
  - 遍历 `#pdf-content-wrapper` 下所有元素：
    - `input/textarea/select` 且有 `id`：记录 `value`（checkbox/radio 记录 `checked`）
    - `contenteditable="true"` 且有 `id`：记录 `innerHTML`（保留换行/格式）
  - 同时记录驱动渲染的内存状态（确保图片与动态布局完整）：
    - `window.quoteRows`
    - `partBreakdownData`（含 base64 dataURL 图片）
    - `referenceBlocks`（含 base64 dataURL 图片）
    - `roofBackground`（base64 dataURL）
    - `pvModules`
    - `window.validityDays`、`quoteSplit`（若启用拆分）、`currentLang/currentCurrency`（如希望跟随报价一起保存）
- `applyQuoteSnapshot(snapshot)`：
  - 先恢复上述内存状态变量
  - 再按 `fields` 映射写回 DOM（`value/checked/innerHTML`）
  - 对 `textarea` 触发一次 autosize（用已有的 `scrollHeight` 逻辑重新计算高度）
  - 最后调用已有渲染函数刷新 UI：
    - `renderQuote()` / `calculateQuote()` / `calculateROI()` / `renderPartBreakdown()` / `renderReferenceBlocks()` / `renderRoof()`

**理由**
- 避免“手写字段列表必然漏项”的问题；只要元素有 `id` 或属于关键状态变量，就会被完整保存。
- 不改变 DOM 结构与 PDF 生成入口；PDF 依旧读取 `quoteRows/partBreakdownData/...` 与当前页面渲染结果，因此不会被破坏。

### 4) 替换已存报价的持久化实现：IndexedDB → GitHub（保留本地回退）
**文件**： [index.html](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html)  
**位置**：现有 IndexedDB 段落，[index.html:L8602-L8854](file:///Users/jqz/Library/CloudStorage/OneDrive-%E4%B8%AA%E4%BA%BA/Github%20Project/minova/index.html#L8602-L8854)

**改造点**
- `refreshSavedQuotesList()`：
  - 若 `window.__minovaSync.getStatus().connected`：
    - `repo.getFile({ path: 'minova-data/quotes/index.json' })` 读取索引并渲染下拉
    - 404 时视为无报价：渲染空列表（只保留“-- 新报价 --”）
  - 否则回退到 IndexedDB（保持原行为，避免离线/未连接时页面崩溃）
- `executeSaveQuote()`：
  - 若未连接 GitHub：提示“请先连接 GitHub”或回退本地保存
  - 已连接：
    - 生成 `quoteId`（新建或覆盖当前选择项）
    - `snapshot = captureQuoteSnapshot()`
    - 更新 `index.json` 的对应条目（新增/更新时间）
    - 使用 `commitTextFiles` 一次提交两个文件：
      - `minova-data/quotes/index.json`
      - `minova-data/quotes/<quoteId>.json`
    - 成功后 toast + 刷新列表 + 关闭弹窗
- `loadSavedQuote()`：
  - 若选择为空：恢复“新报价”默认状态（沿用现有逻辑）
  - 已连接且选择了 `quoteId`：
    - 读取 `minova-data/quotes/<quoteId>.json`
    - `applyQuoteSnapshot(snapshot)`
    - toast “加载成功”
  - 未连接时仍支持从 IndexedDB 加载（不影响老数据）
- `executeDeleteQuote()`：
  - 已连接：
    - 更新 `index.json` 移除条目
    - `commitTextFiles`：删除 `minova-data/quotes/<quoteId>.json` + 写回 `index.json`
  - 未连接：回退 IndexedDB 删除

**不影响 PDF 的关键保证**
- 不改 `confirmAndGeneratePDF`、不改 `pdf-content-wrapper` 结构，只改变“存取数据来源”和“恢复数据到同一套内存状态 + DOM”。

## **Assumptions & Decisions**
- 以当前页面已集成的 GitHub 同步模块（`window.__minovaSync`）为唯一上传入口；用户在报价页面可见时默认已连接 GitHub（UI 当前也会在未连接时隐藏受限 tab）。
- 报价快照中的图片（当前已是 `data:` base64）先直接存入 `<quoteId>.json`，确保实现最短路径、加载无需额外多文件请求；若后续出现单文件过大/提交慢，再升级为“图片分离存储 + 引用路径”。
- 不新增额外第三方库；仅复用现有 `commitTextFiles/getFile` 与页面已有渲染函数。

## **Verification**
1. 连接 GitHub（确保按钮显示 `GH 已连`），进入报价页。
2. 在 5 个视图里分别修改多处文本与上传图片（Page3 品牌/产品图片、Page4 reference 图片、Page5 roofBackground）。
3. 点击“保存”，输入名称并确认：仓库应产生/更新：
   - `minova-data/quotes/index.json`
   - `minova-data/quotes/<quoteId>.json`
4. 刷新页面后，已存报价下拉应能从 GitHub 读取列表；选择并加载：应完整恢复 5 页所有文字与图片。
5. 点击“删除”：应从列表中消失，且仓库对应 `<quoteId>.json` 被删除；再次刷新列表应仍保持一致。
6. 对同一份已加载报价直接点击“生成报价（PDF）”：应与保存前一致，PDF 生成与附件合并逻辑不受影响。

