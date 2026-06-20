import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EPC_DESIGN_DEFAULTS,
  buildGlobalSolarAtlasApiUrls,
  buildEpcDesignProjectFromQuickInputs,
  buildGlobalSolarAtlasUrl,
  calculateEpcDesignProject,
  calculatePvStringDesign,
  normalizeEpcDesignProject,
  parseGlobalSolarAtlasSolarResource
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
  assert.equal(recommended.bessRecommendedMwh.toFixed(2), '5.09');
  assert.equal(recommended.pcsRecommendedMw.toFixed(2), '2.50');
  assert.equal(recommended.monthlyDieselSavedLiters.toFixed(0), '98902');
  assert.equal(recommended.monthlySavings.toFixed(2), '461872.77');

  assert.ok(result.electrical.lvCurrentA > 5800 && result.electrical.lvCurrentA < 5900);
  assert.equal(result.electrical.mvRecommended, true);
  assert.match(result.electrical.recommendation, /11kV/);
  assert.ok(result.formulaTrace.some((item) => item.key === 'dailyLoadKwh' && item.formula.includes('Daily Diesel / SFC')));
  assert.ok(result.formulaTrace.some((item) => item.key === 'peakLoadKw' && item.formula.includes('Average Load x Selected Peak Safety Factor')));
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

test('EPC design defaults reserve 20 percent minimum SOC and 75 percent DoD', () => {
  const project = normalizeEpcDesignProject({}, { now: '2026-06-12T00:00:00.000Z' });
  const legacyDefaultProject = normalizeEpcDesignProject({
    assumptions: { minSocPct: 25, bessDod: 0.85 }
  }, { now: '2026-06-12T00:00:00.000Z' });
  const legacyOptionsProject = normalizeEpcDesignProject({}, {
    defaults: { ...EPC_DESIGN_DEFAULTS, minSocPct: 25, bessDod: 0.85 },
    now: '2026-06-12T00:00:00.000Z'
  });
  const manualProject = normalizeEpcDesignProject({
    assumptions: { minSocPct: 30, bessDod: 0.8 }
  }, { now: '2026-06-12T00:00:00.000Z' });

  assert.equal(EPC_DESIGN_DEFAULTS.minSocPct, 20);
  assert.equal(EPC_DESIGN_DEFAULTS.bessDod, 0.75);
  assert.equal(project.assumptions.minSocPct, 20);
  assert.equal(project.assumptions.bessDod, 0.75);
  assert.equal(legacyDefaultProject.assumptions.minSocPct, 20);
  assert.equal(legacyDefaultProject.assumptions.bessDod, 0.75);
  assert.equal(legacyOptionsProject.assumptions.minSocPct, 20);
  assert.equal(legacyOptionsProject.assumptions.bessDod, 0.75);
  assert.equal(manualProject.assumptions.minSocPct, 30);
  assert.equal(manualProject.assumptions.bessDod, 0.8);
});

test('EPC load calculation uses Energy Meter summary values', () => {
  const project = normalizeEpcDesignProject({
    loads: {
      measurementMethod: 'energy_meter',
      energyMeterSummary: {
        fileName: 'meter.csv',
        sampleCount: 96,
        operatingHours: 24,
        dailyLoadKwh: 9600,
        averageLoadKw: 400,
        rawPeakKw: 650,
        smoothedPeakKw: 610,
        dataSource: 'Energy Meter CSV'
      }
    }
  }, { now: '2026-06-12T00:00:00.000Z' });
  const result = calculateEpcDesignProject(project, { now: '2026-06-12T00:00:00.000Z' });

  assert.equal(result.load.dailyLoadKwh, 9600);
  assert.equal(result.load.averageLoadKw, 400);
  assert.equal(result.load.peakLoadKw, 610);
  assert.equal(result.load.rawPeakLoadKw, 650);
  assert.equal(result.load.measurementMethod, 'energy_meter');
  assert.equal(result.loads.loadSource, 'Energy Meter CSV');
  assert.ok(result.formulaTrace.some(item => item.key === 'dailyLoadKwh' && item.formula === 'Energy Meter Parsed Daily kWh'));
});

test('EPC load calculation simulates Equipment Schedule overlap', () => {
  const project = normalizeEpcDesignProject({
    loads: {
      measurementMethod: 'equipment_schedule',
      equipmentSchedule: [
        { equipment: 'Pump A', ratedKw: 100, quantity: 2, startTime: '09:00', finishTime: '11:00', dutyCycle: 1, simultaneityFactor: 1 },
        { equipment: 'Crusher', ratedKw: 150, quantity: 1, startTime: '10:00', finishTime: '12:00', dutyCycle: 0.8, simultaneityFactor: 1 }
      ]
    }
  }, { now: '2026-06-12T00:00:00.000Z' });
  const result = calculateEpcDesignProject(project, { now: '2026-06-12T00:00:00.000Z' });

  assert.equal(result.load.dailyLoadKwh, 700);
  assert.equal(result.load.averageLoadKw.toFixed(2), '233.33');
  assert.equal(result.load.peakLoadKw, 350);
  assert.equal(result.load.measurementMethod, 'equipment_schedule');
  assert.equal(result.loads.loadSource, 'Equipment Schedule');
  assert.ok(result.formulaTrace.some(item => item.key === 'peakLoadKw' && item.formula === 'Max 15-min overlapping operating load'));
});

test('EPC Equipment Schedule can average against design operating hours', () => {
  const project = normalizeEpcDesignProject({
    loads: {
      measurementMethod: 'equipment_schedule',
      equipmentScheduleOperatingHours: 8,
      equipmentSchedule: [
        { equipment: 'Security system', ratedKw: 10, quantity: 1, startTime: '00:00', finishTime: '00:00', dutyCycle: 1, simultaneityFactor: 1 },
        { equipment: 'Production line', ratedKw: 90, quantity: 1, startTime: '09:00', finishTime: '17:00', dutyCycle: 1, simultaneityFactor: 1 }
      ]
    }
  }, { now: '2026-06-12T00:00:00.000Z' });
  const result = calculateEpcDesignProject(project, { now: '2026-06-12T00:00:00.000Z' });

  assert.equal(result.load.dailyLoadKwh, 960);
  assert.equal(result.load.averageLoadKw, 120);
  assert.equal(result.load.peakLoadKw, 100);
  assert.equal(result.load.operatingHours, 8);
  assert.equal(result.loads.equipmentScheduleOperatingHours, 8);
});

test('EPC EMS Flow can use Equipment Schedule timetable load instead of average load', () => {
  const project = normalizeEpcDesignProject({
    loads: {
      measurementMethod: 'equipment_schedule',
      equipmentScheduleOperatingHours: 8,
      useEquipmentScheduleForEmsFlow: true,
      equipmentSchedule: [
        { equipment: 'Security system', ratedKw: 10, quantity: 1, startTime: '00:00', finishTime: '00:00', dutyCycle: 1, simultaneityFactor: 1 },
        { equipment: 'Production line', ratedKw: 90, quantity: 1, startTime: '09:00', finishTime: '17:00', dutyCycle: 1, simultaneityFactor: 1 }
      ]
    },
    solarResource: {
      pvoutSpecificKwhKwpDay: 3.6,
      hourlyPvProfile: [
        { hour: 9, pvMw: 0 },
        { hour: 10, pvMw: 0 }
      ]
    }
  }, { now: '2026-06-12T00:00:00.000Z' });
  const result = calculateEpcDesignProject(project, { now: '2026-06-12T00:00:00.000Z' });

  assert.equal(result.load.averageLoadKw, 120);
  assert.equal(result.loads.useEquipmentScheduleForEmsFlow, true);
  assert.equal(result.energyFlow.rows.find(row => row.hour === 8).loadKw, 10);
  assert.equal(result.energyFlow.rows.find(row => row.hour === 9).loadKw, 100);
  assert.equal(result.energyFlow.rows.find(row => row.hour === 17).loadKw, 10);
  assert.match(result.energyFlow.method, /Equipment Schedule timetable/);
});

test('EPC Equipment Schedule uses global duty and simultaneity with EMS timetable on by default', () => {
  const project = normalizeEpcDesignProject({
    loads: {
      measurementMethod: 'equipment_schedule',
      equipmentScheduleOperatingHours: 8,
      equipmentScheduleDutyCycle: 0.5,
      equipmentScheduleSimultaneityFactor: 0.8,
      equipmentSchedule: [
        { equipment: 'Security system', ratedKw: 10, quantity: 1, startTime: '00:00', finishTime: '00:00', dutyCycle: 1, simultaneityFactor: 1 },
        { equipment: 'Production line', ratedKw: 90, quantity: 1, startTime: '09:00', finishTime: '17:00', dutyCycle: 1, simultaneityFactor: 1 }
      ]
    }
  }, { now: '2026-06-12T00:00:00.000Z' });
  const result = calculateEpcDesignProject(project, { now: '2026-06-12T00:00:00.000Z' });

  assert.equal(result.loads.useEquipmentScheduleForEmsFlow, true);
  assert.equal(result.load.dailyLoadKwh, 384);
  assert.equal(result.load.averageLoadKw, 48);
  assert.equal(result.load.peakLoadKw, 40);
  assert.equal(result.energyFlow.rows.find(row => row.hour === 8).loadKw, 4);
  assert.equal(result.energyFlow.rows.find(row => row.hour === 9).loadKw, 40);
});

test('EPC load calculation follows Genset kVA runtime formula', () => {
  const project = normalizeEpcDesignProject({
    loads: {
      measurementMethod: 'genset_kva_load_factor',
      gensetKvaInput: {
        gensetKva: 750,
        powerFactor: 0.8,
        loadFactor: 0.7,
        runtimeHours: 10,
        overloadFactor: 0.95
      }
    }
  }, { now: '2026-06-12T00:00:00.000Z' });
  const result = calculateEpcDesignProject(project, { now: '2026-06-12T00:00:00.000Z' });

  assert.equal(result.load.ratedKw, 600);
  assert.equal(result.load.dailyLoadKwh, 4200);
  assert.equal(result.load.averageLoadKw, 420);
  assert.equal(result.load.peakLoadKw, 570);
  assert.equal(result.load.measurementMethod, 'genset_kva_load_factor');
  assert.equal(result.loads.loadSource, 'Genset kVA / load factor');
  assert.ok(result.formulaTrace.some(item => item.key === 'averageLoadKw' && item.formula === 'Genset kVA x PF x Load Factor'));
});

test('EPC design engine builds Global Solar Atlas API candidates from site coordinates', () => {
  const urls = buildGlobalSolarAtlasApiUrls({
    latitude: 2.9608574,
    longitude: 101.5725644
  }, {
    apiBase: 'https://example.test/prod/'
  });

  assert.ok(urls.length >= 1);
  assert.equal(new Set(urls).size, urls.length);
  assert.equal(urls[0], 'https://example.test/prod/data/lta?loc=2.960857%2C101.572564');
});

test('EPC design engine parses Global Solar Atlas solar resource values for EPC sizing', () => {
  const parsed = parseGlobalSolarAtlasSolarResource({
    annual: {
      data: {
        PVOUT_csi: 1350.9088134765625,
        GHI: 1703.15625,
        DNI: 964.078125,
        TEMP: 26.5625
      }
    }
  }, {
    now: '2026-06-13T00:00:00.000Z'
  });

  assert.deepEqual(parsed, {
    specificYieldKwhPerKwpDay: 3.7,
    gsaPvoutKwhPerKwpDay: 3.7,
    ghiKwhM2Day: 4.67,
    dniKwhM2Day: 2.64,
    temperatureC: 26.6,
    dataSource: 'Global Solar Atlas',
    retrievalDate: '2026-06-13'
  });
});

