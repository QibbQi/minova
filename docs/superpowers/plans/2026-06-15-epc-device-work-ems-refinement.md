# EPC Device Work And EMS Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix active-window shock placement, unify DC/AC Ratio, and make PCS-limited EMS dispatch and table aggregation explicit and auditable.

**Architecture:** Keep EPC sizing in `epc-design-engine.mjs` and its browser global mirror, while `index.html` owns the derived Device Work/EMS display profile. Normalize new project settings once, dispatch every row at five-minute resolution, and aggregate only for display.

**Tech Stack:** Static HTML/Tailwind, browser JavaScript, ES modules, Node test runner, SVG energy-flow diagram.

---

### Task 1: Normalize DC/AC Ratio And EMS Table Interval

**Files:**
- Modify: `epc-design-engine.mjs`
- Modify: `epc-design-engine.global.js`
- Test: `test/epc-design-engine.test.mjs`

- [ ] **Step 1: Write failing normalization tests**

Add assertions that a project preserves `assumptions.pvDcAcRatio`, clamps invalid values to `1.2`, preserves `emsTableIntervalMinutes: 5`, defaults to `60`, and maps legacy `mergeHourly: false` to `5`.

```js
assert.equal(project.assumptions.pvDcAcRatio, 1.35);
assert.equal(project.emsFlowDisplaySettings.emsTableIntervalMinutes, 5);
assert.equal(defaultProject.assumptions.pvDcAcRatio, 1.2);
assert.equal(defaultProject.emsFlowDisplaySettings.emsTableIntervalMinutes, 60);
```

- [ ] **Step 2: Verify the tests fail**

Run: `node --test test/epc-design-engine.test.mjs`

Expected: FAIL because the canonical ratio and interval are not normalized yet.

- [ ] **Step 3: Add minimal normalization**

Normalize the fields identically in both engine files:

```js
pvDcAcRatio: Math.max(1, Number(input.pvDcAcRatio) || 1.2)
```

```js
emsTableIntervalMinutes: [5, 60].includes(Number(input.emsTableIntervalMinutes))
  ? Number(input.emsTableIntervalMinutes)
  : (input.mergeHourly === false ? 5 : 60)
```

- [ ] **Step 4: Verify normalization tests pass**

Run: `node --test test/epc-design-engine.test.mjs`

Expected: PASS.

### Task 2: Fix Active-Window Shock Placement

**Files:**
- Modify: `index.html`
- Test: `test/epc-design-ui-state.test.mjs`

- [ ] **Step 1: Write failing static contract tests**

Require a helper named `getEpcDeviceWorkActiveWindow` and assertions that shock placement uses `activeWindow.firstMinute` and `activeWindow.span`, not `rows[0]` and the full source span.

```js
assert.match(html, /function getEpcDeviceWorkActiveWindow\(/);
assert.match(shockSource[0], /const activeWindow = getEpcDeviceWorkActiveWindow/);
```

- [ ] **Step 2: Verify the UI test fails**

Run: `node --test test/epc-design-ui-state.test.mjs`

Expected: FAIL because shock placement still uses the complete timeline.

- [ ] **Step 3: Implement the active window helper**

For Load, use rows with `baseLoadKw > 0 || loadKw > 0`. For Genset, use rows where load is active or a residual deficit exists. Return the first active minute and the last active row end minute. Use those bounds for all position presets.

```js
function getEpcDeviceWorkActiveWindow(rows = [], component = 'load') {
  const active = rows.filter(row => component === 'genset'
    ? Number(row.loadKw) > 0 || Number(row.gensetToLoadKw) > 0
    : Number(row.baseLoadKw ?? row.loadKw) > 0);
  // Return firstMinute, lastMinute, and span with full-row fallback.
}
```

- [ ] **Step 4: Verify shock tests pass**

Run: `node --test test/epc-design-ui-state.test.mjs`

Expected: PASS.

### Task 3: Re-layout Model Controls And Add Load Summary

**Files:**
- Modify: `index.html`
- Test: `test/epc-design-ui-state.test.mjs`

- [ ] **Step 1: Write failing UI structure tests**

Require `data-epc-device-model-row="load"`, `data-epc-device-model-row="genset"`, and `renderEpcDeviceWorkLoadSummaryRow`. Assert that the rendered controls no longer contain IDs `epc-device-work-genset-step-enabled` or `epc-device-work-genset-platforms`.

- [ ] **Step 2: Verify the UI test fails**

Run: `node --test test/epc-design-ui-state.test.mjs`

Expected: FAIL on missing rows/summary and visible platform controls.

- [ ] **Step 3: Render two model rows**

Keep the apply-to-EMS checkbox in the header. Render all Load controls in the LOAD row and Genset shock controls in the GENSET row. In `updateEpcDeviceWorkModelSettings()`, preserve hidden platform values from `current`:

```js
gensetStepEnabled: current.gensetStepEnabled !== false,
gensetPlatforms: current.gensetPlatforms
```

- [ ] **Step 4: Add a sticky Load Work summary row**

Calculate duration-weighted average kW for each power column, total modeled load kWh, and final SOC. Render it in `<tfoot class="sticky bottom-0">`.

- [ ] **Step 5: Verify the UI tests pass**

Run: `node --test test/epc-design-ui-state.test.mjs`

Expected: PASS.

