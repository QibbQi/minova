# Pre-sales Workspace Intake Cockpit Design

Date: 2026-07-12
Status: Approved direction, implementation pending
Scope: Pre-sales Workspace only

## 1. Purpose

Redesign the existing Pre-sales Workspace into a compact BD cockpit that supports rapid intake, solution review, quote and EPC linkage, risk awareness, and engineering handoff.

The redesign must solve two problems together:

1. Long, mixed-purpose Intake text currently becomes difficult to enter, scan, compare, and hand over.
2. The page needs a more premium visual character without reducing information density or making an operational tool feel decorative.

The intended visual direction is functional frosted glass: restrained translucent surfaces, clear depth, strong contrast, and visual summaries based on real Quote and EPC data.

## 2. Goals

- Let a BD user understand an existing opportunity within ten seconds.
- Keep raw customer and site notes available without making them the primary reading surface.
- Turn the most important intake facts into structured, scannable values.
- Show what is known, what is assumed, and what is still missing.
- Keep linked Quote and Hybrid EPC details visible without duplicating their calculation logic.
- Make the first viewport useful on desktop and mobile.
- Preserve the existing save, permission, Quote, EPC, handoff, and D1 contracts.
- Use Minova purple and yellow as restrained operational accents.

## 3. Non-goals

- Do not redesign the full Minova application shell.
- Do not replace Quote snapshot calculations or the Hybrid EPC engine.
- Do not introduce AI extraction, CRM activity history, Kanban, task assignment, or notifications in this iteration.
- Do not turn the page into a marketing dashboard with oversized headings or decorative charts.
- Do not make engineering confidence claims from a UI completeness score.
- Do not remove `siteSummary`; it remains the backward-compatible raw note field.

## 4. Current Problems

### 4.1 Intake mixes unrelated information

The current Intake card contains customer identity, workflow stage, assumption status, risk status, and a single Site Summary textarea. The textarea is expected to contain address, bills, diesel baseline, roof constraints, load constraints, customer notes, and deadlines.

This creates three failure modes:

- The user must remember what to include.
- Important numeric values become buried in prose.
- The same prose is repeated in the right-side Customer/Site summary card.

### 4.2 Workflow stage has two controls

The six-stage navigator and the Stage select represent the same state. Both appear as editable controls, which creates unnecessary choice and visual weight.

### 4.3 All summary cards have equal priority

Customer information, calculation evidence, Quote, and EPC are presented as four similar cards. The layout does not tell the user whether the urgent issue is missing evidence, an unlinked quote, an open High risk, or an incomplete solution.

### 4.4 Handoff occupies permanent page space

Two large read-only textareas are useful for copying but poor for routine scanning. They make the page longer and visually compete with active work.

### 4.5 Mobile is structurally long

At 375px, the current page is approximately 2983px tall with representative content. The first viewport shows workflow controls and only the beginning of Intake. Quote, EPC, evidence gaps, and handoff are too far below.

## 5. Recommended Information Architecture

The Workspace becomes five layers in this order:

1. Command bar
2. Workflow progress
3. Opportunity cockpit
4. Evidence and linked work
5. Handoff drawer

### 5.1 Command bar

The command bar contains:

- Project selector
- Customer name and current stage
- Save state: Saved, Saving, Unsaved, or Save failed
- New Case
- Save
- Generate Handoff

Only Save is the primary purple action while the project is being edited. Generate Handoff becomes the primary yellow action only when the Handoff drawer is open.

On desktop, the bar may be sticky below the main application header. On mobile, it becomes two rows and must not cover scroll content.

### 5.2 Workflow progress

The six separate stage cards become one compact progress rail:

`Intake -> Sizing -> Product/BOQ -> Risk -> Quote/PDF -> Handoff`

Rules:

- The progress rail is the only Stage editor.
- Completed stages use a check icon and neutral text.
- Current stage uses Minova purple and a visible selected state.
- Blocked stages show an amber or red status icon plus text; color is not the only indicator.
- Desktop shows all six labels.
- Mobile shows `Step 2 of 6 - Sizing`, a progress bar, and an Expand Steps control. It must not require horizontal scrolling.

### 5.3 Opportunity cockpit

Desktop uses a 12-column grid:

