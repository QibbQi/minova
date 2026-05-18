# Minova Agent Guide

本文件用于帮助后续 AI agent 或开发协作者快速理解当前仓库。修改代码前请先读这里，再按实际文件状态继续核对。

## 项目定位

Minova 是一个纯静态、前端优先的 GitHub Pages 业务工具，主要用于新能源产品报价、光储测算、供应商信息与评级、库存、运输、认证文件和报价 PDF 输出。项目没有传统后端和构建流程，仓库本身承担数据与发布载体。

核心运行方式：

- `index.html` 是生产入口，也是主要 UI、样式、状态和浏览器逻辑所在。
- `minova-data/state.json` 是持久化业务状态的 JSON 副本。
- `index.html` 内的 `<script id="minova-embedded-state" type="application/json">` 保存首屏可用的内嵌状态。
- `github-sync/` 提供浏览器到 GitHub 仓库的同步、发布、加密 token 和冲突合并逻辑。
- `.github/workflows/pages.yml` 和 `.github/workflows/redeploy.yml` 将整个仓库部署到 GitHub Pages。

## 根目录文件

- `index.html`
  - 主应用入口，体量很大，包含 Tailwind CDN、品牌样式、打印样式、嵌入状态、业务逻辑和大量全局函数。
  - 主要功能包括报价单、PV/光储计算、成本与利润设置、供应商信息表单与评级漏斗、产品清单、库存管理、运输管理、认证附件、保存报价、PDF 导出和 Site Overview 屋顶/组件编辑。
  - 修改前务必搜索相关 `id`、`window.*` 全局函数、localStorage key 和打印/PDF 逻辑。

- `module_body.js` / `module_body.mjs`
  - 从主页面抽取或镜像的大段脚本主体，便于开发、比对或模块化处理。
  - 如果修改的是与主页面共享的浏览器逻辑，需要确认这些文件和 `index.html` 是否需要同步。

- `Project_Wiki.md`
  - 项目说明文档，描述架构、模块职责、运行方式和同步机制。
  - 可作为背景资料，但以当前实际文件为准。

- `pages.yml`
  - 根目录中的 GitHub Pages workflow 版本。
  - 当前 `.github/workflows/pages.yml` 才是 GitHub Actions 默认读取位置；如需改部署流程，两处文件关系要先确认。

- `logo.png` / `logo-horizontal.png`
  - 品牌图片资源，供页面、报价或 PDF 使用。

- `.gitignore`
  - Git 忽略规则。

- `.trae/`
  - Trae/Codex 相关规则和历史计划文档。通常只读参考，不要把它当作运行时依赖。

- `.worktrees/`
  - 工作树目录。一般不要手动改动。

## 目录结构

### `github-sync/`

浏览器端 GitHub 同步模块，使用 ES Module 风格，配套 Node 测试。

- `bootstrap.js`
  - 对外初始化入口，连接同步核心和 UI。

- `sync.js`
  - 同步协调器，创建 `createGitHubSync({ getLocalState, applyRemoteState })`。
  - 管理配置、加密 token、拉取远端状态、推送快照、发布 `index.html` 和审计记录。
  - 本地 storage keys：
    - `minova_github_sync_config_v1`
    - `minova_github_token_enc_v1`
    - `minova_github_sync_queue_v1`
    - `minova_github_sync_audit_v1`

- `githubApi.js`
  - GitHub REST API 客户端。
  - 包含约 800ms 请求间隔、瞬时错误重试、rate limit 处理和 JSON/text 响应解析。

- `repoStore.js`
  - 封装仓库文件读写。
  - `getFile()` 读取 GitHub 文件内容。
  - `upsertJson()` 写入 JSON，并在冲突时读取最新远端状态后调用 `mergeState()` 合并。
  - `commitTextFiles()` 通过 Git blobs/trees/commits/ref update 一次提交多个文本文件，发布时常用于同时更新 `index.html` 和 `minova-data/state.json`。

- `merge.js`
  - 状态合并策略。
  - 当前策略偏向保留本地 `products` 和 `inventory`，合并 `inventoryHistory`，并合并 `subcategoriesByCategory` 与 `settings`。