### Task 4: Wire Detail Inputs To PV Simulator DC/AC Ratio

**Files:**
- Modify: `index.html`
- Test: `test/epc-design-ui-state.test.mjs`

- [ ] **Step 1: Write failing UI/state tests**

Require a Detail Inputs control `epc-design-dc-ac-ratio`, project binding to `assumptions.pvDcAcRatio`, and a read-only PV Simulator ratio value sourced from the normalized project.

- [ ] **Step 2: Verify the test fails**

Run: `node --test test/epc-design-ui-state.test.mjs`

Expected: FAIL because the ratio is simulator-local.

- [ ] **Step 3: Add and bind the engineering input**

Add `DC/AC Ratio` beside the PV-related detail fields with default `1.20`. Update `getEpcPvSimulatorSettings()` to prefer `project.assumptions.pvDcAcRatio`, then compatibility fallback `stored.dcAcRatio`, then `1.2`. Render the simulator field read-only.

- [ ] **Step 4: Verify UI/state tests pass**

Run: `node --test test/epc-design-ui-state.test.mjs`

Expected: PASS.

### Task 5: Expose PCS-Limited Dispatch Reasons

**Files:**
- Modify: `index.html`
- Test: `test/epc-design-ui-state.test.mjs`

- [ ] **Step 1: Write failing dispatch contract tests**

Require row fields `pcsLimitKw`, `batteryDischargeLimitReason`, and `gensetReason`. Require the dispatch order to keep battery before Genset and classify residual Genset demand as `PCS limit` when PCS is the active battery constraint.

- [ ] **Step 2: Verify the test fails**

Run: `node --test test/epc-design-ui-state.test.mjs`

Expected: FAIL because dispatch rows do not expose reasons.

- [ ] **Step 3: Add reason-aware dispatch**

Carry `pcsLimitKw` through the SOC ledger. Compare PCS limit with SOC-safe energy power to determine the active battery limit. After battery dispatch, set `gensetReason` to `Shock preemption`, `Manual strategy`, `PCS limit`, or `SOC limit` as applicable.

- [ ] **Step 4: Add diagram labels**

Show `PCS Limit N kW` near the inverter/battery path and append `Genset reason: ...` to the selected interval summary whenever Genset is active.

- [ ] **Step 5: Verify dispatch tests pass**

Run: `node --test test/epc-design-ui-state.test.mjs`

Expected: PASS.

### Task 6: Replace Merge Hourly With Fixed EMS Table Resolution

**Files:**
- Modify: `index.html`
- Test: `test/epc-design-ui-state.test.mjs`

- [ ] **Step 1: Write failing table tests**

Require `setEpcEmsFlowTableInterval`, IDs `epc-ems-flow-table-5m` and `epc-ems-flow-table-60m`, a fixed scroll container, sticky header/footer, and `Genset reason`. Remove expectations for the Merge hourly checkbox.

- [ ] **Step 2: Verify the test fails**

Run: `node --test test/epc-design-ui-state.test.mjs`

Expected: FAIL because the old checkbox still controls the table.

- [ ] **Step 3: Implement five-minute and hourly views**

Use the same five-minute profile rows for both views. Hourly aggregation uses duration-weighted averages for power values and the last row for SOC/reason state. Preserve the current selected interval where possible.

- [ ] **Step 4: Make the table a fixed scroll surface**

Wrap the table in `max-h-[32rem] overflow-auto`, keep `<thead>` at `top-0`, and keep `<tfoot>` at `bottom-0`.

- [ ] **Step 5: Verify table tests pass**

Run: `node --test test/epc-design-ui-state.test.mjs`

Expected: PASS.

### Task 7: Full Regression And Browser Verification

**Files:**
- Verify: `index.html`
- Verify: `epc-design-engine.mjs`
- Verify: `epc-design-engine.global.js`
- Verify: `test/epc-design-engine.test.mjs`
- Verify: `test/epc-design-ui-state.test.mjs`

- [ ] **Step 1: Run the complete root tests**

Run: `node --test test/*.test.mjs`

Expected: all tests pass.

- [ ] **Step 2: Run GitHub Sync tests**

Run: `node --test github-sync/test/*.test.mjs`

Expected: all tests pass.

- [ ] **Step 3: Check whitespace and patch integrity**

Run: `git diff --check`

Expected: no output.

- [ ] **Step 4: Verify in the browser**

Serve the isolated worktree with `python3 -m http.server 8095`, open `http://127.0.0.1:8095/index.html`, and verify:

- Load `startup` shock begins at the first active load interval.
- Changing to `early` moves the shock into the early active work window.
- Detail Inputs ratio updates PV Simulator DC/AC and derived AC value.
- EMS `5 min / 1 hour` changes table resolution without changing dispatch totals.
- Hourly SOC equals the final five-minute SOC.
- PCS limit and Genset reason appear in the diagram and table.
- Load Work and EMS tables have fixed height, sticky headings, and summary rows.

- [ ] **Step 5: Create one focused implementation commit**

```bash
git add index.html epc-design-engine.mjs epc-design-engine.global.js test/epc-design-engine.test.mjs test/epc-design-ui-state.test.mjs
git commit -m "Refine EPC device work and EMS dispatch"
```

Expected: a commit SHA suitable for rollback with `git revert <sha>`.

