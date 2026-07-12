import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildPresalesEvidenceGaps,
  buildPresalesOpportunityModel,
  calculatePresalesReadiness,
  normalizePresalesProject
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

test('presales workspace is a first-class top-level BD entry', () => {
  assert.match(indexHtml, /id="tab-presales"[^>]*aria-label="Pre-sales Workspace"/);
  assert.match(indexHtml, /onclick="switchTab\('presales'\)"/);
  assert.match(indexHtml, /<main id="view-presales"[\s\S]*Pre-sales Workspace/);
  assert.match(indexHtml, /Intake[\s\S]*Sizing[\s\S]*Product\/BOQ[\s\S]*Risk[\s\S]*Quote\/PDF[\s\S]*Handoff/);
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
