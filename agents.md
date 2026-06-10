# Minova Agent Guide

本文件用于帮助后续 AI agent 或开发协作者快速理解当前仓库。修改代码前请先读这里，再按实际文件状态继续核对。

## 项目定位

Minova 是一个前端优先的新能源业务工具。GitHub Pages 承载主界面，Cloudflare Worker + D1 承载登录、权限、审批、审计和业务主数据。仓库仍承担前端代码、静态数据副本、附件、报价快照与发布载体，没有传统的本地构建流程。

核心运行方式：

- `index.html` 是生产入口，也是主要 UI、样式、状态和浏览器逻辑所在。
- `worker/` 是 Cloudflare 后端，远程 D1 `minova-auth-db` 是当前业务主数据和权限数据的主要持久化层。
- `auth/minova-auth-ui.mjs` 连接前端、Worker API、D1 写入队列和管理后台。
- `minova-data/state.json` 是主业务状态的静态备份副本，结构为 `{ v, updatedAt, data }`。
- `index.html` 内的 `<script id="minova-embedded-state" type="application/json">` 保存首屏可用的内嵌状态。
- `minova-data/quotes/` 保存独立报价快照，`index.json` 是报价索引，每个 `<id>.json` 保存 `captureQuoteSnapshot()` 生成的报价页面状态。
- `github-sync/` 提供浏览器到 GitHub 仓库的同步、发布、加密 token、冲突合并和批量提交逻辑。
- `.github/workflows/pages.yml` 和 `.github/workflows/redeploy.yml` 将整个仓库部署到 GitHub Pages。

## 强制变更门禁：D1 备份与回滚 Hash

在本仓库中，每个“完整、可验证的逻辑改动任务”都必须独立执行以下流程。文件保存次数不作为任务粒度。

1. 修改任何仓库文件前，运行 `npm run backup:d1 -- <task-slug>`，导出远程 `minova-auth-db`。
2. 备份必须保存到 `/Users/jqz/Documents/MINOVA PROFILE/01-Projects/MINOVA QUOTATION WEBSITE/backup`，不得提交进 Git。
3. 先导出到本机临时目录，再一次性复制到目标目录。确认 SQL 非空、首尾结构完整、关键语句存在，并记录源文件 SHA-256、字节数、创建时间和修改前 Git SHA。若目标目录哈希因同步机制波动，则以内容结构、大小和记录时间验证。脚本会同时生成 `.manifest.txt`。
4. 完成最小范围修改，运行受影响测试；涉及共享状态、D1、权限或主页面时运行完整 Node 测试。
5. 一个逻辑任务对应一个独立 Git commit。最终回复必须提供完整 commit SHA，作为代码回滚地址。
6. 代码回滚优先使用 `git revert <commit-sha>`，不要用会丢失历史的 `git reset --hard`。
7. D1 恢复属于破坏性线上操作。只有用户明确批准并确认目标备份后，才可执行恢复；恢复前还要再次导出当时的 D1。

如果 D1 备份失败、备份校验失败、测试失败或无法产生独立 commit SHA，不得宣称该逻辑改动任务已完成。

## 根目录文件

- `index.html`
  - 主应用入口，体量很大，包含 Tailwind CDN 产物、品牌样式、打印样式、内嵌状态、GitHub 同步 bootstrap、业务逻辑和大量全局函数。
  - 主要功能包括五页报价单、报价保存/加载/删除、PV/光储/ROI 计算、成本与利润设置、安装商报价设置、供应商信息表单与评级漏斗、产品清单、Price List、市场价趋势、库存管理、销售出库、历史库存、运输管理、认证附件、PDF 合并导出和 Site Overview 屋顶编辑器。
  - 修改前务必搜索相关 `id`、`window.*` 全局函数、localStorage key、内嵌状态字段和打印/PDF 逻辑。

- `module_body.js`
  - 从主页面抽取或镜像的大段脚本主体，便于开发、比对或模块化处理。
  - 当前仓库只看到 `module_body.js`，未看到 `module_body.mjs`；如果修改的是与主页面共享的浏览器逻辑，需要确认它是否要同步更新。

- `multi_page_quote.js` / `multi_page_i18n.js`
  - 多页报价功能的独立脚本片段或历史抽取稿。当前生产入口仍以 `index.html` 内联逻辑为准，使用前要确认是否仍被页面引用。