test('EPC design engine keeps Map PVOUT separate from manual PV yield until GSA data is imported', () => {
  const manual = normalizeEpcDesignProject({
    solarResource: {
      pvYieldKwhPerKwpDay: 4.2,
      dataSource: 'Manual PV Yield'
    }
  }, {
    now: '2026-06-13T00:00:00.000Z'
  });

  assert.equal(manual.solarResource.specificYieldKwhPerKwpDay, 4.2);
  assert.equal(manual.solarResource.gsaPvoutKwhPerKwpDay, 0);
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
  const detailedTarget = calculateEpcDesignProject({
    ...baseProject,
    mode: 'detailed',
    designTargets: { ...baseProject.designTargets, replacementPct: 85 }
  }, { now: '2026-06-12T00:00:00.000Z' });

  assert.equal(fifty.recommendedSchemeId, 'replace-50');
  assert.equal(hundred.recommendedSchemeId, 'replace-100');
  assert.equal(nearest.recommendedSchemeId, 'replace-80');
  assert.equal(detailedTarget.recommendedSchemeId, 'replace-target');
  assert.equal(detailedTarget.schemes.find(scheme => scheme.id === 'replace-target').replacementPct, 85);
  assert.equal(
    detailedTarget.schemes.find(scheme => scheme.id === 'replace-target').targetDailyKwh.toFixed(2),
    (detailedTarget.load.dailyLoadKwh * 0.85).toFixed(2)
  );
  assert.ok(fifty.pvStringDesign.modules < hundred.pvStringDesign.modules);
  assert.ok(fifty.energyFlow.summary.gensetRemainingKwh > hundred.energyFlow.summary.gensetRemainingKwh);
});

test('EPC design engine can round up PV BESS and PCS before downstream calculations', () => {
  const baseProject = buildEpcDesignProjectFromQuickInputs(quarryInputs, {
    now: '2026-06-12T00:00:00.000Z'
  });
  const rounded = calculateEpcDesignProject({
    ...baseProject,
    designTargets: { ...baseProject.designTargets, roundUpSizing: true }
  }, { now: '2026-06-12T00:00:00.000Z' });
  const recommended = rounded.schemes.find((scheme) => scheme.id === 'replace-80');

  assert.equal(rounded.designTargets.roundUpSizing, true);
  assert.equal(recommended.pvRecommendedMwp.toFixed(2), '4.00');
  assert.equal(recommended.bessRecommendedMwh.toFixed(2), '5.50');
  assert.equal(recommended.pcsRecommendedMw.toFixed(2), '2.50');
  assert.equal(recommended.cRate.toFixed(2), '0.45');
  assert.equal(rounded.pvStringDesign.modules, Math.ceil((4 * 1000000) / EPC_DESIGN_DEFAULTS.moduleWp));
  assert.equal(recommended.requiredAreaM2, 4 * EPC_DESIGN_DEFAULTS.groundPvAreaM2PerMwp);
  const roundUpTrace = rounded.formulaTrace.find((item) => item.key === 'replace-80.roundUpSizing');
  assert.equal(roundUpTrace.inputs.roundUpStep, 0.5);
});

test('EPC diesel replacement PCS follows selected peak load safety factor before round up', () => {
  const baseProject = buildEpcDesignProjectFromQuickInputs({
    ...quarryInputs
  }, {
    now: '2026-06-12T00:00:00.000Z'
  });
  const rounded = calculateEpcDesignProject({
    ...baseProject,
    loads: { ...baseProject.loads, peakLoadSafetyFactor: 1.3 },
    designTargets: { ...baseProject.designTargets, roundUpSizing: true }
  }, { now: '2026-06-12T00:00:00.000Z' });
  const recommended = rounded.schemes.find((scheme) => scheme.id === 'replace-80');
  const peakTrace = rounded.formulaTrace.find((item) => item.key === 'peakLoadKw');
  const pcsTrace = rounded.formulaTrace.find((item) => item.key === 'pcsRecommendedMw');

  assert.equal(rounded.load.peakLoadKw.toFixed(2), '2480.18');
  assert.equal(recommended.pcsBasis, 'Peak load factor hybrid support');
  assert.equal(recommended.pcsRecommendedMw.toFixed(2), '2.50');
  assert.equal(peakTrace.inputs.peakLoadSafetyFactor, 1.3);
  assert.equal(pcsTrace.inputs.peakLoadKw, 2480.1837);
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
      peakLoadSafetyFactor: 1.3,
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
  assert.equal(peak.supportedLoadKw.toFixed(4), '980.1837');
  assert.equal(peak.pcsRecommendedMw, 1);
  assert.equal(peak.bessRecommendedMwh.toFixed(2), '1.38');
  assert.equal(peak.cRate.toFixed(2), '0.73');
  assert.equal(peak.equivalentDurationHours.toFixed(2), '1.38');

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
    'hourLabel',
    'flowKey',
    'pvOutputKw',
    'loadKw',
    'pvToLoadKw',
    'pvToBatteryKw',
    'batteryToLoadKw',
    'gensetToLoadKw',
    'pcsLimitKw',
    'curtailmentKw',
    'socPct',
    'loadSplits'
  ]);
  assert.ok(result.energyFlow.rows.some((row) => row.pvToBatteryKw > 0));
  assert.ok(result.energyFlow.rows.some((row) => row.curtailmentKw >= 0));
  assert.ok(result.energyFlow.summary.pvDirectKwh > 0);
  assert.ok(result.energyFlow.summary.gensetRemainingKwh > 0);
  assert.match(result.energyFlow.method, /PV -> Load/);
});

test('EPC energy flow can consume a 5-minute PV Simulator profile', () => {
  const project = normalizeEpcDesignProject({
    loads: {
      measurementMethod: 'diesel_sfc_estimate',
      dieselTotalLiters: 216,
      dieselPeriodDays: 1,
      operationHoursPerDay: 1,
      operationStartTime: '09:00',
      operationFinishTime: '10:00'
    },
    solarResource: {
      dataSource: 'PV Simulator',
      specificYieldKwhPerKwpDay: 3.6,
      pvSimulator: {
        settings: { weatherMode: 'mixed', stepMinutes: 5, fixedRandomState: true, seed: 'fixed-101' },
        summary: { pointCount: 12 }
      },
      hourlyPvProfile: Array.from({ length: 12 }, (_, index) => ({
        timestamp: `2026-06-12T09:${String(index * 5).padStart(2, '0')}:00+08:00`,
        hour: 9 + (index * 5) / 60,
        timelineMinute: 9 * 60 + index * 5,
        intervalMinutes: 5,
        pvMw: 1,
        irradianceCf: 0.8,
        cloudState: index % 3,
        temperatureFactor: 0.94,
        soilingFactor: 0.98,
        inverterLimitActive: false,
        curtailmentActive: false,
        clippingLossKw: 0
      }))
    }
  }, { now: '2026-06-12T00:00:00.000Z' });
  const normalizedProfile = project.solarResource.hourlyPvProfile;

  assert.equal(project.solarResource.dataSource, 'PV Simulator');
  assert.equal(project.solarResource.pvSimulator.settings.fixedRandomState, true);
  assert.equal(normalizedProfile.length, 12);
  assert.equal(normalizedProfile[1].intervalMinutes, 5);
  assert.equal(normalizedProfile[1].cloudState, 1);
  assert.equal(normalizedProfile[1].timestamp, '2026-06-12T09:05:00+08:00');

  const result = calculateEpcDesignProject(project, { now: '2026-06-12T00:00:00.000Z' });

  assert.equal(result.energyFlow.rows.length, 12);
  assert.equal(result.energyFlow.rows[0].hourLabel, '09:00-09:05');
  assert.equal(result.energyFlow.rows[1].hour, 9 + 5 / 60);
  assert.equal(result.energyFlow.rows[1].intervalMinutes, 5);
  assert.equal(result.energyFlow.rows[1].durationHours, 5 / 60);
  assert.equal(result.energyFlow.rows[1].pvOutputKw, 1000);
  assert.equal(result.energyFlow.summary.pvDirectKwh, 800);
  assert.match(result.energyFlow.method, /PV Simulator/);
});

test('EPC energy flow follows PV schedule while genset hours keep average load unless changed', () => {
  const dayProject = buildEpcDesignProjectFromQuickInputs({
    ...quarryInputs,
    operationHoursPerDay: 8,
    operationStartTime: '09:00',
    operationFinishTime: '18:00'
  }, {
    defaults: EPC_DESIGN_DEFAULTS,
    now: '2026-06-12T00:00:00.000Z'
  });
  const dayResult = calculateEpcDesignProject(dayProject, { now: '2026-06-12T00:00:00.000Z' });

  assert.equal(dayResult.loads.operationFinishTime, '18:00');
  assert.equal(dayResult.loads.scheduleWorkingHours, 9);
  assert.equal(dayResult.load.averageLoadKw.toFixed(2), '1907.83');
  assert.equal(dayResult.load.dailyLoadKwh.toFixed(2), '15262.67');
  assert.equal(dayResult.energyFlow.rows.length, 9);
  assert.equal(dayResult.energyFlow.rows[0].hourLabel, '09:00-10:00');
  assert.equal(dayResult.energyFlow.rows.at(-1).hourLabel, '17:00-18:00');

  const changedResult = calculateEpcDesignProject({
    ...dayProject,
    loads: {
      ...dayProject.loads,
      changeWorkingTime: true
    }
  }, { now: '2026-06-12T00:00:00.000Z' });

  assert.equal(changedResult.load.averageLoadKw.toFixed(2), '1907.83');
  assert.equal(changedResult.load.dailyLoadKwh.toFixed(2), '17170.50');
  assert.equal(changedResult.schemes.find((scheme) => scheme.id === 'replace-80').targetDailyKwh.toFixed(2), '13736.40');
});

test('EPC energy flow rolls SOC over from previous day instead of restarting battery at 50 percent', () => {
  const project = buildEpcDesignProjectFromQuickInputs({
    ...quarryInputs,
    operationHoursPerDay: 8,
    operationStartTime: '18:00',
    operationFinishTime: '20:00'
  }, {
    defaults: EPC_DESIGN_DEFAULTS,
    now: '2026-06-12T00:00:00.000Z'
  });
  const result = calculateEpcDesignProject(project, { now: '2026-06-12T00:00:00.000Z' });
  const firstRow = result.energyFlow.rows[0];

  assert.equal(firstRow.hourLabel, '18:00-19:00');
  assert.equal(firstRow.pvOutputKw, 0);
  assert.equal(firstRow.batteryToLoadKw, 0);
  assert.equal(firstRow.gensetToLoadKw.toFixed(0), firstRow.loadKw.toFixed(0));
  assert.equal(firstRow.socPct, EPC_DESIGN_DEFAULTS.minSocPct);
});

test('EPC EMS flow derives max SOC from Min SOC plus DoD', () => {
  const base = buildEpcDesignProjectFromQuickInputs({
    ...quarryInputs,
    operationHoursPerDay: 8,
    operationStartTime: '11:00',
    operationFinishTime: '15:00'
  }, {
    defaults: EPC_DESIGN_DEFAULTS,
    now: '2026-06-12T00:00:00.000Z'
  });

  const fullWindow = calculateEpcDesignProject({
    ...base,
    assumptions: { ...base.assumptions, minSocPct: 20, bessDod: 0.8, maxSocPct: 95 }
  }, { now: '2026-06-12T00:00:00.000Z' });
  const limitedWindow = calculateEpcDesignProject({
    ...base,
    assumptions: { ...base.assumptions, minSocPct: 25, bessDod: 0.6, maxSocPct: 95 }
  }, { now: '2026-06-12T00:00:00.000Z' });

  assert.equal(fullWindow.energyFlow.summary.socMinPct, 20);
  assert.equal(fullWindow.energyFlow.summary.socMaxPct, 100);
  assert.equal(limitedWindow.energyFlow.summary.socMinPct, 25);
  assert.equal(limitedWindow.energyFlow.summary.socMaxPct, 85);
  assert.ok(limitedWindow.energyFlow.rows.every(row => row.socPct <= 85));
});

