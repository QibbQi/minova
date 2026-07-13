import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildPresalesEvidenceGaps,
  buildPresalesOpportunityModel,
  calculatePresalesReadiness,
  normalizePresalesProject,
  PRESALES_READINESS_LABEL
} from '../presales-workbench.mjs';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const authUiSource = readFileSync(new URL('../auth/minova-auth-ui.mjs', import.meta.url), 'utf8');
const workerSource = readFileSync(new URL('../worker/src/index.mjs', import.meta.url), 'utf8');
const mergeSource = readFileSync(new URL('../github-sync/merge.js', import.meta.url), 'utf8');

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
  assert.equal(PRESALES_READINESS_LABEL, 'BD Readiness');
  assert.equal(readiness.label, 'BD Readiness');
  assert.equal(readiness.nextAction, 'Open EPC High Risks');
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

test('presales workspace is a first-class top-level BD entry', () => {
  assert.match(indexHtml, /id="tab-presales"[^>]*aria-label="Pre-sales Workspace"/);
  assert.match(indexHtml, /onclick="switchTab\('presales'\)"/);
  assert.match(indexHtml, /<main id="view-presales"[\s\S]*Pre-sales Workspace/);
  assert.match(indexHtml, /PRESALES_STAGES\.map/);
  assert.match(indexHtml, /id="presales-project-select"/);
  assert.match(indexHtml, /id="presales-quote-link"/);
  assert.match(indexHtml, /id="presales-epc-link"/);
});

test('presales project state persists through local, D1, and GitHub sync paths', () => {
  for (const snippet of [
    'let presalesProjects = []',
    'normalizePresalesProjectList',
    'minova_presales_projects_v1',
    'presalesProjects',
    'presales_project'
  ]) {
    assert.match(indexHtml, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing presales state snippet: ${snippet}`);
  }
  assert.match(workerSource, /presales_project:\s*'presales'/);
  assert.match(authUiSource, /presales_project:\s*'presales'/);
  assert.match(mergeSource, /presalesProjects:\s*mergeByKey/);
});

test('BD-facing calculation outputs disclose assumption class and review status', () => {
  for (const snippet of [
    'Preliminary / BD estimate',
    'Engineering draft / requires review',
    'Tariff/source date',
    'CAPEX source',
    'Engineering confirmed',
    'PV performance ratio / loss factor'
  ]) {
    assert.match(indexHtml, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing assumption disclosure: ${snippet}`);
  }
});

test('internal handoff separates customer summary from engineering review notes', () => {
  assert.match(indexHtml, /function generatePresalesHandoff/);
  assert.match(indexHtml, /Internal engineering handoff/);
  assert.match(indexHtml, /Customer-facing summary/);
  assert.match(indexHtml, /Unconfirmed risks/);
  assert.match(indexHtml, /Quote version/);
  assert.match(indexHtml, /Approval status/);
});

test('linked quote and EPC selections expose BD-readable detail previews', () => {
  for (const snippet of [
    'id="presales-quote-detail"',
    'id="presales-epc-detail"',
    'function getPresalesQuoteDetail',
    'function renderPresalesQuoteDetail',
    'function getPresalesEpcDetail',
    'function renderPresalesEpcDetail',
    'onPresalesLinkedWorkChanged',
    'Quote Total',
    'Monthly Usage',
    'Target Generation',
    'Recommended PV/BESS/PCS',
    'Open High Risks',
    'BOQ Lines'
  ]) {
    assert.match(indexHtml, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing linked detail preview: ${snippet}`);
  }
});

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
  for (const snippet of [
    'function renderPresalesOpportunitySnapshot',
    'function renderPresalesEvidenceGaps',
    'function renderPresalesEnergyArchitecture',
    'function focusPresalesGap',
    "focusPresalesGap('${htmlSafe(kpi.target)}', '${htmlSafe(kpi.action)}')",
    "focusPresalesGap('${htmlSafe(gap.target)}', '${htmlSafe(gap.actionLabel)}')",
    "if (target === 'quote' && !isLinkSelectionAction)",
    "if (target === 'epc' && !isLinkSelectionAction)",
    'presales-energy-mobile',
    'data-presales-energy-label',
    'BD Readiness',
    'Customer-facing output blocked by High risk',
    'aria-current="step"',
    'Blocked by High risk',
    "const emDash = '—'",
    'function presalesSnapshotHasValue'
  ]) {
    assert.match(indexHtml, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing snapshot behavior: ${snippet}`);
  }
});

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

test('presales intake uses canonical enum values and keeps collapsed raw notes readable', () => {
  const optionValues = id => {
    const select = indexHtml.match(new RegExp(`<select id="${id}"[^>]*>([\\s\\S]*?)</select>`));
    assert.ok(select, `missing select: ${id}`);
    return [...select[1].matchAll(/<option value="([^"]+)"/g)].map(([, value]) => value);
  };

  const presalesEnumValues = [
    ...optionValues('presales-genset-use'),
    ...optionValues('presales-export-eligibility'),
    ...optionValues('presales-evidence-utility-bills')
  ];
  assert.deepEqual(optionValues('presales-genset-use'), ['unknown', 'outage', 'peak_shaving', 'continuous']);
  assert.deepEqual(optionValues('presales-export-eligibility'), ['unknown', 'confirmed', 'restricted', 'not_allowed']);
  assert.deepEqual(optionValues('presales-evidence-utility-bills'), ['complete', 'partial', 'missing']);
  for (const id of [
    'presales-evidence-load-profile',
    'presales-evidence-site-photos',
    'presales-evidence-existing-sld'
  ]) {
    const values = optionValues(id);
    presalesEnumValues.push(...values);
    assert.deepEqual(values, ['available', 'requested', 'missing']);
  }
  const structuralValues = optionValues('presales-evidence-structural-report');
  presalesEnumValues.push(...structuralValues);
  assert.deepEqual(structuralValues, ['available', 'requested', 'not_required', 'missing']);
  for (const invalid of ['backup', 'prime', 'eligible', 'not_eligible', 'pending']) {
    assert.ok(!presalesEnumValues.includes(invalid), `invalid Presales enum value: ${invalid}`);
  }

  assert.match(indexHtml, /id="presales-intake-notes-summary"/);
  assert.match(indexHtml, /function updatePresalesIntakeSummaries/);
  assert.match(indexHtml, /No raw notes captured yet\./);
  assert.match(indexHtml, /-webkit-line-clamp:\s*2/);
  assert.match(indexHtml, /togglePresalesIntakeGroup\('notes'\)/);
  assert.match(indexHtml, /\? `presales-stage-btn min-h-11/);
});