- `crypto.js`
  - PAT 本地加密存储。
  - 使用 Web Crypto API：PBKDF2 派生密钥，AES-GCM 加解密。

- `queue.js`
  - 基于 storage 的异步队列，用于网络或连接不可用时暂存同步任务。

- `storage.js`
  - localStorage 访问封装。

- `ui.js`
  - GitHub 同步弹窗和按钮 UI。
  - 默认目标仓库配置在这里可见：`QibbQi/minova`、`main`、`minova-data/state.json`。

- `oauthDeviceFlow.js`
  - GitHub OAuth Device Flow 相关逻辑。

- `test/*.test.mjs`
  - Node 测试，覆盖 crypto、GitHub API、queue、merge 等。

### `minova-data/`

业务数据和认证附件目录。

- `state.json`
  - 与 `index.html` 内嵌状态对应的持久化数据文件。
  - 数据结构通常包含：
    - `products`
    - `inventory`
    - `inventoryHistory`
    - `salesRecords`
    - `historicalInventory`
    - `suppliers`
    - `companyCerts`
    - `transportRecords`
    - `fileDeleteLogs`
    - `subcategoriesByCategory`
    - `profitSettings`
    - `installerProfitSettings`

- `certification-defaults.json`
  - 认证/附件默认配置数据。

- `certifications/`
  - PDF 认证、规格书、运输附件等文件。
  - 当前包含：
    - `iso/`
    - `transport/`
    - `products/DC001/`
    - `products/GFZJ001/`
  - 路径和文件名可能包含中文、空格和括号，处理时要使用安全编码，不要手写脆弱的 URL/path 拼接。

### `docs/`

项目计划、设计说明和本项目专用 skill。

- `docs/superpowers/specs/`
  - 认证文件、附件设计等规格文档。

- `docs/superpowers/plans/`
  - 历史开发计划和 bugfix 计划。

- `docs/skills/minova-web-optimizer/SKILL.md`
  - 面向 Minova 项目修改的专用 agent 指南。
  - 对 UI 风格、持久化、GitHub 同步、PDF/打印、测试方式有非常有用的约束。

### `.github/workflows/`

- `pages.yml`
  - push 到 `main` 或手动触发时，将整个仓库作为 Pages artifact 部署。

- `redeploy.yml`
  - 手动重新部署 GitHub Pages。

## 关键数据流

1. 页面打开时优先使用 `index.html` 内的 `minova-embedded-state`。
2. 业务操作修改浏览器内存中的产品、库存、运输、认证、报价等状态。
3. `saveToLocal()` 把状态写入 localStorage，并触发或排队 GitHub 同步。
4. `window.buildUpdatedHtml()` 将当前状态重新序列化进 `index.html`。
5. GitHub 发布流程会同时提交更新后的 `index.html` 和 `minova-data/state.json`。
6. GitHub Pages workflow 部署仓库内容。

修改持久化字段时，通常要同时检查：

- 内嵌状态读取逻辑
- `applyStateFromData(data, ts)`
- `saveToLocal()`
- `window.buildUpdatedHtml()`
- GitHub sync 的 `getLocalState` / `applyRemoteState`
- `minova-data/state.json` 的 shape

## 供应商与评级

供应商模块是产品档案的上游主数据，位于 `index.html` 的数据库页：

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
  - 其他字段包括 `country`、`contact`、`contactInfo`、`website`、`address`、`notes`、`ts`。
- 本地与发布持久化：
  - localStorage key 是 `minova_suppliers_v1`。
  - `suppliers` 必须包含在内嵌状态、`applyStateFromData()`、`saveToLocal()`、`getLocalState` 和 `window.buildUpdatedHtml()` 中。
  - `minova-data/state.json` 也要保持同样结构。

评级漏斗规则：

- 等级定义在 `SUPPLIER_STAGES`：
  - `info`：资料储备级
  - `research`：实地调研级
  - `trial`：试单合作级
  - `core`：战略核心级
- 评分项定义在 `SUPPLIER_SCORE_FIELDS`，总权重 100：
  - 产品质量 18
  - 价格优势 14
  - 技术研发 12
  - 合作意愿 12
  - 生产产能 10
  - 售后支持 10
  - 类型覆盖 9
  - 出口经验 8
  - 公司规模 7