test('EPC design project preserves EMS Flow display settings', () => {
  const project = normalizeEpcDesignProject({
    assumptions: {
      pvDcAcRatio: 1.35
    },
    emsFlowDisplaySettings: {
      visibleSeries: ['pv', 'load', 'soc'],
      mergeHourly: false,
      emsTableIntervalMinutes: 5,
      intervalMinutes: 5,
      xAxisTickHours: 3,
      selectedRange: { start: 2, end: 8 },
      peakBand: { visible: false, color: '#e0f2fe', startMinute: 15 * 60, endMinute: 21 * 60 },
      seriesColors: { pv: '#f59e0b', load: '#2563eb', battery: '#16a34a', genset: '#ef4444', soc: '#0ea5e9' },
      topologyFlowLabelOffsets: {
        'lv-step-up': { dx: 18.4, dy: -22.2 },
        'ring-rmu-load-1': { dx: 'bad', dy: 14 },
        '': { dx: 100, dy: 100 }
      },
      deviceWorkModel: {
        applyToEmsFlow: false,
        loadNoisePct: 4,
        loadShockCount: 3,
        loadShockDurationMinutes: 22,
        loadShockImpactPct: 18,
        loadShockPosition: 'startup',
        gensetShockCount: 1,
        gensetShockDurationMinutes: 15,
        gensetShockImpactPct: 12,
        gensetShockPosition: 'startup',
        gensetStepEnabled: false,
        gensetPlatforms: [0.25, 0.5, 1]
      },
      batteryControl: {
        mode: 'manual',
        manualIntervalMinutes: 60,
        batteryFirstAboveMinSoc: true,
        gensetShockPreemptBattery: false,
        priorityOrder: ['pv_to_load', 'battery_to_load', 'genset_to_load', 'pv_to_battery'],
        customStrategies: [
          {
            id: 'night-discharge',
            label: 'Night discharge',
            priorityOrder: ['pv_to_load', 'battery_to_load', 'pv_to_battery', 'genset_to_load']
          }
        ],
        manualOverrides: [
          { timelineMinute: 540, batteryKw: -174 },
          { timelineMinute: 600, batteryKw: 120 }
        ]
      }
    }
  }, { now: '2026-06-12T00:00:00.000Z' });

  assert.deepEqual(project.emsFlowDisplaySettings.visibleSeries, ['pv', 'load', 'soc']);
  assert.equal(project.emsFlowDisplaySettings.mergeHourly, false);
  assert.equal(project.emsFlowDisplaySettings.emsTableIntervalMinutes, 5);
  assert.equal(project.assumptions.pvDcAcRatio, 1.35);
  assert.equal(project.emsFlowDisplaySettings.intervalMinutes, 5);
  assert.equal(project.emsFlowDisplaySettings.xAxisTickHours, 3);
  assert.deepEqual(project.emsFlowDisplaySettings.selectedRange, { start: 2, end: 8 });
  assert.deepEqual(project.emsFlowDisplaySettings.peakBand, { visible: false, color: '#e0f2fe', startMinute: 900, endMinute: 1260 });
  assert.equal(project.emsFlowDisplaySettings.seriesColors.genset, '#ef4444');
  assert.deepEqual(project.emsFlowDisplaySettings.topologyFlowLabelOffsets, {
    'lv-step-up': { dx: 18.4, dy: -22.2 },
    'ring-rmu-load-1': { dx: 0, dy: 14 }
  });
  assert.deepEqual(project.emsFlowDisplaySettings.deviceWorkModel, {
    applyToEmsFlow: false,
    loadNoisePct: 4,
    loadShockCount: 3,
    loadShockDurationMinutes: 22,
    loadShockImpactPct: 18,
    loadShockPosition: 'startup',
    gensetShockCount: 1,
    gensetShockDurationMinutes: 15,
    gensetShockImpactPct: 12,
    gensetShockPosition: 'startup',
    gensetStepEnabled: false,
    gensetPlatforms: [0.25, 0.5, 1]
  });
  assert.deepEqual(project.emsFlowDisplaySettings.batteryControl, {
    mode: 'manual',
    manualIntervalMinutes: 60,
    batteryFirstAboveMinSoc: true,
    gensetShockPreemptBattery: false,
    priorityOrder: ['pv_to_load', 'battery_to_load', 'genset_to_load', 'pv_to_battery'],
    customStrategies: [
      {
        id: 'night-discharge',
        label: 'Night discharge',
        priorityOrder: ['pv_to_load', 'battery_to_load', 'pv_to_battery', 'genset_to_load']
      }
    ],
    manualOverrides: [
      { timelineMinute: 540, pvBatteryKw: 0, batteryLoadKw: 174 },
      { timelineMinute: 600, pvBatteryKw: 120, batteryLoadKw: 0 }
    ]
  });

  const darkPeakBand = normalizeEpcDesignProject({
    emsFlowDisplaySettings: {
      peakBand: { visible: true, color: '#111827' }
    }
  }, { now: '2026-06-12T00:00:00.000Z' });
  assert.deepEqual(darkPeakBand.emsFlowDisplaySettings.peakBand, {
    visible: true,
    color: '#cbcccf',
    startMinute: 14 * 60,
    endMinute: 22 * 60
  });

  const defaultSettings = normalizeEpcDesignProject({}, { now: '2026-06-12T00:00:00.000Z' });
  assert.equal(defaultSettings.emsFlowDisplaySettings.mergeHourly, true);
  assert.equal(defaultSettings.emsFlowDisplaySettings.emsTableIntervalMinutes, 60);
  assert.equal(defaultSettings.emsFlowDisplaySettings.intervalMinutes, 5);
  assert.equal(defaultSettings.emsFlowDisplaySettings.xAxisTickHours, 'auto');
  assert.equal(defaultSettings.assumptions.pvDcAcRatio, 1.2);
  assert.equal(defaultSettings.emsFlowDisplaySettings.deviceWorkModel.applyToEmsFlow, true);
  assert.equal(defaultSettings.emsFlowDisplaySettings.deviceWorkModel.loadNoisePct, 3);
  assert.equal(defaultSettings.emsFlowDisplaySettings.deviceWorkModel.loadShockPosition, 'startup');
  assert.equal(defaultSettings.emsFlowDisplaySettings.deviceWorkModel.gensetShockPosition, 'startup');
  assert.equal(defaultSettings.emsFlowDisplaySettings.batteryControl.mode, 'auto');
  assert.equal(defaultSettings.emsFlowDisplaySettings.batteryControl.batteryFirstAboveMinSoc, true);
  assert.equal(defaultSettings.emsFlowDisplaySettings.batteryControl.gensetShockPreemptBattery, false);
  assert.deepEqual(defaultSettings.emsFlowDisplaySettings.batteryControl.priorityOrder.slice(0, 3), ['pv_to_load', 'battery_to_load', 'genset_to_load']);

  const legacyFiveMinuteTable = normalizeEpcDesignProject({
    assumptions: { pvDcAcRatio: 0.5 },
    emsFlowDisplaySettings: { mergeHourly: false }
  }, { now: '2026-06-12T00:00:00.000Z' });
  assert.equal(legacyFiveMinuteTable.emsFlowDisplaySettings.emsTableIntervalMinutes, 5);
  assert.equal(legacyFiveMinuteTable.assumptions.pvDcAcRatio, 1.2);

  const invalidXAxisDensity = normalizeEpcDesignProject({
    emsFlowDisplaySettings: { xAxisTickHours: 5 }
  }, { now: '2026-06-12T00:00:00.000Z' });
  assert.equal(invalidXAxisDensity.emsFlowDisplaySettings.xAxisTickHours, 'auto');
});

test('EPC capacity overrides preserve calculated recommendation and drive effective sizing', () => {
  const base = calculateEpcDesignProject(buildEpcDesignProjectFromQuickInputs(quarryInputs, {
    now: '2026-06-12T00:00:00.000Z'
  }), { now: '2026-06-12T00:00:00.000Z' });
  const baseRecommended = base.schemes.find((scheme) => scheme.id === base.recommendedSchemeId);

  const result = calculateEpcDesignProject({
    ...buildEpcDesignProjectFromQuickInputs(quarryInputs, {
      now: '2026-06-12T00:00:00.000Z'
    }),
    designTargets: {
      replacementPct: 80,
      capacityOverrides: {
        pvMwp: 6.5,
        pcsMw: 2,
        bessMwh: 4.8
      }
    }
  }, { now: '2026-06-12T00:00:00.000Z' });
  const recommended = result.schemes.find((scheme) => scheme.id === result.recommendedSchemeId);

  assert.equal(result.designTargets.capacityOverrides.pvMwp, 6.5);
  assert.equal(result.designTargets.capacityOverrides.pcsMw, 2);
  assert.equal(result.designTargets.capacityOverrides.bessMwh, 4.8);
  assert.equal(recommended.hasCapacityOverride, true);
  assert.equal(recommended.pvRecommendedMwp, 6.5);
  assert.equal(recommended.pcsRecommendedMw, 2);
  assert.equal(recommended.bessRecommendedMwh, 4.8);
  assert.equal(recommended.calculatedPvRecommendedMwp.toFixed(2), baseRecommended.pvRecommendedMwp.toFixed(2));
  assert.equal(recommended.calculatedPcsRecommendedMw.toFixed(2), baseRecommended.pcsRecommendedMw.toFixed(2));
  assert.equal(recommended.calculatedBessRecommendedMwh.toFixed(2), baseRecommended.bessRecommendedMwh.toFixed(2));
  assert.equal(result.energyFlow.summary.socMaxPct, 95);
  assert.ok(result.energyFlow.rows.every((row) => row.pcsLimitKw === 2000));
  assert.equal(result.boq.find((item) => item.id === 'pv-array-capacity').quantity, 6.5);
  assert.equal(result.pvStringDesign.targetPvMwp, 6.5);
  assert.ok(result.formulaTrace.some((item) => item.key === 'capacityOverride.pvMwp' && item.result === 6.5));
  assert.ok(result.risks.some((risk) => /Manual capacity override/i.test(risk.issue)));
});

test('EPC BOQ derives MV ring quantities from final topology and architecture', () => {
  const result = calculateEpcDesignProject({
    selectedTopologyId: 'C7',
    site: { gridMode: 'island' },
    electrical: { selectedArchitectureId: 'mv_11_ring', newMvSystem: true },
    loads: {
      dailyLoadKwh: 12000,
      operationHoursPerDay: 8,
      loadCount: 2,
      loadSplits: [
        { id: 'load-1', label: 'Crusher Load', ratioPct: 60 },
        { id: 'load-2', label: 'Camp Load', ratioPct: 40 }
      ]
    },
    designTargets: { replacementPct: 80 }
  }, { now: '2026-06-16T00:00:00.000Z' });
  const row = (id) => result.boq.find((item) => item.id === id);

  assert.equal(result.topologyFlow.validationBlocked, false);
  assert.equal(row('mv-step-up-transformer')?.quantity, 1);
  assert.equal(row('mv-switchboard')?.quantity, 1);
  assert.equal(row('ring-rmu')?.quantity, 1);
  assert.equal(row('mv-load-branch-rmu')?.quantity, 2);
  assert.equal(row('load-transformer')?.quantity, 2);
  assert.equal(row('load-feeder')?.quantity, 2);
  assert.equal(row('ems-controller')?.source, 'ems-flow');
});

test('EPC BOQ omits MV packages for LV-only architecture', () => {
  const result = calculateEpcDesignProject({
    selectedTopologyId: 'C2',
    site: { gridMode: 'island' },
    electrical: { selectedArchitectureId: 'lv_415_centralized' },
    loads: {
      dailyLoadKwh: 1800,
      operationHoursPerDay: 8,
      loadCount: 1,
      loadSplits: [{ id: 'load-1', label: 'LV Load', ratioPct: 100 }]
    },
    designTargets: { replacementPct: 80 }
  }, { now: '2026-06-16T00:00:00.000Z' });
  const ids = new Set(result.boq.map((item) => item.id));

  assert.equal(result.electricalArchitecture.recommendedId, 'lv_415_centralized');
  assert.equal(ids.has('mv-step-up-transformer'), false);
  assert.equal(ids.has('mv-switchboard'), false);
  assert.equal(ids.has('ring-rmu'), false);
  assert.ok(ids.has('lv-bus'));
});