- `training.html`
  - 独立页面/实验页面。不要把它当作主应用入口，除非任务明确指向它。

- `pages.yml`
  - 根目录中的 GitHub Pages workflow 版本。
  - 当前 `.github/workflows/pages.yml` 才是 GitHub Actions 默认读取位置；如需改部署流程，两处文件关系要先确认。

- `logo.png` / `logo-horizontal.png`
  - 品牌图片资源，供页面、报价或 PDF 使用。

- `.trae/`
  - Trae/Codex 相关规则和历史文档。通常只读参考，不要把它当作运行时依赖。

- `.worktrees/`
  - 工作树目录。一般不要手动改动。

## 目录结构

### `github-sync/`

浏览器端 GitHub 同步模块，使用 ES Module 风格，配套 Node 测试。

- `bootstrap.js`：对外初始化入口，连接同步核心和 UI。
- `sync.js`：同步协调器，创建 `createGitHubSync({ getLocalState, applyRemoteState })`，管理配置、加密 token、拉取远端状态、推送快照、发布 `index.html` 和审计记录。
- `repoStore.js`：封装仓库文件读写，`commitTextFiles()` 可一次提交多个文本文件或删除文件，发布和报价保存都会用到。
- `merge.js`：状态合并策略。当前会合并产品、库存、销售、运输、供应商、市场价、删除日志等集合，并用 `deletedRecordIds` 避免市场价删除后被远端复活。
- `githubApi.js`、`crypto.js`、`queue.js`、`storage.js`、`ui.js`、`oauthDeviceFlow.js`：分别处理 REST API、PAT 加密、离线队列、localStorage、同步弹窗和 OAuth Device Flow。
- `test/*.test.mjs`：Node 测试覆盖 crypto、GitHub API、queue、merge 等。

同步相关 localStorage keys：

- `minova_github_sync_config_v1`
- `minova_github_token_enc_v1`
- `minova_github_sync_queue_v1`
- `minova_github_sync_audit_v1`

### `worker/` 与 `auth/`

- `worker/src/index.mjs`：Cloudflare Worker API，处理认证、会话、RBAC、用户管理、审批、审计、业务实体、设置与已保存报价。
- `worker/wrangler.jsonc`：Worker 与 D1 配置。D1 名称为 `minova-auth-db`，binding 为 `minova_auth_db`。
- `worker/migrations/`：D1 schema migration；远程 migration 前必须先完成 D1 备份。
- `auth/permission-core.mjs`：前后端共享的角色、权限、敏感字段和报价审批规则。
- `auth/minova-auth-ui.mjs`：登录与管理后台 UI、D1 bootstrap、写入重试队列和业务数据 API。
- `worker/scripts/backup-d1.sh`：标准远程 D1 备份入口，由 `worker/package.json` 的 `backup:d1` 调用。

### `minova-data/`

业务数据、报价快照和认证附件目录。

- `state.json`
  - 与 `index.html` 内嵌状态对应的主业务状态文件。
  - `data` 通常包含：`products`、`inventory`、`inventoryHistory`、`marketPrices`、`salesRecords`、`historicalInventory`、`suppliers`、`companyCerts`、`transportRecords`、`fileDeleteLogs`、`subcategoriesByCategory`、`profitSettings`、`installerProfitSettings`、`installerQuoteSettings`。

- `quotes/`
  - 保存报价单快照。`index.json` 存报价列表与元数据；每个 `<quote-id>.json` 存 `snapshot`。
  - GitHub 已连接时，保存/删除报价会通过 `commitTextFiles()` 更新 `minova-data/quotes/index.json` 和对应报价文件；未连接时使用 IndexedDB `MinovaQuotesDB` / `quotes` 作为本地 fallback。
  - 报价快照会保存 DOM fields 以及 `quoteRows`、`validityDays`、`quoteSplit`、`partBreakdownData`、`referenceBlocks`、`roofBackground`、`pvModules`、`siteOverview`。

- `certifications/`
  - PDF/图片认证、规格书、运输附件等文件。
  - 当前有 `iso/`、`transport/`、`products/<productId>/tuv/` 等目录。
  - 路径和文件名可能包含中文、空格和括号，处理时使用 URL/path 安全编码，不要手写脆弱拼接。

- `certification-defaults.json`
  - `index.html` 会尝试从这里加载认证默认配置；当前工作树未看到该文件时会使用页面内 fallback。新增或恢复此文件时要确认 `refreshCertificationDefaults()` 和产品弹窗自动填充逻辑。

