// Browser global companion for epc-design-engine.mjs. Keep exported names aligned with the module.
(function(root) {
const EPC_DESIGN_VERSION = 'epc-design-v1';
  
  const EPC_DESIGN_DEFAULTS = Object.freeze({
    dieselSfcLPerKwh: 0.27,
    dieselSfcLowLPerKwh: 0.23,
    dieselSfcHighLPerKwh: 0.35,
    malaysiaYieldConservative: 3.3,
    malaysiaYieldBase: 3.6,
    malaysiaYieldOptimistic: 3.9,
    performanceRatio: 0.78,
    pvSizingMargin: 1.15,
    bessDod: 0.85,
    bessDischargeEfficiency: 0.95,
    bessAutonomyHours: 1.9,
    pcsSafetyFactor: 1.5,
    powerFactor: 0.95,
    lvVoltageKv: 0.415,
    lvHighCurrentWarningA: 2500,
    mvTriggerMwp: 3,
    mvTriggerDistanceM: 500,
    groundPvAreaM2PerMwp: 11500,
    moduleWp: 580,
    modulesPerString: 26,
    combinerInputs: 16
  });
  
  const SCHEME_TARGETS = [
    { id: 'replace-50', label: '50% Diesel Replacement', replacementPct: 50, priority: 'Conservative' },
    { id: 'replace-80', label: '80% Recommended Replacement', replacementPct: 80, priority: 'Recommended' },
    { id: 'replace-100', label: '100% Theoretical Replacement', replacementPct: 100, priority: 'Theoretical' }
  ];
  
  function asNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  
  function clamp(value, min, max, fallback = min) {
    const n = asNumber(value, fallback);
    return Math.min(max, Math.max(min, n));
  }
  
  function round(value, digits = 2) {
    const n = asNumber(value, 0);
    const factor = 10 ** digits;
    return Math.round(n * factor) / factor;
  }
  
  function isoNow(now) {
    if (now instanceof Date) return now.toISOString();
    if (typeof now === 'string' && now) return now;
    return new Date().toISOString();
  }
  
  function buildFormulaTrace({ key, label, formula, inputs, result, unit, assumptionSource = 'Default', now, isOverride = false, overrideReason = '' }) {
    return {
      key,
      label,
      formula,
      inputs,
      result,
      unit,
      assumptionSource,
      calculationVersion: EPC_DESIGN_VERSION,
      timestamp: isoNow(now),
      isOverride: !!isOverride,
      overrideReason: String(overrideReason || '')
    };
  }
  
  function defaultSolarResource(input = {}, defaults = EPC_DESIGN_DEFAULTS) {
    const importedYield = asNumber(input.specificYieldKwhPerKwpDay ?? input.pvYieldKwhPerKwpDay, NaN);
    const specificYield = Number.isFinite(importedYield) && importedYield > 0
      ? importedYield
      : defaults.malaysiaYieldBase;
    const imported = Number.isFinite(importedYield) && importedYield > 0;
    return {
      specificYieldKwhPerKwpDay: specificYield,
      ghiKwhM2Day: asNumber(input.ghiKwhM2Day, 0),
      dniKwhM2Day: asNumber(input.dniKwhM2Day, 0),
      temperatureC: asNumber(input.temperatureC, 0),
      monthlyYield: Array.isArray(input.monthlyYield) ? input.monthlyYield.map(v => asNumber(v, 0)) : [],
      dataSource: String(input.dataSource || (imported ? 'Global Solar Atlas Import' : 'Malaysia Default')),
      retrievalDate: String(input.retrievalDate || ''),
      assumptionSource: imported ? String(input.dataSource || 'User Imported') : 'Malaysia Default'
    };
  }
  
  function normalizeEpcDesignProject(raw = {}, options = {}) {
    const defaults = { ...EPC_DESIGN_DEFAULTS, ...(options.defaults || raw.defaults || {}) };
    const now = isoNow(options.now || raw.updatedAt || raw.createdAt);
    const project = raw.project || {};
    const site = raw.site || {};
    const loads = raw.loads || {};
    const designTargets = raw.designTargets || {};
    const electrical = raw.electrical || {};
    const solarResource = defaultSolarResource(raw.solarResource || {}, defaults);
    const id = String(raw.id || project.id || `epc-${Date.parse(now) || Date.now()}`).trim();
  
    return {
      id,
      mode: String(raw.mode || 'quick'),
      project: {
        id,
        name: String(project.name || raw.projectName || 'New Hybrid EPC Design').trim(),
        customer: String(project.customer || raw.customer || '').trim(),
        stage: String(project.stage || 'Concept').trim(),
        scenario: String(project.scenario || 'Genset replacement').trim()
      },
      site: {
        country: String(site.country || raw.country || 'Malaysia').trim(),
        state: String(site.state || raw.state || '').trim(),
        latitude: asNumber(site.latitude ?? raw.latitude, 0),
        longitude: asNumber(site.longitude ?? raw.longitude, 0),
        availableAreaM2: asNumber(site.availableAreaM2 ?? raw.availableAreaM2, 0),
        distanceToInterconnectionM: asNumber(site.distanceToInterconnectionM, 0),
        gridMode: String(site.gridMode || raw.gridMode || 'hybrid').trim()
      },
      gensets: Array.isArray(raw.gensets) ? raw.gensets : [],
      loads: {
        dieselTotalLiters: asNumber(loads.dieselTotalLiters ?? raw.dieselTotalLiters, 0),
        dieselPeriodDays: Math.max(1, asNumber(loads.dieselPeriodDays ?? raw.dieselPeriodDays, 1)),
        dieselPricePerLiter: asNumber(loads.dieselPricePerLiter ?? raw.dieselPricePerLiter, 0),
        operationHoursPerDay: clamp(loads.operationHoursPerDay ?? raw.operationHoursPerDay, 1, 24, 8),
        measuredDailyLoadKwh: asNumber(loads.measuredDailyLoadKwh, 0),
        loadSource: String(loads.loadSource || 'diesel_reverse').trim()
      },
      solarResource,
      designTargets: {
        replacementPct: clamp(designTargets.replacementPct ?? raw.targetReplacementPct, 0, 100, 80),
        bessRole: String(designTargets.bessRole || 'PV smoothing + diesel saving').trim()
      },
      electrical: {
        voltageKv: asNumber(electrical.voltageKv, defaults.lvVoltageKv),
        powerFactor: clamp(electrical.powerFactor, 0.1, 1, defaults.powerFactor),
        distanceToInterconnectionM: asNumber(electrical.distanceToInterconnectionM ?? site.distanceToInterconnectionM, 0)
      },
      assumptions: {
        ...defaults,
        ...(raw.assumptions || {})
      },
      calculationAssumptions: {
        ...defaults,
        ...(raw.calculationAssumptions || {})
      },
      documents: raw.documents && typeof raw.documents === 'object' ? raw.documents : {},
      createdAt: String(raw.createdAt || now),
      updatedAt: now
    };
  }
  
  function buildEpcDesignProjectFromQuickInputs(inputs = {}, options = {}) {
    return normalizeEpcDesignProject({
      project: {
        name: inputs.projectName,
        customer: inputs.customer,
        stage: 'Concept'
      },
      site: {
        country: inputs.country,
        state: inputs.state,
        latitude: inputs.latitude,
        longitude: inputs.longitude,
        availableAreaM2: inputs.availableAreaM2,
        gridMode: inputs.gridMode
      },
      loads: {
        dieselTotalLiters: inputs.dieselTotalLiters,
        dieselPeriodDays: inputs.dieselPeriodDays,
        dieselPricePerLiter: inputs.dieselPricePerLiter,
        operationHoursPerDay: inputs.operationHoursPerDay
      },
      solarResource: {
        specificYieldKwhPerKwpDay: inputs.pvYieldKwhPerKwpDay,
        dataSource: inputs.solarDataSource
      },
      designTargets: {
        replacementPct: inputs.targetReplacementPct
      },
      assumptions: options.defaults || {},
      createdAt: options.now,
      updatedAt: options.now
    }, options);
  }
  
  function dataQualityScore(project) {
    let score = 0;
    if (project.site.latitude && project.site.longitude) score += 18;
    if (project.loads.measuredDailyLoadKwh > 0) score += 30;
    else if (project.loads.dieselTotalLiters > 0 && project.loads.dieselPeriodDays > 0) score += 22;
    if (project.solarResource.dataSource !== 'Malaysia Default') score += 22;
    else score += 10;
    if (project.site.availableAreaM2 > 0) score += 15;
    if (project.gensets.length) score += 10;
    if (project.electrical.distanceToInterconnectionM > 0) score += 5;
    return Math.min(100, score);
  }
  
  function calculateLoad(project, now) {
    const sfc = asNumber(project.assumptions.dieselSfcLPerKwh, EPC_DESIGN_DEFAULTS.dieselSfcLPerKwh);
    const dailyDieselLiters = project.loads.dieselTotalLiters / Math.max(1, project.loads.dieselPeriodDays);
    const dailyLoadKwh = project.loads.measuredDailyLoadKwh > 0
      ? project.loads.measuredDailyLoadKwh
      : dailyDieselLiters / Math.max(0.001, sfc);
    const averageLoadKw = dailyLoadKwh / Math.max(1, project.loads.operationHoursPerDay);
    return {
      dailyDieselLiters,
      dailyLoadKwh,
      averageLoadKw,
      monthlyDieselLiters: dailyDieselLiters * 30,
      annualDieselLiters: dailyDieselLiters * 365,
      monthlyDieselCost: dailyDieselLiters * 30 * project.loads.dieselPricePerLiter,
      trace: [
        buildFormulaTrace({
          key: 'dailyDieselLiters',
          label: 'Daily Diesel',
          formula: 'Total Diesel / Period Days',
          inputs: { totalLiters: project.loads.dieselTotalLiters, periodDays: project.loads.dieselPeriodDays },
          result: round(dailyDieselLiters, 4),
          unit: 'L/day',
          assumptionSource: project.loads.loadSource,
          now
        }),
        buildFormulaTrace({
          key: 'dailyLoadKwh',
          label: 'Daily Load',
          formula: project.loads.measuredDailyLoadKwh > 0 ? 'Measured Daily Load' : 'Daily Diesel / SFC',
          inputs: { dailyDieselLiters: round(dailyDieselLiters, 4), sfcLPerKwh: sfc },
          result: round(dailyLoadKwh, 4),
          unit: 'kWh/day',
          assumptionSource: project.loads.loadSource,
          now
        }),
        buildFormulaTrace({
          key: 'averageLoadKw',
          label: 'Average Load',
          formula: 'Daily Load / Operation Hours',
          inputs: { dailyLoadKwh: round(dailyLoadKwh, 4), operationHoursPerDay: project.loads.operationHoursPerDay },
          result: round(averageLoadKw, 4),
          unit: 'kW',
          assumptionSource: project.loads.loadSource,
          now
        })
      ]
    };
  }
  
  function roundUpStep(value, step) {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.ceil(value / step) * step;
  }
  
  function calculateScheme(project, load, target, now) {
    const yieldKwh = Math.max(0.001, asNumber(project.solarResource.specificYieldKwhPerKwpDay, EPC_DESIGN_DEFAULTS.malaysiaYieldBase));
    const margin = asNumber(project.assumptions.pvSizingMargin, EPC_DESIGN_DEFAULTS.pvSizingMargin);
    const dod = asNumber(project.assumptions.bessDod, EPC_DESIGN_DEFAULTS.bessDod);
    const efficiency = asNumber(project.assumptions.bessDischargeEfficiency, EPC_DESIGN_DEFAULTS.bessDischargeEfficiency);
    const autonomyHours = asNumber(project.assumptions.bessAutonomyHours, EPC_DESIGN_DEFAULTS.bessAutonomyHours);
    const pcsSafetyFactor = asNumber(project.assumptions.pcsSafetyFactor, EPC_DESIGN_DEFAULTS.pcsSafetyFactor);
    const targetDailyKwh = load.dailyLoadKwh * (target.replacementPct / 100);
    const pvRawKwp = targetDailyKwh / yieldKwh;
    const pvRecommendedMwp = (pvRawKwp * margin) / 1000;
    const bessRecommendedMwh = (load.averageLoadKw * autonomyHours) / Math.max(0.001, dod * efficiency) / 1000;
    const pcsRecommendedMw = roundUpStep((load.averageLoadKw * pcsSafetyFactor) / 1000, 0.5);
    const requiredAreaM2 = pvRecommendedMwp * asNumber(project.assumptions.groundPvAreaM2PerMwp, EPC_DESIGN_DEFAULTS.groundPvAreaM2PerMwp);
    const monthlyDieselSavedLiters = load.dailyDieselLiters * (target.replacementPct / 100) * 30;
    const monthlySavings = monthlyDieselSavedLiters * project.loads.dieselPricePerLiter;
  
    return {
      ...target,
      targetDailyKwh,
      pvRawKwp,
      pvRecommendedMwp,
      bessRecommendedMwh,
      pcsRecommendedMw,
      requiredAreaM2,
      areaUtilizationPct: project.site.availableAreaM2 > 0 ? (requiredAreaM2 / project.site.availableAreaM2) * 100 : 0,
      monthlyDieselSavedLiters,
      monthlySavings,
      annualSavings: monthlySavings * 12,
      formulaTrace: [
        buildFormulaTrace({
          key: `${target.id}.targetDailyKwh`,
          label: `${target.label} Target Energy`,
          formula: 'Daily Load x Replacement %',
          inputs: { dailyLoadKwh: round(load.dailyLoadKwh, 4), replacementPct: target.replacementPct },
          result: round(targetDailyKwh, 4),
          unit: 'kWh/day',
          assumptionSource: 'Design Target',
          now
        })
      ]
    };
  }
  
  function calculateElectrical(project, recommended) {
    const pf = asNumber(project.electrical.powerFactor, EPC_DESIGN_DEFAULTS.powerFactor);
    const voltageKv = asNumber(project.electrical.voltageKv, EPC_DESIGN_DEFAULTS.lvVoltageKv);
    const roundedPvMwp = roundUpStep(recommended?.pvRecommendedMwp || 0, 0.5);
    const designKw = Math.max(roundedPvMwp * 1000, (recommended?.pcsRecommendedMw || 0) * 1000);
    const lvCurrentA = designKw > 0 && voltageKv > 0 && pf > 0
      ? designKw / (Math.sqrt(3) * voltageKv * pf)
      : 0;
    const distance = Math.max(project.site.distanceToInterconnectionM || 0, project.electrical.distanceToInterconnectionM || 0);
    const mvRecommended = lvCurrentA > asNumber(project.assumptions.lvHighCurrentWarningA, EPC_DESIGN_DEFAULTS.lvHighCurrentWarningA)
      || roundedPvMwp >= asNumber(project.assumptions.mvTriggerMwp, EPC_DESIGN_DEFAULTS.mvTriggerMwp)
      || (designKw > 500 && distance > asNumber(project.assumptions.mvTriggerDistanceM, EPC_DESIGN_DEFAULTS.mvTriggerDistanceM));
    return {
      designKw,
      roundedPvMwp,
      lvCurrentA,
      mvRecommended,
      recommendation: mvRecommended
        ? 'Recommend 11kV MV integration or transformer-based architecture; LV-only 415V current is high.'
        : 'LV integration is feasible for concept stage; verify cable voltage drop and protection study.'
    };
  }
  
  function buildBoq(project, recommended) {
    return [
      { package: 'PV', item: 'PV modules and mounting', quantity: round(recommended.pvRecommendedMwp, 2), unit: 'MWp', mandatory: true },
      { package: 'PV', item: 'String inverter / combiner design', quantity: round(recommended.pvRecommendedMwp, 2), unit: 'MWp', mandatory: true },
      { package: 'BESS', item: 'Battery container/system', quantity: round(recommended.bessRecommendedMwh, 2), unit: 'MWh', mandatory: true },
      { package: 'BESS', item: 'PCS capacity', quantity: round(recommended.pcsRecommendedMw, 2), unit: 'MW', mandatory: true },
      { package: 'Electrical', item: 'MV transformer and switchgear allowance', quantity: project.site.gridMode === 'island' || recommended.pvRecommendedMwp >= 3 ? 1 : 0, unit: 'lot', mandatory: recommended.pvRecommendedMwp >= 3 },
      { package: 'Control', item: 'EMS with genset dispatch logic', quantity: 1, unit: 'lot', mandatory: true },
      { package: 'Services', item: 'Site survey, SLD, protection and civil/fire review', quantity: 1, unit: 'lot', mandatory: true }
    ];
  }
  
  function buildRisks(project, load, electrical, recommended) {
    const risks = [];
    if (project.loads.loadSource !== 'measured_profile') {
      risks.push({ level: 'High', area: 'Load', issue: 'Sizing is based on diesel reverse calculation; measured load curve is required before guarantee.' });
    }
    if (project.solarResource.dataSource === 'Malaysia Default') {
      risks.push({ level: 'Medium', area: 'Solar', issue: 'Solar resource uses Malaysia default yield; import Global Solar Atlas or PVsyst data for precise design.' });
    }
    if (electrical.mvRecommended) {
      risks.push({ level: 'High', area: 'Electrical', issue: '415V current exceeds concept threshold; 11kV MV architecture should be checked.' });
    }
    if (project.site.availableAreaM2 > 0 && recommended.requiredAreaM2 > project.site.availableAreaM2) {
      risks.push({ level: 'High', area: 'Civil', issue: 'Required PV area exceeds available area; phase or reduce PV capacity.' });
    }
    if (recommended.bessRecommendedMwh > 0) {
      risks.push({ level: 'Medium', area: 'BESS', issue: 'BESS duty, DoD, C-rate, thermal/fire separation and EMS sequence require vendor validation.' });
    }
    return risks;
  }
  
  function calculateEpcDesignProject(rawProject = {}, options = {}) {
    const project = normalizeEpcDesignProject(rawProject, options);
    const now = isoNow(options.now);
    const load = calculateLoad(project, now);
    const schemes = SCHEME_TARGETS.map(target => calculateScheme(project, load, target, now));
    const recommended = schemes.find(scheme => scheme.id === 'replace-80') || schemes[0];
    const electrical = calculateElectrical(project, recommended);
    const boq = buildBoq(project, recommended);
    const risks = buildRisks(project, load, electrical, recommended);
    const formulaTrace = [
      ...load.trace,
      buildFormulaTrace({
        key: 'pvRecommendedMwp',
        label: 'Recommended PV Capacity',
        formula: 'Target Daily Energy / Specific Yield x PV Margin / 1000',
        inputs: {
          targetDailyKwh: round(recommended.targetDailyKwh, 4),
          specificYieldKwhPerKwpDay: project.solarResource.specificYieldKwhPerKwpDay,
          pvSizingMargin: project.assumptions.pvSizingMargin
        },
        result: round(recommended.pvRecommendedMwp, 4),
        unit: 'MWp',
        assumptionSource: project.solarResource.assumptionSource,
        now
      }),
      buildFormulaTrace({
        key: 'bessRecommendedMwh',
        label: 'Recommended BESS Energy',
        formula: 'Average Load x Autonomy Hours / (DoD x Discharge Efficiency) / 1000',
        inputs: {
          averageLoadKw: round(load.averageLoadKw, 4),
          autonomyHours: project.assumptions.bessAutonomyHours,
          dod: project.assumptions.bessDod,
          dischargeEfficiency: project.assumptions.bessDischargeEfficiency
        },
        result: round(recommended.bessRecommendedMwh, 4),
        unit: 'MWh',
        assumptionSource: 'Default',
        now
      }),
      buildFormulaTrace({
        key: 'pcsRecommendedMw',
        label: 'Recommended PCS',
        formula: 'Average Load x PCS Safety Factor, rounded up to 0.5MW',
        inputs: {
          averageLoadKw: round(load.averageLoadKw, 4),
          pcsSafetyFactor: project.assumptions.pcsSafetyFactor
        },
        result: round(recommended.pcsRecommendedMw, 4),
        unit: 'MW',
        assumptionSource: 'Default',
        now
      })
    ];
  
    return {
      ...project,
      load,
      solar: project.solarResource,
      schemes,
      recommendedSchemeId: recommended.id,
      electrical,
      boq,
      risks,
      dataQualityScore: dataQualityScore(project),
      formulaTrace,
      nextVerification: [
        'Install/load logger or obtain measured load profile.',
        'Import Global Solar Atlas/PVsyst monthly yield for exact coordinates.',
        'Verify genset nameplates, SLD, motor starting method and protection settings.',
        'Check PV layout, shading, drainage, civil/fire clearance and MV route.'
      ],
      disclaimer: 'Concept and budgetary sizing only. Final design requires measured load curve, SLD, solar simulation, voltage drop, short-circuit/protection, civil/fire review, latest certification rules and manufacturer data.'
    };
  }
  
  function calculatePvStringDesign({ targetPvMwp = 0, moduleWp = EPC_DESIGN_DEFAULTS.moduleWp, modulesPerString = EPC_DESIGN_DEFAULTS.modulesPerString, combinerInputs = EPC_DESIGN_DEFAULTS.combinerInputs } = {}) {
    const modules = Math.ceil((asNumber(targetPvMwp, 0) * 1000000) / Math.max(1, asNumber(moduleWp, EPC_DESIGN_DEFAULTS.moduleWp)));
    const strings = Math.ceil(modules / Math.max(1, asNumber(modulesPerString, EPC_DESIGN_DEFAULTS.modulesPerString)));
    const combiners = Math.ceil(strings / Math.max(1, asNumber(combinerInputs, EPC_DESIGN_DEFAULTS.combinerInputs)));
    return {
      moduleWp: asNumber(moduleWp, EPC_DESIGN_DEFAULTS.moduleWp),
      modules,
      modulesPerString: asNumber(modulesPerString, EPC_DESIGN_DEFAULTS.modulesPerString),
      strings,
      combinerInputs: asNumber(combinerInputs, EPC_DESIGN_DEFAULTS.combinerInputs),
      combiners
    };
  }
  
  function buildGlobalSolarAtlasUrl(site = {}) {
    const lat = asNumber(site.latitude, 0);
    const lng = asNumber(site.longitude, 0);
    const zoom = 11;
    return `https://globalsolaratlas.info/map?c=${lat.toFixed(6)},${lng.toFixed(6)},${zoom}&s=${lat.toFixed(6)},${lng.toFixed(6)}&m=site`;
  }
  
  function normalizeEpcDesignProjectList(value = [], options = {}) {
    return (Array.isArray(value) ? value : [])
      .map(item => normalizeEpcDesignProject(item, options))
      .filter(item => item.id);
  }
  
  if (root.document?.documentElement) {
    root.document.documentElement.dataset.epcDesignEngine = EPC_DESIGN_VERSION;
  }
  root.MinovaEpcDesignEngine = {
    EPC_DESIGN_VERSION,
    EPC_DESIGN_DEFAULTS,
    normalizeEpcDesignProject,
    buildEpcDesignProjectFromQuickInputs,
    calculateEpcDesignProject,
    calculatePvStringDesign,
    buildGlobalSolarAtlasUrl,
    normalizeEpcDesignProjectList
  };
})(window);
