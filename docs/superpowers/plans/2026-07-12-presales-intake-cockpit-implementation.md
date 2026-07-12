# Pre-sales Intake Cockpit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a structured, information-dense Pre-sales Intake cockpit with functional frosted-glass surfaces, BD readiness, evidence gaps, linked Quote/EPC visualization, and an accessible handoff drawer.

**Architecture:** Keep `index.html` as the browser UI owner and extract only deterministic Presales normalization, readiness, and evidence-gap logic into a focused ES module. Continue to save the complete project as the existing `presales_project` JSON payload, reuse saved Quote snapshots and `calculateEpcDesignProject()`, and verify nested Intake data through local, D1 bootstrap, and GitHub merge paths without a D1 migration.

**Tech Stack:** Static HTML, Tailwind CDN utilities, scoped CSS, browser ES modules, Node `node:test`, Cloudflare Worker/D1 JSON payloads, GitHub Sync merge, Playwright browser smoke.

## Global Constraints

- Run `npm run backup:d1 -- <task-slug>` from `worker/` before each independently committed logic slice.
- Keep D1 domain `presales_project` and permission resource `presales` unchanged.
- Do not change Quote snapshot calculations, `epc-design-engine.mjs`, or `epc-design-engine.global.js`.
- Keep `customerName`, `siteSummary`, `stage`, `quoteId`, `epcDesignProjectId`, `assumptionStatus`, `riskStatus`, and `updatedAt` backward compatible.
- Add only optional `intakeBasis` and `evidenceStatus` nested objects to Presales records.
- Label the score `BD Readiness`; it must never imply engineering confidence or alter Quote/EPC calculations.
- An open blocking High risk caps readiness at 79 and keeps customer-facing output blocked.
- Use Minova purple `#582C83`, yellow `#FFC107`, 8px surface radius, 18px glass blur, and opaque form controls.
- Do not add gradient orbs, emoji icons, nested decorative cards, oversized marketing headings, or horizontal mobile navigation.
- Desktop verification viewport is 1440x900; mobile verification viewport is 375x900.
- All interactive controls need visible focus and at least 44px mobile hit areas.
- Preserve Chinese/English copy hooks and RM/¥ display behavior.

## File Map

- Create `presales-workbench.mjs`: pure Presales defaults, normalization, evidence gaps, readiness, and opportunity model.
- Modify `index.html`: module imports, structured Intake, workflow rail, cockpit rendering, energy visualization, linked previews, handoff drawer, language/currency hooks, and responsive styles.
- Modify `test/presales-workbench.test.mjs`: pure model tests and DOM contract tests.
- Modify `test/admin-backend-management.test.mjs`: nested Presales payload survives Worker snapshot/bootstrap round-trip.
- Modify `github-sync/test/merge.test.mjs`: nested Presales payload survives local-preferred merge.
- Do not modify `worker/src/index.mjs`, `auth/minova-auth-ui.mjs`, `auth/permission-core.mjs`, or EPC engine files unless a failing round-trip test proves the current generic JSON handling is insufficient.

---

### Task 1: Structured Presales Model and Persistence Contract

**Files:**
- Create: `presales-workbench.mjs`
- Modify: `index.html:5933-5960`
- Modify: `index.html:7019-7058`
- Test: `test/presales-workbench.test.mjs`
- Test: `test/admin-backend-management.test.mjs`
- Test: `github-sync/test/merge.test.mjs`

**Interfaces:**
- Produces: `PRESALES_STAGES`, `PRESALES_ASSUMPTION_STATUS`, `PRESALES_RISK_STATUS`, `PRESALES_INTAKE_DEFAULTS`, `PRESALES_EVIDENCE_DEFAULTS`.
- Produces: `normalizePresalesProject(record) -> normalizedProject`.
- Produces: `buildPresalesEvidenceGaps(project, quoteDetail, epcDetail) -> EvidenceGap[]`.
- Produces: `calculatePresalesReadiness(project, quoteDetail, epcDetail) -> { score, rawScore, capped, blocked, breakdown, nextAction }`.
- Produces: `buildPresalesOpportunityModel(project, quoteDetail, epcDetail) -> { project, quote, epc, gaps, readiness }`.
- Consumes: generic Worker `presales_project` payload and existing GitHub `mergeByKey()` behavior.

- [ ] **Step 1: Back up D1 for the model slice**

Run:

```bash
cd worker
npm run backup:d1 -- presales-cockpit-model
```

Expected: non-empty SQL and manifest with `verification_status=valid` and the current pre-change Git SHA.

- [ ] **Step 2: Write failing pure-model tests**

Add these imports and tests to `test/presales-workbench.test.mjs`:

```js
import {
  buildPresalesEvidenceGaps,
  buildPresalesOpportunityModel,
  calculatePresalesReadiness,
  normalizePresalesProject
} from '../presales-workbench.mjs';

test('presales normalization keeps legacy fields and adds nested intake defaults', () => {
  const project = normalizePresalesProject({
    id: 'BD-1',
    customerName: 'Factory A',
    siteSummary: 'Legacy notes',
    stage: 'Sizing',
    intakeBasis: {
      location: 'Kota Kinabalu',
      monthlyConsumptionKwh: '186000',
      billMonthsAvailable: 8
    },
    evidenceStatus: { utilityBills: 'partial' }
  });

  assert.equal(project.customerName, 'Factory A');
  assert.equal(project.siteSummary, 'Legacy notes');
  assert.equal(project.stage, 'Sizing');
  assert.equal(project.intakeBasis.location, 'Kota Kinabalu');
  assert.equal(project.intakeBasis.monthlyConsumptionKwh, 186000);
  assert.equal(project.intakeBasis.billMonthsAvailable, 8);
  assert.equal(project.evidenceStatus.utilityBills, 'partial');
  assert.equal(project.evidenceStatus.loadProfile, 'missing');
});

test('presales readiness is a bounded completeness score with High-risk cap', () => {
  const project = normalizePresalesProject({
    id: 'BD-2',
    customerName: 'Factory B',
    riskStatus: 'accepted',
    quoteId: 'Q-2',
    epcDesignProjectId: 'EPC-2',
    intakeBasis: {
      location: 'Sabah',
      facilityType: 'Cold storage',
      monthlyConsumptionKwh: 186000,
      billMonthsAvailable: 12,
      targetSavingPct: 25,
      proposalDueDate: '2026-08-01',
      tariffSource: 'Customer bill',
      tariffSourceDate: '2026-06-30'
    },
    evidenceStatus: {
      utilityBills: 'complete',
      loadProfile: 'available',
      sitePhotos: 'available',
      existingSld: 'available',
      structuralReport: 'not_required'
    }
  });
  const quote = { id: 'Q-2', loaded: true, quoteTotal: 3480000 };
  const epc = {
    id: 'EPC-2', loaded: true, pvMwp: 0.42, bessMwh: 0.8, pcsMw: 0.4,
    openHighRiskCount: 3, reportBlocked: true
  };

  const readiness = calculatePresalesReadiness(project, quote, epc);
  assert.equal(readiness.rawScore, 95);
  assert.equal(readiness.score, 79);
  assert.equal(readiness.blocked, true);
  assert.match(readiness.nextAction, /High risk/i);
});

test('presales gaps are actionable and opportunity model reuses quote and EPC detail', () => {
  const project = normalizePresalesProject({
    id: 'BD-3',
    customerName: 'Factory C',
    intakeBasis: { billMonthsAvailable: 8 },
    evidenceStatus: { utilityBills: 'partial' }
  });
  const gaps = buildPresalesEvidenceGaps(project, null, null);
  assert.deepEqual(gaps.slice(0, 3).map(gap => gap.id), [
    'tariff-source-date',
    'utility-bills',
    'load-profile'
  ]);
  assert.ok(gaps.some(gap => gap.id === 'quote-link'));
  assert.ok(gaps.some(gap => gap.id === 'epc-link'));

  const model = buildPresalesOpportunityModel(project, null, null);
  assert.equal(model.project.id, 'BD-3');
  assert.equal(model.quote, null);
  assert.equal(model.epc, null);
  assert.equal(model.readiness.blocked, false);
});
```

