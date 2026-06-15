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
  assert.match(dispatch[0], /Math\.min\(batteryChargeLimitedKw, manualOverride\.pvBatteryKw\)/);
  assert.match(dispatch[0], /Math\.min\(remainingLoadKw, manualOverride\.batteryLoadKw, batteryDischargeAllowedKw\)/);
});