test('EPC BOQ normalizes manual items and Product List selections without changing calculated sizing', () => {
  const project = normalizeEpcDesignProject({
    selectedTopologyId: 'C2',
    loads: { dailyLoadKwh: 1800, operationHoursPerDay: 8 },
    designTargets: { replacementPct: 80, capacityOverrides: { pvMwp: 4 } },
    boq: {
      manualItems: [
        {
          id: 'manual-weather-station',
          package: 'Auxiliary',
          item: 'Weather station',
          spec: 'Irradiance, wind and ambient temperature sensors',
          quantity: '2',
          unit: 'set',
          protection: 'IP65',
          remark: 'Client requested'
        }
      ],
      lineSelections: {
        'pv-module-count': {
          productId: 'GFZJ001',
          productName: '610W N-type module',
          supplierName: 'LESSO',
          quantityOverride: '7000',
          remark: 'Selected from Product List'
        }
      }
    }
  }, { now: '2026-06-16T00:00:00.000Z' });
  const result = calculateEpcDesignProject(project, { now: '2026-06-16T00:00:00.000Z' });
  const pvModules = result.boq.find((item) => item.id === 'pv-module-count');
  const manual = result.boq.find((item) => item.id === 'manual-weather-station');

  assert.equal(project.boq.manualItems.length, 1);
  assert.equal(project.boq.lineSelections['pv-module-count'].productId, 'GFZJ001');
  assert.equal(pvModules.quantity, 7000);
  assert.equal(pvModules.calculatedQuantity, result.pvStringDesign.modules);
  assert.equal(pvModules.productId, 'GFZJ001');
  assert.equal(pvModules.productName, '610W N-type module');
  assert.equal(pvModules.source, 'product-bound');
  assert.equal(result.pvStringDesign.targetPvMwp, 4);
  assert.equal(manual.quantity, 2);
  assert.equal(manual.manual, true);
  assert.equal(manual.source, 'manual');
});

test('EPC BOQ hidden line ids exclude one equipment row without changing engineering results', () => {
  const project = normalizeEpcDesignProject({
    selectedTopologyId: 'C7',
    site: { gridMode: 'island' },
    electrical: { selectedArchitectureId: 'mv_11_ring', newMvSystem: true },
    loads: {
      dailyLoadKwh: 12000,
      operationHoursPerDay: 8,
      loadCount: 2,
      loadSplits: [
        { id: 'load-1', label: 'Crusher Load', ratioPct: 60 },
        { id: 'load-2', label: 'Camp Load', ratioPct: 40 }
      ]
    },
    designTargets: { replacementPct: 80 },
    boq: {
      hiddenLineIds: ['ring-rmu'],
      lineOrder: ['manual-pv-weather', 'pv-inverter', 'ring-rmu'],
      manualItems: [
        { id: 'manual-pv-weather', package: 'PV System', item: 'Weather station', quantity: 1, unit: 'set' }
      ]
    }
  }, { now: '2026-06-16T00:00:00.000Z' });
  const result = calculateEpcDesignProject(project, { now: '2026-06-16T00:00:00.000Z' });
  const pvIds = result.boq.filter((item) => item.package === 'PV System').map((item) => item.id);

  assert.deepEqual(project.boq.hiddenLineIds, ['ring-rmu']);
  assert.deepEqual(project.boq.lineOrder.slice(0, 3), ['manual-pv-weather', 'pv-inverter', 'ring-rmu']);
  assert.equal(result.boq.some((item) => item.id === 'ring-rmu'), false);
  assert.equal(result.boq.some((item) => item.id === 'mv-switchboard'), true);
  assert.equal(result.boq.some((item) => item.id === 'load-transformer'), true);
  assert.equal(result.boq.some((item) => item.package === 'Electrical Distribution'), true);
  assert.equal(result.boq.some((item) => item.id === 'manual-pv-weather'), true);
  assert.equal(pvIds[0], 'manual-pv-weather');
  assert.equal(result.electricalArchitecture.recommendedId, 'mv_11_ring');
  assert.equal(result.topologyFlow.validationBlocked, false);
});