- Quick Intake: 4 columns
- Opportunity Snapshot: 8 columns

The Snapshot contains three unframed bands rather than cards nested inside a card:

1. BD readiness and next action
2. Commercial and solution KPIs
3. Energy architecture visualization

The next action must be specific, for example:

- Upload remaining 4 monthly bills
- Link a Quote Draft
- Review 3 open High risks
- Confirm tariff source date
- Ready for engineering handoff

### 5.4 Evidence and linked work

Below the cockpit, show:

- Evidence gaps strip
- Quote preview
- EPC concept preview
- Risk and BOQ summary

Quote and EPC remain separate surfaces because they have different ownership and review status. Their values continue to come from the existing saved Quote snapshot and `calculateEpcDesignProject()` result.

### 5.5 Handoff drawer

Customer Summary and Internal Engineering Handoff move into a bottom drawer or side sheet.

The drawer contains two tabs:

- Customer Summary
- Engineering Handoff

Each tab shows a formatted preview followed by Copy. Raw read-only text is available under `View plain text`, not as the default presentation.

Closing the drawer must not discard Intake changes.

## 6. Intake Basis Design

### 6.1 Progressive disclosure

Quick Intake shows the six most decision-relevant groups:

1. Customer
2. Energy
3. Diesel
4. Site
5. Objective
6. Evidence

Only Customer and Energy are expanded for a new project. Other groups show a one-line summary and completeness state. Users can expand one or more groups without entering a separate modal.

### 6.2 Structured fields

#### Customer

- Customer name
- Site name
- Location
- Business or facility type

#### Energy

- Monthly consumption, kWh
- Available bill months
- Peak demand, kW
- Tariff category
- Tariff source
- Tariff source date

#### Diesel

- Genset capacity, kVA
- Runtime, hours per month
- Diesel consumption, litres per month
- Primary use: outage, peak shaving, continuous, or unknown

#### Site

- Available roof or ground area, m2
- Transformer capacity, kVA
- Export eligibility: confirmed, restricted, not allowed, or unknown
- Primary constraint summary

#### Objective

- Target saving, percent
- Budget range
- Proposal due date
- Customer decision note

#### Evidence

- Utility bills: complete, partial, missing
- Load profile: available, requested, missing
- Site photos: available, requested, missing
- Existing SLD: available, requested, missing
- Structural report: available, requested, not required, missing

### 6.3 Raw notes

`siteSummary` is relabelled `Raw customer and site notes`.

Rules:

- It remains a freeform textarea for call notes, pasted messages, and unusual constraints.
- It is collapsed by default after the project has structured Intake data.
- The collapsed state shows two lines with Expand and Edit controls.
- No automatic parsing is introduced in this iteration.
- Raw notes are included in the internal handoff but not copied verbatim into the customer-facing summary.

### 6.4 Evidence gaps

Evidence gaps are derived from structured Intake and linked work. They are displayed as compact rows with status icon, label, and action.

Examples:

- `Bills 8/12 - Add 4 months`
- `Load profile missing - Request from customer`
- `Tariff source date missing - Add source`
- `Quote not linked - Select draft`
- `3 open High risks - Open EPC Risks`

Evidence gaps must not be represented only by a percentage.

## 7. Data Contract

The existing `presalesProjects` record remains backward compatible. Existing fields are retained:

```js
{
  id,
  customerName,
  siteSummary,
  stage,
  quoteId,
  epcDesignProjectId,
  assumptionStatus,
  riskStatus,
  updatedAt
}
```

Add optional nested fields:

```js
{
  intakeBasis: {
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
  },
  evidenceStatus: {
    utilityBills: 'missing',
    loadProfile: 'missing',
    sitePhotos: 'missing',
    existingSld: 'missing',
    structuralReport: 'missing'
  }
}
```

Compatibility rules:

- Missing nested objects normalize to the defaults above.
- Existing projects continue to render using `customerName` and `siteSummary`.
- Saving an existing project may add normalized nested objects without changing its linked Quote or EPC identifiers.
- D1 continues to store the project as the existing `presales_project` JSON payload; no SQL migration is expected.
- Local state, embedded state, D1 bootstrap, GitHub snapshot, and merge behavior must preserve the nested objects.

## 8. BD Readiness Score