### `docs/`

项目计划、设计说明和本项目专用 skill。

- `docs/superpowers/plans/`
  - 历史开发计划和 bugfix 计划。

- `docs/skills/minova-web-optimizer/SKILL.md`
  - 面向 Minova 项目修改的专用 agent 指南。修改 Minova 网页、报价、同步、PDF、状态结构或前端体验时优先参考。

### `test/`

- `test/installer-cost.test.mjs`
  - 从 `index.html` 的 `INSTALLER_QUOTE_MODEL_START/END` 代码块提取安装商报价模型并验证 RESI / C&I 成本计算。

## 关键数据流

1. 页面打开时先用 `index.html` 内的 `minova-embedded-state` 或静态状态建立可用界面。
2. 登录后，`auth/minova-auth-ui.mjs` 从 Worker bootstrap D1 业务数据，并将其应用到页面状态；D1 是主数据优先来源。
3. 业务操作修改浏览器内存，并通过 `window.__minovaBusiness` 写入 D1；暂时失败的写入进入本地 D1 retry queue。
4. `saveToLocal()` 与 localStorage 保留浏览器 fallback；GitHub Sync 主要用于静态备份、发布和附件维护。
5. `window.buildUpdatedHtml()` 将当前状态重新序列化进 `index.html`，GitHub 发布流程可同时更新 `index.html` 和 `minova-data/state.json`。
6. 已保存报价优先写入 D1，同时保留 `minova-data/quotes/` 与 IndexedDB 等兼容/备份路径。

修改持久化字段时，通常要同时检查：

- 内嵌状态读取逻辑
- `applyStateFromData(data, ts)`
- `saveToLocal()`
- `window.buildUpdatedHtml()`
- `window.__minovaSync` 的 `getLocalState` / `applyRemoteState`
- `github-sync/merge.js`
- `minova-data/state.json` 的 shape
- localStorage fallback key
- `auth/minova-auth-ui.mjs` 的 business snapshot、D1 domain/settings mapping 与 retry queue
- `worker/src/index.mjs` 的 payload normalization、权限检查、bootstrap shape 与 SQL 写入
- `worker/migrations/` 是否需要 schema migration

## 报价与 PDF

报价模块当前是五页结构：

1. Quotation：客户信息、报价号、有效期、Solar Program、Payment Terms、Timeline、报价明细、产品 picker、分页分割。
2. Financial Analysis：太阳能方案输入、TNB/ATAP/ROI 计算、10 年/25 年视图。
3. Part Breakdown & Warranty：产品明细、品牌/产品图片、保修。
4. Reference：可上传参考图，支持说明文字、透明度、标题位置和图片块增删。
5. Site Overview：屋顶/组件/标注编辑器。

注意事项：

- `window.generateQuotationPDF` 当前指向 `window.openCertAttachmentModal`，PDF 导出前会先打开附件与页面选择弹窗。
- PDF 使用 `html2pdf.js` + `pdf-lib`，并可合并公司级 ISO/运输附件和产品级 TUV/规格书附件。
- `window.selectedPrintPages` 控制导出页，附件弹窗还可设置第 5 页 Site Overview 在 PDF 中右旋 90 度。
- 改报价布局时必须关注 `@media print`、`.no-print`、`.print-container`、`.quote-page`、A4 尺寸、html2canvas clone 逻辑和 page break marker。
- 报价明细中的数量可能由光伏方案自动计算，也可通过受保护的数量编辑弹窗手动覆盖；不要绕过 dirty 标记和自动数量同步逻辑。
- 已保存报价依赖 `captureQuoteSnapshot()` / `applyQuoteSnapshot()`，新增报价页字段或内存状态时必须确认快照保存和恢复。

## Site Overview

Site Overview 位于报价第 5 页，是当前最复杂的交互区域：

- 状态主要在 `roofBackground`、`pvModules`、`siteOverview`、`roofSelection`、`roofHistory`、`roofFuture` 等变量中。
- `siteOverview` 包含屋顶尺寸、组件尺寸、模块列表、测距/面积标注、样式 settings。
- 支持上传屋顶背景图、添加 PV module、添加自定义组件、复制/粘贴/批量添加、旋转、图层上移/置顶、删除、清空、撤销/重做。
- 自定义组件支持 rect、circle、triangle、diamond、hex、arrow、polygon，并有顶点锁定与顶点编辑模式。
- 标注支持距离线、面积块、marker 样式、方向约束、网格、标尺、吸附、移动锁定、比例锁定和框选。
- PDF 导出时可能使用 Site Overview 快照图和旋转设置；修改画布或 DOM 结构后要验证网页显示与 PDF 输出。

