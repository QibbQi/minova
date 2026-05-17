---
name: minova-web-optimizer
description: Use when optimizing or modifying the Minova GitHub Pages web project, especially index.html, module_body.js, minova-data/state.json, GitHub sync, saved quotes, quotation PDF output, inventory, transport, certifications, or PV/site overview UI.
---

# Minova Web Optimizer

## Project Shape

Minova is a pure static, front-end-only GitHub Pages app. Treat the repository itself as the backend:

- `index.html` is the production entry and contains the rendered UI, inline styles, embedded app state, and main browser logic.
- `module_body.js` and `module_body.mjs` mirror large script bodies used for development/extraction. Keep behavior aligned with `index.html` when touching shared logic.
- `minova-data/state.json` stores the persisted app state in the same shape as the embedded state inside `index.html`.
- `github-sync/` is the modular, testable ES module implementation for browser-to-GitHub sync.
- `pages.yml` deploys the full repository to GitHub Pages from `main`; there is no build step.

The app is a business tool, not a marketing site. Keep interfaces dense, operational, bilingual-aware, and reliable for repeated use.

## Core Features

Main navigation tabs:

- Quotation generation: multi-page quote, saved quotes, PDF output, customer/timeline/payment terms, part breakdown, reference, and site overview.
- PV calculation: photovoltaic and storage calculations, including roof/site overview tooling.
- Cost settings: product pricing, margins, installer profit settings, and category/subcategory profit rules.
- Product list: product catalog with certifications/spec files.
- Inventory management: purchase batches, stock history, valuation, and sales records.
- Transport management: shipment records and certification attachments.

Primary state fields:

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

## Data And Persistence

Use these rules when changing persistence:

- Embedded state lives in `<script id="minova-embedded-state" type="application/json">`.
- `window.buildUpdatedHtml()` serializes the current state back into `index.html` and also drives publishing.
- `minova-data/state.json` should remain a pretty-printed JSON counterpart to the embedded state.
- `saveToLocal()` updates browser-local state and queues GitHub sync unless sync is suppressed.
- `applyStateFromData(data, ts)` is the central path for applying remote or embedded state.
- Company certifications also fall back to `localStorage` key `minova_company_certs`.
- Transport records also use local fallback storage.
- Saved quotes use GitHub files when connected:
  - index: `minova-data/quotes/index.json`
  - detail: `minova-data/quotes/{id}.json`
  - fallback: IndexedDB database `MinovaQuotesDB`, store `quotes`

Prefer updating existing state shapes over introducing parallel storage. When adding a new durable field, add it to embedded load, `getLocalState`, `applyStateFromData`, `buildUpdatedHtml`, and `minova-data/state.json` expectations together.

## GitHub Sync

The browser sync system is intentionally serverless:

- `initGitHubSync` / `createGitHubSync` wires local state capture, remote apply, encrypted token storage, GitHub API calls, publishing, and audit.
- Local sync keys are:
  - `minova_github_sync_config_v1`
  - `minova_github_token_enc_v1`
  - `minova_github_sync_queue_v1`
  - `minova_github_sync_audit_v1`
- Token storage uses Web Crypto: PBKDF2 with 200,000 iterations plus AES-GCM.
- GitHub API requests use rate limiting around 800 ms and retry transient failures.
- `repoStore.commitTextFiles()` uses Git blobs, trees, commits, and ref updates for multi-file commits.
- `repoStore.upsertJson()` handles conflicts by re-reading remote state and merging.
- `mergeState()` keeps local products/inventory as current, merges inventory history by synthetic event key, and merges settings/subcategories.

When changing sync, update modular files under `github-sync/` first, then reflect browser-bundled logic in `index.html` or `module_body.*` if needed. Add or update tests under `github-sync/test/`.

## UI Conventions

Preserve the existing visual language:

- Tailwind is used through CDN in `index.html`; there is no bundler.
- Brand purple is `#582C83`; brand yellow is `#FFC107`.
- Keep controls compact, table-friendly, and workflow-focused.
- Maintain bilingual Chinese/English labels and currency switching behavior.
- Use existing modal, toast, and button patterns before adding new UI patterns.
- Avoid changing IDs casually; many handlers use `document.getElementById` and global `window.*` functions.
- Many editable fields are `input`, `textarea`, or `contenteditable`; make sure saved quote dirty tracking still works.
- Print/PDF behavior is a first-class feature. Check `@media print`, `.no-print`, `.print-container`, page split logic, and quotation page visibility whenever touching quote layout.

## Coding Habits

Follow these habits:

- Keep edits narrow. The large `index.html` has many global functions and shared variables.
- Search for an ID/function before changing it; behavior may be referenced far below the markup.
- Use existing global hooks like `window.__minovaSync`, `window.buildUpdatedHtml`, `window.showToast`, `window.startBusyToast`, `window.finishBusyToast`, `window.setQuoteDirty`, and quote snapshot helpers.
- For saved quote changes, preserve GitHub-connected behavior and IndexedDB fallback behavior.
- For data changes, preserve both live state arrays and rendered UI refresh calls.
- For file/certification changes, preserve GitHub commit behavior and local state update behavior.
- For roof/site overview or PDF changes, verify both interactive display and generated/printed output.
- Do not add a build system unless the user explicitly asks for a larger migration.

## Verification

Use lightweight checks first:

- Serve locally with `python3 -m http.server 8080` and open `http://localhost:8080/index.html`.
- If port `8080` is occupied, use the next available port.
- After editing `index.html`, visually check the affected tab and any related modal/PDF view.
- For GitHub sync code, run Node tests from `github-sync`.
- Useful test target: `node --test test/*.test.mjs` from `github-sync`.
- If modifying persistent state, compare embedded state and `minova-data/state.json` shape.

## Typical Change Checklist

1. Identify whether the change is markup, global browser logic, persisted state, GitHub sync, or print/PDF.
2. Search all references to changed IDs, functions, global variables, and storage keys.
3. Update the smallest code surface that owns the behavior.
4. Preserve connected GitHub behavior and offline/local fallback behavior.
5. Render or test the affected flow.
6. Document any remaining manual check that needs a real GitHub token or browser PDF export.
