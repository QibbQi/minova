import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const authUiSource = readFileSync(new URL('../auth/minova-auth-ui.mjs', import.meta.url), 'utf8');
const workerSource = readFileSync(new URL('../worker/src/index.mjs', import.meta.url), 'utf8');
const mergeSource = readFileSync(new URL('../github-sync/merge.js', import.meta.url), 'utf8');

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
