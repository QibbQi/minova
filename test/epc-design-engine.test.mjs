import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EPC_DESIGN_DEFAULTS,
  buildEpcDesignProjectFromQuickInputs,
  buildGlobalSolarAtlasUrl,
  calculateEpcDesignProject,
  calculatePvStringDesign,
  normalizeEpcDesignProject
} from '../epc-design-engine.mjs';

const quarryInputs = {
  projectName: 'Malaysia Quarry Hybrid Study',
  country: 'Malaysia',
  state: 'Selangor',
  latitude: 2.960857,
  longitude: 101.572564,
  dieselTotalLiters: 622259,
  dieselPeriodDays: 151,
  dieselPricePerLiter: 4.67,
  operationHoursPerDay: 8,
  targetReplacementPct: 80,
  availableAreaM2: 52000,
  gridMode: 'island',
  pvYieldKwhPerKwpDay: 3.6
};

test('EPC design engine reproduces the quarry workbook sizing baseline', () => {
  const project = buildEpcDesignProjectFromQuickInputs(quarryInputs, {
    defaults: {
      ...EPC_DESIGN_DEFAULTS,
      bessAutonomyHours: 1.9,
      pcsSafetyFactor: 1.5
    },
    now: '2026-06-12T00:00:00.000Z'
  });
  const result = calculateEpcDesignProject(project, {
    now: '2026-06-12T00:00:00.000Z'
  });

  assert.equal(result.load.dailyDieselLiters.toFixed(2), '4120.92');
  assert.equal(result.load.dailyLoadKwh.toFixed(2), '15262.67');
  assert.equal(result.load.averageLoadKw.toFixed(2), '1907.83');

  const recommended = result.schemes.find((scheme) => scheme.id === 'replace-80');
  assert.ok(recommended, 'recommended 80% scheme is present');
  assert.equal(recommended.replacementPct, 80);
  assert.equal(recommended.pvRecommendedMwp.toFixed(2), '3.90');
  assert.equal(recommended.bessRecommendedMwh.toFixed(2), '4.49');
  assert.equal(recommended.pcsRecommendedMw.toFixed(2), '3.00');
  assert.equal(recommended.monthlyDieselSavedLiters.toFixed(0), '98902');
  assert.equal(recommended.monthlySavings.toFixed(2), '461872.77');

  assert.ok(result.electrical.lvCurrentA > 5800 && result.electrical.lvCurrentA < 5900);
  assert.equal(result.electrical.mvRecommended, true);
  assert.match(result.electrical.recommendation, /11kV/);
  assert.ok(result.formulaTrace.some((item) => item.key === 'dailyLoadKwh' && item.formula.includes('Daily Diesel / SFC')));
  assert.ok(result.formulaTrace.some((item) => item.key === 'peakLoadKw' && item.formula.includes('Average Load x Peak Load Factor')));
  assert.ok(result.formulaTrace.some((item) => item.key === 'criticalLoadKw' && item.formula.includes('Average Load fallback')));
});

test('EPC design engine creates auditable formula outputs and GSA link inputs', () => {
  const normalized = normalizeEpcDesignProject({
    project: { name: 'Short Input' },
    site: { latitude: '2.960857', longitude: '101.572564', country: 'Malaysia' },
    loads: { dieselTotalLiters: '622259', dieselPeriodDays: '151', operationHoursPerDay: '8' },
    designTargets: { replacementPct: '80' }
  }, { now: '2026-06-12T00:00:00.000Z' });
  const result = calculateEpcDesignProject(normalized, { now: '2026-06-12T00:00:00.000Z' });
  const trace = result.formulaTrace.find((item) => item.key === 'pvRecommendedMwp');

  assert.equal(normalized.solarResource.specificYieldKwhPerKwpDay, 3.6);
  assert.equal(normalized.solarResource.dataSource, 'Malaysia Default');
  assert.equal(
    normalizeEpcDesignProject({ loads: { equipmentType: 'crusher' } }, { now: '2026-06-12T00:00:00.000Z' }).loads.equipmentType,
    'crusher'
  );
  assert.equal(
    buildEpcDesignProjectFromQuickInputs({ ...quarryInputs, equipmentType: 'conveyor' }, { now: '2026-06-12T00:00:00.000Z' }).loads.equipmentType,
    'conveyor'
  );
  assert.equal(trace.unit, 'MWp');
  assert.equal(trace.assumptionSource, 'Malaysia Default');
  assert.equal(trace.isOverride, false);
  assert.equal(trace.calculationVersion, 'epc-design-v2');
  assert.match(buildGlobalSolarAtlasUrl(normalized.site), /globalsolaratlas\.info/);
  assert.match(buildGlobalSolarAtlasUrl(normalized.site), /2\.960857/);
});