## 供应商与评级

供应商模块是产品档案的上游主数据，位于数据库页：

- UI 入口：
  - `#supplier-panel` 供应商信息表，包含漏斗汇总、等级筛选、搜索、排序和供应商列表。
  - `#supplier-modal` 新增/编辑供应商弹窗，包含基础信息、LOGO、漏斗评估、证据项、评分项和备注。
- 产品关联：
  - 产品通过 `supplierCode` 关联供应商，同时保留 `vendor` 作为展示名快照。
  - 新建或编辑产品时必须从供应商信息表单选择供应商，不能再随意输入孤立供应商名。
  - `ensureSupplierData()` 会规范化供应商、为旧的 `vendor` 名称自动生成供应商记录，并同步产品的 `supplierCode` 与 `vendor`。
- 供应商数据结构：
  - `code`：供应商编码，使用 `normalizeSupplierCode()` 统一为大写并清理非法字符。
  - `nameZh` / `nameEn`：中英文名称，`getSupplierDisplayName()` 组合展示。
  - `logoDataUrl`：供应商 LOGO，报价/Part Breakdown 可自动引用。
  - `stage`：确认后的漏斗等级。
  - `evaluation`：评分、证据、总分、建议等级和 `lastReviewedAt`。

评级漏斗规则：

- 等级定义在 `SUPPLIER_STAGES`：`info`、`research`、`trial`、`core`。
- 评分项定义在 `SUPPLIER_SCORE_FIELDS`，总权重 100。
- 分数等级：85+ 建议 `core`，70+ 建议 `trial`，50+ 建议 `research`，低于 50 建议 `info`。
- 证据门槛：`research` 需要到厂和准确报价；`trial` 还需要下单；`core` 还需要长期合作、优惠价格和账期。
- 保存时使用 `capSupplierStage()`，最终等级不能超过证据上限。

改供应商评级时要特别注意：

- 不要绕过 `normalizeSupplierRecord()`、`normalizeSupplierEvaluation()`、`normalizeSupplierScores()` 和 `normalizeSupplierEvidence()`。
- 调整阶段、评分项或权重时，同步检查列表表头、弹窗字段、筛选汇总、排序、预览文案、`state.json` 示例数据和本地缓存兼容。
- 改供应商名称或编码时，要确认产品 `supplierCode`、产品 `vendor` 展示名、ISO 认证文件 vendor 绑定、报价行品牌展示和 Part Breakdown 自动 LOGO 仍然一致。
- 删除供应商前当前逻辑会阻止删除已关联产品的供应商；不要移除这层保护，除非同时实现产品迁移流程。

## 库存、市场价与成本

- `marketPrices` 保存类目市场价记录、类目单位和删除记录 ID，Price List、产品 hover tooltip 和成本分析会引用它。
- 产品/库存单位会通过 `normalizeUnitLabel()`、`normalizeMarketUnit()` 等函数规范化，例如 `个` 会转为 `pcs`。
- 库存支持采购入库、批次、仓库、价格编辑、FIFO 销售出库、销售记录、库存历史和历史库存归档。
- 成本设置分为产品利润设置 `profitSettings`、安装商利润 `installerProfitSettings`、安装商报价参数 `installerQuoteSettings`。
- 安装商报价模型在 `index.html` 的 `INSTALLER_QUOTE_MODEL_START/END` 块内，改动后要运行 `node --test test/installer-cost.test.mjs`。

## 认证与附件

- 公司级附件：`companyCerts.isoCerts` 按供应商筛选，`companyCerts.transportCerts` 按运输记录/单号筛选。
- 产品级附件：保存在产品的 `certifications.tuvCerts` 和 `certifications.specSheets`。
- 上传会通过 GitHub commit 写入 `minova-data/certifications/...`，同时更新内存状态和 `state.json`。
- 删除附件需要 GitHub 已连接，会同时删除仓库文件、更新 `index.html` / `state.json`，并记录 `fileDeleteLogs`。
- PDF 附件选择弹窗会按报价上下文自动勾选匹配供应商、运输批次和报价产品的附件。