The circular visual is labelled `BD Readiness`, not `Engineering Confidence`.

It is a deterministic completeness indicator:

- Intake basis: 30 points
- Evidence: 25 points
- Quote linkage and readable snapshot: 15 points
- EPC linkage and calculated concept: 20 points
- Risk review state: 10 points

Rules:

- The score never changes Quote ROI, EPC sizing, risk severity, or approval state.
- Hover, focus, or tap reveals the point breakdown.
- The score is accompanied by a plain-language next action.
- An open blocking High risk caps the displayed readiness at 79 and adds `Customer-facing output blocked by High risk`.
- Missing tariff source or date keeps financial claims labelled preliminary regardless of score.

## 9. Opportunity Snapshot

### 9.1 KPI strip

Show up to six values, prioritised by availability:

- Monthly consumption
- Proposed PV
- Recommended BESS
- Recommended PCS
- Quote total
- Payback or savings estimate

Each KPI shows:

- Value
- Unit
- Source label: Intake, Quote snapshot, EPC draft, or unavailable
- Confidence label where required

Numbers use tabular figures. Missing values show an em dash plus a direct action rather than `0`.

### 9.2 Energy architecture visual

Use a lightweight responsive SVG diagram based on linked EPC results:

`PV -> AC Bus -> Customer Load`

with optional branches for BESS, Grid, and Genset.

Rules:

- Values are taken from the existing EPC preview result.
- The graphic is informational, not an editable SLD.
- Each node includes icon, label, capacity, and state.
- Unknown or unlinked nodes use dashed outlines and `Pending`.
- Purple represents the selected or recommended solution path.
- Yellow represents attention or pending confirmation.
- Red is reserved for blocking risk.
- A text summary is provided for screen readers.

## 10. Visual System

### 10.1 Principle

Use glass to express hierarchy and focus, not as decoration. Forms and long text remain on opaque or nearly opaque surfaces.

### 10.2 Tokens

```css
--presales-bg: #F3F5F8;
--presales-surface: rgba(255, 255, 255, 0.78);
--presales-surface-solid: #FFFFFF;
--presales-border: rgba(148, 163, 184, 0.32);
--presales-highlight: rgba(255, 255, 255, 0.9);
--presales-text: #172033;
--presales-muted: #64748B;
--presales-purple: #582C83;
--presales-yellow: #FFC107;
--presales-success: #15803D;
--presales-warning: #B45309;
--presales-danger: #B91C1C;
--presales-radius: 8px;
--presales-blur: 18px;
--presales-shadow: 0 12px 32px rgba(15, 23, 42, 0.08);
```

### 10.3 Surface use

Frosted glass is allowed for:

- Command bar
- Workflow rail
- Opportunity Snapshot
- Handoff drawer

Opaque surfaces are required for:

- Inputs and selects
- Expanded Intake groups
- Long text
- Quote and EPC detail grids
- Error and validation messages

### 10.4 Typography

- Use the existing application system font stack.
- Page title: 24px, 700 weight.
- Section title: 16px, 650-700 weight.
- Body: 14px desktop, 16px form text on mobile.
- Labels: 11-12px, 600 weight, sentence case.
- Avoid widespread uppercase and `font-black` styling.
- Do not use negative letter spacing.

### 10.5 Motion

- 180-220ms for hover, focus, expand, and panel transitions.
- Animate opacity and transform only.
- No decorative page-entry sequence.
- Respect `prefers-reduced-motion`.
- Loading a saved Quote may use a fixed-height skeleton to avoid layout shift.

## 11. Responsive Behavior

### Desktop, 1280px and above

- 4/8 Intake and Snapshot split.
- Quote and EPC previews appear side by side.
- Command bar may remain sticky.
- Existing project first viewport must include customer, stage, readiness, primary KPIs, and next action.

### Tablet, 768px to 1279px

- Intake and Snapshot stack or use a 5/7 split where space permits.
- KPI strip uses three columns.
- Energy architecture remains full width.

### Mobile, 375px to 767px

- No horizontal page scroll.
- Existing projects show Snapshot before expanded Intake.
- New projects show Customer and Energy Intake first.
- Stage control becomes compact progress plus Expand Steps.
- KPI strip uses two columns.
- Intake groups use full-width accordion rows with 44px minimum targets.
- Primary project actions remain visible without overlapping the application header.
- Handoff opens as a full-height sheet with a clear close action.