test('EPC design engine selects the recommended scheme from the current target replacement', () => {
  const baseProject = buildEpcDesignProjectFromQuickInputs(quarryInputs, {
    now: '2026-06-12T00:00:00.000Z'
  });
  const fifty = calculateEpcDesignProject({
    ...baseProject,
    designTargets: { ...baseProject.designTargets, replacementPct: 50 }
  }, { now: '2026-06-12T00:00:00.000Z' });
  const hundred = calculateEpcDesignProject({
    ...baseProject,
    designTargets: { ...baseProject.designTargets, replacementPct: 100 }
  }, { now: '2026-06-12T00:00:00.000Z' });
  const nearest = calculateEpcDesignProject({
    ...baseProject,
    designTargets: { ...baseProject.designTargets, replacementPct: 76 }
  }, { now: '2026-06-12T00:00:00.000Z' });

  assert.equal(fifty.recommendedSchemeId, 'replace-50');
  assert.equal(hundred.recommendedSchemeId, 'replace-100');
  assert.equal(nearest.recommendedSchemeId, 'replace-80');
  assert.ok(fifty.pvStringDesign.modules < hundred.pvStringDesign.modules);
  assert.ok(fifty.energyFlow.summary.gensetRemainingKwh > hundred.energyFlow.summary.gensetRemainingKwh);
});

test('EPC PV string design follows the revised workbook module and combiner baseline', () => {
  const design = calculatePvStringDesign({
    targetPvMwp: 4,
    moduleWp: 580,
    modulesPerString: 26,
    combinerInputs: 16
  });

  assert.deepEqual({
    moduleWp: design.moduleWp,
    modules: design.modules,
    modulesPerString: design.modulesPerString,
    strings: design.strings,
    combinerInputs: design.combinerInputs,
    combiners: design.combiners
  }, {
    moduleWp: 580,
    modules: 6897,
    modulesPerString: 26,
    strings: 266,
    combinerInputs: 16,
    combiners: 17
  });
});

test('EPC design engine sizes BESS and PCS by selected operating role', () => {
  const base = buildEpcDesignProjectFromQuickInputs(quarryInputs, {
    defaults: EPC_DESIGN_DEFAULTS,
    now: '2026-06-12T00:00:00.000Z'
  });
  const common = {
    ...base,
    loads: {
      ...base.loads,
      peakLoadKw: 2480,
      criticalLoadKw: 900,
      allowedGensetLoadKw: 1500
    }
  };
  const peak = calculateEpcDesignProject({
    ...common,
    designTargets: { ...common.designTargets, bessRole: 'peak_shaving', supportHours: 1 }
  }, { now: '2026-06-12T00:00:00.000Z' }).schemes.find((scheme) => scheme.id === 'replace-80');
  const island = calculateEpcDesignProject({
    ...common,
    designTargets: { ...common.designTargets, bessRole: 'island_mode', supportHours: 2 }
  }, { now: '2026-06-12T00:00:00.000Z' }).schemes.find((scheme) => scheme.id === 'replace-80');
  const smoothing = calculateEpcDesignProject({
    ...common,
    designTargets: { ...common.designTargets, bessRole: 'pv_smoothing', supportHours: 0.5 }
  }, { now: '2026-06-12T00:00:00.000Z' }).schemes.find((scheme) => scheme.id === 'replace-80');

  assert.equal(peak.pcsBasis, 'Peak load minus allowed genset load');
  assert.equal(peak.supportedLoadKw, 980);
  assert.equal(peak.pcsRecommendedMw, 1);
  assert.equal(peak.bessRecommendedMwh.toFixed(2), '1.21');
  assert.equal(peak.cRate.toFixed(2), '0.82');
  assert.equal(peak.equivalentDurationHours.toFixed(2), '1.21');

  assert.equal(island.pcsBasis, 'Total peak load with island safety factor');
  assert.equal(island.pcsRecommendedMw, 3);
  assert.ok(island.bessRecommendedMwh > peak.bessRecommendedMwh);

  assert.equal(smoothing.pcsBasis, 'PV fluctuation portion');
  assert.ok(smoothing.pcsRecommendedMw <= peak.pcsRecommendedMw);
  assert.ok(smoothing.bessRecommendedMwh < peak.bessRecommendedMwh);
});

