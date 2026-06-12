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
  assert.equal(trace.unit, 'MWp');
  assert.equal(trace.assumptionSource, 'Malaysia Default');
  assert.equal(trace.isOverride, false);
  assert.equal(trace.calculationVersion, 'epc-design-v1');
  assert.match(buildGlobalSolarAtlasUrl(normalized.site), /globalsolaratlas\.info/);
  assert.match(buildGlobalSolarAtlasUrl(normalized.site), /2\.960857/);
});

test('EPC PV string design follows the revised workbook module and combiner baseline', () => {
  const design = calculatePvStringDesign({
    targetPvMwp: 4,
    moduleWp: 580,
    modulesPerString: 26,
    combinerInputs: 16
  });

  assert.deepEqual(design, {
    moduleWp: 580,
    modules: 6897,
    modulesPerString: 26,
    strings: 266,
    combinerInputs: 16,
    combiners: 17
  });
});
