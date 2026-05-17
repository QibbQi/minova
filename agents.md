# Minova Agent Guide

本文件用于帮助后续 AI agent 或开发协作者快速理解当前仓库。修改代码前请先读这里，再按实际文件状态继续核对。

## 项目定位

Minova 是一个纯静态、前端优先的 GitHub Pages 业务工具，主要用于新能源产品报价、光储测算、库存、运输、认证文件和报价 PDF 输出。项目没有传统后端和构建流程，仓库本身承担数据与发布载体。

核心运行方式：

- `index.html` 是生产入口，也是主要 UI、样式、状态和浏览器逻辑所在。
- `minova-data/state.json` 是持久化业务状态的 JSON 副本。
- `index.html` 内的 `<script id="minova-embedded-state" type="application/json">` 保存首屏可用的内嵌状态。
- `github-sync/` 提供浏览器到 GitHub 仓库的同步、发布、加密 token 和冲突合并逻辑。
- `.github/workflows/pages.yml` 和 `.github/workflows/redeploy.yml` 将整个仓库部署到 GitHub Pages。

## 根目录文件

- `index.html`
  - 主应用入口，体量很大，包含 Tailwind CDN、品牌样式、打印样式、嵌入状态、业务逻辑和大量全局函数。
  - 主要功能包括报价单、PV/光储计算、成本与利润设置、产品清单、库存管理、运输管理、认证附件、保存报价、PDF 导出和 Site Overview 屋顶/组件编辑。
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