test('EPC design engine exposes hourly PV load battery and curtailment simulation', () => {
  const project = buildEpcDesignProjectFromQuickInputs({
    ...quarryInputs,
    pvYieldKwhPerKwpDay: 3.6
  }, {
    defaults: EPC_DESIGN_DEFAULTS,
    now: '2026-06-12T00:00:00.000Z'
  });
  const result = calculateEpcDesignProject({
    ...project,
    loadProfile: [
      { hour: 9, loadKw: 1200 },
      { hour: 10, loadKw: 1600 },
      { hour: 11, loadKw: 1900 },
      { hour: 12, loadKw: 2100 },
      { hour: 13, loadKw: 2200 },
      { hour: 14, loadKw: 2000 },
      { hour: 15, loadKw: 1800 },
      { hour: 16, loadKw: 1500 },
      { hour: 17, loadKw: 4200 }
    ],
    solarResource: {
      ...project.solarResource,
      hourlyPvProfile: [
        { hour: 9, pvMw: 0.8 },
        { hour: 10, pvMw: 1.8 },
        { hour: 11, pvMw: 3.0 },
        { hour: 12, pvMw: 3.7 },
        { hour: 13, pvMw: 3.6 },
        { hour: 14, pvMw: 3.1 },
        { hour: 15, pvMw: 2.4 },
        { hour: 16, pvMw: 1.3 },
        { hour: 17, pvMw: 0.4 }
      ]
    }
  }, { now: '2026-06-12T00:00:00.000Z' });

  assert.equal(result.energyFlow.rows.length, 9);
  assert.deepEqual(Object.keys(result.energyFlow.rows[0]), [
    'hour',
    'pvOutputKw',
    'loadKw',
    'pvToLoadKw',
    'pvToBatteryKw',
    'batteryToLoadKw',
    'gensetToLoadKw',
    'curtailmentKw',
    'socPct'
  ]);
  assert.ok(result.energyFlow.rows.some((row) => row.pvToBatteryKw > 0));
  assert.ok(result.energyFlow.rows.some((row) => row.curtailmentKw >= 0));
  assert.ok(result.energyFlow.summary.pvDirectKwh > 0);
  assert.ok(result.energyFlow.summary.gensetRemainingKwh > 0);
  assert.match(result.energyFlow.method, /PV -> Load/);
});

test('EPC design engine makes PF and distance affect LV MV architecture output', () => {
  const project = buildEpcDesignProjectFromQuickInputs(quarryInputs, {
    defaults: EPC_DESIGN_DEFAULTS,
    now: '2026-06-12T00:00:00.000Z'
  });
  const lowPf = calculateEpcDesignProject({
    ...project,
    electrical: {
      voltageKv: 0.415,
      powerFactor: 0.8,
      distanceToInterconnectionM: 300,
      existingMvVoltageKv: 0,
      newMvSystem: true
    }
  }, { now: '2026-06-12T00:00:00.000Z' });
  const mediumVoltage = lowPf.electrical.voltageOptions.find((option) => option.voltageKv === 11);
  const lowVoltage = lowPf.electrical.voltageOptions.find((option) => option.voltageKv === 0.415);

  assert.ok(lowVoltage.currentA > 6900);
  assert.ok(mediumVoltage.currentA < lowVoltage.currentA / 20);
  assert.equal(lowPf.electrical.architecture, '11kV Ring Main / MV Transformer');
  assert.ok(lowPf.electrical.flags.some((flag) => flag.includes('PF below 0.90')));
  assert.ok(lowPf.electrical.flags.some((flag) => flag.includes('Evaluate MV')));
});

test('EPC PV string design supports module specs and architecture warnings', () => {
  const design = calculatePvStringDesign({
    targetPvMwp: 4,
    moduleWp: 710,
    modulesPerString: 24,
    combinerInputs: 18,
    inverterArchitecture: 'central',
    totalStringInputs: 672
  });

  assert.equal(design.modules, 5634);
  assert.equal(design.strings, 235);
  assert.equal(design.combiners, 14);
  assert.equal(design.inverterArchitecture, 'central');
  assert.equal(design.totalStringInputs, 672);
  assert.ok(design.warnings.some((warning) => warning.includes('module/string ratio')));
});