## UI 与业务注意事项

- 这是业务系统，不是营销页。界面要保持紧凑、可扫描、适合重复操作。
- 主要品牌色：紫色 `#582C83`，黄色 `#FFC107`。
- Tailwind 通过 CDN/内联产物使用，没有 Vite/Webpack 构建。
- 页面依赖 CDN：`xlsx`、`html2pdf.js`、`pdf-lib`。
- 大量交互依赖 `document.getElementById`、inline `onclick` 和 `window.*` 全局函数；改 ID 前必须全局搜索。
- 中英文和币种切换是核心能力，新增文案或字段时要考虑双语和 RM/¥ 转换。
- 业务状态、报价快照、PDF 输出经常共享同一批 DOM 字段；新增字段时要同时考虑保存、恢复、发布和导出。

## 本地运行

项目无需安装依赖即可预览主页面：

```bash
python3 -m http.server 8080
```

然后打开：

```text
http://localhost:8080/index.html
```

如果 `8080` 被占用，换下一个可用端口。

## 测试

GitHub 同步模块：

```bash
cd github-sync
node --test test/*.test.mjs
```

安装商报价模型：

```bash
node --test test/installer-cost.test.mjs
```

修改 `github-sync/` 时优先运行 GitHub 同步测试。修改安装商报价模型时运行 installer 测试。修改 `index.html` UI、Site Overview 或 PDF 时，还需要启动本地静态服务并做浏览器人工/自动检查对应流程。

### 隐藏页面与门禁检查

Minova 会在未连接 GitHub/PAT 且通过 HTTP 访问时限制 `quotation`、`costcalc`、`database`、`pricelist`、`inventory`、`transport` 等 tab；`window.switchTab()` 中的 `localFileMode` 会在 `file:` 协议下绕过这层限制。检查报价页、From Inventory、Price List、弹窗、hover 菜单或其它默认隐藏区域时，不要只检查当前可见页面：

- 首选直接用浏览器打开本地 `index.html` 文件（`file:///.../index.html`），或在控制台确认 `window.location.protocol === 'file:'` 后切换受限 tab。
- 若必须通过 HTTP 预览，则先输入/解锁 GitHub PAT 连接，让受限 tab 实际可访问后再检查。
- 对“全局改名/文案替换”这类任务，还要额外跑全 HTML 扫描，覆盖隐藏 DOM、HTML entity、模板字符串和动态拼接文案，例如：

```bash
LEGACY_LABEL='c(&amp;|&)'$'s|c\\u0026''s|c and ''s'
rg -ni "$LEGACY_LABEL" .
```

## 常见修改策略

1. 先用 `rg` 搜索相关函数、DOM id、storage key 和数据字段。
2. 判断改动属于主页面 UI、持久化状态、GitHub 同步、报价快照、库存/运输、认证文件、报价 PDF 还是 Site Overview。
3. 优先改最小拥有者文件，避免顺手重构大段 `index.html`。
4. 涉及同步逻辑时，先改 `github-sync/` 模块和测试，再确认 `index.html` 是否有内联镜像需要同步。
5. 涉及状态结构时，同步检查内嵌状态、`state.json`、localStorage、`buildUpdatedHtml()` 和 `mergeState()`。
6. 涉及已保存报价时，同步检查 `captureQuoteSnapshot()`、`applyQuoteSnapshot()`、`minova-data/quotes/index.json` 和 IndexedDB fallback。
7. 涉及附件文件时，注意 GitHub commit、删除日志、本地状态和中文路径编码。
8. 完成后至少运行相关 Node 测试；UI/PDF/Site Overview 改动还要本地预览，并按“隐藏页面与门禁检查”覆盖默认隐藏区域。

## 当前仓库观察

- Git 跟踪路径里根指南文件名显示为 `agents.md`，但当前工作区可通过 `AGENTS.md` 访问；大小写敏感环境中要留意。
- 当前工作树未看到 `Project_Wiki.md`、`BI_stats.html` 或 `module_body.mjs`。
- 根目录 `pages.yml` 与 `.github/workflows/pages.yml` 内容关系需要在改部署流程前重新确认。
- `docs/skills/minova-web-optimizer/SKILL.md` 是本仓库最贴近实战的开发约束文档，后续修改 Minova 业务时建议优先参考。