test('EPC risks expose stable status and report gate from auto and manual acknowledgements', () => {
  const open = calculateEpcDesignProject({
    ...buildEpcDesignProjectFromQuickInputs(quarryInputs, { now: '2026-06-16T00:00:00.000Z' }),
    electrical: { selectedArchitectureId: 'lv_415_centralized' }
  }, { now: '2026-06-16T00:00:00.000Z' });
  const openElectricalRisk = open.risks.find((risk) => risk.id === 'electrical-mv-current');

  assert.equal(openElectricalRisk?.status, 'open');
  assert.equal(openElectricalRisk?.blocking, true);
  assert.equal(open.reportGate.blocked, true);

  const ring = calculateEpcDesignProject({
    ...buildEpcDesignProjectFromQuickInputs(quarryInputs, { now: '2026-06-16T00:00:00.000Z' }),
    electrical: { selectedArchitectureId: 'mv_11_ring', newMvSystem: true }
  }, { now: '2026-06-16T00:00:00.000Z' });
  const clearedElectricalRisk = ring.risks.find((risk) => risk.id === 'electrical-mv-current');

  assert.equal(clearedElectricalRisk?.status, 'auto-cleared');
  assert.equal(clearedElectricalRisk?.blocking, false);
  assert.match(clearedElectricalRisk?.clearedBy || '', /11kV Ring/i);

  const acknowledged = calculateEpcDesignProject({
    ...buildEpcDesignProjectFromQuickInputs(quarryInputs, { now: '2026-06-16T00:00:00.000Z' }),
    electrical: { selectedArchitectureId: 'mv_11_ring', newMvSystem: true },
    riskAcknowledgements: {
      'load-measurement': {
        reason: 'Temporary concept accepted until meter logging is complete.',
        signer: 'JQZ',
        signedAt: '2026-06-16T10:00:00.000Z'
      }
    }
  }, { now: '2026-06-16T00:00:00.000Z' });
  const loadRisk = acknowledged.risks.find((risk) => risk.id === 'load-measurement');

  assert.equal(acknowledged.riskAcknowledgements['load-measurement'].signer, 'JQZ');
  assert.equal(loadRisk?.status, 'manual-acknowledged');
  assert.equal(loadRisk?.blocking, false);
  assert.equal(acknowledged.reportGate.blocked, false);
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

test('EPC PV string design reports full-string rounding gap for procurement review', () => {
  const design = calculatePvStringDesign({
    targetPvMwp: 4,
    moduleWp: 580,
    modulesPerString: 26,
    combinerInputs: 16,
    inverterArchitecture: 'central'
  });

  assert.equal(design.modules, 6897);
  assert.equal(design.strings, 266);
  assert.equal(design.fullStringModuleCount, 6916);
  assert.equal(design.stringRoundingGapModules, 19);
  assert.ok(design.warnings.some((warning) => /full string/i.test(warning)));
});

test('EPC asset mapping expands quarry MV ring BOQ to procurement-grade feeder and genset lines', () => {
  const result = calculateEpcDesignProject({
    selectedTopologyId: 'C7',
    site: { gridMode: 'island' },
    electrical: { selectedArchitectureId: 'mv_11_ring', newMvSystem: true },
    loads: {
      dailyLoadKwh: 15452,
      operationHoursPerDay: 8,
      assetGroups: [
        { id: 'tjq1-primary', zone: 'TJQ1', label: 'TJQ1 primary crusher', assetType: 'crusher', assetCount: 1, feederCabinetQty: 1, ratioPct: 14 },
        { id: 'tjq1-secondary', zone: 'TJQ1', label: 'TJQ1 cone and VSI crushers', assetType: 'crusher', assetCount: 4, feederCabinetQty: 2, vfdCabinetQty: 1, ratioPct: 19 },
        { id: 'tjq1-screen', zone: 'TJQ1', label: 'TJQ1 screen and conveyor', assetType: 'screen', assetCount: 4, feederCabinetQty: 2, meteringCabinetQty: 1, ratioPct: 13 },
        { id: 'tjq2-primary', zone: 'TJQ2', label: 'TJQ2 primary crushers', assetType: 'crusher', assetCount: 2, feederCabinetQty: 1, ratioPct: 15 },
        { id: 'tjq2-secondary', zone: 'TJQ2', label: 'TJQ2 cone and mobile crushers', assetType: 'crusher', assetCount: 4, feederCabinetQty: 2, vfdCabinetQty: 2, ratioPct: 18 },
        { id: 'tjq2-screen', zone: 'TJQ2', label: 'TJQ2 screen and conveyor', assetType: 'screen', assetCount: 4, feederCabinetQty: 3, meteringCabinetQty: 1, ratioPct: 12 },
        { id: 'aux-pump', zone: 'Common', label: 'Water pump branch', assetType: 'pump', assetCount: 7, feederCabinetQty: 7, meteringCabinetQty: 1, ratioPct: 5 },
        { id: 'aux-workshop', zone: 'Common', label: 'Auxiliary lighting and maintenance', assetType: 'auxiliary', assetCount: 4, feederCabinetQty: 4, meteringCabinetQty: 1, ratioPct: 4 }
      ]
    },
    gensets: [
      { id: 'tjq1-g1', zone: 'TJQ1', label: 'CAT 350 kVA', ratedKva: 350 },
      { id: 'tjq1-g2', zone: 'TJQ1', label: 'CAT 750 kVA', ratedKva: 750 },
      { id: 'tjq1-g3', zone: 'TJQ1', label: 'Volvo Penta', ratedKva: 0 },
      { id: 'tjq1-g4', zone: 'TJQ1', label: 'CAT 365 kVA', ratedKva: 365 },
      { id: 'tjq2-g1', zone: 'TJQ2', label: 'Volvo Penta', ratedKva: 0 },
      { id: 'tjq2-g2', zone: 'TJQ2', label: 'Volvo Penta', ratedKva: 0 },
      { id: 'tjq2-g3', zone: 'TJQ2', label: 'KTA50-G1', ratedKva: 0 },
      { id: 'tjq2-g4', zone: 'TJQ2', label: 'CAT 3508 DITA', ratedKva: 0 },
      { id: 'tjq2-g5', zone: 'TJQ2', label: 'MarelliMotori AC Genset', ratedKva: 0 }
    ],
    designTargets: {
      replacementPct: 80,
      capacityOverrides: { pvMwp: 4, bessMwh: 5, pcsMw: 2.5 }
    }
  }, { now: '2026-06-19T00:00:00.000Z' });
  const row = (id) => result.boq.find((item) => item.id === id);

  assert.equal(result.loads.loadCount, 8);
  assert.equal(result.loadAssetSummary.zoneCount, 3);
  assert.equal(result.loadAssetSummary.assetCount, 30);
  assert.equal(result.loadAssetSummary.gensetCount, 9);
  assert.equal(result.topology.nodes.some((node) => node.id === 'load-8' && node.label === 'Auxiliary lighting and maintenance'), true);
  assert.equal(row('mv-load-branch-rmu')?.quantity, 8);
  assert.equal(row('load-transformer')?.quantity, 8);
  assert.equal(row('crusher-feeder-cabinet')?.quantity, 6);
  assert.equal(row('screen-feeder-cabinet')?.quantity, 5);
  assert.equal(row('pump-feeder-cabinet')?.quantity, 7);
  assert.equal(row('vfd-feeder-cabinet')?.quantity, 3);
  assert.equal(row('zone-metering-cabinet')?.quantity, 4);
  assert.equal(row('genset-remote-control')?.quantity, 9);
  assert.equal(row('genset-metering-runtime')?.quantity, 9);
  assert.equal(Object.hasOwn(result, 'procurementAdvisory'), false);
});

test('EPC asset genset fuel mapping creates feeder zoning load splits and topology recommendations', () => {
  const result = calculateEpcDesignProject({
    site: { gridMode: 'island' },
    loads: {
      measurementMethod: 'asset_genset_fuel_mapping',
      operationHoursPerDay: 8,
      assets: [
        { id: 'C1', name: 'Primary Crusher 1', type: 'crusher', zone: 'TJQ1', line: 'L1', kw: 230, qty: 1, startType: 'DOL', distanceM: 80, operationHours: 8, dutyFactor: 0.9, simultaneityFactor: 1, assignedGensetIds: ['G1'], fuelLiters: 460, fuelPeriodDays: 1, fuelRuntimeHours: 8 },
        { id: 'C2', name: 'Primary Crusher 2', type: 'crusher', zone: 'TJQ1', line: 'L1', kw: 230, qty: 1, startType: 'DOL', distanceM: 90, operationHours: 8, dutyFactor: 0.9, simultaneityFactor: 1, assignedGensetIds: ['G1'] },
        { id: 'C3', name: 'Remote Crusher', type: 'crusher', zone: 'TJQ1', line: 'L1', kw: 220, qty: 1, startType: 'DOL', distanceM: 230, operationHours: 8, dutyFactor: 0.8, simultaneityFactor: 1, assignedGensetIds: ['G2'] },
        { id: 'S1', name: 'Screen A', type: 'screen', zone: 'TJQ1', conveyorSystem: 'CV1', kw: 120, qty: 1, startType: 'soft_start', distanceM: 120, operationHours: 8, dutyFactor: 0.7, simultaneityFactor: 1, assignedGensetIds: ['G1'] },
        { id: 'S2', name: 'Screen B', type: 'screen', zone: 'TJQ1', conveyorSystem: 'CV1', kw: 100, qty: 1, startType: 'soft_start', distanceM: 130, operationHours: 8, dutyFactor: 0.7, simultaneityFactor: 1, assignedGensetIds: ['G1'] },
        { id: 'P1', name: 'Water Pump 1', type: 'pump', zone: 'Common', area: 'pond', kw: 60, qty: 1, startType: 'soft_start', distanceM: 70, operationHours: 10, dutyFactor: 0.8, simultaneityFactor: 1, assignedGensetIds: ['G3'] },
        { id: 'V1', name: 'VFD Pump', type: 'vfd', zone: 'Common', area: 'pond', kw: 600, qty: 1, startType: 'vfd', distanceM: 80, operationHours: 10, dutyFactor: 0.8, simultaneityFactor: 1, assignedGensetIds: ['G3'] }
      ]
    },
    gensets: [
      { id: 'G1', name: 'TJQ1 Genset', zone: 'TJQ1', ratedKva: 750, fuelLiters: 700, fuelPeriodDays: 1, runtimeHours: 8, supportedAssetIds: ['C1', 'C2', 'S1', 'S2'] },
      { id: 'G2', name: 'Remote Genset', zone: 'TJQ1', ratedKva: 350, fuelLiters: 260, fuelPeriodDays: 1, runtimeHours: 8, supportedAssetIds: ['C3'] },
      { id: 'G3', name: 'Common Genset', zone: 'Common', ratedKva: 300, fuelLiters: 150, fuelPeriodDays: 1, runtimeHours: 10, supportedAssetIds: ['P1', 'V1'] }
    ],
    designTargets: { replacementPct: 80 }
  }, { now: '2026-06-20T00:00:00.000Z' });

  assert.equal(result.load.measurementMethod, 'asset_genset_fuel_mapping');
  assert.ok(result.load.dailyLoadKwh > 4800);
  assert.ok(result.load.averageLoadKw > 600);
  assert.ok(result.load.peakLoadKw > result.load.averageLoadKw);
  assert.equal(result.feederZoning.zones.length, 2);
  assert.equal(result.feederZoning.feeders.some((row) => row.type === 'vfd' && row.assets.includes('V1')), true);
  assert.equal(result.feederZoning.feeders.some((row) => row.assets.includes('C1') && row.assets.includes('C2')), true);
  assert.equal(result.feederZoning.feeders.some((row) => row.assets.includes('S1') && row.assets.includes('S2')), true);
  assert.equal(result.feederZoning.feeders.some((row) => row.splitReason === 'current-limit'), true);
  assert.equal(result.feederZoning.metering.some((row) => row.level === 'Feeder' && row.feederId), true);
  assert.ok(result.feederZoning.transformers.every((row) => row.kva > 0));
  assert.ok(result.feederZoning.loadSplits.length >= 5);
  assert.equal(result.loads.loadSplits.length, result.feederZoning.loadSplits.length);
  assert.ok(result.feederZoning.topologyRecommendations.some((item) => /VFD|metering|MV|transformer|split/i.test(item.recommendation)));
  assert.equal(Object.hasOwn(result, 'procurementAdvisory'), false);
});

test('EPC off-grid projects default to the C5 standard topology with LV and MV buses', () => {
  const project = normalizeEpcDesignProject({
    site: { gridMode: 'island' }
  }, { now: '2026-06-16T00:00:00.000Z' });
  const result = calculateEpcDesignProject(project, { now: '2026-06-16T00:00:00.000Z' });

  assert.equal(result.selectedTopologyId, 'C5');
  assert.ok(result.standardTopologies.some((topology) => topology.id === 'C5' && /Off-Grid Microgrid/.test(topology.name)));
  assert.ok(result.topology.nodes.some((node) => node.type === 'LV_BUS'));
  assert.ok(result.topology.nodes.some((node) => node.type === 'MV_BUS'));
  assert.ok(result.topology.nodes.some((node) => node.type === 'EMS'));
  assert.ok(result.topology.edges.some((edge) => edge.type === 'AC_MV_POWER'));
  assert.equal(result.topologyValidation.valid, true);
});

test('EPC topology validator reports illegal connections and advisory fixes', () => {
  const result = calculateEpcDesignProject({
    selectedTopologyId: 'CUSTOM',
    topology: {
      nodes: [
        { id: 'pv-array', type: 'PV_ARRAY', label: 'PV Array', electrical: { voltageV: 1000 } },
        { id: 'pcs', type: 'PCS', label: 'PCS', electrical: { voltageV: 690, ratedPowerKw: 3000 } },
        { id: 'lv-bus', type: 'LV_BUS', label: '415V LV Bus', electrical: { voltageV: 415 } },
        { id: 'mv-bus', type: 'MV_BUS', label: '11kV MV Bus', electrical: { voltageV: 11000 } },
        { id: 'load', type: 'LOAD', label: 'Load', electrical: { voltageV: 415 } },
        { id: 'ems', type: 'EMS', label: 'EMS' }
      ],
      edges: [
        { id: 'bad-pv', source: 'pv-array', target: 'lv-bus', type: 'DC_POWER', direction: 'ONE_WAY' },
        { id: 'bad-pcs-mv', source: 'pcs', target: 'mv-bus', type: 'AC_MV_POWER', direction: 'BIDIRECTIONAL' },
        { id: 'bad-ems-power', source: 'ems', target: 'lv-bus', type: 'AC_LV_POWER', direction: 'ONE_WAY' },
        { id: 'pcs-load-direct', source: 'pcs', target: 'load', type: 'AC_LV_POWER', direction: 'ONE_WAY' }
      ]
    }
  }, { now: '2026-06-16T00:00:00.000Z' });
  const errorCodes = result.topologyValidation.errors.map((error) => error.code);
  const warningCodes = result.topologyValidation.warnings.map((warning) => warning.code);

  assert.equal(result.topologyValidation.valid, false);
  assert.ok(errorCodes.includes('PV_INVERTER_REQUIRED'));
  assert.ok(errorCodes.includes('TRANSFORMER_REQUIRED'));
  assert.ok(errorCodes.includes('EMS_POWER_EDGE_INVALID'));
  assert.ok(warningCodes.includes('BUS_OR_SWITCHBOARD_RECOMMENDED'));
  assert.ok(result.topologyValidation.errors.some((error) => error.suggestedFix?.insertNode === 'TRANSFORMER'));
});

test('EPC electrical architecture returns LV MV candidates cable screening and protection matrix', () => {
  const project = buildEpcDesignProjectFromQuickInputs({
    ...quarryInputs,
    distanceToInterconnectionM: 650
  }, {
    defaults: EPC_DESIGN_DEFAULTS,
    now: '2026-06-16T00:00:00.000Z'
  });
  const result = calculateEpcDesignProject({
    ...project,
    electrical: {
      ...project.electrical,
      distanceToInterconnectionM: 650,
      newMvSystem: true
    }
  }, { now: '2026-06-16T00:00:00.000Z' });
  const candidateIds = result.electricalArchitecture.candidates.map((candidate) => candidate.id);
  const cableStatuses = result.cableScreening.candidates.map((candidate) => candidate.status);

  assert.deepEqual(candidateIds, ['lv_415_centralized', 'lv_415_distributed', 'lv_800_microgrid', 'mv_6_6_radial', 'mv_11_radial', 'mv_11_ring']);
  assert.equal(result.electricalArchitecture.recommendedId, 'mv_11_ring');
  assert.equal(result.electricalArchitecture.candidates.find((candidate) => candidate.id === 'mv_11_ring').voltageKv, 11);
  assert.equal(result.electricalArchitecture.candidates.find((candidate) => candidate.id === 'lv_800_microgrid').status, 'REVIEW');
  assert.ok(result.electrical.transformerSizing.requiredKva > 4900);
  assert.equal(result.electrical.transformerSizing.selectedStandardKva, 5000);
  assert.ok(result.cableScreening.candidates.some((candidate) => candidate.voltageClass === '415V'));
  assert.ok(result.cableScreening.candidates.some((candidate) => candidate.voltageClass === '800V'));
  assert.ok(result.cableScreening.candidates.some((candidate) => candidate.voltageClass === '11kV'));
  assert.ok(cableStatuses.includes('PASS') || cableStatuses.includes('REVIEW'));
  assert.ok(result.protectionMatrix.functions.some((item) => item.code === 'SYNC_CHECK'));
  assert.ok(result.protectionMatrix.functions.some((item) => item.code === 'ANTI_ISLANDING'));
  assert.match(result.protectionMatrix.disclaimer, /concept-stage/i);
});

test('EPC topology flow adapter maps standard topology paths to EMS flow keys', () => {
  const result = calculateEpcDesignProject({
    selectedTopologyId: 'C5',
    site: { gridMode: 'island' },
    loads: { dailyLoadKwh: 12000, operationHoursPerDay: 8 },
    designTargets: { replacementPct: 80 }
  }, { now: '2026-06-16T00:00:00.000Z' });
  const nodesByType = new Set(result.topologyFlow.nodes.map((node) => node.type));
  const edge = (id) => result.topologyFlow.edges.find((item) => item.id === id);

  assert.equal(result.topologyFlow.topologyId, 'C5');
  assert.ok(nodesByType.has('LV_BUS'));
  assert.ok(nodesByType.has('TRANSFORMER'));
  assert.ok(nodesByType.has('MV_BUS'));
  assert.ok(nodesByType.has('LOAD'));
  assert.deepEqual(edge('pv-dc').flowKeys, ['pvOutputKw']);
  assert.ok(edge('pv-lv').flowKeys.includes('pvToLoadKw'));
  assert.ok(edge('lv-pcs-charge').flowKeys.includes('pvToBatteryKw'));
  assert.ok(edge('battery-pcs-discharge').flowKeys.includes('batteryToLoadKw'));
  assert.ok(edge('genset-lv').flowKeys.includes('gensetToLoadKw'));
  assert.deepEqual(edge('pv-curtailment').flowKeys, ['curtailmentKw']);
  assert.ok(edge('ring-rmu-load-1').flowKeys.includes('loadSplit:load-1'));
  assert.ok(edge('lv-load-bus-1-load-1').flowKeys.includes('loadSplit:load-1'));
  assert.equal(result.topologyFlow.validationBlocked, false);
});

test('EPC C5 EMS topology follows the source LV bus and RMU load branch sketch', () => {
  const result = calculateEpcDesignProject({
    selectedTopologyId: 'C5',
    site: { gridMode: 'island' },
    loads: {
      dailyLoadKwh: 12000,
      operationHoursPerDay: 8,
      loadCount: 2,
      loadSplits: [
        { id: 'load-1', label: 'Crusher Load', ratioPct: 60 },
        { id: 'load-2', label: 'Camp Load', ratioPct: 40 }
      ]
    },
    designTargets: { replacementPct: 80 }
  }, { now: '2026-06-16T00:00:00.000Z' });
  const edge = (id) => result.topology.edges.find((item) => item.id === id);
  const node = (id) => result.topology.nodes.find((item) => item.id === id);

  assert.equal(node('lv-bus').type, 'LV_BUS');
  assert.equal(node('load-tx-1').type, 'TRANSFORMER');
  assert.equal(node('lv-load-bus-1').type, 'LV_BUS');
  assert.equal(node('load-2').label, 'Camp Load');
  assert.equal(edge('pv-lv').source, 'pv-inverter');
  assert.equal(edge('pv-lv').target, 'lv-bus');
  assert.equal(edge('lv-pcs-charge').source, 'lv-bus');
  assert.equal(edge('pcs-lv-discharge').target, 'lv-bus');
  assert.equal(edge('genset-lv').target, 'lv-bus');
  assert.equal(edge('lv-step-up').source, 'lv-bus');
  assert.equal(edge('lv-step-up').target, 'step-up-tx');
  assert.equal(edge('step-up-mv').target, 'mv-switchboard');
  assert.equal(edge('mv-switchboard-rmu').target, 'ring-rmu');
  assert.equal(edge('ring-rmu-load-1').target, 'rmu-load-1');
  assert.equal(edge('rmu-load-1-load-tx-1').target, 'load-tx-1');
  assert.equal(edge('load-tx-1-lv-load-bus-1').target, 'lv-load-bus-1');
  assert.equal(edge('lv-load-bus-1-load-1').target, 'load-1');
  assert.equal(Boolean(edge('mv-load-tx')), false);
  assert.equal(Boolean(edge('load-tx-critical')), false);
});

test('EPC standard topology regenerates from load allocation instead of stale stored graph', () => {
  const stale = calculateEpcDesignProject({
    selectedTopologyId: 'C5',
    site: { gridMode: 'island' },
    loads: {
      dailyLoadKwh: 12000,
      operationHoursPerDay: 8,
      loadCount: 1
    },
    designTargets: { replacementPct: 80 }
  }, { now: '2026-06-16T00:00:00.000Z' });
  const result = calculateEpcDesignProject({
    selectedTopologyId: 'C5',
    topology: stale.topology,
    site: { gridMode: 'island' },
    loadProfile: [{ hour: 12, loadKw: 500 }],
    loads: {
      dailyLoadKwh: 12000,
      operationHoursPerDay: 8,
      loadCount: 2,
      loadSplits: [
        { id: 'load-1', label: 'Crusher', ratioPct: 70 },
        { id: 'load-2', label: 'Camp', ratioPct: 30 }
      ]
    },
    designTargets: { replacementPct: 80 }
  }, { now: '2026-06-16T00:00:00.000Z' });
  const edgeIds = new Set(result.topology.edges.map((edge) => edge.id));
  const row = result.energyFlow.rows.find((item) => item.loadKw > 0);

  assert.equal(result.topology.selectedTopologyId, 'C5');
  assert.equal(result.topology.nodes.some((node) => node.id === 'load-2' && node.label === 'Camp'), true);
  assert.equal(edgeIds.has('ring-rmu-load-2'), true);
  assert.equal(edgeIds.has('lv-load-bus-2-load-2'), true);
  assert.ok(result.topologyFlow.edges.some((edge) => edge.id === 'ring-rmu-load-2' && edge.flowKeys.includes('loadSplit:load-2')));
  assert.equal(row.loadSplits.length, 2);
  assert.equal(Math.round(row.loadSplits.reduce((sum, split) => sum + split.loadKw, 0) * 100) / 100, row.loadKw);
});

test('EPC custom topology regenerates load branches while preserving source-side edits', () => {
  const stale = calculateEpcDesignProject({
    selectedTopologyId: 'C5',
    topology: { selectedTopologyId: 'C5' },
    site: { gridMode: 'island' },
    loads: {
      dailyLoadKwh: 12000,
      operationHoursPerDay: 8,
      loadCount: 1
    },
    designTargets: { replacementPct: 80 }
  }, { now: '2026-06-16T00:00:00.000Z' });
  const customTopology = {
    ...stale.topology,
    selectedTopologyId: 'CUSTOM',
    sourceTopologyId: 'C5',
    nodes: stale.topology.nodes.map((node) => node.id === 'lv-bus'
      ? { ...node, position: { x: 512, y: 256 } }
      : node),
    edges: [
      ...stale.topology.edges,
      { id: 'ems-pv-custom', source: 'ems', target: 'pv-inverter', type: 'COMMUNICATION', direction: 'BIDIRECTIONAL', voltageV: 0 }
    ]
  };
  const result = calculateEpcDesignProject({
    selectedTopologyId: 'CUSTOM',
    topology: customTopology,
    site: { gridMode: 'island' },
    loads: {
      dailyLoadKwh: 12000,
      operationHoursPerDay: 8,
      loadCount: 3,
      loadSplits: [
        { id: 'load-1', label: 'Crusher', ratioPct: 40 },
        { id: 'load-2', label: 'Camp', ratioPct: 35 },
        { id: 'load-3', label: 'Office', ratioPct: 25 }
      ]
    },
    designTargets: { replacementPct: 80 }
  }, { now: '2026-06-16T00:00:00.000Z' });

  assert.equal(result.topology.selectedTopologyId, 'CUSTOM');
  assert.equal(result.topology.nodes.find((node) => node.id === 'lv-bus')?.position.x, 512);
  assert.equal(result.topology.nodes.find((node) => node.id === 'load-3')?.label, 'Office');
  assert.ok(result.topology.edges.some((edge) => edge.id === 'ring-rmu-load-3' && edge.loadSplitId === 'load-3'));
  assert.ok(result.topology.edges.some((edge) => edge.id === 'ems-pv-custom'));
  assert.equal(result.topology.edges.some((edge) => edge.id === 'ring-rmu-load-4'), false);
  assert.ok(result.topologyFlow.edges.some((edge) => edge.id === 'lv-load-bus-3-load-3' && edge.flowKeys.includes('loadSplit:load-3')));
});

test('EPC custom topology preserves moved load branch node positions across regeneration', () => {
  const base = calculateEpcDesignProject({
    selectedTopologyId: 'C5',
    topology: { selectedTopologyId: 'C5' },
    site: { gridMode: 'island' },
    loads: {
      dailyLoadKwh: 12000,
      operationHoursPerDay: 8,
      loadCount: 2
    },
    designTargets: { replacementPct: 80 }
  }, { now: '2026-06-18T00:00:00.000Z' });
  const result = calculateEpcDesignProject({
    selectedTopologyId: 'CUSTOM',
    topology: {
      ...base.topology,
      selectedTopologyId: 'CUSTOM',
      sourceTopologyId: 'C5',
      nodes: base.topology.nodes.map(node => {
        if (node.id === 'rmu-load-1') return { ...node, position: { x: 1510, y: 96 } };
        if (node.id === 'load-tx-1') return { ...node, position: { x: 1680, y: 96 } };
        if (node.id === 'lv-load-bus-1') return { ...node, position: { x: 1850, y: 96 } };
        if (node.id === 'load-1') return { ...node, position: { x: 2020, y: 96 } };
        return node;
      })
    },
    site: { gridMode: 'island' },
    loads: {
      dailyLoadKwh: 12000,
      operationHoursPerDay: 8,
      loadCount: 2
    },
    designTargets: { replacementPct: 80 }
  }, { now: '2026-06-18T00:00:00.000Z' });

  assert.equal(result.topology.nodes.find(node => node.id === 'rmu-load-1')?.position.x, 1510);
  assert.equal(result.topology.nodes.find(node => node.id === 'load-tx-1')?.position.x, 1680);
  assert.equal(result.topology.nodes.find(node => node.id === 'lv-load-bus-1')?.position.x, 1850);
  assert.equal(result.topology.nodes.find(node => node.id === 'load-1')?.position.x, 2020);
});

test('EPC custom topology preserves removed generated connections across load regeneration', () => {
  const result = calculateEpcDesignProject({
    selectedTopologyId: 'CUSTOM',
    topology: {
      selectedTopologyId: 'CUSTOM',
      sourceTopologyId: 'C5',
      removedEdgeIds: ['load-tx-1-lv-load-bus-1']
    },
    site: { gridMode: 'island' },
    loads: {
      dailyLoadKwh: 9000,
      operationHoursPerDay: 9,
      loadCount: 3,
      loadSplits: [
        { id: 'load-1', label: 'Plant', ratioPct: 50 },
        { id: 'load-2', label: 'Camp', ratioPct: 30 },
        { id: 'load-3', label: 'Workshop', ratioPct: 20 }
      ]
    }
  }, { now: '2026-06-17T00:00:00.000Z' });

  const edgeIds = result.topology.edges.map(edge => edge.id);
  assert.deepEqual(result.topology.removedEdgeIds, ['load-tx-1-lv-load-bus-1']);
  assert.equal(edgeIds.includes('load-tx-1-lv-load-bus-1'), false);
  assert.equal(edgeIds.includes('load-tx-2-lv-load-bus-2'), true);
  assert.equal(edgeIds.includes('load-tx-3-lv-load-bus-3'), true);
  assert.equal(result.topologyFlow.edges.some(edge => edge.id === 'load-tx-1-lv-load-bus-1'), false);
});

test('EPC topology templates can add nodes and permanently remove generated nodes', () => {
  const defaults = {
    ...EPC_DESIGN_DEFAULTS,
    standardTopologyLibrary: {
      version: 2,
      templates: {
        C5: {
          architectureVariants: {
            mv_11_radial: {
              removedNodeIds: ['lv-bus'],
              nodes: [
                {
                  id: 'custom-lv-bus-1',
                  type: 'LV_BUS',
                  label: 'Custom Workshop LV Bus',
                  position: { x: 510, y: 360 },
                  electrical: { voltageV: 415 },
                  busOrientation: 'horizontal'
                }
              ],
              edges: [
                {
                  id: 'custom-lv-bus-1-ems',
                  source: 'ems',
                  target: 'custom-lv-bus-1',
                  type: 'COMMUNICATION',
                  direction: 'BIDIRECTIONAL',
                  voltageV: 0
                }
              ]
            }
          }
        }
      }
    }
  };
  const result = calculateEpcDesignProject({
    selectedTopologyId: 'C5',
    site: { gridMode: 'island', distanceToInterconnectionM: 700 },
    electrical: { selectedArchitectureId: 'mv_11_radial', selectedArchitectureSource: 'user', newMvSystem: true },
    loads: { dieselTotalLiters: 6000, dieselPeriodDays: 1, operationHoursPerDay: 8 }
  }, { now: '2026-06-17T00:00:00.000Z', defaults });

  assert.deepEqual(result.topology.removedNodeIds, ['lv-bus']);
  assert.equal(result.topology.nodes.some(node => node.id === 'lv-bus'), false);
  assert.equal(result.topology.edges.some(edge => edge.source === 'lv-bus' || edge.target === 'lv-bus'), false);
  assert.equal(result.topology.nodes.find(node => node.id === 'custom-lv-bus-1')?.label, 'Custom Workshop LV Bus');
  assert.equal(result.topology.edges.some(edge => edge.id === 'custom-lv-bus-1-ems'), true);
  assert.equal(result.topologyFlow.nodes.some(node => node.id === 'custom-lv-bus-1'), true);
});

test('EPC custom topology preserves removed generated nodes across load regeneration', () => {
  const result = calculateEpcDesignProject({
    selectedTopologyId: 'CUSTOM',
    topology: {
      selectedTopologyId: 'CUSTOM',
      sourceTopologyId: 'C5',
      removedNodeIds: ['load-1'],
      nodes: [
        {
          id: 'custom-lv-bus-1',
          type: 'LV_BUS',
          label: 'Custom LV Bus',
          position: { x: 1600, y: 460 },
          electrical: { voltageV: 415 }
        }
      ]
    },
    site: { gridMode: 'island' },
    loads: {
      dailyLoadKwh: 9000,
      operationHoursPerDay: 9,
      loadCount: 3,
      loadSplits: [
        { id: 'load-1', label: 'Plant', ratioPct: 50 },
        { id: 'load-2', label: 'Camp', ratioPct: 30 },
        { id: 'load-3', label: 'Workshop', ratioPct: 20 }
      ]
    }
  }, { now: '2026-06-17T00:00:00.000Z' });

  assert.deepEqual(result.topology.removedNodeIds, ['load-1']);
  assert.equal(result.topology.nodes.some(node => node.id === 'load-1'), false);
  assert.equal(result.topology.edges.some(edge => edge.source === 'load-1' || edge.target === 'load-1'), false);
  assert.equal(result.topology.nodes.find(node => node.id === 'load-2')?.label, 'Camp');
  assert.equal(result.topology.nodes.find(node => node.id === 'custom-lv-bus-1')?.position.x, 1600);
});

test('EPC saved custom topology templates use generated IDs and remain architecture driven', () => {
  const defaults = {
    ...EPC_DESIGN_DEFAULTS,
    standardTopologyLibrary: {
      version: 2,
      customTemplates: {
        R4: {
          id: 'R4',
          name: 'Mine Camp Saved Layout',
          class: 'RESI',
          baseTopologyId: 'C5',
          architectureVariants: {
            mv_11_radial: {
              removedNodeIds: ['load-1'],
              removedEdgeIds: ['load-tx-1-lv-load-bus-1'],
              nodes: [
                { id: 'lv-bus', position: { x: 700, y: 240 } },
                { id: 'custom-lv-bus-1', type: 'LV_BUS', label: 'Saved Custom Bus', position: { x: 1620, y: 420 }, electrical: { voltageV: 415 } },
                { id: 'load-2', position: { x: 1530, y: 300 } }
              ],
              routes: {
                'lv-step-up': { manualRoute: true, locked: true, waypoints: [{ x: 860, y: 245 }] }
              }
            },
            mv_11_ring: {
              nodes: [
                { id: 'ring-rmu', position: { x: 1110, y: 260 } }
              ]
            }
          }
        },
        R8: { id: 'R8', name: 'Existing RESI', class: 'RESI', baseTopologyId: 'C5', architectureVariants: {} },
        C1: { id: 'C1', name: 'Existing C&I', class: 'C&I', baseTopologyId: 'C7', architectureVariants: {} }
      }
    }
  };
  const radial = calculateEpcDesignProject({
    selectedTopologyId: 'R4',
    site: { gridMode: 'island', distanceToInterconnectionM: 650 },
    electrical: { selectedArchitectureId: 'mv_11_radial', selectedArchitectureSource: 'user', newMvSystem: true },
    loads: {
      dieselTotalLiters: 6000,
      dieselPeriodDays: 1,
      operationHoursPerDay: 8,
      loadCount: 2,
      loadSplits: [
        { id: 'load-1', label: 'Plant', ratioPct: 55 },
        { id: 'load-2', label: 'Camp', ratioPct: 45 }
      ]
    }
  }, { now: '2026-06-17T00:00:00.000Z', defaults });
  const ring = calculateEpcDesignProject({
    selectedTopologyId: 'R4',
    site: { gridMode: 'island', distanceToInterconnectionM: 650 },
    electrical: { selectedArchitectureId: 'mv_11_ring', selectedArchitectureSource: 'user', newMvSystem: true },
    loads: { dieselTotalLiters: 6000, dieselPeriodDays: 1, operationHoursPerDay: 8 }
  }, { now: '2026-06-17T00:00:00.000Z', defaults });
  const normalized = normalizeEpcDesignProject({}, { defaults });

  assert.equal(radial.selectedTopologyId, 'R4');
  assert.equal(radial.topology.sourceTopologyId, 'R4');
  assert.equal(radial.topology.baseTopologyId, 'C5');
  assert.equal(radial.topology.nodes.some((node) => node.id === 'ring-rmu'), false);
  assert.deepEqual(radial.topology.removedNodeIds, ['load-1']);
  assert.equal(radial.topology.nodes.some((node) => node.id === 'load-1'), false);
  assert.deepEqual(radial.topology.removedEdgeIds, ['load-tx-1-lv-load-bus-1']);
  assert.equal(radial.topology.edges.some((edge) => edge.id === 'load-tx-1-lv-load-bus-1'), false);
  assert.equal(radial.topology.nodes.find((node) => node.id === 'lv-bus')?.position.x, 700);
  assert.equal(radial.topology.nodes.find((node) => node.id === 'custom-lv-bus-1')?.label, 'Saved Custom Bus');
  assert.equal(radial.topology.nodes.find((node) => node.id === 'load-2')?.label, 'Camp');
  assert.deepEqual(radial.topology.edges.find((edge) => edge.id === 'lv-step-up')?.route?.waypoints, [{ x: 860, y: 245 }]);
  assert.equal(ring.topology.nodes.find((node) => node.id === 'ring-rmu')?.position.x, 1110);
  assert.equal(normalized.calculationAssumptions.standardTopologyLibrary.nextCustomTemplateIds.RESI, 'R9');
  assert.equal(normalized.calculationAssumptions.standardTopologyLibrary.nextCustomTemplateIds['C&I'], 'C4');
});

test('EPC load splits normalize ratios and flow rows sum back to total load', () => {
  const result = calculateEpcDesignProject({
    selectedTopologyId: 'C5',
    site: { gridMode: 'island' },
    loadProfile: [{ hour: 12, loadKw: 300 }],
    loads: {
      operationHoursPerDay: 8,
      loadCount: 3,
      loadSplits: [
        { label: 'Load A', ratioPct: 50 },
        { label: 'Load B', ratioPct: 30 },
        { label: 'Load C', ratioPct: 20 }
      ]
    },
    designTargets: { replacementPct: 80 }
  }, { now: '2026-06-16T00:00:00.000Z' });
  const row = result.energyFlow.rows.find((item) => item.loadKw > 0);
  const splitKwTotal = row.loadSplits.reduce((sum, split) => sum + split.loadKw, 0);
  const splitRatioTotal = result.loads.loadSplits.reduce((sum, split) => sum + split.ratioPct, 0);

  assert.equal(result.loads.loadCount, 3);
  assert.equal(result.loads.loadSplits.map((split) => split.ratioPct).join(','), '50,30,20');
  assert.equal(splitRatioTotal, 100);
  assert.equal(row.loadSplits.length, 3);
  assert.equal(Math.round(splitKwTotal * 100) / 100, row.loadKw);
  assert.ok(result.topologyFlow.edges.some((edge) => edge.flowKeys.includes('loadSplit:load-3')));
});

test('EPC load allocation supports six load branches and preserves total kW', () => {
  const result = calculateEpcDesignProject({
    selectedTopologyId: 'C5',
    site: { gridMode: 'island' },
    loadProfile: [{ hour: 12, loadKw: 600 }],
    loads: {
      operationHoursPerDay: 8,
      loadCount: 6,
      loadSplits: [
        { label: 'Load 1', ratioPct: 10 },
        { label: 'Load 2', ratioPct: 15 },
        { label: 'Load 3', ratioPct: 20 },
        { label: 'Load 4', ratioPct: 25 },
        { label: 'Load 5', ratioPct: 20 },
        { label: 'Load 6', ratioPct: 10 }
      ]
    },
    designTargets: { replacementPct: 80 }
  }, { now: '2026-06-16T00:00:00.000Z' });
  const row = result.energyFlow.rows.find((item) => item.loadKw > 0);
  const splitKwTotal = row.loadSplits.reduce((sum, split) => sum + split.loadKw, 0);

  assert.equal(result.loads.loadCount, 6);
  assert.equal(result.topology.nodes.some((node) => node.id === 'load-6'), true);
  assert.ok(result.topologyFlow.edges.some((edge) => edge.id === 'lv-load-bus-6-load-6' && edge.flowKeys.includes('loadSplit:load-6')));
  assert.equal(Math.round(splitKwTotal * 100) / 100, 600);
});

test('EPC topology flow adapter separates simultaneous PV charge and battery discharge paths', () => {
  const result = calculateEpcDesignProject({
    selectedTopologyId: 'C5',
    site: { gridMode: 'island' },
    loads: { dailyLoadKwh: 12000, operationHoursPerDay: 8 },
    designTargets: { replacementPct: 80 }
  }, { now: '2026-06-16T00:00:00.000Z' });
  const edge = (id) => result.topologyFlow.edges.find((item) => item.id === id);
  const pvLoadEdges = result.topologyFlow.edges.filter((item) => item.flowKeys.includes('pvToLoadKw')).map((item) => item.id);
  const pvBatteryEdges = result.topologyFlow.edges.filter((item) => item.flowKeys.includes('pvToBatteryKw')).map((item) => item.id);
  const batteryLoadEdges = result.topologyFlow.edges.filter((item) => item.flowKeys.includes('batteryToLoadKw')).map((item) => item.id);

  assert.deepEqual(edge('pv-dc').flowKeys, ['pvOutputKw']);
  assert.deepEqual(edge('pv-lv').flowKeys, ['pvToLoadKw', 'pvToBatteryKw']);
  assert.deepEqual(edge('lv-pcs-charge').flowKeys, ['pvToBatteryKw']);
  assert.deepEqual(edge('pcs-battery-charge').flowKeys, ['pvToBatteryKw']);
  assert.deepEqual(edge('battery-pcs-discharge').flowKeys, ['batteryToLoadKw']);
  assert.deepEqual(edge('pcs-lv-discharge').flowKeys, ['batteryToLoadKw']);
  assert.equal(new Set(pvLoadEdges).has('pv-lv'), true);
  assert.equal(pvBatteryEdges.includes('pv-lv'), true);
  assert.equal(pvBatteryEdges.includes('lv-pcs-charge'), true);
  assert.equal(pvBatteryEdges.includes('pv-pcs-charge'), false);
  assert.equal(batteryLoadEdges.includes('battery-dc'), false);
});

test('EPC standard topologies charge battery through the AC bus before PCS', () => {
  const resultForTopology = (selectedTopologyId) => calculateEpcDesignProject({
    selectedTopologyId,
    site: { gridMode: 'island' },
    loads: { dailyLoadKwh: 1200, operationHoursPerDay: 8 },
    designTargets: { replacementPct: 80 }
  }, { now: '2026-06-16T00:00:00.000Z' });

  for (const topologyId of ['C3', 'C5', 'C7']) {
    const result = resultForTopology(topologyId);
    const edge = (id) => result.topologyFlow.edges.find((item) => item.id === id);
    const directPvPcs = result.topologyFlow.edges.find((item) => item.id === 'pv-pcs-charge');

    assert.equal(Boolean(directPvPcs), false, `${topologyId} should not wire PV inverter directly to PCS`);
    assert.deepEqual(edge('pcs-battery-charge').flowKeys, ['pvToBatteryKw']);
    if (topologyId === 'C7') {
      assert.deepEqual(edge('lv-pcs-charge').flowKeys, ['pvToBatteryKw']);
      assert.equal(edge('lv-step-up').source, 'lv-bus');
      assert.equal(edge('lv-step-up').target, 'step-up-tx');
    } else {
      assert.deepEqual(edge('lv-pcs-charge').flowKeys, ['pvToBatteryKw']);
      assert.equal(edge('lv-pcs-charge').target, 'pcs');
    }
  }

  const c2Template = resultForTopology('C2').topologySelection.blockedTopologies.find((topology) => topology.id === 'C2');
  assert.equal(c2Template.edges.some((edge) => edge.id === 'pv-pcs-charge'), false);
  assert.equal(c2Template.edges.some((edge) => edge.id === 'pcs-battery-charge'), false);
});

test('EPC MV topologies limit EMS control links to PCS and MV switchboard', () => {
  const resultForTopology = (selectedTopologyId) => calculateEpcDesignProject({
    selectedTopologyId,
    site: { gridMode: 'island' },
    loads: { dailyLoadKwh: 12000, operationHoursPerDay: 8 },
    designTargets: { replacementPct: 80 }
  }, { now: '2026-06-16T00:00:00.000Z' });

  const c5 = resultForTopology('C5');
  const c5EmsEdges = c5.topology.edges.filter((edge) => edge.source === 'ems').map((edge) => `${edge.id}:${edge.target}`);
  assert.ok(c5EmsEdges.includes('ems-pcs:pcs'));
  assert.ok(c5EmsEdges.includes('ems-mv-switchboard:mv-switchboard'));
  assert.equal(c5EmsEdges.some((edge) => /genset|load/.test(edge)), false);

  const c7 = resultForTopology('C7');
  const c7EmsEdges = c7.topology.edges.filter((edge) => edge.source === 'ems').map((edge) => `${edge.id}:${edge.target}`);
  assert.ok(c7EmsEdges.includes('ems-pcs:pcs'));
  assert.ok(c7EmsEdges.includes('ems-mv-switchboard:mv-bus'));
  assert.equal(c7EmsEdges.some((edge) => /genset|load/.test(edge)), false);
});

test('EPC topology recommendations exclude common 415V bus topologies for MV pass architecture', () => {
  const project = buildEpcDesignProjectFromQuickInputs({
    ...quarryInputs,
    distanceToInterconnectionM: 650
  }, {
    defaults: EPC_DESIGN_DEFAULTS,
    now: '2026-06-16T00:00:00.000Z'
  });
  const result = calculateEpcDesignProject({
    ...project,
    electrical: {
      ...project.electrical,
      distanceToInterconnectionM: 650,
      newMvSystem: true
    }
  }, { now: '2026-06-16T00:00:00.000Z' });
  const selectableIds = result.topologySelection.selectableTopologies.map((item) => item.id);

  assert.equal(result.electricalArchitecture.recommendedId, 'mv_11_ring');
  assert.equal(result.topologySelection.requiresMvTopology, true);
  assert.ok(selectableIds.includes('C5'));
  assert.ok(selectableIds.includes('C7'));
  assert.equal(selectableIds.includes('C2'), false);
  assert.equal(selectableIds.includes('C3'), false);
});

test('EPC chosen PASS architecture overrides recommendation and drives topology variant', () => {
  const radial66 = calculateEpcDesignProject({
    selectedTopologyId: 'C7',
    site: { gridMode: 'island', distanceToInterconnectionM: 650 },
    electrical: {
      selectedArchitectureId: 'mv_6_6_radial',
      selectedArchitectureSource: 'user',
      selectedArchitectureChosenAt: '2026-06-17T00:00:00.000Z',
      existingMvVoltageKv: 6.6,
      newMvSystem: true
    },
    loads: { dieselTotalLiters: 6000, dieselPeriodDays: 1, operationHoursPerDay: 8 }
  }, { now: '2026-06-17T00:00:00.000Z' });

  assert.equal(radial66.electricalArchitecture.recommendedId, 'mv_6_6_radial');
  assert.equal(radial66.electrical.selectedArchitectureId, 'mv_6_6_radial');
  assert.equal(radial66.topologySelection.architectureTopologyId, 'C5');
  assert.equal(radial66.selectedTopologyId, 'C5');
  assert.equal(radial66.topology.nodes.some((node) => node.id === 'ring-rmu'), false);
  assert.equal(radial66.topology.nodes.find((node) => node.id === 'mv-switchboard')?.electrical.voltageV, 6600);

  const ring11 = calculateEpcDesignProject({
    selectedTopologyId: 'C5',
    site: { gridMode: 'island', distanceToInterconnectionM: 650 },
    electrical: {
      selectedArchitectureId: 'mv_11_ring',
      selectedArchitectureSource: 'user',
      selectedArchitectureChosenAt: '2026-06-17T00:00:00.000Z',
      newMvSystem: true
    },
    loads: { dieselTotalLiters: 6000, dieselPeriodDays: 1, operationHoursPerDay: 8 }
  }, { now: '2026-06-17T00:00:00.000Z' });

  assert.equal(ring11.electricalArchitecture.recommendedId, 'mv_11_ring');
  assert.equal(ring11.topologySelection.architectureTopologyId, 'C7');
  assert.equal(ring11.selectedTopologyId, 'C7');
  assert.ok(ring11.topology.nodes.some((node) => node.id === 'ring-rmu'));
});

test('EPC global topology template layout replacement and routes feed topology flow', () => {
  const result = calculateEpcDesignProject({
    selectedTopologyId: 'C5',
    site: { gridMode: 'island', distanceToInterconnectionM: 500 },
    electrical: {
      selectedArchitectureId: 'mv_11_radial',
      selectedArchitectureSource: 'user',
      selectedArchitectureChosenAt: '2026-06-17T00:00:00.000Z',
      newMvSystem: true
    },
    loads: { dieselTotalLiters: 6000, dieselPeriodDays: 1, operationHoursPerDay: 8 }
  }, {
    now: '2026-06-17T00:00:00.000Z',
    defaults: {
      ...EPC_DESIGN_DEFAULTS,
      standardTopologyLibrary: {
        version: 2,
        componentCatalog: [
          { id: 'lv-switchboard-card', role: 'LV_BUS', type: 'LV_SWITCHBOARD', label: 'Source LV Switchboard' },
          { id: 'mv-rmu-card', role: 'MV_BUS', type: 'MV_BUS', label: 'MV RMU' }
        ],
        templates: {
          C5: {
            architectureVariants: {
              mv_11_radial: {
                nodes: [
                  { id: 'lv-bus', position: { x: 777, y: 222 }, componentId: 'lv-switchboard-card' },
                  { id: 'pcs', componentId: 'mv-rmu-card' }
                ],
                routes: {
                  'lv-step-up': { manualRoute: true, locked: true, waypoints: [{ x: 910, y: 260 }, { x: 960, y: 260 }] }
                }
              }
            }
          }
        }
      }
    }
  });

  const lvBus = result.topology.nodes.find((node) => node.id === 'lv-bus');
  const pcs = result.topology.nodes.find((node) => node.id === 'pcs');
  const flowLvBus = result.topologyFlow.nodes.find((node) => node.id === 'lv-bus');
  const route = result.topologyFlow.edges.find((edge) => edge.id === 'lv-step-up')?.route;

  assert.equal(lvBus?.position.x, 777);
  assert.equal(lvBus?.type, 'LV_SWITCHBOARD');
  assert.equal(lvBus?.label, 'Source LV Switchboard');
  assert.equal(pcs?.type, 'PCS', 'cross-role replacement should be ignored');
  assert.equal(flowLvBus?.position.x, 777);
  assert.deepEqual(route?.waypoints, [{ x: 910, y: 260 }, { x: 960, y: 260 }]);
  assert.equal(route?.manualRoute, true);
});

test('EPC global topology template preserves SLD viewport and canvas settings', () => {
  const project = normalizeEpcDesignProject({
    selectedTopologyId: 'C5',
    site: { gridMode: 'island', distanceToInterconnectionM: 500 },
    electrical: {
      selectedArchitectureId: 'mv_11_radial',
      selectedArchitectureSource: 'user',
      selectedArchitectureChosenAt: '2026-06-17T00:00:00.000Z'
    },
    loads: { dieselTotalLiters: 6000, dieselPeriodDays: 1, operationHoursPerDay: 8 }
  }, {
    now: '2026-06-17T00:00:00.000Z',
    defaults: {
      ...EPC_DESIGN_DEFAULTS,
      standardTopologyLibrary: {
        version: 2,
        templates: {
          C5: {
            architectureVariants: {
              mv_11_radial: {
                viewport: { x: 120, y: 30, zoom: 1.35 },
                canvas: { width: 1860, height: 620 },
                routes: {
                  'lv-step-up': { manualRoute: true, locked: true, waypoints: [{ x: 740, y: 210 }] }
                }
              }
            }
          }
        }
      }
    }
  });
  const variant = project.calculationAssumptions.standardTopologyLibrary.templates.C5.architectureVariants.mv_11_radial;

  assert.deepEqual(variant.viewport, { x: 120, y: 30, zoom: 1.35 });
  assert.deepEqual(variant.canvas, { width: 1860, height: 620 });
  assert.deepEqual(variant.routes['lv-step-up'].waypoints, [{ x: 740, y: 210 }]);
});

test('EPC global topology template is not shadowed by stale project assumptions', () => {
  const result = calculateEpcDesignProject({
    selectedTopologyId: 'C5',
    site: { gridMode: 'island', distanceToInterconnectionM: 500 },
    electrical: {
      selectedArchitectureId: 'mv_11_radial',
      selectedArchitectureSource: 'user',
      selectedArchitectureChosenAt: '2026-06-17T00:00:00.000Z',
      newMvSystem: true
    },
    assumptions: { standardTopologyLibrary: null },
    calculationAssumptions: { standardTopologyLibrary: null },
    loads: { dieselTotalLiters: 6000, dieselPeriodDays: 1, operationHoursPerDay: 8 }
  }, {
    now: '2026-06-17T00:00:00.000Z',
    defaults: {
      ...EPC_DESIGN_DEFAULTS,
      standardTopologyLibrary: {
        version: 2,
        templates: {
          C5: {
            architectureVariants: {
              mv_11_radial: {
                nodes: [
                  { id: 'lv-bus', position: { x: 888, y: 240 } }
                ]
              }
            }
          }
        }
      }
    }
  });

  assert.equal(result.topology.nodes.find((node) => node.id === 'lv-bus')?.position.x, 888);
  assert.equal(result.topologyFlow.nodes.find((node) => node.id === 'lv-bus')?.position.x, 888);
});

test('EPC MV architecture displays an MV-capable topology when an old LV-only topology is selected', () => {
  const project = buildEpcDesignProjectFromQuickInputs({
    ...quarryInputs,
    distanceToInterconnectionM: 650
  }, {
    defaults: EPC_DESIGN_DEFAULTS,
    now: '2026-06-16T00:00:00.000Z'
  });
  const result = calculateEpcDesignProject({
    ...project,
    selectedTopologyId: 'C3',
    topology: { selectedTopologyId: 'C3' },
    electrical: {
      ...project.electrical,
      distanceToInterconnectionM: 650,
      newMvSystem: true
    }
  }, { now: '2026-06-16T00:00:00.000Z' });

  assert.equal(result.topologySelection.requiresMvTopology, true);
  assert.equal(result.topologySelection.autoSelectedTopologyId, 'C5');
  assert.equal(result.selectedTopologyId, 'C5');
  assert.equal(result.topologyFlow.topologyId, 'C5');
  assert.ok(result.topology.nodes.some((node) => node.type === 'MV_SWITCHBOARD'));
  assert.equal(result.topologySelection.blockedTopologies.some((topology) => topology.id === 'C3'), true);
});

test('EPC topology flow adapter suppresses active flow on invalid custom connections', () => {
  const result = calculateEpcDesignProject({
    selectedTopologyId: 'CUSTOM',
    topology: {
      selectedTopologyId: 'CUSTOM',
      nodes: [
        { id: 'pv-array', type: 'PV_ARRAY', label: 'PV Array', electrical: { voltageV: 1000 } },
        { id: 'lv-bus', type: 'LV_BUS', label: 'LV Bus', electrical: { voltageV: 415 } },
        { id: 'load', type: 'LOAD', label: 'Load', electrical: { voltageV: 415 } }
      ],
      edges: [
        { id: 'bad-pv-direct', source: 'pv-array', target: 'lv-bus', type: 'DC_POWER', direction: 'ONE_WAY' },
        { id: 'lv-load', source: 'lv-bus', target: 'load', type: 'AC_LV_POWER', direction: 'ONE_WAY' }
      ]
    }
  }, { now: '2026-06-16T00:00:00.000Z' });
  const invalidEdge = result.topologyFlow.edges.find((edge) => edge.id === 'bad-pv-direct');
  const validEdge = result.topologyFlow.edges.find((edge) => edge.id === 'lv-load');

  assert.equal(result.topologyValidation.valid, false);
  assert.equal(result.topologyFlow.validationBlocked, true);
  assert.equal(invalidEdge.blocked, true);
  assert.deepEqual(invalidEdge.flowKeys, []);
  assert.equal(validEdge.blocked, false);
  assert.ok(validEdge.flowKeys.includes('loadKw'));
});