- 分数等级：
  - 85+ 建议 `core`
  - 70+ 建议 `trial`
  - 50+ 建议 `research`
  - 低于 50 建议 `info`
- 证据门槛：
  - `research` 需要 `factoryVisited` 和 `accurateQuote`。
  - `trial` 还需要至少一次下单：`firstOrderDone` 或 `orderCount > 0`。
  - `core` 还需要 `longTermCooperation`、`preferredPrice` 和 `creditTermDays > 0`。
- 保存时使用 `capSupplierStage()`，最终等级不能超过证据上限；预览区会显示建议等级、证据上限和缺失证据。
- `getSupplierWeakness()` 会按最低评分项显示当前短板，供应商列表支持按综合分、等级或名称排序。

改供应商评级时要特别注意：

- 不要绕过 `normalizeSupplierRecord()`、`normalizeSupplierEvaluation()`、`normalizeSupplierScores()` 和 `normalizeSupplierEvidence()`，这些函数负责兼容旧数据和限制范围。
- 调整阶段、评分项或权重时，同步检查列表表头、弹窗字段、筛选汇总、排序、预览文案、`state.json` 示例数据和本地缓存兼容。
- 改供应商名称或编码时，要确认产品 `supplierCode`、产品 `vendor` 展示名、ISO 认证文件 vendor 绑定、报价行品牌展示和 Part Breakdown 自动 LOGO 仍然一致。
- 删除供应商前当前逻辑会阻止删除已关联产品的供应商；不要移除这层保护，除非同时实现产品迁移流程。

## UI 与业务注意事项

- 这是业务系统，不是营销页。界面要保持紧凑、可扫描、适合重复操作。
- 主要品牌色：
  - 紫色：`#582C83`
  - 黄色：`#FFC107`
- Tailwind 通过 CDN 使用，没有 Vite/Webpack 构建。
- 大量交互依赖 `document.getElementById`、inline `onclick` 和 `window.*` 全局函数；改 ID 前必须全局搜索。
- 中英文和币种切换是核心能力，新增文案或字段时要考虑双语和货币转换。
- 报价 PDF/打印是核心能力，动报价布局时必须关注：
  - `@media print`
  - `.no-print`
  - `.print-container`
  - quote page visibility
  - page split / A4 尺寸 / html2canvas 或 PDF 生成相关逻辑
- Site Overview 屋顶编辑器包含复杂拖拽、缩放、测距、组件旋转、吸附和 PDF 输出逻辑，改动前先定位完整调用链。

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

GitHub 同步模块的测试在 `github-sync/test/`：

```bash
cd github-sync
node --test test/*.test.mjs
```

修改 `github-sync/` 时优先运行这些测试。修改 `index.html` UI 或 PDF 时，还需要浏览器人工/自动检查对应流程。

## 常见修改策略

1. 先用 `rg` 搜索相关函数、DOM id、storage key 和数据字段。
2. 判断改动属于主页面 UI、持久化状态、GitHub 同步、库存/运输、认证文件、报价 PDF 还是 Site Overview。
3. 优先改最小拥有者文件，避免顺手重构大段 `index.html`。
4. 涉及同步逻辑时，先改 `github-sync/` 模块和测试，再确认 `index.html` / `module_body.*` 是否需要同步。
5. 涉及状态结构时，同步检查内嵌状态、`state.json` 和本地缓存兼容性。
6. 涉及附件文件时，注意 GitHub commit、删除日志、本地状态和中文路径编码。
7. 完成后至少运行相关 Node 测试或本地静态服务预览。

## 当前仓库观察

- 工作区当前已有大量未提交或已修改文件，后续 agent 不应随意 revert 或清理无关变更。
- `Project_Wiki.md` 提到的 `BI_stats.html` 当前在工作树状态中显示为删除，实际根目录未见该文件。
- 根目录 `pages.yml` 与 `.github/workflows/pages.yml` 内容相近，但 GitHub Actions 实际使用 `.github/workflows/` 下的 workflow。
- `docs/skills/minova-web-optimizer/SKILL.md` 是本仓库最贴近实战的开发约束文档，后续修改 Minova 业务时建议优先参考。