## 12. Interaction and State

- Intake changes update the Snapshot and evidence gaps locally without an automatic D1 write on every keystroke.
- Save uses the existing project persistence path and provides Saving, Saved, or Save failed feedback.
- Switching projects with unsaved changes requires a clear confirmation or save option.
- Selecting a Quote or EPC refreshes its preview and the Snapshot immediately.
- Quote loading reserves stable space and reports retryable errors inline.
- Missing EPC browser state shows Open EPC as the recovery action.
- Generate Handoff first refreshes the latest derived summary, then opens the drawer.
- New visible labels participate in the existing Chinese/English language switch.
- Quote totals, savings, and other monetary KPIs use the existing RM/¥ currency formatting and conversion path.

## 13. Accessibility

- Text contrast must meet WCAG AA against both glass and opaque surfaces.
- All form controls keep visible labels.
- Focus indicators are 2px minimum and use a high-contrast purple outline.
- Stage, readiness, evidence, and risk states include text or icons, not color alone.
- SVG energy architecture includes a concise accessible summary.
- Icon-only controls require `aria-label` and tooltip.
- All mobile controls use at least a 44px interaction area.
- Accordion buttons expose `aria-expanded` and connect to their controlled region.

## 14. Implementation Boundaries

The implementation should stay within the existing ownership model:

- `index.html`: Workspace markup, styles, rendering, intake state, readiness, visualization, drawer, and browser interactions.
- Existing Presales normalization and persistence functions: nested Intake and evidence fields.
- `auth/minova-auth-ui.mjs` and `worker/src/index.mjs`: verify JSON payload round-trip only; no new domain is expected.
- `github-sync/merge.js` and published state paths: preserve nested project objects.
- `test/presales-workbench.test.mjs`: DOM anchors, normalization, derived score, evidence gaps, Quote/EPC linkage, and handoff behavior.

Do not change:

- Quote snapshot schema unless an implementation test proves a required KPI is unavailable.
- `epc-design-engine.mjs` or `epc-design-engine.global.js` for visual-only needs.
- Product Master canonical product shape.

## 15. Verification and Acceptance Criteria

### Functional

- Existing Presales projects load without errors and retain their current linked Quote and EPC.
- Structured Intake survives local save, D1 save/readback, embedded/static state, and GitHub merge paths.
- Long Raw Notes can be expanded and edited but are collapsed by default for a populated project.
- Selecting linked work immediately refreshes the relevant preview and Snapshot.
- Handoff includes structured Intake, raw internal notes, Quote values, EPC recommendation, evidence gaps, and open risks.
- Customer Summary excludes raw internal notes and unverified firm claims.

### Visual

- Stage is editable in one place only.
- Existing project first viewport contains customer, stage, readiness, next action, and solution KPIs at 1440x900.
- At 375x900, there is no horizontal overflow and the user sees either new-project Intake essentials or existing-project Snapshot before secondary content.
- Long customer names, locations, and risk messages wrap without overlapping controls.
- Glass surfaces remain readable when `backdrop-filter` is unavailable.
- No nested decorative cards, emoji icons, gradient orbs, or oversized marketing headings are introduced.

### Tests

- Run `node --test test/presales-workbench.test.mjs` during development.
- Run `node --test test/*.test.mjs` before completion because `index.html` and persisted state are shared.
- Run `git diff --check`.
- Browser-smoke desktop at 1440x900.
- Browser-smoke mobile at 375x900.
- Check saved Quote loading, linked EPC calculation, evidence gap actions, Handoff drawer, unsaved state, keyboard navigation, and reduced motion.

## 16. Delivery Sequence

1. Add normalized structured Intake and evidence state with regression tests.
2. Replace duplicate Stage controls with the responsive workflow rail.
3. Build Quick Intake and Raw Notes progressive disclosure.
4. Build BD Readiness, next action, KPI strip, and energy architecture visual.
5. Recompose Quote, EPC, risk, and evidence surfaces.
6. Replace persistent Handoff textareas with the accessible drawer.
7. Apply the functional glass visual tokens and responsive states.
8. Complete full tests and desktop/mobile browser verification.