- [ ] **Step 3: Run the model tests and verify the expected failure**

Run:

```bash
node --test test/presales-workbench.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `presales-workbench.mjs`.

- [ ] **Step 4: Create the pure Presales module**

Create `presales-workbench.mjs` with these exact public contracts and scoring rules:

```js
export const PRESALES_STAGES = Object.freeze([
  'Intake', 'Sizing', 'Product/BOQ', 'Risk', 'Quote/PDF', 'Handoff'
]);

export const PRESALES_ASSUMPTION_STATUS = Object.freeze({
  preliminary: 'Preliminary / BD estimate',
  needs_source: 'Needs source/date',
  engineering_review: 'Engineering draft / requires review',
  confirmed: 'Engineering confirmed'
});

export const PRESALES_RISK_STATUS = Object.freeze({
  open: 'Open risks',
  needs_review: 'Needs engineering review',
  accepted: 'Accepted for proposal'
});

export const PRESALES_INTAKE_DEFAULTS = Object.freeze({
  siteName: '',
  location: '',
  facilityType: '',
  monthlyConsumptionKwh: null,
  billMonthsAvailable: null,
  peakDemandKw: null,
  tariffCategory: '',
  tariffSource: '',
  tariffSourceDate: '',
  gensetCapacityKva: null,
  gensetRuntimeHoursMonth: null,
  dieselConsumptionLitersMonth: null,
  gensetUse: 'unknown',
  availableAreaM2: null,
  transformerCapacityKva: null,
  exportEligibility: 'unknown',
  primaryConstraint: '',
  targetSavingPct: null,
  budgetRange: '',
  proposalDueDate: '',
  customerDecisionNote: ''
});

export const PRESALES_EVIDENCE_DEFAULTS = Object.freeze({
  utilityBills: 'missing',
  loadProfile: 'missing',
  sitePhotos: 'missing',
  existingSld: 'missing',
  structuralReport: 'missing'
});

