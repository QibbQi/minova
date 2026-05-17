# Minova 项目 Code Wiki

## 1. 项目整体架构

Minova 是一个**基于纯前端架构的 AI 智能报价管理系统**。它的核心架构设计非常轻量且巧妙，采用 **Serverless（无服务器）** 的思想，将 GitHub 仓库本身作为数据库和后端服务。

- **纯静态单页面应用 (SPA)**：系统主体是一个极其轻量的单 HTML 文件 (`index.html`)，所有的 UI 和业务逻辑都在前端运行。
- **状态内嵌与分离**：页面的初始状态通过 `<script id="minova-embedded-state">` 内嵌在 HTML 中，保证了在 GitHub Pages 上访问时的首屏加载速度；同时数据又独立存储在 JSON 文件中以便于持久化。
- **基于 GitHub 的数据同步**：项目包含一个独立且完整的 `github-sync` 模块，通过 GitHub REST API 将前端的业务状态实时、安全地同步回 GitHub 仓库，实现了免搭建传统后端的全托管运行。
- **BI 统计面板**：提供一个独立的 `BI_stats.html` 数据大屏，直接读取本地或内嵌的业务状态，展示销售、库存、毛利等可视化统计信息。

---

## 2. 主要模块职责

### 核心主应用
- **`index.html`**：系统的唯一入口文件和主程序。
  - **职责**：负责整个应用的用户界面渲染和核心业务逻辑。包含多个功能选项卡：报价生成 (Quotation)、光储计算 (PV Calc)、报价设置 (Cost Calc)、产品清单 (Database)、库存管理 (Inventory) 以及运输管理 (Transport)。
  - **特性**：内置针对 PDF 导出的自定义打印样式 (`@media print`)，支持中英文切换以及多币种计算。

- **`BI_stats.html`**：商业智能（BI）数据看板。
  - **职责**：读取本地缓存（`localStorage`）或解析 `index.html` 中的内嵌状态，动态生成图表和报表，支持按时间范围筛选的销售额、毛利、库存估值等核心指标展示。

### GitHub 数据同步模块 (`github-sync/`)
这是一个基于 ES Module 编写的独立模块，专门用于处理浏览器与 GitHub 仓库之间的数据通信、状态合并与身份验证。
- **`sync.js`**：同步模块的协调器。负责组装各子模块，管理同步操作（如提取、推送快照）、发布静态页面，并记录操作审计日志（Audit Log）。
- **`githubApi.js`**：GitHub REST API 的底层客户端。内置了基于 800ms 间隔的请求速率限制器 (Rate Limiter) 和指数退避重试机制，防止因频繁请求触发 GitHub 的 API 限制。
- **`repoStore.js`**：封装了针对 GitHub 仓库具体文件的读写操作。支持 `upsertJson` 和 `upsertText`（处理 409 冲突重试），以及通过 Git Trees API 实现多文件原子提交 (`commitTextFiles`)。
- **`crypto.js`**：负责 GitHub Personal Access Token (PAT) 的加密存储。使用 Web Crypto API 的 PBKDF2（20万次迭代）和 AES-GCM 算法，确保用户口令在本地 `localStorage` 中的绝对安全。
- **`queue.js`**：基于 `localStorage` 持久化的异步任务队列，用于在网络不稳定时暂存需要同步的快照 (Snapshot)，待连接恢复后统一清空。
- **`merge.js` & `ui.js`**：前者负责处理多端修改时的数据合并冲突（远端优先，但保留本地独有的历史记录）；后者负责 GitHub 连接管理的弹窗 UI。

### 数据存储 (`minova-data/`)
- **`state.json`**：存储系统的全局 JSON 状态（如产品库、库存、设置等）。
- **`certifications/`**：存放各产品的资质文件、规格书及 TUV 认证文件等 PDF 文档。

---

## 3. 关键类与函数说明

### 核心前端逻辑
- **`tryLoadEmbeddedStateFromIndexHtml()`**：从 `index.html` 的特定 `<script>` 标签中提取并解析内嵌的 JSON 状态，用于实现纯静态的离线/在线混合应用初始化。
- **`computeInventoryAgg(state)` / `computeSalesAgg(state, range)`**：BI 看板中的核心数据聚合函数，负责根据状态计算库存总值、销售排行、毛利率等关键指标。

