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
    'curtailmentKw',
    'socPct'
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
    emsFlowDisplaySettings: {
      visibleSeries: ['pv', 'load', 'soc'],
      mergeHourly: false,
      intervalMinutes: 5,
      selectedRange: { start: 2, end: 8 },
      peakBand: { visible: false, color: '#e0f2fe', startMinute: 15 * 60, endMinute: 21 * 60 },
      seriesColors: { pv: '#f59e0b', load: '#2563eb', battery: '#16a34a', genset: '#ef4444', soc: '#0ea5e9' },
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
  assert.equal(project.emsFlowDisplaySettings.intervalMinutes, 5);
  assert.deepEqual(project.emsFlowDisplaySettings.selectedRange, { start: 2, end: 8 });
  assert.deepEqual(project.emsFlowDisplaySettings.peakBand, { visible: false, color: '#e0f2fe', startMinute: 900, endMinute: 1260 });
  assert.equal(project.emsFlowDisplaySettings.seriesColors.genset, '#ef4444');
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
  assert.equal(defaultSettings.emsFlowDisplaySettings.intervalMinutes, 5);
  assert.equal(defaultSettings.emsFlowDisplaySettings.deviceWorkModel.applyToEmsFlow, true);
  assert.equal(defaultSettings.emsFlowDisplaySettings.deviceWorkModel.loadNoisePct, 3);
  assert.equal(defaultSettings.emsFlowDisplaySettings.deviceWorkModel.loadShockPosition, 'startup');
  assert.equal(defaultSettings.emsFlowDisplaySettings.deviceWorkModel.gensetShockPosition, 'startup');
  assert.equal(defaultSettings.emsFlowDisplaySettings.batteryControl.mode, 'auto');
  assert.deepEqual(defaultSettings.emsFlowDisplaySettings.batteryControl.priorityOrder.slice(0, 3), ['pv_to_load', 'battery_to_load', 'genset_to_load']);
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
