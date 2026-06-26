import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { normalizeEpcDesignProject } from '../epc-design-engine.mjs';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('Load Work Profile footer summarizes interval energy instead of averaging power', () => {
  const summary = html.match(/function renderEpcDeviceWorkLoadSummaryRow\(rows = \[\]\) \{[\s\S]*?\n        \}/);
  assert.ok(summary, 'Load Work Profile summary renderer should exist');
  assert.match(summary[0], /const summarizeEnergy = key =>/);
  assert.match(summary[0], />Summary</);
  assert.match(summary[0], /summarizeEnergy\('baseLoadKw'\)/);
  assert.match(summary[0], /summarizeEnergy\('unmetLoadKw'\)/);
  assert.doesNotMatch(summary[0], /weightedAverage/);
});

test('EMS Flow row selection restores the table scroll position after rerender', () => {
  assert.match(html, /id="epc-ems-flow-table-scroll"/);
  assert.match(html, /function captureEpcEmsFlowTableScroll\(\)/);
  assert.match(html, /function restoreEpcEmsFlowTableScroll\(position = \{\}\)/);
  const selection = html.match(/window\.selectEpcEnergyFlowHour = \(hour\) => \{[\s\S]*?\n        \};/);
  assert.ok(selection, 'EMS Flow row selection handler should exist');
  assert.match(selection[0], /captureEpcEmsFlowTableScroll\(\)/);
  assert.match(selection[0], /restoreEpcEmsFlowTableScroll\(scrollPosition\)/);
});