### GitHub 同步引擎
- **`createGitHubSync({ getLocalState, applyRemoteState })`**  [`sync.js`](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github Project/minova/github-sync/sync.js)
  - **核心协调工厂**：初始化 `githubApi` 和 `repoStore`，暴露 `unlock` (解锁 Token), `pull` (拉取远端数据), `pushSnapshot` (推送本地快照) 和 `publishIndexHtml` (提交网页和状态更新触发部署) 等核心方法。
- **`upsertJson({ owner, repo, path, branch, message, next })`** [`repoStore.js`](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github Project/minova/github-sync/repoStore.js)
  - **容错型 JSON 写入**：在向 GitHub 更新状态文件时，如果遇到 `409 Conflict` (由于其他端同时更新引起)，会自动拉取最新状态并执行状态合并 (`mergeState`) 后再次重试。
- **`commitTextFiles({ owner, repo, branch, message, files })`** [`repoStore.js`](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github Project/minova/github-sync/repoStore.js)
  - **Git 树提交函数**：不使用简单的文件更新 API，而是直接操作底层的 Git Blob、Git Tree 和 Git Commit API，将 `index.html` 和 `state.json` 的更新打包成一次原子提交。
- **`encryptWithPassphrase(passphrase, plaintext)`** [`crypto.js`](file:///Users/jqz/Library/CloudStorage/OneDrive-个人/Github Project/minova/github-sync/crypto.js)
  - **密码学函数**：在前端生成随机 `salt` 和 `iv`，通过用户输入的密码派生密钥，对 GitHub Token 进行安全的 AES-GCM 加密，并返回含盐值和初始向量的密文包。

---

## 4. 依赖关系

由于是无服务器纯前端架构，项目的依赖极其精简：
- **Tailwind CSS**：通过 CDN 引入 (`<script src="https://cdn.tailwindcss.com"></script>`)，负责全局的响应式布局和 UI 样式。
- **Web 标准 API**：
  - `crypto.subtle`：用于浏览器端的高强度加密解密。
  - `localStorage`：用于缓存本地未同步的任务队列和加密后的 Token。
  - `fetch`：配合 GitHub REST API 完成数据持久化。
- **Node.js 环境**：仅用于运行 `github-sync` 模块的单元测试，项目代码本身不依赖 Node 运行。

---

## 5. CI/CD 与自动化部署

项目采用 GitOps 模式，高度依赖 GitHub Actions 来完成部署：
- **`pages.yml`**：监听 `main` 分支的 `push` 事件。每次前端在页面中触发 "发布" 操作时，`sync.js` 会通过 API 提交修改后的 `index.html` 到 `main` 分支，此举自动触发 GitHub Actions，将最新的代码部署到 GitHub Pages 上。
- **`redeploy.yml`**：提供了一个支持 `workflow_dispatch` 手动触发部署的工作流，用于紧急或手动修复部署。

---

## 6. 项目运行方式

### 本地开发与预览
系统不需要复杂的 Webpack/Vite 等构建工具，可以直接在本地起静态服务预览。
根据项目 `.trae/rules/project_rules.md` 中的开发约定，项目支持自动化的本地热重载：

1. 在项目根目录下运行以下命令启动服务：
   ```bash
   python3 -m http.server 8080
   ```
2. **自动化约定**：每次修改 `index.html` 或相关代码后，系统会自动打开新窗口运行 `python3 -m http.server` 刷新页面；若遇到端口冲突，会自动寻找下一个可用端口。
3. 在浏览器中打开 `http://localhost:8080/index.html` (主系统) 或 `http://localhost:8080/BI_stats.html` (数据看板)。

### 运行测试
`github-sync` 模块包含一套完整的测试用例（位于 `github-sync/test/` 目录下），用于校验加解密、API 队列等核心逻辑。在本地环境确保已安装 Node.js 后执行：
```bash
cd github-sync
node test/*.test.mjs
```

### 系统发布
在开发完成后，无需手动执行 build，只需将代码提交 (Push) 至 `main` 分支，即可触发 GitHub Pages 自动部署。如果是在页面端，用户也可以直接点击界面的「GitHub 同步发布」功能，通过代码层面的 API 自动推送变更。