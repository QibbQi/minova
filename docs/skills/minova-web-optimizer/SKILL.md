---
name: minova-web-optimizer
description: Use when modifying the Minova static GitHub Pages app, especially index.html UI, quote/PDF flows, GitHub sync, persisted state, supplier records, inventory, certifications, saved quotes, or Site Overview behavior.
---

# Minova Web Optimizer

## Core Posture

Work as a careful maintainer of a static business tool. Read `AGENTS.md` first, then verify the exact current code path with `rg` before editing. Prefer small, compatible changes over broad rewrites because `index.html` owns most UI, state, and browser behavior.

## First Checks

- Search related DOM ids, `window.*` globals, localStorage keys, state fields, print CSS, and PDF code before changing behavior.
- Treat `index.html` as the production source. `module_body.js`, `multi_page_quote.js`, and `multi_page_i18n.js` may be mirrors or older extracts; update them only after confirming they are relevant to the request.
- For state changes, check `applyStateFromData()`, `saveToLocal()`, `window.buildUpdatedHtml()`, `window.__minovaSync` `getLocalState`, `github-sync/merge.js`, `minova-data/state.json`, and localStorage fallback keys.
- For saved quote changes, separately check `captureQuoteSnapshot()`, `applyQuoteSnapshot()`, `saveQuoteInternal()`, `minova-data/quotes/index.json`, per-quote JSON files, and IndexedDB fallback.

## Frontend Style

- Keep the UI compact, scannable, and operations-focused. Minova is an internal business tool, not a marketing site.
- Preserve the brand anchors: purple `#582C83` and yellow `#FFC107`, with restrained neutral UI around them.
- Use existing Tailwind/inline patterns, `document.getElementById`, inline `onclick`, and `window.*` functions unless there is a clear local pattern to do otherwise.
- Maintain bilingual and currency behavior when adding text or calculations. Check `toggleLanguage()`, `toggleCurrency()`, i18n objects, RM/¥ labels, and exchange-rate usage.

## Quote And PDF

- The quotation flow has five pages: Quotation, Financial Analysis, Part Breakdown & Warranty, Reference, and Site Overview.
- `window.generateQuotationPDF` opens the certification/page-selection modal. Do not bypass the modal unless the task explicitly asks.
- PDF export relies on `html2pdf.js`, `pdf-lib`, `.quote-page`, `.no-print`, `.print-container`, page visibility, A4 dimensions, and clone-time DOM adjustments.
- Quote snapshots must restore both DOM fields and in-memory objects: `quoteRows`, `validityDays`, `quoteSplit`, `partBreakdownData`, `referenceBlocks`, `roofBackground`, `pvModules`, and `siteOverview`.
- When adding a quote field, make sure it survives save/load, dirty tracking, language/currency changes, and PDF export.

## Site Overview

- Treat Site Overview as a canvas-like editor embedded in normal DOM, not a simple static image.
- Preserve roof editor state across saved quote snapshots: background, modules, custom shapes, measurements, settings, selection reset, and history reset.
- Be careful with tool modes: module selection, measurement selection, distance, area, and vertex editing share event handlers.
- Verify changes that touch snap, rulers, grid, locks, undo/redo, copy/duplicate, layers, custom polygons, or PDF rotation in the browser.

## Data Domains

- Suppliers are upstream master data. Products use `supplierCode` and retain `vendor` as a display snapshot. Use supplier normalization helpers instead of direct ad hoc edits.
- Market prices live in `marketPrices.records`, `categoryUnits`, and `deletedRecordIds`; avoid resurrecting deleted records during merge.
- Inventory includes purchase batches, pricing, FIFO sales-out, sales records, operation history, and historical inventory archive.
- Certifications include company ISO/transport files and product TUV/spec files. Upload/delete paths must stay compatible with GitHub commits and Chinese filenames.
- Installer quote formulas live between `INSTALLER_QUOTE_MODEL_START` and `INSTALLER_QUOTE_MODEL_END`; update `test/installer-cost.test.mjs` when behavior changes.

## Verification

- For `github-sync/` changes, run:

```bash
cd github-sync
node --test test/*.test.mjs
```

- For installer quote model changes, run:

```bash
node --test test/installer-cost.test.mjs
```

- For UI, PDF, saved quotes, attachments, or Site Overview changes, start a local static server and verify the affected workflow in a browser:

```bash
python3 -m http.server 8080
```

- For documentation-only changes, run lightweight validation such as Markdown/frontmatter checks and `git diff --check`.

## Common Pitfalls

- Do not assume `minova-data/state.json` contains saved quotes; saved quotes live under `minova-data/quotes/`.
- Do not add persistent fields only to localStorage; published state and embedded state must also know about them.
- Do not rename DOM ids casually. Many handlers and snapshot code depend on ids.
- Do not delete supplier protection, attachment delete logs, or market price deletion tracking without implementing the matching migration.
- Do not trust extracted scripts or older docs over the current `index.html`.