test('Animated Energy Flow renders twenty percent taller', () => {
  assert.match(html, /\.epc-flow-svg\s*\{[\s\S]*?min-height:\s*504px;/);
});

test('Battery Control stores separate positive PV charge and load discharge requests', () => {
  const project = normalizeEpcDesignProject({
    emsFlowDisplaySettings: {
      batteryControl: {
        mode: 'manual',
        manualOverrides: [
          { timelineMinute: 540, pvBatteryKw: 120, batteryLoadKw: 0 },
          { timelineMinute: 600, pvBatteryKw: 0, batteryLoadKw: 174 },
          { timelineMinute: 660, batteryKw: 80 },
          { timelineMinute: 720, batteryKw: -90 }
        ]
      }
    }
  }, { now: '2026-06-15T00:00:00.000Z' });

  assert.deepEqual(project.emsFlowDisplaySettings.batteryControl.manualOverrides, [
    { timelineMinute: 540, pvBatteryKw: 120, batteryLoadKw: 0 },
    { timelineMinute: 600, pvBatteryKw: 0, batteryLoadKw: 174 },
    { timelineMinute: 660, pvBatteryKw: 80, batteryLoadKw: 0 },
    { timelineMinute: 720, pvBatteryKw: 0, batteryLoadKw: 90 }
  ]);

  for (const label of ['PV Battery kW', 'Battery load kW']) assert.match(html, new RegExp(label));
  assert.doesNotMatch(html, />Override kW</);
  assert.match(html, /function updateEpcBatteryManualOverride\(timelineMinute, field, value\)/);
  assert.match(html, /function getEpcBatteryManualOverride\(batteryControl = EPC_BATTERY_CONTROL_DEFAULT, timelineMinute = 0\)/);
  const overrideLookup = html.match(/function getEpcBatteryManualOverride\(batteryControl = EPC_BATTERY_CONTROL_DEFAULT, timelineMinute = 0\) \{[\s\S]*?\n        \}/);
  assert.ok(overrideLookup, 'manual battery override lookup should exist');
  assert.match(overrideLookup[0], /Math\.floor\(minute \/ intervalMinutes\) \* intervalMinutes/);

  const dispatch = html.match(/function dispatchEpcDeviceWorkProfileRow\(row = \{\}, model = EPC_DEVICE_WORK_DEFAULT_MODEL, batteryControl = EPC_BATTERY_CONTROL_DEFAULT\)[\s\S]*?function applyEpcDeviceWorkSocLedger/);
  assert.ok(dispatch, 'Device Work dispatch source should be found');
  assert.match(dispatch[0], /manualOverride\.pvBatteryKw/);
  assert.match(dispatch[0], /manualOverride\.batteryLoadKw/);
  assert.match(dispatch[0], /manualPvBatteryKw = Math\.min\(manualOverride\.pvBatteryKw, surplusPvKw, batteryChargeLimitedKw\)/);
  assert.match(dispatch[0], /manualBatteryLoadKw = Math\.min\(manualOverride\.batteryLoadKw, loadKw, batteryDischargeAllowedKw\)/);
  assert.match(dispatch[0], /pvToLoadKw = Math\.max\(0, pvToLoadKw - manualBatteryLoadKw\)/);
});

test('Battery Control manual table mirrors dispatched EMS rows and direct overrides', () => {
  const table = html.match(/function renderEpcBatteryControlPage\(result\)[\s\S]*?function epcPvSimulatorHashSeed/);
  assert.ok(table, 'Battery Control renderer should exist');
  for (const label of [
    'PV Load',
    'PV Battery',
    'Battery Load',
    'Genset',
    'PCS Limit',
    'Curtailment',
    'SOC'
  ]) {
    assert.match(table[0], new RegExp(label), 'manual table should include ' + label);
  }
  const rowSource = html.match(/function getEpcBatteryControlRows\(result = \{\}, control = EPC_BATTERY_CONTROL_DEFAULT\)[\s\S]*?function renderEpcBatteryControlPage/);
  assert.ok(rowSource, 'Battery Control row source should exist');
  assert.match(rowSource[0], /getEpcEnergyFlowDisplayRows\(\{[\s\S]*?\.\.\.result/, 'manual table should reuse EMS display rows');
  assert.match(table[0], /overrideMap\.get\(minute\)\?\.pvBatteryKw \?\? row\.pvToBatteryKw/, 'PV Battery input should show current dispatched value until edited');
  assert.match(table[0], /overrideMap\.get\(minute\)\?\.batteryLoadKw \?\? row\.batteryToLoadKw/, 'Battery load input should show current dispatched value until edited');

  const dispatch = html.match(/function dispatchEpcDeviceWorkProfileRow\(row = \{\}, model = EPC_DEVICE_WORK_DEFAULT_MODEL, batteryControl = EPC_BATTERY_CONTROL_DEFAULT\)[\s\S]*?function applyEpcDeviceWorkSocLedger/);
  assert.ok(dispatch, 'dispatch source should exist');
  assert.match(dispatch[0], /manualBatteryLoadKw = Math\.min\(manualOverride\.batteryLoadKw, loadKw, batteryDischargeAllowedKw\)/, 'manual discharge should be allowed to replace PV load');
  assert.match(dispatch[0], /pvToLoadKw = Math\.max\(0, pvToLoadKw - manualBatteryLoadKw\)/, 'manual discharge should reduce PV load share');
  assert.match(dispatch[0], /manualPvBatteryKw = Math\.min\(manualOverride\.pvBatteryKw, surplusPvKw, batteryChargeLimitedKw\)/, 'manual PV charge should use only PV surplus');
});

test('EMS Flow table removes genset reason and displays one decimal values', () => {
  const renderer = html.match(/function renderEpcEnergyFlow\(result\)[\s\S]*?function renderEpcReports\(result\)/);
  assert.ok(renderer, 'EMS Flow renderer should exist');
  assert.doesNotMatch(renderer[0], />Genset reason</i);
  assert.doesNotMatch(renderer[0], /row\.gensetReason \|\| '-'/);
  assert.match(renderer[0], /formatEpcNumber\(row\.pvOutputKw, 1\)/);
  assert.match(renderer[0], /formatEpcNumber\(row\.loadKw, 1\)/);
  assert.match(renderer[0], /formatEpcNumber\(row\.curtailmentKw, 1\)/);
  assert.match(renderer[0], />Battery Start kWh</);
  assert.match(renderer[0], />Battery End kWh</);
  assert.ok(
    renderer[0].indexOf('Battery End kWh') < renderer[0].indexOf('>SOC<'),
    'battery kWh columns should appear before SOC'
  );
  assert.match(renderer[0], /formatEpcNumber\(row\.batteryStartKwh, 1\)/);
  assert.match(renderer[0], /formatEpcNumber\(row\.batteryEndKwh, 1\)/);
  const total = html.match(/function renderEpcFlowTotalRow\(rows = \[\]\)[\s\S]*?function mergeEpcEnergyFlowRowsByHour/);
  assert.ok(total, 'EMS total row renderer should exist');
  assert.match(total[0], /formatEpcNumber\(sum\('pvOutputKw'\), 1\)/);
  assert.match(total[0], /firstBatteryStartKwh/);
  assert.match(total[0], /finalBatteryEndKwh/);
});

test('EPC UI exposes final capacity overrides and reset action', () => {
  for (const snippet of [
    'data-epc-field="designTargets.capacityOverrides.pvMwp"',
    'data-epc-field="designTargets.capacityOverrides.pcsMw"',
    'data-epc-field="designTargets.capacityOverrides.bessMwh"',
    'Final PV MWp',
    'Final PCS MW',
    'Final BESS MWh',
    'resetEpcCapacityOverrides()',
    'Manual Override'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&')), 'missing capacity override UI snippet: ' + snippet);
  }
  assert.match(html, /function resetEpcCapacityOverrides\(\)/);
  assert.match(html, /setInputValue\('epc-final-pv-mwp'/);
  assert.match(html, /setInputValue\('epc-final-pcs-mw'/);
  assert.match(html, /setInputValue\('epc-final-bess-mwh'/);
});
