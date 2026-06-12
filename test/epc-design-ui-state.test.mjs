import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const mergeSource = readFileSync(new URL('../github-sync/merge.js', import.meta.url), 'utf8');

test('EPC design tab is placed between Product List and Engineering Workspace', () => {
  const databasePos = html.indexOf('id="tab-database"');
  const epcPos = html.indexOf('id="tab-epcdesign"');
  const engineeringPos = html.indexOf('id="tab-engineering"');

  assert.ok(databasePos > -1, 'database tab exists');
  assert.ok(epcPos > databasePos, 'EPC tab is after Product List');
  assert.ok(engineeringPos > epcPos, 'Engineering tab is after EPC tab');
  assert.match(html, /id="tab-epcdesign"[^>]*aria-label="Hybrid EPC Design"/);
  assert.match(html, /id="tab-epcdesign"[\s\S]*?<svg/);
  assert.match(html, /<script src="\.\/epc-design-engine\.global\.js\?v=epc-design-v2"><\/script>\s*<script type="module">\s*const \{/);
  assert.doesNotMatch(html, /<script type="module">\s*import \{\s*EPC_DESIGN_DEFAULTS/);
});

test('EPC design workspace exposes quick detailed map solar and report surfaces', () => {
  const section = html.match(/<main id="view-epcdesign"[\s\S]*?<main id="view-engineering"/);
  assert.ok(section, 'EPC design view exists before Engineering workspace');
  const source = section[0];

  for (const snippet of [
    'Quick Design',
    'Detailed Design',
    'Use Current Location',
    'Global Solar Atlas',
    'epc-design-map',
    'epc-design-schemes',
    'epc-design-formula-trace',
    'epc-design-boq',
    'epc-design-risks',
    'downloadEpcDesignReport'
  ]) {
    assert.match(source, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing EPC UI snippet: ${snippet}`);
  }
});

test('EPC detailed engineering inputs are permission-gated separately from quick design', () => {
  assert.match(html, /id="epc-detailed-fields"[^>]*data-epc-engineering-section="true"/);
  assert.match(html, /canPerformAction\?\.\('epcDesignEngineering', 'read'\)/);
  assert.match(html, /canPerformAction\?\.\('epcDesignEngineering', 'edit'\)/);
  assert.match(html, /const engineeringOnly = !!el\.closest\('#epc-detailed-fields'\)/);
});

test('EPC workspace guides junior engineers through load PCS battery PV steps', () => {
  for (const snippet of [
    'epc-wizard-steps',
    'Step 1 Load',
    'Step 2 PCS',
    'Step 3 Battery',
    'Step 4 PV & Strings',
    'Step 5 EMS Simulation',
    'epc-load-peak',
    'epc-allowed-genset-load',
    'epc-support-hours',
    'epc-module-wp',
    'epc-modules-per-string',
    'epc-combiner-inputs',
    'epc-energy-flow-table'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing guided EPC UI snippet: ${snippet}`);
  }
});

test('EPC map controls expose browser IP and manual location fallbacks', () => {
  for (const snippet of [
    'Use Current Location',
    'Use IP Location',
    'window.useEpcIpLocation',
    'ipapi.co/json',
    'Location permission was denied'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing location fallback snippet: ${snippet}`);
  }
});

test('EPC EMS flow exposes animated system diagram and clickable hour rows', () => {
  for (const snippet of [
    'epc-flow-diagram',
    'epc-flow-svg',
    'epc-flow-summary',
    'selectEpcEnergyFlowHour',
    'data-epc-flow-hour',
    'data-epc-flow-hour-button',
    'epc-flow-line',
    'epc-flow-line-active',
    'epc-flow-node',
    'epc-flow-sun',
    'epc-flow-pv',
    'epc-flow-inverter',
    'epc-flow-battery',
    'epc-flow-ems',
    'epc-flow-genset',
    'epc-flow-load',
    'Water Pump',
    'Mining Machine'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing animated flow snippet: ${snippet}`);
  }
});

test('EPC design projects persist through app state and sync merge', () => {
  for (const snippet of [
    'let epcDesignProjects = []',
    'let epcDesignDefaults =',
    'minova_epc_design_projects_v1',
    'minova_epc_design_defaults_v1',
    'normalizeEpcDesignProjectList',
    'epcDesignProjects',
    'epcDesignDefaults'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing state snippet: ${snippet}`);
  }
  assert.match(mergeSource, /epcDesignProjects:\s*mergeByKey/);
  assert.match(mergeSource, /epcDesignDefaults:\s*\{\s*\.\.\.\(rData\.epcDesignDefaults/);
});
