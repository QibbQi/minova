# EPC Off-Grid Core v4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add off-grid topology, graph validation, LV/MV architecture screening, cable screening, and Electrical Workspace UI to the current Minova EPC tab.

**Architecture:** Extend the existing EPC engine and browser global mirror with normalized topology/electrical outputs. Render the new outputs in compact `index.html` panels while keeping EPC projects as existing JSON payloads.

**Tech Stack:** Static HTML/Tailwind, browser JavaScript, ES modules, Node test runner, Cloudflare Worker/D1 JSON business data.

---

### Task 1: Add Documentation Artifacts

**Files:**
- Create: `docs/reviews/2026-06-16-hybrid-epc-v4-review.md`
- Create: `docs/superpowers/specs/2026-06-16-epc-offgrid-core-v4-design.md`
- Create: `docs/superpowers/plans/2026-06-16-epc-offgrid-core-v4-implementation.md`
- Create: `docs/superpowers/specs/2026-06-16-epc-grid-tied-roadmap.md`

- [ ] Add the four documents.
- [ ] Run `git diff --check`.

### Task 2: Add Engine Tests

**Files:**
- Modify: `test/epc-design-engine.test.mjs`

- [ ] Add failing tests for topology normalization and default `C5`.
- [ ] Add failing tests for validation errors and transformer-required suggestions.
- [ ] Add failing tests for architecture candidates, transformer sizing, cable screening, and protection matrix.
- [ ] Run `node --test test/epc-design-engine.test.mjs` and confirm the new tests fail before implementation.

### Task 3: Implement Engine Support

**Files:**
- Modify: `epc-design-engine.mjs`
- Modify: `epc-design-engine.global.js`

- [ ] Add topology constants and normalizers.
- [ ] Add off-grid standard topology builders.
- [ ] Add graph validation rules.
- [ ] Expand `calculateElectrical()` with architecture candidates, transformer summary, cable candidates, and protection matrix.
- [ ] Return topology and electrical outputs from `calculateEpcDesignProject()`.
- [ ] Run `node --test test/epc-design-engine.test.mjs`.

### Task 4: Add UI Tests

**Files:**
- Modify: `test/epc-design-ui-state.test.mjs`

- [ ] Add failing tests for Topology and Electrical tabs.
- [ ] Add failing tests for topology selector, LV/MV bus rendering, validation cards, architecture table, cable table, and protection matrix.
- [ ] Run `node --test test/epc-design-ui-state.test.mjs` and confirm the new tests fail before implementation.

### Task 5: Implement EPC Panels

**Files:**
- Modify: `index.html`

- [ ] Add `Topology` and `Electrical` panel tabs and containers.
- [ ] Render topology selector, SLD, graph tables, warnings/errors, and suggested fixes.
- [ ] Render architecture comparison, transformer summary, cable screening, protection matrix, and disclaimer.
- [ ] Persist selected topology through existing EPC project save paths.
- [ ] Run EPC-related tests.

### Task 6: Verification And Commit

**Files:**
- Verify all modified files.

- [ ] Run `node --test test/*.test.mjs`.
- [ ] Run `node --test github-sync/test/*.test.mjs`.
- [ ] Run `git diff --check`.
- [ ] Start `python3 -m http.server 8098` in the worktree and verify `index.html` renders the EPC Topology and Electrical panels.
- [ ] Commit with `git commit -m "Add EPC off-grid topology and electrical screening"`.