const text = value => String(value ?? '').trim();
const finiteOrNull = value => {
  if (value === '' || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};
const enumValue = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;
const evidenceDone = value => ['complete', 'available', 'not_required'].includes(value);

export function normalizePresalesProject(record = {}) {
  const intake = record.intakeBasis && typeof record.intakeBasis === 'object'
    ? record.intakeBasis
    : {};
  const evidence = record.evidenceStatus && typeof record.evidenceStatus === 'object'
    ? record.evidenceStatus
    : {};
  const billMonths = finiteOrNull(intake.billMonthsAvailable);
  return {
    id: text(record.id) || `presales_${Date.now()}`,
    customerName: text(record.customerName),
    siteSummary: text(record.siteSummary),
    stage: enumValue(record.stage, PRESALES_STAGES, 'Intake'),
    quoteId: text(record.quoteId),
    epcDesignProjectId: text(record.epcDesignProjectId),
    assumptionStatus: enumValue(
      record.assumptionStatus,
      Object.keys(PRESALES_ASSUMPTION_STATUS),
      'preliminary'
    ),
    riskStatus: enumValue(record.riskStatus, Object.keys(PRESALES_RISK_STATUS), 'open'),
    intakeBasis: {
      siteName: text(intake.siteName),
      location: text(intake.location),
      facilityType: text(intake.facilityType),
      monthlyConsumptionKwh: finiteOrNull(intake.monthlyConsumptionKwh),
      billMonthsAvailable: billMonths == null ? null : Math.min(12, Math.round(billMonths)),
      peakDemandKw: finiteOrNull(intake.peakDemandKw),
      tariffCategory: text(intake.tariffCategory),
      tariffSource: text(intake.tariffSource),
      tariffSourceDate: text(intake.tariffSourceDate),
      gensetCapacityKva: finiteOrNull(intake.gensetCapacityKva),
      gensetRuntimeHoursMonth: finiteOrNull(intake.gensetRuntimeHoursMonth),
      dieselConsumptionLitersMonth: finiteOrNull(intake.dieselConsumptionLitersMonth),
      gensetUse: enumValue(intake.gensetUse, ['unknown', 'outage', 'peak_shaving', 'continuous'], 'unknown'),
      availableAreaM2: finiteOrNull(intake.availableAreaM2),
      transformerCapacityKva: finiteOrNull(intake.transformerCapacityKva),
      exportEligibility: enumValue(
        intake.exportEligibility,
        ['unknown', 'confirmed', 'restricted', 'not_allowed'],
        'unknown'
      ),
      primaryConstraint: text(intake.primaryConstraint),
      targetSavingPct: finiteOrNull(intake.targetSavingPct),
      budgetRange: text(intake.budgetRange),
      proposalDueDate: text(intake.proposalDueDate),
      customerDecisionNote: text(intake.customerDecisionNote)
    },
    evidenceStatus: {
      utilityBills: enumValue(evidence.utilityBills, ['complete', 'partial', 'missing'], 'missing'),
      loadProfile: enumValue(evidence.loadProfile, ['available', 'requested', 'missing'], 'missing'),
      sitePhotos: enumValue(evidence.sitePhotos, ['available', 'requested', 'missing'], 'missing'),
      existingSld: enumValue(evidence.existingSld, ['available', 'requested', 'missing'], 'missing'),
      structuralReport: enumValue(
        evidence.structuralReport,
        ['available', 'requested', 'not_required', 'missing'],
        'missing'
      )
    },
    updatedAt: text(record.updatedAt)
  };
}

export function buildPresalesEvidenceGaps(project = {}, quote = null, epc = null) {
  const normalized = normalizePresalesProject(project);
  const intake = normalized.intakeBasis;
  const evidence = normalized.evidenceStatus;
  const gaps = [];
  const add = (priority, id, label, actionLabel, target) => {
    gaps.push({ priority, id, label, actionLabel, target });
  };

  if (Number(epc?.openHighRiskCount || 0) > 0 || epc?.reportBlocked) {
    add(0, 'high-risk', `${Number(epc?.openHighRiskCount || 0)} open High risks`, 'Open EPC Risks', 'risks');
  }
  if (!intake.tariffSource || !intake.tariffSourceDate) {
    add(10, 'tariff-source-date', 'Tariff source/date missing', 'Add tariff evidence', 'energy');
  }
  if ((intake.billMonthsAvailable || 0) < 12 || evidence.utilityBills !== 'complete') {
    const missing = Math.max(0, 12 - Number(intake.billMonthsAvailable || 0));
    add(20, 'utility-bills', `Bills ${intake.billMonthsAvailable || 0}/12`, `Add ${missing} months`, 'evidence');
  }
  if (evidence.loadProfile !== 'available') {
    add(30, 'load-profile', 'Load profile missing', 'Request from customer', 'evidence');
  }
  if (evidence.sitePhotos !== 'available') {
    add(31, 'site-photos', 'Site photos missing', 'Request site photos', 'evidence');
  }
  if (evidence.existingSld !== 'available') {
    add(32, 'existing-sld', 'Existing SLD missing', 'Request existing SLD', 'evidence');
  }
  if (!evidenceDone(evidence.structuralReport)) {
    add(33, 'structural-report', 'Structural basis missing', 'Confirm structural path', 'evidence');
  }
  if (!normalized.quoteId || !quote) {
    add(40, 'quote-link', 'Quote not linked', 'Select Quote Draft', 'quote');
  }
  if (!normalized.epcDesignProjectId || !epc) {
    add(50, 'epc-link', 'EPC concept not linked', 'Select Hybrid EPC Design', 'epc');
  }
  return gaps.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

export function calculatePresalesReadiness(project = {}, quote = null, epc = null) {
  const normalized = normalizePresalesProject(project);
  const intake = normalized.intakeBasis;
  const evidence = normalized.evidenceStatus;
  const intakeChecks = [
    normalized.customerName,
    intake.location,
    intake.facilityType,
    Number(intake.monthlyConsumptionKwh || 0) > 0,
    Number(intake.targetSavingPct || 0) > 0 || intake.customerDecisionNote,
    intake.proposalDueDate
  ];
  const intakePoints = intakeChecks.filter(Boolean).length * 5;
  const evidencePoints =
    (evidence.utilityBills === 'complete' ? 5 : evidence.utilityBills === 'partial' ? 2 : 0) +
    (evidenceDone(evidence.loadProfile) ? 5 : 0) +
    (evidenceDone(evidence.sitePhotos) ? 5 : 0) +
    (evidenceDone(evidence.existingSld) ? 5 : 0) +
    (evidenceDone(evidence.structuralReport) ? 5 : 0);
  const quotePoints = (normalized.quoteId ? 5 : 0) + (quote?.loaded ? 5 : 0) + (Number(quote?.quoteTotal || 0) > 0 ? 5 : 0);
  const recommendationReady = Number(epc?.pvMwp || 0) > 0 || Number(epc?.bessMwh || 0) > 0 || Number(epc?.pcsMw || 0) > 0;
  const epcPoints = (normalized.epcDesignProjectId ? 5 : 0) + (epc?.loaded ? 5 : 0) + (recommendationReady ? 10 : 0);
  const riskPoints = (normalized.riskStatus === 'accepted' ? 5 : 0) + (epc?.loaded && !epc?.reportBlocked && !Number(epc?.openHighRiskCount || 0) ? 5 : 0);
  const rawScore = Math.round(intakePoints + evidencePoints + quotePoints + epcPoints + riskPoints);
  const blocked = Boolean(epc?.reportBlocked || Number(epc?.openHighRiskCount || 0) > 0);
  const score = Math.max(0, Math.min(blocked ? 79 : 100, rawScore));
  const gaps = buildPresalesEvidenceGaps(normalized, quote, epc);
  return {
    score,
    rawScore,
    capped: score !== rawScore,
    blocked,
    breakdown: {
      intake: intakePoints,
      evidence: evidencePoints,
      quote: quotePoints,
      epc: epcPoints,
      risk: riskPoints
    },
    nextAction: gaps[0]?.actionLabel || 'Ready for engineering handoff'
  };
}

export function buildPresalesOpportunityModel(project = {}, quote = null, epc = null) {
  const normalized = normalizePresalesProject(project);
  return {
    project: normalized,
    quote,
    epc,
    gaps: buildPresalesEvidenceGaps(normalized, quote, epc),
    readiness: calculatePresalesReadiness(normalized, quote, epc)
  };
}
```

- [ ] **Step 5: Import the module into the browser owner**

At the start of the existing `<script type="module">` in `index.html`, add:

```js
import {
  PRESALES_ASSUMPTION_STATUS,
  PRESALES_EVIDENCE_DEFAULTS,
  PRESALES_INTAKE_DEFAULTS,
  PRESALES_RISK_STATUS,
  PRESALES_STAGES,
  buildPresalesEvidenceGaps,
  buildPresalesOpportunityModel,
  calculatePresalesReadiness,
  normalizePresalesProject
} from './presales-workbench.mjs';
```

Delete the existing local declarations of `PRESALES_STAGES`, `PRESALES_ASSUMPTION_STATUS`, `PRESALES_RISK_STATUS`, and `normalizePresalesProject`. Keep `normalizePresalesProjectList()` and make it call the imported normalizer.

Expose pure functions for browser smoke tests:

```js
window.normalizePresalesProject = normalizePresalesProject;
window.buildPresalesEvidenceGaps = buildPresalesEvidenceGaps;
window.calculatePresalesReadiness = calculatePresalesReadiness;
window.buildPresalesOpportunityModel = buildPresalesOpportunityModel;
```

- [ ] **Step 6: Add nested persistence regression assertions**

In `test/admin-backend-management.test.mjs`, extend the Presales input used by `businessSnapshotToItems()` and `buildBusinessBootstrapPayload()`:

```js
const presalesRecord = {
  id: 'BD1',
  customerName: 'Factory A',
  stage: 'Sizing',
  intakeBasis: { location: 'Sabah', monthlyConsumptionKwh: 186000 },
  evidenceStatus: { utilityBills: 'partial', loadProfile: 'requested' }
};
```

Assert:

```js
assert.deepEqual(payload.data.presalesProjects[0].intakeBasis, {
  location: 'Sabah',
  monthlyConsumptionKwh: 186000
});
assert.deepEqual(payload.data.presalesProjects[0].evidenceStatus, {
  utilityBills: 'partial',
  loadProfile: 'requested'
});
```

In `github-sync/test/merge.test.mjs`, add:

```js
test('mergeState preserves nested presales intake and prefers local project conflicts', () => {
  const merged = mergeState(
    { data: { presalesProjects: [{ id: 'BD1', intakeBasis: { location: 'Remote' } }] } },
    { data: { presalesProjects: [{ id: 'BD1', intakeBasis: { location: 'Sabah' }, evidenceStatus: { utilityBills: 'partial' } }] } }
  );
  assert.equal(merged.data.presalesProjects.length, 1);
  assert.equal(merged.data.presalesProjects[0].intakeBasis.location, 'Sabah');
  assert.equal(merged.data.presalesProjects[0].evidenceStatus.utilityBills, 'partial');
});
```

- [ ] **Step 7: Run focused persistence and model tests**

Run:

```bash
node --test test/presales-workbench.test.mjs test/admin-backend-management.test.mjs
```

Expected: PASS.

Run:

```bash
cd github-sync
node --test test/merge.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit the model slice**

```bash
git add presales-workbench.mjs index.html test/presales-workbench.test.mjs test/admin-backend-management.test.mjs github-sync/test/merge.test.mjs
git commit -m "Add structured presales intake model"
```

---

### Task 2: Workflow Rail and Progressive Quick Intake

**Files:**
- Modify: `index.html:1095-1210`
- Modify: `index.html:21384-21558`
- Test: `test/presales-workbench.test.mjs`

**Interfaces:**
- Consumes: `normalizePresalesProject()` and nested `intakeBasis` / `evidenceStatus` from Task 1.
- Produces: stable DOM ids for every structured Intake value.
- Produces: `readPresalesIntakeForm()`, `populatePresalesIntakeForm(project)`, `togglePresalesIntakeGroup(groupId)`, and single-owner `setPresalesStage(stage)`.

- [ ] **Step 1: Back up D1 for the Intake UI slice**

Run:

```bash
cd worker
npm run backup:d1 -- presales-cockpit-intake-ui
```

Expected: valid SQL and manifest recorded before editing.

- [ ] **Step 2: Add failing DOM contract tests**

Add to `test/presales-workbench.test.mjs`:

```js
test('presales cockpit has one stage owner and structured progressive intake', () => {
  for (const id of [
    'presales-command-bar',
    'presales-stage-rail',
    'presales-stage-mobile-summary',
    'presales-cockpit-grid',
    'presales-intake-panel',
    'presales-intake-customer',
    'presales-intake-energy',
    'presales-intake-diesel',
    'presales-intake-site',
    'presales-intake-objective',
    'presales-intake-evidence',
    'presales-site-name',
    'presales-location',
    'presales-facility-type',
    'presales-monthly-consumption-kwh',
    'presales-bill-months-available',
    'presales-tariff-source',
    'presales-tariff-source-date',
    'presales-site-summary'
  ]) {
    assert.match(indexHtml, new RegExp(`id="${id}"`), `missing cockpit intake id: ${id}`);
  }
  assert.doesNotMatch(indexHtml, /id="presales-stage"/);
  assert.match(indexHtml, /aria-expanded="(true|false)"/);
  assert.match(indexHtml, /function readPresalesIntakeForm/);
  assert.match(indexHtml, /function populatePresalesIntakeForm/);
});
```

- [ ] **Step 3: Run the DOM test and verify it fails**

Run:

```bash
node --test test/presales-workbench.test.mjs
```

Expected: FAIL because the new command bar, rail, and Intake ids are absent and `presales-stage` still exists.

- [ ] **Step 4: Add scoped visual tokens and responsive primitives**

Add scoped CSS near the existing application-shell styles in `index.html`:

```css
#view-presales {
    --presales-bg: #f3f5f8;
    --presales-surface: rgba(255, 255, 255, 0.78);
    --presales-solid: #ffffff;
    --presales-border: rgba(148, 163, 184, 0.32);
    --presales-text: #172033;
    --presales-muted: #64748b;
    --presales-purple: #582c83;
    --presales-yellow: #ffc107;
    --presales-danger: #b91c1c;
    color: var(--presales-text);
}

.presales-glass {
    background: var(--presales-surface);
    border: 1px solid rgba(255, 255, 255, 0.9);
    box-shadow: 0 12px 32px rgba(15, 23, 42, 0.08), 0 0 0 1px var(--presales-border);
    -webkit-backdrop-filter: blur(18px);
    backdrop-filter: blur(18px);
    border-radius: 8px;
}

.presales-solid {
    background: var(--presales-solid);
    border: 1px solid var(--presales-border);
    border-radius: 8px;
}

.presales-field {
    min-height: 44px;
    width: 100%;
    border: 1px solid #d8dee8;
    border-radius: 8px;
    background: #fff;
    padding: 0.68rem 0.75rem;
    font-size: 0.875rem;
    color: var(--presales-text);
}

.presales-field:focus-visible,
.presales-action:focus-visible,
.presales-stage-btn:focus-visible {
    outline: 2px solid var(--presales-purple);
    outline-offset: 2px;
}

@media (max-width: 767px) {
    #view-presales .presales-field { font-size: 1rem; }
    #presales-stage-rail { display: none; }
    #presales-stage-mobile-summary { display: flex; }
    #view-presales[data-presales-record-state="existing"] #presales-opportunity-snapshot { order: -10; }
}

@media (min-width: 768px) {
    #presales-stage-rail { display: grid; }
    #presales-stage-mobile-summary { display: none; }
}

@media (prefers-reduced-motion: reduce) {
    #view-presales *, #view-presales *::before, #view-presales *::after {
        scroll-behavior: auto !important;
        transition-duration: 0.01ms !important;
        animation-duration: 0.01ms !important;
    }
}
```

- [ ] **Step 5: Replace the header and duplicate stage control**

Replace the existing Presales heading/actions and six card-style stages with:

```html
<section id="presales-command-bar" class="presales-glass sticky top-2 z-20 mb-4 p-3">
    <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div class="min-w-0">
            <p class="text-xs font-semibold text-purple-700">BD Pre-sales</p>
            <h2 class="text-2xl font-bold text-slate-900">Pre-sales Workspace</h2>
            <p id="presales-project-context" class="mt-1 text-sm text-slate-500">New opportunity</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
            <select id="presales-project-select" onchange="selectPresalesProject(this.value)" class="presales-field min-w-0 flex-1 sm:min-w-[220px]"></select>
            <span id="presales-updated-at" class="text-xs font-semibold text-slate-500" aria-live="polite">Not saved</span>
            <button type="button" onclick="createPresalesProject()" class="presales-action min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold">New Case</button>
            <button type="button" onclick="saveCurrentPresalesProject()" class="presales-action min-h-11 rounded-lg bg-purple-800 px-4 text-xs font-bold text-white">Save</button>
            <button type="button" onclick="openPresalesHandoff()" class="presales-action min-h-11 rounded-lg border border-amber-400 bg-amber-300 px-4 text-xs font-bold text-slate-900">Handoff</button>
        </div>
    </div>
</section>

<nav id="presales-stage-rail" class="presales-glass mb-4 grid-cols-6 gap-1 p-2" aria-label="BD workflow stages"></nav>

<div id="presales-stage-mobile-summary" class="presales-glass mb-4 hidden items-center gap-3 p-3">
    <div class="min-w-0 flex-1">
        <div id="presales-stage-mobile-label" class="text-sm font-bold text-slate-900">Step 1 of 6 - Intake</div>
        <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200"><div id="presales-stage-mobile-progress" class="h-full bg-purple-700" style="width:16.67%"></div></div>
    </div>
    <button type="button" onclick="togglePresalesMobileStages()" class="presales-action min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold" aria-controls="presales-stage-mobile-menu" aria-expanded="false">Steps</button>
</div>
<div id="presales-stage-mobile-menu" class="presales-solid mb-4 hidden p-2"></div>
```

Render both desktop and mobile stage controls from `PRESALES_STAGES` so the project has one stage state owner. Remove the Stage select from Intake.

- [ ] **Step 6: Replace Intake with six progressive groups and Raw Notes**

Create `#presales-intake-panel` with six accordion sections. Every accordion button uses `aria-expanded` and `aria-controls`. Use these field ids exactly:

```text
Customer: presales-customer-name, presales-site-name, presales-location, presales-facility-type
Energy: presales-monthly-consumption-kwh, presales-bill-months-available, presales-peak-demand-kw, presales-tariff-category, presales-tariff-source, presales-tariff-source-date
Diesel: presales-genset-capacity-kva, presales-genset-runtime-hours-month, presales-diesel-consumption-liters-month, presales-genset-use
Site: presales-available-area-m2, presales-transformer-capacity-kva, presales-export-eligibility, presales-primary-constraint
Objective: presales-target-saving-pct, presales-budget-range, presales-proposal-due-date, presales-customer-decision-note
Evidence: presales-evidence-utility-bills, presales-evidence-load-profile, presales-evidence-site-photos, presales-evidence-existing-sld, presales-evidence-structural-report
Raw notes: presales-site-summary
```

Use this accordion structure for each group:

```html
<section class="border-b border-slate-200 last:border-b-0">
    <button type="button" class="presales-action flex min-h-11 w-full items-center justify-between gap-3 py-3 text-left" onclick="togglePresalesIntakeGroup('energy')" aria-expanded="true" aria-controls="presales-intake-energy">
        <span><strong class="text-sm text-slate-900">Energy</strong><span id="presales-intake-energy-summary" class="ml-2 text-xs text-slate-500">Monthly use and tariff basis</span></span>
        <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
    </button>
    <div id="presales-intake-energy" class="grid grid-cols-1 gap-3 pb-4 md:grid-cols-2"></div>
</section>
```

- [ ] **Step 7: Wire form read/populate and progressive behavior**

Add:

```js
function presalesFormText(id, fallback = '') {
    const element = document.getElementById(id);
    return element ? String(element.value || '').trim() : fallback;
}

function presalesFormNumber(id, fallback = null) {
    const value = presalesFormText(id, '');
    if (!value) return fallback;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function readPresalesIntakeForm(existing = getActivePresalesProject() || {}) {
    return {
        siteName: presalesFormText('presales-site-name', existing.intakeBasis?.siteName || ''),
        location: presalesFormText('presales-location', existing.intakeBasis?.location || ''),
        facilityType: presalesFormText('presales-facility-type', existing.intakeBasis?.facilityType || ''),
        monthlyConsumptionKwh: presalesFormNumber('presales-monthly-consumption-kwh'),
        billMonthsAvailable: presalesFormNumber('presales-bill-months-available'),
        peakDemandKw: presalesFormNumber('presales-peak-demand-kw'),
        tariffCategory: presalesFormText('presales-tariff-category'),
        tariffSource: presalesFormText('presales-tariff-source'),
        tariffSourceDate: presalesFormText('presales-tariff-source-date'),
        gensetCapacityKva: presalesFormNumber('presales-genset-capacity-kva'),
        gensetRuntimeHoursMonth: presalesFormNumber('presales-genset-runtime-hours-month'),
        dieselConsumptionLitersMonth: presalesFormNumber('presales-diesel-consumption-liters-month'),
        gensetUse: presalesFormText('presales-genset-use', 'unknown'),
        availableAreaM2: presalesFormNumber('presales-available-area-m2'),
        transformerCapacityKva: presalesFormNumber('presales-transformer-capacity-kva'),
        exportEligibility: presalesFormText('presales-export-eligibility', 'unknown'),
        primaryConstraint: presalesFormText('presales-primary-constraint'),
        targetSavingPct: presalesFormNumber('presales-target-saving-pct'),
        budgetRange: presalesFormText('presales-budget-range'),
        proposalDueDate: presalesFormText('presales-proposal-due-date'),
        customerDecisionNote: presalesFormText('presales-customer-decision-note')
    };
}

function readPresalesEvidenceForm(existing = getActivePresalesProject() || {}) {
    return {
        utilityBills: presalesFormText('presales-evidence-utility-bills', existing.evidenceStatus?.utilityBills || 'missing'),
        loadProfile: presalesFormText('presales-evidence-load-profile', existing.evidenceStatus?.loadProfile || 'missing'),
        sitePhotos: presalesFormText('presales-evidence-site-photos', existing.evidenceStatus?.sitePhotos || 'missing'),
        existingSld: presalesFormText('presales-evidence-existing-sld', existing.evidenceStatus?.existingSld || 'missing'),
        structuralReport: presalesFormText('presales-evidence-structural-report', existing.evidenceStatus?.structuralReport || 'missing')
    };
}
```

Add `let presalesDraftStage = 'Intake'` beside `presalesActiveProjectId`. `setPresalesStage(stage)` writes the normalized value to `presalesDraftStage`; `renderPresalesWorkbench()` resets it from the loaded project; `currentPresalesDraftFromForm()` saves `stage: presalesDraftStage`. Add `intakeBasis` and `evidenceStatus` from the helpers. Add `populatePresalesIntakeForm(project)` using a fixed id-to-field map and call it from `renderPresalesWorkbench()`.

Wrap Intake and Snapshot in `#presales-cockpit-grid` using `grid grid-cols-1 xl:grid-cols-12`; Intake uses `xl:col-span-4` and Snapshot uses `xl:col-span-8`. In `renderPresalesWorkbench()`, set `#view-presales.dataset.presalesRecordState` to `existing` when the active project has a saved `updatedAt`, otherwise `new`. The mobile CSS above moves Snapshot before Intake only for existing records.

Add:

```js
function hasStructuredPresalesIntake(project = {}) {
    const intake = project.intakeBasis || {};
    return Boolean(
        intake.location ||
        intake.facilityType ||
        Number(intake.monthlyConsumptionKwh || 0) > 0 ||
        Number(intake.gensetCapacityKva || 0) > 0 ||
        Number(intake.availableAreaM2 || 0) > 0 ||
        intake.customerDecisionNote
    );
}

function applyPresalesIntakeDisclosure(project = {}) {
    const existing = Boolean(project.updatedAt);
    const structured = hasStructuredPresalesIntake(project);
    const expanded = new Set(existing ? [] : ['customer', 'energy']);
    if (!structured && existing) expanded.add('customer');
    for (const group of ['customer', 'energy', 'diesel', 'site', 'objective', 'evidence', 'notes']) {
        setPresalesIntakeGroupExpanded(group, expanded.has(group));
    }
}
```

Raw Notes use group id `notes`. For a populated existing project they are collapsed and show a two-line summary plus Expand/Edit; for a new project Customer and Energy start expanded.

- [ ] **Step 8: Run the focused UI contract tests**

Run:

```bash
node --test test/presales-workbench.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Commit the Intake UI slice**

```bash
git add index.html test/presales-workbench.test.mjs
git commit -m "Build progressive presales intake"
```

---

### Task 3: Opportunity Snapshot, Evidence Gaps, and Energy Architecture

**Files:**
- Modify: `index.html:1212-1234`
- Modify: `index.html:21082-21523`
- Test: `test/presales-workbench.test.mjs`

**Interfaces:**
- Consumes: `buildPresalesOpportunityModel(project, quote, epc)` from Task 1.
- Consumes: existing `getPresalesQuoteDetail()` and `getPresalesEpcDetail()`.
- Produces: `renderPresalesOpportunitySnapshot(project)`, `renderPresalesEvidenceGaps(model)`, `renderPresalesEnergyArchitecture(model)`, `focusPresalesGap(target)`.

- [ ] **Step 1: Back up D1 for the Snapshot slice**

Run:

```bash
cd worker
npm run backup:d1 -- presales-cockpit-snapshot
```

Expected: valid backup and manifest.

- [ ] **Step 2: Add failing Snapshot DOM tests**

Add:

```js
test('presales opportunity snapshot exposes readiness, KPIs, evidence and energy flow', () => {
  for (const id of [
    'presales-opportunity-snapshot',
    'presales-readiness-score',
    'presales-readiness-breakdown',
    'presales-next-action',
    'presales-kpi-strip',
    'presales-energy-architecture',
    'presales-evidence-gaps',
    'presales-quote-detail',
    'presales-epc-detail'
  ]) {
    assert.match(indexHtml, new RegExp(`id="${id}"`), `missing snapshot id: ${id}`);
  }
  assert.match(indexHtml, /function renderPresalesOpportunitySnapshot/);
  assert.match(indexHtml, /function renderPresalesEnergyArchitecture/);
  assert.match(indexHtml, /BD Readiness/);
  assert.match(indexHtml, /Customer-facing output blocked by High risk/);
});
```

- [ ] **Step 3: Run the Snapshot test and verify it fails**

Run:

```bash
node --test test/presales-workbench.test.mjs
```

Expected: FAIL because the Snapshot anchors and render functions do not exist.

- [ ] **Step 4: Recompose the right side as an un-nested Snapshot**

Replace the four equal summary cards with this structure:

```html
<section id="presales-opportunity-snapshot" class="presales-glass p-4 md:p-5">
    <div class="grid grid-cols-1 gap-5 lg:grid-cols-[180px_minmax(0,1fr)]">
        <div class="flex items-center gap-4 lg:flex-col lg:items-start">
            <div class="relative grid h-28 w-28 shrink-0 place-items-center rounded-full border-8 border-slate-200 bg-white">
                <strong id="presales-readiness-score" class="text-3xl font-bold text-slate-900">0%</strong>
            </div>
            <div class="min-w-0">
                <p class="text-xs font-semibold text-slate-500">BD Readiness</p>
                <p id="presales-next-action" class="mt-1 text-sm font-bold text-slate-900">Capture customer and energy basis</p>
                <button id="presales-readiness-breakdown" type="button" class="presales-action mt-2 min-h-11 text-xs font-semibold text-purple-700">View breakdown</button>
            </div>
        </div>
        <div class="min-w-0">
            <div id="presales-kpi-strip" class="grid grid-cols-2 gap-x-4 gap-y-4 md:grid-cols-3"></div>
            <div id="presales-energy-architecture" class="mt-5 min-h-[180px] border-t border-slate-200 pt-4"></div>
        </div>
    </div>
</section>

<section id="presales-evidence-gaps" class="presales-solid p-3" aria-live="polite"></section>

<section class="grid grid-cols-1 gap-4 lg:grid-cols-2">
    <div class="presales-solid p-4"><div id="presales-quote-detail">No quote linked.</div></div>
    <div class="presales-solid p-4"><div id="presales-epc-detail">No EPC concept linked.</div></div>
</section>
```

Place this structure as the `xl:col-span-8` child of `#presales-cockpit-grid`; do not create a card around the KPI strip or energy diagram inside the glass Snapshot.

Use a conic background only for the readiness ring fill, not as page decoration:

```js
const scoreRing = document.getElementById('presales-readiness-score')?.parentElement;
if (scoreRing) {
    scoreRing.style.background = `conic-gradient(#582C83 ${model.readiness.score * 3.6}deg, #e2e8f0 0deg)`;
    scoreRing.style.boxShadow = 'inset 0 0 0 8px #fff';
}
```

- [ ] **Step 5: Render source-labelled KPIs and evidence actions**

Build the model from current linked detail:

```js
function getPresalesOpportunityModel(project = currentPresalesDraftFromForm()) {
    const quote = getPresalesQuoteDetail(project.quoteId);
    const epc = getPresalesEpcDetail(project.epcDesignProjectId);
    return buildPresalesOpportunityModel(project, quote, epc);
}
```

The KPI array is:

```js
const kpis = [
    { label: 'Monthly consumption', value: intake.monthlyConsumptionKwh, unit: 'kWh', source: 'Intake' },
    { label: 'Proposed PV', value: epc?.loaded ? epc.pvMwp : quote?.proposedSize, unit: epc?.loaded ? 'MWp' : 'kWp', source: epc?.loaded ? 'EPC draft' : 'Quote snapshot' },
    { label: 'Recommended BESS', value: epc?.loaded ? epc.bessMwh : null, unit: 'MWh', source: 'EPC draft' },
    { label: 'Recommended PCS', value: epc?.loaded ? epc.pcsMw : null, unit: 'MW', source: 'EPC draft' },
    { label: 'Quote total', value: quote?.quoteTotal, unit: quote?.currency === 'CNY' ? '¥' : 'RM', source: 'Quote snapshot', money: true },
    { label: 'Payback', value: quote?.payback, unit: '', source: 'Preliminary estimate' }
];
```

Missing values render an em dash and a contextual action; they must never render as zero. Evidence gap buttons call `focusPresalesGap(gap.target)` to expand and focus Intake, or open Quote/EPC/Risks.

- [ ] **Step 6: Render the responsive energy architecture**

Add a responsive SVG with a text alternative:

```js
function renderPresalesEnergyArchitecture(model) {
    const target = document.getElementById('presales-energy-architecture');
    if (!target) return;
    const epc = model.epc;
    const pv = epc?.loaded ? `${presalesFormatNumber(epc.pvMwp, 2)} MWp` : 'Pending';
    const bess = epc?.loaded ? `${presalesFormatNumber(epc.bessMwh, 2)} MWh` : 'Pending';
    const pcs = epc?.loaded ? `${presalesFormatNumber(epc.pcsMw, 2)} MW` : 'Pending';
    const summary = `Energy concept: PV ${pv}; PCS ${pcs}; BESS ${bess}; customer load ${epc?.loaded ? presalesFormatNumber(epc.avgLoadKw, 0) + ' kW average' : 'pending'}.`;
    target.innerHTML = `
        <div class="mb-3 flex items-center justify-between gap-3">
            <div><p class="text-xs font-semibold text-slate-500">Energy architecture</p><p class="text-sm font-bold text-slate-900">PV, load, storage and supply context</p></div>
            <span class="text-xs font-semibold ${epc?.loaded ? 'text-green-700' : 'text-amber-700'}">${epc?.loaded ? 'EPC draft' : 'Pending EPC'}</span>
        </div>
        <svg viewBox="0 0 760 190" class="h-auto w-full" role="img" aria-label="${htmlSafe(summary)}">
            <path d="M130 95 H310 M450 95 H630 M380 130 V165" fill="none" stroke="#94a3b8" stroke-width="3" stroke-linecap="round"/>
            <g><rect x="20" y="55" width="110" height="80" rx="8" fill="#fff" stroke="#c4b5fd"/><text x="75" y="85" text-anchor="middle" font-size="13" font-weight="700">PV</text><text x="75" y="108" text-anchor="middle" font-size="12">${htmlSafe(pv)}</text></g>
            <g><rect x="310" y="50" width="140" height="90" rx="8" fill="#582C83"/><text x="380" y="84" text-anchor="middle" font-size="13" font-weight="700" fill="#fff">AC Bus / PCS</text><text x="380" y="109" text-anchor="middle" font-size="12" fill="#fff">${htmlSafe(pcs)}</text></g>
            <g><rect x="630" y="55" width="110" height="80" rx="8" fill="#fff" stroke="#cbd5e1"/><text x="685" y="85" text-anchor="middle" font-size="13" font-weight="700">Load</text><text x="685" y="108" text-anchor="middle" font-size="12">${htmlSafe(epc?.loaded ? presalesFormatNumber(epc.avgLoadKw, 0) + ' kW' : 'Pending')}</text></g>
            <g><rect x="320" y="155" width="120" height="30" rx="8" fill="#fff8dc" stroke="#f59e0b"/><text x="380" y="175" text-anchor="middle" font-size="12" font-weight="700">BESS ${htmlSafe(bess)}</text></g>
        </svg>`;
}
```

- [ ] **Step 7: Refresh Snapshot from all current mutation paths**

Call `renderPresalesOpportunitySnapshot(project)` from:

- `renderPresalesWorkbench()`
- `markPresalesDirty()` through a debounced 120ms refresh
- `onPresalesLinkedWorkChanged()`
- saved Quote detail success/failure finalization
- `syncPresalesFromCurrentQuote()`
- `syncPresalesFromCurrentEpc()`
- `setPresalesStage()`

Keep the saved Quote loading container at stable height to avoid layout shift.

Render stage completion from the active stage index: stages before it receive a check SVG and `Completed` accessible text, the active stage receives `aria-current="step"`, and later stages remain neutral. If the opportunity model is blocked, the Risk stage receives a red alert SVG and `Blocked by High risk` text.

- [ ] **Step 8: Run the focused tests**

Run:

```bash
node --test test/presales-workbench.test.mjs test/epc-design-ui-state.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Commit the Snapshot slice**

```bash
git add index.html test/presales-workbench.test.mjs
git commit -m "Add presales opportunity snapshot"
```

---

### Task 4: Handoff Drawer, Unsaved Guard, Language/Currency, and Final Polish

**Files:**
- Modify: `presales-workbench.mjs`
- Modify: `index.html:1236-1254`
- Modify: `index.html:21389-21699`
- Modify: `index.html:21739-22490`
- Test: `test/presales-workbench.test.mjs`

**Interfaces:**
- Consumes: structured project, opportunity model, and existing `buildPresalesHandoffText()` sources.
- Produces: `openPresalesHandoff()`, `closePresalesHandoff()`, `setPresalesHandoffTab(tab)`, `copyActivePresalesHandoff()`, and inline unsaved-switch banner actions.
- Produces: `PRESALES_COPY.en` and `PRESALES_COPY.zh` with complete DOM-key coverage.
- Preserves: `generatePresalesHandoff({ silent: true }) -> { customerSummary, internal }` for compatibility.

- [ ] **Step 1: Back up D1 for the final interaction slice**

Run:

```bash
cd worker
npm run backup:d1 -- presales-cockpit-handoff-polish
```

Expected: valid backup and manifest.

- [ ] **Step 2: Add failing drawer, a11y, and responsive tests**

Add:

```js
test('presales handoff uses an accessible drawer and keeps raw notes internal', () => {
  for (const id of [
    'presales-handoff-drawer',
    'presales-handoff-customer-tab',
    'presales-handoff-internal-tab',
    'presales-handoff-preview',
    'presales-handoff-plain-text',
    'presales-unsaved-switch-banner'
  ]) {
    assert.match(indexHtml, new RegExp(`id="${id}"`), `missing handoff id: ${id}`);
  }
  assert.match(indexHtml, /role="dialog"/);
  assert.match(indexHtml, /aria-modal="true"/);
  assert.match(indexHtml, /function openPresalesHandoff/);
  assert.match(indexHtml, /function closePresalesHandoff/);
  assert.match(indexHtml, /function copyActivePresalesHandoff/);
  assert.match(indexHtml, /Raw customer and site notes/);
  assert.match(indexHtml, /@media \(prefers-reduced-motion: reduce\)/);
});

test('every presales DOM copy key exists in English and Chinese', () => {
  const keys = Array.from(indexHtml.matchAll(/data-presales-copy="([^"]+)"/g), match => match[1]);
  assert.ok(keys.length > 20);
  for (const key of new Set(keys)) {
    assert.equal(typeof PRESALES_COPY.en[key], 'string', `missing English copy: ${key}`);
    assert.equal(typeof PRESALES_COPY.zh[key], 'string', `missing Chinese copy: ${key}`);
  }
});
```

Extend the Task 1 module import in this test file to include `PRESALES_COPY` after Task 4 adds that export.

- [ ] **Step 3: Run the test and verify it fails**

Run:

```bash
node --test test/presales-workbench.test.mjs
```

Expected: FAIL because drawer and unsaved banner anchors do not exist.

- [ ] **Step 4: Replace persistent textareas with an accessible drawer**

Add at the end of `#view-presales`:

```html
<div id="presales-handoff-drawer" class="fixed inset-0 z-[120] hidden" role="dialog" aria-modal="true" aria-labelledby="presales-handoff-title">
    <button type="button" class="absolute inset-0 bg-slate-950/45" onclick="closePresalesHandoff()" aria-label="Close handoff"></button>
    <section class="presales-glass absolute inset-x-0 bottom-0 max-h-[92dvh] overflow-y-auto rounded-b-none p-4 md:left-auto md:top-0 md:h-full md:max-h-none md:w-[620px] md:rounded-l-lg md:rounded-r-none md:p-6">
        <div class="flex items-start justify-between gap-4">
            <div><p class="text-xs font-semibold text-purple-700">Handoff</p><h3 id="presales-handoff-title" class="text-lg font-bold text-slate-900">Project summary</h3></div>
            <button type="button" onclick="closePresalesHandoff()" class="presales-action grid min-h-11 min-w-11 place-items-center rounded-lg border border-slate-300 bg-white" aria-label="Close handoff"><svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
        </div>
        <div class="mt-4 grid grid-cols-2 rounded-lg bg-slate-100 p-1" role="tablist">
            <button id="presales-handoff-customer-tab" type="button" role="tab" aria-selected="true" onclick="setPresalesHandoffTab('customer')" class="presales-action min-h-11 rounded-md bg-white text-sm font-bold">Customer Summary</button>
            <button id="presales-handoff-internal-tab" type="button" role="tab" aria-selected="false" onclick="setPresalesHandoffTab('internal')" class="presales-action min-h-11 rounded-md text-sm font-bold">Engineering Handoff</button>
        </div>
        <article id="presales-handoff-preview" class="mt-4 whitespace-pre-wrap rounded-lg bg-white p-4 text-sm leading-6 text-slate-700"></article>
        <details class="mt-3"><summary class="cursor-pointer text-sm font-semibold text-slate-600">View plain text</summary><textarea id="presales-handoff-plain-text" readonly rows="12" class="presales-field mt-2 font-mono text-xs"></textarea></details>
        <button type="button" onclick="copyActivePresalesHandoff()" class="presales-action mt-4 min-h-11 w-full rounded-lg bg-amber-300 px-4 text-sm font-bold text-slate-900">Copy</button>
    </section>
</div>
```

- [ ] **Step 5: Separate customer-safe and internal Handoff content**

Update `buildPresalesHandoffText()` so customer output uses structured summary values and excludes `project.siteSummary`. Internal output includes:

```js
const intake = project.intakeBasis;
const evidenceGaps = buildPresalesEvidenceGaps(project, quote, epc)
    .map(gap => `- ${gap.label}: ${gap.actionLabel}`)
    .join('\n');
```

Customer output includes customer, location, current stage, estimate class, Quote total, recommended PV/BESS/PCS, and the existing preliminary-claim note. Internal output adds Raw customer and site notes, every structured Intake group, evidence gaps, Quote approval, EPC risks, BOQ lines, certification reminder, and engineering review note.

Keep `generatePresalesHandoff({ silent: true })` returning both strings. When not silent, it calls `openPresalesHandoff()` after refreshing the text.

- [ ] **Step 6: Add an inline unsaved project-switch guard**

Add `let presalesDirty = false` and `let presalesPendingProjectId = ''` near existing Presales state. `markPresalesDirty()` sets the flag. `saveCurrentPresalesProject()` clears it after `upsertPresalesProject()` has completed the local snapshot and invoked the existing D1 write queue.

Add `renderPresalesSaveState(state, message)` with allowed states `idle`, `dirty`, `saving`, `saved`, and `error`. Save sets `saving` before calling `upsertPresalesProject()`, `saved` on success, and `error` with `Retry Save` on a synchronous failure. D1 retry-queue failures continue to use the existing backend queue and must not erase the locally saved state.

Add this command-bar banner:

```html
<div id="presales-unsaved-switch-banner" class="mt-3 hidden items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm" role="status">
    <span>Save changes before switching projects?</span>
    <div class="flex flex-wrap gap-2">
        <button type="button" onclick="saveAndSwitchPresalesProject()" class="presales-action min-h-11 rounded-lg bg-purple-800 px-3 text-xs font-bold text-white">Save & Switch</button>
        <button type="button" onclick="discardAndSwitchPresalesProject()" class="presales-action min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold">Discard</button>
        <button type="button" onclick="cancelPresalesProjectSwitch()" class="presales-action min-h-11 px-3 text-xs font-bold text-slate-600">Cancel</button>
    </div>
</div>
```

`selectPresalesProject(id)` restores the current select value and opens this banner when `presalesDirty` is true; otherwise it switches immediately.

- [ ] **Step 7: Add Presales copy hooks and currency-safe Quote totals**

Export a focused dictionary from `presales-workbench.mjs` rather than expanding the already large Quote dictionary, and import it beside the Task 1 Presales exports in `index.html`:

```js
export const PRESALES_COPY = {
    en: {
        workspace: 'Pre-sales Workspace',
        readiness: 'BD Readiness',
        customerSummary: 'Customer Summary',
        engineeringHandoff: 'Engineering Handoff',
        rawNotes: 'Raw customer and site notes'
    },
    zh: {
        workspace: '售前工作台',
        readiness: 'BD 准备度',
        customerSummary: '客户摘要',
        engineeringHandoff: '工程交接',
        rawNotes: '客户与现场原始记录'
    }
};
```

Expand the dictionary to cover every `data-presales-copy` value used by the Workspace: command-bar actions, six stage names, seven Intake group names, every visible field label, evidence option labels, linked-work headings/actions, readiness, KPI labels, evidence-gap actions, Handoff tabs/actions, unsaved-switch actions, empty states, and loading/error recovery text. Add `data-presales-copy` to static labels and call `applyPresalesLanguage()` from `updateLanguageLabels()` and `renderPresalesWorkbench()`. The English strings remain the default when a key is missing, and the test must assert that every DOM key exists in both dictionary branches.

Replace `presalesFormatMoney()` with display-currency conversion based on the existing `rate-myr-cny` input:

```js
function presalesFormatMoney(value, sourceCurrency = 'MYR') {
    const amount = presalesNum(value, 0);
    const rate = Math.max(0.0001, parseFloat(document.getElementById('rate-myr-cny')?.value) || 1.53);
    const displayCurrency = currentCurrency || sourceCurrency || 'MYR';
    let displayAmount = amount;
    if (sourceCurrency === 'MYR' && displayCurrency === 'CNY') displayAmount = amount * rate;
    if (sourceCurrency === 'CNY' && displayCurrency === 'MYR') displayAmount = amount / rate;
    return `${displayCurrency === 'CNY' ? '¥' : 'RM'} ${presalesFormatNumber(displayAmount, 2)}`;
}
```

At the end of `toggleCurrency()`, rerender the Workspace only when Presales is active:

```js
if (getActiveTopLevelTab?.() === 'presales') renderPresalesWorkbench();
```

- [ ] **Step 8: Run focused and full tests**

Run:

```bash
node --test test/presales-workbench.test.mjs test/admin-backend-management.test.mjs test/permission-core.test.mjs test/epc-design-ui-state.test.mjs test/epc-design-engine.test.mjs
```

Expected: PASS.

Run:

```bash
node --test test/*.test.mjs
```

Expected: PASS.

Run:

```bash
cd github-sync
node --test test/*.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Run desktop and mobile browser verification**

Start the site from the worktree:

```bash
python3 -m http.server 8097
```

Use Playwright with mock authenticated permission and representative Intake, Quote, and EPC data. Verify:

- 1440x900: customer, stage, readiness, next action, KPI strip, and energy architecture are visible in the first viewport.
- 375x900: no horizontal overflow; existing projects show Snapshot before secondary Intake; new projects show Customer and Energy first.
- Quote selection refreshes Quote detail and Snapshot.
- EPC selection refreshes recommendation, open High risks, BOQ, and energy architecture.
- High risk caps readiness at 79 and shows customer-output block.
- Handoff drawer tabs, close, plain-text disclosure, and copy work.
- Unsaved project switch offers Save & Switch, Discard, and Cancel without `confirm()`.
- Keyboard focus order is logical and focus rings are visible.
- Reduced-motion emulation removes transitions.
- No page errors occur; the existing Tailwind CDN production warning may remain.

- [ ] **Step 10: Commit the final interaction slice**

```bash
git add presales-workbench.mjs index.html test/presales-workbench.test.mjs
git commit -m "Finish presales cockpit handoff UX"
```

- [ ] **Step 11: Record rollback addresses and clean status**

Run:

```bash
git log --oneline -4
git status --short --branch
git diff --check
```

Expected: four focused implementation commits after the plan commit, clean worktree, and no whitespace errors. Report every full commit SHA and the matching D1 backup manifest. Use `git revert <sha>` for code rollback; do not restore D1 without explicit approval and a new pre-restore backup.
