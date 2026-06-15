// Browser global companion for epc-design-engine.mjs. Keep exported names aligned with the module.
(function(root) {
const EPC_DESIGN_VERSION = 'epc-design-v2';
const GLOBAL_SOLAR_ATLAS_API_BASE = 'https://2eueu84zmf.execute-api.eu-west-1.amazonaws.com/prod/';

  const EPC_DESIGN_DEFAULTS = Object.freeze({
    googleMapsBrowserKey: 'AIzaSyANofvEcKkP15p13BCmIMpGvWyuDTtlUKM',
    globalSolarAtlasApiBase: GLOBAL_SOLAR_ATLAS_API_BASE,
    dieselSfcLPerKwh: 0.27,
    dieselSfcLowLPerKwh: 0.23,
    dieselSfcHighLPerKwh: 0.35,
    malaysiaYieldConservative: 3.3,
    malaysiaYieldBase: 3.6,
    malaysiaYieldOptimistic: 3.9,
    performanceRatio: 0.78,
    pvSizingMargin: 1.15,
    bessDod: 0.75,
    bessDischargeEfficiency: 0.95,
    bessAutonomyHours: 1.9,
    pcsSafetyFactor: 1.5,
    peakLoadFactor: 1.3,
    islandPcsSafetyFactor: 1.2,
    pvSmoothingPcsRatio: 0.2,
    minSocPct: 20,
    maxSocPct: 95,
    powerFactor: 0.95,
    lvVoltageKv: 0.415,
    lvHighCurrentWarningA: 2500,
    mvTriggerMwp: 3,
    mvDistanceWarningM: 200,
    mvTriggerDistanceM: 500,
    groundPvAreaM2PerMwp: 11500,
    moduleWp: 580,
    modulesPerString: 26,
    combinerInputs: 16,
    inverterArchitecture: 'central',
    totalStringInputs: 0
  });

  const SCHEME_TARGETS = [
    { id: 'replace-50', label: '50% Diesel Replacement', replacementPct: 50, priority: 'Conservative' },
    { id: 'replace-80', label: '80% Recommended Replacement', replacementPct: 80, priority: 'Recommended' },
    { id: 'replace-100', label: '100% Theoretical Replacement', replacementPct: 100, priority: 'Theoretical' }
  ];

  const EMS_FLOW_DISPLAY_SERIES = ['pv', 'load', 'battery', 'genset', 'soc'];
  const EMS_FLOW_SERIES_DEFAULT_COLORS = {
    pv: '#f59e0b',
    load: '#2563eb',
    battery: '#16a34a',
    genset: '#ef4444',
    soc: '#0ea5e9'
  };
  const EMS_FLOW_INTERVAL_MINUTES = [1, 5, 15, 30, 60, 120, 360, 720];
  const EMS_FLOW_DEFAULT_PEAK_BAND_START_MINUTE = 14 * 60;
  const EMS_FLOW_DEFAULT_PEAK_BAND_END_MINUTE = 22 * 60;

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

  function normalizeLightHexColor(value, fallback = '#fee2e2') {
    const raw = String(value || '').trim();
    const hex = /^#[0-9a-f]{6}$/i.test(raw) ? raw : fallback;
    const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
    const luminance = (channels[0] * 0.299) + (channels[1] * 0.587) + (channels[2] * 0.114);
    if (luminance >= 210) return hex.toLowerCase();
    const mixed = channels.map(channel => Math.round(channel + (255 - channel) * 0.78));
    return `#${mixed.map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
  }

  function coordinate(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function isoNow(now) {
    if (now instanceof Date) return now.toISOString();
    if (typeof now === 'string' && now) return now;
    return new Date().toISOString();
  }

  function normalizeTime(value, fallback = '09:00') {
    const raw = String(value || fallback || '09:00').trim();
    const match = raw.match(/^(\d{1,2})(?::?(\d{2}))?/);
    if (!match) return fallback;
    const hour = Math.min(23, Math.max(0, Math.trunc(asNumber(match[1], 0))));
    const minute = Math.min(59, Math.max(0, Math.trunc(asNumber(match[2] ?? 0, 0))));
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  function timeToMinutes(value, fallback = '09:00') {
    const [hour, minute] = normalizeTime(value, fallback).split(':').map(Number);
    return hour * 60 + minute;
  }

  function formatMinutes(minutes, dayOffset = 0) {
    const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440;
    const hour = Math.floor(normalized / 60);
    const minute = normalized % 60;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}${dayOffset > 0 ? `+${dayOffset}` : ''}`;
  }

  function addHoursToTime(startTime, hours) {
    const start = timeToMinutes(startTime);
    const delta = Math.round(asNumber(hours, 0) * 60);
    const end = start + delta;
    return formatMinutes(end, Math.floor(end / 1440));
  }

  function hoursBetweenTimes(startTime, finishTime) {
    const start = timeToMinutes(startTime);
    let finish = timeToMinutes(finishTime, addHoursToTime(startTime, 1));
    if (finish <= start) finish += 1440;
    return round((finish - start) / 60, 4);
  }

  function buildOperatingWindows(loads) {
    const windows = [];
    const count = Math.max(1, Math.ceil(asNumber(loads.scheduleWorkingHours, loads.operationHoursPerDay)));
    const startMinutes = timeToMinutes(loads.operationStartTime);
    for (let i = 0; i < count; i += 1) {
      const segmentStart = startMinutes + i * 60;
      const segmentEnd = segmentStart + 60;
      const startDay = Math.floor(segmentStart / 1440);
      const endDay = Math.floor(segmentEnd / 1440);
      const hour = Math.floor((((segmentStart % 1440) + 1440) % 1440) / 60);
      windows.push({
        hour,
        hourLabel: `${formatMinutes(segmentStart, startDay)}-${formatMinutes(segmentEnd, endDay)}`,
        flowKey: `schedule-${i}-${hour}`,
        period: 'schedule'
      });
    }
    return windows;
  }

  function normalizeBessRole(value) {
    const raw = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (raw.includes('island') || raw.includes('off_grid') || raw.includes('full')) return 'island_mode';
    if (raw.includes('peak')) return 'peak_shaving';
    if (raw.includes('smooth')) return 'pv_smoothing';
    if (raw.includes('backup')) return 'backup';
    if (raw.includes('diesel') || raw.includes('hybrid') || raw.includes('saving')) return 'diesel_replacement';
    return raw || 'diesel_replacement';
  }

  function normalizeMeasurementMethod(value) {
    const raw = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (raw.includes('energy') || raw.includes('meter')) return 'energy_meter';
    if (raw.includes('equipment') || raw.includes('schedule')) return 'equipment_schedule';
    if (raw.includes('kva') || raw.includes('load_factor')) return 'genset_kva_load_factor';
    return 'diesel_sfc_estimate';
  }

  function normalizeEnergyMeterSummary(value = {}) {
    const input = value && typeof value === 'object' ? value : {};
    return {
      fileName: String(input.fileName || input.name || '').trim(),
      sampleCount: Math.max(0, Math.trunc(asNumber(input.sampleCount ?? input.samples, 0))),
      operatingHours: asNumber(input.operatingHours ?? input.hours, 0),
      dailyLoadKwh: asNumber(input.dailyLoadKwh ?? input.dailyKwh, 0),
      averageLoadKw: asNumber(input.averageLoadKw ?? input.avgLoadKw, 0),
      rawPeakKw: asNumber(input.rawPeakKw ?? input.peakLoadKw, 0),
      smoothedPeakKw: asNumber(input.smoothedPeakKw ?? input.p99PeakKw ?? input.rawPeakKw, 0),
      dataSource: String(input.dataSource || 'Energy Meter').trim(),
      parsedAt: String(input.parsedAt || '')
    };
  }

  function normalizeEquipmentScheduleRow(row = {}, index = 0) {
    const input = row && typeof row === 'object' ? row : {};
    return {
      id: String(input.id || `equipment-${index + 1}`).trim(),
      equipment: String(input.equipment || input.name || `Equipment ${index + 1}`).trim(),
      ratedKw: asNumber(input.ratedKw ?? input.rated_kw, 0),
      quantity: Math.max(1, asNumber(input.quantity, 1)),
      startTime: normalizeTime(input.startTime ?? input.operationStartTime ?? '09:00', '09:00'),
      finishTime: normalizeTime(input.finishTime ?? input.operationFinishTime ?? '17:00', '17:00'),
      dutyCycle: clamp(input.dutyCycle ?? input.duty_cycle, 0, 1, 1),
      simultaneityFactor: clamp(input.simultaneityFactor ?? input.simultaneity_factor, 0, 1, 1)
    };
  }

  function normalizeGensetKvaInput(value = {}) {
    const input = value && typeof value === 'object' ? value : {};
    return {
      gensetKva: asNumber(input.gensetKva ?? input.genset_kva, 0),
      powerFactor: clamp(input.powerFactor ?? input.pf, 0.1, 1, 0.8),
      loadFactor: clamp(input.loadFactor ?? input.load_factor, 0, 1.5, 0.7),
      runtimeHours: clamp(input.runtimeHours ?? input.runtime_hours, 0, 24, 8),
      overloadFactor: clamp(input.overloadFactor ?? input.overload_factor, 0, 1.5, 0.95)
    };
  }

  function normalizeEmsFlowDisplaySettings(value = {}) {
    const input = value && typeof value === 'object' ? value : {};
    const rawSeries = Array.isArray(input.visibleSeries) ? input.visibleSeries : EMS_FLOW_DISPLAY_SERIES;
    const visibleSeries = rawSeries
      .map(item => String(item || '').trim().toLowerCase())
      .filter((item, index, array) => EMS_FLOW_DISPLAY_SERIES.includes(item) && array.indexOf(item) === index);
    const colorInput = input.seriesColors && typeof input.seriesColors === 'object' ? input.seriesColors : {};
    const seriesColors = Object.fromEntries(EMS_FLOW_DISPLAY_SERIES.map(series => {
      const rawColor = String(colorInput[series] || EMS_FLOW_SERIES_DEFAULT_COLORS[series]).trim();
      return [series, /^#[0-9a-f]{6}$/i.test(rawColor) ? rawColor : EMS_FLOW_SERIES_DEFAULT_COLORS[series]];
    }));
    const rangeInput = input.selectedRange && typeof input.selectedRange === 'object' ? input.selectedRange : null;
    const selectedRange = rangeInput
      ? {
          start: Math.max(0, Math.floor(asNumber(rangeInput.start, 0))),
          end: Math.max(0, Math.floor(asNumber(rangeInput.end, 0)))
        }
      : null;
    if (selectedRange && selectedRange.end < selectedRange.start) {
      selectedRange.end = selectedRange.start;
    }
    const peakBandInput = input.peakBand && typeof input.peakBand === 'object' ? input.peakBand : {};
    const peakBandColor = String(peakBandInput.color || '#fee2e2').trim();
    const startMinute = clamp(peakBandInput.startMinute, 0, 24 * 60, EMS_FLOW_DEFAULT_PEAK_BAND_START_MINUTE);
    const endMinute = clamp(peakBandInput.endMinute, 0, 24 * 60, EMS_FLOW_DEFAULT_PEAK_BAND_END_MINUTE);
    const deviceWorkModelInput = input.deviceWorkModel && typeof input.deviceWorkModel === 'object' ? input.deviceWorkModel : {};
    const rawPlatforms = Array.isArray(deviceWorkModelInput.gensetPlatforms) ? deviceWorkModelInput.gensetPlatforms : [0.3, 0.5, 0.75, 1];
    const gensetPlatforms = rawPlatforms
      .map(value => clamp(value, 0.05, 1, 0))
      .filter((value, index, array) => value > 0 && array.indexOf(value) === index)
      .sort((a, b) => a - b);
    return {
      visibleSeries: visibleSeries.length ? visibleSeries : [...EMS_FLOW_DISPLAY_SERIES],
      mergeHourly: input.mergeHourly !== false,
      intervalMinutes: EMS_FLOW_INTERVAL_MINUTES.includes(Number(input.intervalMinutes)) ? Number(input.intervalMinutes) : 5,
      selectedRange,
      peakBand: {
        visible: peakBandInput.visible === false ? false : true,
        color: normalizeLightHexColor(peakBandColor, '#fee2e2'),
        startMinute,
        endMinute: endMinute > startMinute ? endMinute : Math.min(24 * 60, startMinute + 60)
      },
      seriesColors,
      deviceWorkModel: {
        applyToEmsFlow: deviceWorkModelInput.applyToEmsFlow === false ? false : true,
        loadNoisePct: clamp(deviceWorkModelInput.loadNoisePct, 0, 12, 3),
        shockCount: Math.round(clamp(deviceWorkModelInput.shockCount, 0, 4, 2)),
        shockDurationMinutes: clamp(deviceWorkModelInput.shockDurationMinutes, 1, 60, 14),
        shockImpactPct: clamp(deviceWorkModelInput.shockImpactPct, 0, 40, 20),
        gensetStepEnabled: deviceWorkModelInput.gensetStepEnabled === false ? false : true,
        gensetPlatforms: gensetPlatforms.length ? gensetPlatforms : [0.3, 0.5, 0.75, 1]
      }
    };
  }

  function loadSourceForMethod(method, loads = {}) {
    if (method === 'energy_meter') return loads.energyMeterSummary?.dataSource || 'Energy Meter';
    if (method === 'equipment_schedule') return 'Equipment Schedule';
    if (method === 'genset_kva_load_factor') return 'Genset kVA / load factor';
    return 'Diesel / SFC estimate';
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
    const gsaSource = String(input.dataSource || '').toLowerCase().includes('global solar atlas');
    const importedGsaPvout = asNumber(input.gsaPvoutKwhPerKwpDay ?? (gsaSource ? input.specificYieldKwhPerKwpDay : NaN), NaN);
    const specificYield = Number.isFinite(importedYield) && importedYield > 0
      ? importedYield
      : defaults.malaysiaYieldBase;
    const imported = Number.isFinite(importedYield) && importedYield > 0;
    return {
      specificYieldKwhPerKwpDay: specificYield,
      gsaPvoutKwhPerKwpDay: Number.isFinite(importedGsaPvout) && importedGsaPvout > 0 ? importedGsaPvout : 0,
      ghiKwhM2Day: asNumber(input.ghiKwhM2Day, 0),
      dniKwhM2Day: asNumber(input.dniKwhM2Day, 0),
      temperatureC: asNumber(input.temperatureC, 0),
      monthlyYield: Array.isArray(input.monthlyYield) ? input.monthlyYield.map(v => asNumber(v, 0)) : [],
      hourlyPvProfile: Array.isArray(input.hourlyPvProfile)
        ? input.hourlyPvProfile.map(item => {
          const hour = asNumber(item.hour, asNumber(item.timelineMinute, 0) / 60);
          const row = { hour, pvMw: asNumber(item.pvMw, 0) };
          const hasSimulatorFields = item.timestamp
            || item.timelineMinute !== undefined
            || item.intervalMinutes !== undefined
            || item.clearSkyKw !== undefined
            || item.irradianceCf !== undefined
            || item.irradiance_cf !== undefined
            || item.cloudState !== undefined
            || item.cloud_state !== undefined;
          if (hasSimulatorFields || Math.abs(hour - Math.round(hour)) > 0.001) {
            Object.assign(row, {
              timestamp: String(item.timestamp || ''),
              timelineMinute: asNumber(item.timelineMinute, hour * 60),
              intervalMinutes: asNumber(item.intervalMinutes, 0),
              clearSkyKw: asNumber(item.clearSkyKw, 0),
              irradianceCf: asNumber(item.irradianceCf ?? item.irradiance_cf, 0),
              cloudState: asNumber(item.cloudState ?? item.cloud_state, 0),
              temperatureFactor: asNumber(item.temperatureFactor ?? item.temperature_factor, 0),
              soilingFactor: asNumber(item.soilingFactor ?? item.soiling_factor, 0),
              inverterLimitActive: Boolean(item.inverterLimitActive ?? item.inverter_limit_active),
              curtailmentActive: Boolean(item.curtailmentActive ?? item.curtailment_active),
              clippingLossKw: asNumber(item.clippingLossKw ?? item.clipping_loss_kw, 0)
            });
          }
          return row;
        })
        : [],
      pvSimulator: input.pvSimulator && typeof input.pvSimulator === 'object' ? {
        ...input.pvSimulator,
        settings: { ...(input.pvSimulator.settings || {}) },
        summary: { ...(input.pvSimulator.summary || {}) }
      } : null,
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
    const assumptions = raw.assumptions || {};
    const solarResource = defaultSolarResource(raw.solarResource || {}, defaults);
    const id = String(raw.id || project.id || `epc-${Date.parse(now) || Date.now()}`).trim();
    const measurementMethod = normalizeMeasurementMethod(loads.measurementMethod ?? raw.measurementMethod);
    const energyMeterSummary = normalizeEnergyMeterSummary(loads.energyMeterSummary || raw.energyMeterSummary || {});
    const equipmentSchedule = (Array.isArray(loads.equipmentSchedule) ? loads.equipmentSchedule : Array.isArray(raw.equipmentSchedule) ? raw.equipmentSchedule : [])
      .map((row, index) => normalizeEquipmentScheduleRow(row, index))
      .filter(row => row.ratedKw > 0);
    const equipmentScheduleOperatingHours = clamp(loads.equipmentScheduleOperatingHours ?? raw.equipmentScheduleOperatingHours, 0, 24, 0);
    const equipmentScheduleDutyCycle = clamp(loads.equipmentScheduleDutyCycle ?? raw.equipmentScheduleDutyCycle, 0, 1, 1);
    const equipmentScheduleSimultaneityFactor = clamp(loads.equipmentScheduleSimultaneityFactor ?? raw.equipmentScheduleSimultaneityFactor, 0, 1, 1);
    const gensetKvaInput = normalizeGensetKvaInput(loads.gensetKvaInput || raw.gensetKvaInput || {});
    const dayHours = clamp(loads.operationHoursPerDay ?? raw.operationHoursPerDay, 1, 24, 8);
    const operationStartTime = normalizeTime(loads.operationStartTime ?? raw.operationStartTime, '09:00');
    const operationFinishTime = normalizeTime(loads.operationFinishTime ?? raw.operationFinishTime, addHoursToTime(operationStartTime, dayHours));
    const scheduleWorkingHours = Math.min(24, Math.max(1, hoursBetweenTimes(operationStartTime, operationFinishTime)));
    const normalizedAssumptions = { ...defaults, ...assumptions };
    const hasLegacySocDefaults = asNumber(assumptions.minSocPct, defaults.minSocPct) === 25
      && asNumber(assumptions.bessDod, defaults.bessDod) === 0.85;
    if (hasLegacySocDefaults) {
      normalizedAssumptions.minSocPct = EPC_DESIGN_DEFAULTS.minSocPct;
      normalizedAssumptions.bessDod = EPC_DESIGN_DEFAULTS.bessDod;
    }

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
      loadProfile: Array.isArray(raw.loadProfile) ? raw.loadProfile : Array.isArray(raw.load_profile) ? raw.load_profile : [],
      loads: {
        measurementMethod,
        dieselTotalLiters: asNumber(loads.dieselTotalLiters ?? raw.dieselTotalLiters, 0),
        dieselPeriodDays: Math.max(1, asNumber(loads.dieselPeriodDays ?? raw.dieselPeriodDays, 1)),
        dieselPricePerLiter: asNumber(loads.dieselPricePerLiter ?? raw.dieselPricePerLiter, 0),
        operationHoursPerDay: dayHours,
        operationStartTime,
        operationFinishTime,
        scheduleWorkingHours,
        changeWorkingTime: Boolean(loads.changeWorkingTime ?? raw.changeWorkingTime),
        measuredDailyLoadKwh: asNumber(loads.measuredDailyLoadKwh, 0),
        peakLoadKw: asNumber(loads.peakLoadKw ?? raw.peakLoadKw, 0),
        peakLoadSafetyFactor: asNumber(loads.peakLoadSafetyFactor ?? raw.peakLoadSafetyFactor ?? assumptions.peakLoadFactor, defaults.peakLoadFactor),
        criticalLoadKw: asNumber(loads.criticalLoadKw ?? raw.criticalLoadKw, 0),
        allowedGensetLoadKw: asNumber(loads.allowedGensetLoadKw ?? raw.allowedGensetLoadKw, 0),
        equipmentType: String(loads.equipmentType || raw.equipmentType || 'water_pump').trim(),
        energyMeterSummary,
        equipmentSchedule,
        equipmentScheduleOperatingHours,
        equipmentScheduleDutyCycle,
        equipmentScheduleSimultaneityFactor,
        useEquipmentScheduleForEmsFlow: measurementMethod === 'equipment_schedule'
          ? Boolean(loads.useEquipmentScheduleForEmsFlow ?? raw.useEquipmentScheduleForEmsFlow ?? true)
          : Boolean(loads.useEquipmentScheduleForEmsFlow ?? raw.useEquipmentScheduleForEmsFlow),
        gensetKvaInput,
        loadSource: String(loadSourceForMethod(measurementMethod, { energyMeterSummary }) || 'Diesel / SFC estimate').trim()
      },
      solarResource,
      designTargets: {
        replacementPct: clamp(designTargets.replacementPct ?? raw.targetReplacementPct, 0, 100, 80),
        bessRole: normalizeBessRole(designTargets.bessRole || raw.bessRole || 'diesel_replacement'),
        supportHours: asNumber(designTargets.supportHours ?? raw.supportHours, defaults.bessAutonomyHours),
        roundUpSizing: Boolean(designTargets.roundUpSizing ?? raw.roundUpSizing)
      },
      electrical: {
        voltageKv: asNumber(electrical.voltageKv, defaults.lvVoltageKv),
        powerFactor: clamp(electrical.powerFactor, 0.1, 1, defaults.powerFactor),
        distanceToInterconnectionM: asNumber(electrical.distanceToInterconnectionM ?? site.distanceToInterconnectionM, 0),
        existingMvVoltageKv: asNumber(electrical.existingMvVoltageKv, 0),
        newMvSystem: Boolean(electrical.newMvSystem)
      },
      assumptions: normalizedAssumptions,
      calculationAssumptions: {
        ...defaults,
        ...(raw.calculationAssumptions || {})
      },
      documents: raw.documents && typeof raw.documents === 'object' ? raw.documents : {},
      emsFlowDisplaySettings: normalizeEmsFlowDisplaySettings(raw.emsFlowDisplaySettings || {}),
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
        operationHoursPerDay: inputs.operationHoursPerDay,
        operationStartTime: inputs.operationStartTime,
        operationFinishTime: inputs.operationFinishTime,
        changeWorkingTime: inputs.changeWorkingTime,
        peakLoadSafetyFactor: inputs.peakLoadSafetyFactor,
        equipmentType: inputs.equipmentType
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
    if (project.loads.measurementMethod === 'energy_meter' && project.loads.energyMeterSummary.dailyLoadKwh > 0) score += 30;
    else if (project.loads.measurementMethod === 'equipment_schedule' && project.loads.equipmentSchedule.length) score += 24;
    else if (project.loads.measurementMethod === 'genset_kva_load_factor' && project.loads.gensetKvaInput.gensetKva > 0) score += 20;
    else if (project.loads.measuredDailyLoadKwh > 0) score += 30;
    else if (project.loads.dieselTotalLiters > 0 && project.loads.dieselPeriodDays > 0) score += 22;
    if (project.solarResource.dataSource !== 'Malaysia Default') score += 22;
    else score += 10;
    if (project.site.availableAreaM2 > 0) score += 15;
    if (project.gensets.length) score += 10;
    if (project.electrical.distanceToInterconnectionM > 0) score += 5;
    return Math.min(100, score);
  }

  function decorateLoadResult(project, load, trace) {
    const dailyDieselLiters = project.loads.dieselTotalLiters / Math.max(1, project.loads.dieselPeriodDays);
    const averageLoadKw = asNumber(load.averageLoadKw, 0);
    return {
      dailyDieselLiters,
      monthlyDieselLiters: dailyDieselLiters * 30,
      annualDieselLiters: dailyDieselLiters * 365,
      monthlyDieselCost: dailyDieselLiters * 30 * project.loads.dieselPricePerLiter,
      criticalLoadKw: project.loads.criticalLoadKw > 0 ? project.loads.criticalLoadKw : averageLoadKw,
      measurementMethod: project.loads.measurementMethod,
      loadSource: load.loadSource || project.loads.loadSource,
      ...load,
      trace
    };
  }

  function calculateDieselSfcLoad(project, now) {
    const sfc = asNumber(project.assumptions.dieselSfcLPerKwh, EPC_DESIGN_DEFAULTS.dieselSfcLPerKwh);
    const dailyDieselLiters = project.loads.dieselTotalLiters / Math.max(1, project.loads.dieselPeriodDays);
    const gensetDailyLoadKwh = project.loads.measuredDailyLoadKwh > 0
      ? project.loads.measuredDailyLoadKwh
      : dailyDieselLiters / Math.max(0.001, sfc);
    const averageLoadKw = gensetDailyLoadKwh / Math.max(1, project.loads.operationHoursPerDay);
    const dailyLoadKwh = project.loads.changeWorkingTime
      ? averageLoadKw * project.loads.scheduleWorkingHours
      : gensetDailyLoadKwh;
    const peakLoadSafetyFactor = Math.max(0.01, asNumber(project.loads.peakLoadSafetyFactor, project.assumptions.peakLoadFactor));
    const peakLoadKw = averageLoadKw * peakLoadSafetyFactor;
    const criticalLoadKw = project.loads.criticalLoadKw > 0 ? project.loads.criticalLoadKw : averageLoadKw;
    return decorateLoadResult(project, {
      dailyDieselLiters,
      dailyLoadKwh,
      averageLoadKw,
      peakLoadKw,
      criticalLoadKw,
      loadSource: project.loads.loadSource
    }, [
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
          formula: project.loads.changeWorkingTime ? 'Original Genset Avg Load x PV Working Hours' : project.loads.measuredDailyLoadKwh > 0 ? 'Measured Daily Load' : 'Daily Diesel / SFC',
          inputs: project.loads.changeWorkingTime
            ? { originalGensetAverageLoadKw: round(averageLoadKw, 4), scheduleWorkingHours: project.loads.scheduleWorkingHours }
            : { dailyDieselLiters: round(dailyDieselLiters, 4), sfcLPerKwh: sfc },
          result: round(dailyLoadKwh, 4),
          unit: 'kWh/day',
          assumptionSource: project.loads.loadSource,
          now
        }),
        buildFormulaTrace({
          key: 'averageLoadKw',
          label: 'Average Load',
          formula: 'Original Genset Daily Load / Original Genset Hours',
          inputs: { gensetDailyLoadKwh: round(gensetDailyLoadKwh, 4), operationHoursPerDay: project.loads.operationHoursPerDay, scheduleWorkingHours: project.loads.scheduleWorkingHours, changeWorkingTime: project.loads.changeWorkingTime },
          result: round(averageLoadKw, 4),
          unit: 'kW',
          assumptionSource: project.loads.loadSource,
          now
        }),
        buildFormulaTrace({
          key: 'peakLoadKw',
          label: 'Peak Load',
          formula: 'Average Load x Selected Peak Safety Factor',
          inputs: { averageLoadKw: round(averageLoadKw, 4), peakLoadSafetyFactor },
          result: round(peakLoadKw, 4),
          unit: 'kW',
          assumptionSource: 'User Input',
          now
        }),
        buildFormulaTrace({
          key: 'criticalLoadKw',
          label: 'Critical Load',
          formula: project.loads.criticalLoadKw > 0 ? 'Manual Critical Load' : 'Average Load fallback',
          inputs: project.loads.criticalLoadKw > 0
            ? { manualCriticalLoadKw: project.loads.criticalLoadKw }
            : { averageLoadKw: round(averageLoadKw, 4) },
          result: round(criticalLoadKw, 4),
          unit: 'kW',
          assumptionSource: project.loads.criticalLoadKw > 0 ? 'User Input' : 'Default',
          now
        })
      ]);
  }

  function calculateEnergyMeterLoad(project, now) {
    const summary = project.loads.energyMeterSummary || {};
    const dailyLoadKwh = asNumber(summary.dailyLoadKwh, 0);
    const operatingHours = Math.max(1, asNumber(summary.operatingHours || project.loads.operationHoursPerDay, project.loads.operationHoursPerDay || 24));
    const averageLoadKw = asNumber(summary.averageLoadKw, 0) > 0 ? asNumber(summary.averageLoadKw, 0) : dailyLoadKwh / operatingHours;
    const rawPeakLoadKw = asNumber(summary.rawPeakKw, 0);
    const peakLoadKw = asNumber(summary.smoothedPeakKw, 0) > 0 ? asNumber(summary.smoothedPeakKw, 0) : rawPeakLoadKw;
    return decorateLoadResult(project, {
      dailyLoadKwh,
      averageLoadKw,
      peakLoadKw,
      rawPeakLoadKw,
      operatingHours,
      loadSource: summary.dataSource || 'Energy Meter'
    }, [
      buildFormulaTrace({
        key: 'dailyLoadKwh',
        label: 'Daily Load',
        formula: 'Energy Meter Parsed Daily kWh',
        inputs: { fileName: summary.fileName, sampleCount: summary.sampleCount },
        result: round(dailyLoadKwh, 4),
        unit: 'kWh/day',
        assumptionSource: summary.dataSource || 'Energy Meter',
        now
      }),
      buildFormulaTrace({
        key: 'averageLoadKw',
        label: 'Average Load',
        formula: 'Energy Meter Daily kWh / Operating Hours',
        inputs: { dailyLoadKwh: round(dailyLoadKwh, 4), operatingHours },
        result: round(averageLoadKw, 4),
        unit: 'kW',
        assumptionSource: summary.dataSource || 'Energy Meter',
        now
      }),
      buildFormulaTrace({
        key: 'peakLoadKw',
        label: 'Peak Load',
        formula: 'Energy Meter p99 / Smoothed Peak',
        inputs: { rawPeakKw: rawPeakLoadKw, smoothedPeakKw: peakLoadKw },
        result: round(peakLoadKw, 4),
        unit: 'kW',
        assumptionSource: summary.dataSource || 'Energy Meter',
        now
      })
    ]);
  }

  function calculateEquipmentScheduleLoad(project, now) {
    const stepMinutes = 15;
    const intervalLoads = new Map();
    const dutyCycle = project.loads.equipmentScheduleDutyCycle;
    const simultaneityFactor = project.loads.equipmentScheduleSimultaneityFactor;
    for (const row of project.loads.equipmentSchedule || []) {
      const start = timeToMinutes(row.startTime);
      let finish = timeToMinutes(row.finishTime, row.startTime);
      if (finish <= start) finish += 1440;
      const kw = row.ratedKw * row.quantity * dutyCycle * simultaneityFactor;
      for (let minute = start; minute < finish; minute += stepMinutes) {
        const key = Math.floor(minute / stepMinutes);
        intervalLoads.set(key, (intervalLoads.get(key) || 0) + kw);
      }
    }
    const intervalHours = stepMinutes / 60;
    const intervalValues = [...intervalLoads.values()];
    const dailyLoadKwh = intervalValues.reduce((sum, kw) => sum + kw * intervalHours, 0);
    const activeOperatingHours = intervalValues.length * intervalHours;
    const operatingHours = project.loads.equipmentScheduleOperatingHours > 0
      ? project.loads.equipmentScheduleOperatingHours
      : activeOperatingHours;
    const averageLoadKw = operatingHours > 0 ? dailyLoadKwh / operatingHours : 0;
    const peakLoadKw = intervalValues.reduce((max, kw) => Math.max(max, kw), 0);
    return decorateLoadResult(project, {
      dailyLoadKwh: round(dailyLoadKwh, 4),
      averageLoadKw: round(averageLoadKw, 4),
      peakLoadKw: round(peakLoadKw, 4),
      operatingHours: round(operatingHours, 4),
      loadSource: 'Equipment Schedule'
    }, [
      buildFormulaTrace({
        key: 'dailyLoadKwh',
        label: 'Daily Load',
        formula: 'Σ 15-min Operating Load',
        inputs: { equipmentCount: project.loads.equipmentSchedule.length, intervalMinutes: stepMinutes, dutyCycle, simultaneityFactor },
        result: round(dailyLoadKwh, 4),
        unit: 'kWh/day',
        assumptionSource: 'Equipment Schedule',
        now
      }),
      buildFormulaTrace({
        key: 'averageLoadKw',
        label: 'Average Load',
        formula: 'Equipment Schedule Daily kWh / Design Operating Hours',
        inputs: { dailyLoadKwh: round(dailyLoadKwh, 4), operatingHours: round(operatingHours, 4), activeOperatingHours: round(activeOperatingHours, 4) },
        result: round(averageLoadKw, 4),
        unit: 'kW',
        assumptionSource: 'Equipment Schedule',
        now
      }),
      buildFormulaTrace({
        key: 'peakLoadKw',
        label: 'Peak Load',
        formula: 'Max 15-min overlapping operating load',
        inputs: { equipmentCount: project.loads.equipmentSchedule.length, intervalMinutes: stepMinutes },
        result: round(peakLoadKw, 4),
        unit: 'kW',
        assumptionSource: 'Equipment Schedule',
        now
      })
    ]);
  }

  function calculateGensetKvaLoad(project, now) {
    const input = project.loads.gensetKvaInput || {};
    const ratedKw = input.gensetKva * input.powerFactor;
    const averageLoadKw = ratedKw * input.loadFactor;
    const dailyLoadKwh = averageLoadKw * input.runtimeHours;
    const peakLoadKw = ratedKw * input.overloadFactor;
    return decorateLoadResult(project, {
      ratedKw: round(ratedKw, 4),
      dailyLoadKwh: round(dailyLoadKwh, 4),
      averageLoadKw: round(averageLoadKw, 4),
      peakLoadKw: round(peakLoadKw, 4),
      operatingHours: input.runtimeHours,
      loadSource: 'Genset kVA / load factor'
    }, [
      buildFormulaTrace({
        key: 'averageLoadKw',
        label: 'Average Load',
        formula: 'Genset kVA x PF x Load Factor',
        inputs: { gensetKva: input.gensetKva, powerFactor: input.powerFactor, loadFactor: input.loadFactor },
        result: round(averageLoadKw, 4),
        unit: 'kW',
        assumptionSource: 'Genset kVA / load factor',
        now
      }),
      buildFormulaTrace({
        key: 'dailyLoadKwh',
        label: 'Daily Load',
        formula: 'Genset Average Load x Runtime Hours',
        inputs: { averageLoadKw: round(averageLoadKw, 4), runtimeHours: input.runtimeHours },
        result: round(dailyLoadKwh, 4),
        unit: 'kWh/day',
        assumptionSource: 'Genset kVA / load factor',
        now
      }),
      buildFormulaTrace({
        key: 'peakLoadKw',
        label: 'Peak Load',
        formula: 'Genset Rated kW x Overload Factor',
        inputs: { ratedKw: round(ratedKw, 4), overloadFactor: input.overloadFactor },
        result: round(peakLoadKw, 4),
        unit: 'kW',
        assumptionSource: 'Genset kVA / load factor',
        now
      })
    ]);
  }

  function calculateLoad(project, now) {
    if (project.loads.measurementMethod === 'energy_meter') return calculateEnergyMeterLoad(project, now);
    if (project.loads.measurementMethod === 'equipment_schedule') return calculateEquipmentScheduleLoad(project, now);
    if (project.loads.measurementMethod === 'genset_kva_load_factor') return calculateGensetKvaLoad(project, now);
    return calculateDieselSfcLoad(project, now);
  }

  function roundUpStep(value, step) {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.ceil(value / step) * step;
  }

  function calculateBessPcsByRole(project, load, pvRecommendedMwp) {
    const role = normalizeBessRole(project.designTargets.bessRole);
    const supportHours = Math.max(0.1, asNumber(project.designTargets.supportHours, project.assumptions.bessAutonomyHours));
    const dod = asNumber(project.assumptions.bessDod, EPC_DESIGN_DEFAULTS.bessDod);
    const efficiency = asNumber(project.assumptions.bessDischargeEfficiency, EPC_DESIGN_DEFAULTS.bessDischargeEfficiency);
    const pcsSafetyFactor = asNumber(project.assumptions.pcsSafetyFactor, EPC_DESIGN_DEFAULTS.pcsSafetyFactor);
    const islandSafetyFactor = asNumber(project.assumptions.islandPcsSafetyFactor, EPC_DESIGN_DEFAULTS.islandPcsSafetyFactor);
    const smoothingRatio = asNumber(project.assumptions.pvSmoothingPcsRatio, EPC_DESIGN_DEFAULTS.pvSmoothingPcsRatio);
    let supportedLoadKw = load.averageLoadKw;
    let pcsRawKw = load.averageLoadKw * pcsSafetyFactor;
    let pcsBasis = 'Average load hybrid support';

    if (role === 'diesel_replacement') {
      pcsRawKw = load.peakLoadKw;
      pcsBasis = 'Peak load factor hybrid support';
    } else if (role === 'pv_smoothing') {
      supportedLoadKw = pvRecommendedMwp * 1000 * smoothingRatio;
      pcsRawKw = supportedLoadKw;
      pcsBasis = 'PV fluctuation portion';
    } else if (role === 'peak_shaving') {
      supportedLoadKw = Math.max(0, load.peakLoadKw - asNumber(project.loads.allowedGensetLoadKw, 0));
      pcsRawKw = supportedLoadKw;
      pcsBasis = 'Peak load minus allowed genset load';
    } else if (role === 'backup') {
      supportedLoadKw = load.criticalLoadKw;
      pcsRawKw = supportedLoadKw * islandSafetyFactor;
      pcsBasis = 'Critical load backup with safety factor';
    } else if (role === 'island_mode') {
      supportedLoadKw = load.peakLoadKw;
      pcsRawKw = load.peakLoadKw * islandSafetyFactor;
      pcsBasis = 'Total peak load with island safety factor';
    }

    const bessRecommendedMwh = (supportedLoadKw * supportHours) / Math.max(0.001, dod * efficiency) / 1000;
    const pcsRecommendedMw = roundUpStep(pcsRawKw / 1000, 0.5);
    const batteryKwh = Math.max(0.001, bessRecommendedMwh * 1000);
    const pcsKw = pcsRecommendedMw * 1000;
    const cRate = pcsKw / batteryKwh;
    return {
      bessRole: role,
      pcsBasis,
      supportedLoadKw,
      supportHours,
      bessRecommendedMwh,
      pcsRecommendedMw,
      cRate,
      equivalentDurationHours: batteryKwh / Math.max(0.001, pcsKw),
      usableDurationAtSupportedLoadHours: (batteryKwh * dod * efficiency) / Math.max(0.001, supportedLoadKw)
    };
  }

  function calculateScheme(project, load, target, now) {
    const yieldKwh = Math.max(0.001, asNumber(project.solarResource.specificYieldKwhPerKwpDay, EPC_DESIGN_DEFAULTS.malaysiaYieldBase));
    const margin = asNumber(project.assumptions.pvSizingMargin, EPC_DESIGN_DEFAULTS.pvSizingMargin);
    const targetDailyKwh = load.dailyLoadKwh * (target.replacementPct / 100);
    const pvRawKwp = targetDailyKwh / yieldKwh;
    const pvRawRecommendedMwp = (pvRawKwp * margin) / 1000;
    const roundUpSizing = Boolean(project.designTargets.roundUpSizing);
    const pvRecommendedMwp = roundUpSizing ? roundUpStep(pvRawRecommendedMwp, 0.5) : pvRawRecommendedMwp;
    const rawBessPcs = calculateBessPcsByRole(project, load, pvRecommendedMwp);
    const bessRecommendedMwh = roundUpSizing ? roundUpStep(rawBessPcs.bessRecommendedMwh, 0.5) : rawBessPcs.bessRecommendedMwh;
    const pcsRecommendedMw = roundUpSizing ? roundUpStep(rawBessPcs.pcsRecommendedMw, 0.5) : rawBessPcs.pcsRecommendedMw;
    const batteryKwh = Math.max(0.001, bessRecommendedMwh * 1000);
    const pcsKw = pcsRecommendedMw * 1000;
    const bessPcs = {
      ...rawBessPcs,
      bessRecommendedMwh,
      pcsRecommendedMw,
      cRate: pcsKw / batteryKwh,
      equivalentDurationHours: batteryKwh / Math.max(0.001, pcsKw),
      usableDurationAtSupportedLoadHours: (batteryKwh * asNumber(project.assumptions.bessDod, EPC_DESIGN_DEFAULTS.bessDod) * asNumber(project.assumptions.bessDischargeEfficiency, EPC_DESIGN_DEFAULTS.bessDischargeEfficiency)) / Math.max(0.001, rawBessPcs.supportedLoadKw)
    };
    const requiredAreaM2 = pvRecommendedMwp * asNumber(project.assumptions.groundPvAreaM2PerMwp, EPC_DESIGN_DEFAULTS.groundPvAreaM2PerMwp);
    const monthlyDieselSavedLiters = load.dailyDieselLiters * (target.replacementPct / 100) * 30;
    const monthlySavings = monthlyDieselSavedLiters * project.loads.dieselPricePerLiter;

    return {
      ...target,
      ...bessPcs,
      targetDailyKwh,
      pvRawKwp,
      pvRecommendedMwp,
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
        }),
        ...(roundUpSizing ? [buildFormulaTrace({
          key: `${target.id}.roundUpSizing`,
          label: `${target.label} Round Up Sizing`,
          formula: 'Ceil PV / BESS / PCS to engineering step',
          inputs: {
            pvRawRecommendedMwp: round(pvRawRecommendedMwp, 4),
            bessRawRecommendedMwh: round(rawBessPcs.bessRecommendedMwh, 4),
            pcsRawRecommendedMw: round(rawBessPcs.pcsRecommendedMw, 4),
            pvRoundedMwp: round(pvRecommendedMwp, 4),
            bessRoundedMwh: round(bessRecommendedMwh, 4),
            pcsRoundedMw: round(pcsRecommendedMw, 4),
            roundUpStep: 0.5
          },
          result: round(pvRecommendedMwp, 4),
          unit: 'MWp',
          assumptionSource: 'User Input',
          now
        })] : [])
      ]
    };
  }

  function pickRecommendedScheme(schemes = [], replacementPct = 80) {
    if (!schemes.length) return {};
    const targetPct = asNumber(replacementPct, 80);
    return schemes.find(scheme => Number(scheme.replacementPct) === targetPct)
      || schemes.reduce((best, scheme) => {
        const bestDistance = Math.abs(asNumber(best.replacementPct, 0) - targetPct);
        const distance = Math.abs(asNumber(scheme.replacementPct, 0) - targetPct);
        return distance < bestDistance ? scheme : best;
      }, schemes[0]);
  }

  function getSchemeTargetsForProject(project) {
    const targetPct = round(clamp(project.designTargets.replacementPct, 0, 100, 80), 4);
    const hasPreset = SCHEME_TARGETS.some(target => Number(target.replacementPct) === targetPct);
    if (project.mode !== 'detailed' || hasPreset) return SCHEME_TARGETS;
    return [
      ...SCHEME_TARGETS,
      {
        id: 'replace-target',
        label: `${round(targetPct, 2)}% Target Replacement`,
        replacementPct: targetPct,
        priority: 'Target'
      }
    ];
  }

  function calculateCurrentA(powerKw, voltageKv, pf) {
    return powerKw > 0 && voltageKv > 0 && pf > 0
      ? powerKw / (Math.sqrt(3) * voltageKv * pf)
      : 0;
  }

  function calculateElectrical(project, recommended) {
    const pf = asNumber(project.electrical.powerFactor, EPC_DESIGN_DEFAULTS.powerFactor);
    const voltageKv = asNumber(project.electrical.voltageKv, EPC_DESIGN_DEFAULTS.lvVoltageKv);
    const roundedPvMwp = roundUpStep(recommended?.pvRecommendedMwp || 0, 0.5);
    const designKw = Math.max(roundedPvMwp * 1000, (recommended?.pcsRecommendedMw || 0) * 1000);
    const lvCurrentA = calculateCurrentA(designKw, voltageKv, pf);
    const distance = Math.max(project.site.distanceToInterconnectionM || 0, project.electrical.distanceToInterconnectionM || 0);
    const voltageOptions = [0.415, 6.6, 11].map(optionVoltage => ({
      voltageKv: optionVoltage,
      currentA: calculateCurrentA(designKw, optionVoltage, pf)
    }));
    const flags = [];
    if (pf < 0.9) flags.push('PF below 0.90: current, voltage drop and transformer/cable sizing increase; evaluate SVG/capacitor bank/VFD.');
    if (lvCurrentA > asNumber(project.assumptions.lvHighCurrentWarningA, EPC_DESIGN_DEFAULTS.lvHighCurrentWarningA)) flags.push('High 415V current: avoid one large LV busbar without detailed study.');
    if (designKw > 500 && distance > asNumber(project.assumptions.mvDistanceWarningM, EPC_DESIGN_DEFAULTS.mvDistanceWarningM)) flags.push('Evaluate MV: load above 500kW and distance above 200m.');
    if (designKw > 500 && distance > asNumber(project.assumptions.mvTriggerDistanceM, EPC_DESIGN_DEFAULTS.mvTriggerDistanceM)) flags.push('Strong MV recommendation: load above 500kW and distance above 500m.');
    const mvRecommended = lvCurrentA > asNumber(project.assumptions.lvHighCurrentWarningA, EPC_DESIGN_DEFAULTS.lvHighCurrentWarningA)
      || roundedPvMwp >= asNumber(project.assumptions.mvTriggerMwp, EPC_DESIGN_DEFAULTS.mvTriggerMwp)
      || (designKw > 500 && distance > asNumber(project.assumptions.mvDistanceWarningM, EPC_DESIGN_DEFAULTS.mvDistanceWarningM));
    let architecture = '415V Centralized';
    if (designKw < 300 && distance < 100) architecture = '415V Direct';
    else if (designKw <= 1000 && distance < 200) architecture = 'Distributed 415V';
    else if (mvRecommended && asNumber(project.electrical.existingMvVoltageKv, 0) === 6.6) architecture = '6.6kV Existing MV Integration';
    else if (mvRecommended) architecture = '11kV Ring Main / MV Transformer';
    return {
      designKw,
      roundedPvMwp,
      lvCurrentA,
      voltageOptions,
      flags,
      mvRecommended,
      architecture,
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
    if (project.loads.measurementMethod !== 'energy_meter') {
      risks.push({ level: 'High', area: 'Load', issue: 'Sizing is not based on measured meter data; measured load curve is required before guarantee.' });
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

  function defaultHourlyLoadProfile(project, load) {
    return buildOperatingWindows(project.loads).map(window => ({
      ...window,
      loadKw: load.averageLoadKw
    }));
  }

  function equipmentScheduleHourlyLoadProfile(project) {
    if (project.loads.measurementMethod !== 'equipment_schedule' || !project.loads.useEquipmentScheduleForEmsFlow) return [];
    const stepMinutes = 15;
    const intervalHours = stepMinutes / 60;
    const hourlyKwh = new Map();
    const dutyCycle = project.loads.equipmentScheduleDutyCycle;
    const simultaneityFactor = project.loads.equipmentScheduleSimultaneityFactor;
    for (const row of project.loads.equipmentSchedule || []) {
      const start = timeToMinutes(row.startTime);
      let finish = timeToMinutes(row.finishTime, row.startTime);
      if (finish <= start) finish += 1440;
      const kw = row.ratedKw * row.quantity * dutyCycle * simultaneityFactor;
      for (let minute = start; minute < finish; minute += stepMinutes) {
        const hour = Math.floor((((minute % 1440) + 1440) % 1440) / 60);
        hourlyKwh.set(hour, (hourlyKwh.get(hour) || 0) + kw * intervalHours);
      }
    }
    return [...hourlyKwh.entries()]
      .sort(([hourA], [hourB]) => hourA - hourB)
      .map(([hour, kwh]) => ({
        hour,
        hourLabel: `${formatMinutes(hour * 60)}-${formatMinutes(hour * 60 + 60, hour >= 23 ? 1 : 0)}`,
        flowKey: `equipment-schedule-${hour}`,
        loadKw: round(kwh, 2)
      }))
      .filter(item => item.loadKw > 0);
  }

  function defaultHourlyPvProfile(recommended) {
    const factors = {
      9: 0.18,
      10: 0.42,
      11: 0.68,
      12: 0.9,
      13: 0.88,
      14: 0.72,
      15: 0.52,
      16: 0.28,
      17: 0.08
    };
    return Object.entries(factors).map(([hour, factor]) => ({
      hour: Number(hour),
      pvMw: (recommended.pvRecommendedMwp || 0) * factor
    }));
  }

  function normalizeHourMap(profile, valueKey) {
    const map = new Map();
    for (const item of Array.isArray(profile) ? profile : []) {
      const hour = Math.round(asNumber(item.hour, NaN));
      if (!Number.isFinite(hour)) continue;
      map.set(hour, asNumber(item[valueKey], 0));
    }
    return map;
  }

  function normalizeExactHourMap(profile, valueKey) {
    const map = new Map();
    for (const item of Array.isArray(profile) ? profile : []) {
      const hour = asNumber(item.hour, asNumber(item.timelineMinute, NaN) / 60);
      if (!Number.isFinite(hour)) continue;
      map.set(hour.toFixed(4), asNumber(item[valueKey], 0));
    }
    return map;
  }

  function isDensePvProfile(profile) {
    return (Array.isArray(profile) ? profile : []).some(item => {
      const hour = asNumber(item.hour, NaN);
      const intervalMinutes = asNumber(item.intervalMinutes, 0);
      return intervalMinutes > 0
        || Number.isFinite(asNumber(item.timelineMinute, NaN))
        || (Number.isFinite(hour) && Math.abs(hour - Math.round(hour)) > 0.001);
    });
  }

  function inferProfileIntervalMinutes(profile, index) {
    const item = profile[index] || {};
    const explicit = asNumber(item.intervalMinutes, 0);
    if (explicit > 0) return explicit;
    const current = asNumber(item.timelineMinute, asNumber(item.hour, 0) * 60);
    const next = profile[index + 1];
    const nextMinute = next ? asNumber(next.timelineMinute, asNumber(next.hour, NaN) * 60) : NaN;
    if (Number.isFinite(current) && Number.isFinite(nextMinute) && nextMinute > current) {
      return nextMinute - current;
    }
    return 60;
  }

  function calculateEnergyFlow(project, load, recommended) {
    const scheduleLoadProfile = equipmentScheduleHourlyLoadProfile(project);
    const loadProfile = scheduleLoadProfile.length ? scheduleLoadProfile : project.loadProfile.length ? project.loadProfile : defaultHourlyLoadProfile(project, load);
    const pvProfile = Array.isArray(project.solarResource.hourlyPvProfile) && project.solarResource.hourlyPvProfile.length
      ? project.solarResource.hourlyPvProfile
      : defaultHourlyPvProfile(recommended);
    const loadMap = normalizeHourMap(loadProfile, 'loadKw');
    const exactLoadMap = normalizeExactHourMap(loadProfile, 'loadKw');
    const pvMap = normalizeHourMap(pvProfile, 'pvMw');
    const exactPvMap = normalizeExactHourMap(pvProfile, 'pvMw');
    const densePvProfile = isDensePvProfile(pvProfile);
    const flowSource = densePvProfile ? pvProfile : loadProfile;
    const flowWindows = flowSource.map((item, index) => {
      if (densePvProfile) {
        const hour = asNumber(item.hour, asNumber(item.timelineMinute, NaN) / 60);
        const timelineMinute = asNumber(item.timelineMinute, hour * 60);
        const intervalMinutes = inferProfileIntervalMinutes(pvProfile, index);
        return {
          hour,
          hourLabel: item.hourLabel || `${formatMinutes(timelineMinute)}-${formatMinutes(timelineMinute + intervalMinutes, timelineMinute + intervalMinutes >= 1440 ? 1 : 0)}`,
          flowKey: item.flowKey || `pv-simulator-${index}-${Math.round(timelineMinute)}`,
          timelineMinute,
          intervalMinutes,
          durationHours: intervalMinutes / 60,
          pvMw: asNumber(item.pvMw, 0)
        };
      }
      const hour = Math.round(asNumber(item.hour, NaN));
      return {
        hour,
        hourLabel: item.hourLabel || `${formatMinutes(hour * 60)}-${formatMinutes(hour * 60 + 60, hour >= 23 ? 1 : 0)}`,
        flowKey: item.flowKey || `load-${index}-${hour}`,
        durationHours: 1
      };
    }).filter(item => Number.isFinite(item.hour) && (!densePvProfile || item.intervalMinutes > 0));
    const batteryKwh = Math.max(0, recommended.bessRecommendedMwh * 1000);
    const pcsKw = Math.max(0, recommended.pcsRecommendedMw * 1000);
    const minSocPct = clamp(project.assumptions.minSocPct, 0, 99, EPC_DESIGN_DEFAULTS.minSocPct);
    const dodPct = clamp(asNumber(project.assumptions.bessDod, EPC_DESIGN_DEFAULTS.bessDod), 0, 1, EPC_DESIGN_DEFAULTS.bessDod) * 100;
    const maxSocPct = Math.max(minSocPct, Math.min(100, minSocPct + dodPct));
    const minSoc = minSocPct / 100;
    const maxSoc = maxSocPct / 100;
    const minSocKwh = batteryKwh * minSoc;
    const maxSocKwh = batteryKwh * maxSoc;
    const simulateRows = (initialSocKwh, includeRows = true) => {
      let socKwh = Math.min(maxSocKwh, Math.max(minSocKwh, initialSocKwh));
      const rows = [];
      for (const window of flowWindows) {
        const durationHours = Math.max(0, asNumber(window.durationHours, 1));
        const exactKey = asNumber(window.hour, 0).toFixed(4);
        const roundedHour = Math.round(asNumber(window.hour, 0));
        const flooredHour = Math.floor(asNumber(window.hour, 0));
        const pvMw = Number.isFinite(window.pvMw)
          ? window.pvMw
          : exactPvMap.has(exactKey)
            ? exactPvMap.get(exactKey)
            : (pvMap.get(roundedHour) || 0);
        const pvOutputKw = pvMw * 1000;
        const loadKw = exactLoadMap.has(exactKey)
          ? exactLoadMap.get(exactKey)
          : loadMap.has(flooredHour)
            ? loadMap.get(flooredHour)
            : densePvProfile
              ? 0
              : load.averageLoadKw;
        const pvToLoadKw = Math.min(pvOutputKw, loadKw);
        const surplusPvKw = Math.max(0, pvOutputKw - loadKw);
        const loadDeficitKw = Math.max(0, loadKw - pvOutputKw);
        const batteryHeadroomKwh = Math.max(0, maxSocKwh - socKwh);
        const pvToBatteryKw = Math.min(surplusPvKw, pcsKw, durationHours > 0 ? batteryHeadroomKwh / durationHours : 0);
        socKwh += pvToBatteryKw * durationHours;
        const batteryAvailableKwh = Math.max(0, socKwh - minSocKwh);
        const batteryToLoadKw = Math.min(loadDeficitKw, pcsKw, durationHours > 0 ? batteryAvailableKwh / durationHours : 0);
        socKwh -= batteryToLoadKw * durationHours;
        const gensetToLoadKw = Math.max(0, loadDeficitKw - batteryToLoadKw);
        const curtailmentKw = Math.max(0, surplusPvKw - pvToBatteryKw);
        if (includeRows) {
          const row = {
            hour: window.hour,
            hourLabel: window.hourLabel,
            flowKey: window.flowKey,
            pvOutputKw: round(pvOutputKw, 2),
            loadKw: round(loadKw, 2),
            pvToLoadKw: round(pvToLoadKw, 2),
            pvToBatteryKw: round(pvToBatteryKw, 2),
            batteryToLoadKw: round(batteryToLoadKw, 2),
            gensetToLoadKw: round(gensetToLoadKw, 2),
            curtailmentKw: round(curtailmentKw, 2),
            socPct: batteryKwh > 0 ? round((socKwh / batteryKwh) * 100, 1) : 0
          };
          if (densePvProfile) {
            row.timelineMinute = round(window.timelineMinute, 4);
            row.intervalMinutes = round(window.intervalMinutes, 4);
            row.durationHours = durationHours;
          }
          rows.push(row);
        }
      }
      return { rows, socKwh };
    };
    let rolloverSocKwh = minSocKwh;
    for (let i = 0; i < 7; i += 1) {
      rolloverSocKwh = simulateRows(rolloverSocKwh, false).socKwh;
    }
    const rows = simulateRows(rolloverSocKwh, true).rows;
    const rowDurationHours = row => Math.max(0, asNumber(row.durationHours, 1));
    const sum = key => rows.reduce((total, row) => total + row[key] * rowDurationHours(row), 0);
    return {
      method: `EMS order: PV -> Load, Excess PV -> Battery, Battery -> Load, Genset -> Load, curtail surplus.${densePvProfile ? ' PV profile source: PV Simulator.' : ''}${scheduleLoadProfile.length ? ' Load profile source: Equipment Schedule timetable.' : ''}`,
      rows,
      summary: {
        pvDirectKwh: round(sum('pvToLoadKw'), 2),
        pvToBatteryKwh: round(sum('pvToBatteryKw'), 2),
        batteryToLoadKwh: round(sum('batteryToLoadKw'), 2),
        gensetRemainingKwh: round(sum('gensetToLoadKw'), 2),
        curtailmentKwh: round(sum('curtailmentKw'), 2),
        socMinPct: round(minSocPct, 2),
        socMaxPct: round(maxSocPct, 2)
      }
    };
  }

  function calculateEpcDesignProject(rawProject = {}, options = {}) {
    const project = normalizeEpcDesignProject(rawProject, options);
    const now = isoNow(options.now);
    const load = calculateLoad(project, now);
    const schemes = getSchemeTargetsForProject(project).map(target => calculateScheme(project, load, target, now));
    const recommended = pickRecommendedScheme(schemes, project.designTargets.replacementPct);
    const electrical = calculateElectrical(project, recommended);
    const pvStringDesign = calculatePvStringDesign({
      targetPvMwp: recommended.pvRecommendedMwp,
      moduleWp: project.assumptions.moduleWp,
      modulesPerString: project.assumptions.modulesPerString,
      combinerInputs: project.assumptions.combinerInputs,
      inverterArchitecture: project.assumptions.inverterArchitecture,
      totalStringInputs: project.assumptions.totalStringInputs
    });
    const boq = buildBoq(project, recommended);
    const risks = buildRisks(project, load, electrical, recommended);
    const energyFlow = calculateEnergyFlow(project, load, recommended);
    const formulaTrace = [
      ...load.trace,
      ...recommended.formulaTrace,
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
        formula: 'Supported Load x Support Hours / (DoD x Discharge Efficiency) / 1000',
        inputs: {
          bessRole: recommended.bessRole,
          supportedLoadKw: round(recommended.supportedLoadKw, 4),
          supportHours: recommended.supportHours,
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
        formula: `${recommended.pcsBasis}, rounded up to 0.5MW`,
        inputs: {
          bessRole: recommended.bessRole,
          peakLoadKw: round(load.peakLoadKw, 4),
          peakLoadSafetyFactor: project.loads.peakLoadSafetyFactor,
          allowedGensetLoadKw: project.loads.allowedGensetLoadKw,
          pcsBasis: recommended.pcsBasis
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
      energyFlow,
      pvStringDesign,
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

  function calculatePvStringDesign({
    targetPvMwp = 0,
    moduleWp = EPC_DESIGN_DEFAULTS.moduleWp,
    modulesPerString = EPC_DESIGN_DEFAULTS.modulesPerString,
    combinerInputs = EPC_DESIGN_DEFAULTS.combinerInputs,
    inverterArchitecture = 'central',
    totalStringInputs = 0,
    minimumExpectedModulesPerString = 18
  } = {}) {
    const modules = Math.ceil((asNumber(targetPvMwp, 0) * 1000000) / Math.max(1, asNumber(moduleWp, EPC_DESIGN_DEFAULTS.moduleWp)));
    const strings = Math.ceil(modules / Math.max(1, asNumber(modulesPerString, EPC_DESIGN_DEFAULTS.modulesPerString)));
    const architecture = String(inverterArchitecture || 'central');
    const combiners = architecture === 'string'
      ? 0
      : Math.ceil(strings / Math.max(1, asNumber(combinerInputs, EPC_DESIGN_DEFAULTS.combinerInputs)));
    const inputCount = asNumber(totalStringInputs, 0);
    const warnings = [];
    if (inputCount > 0 && modules / inputCount < asNumber(minimumExpectedModulesPerString, 18)) {
      warnings.push('Review module/string ratio: total string inputs imply unusually low modules per string.');
    }
    return {
      moduleWp: asNumber(moduleWp, EPC_DESIGN_DEFAULTS.moduleWp),
      modules,
      modulesPerString: asNumber(modulesPerString, EPC_DESIGN_DEFAULTS.modulesPerString),
      strings,
      combinerInputs: asNumber(combinerInputs, EPC_DESIGN_DEFAULTS.combinerInputs),
      combiners,
      inverterArchitecture: architecture,
      totalStringInputs: inputCount,
      warnings
    };
  }

  function buildGlobalSolarAtlasUrl(site = {}) {
    const lat = coordinate(site.latitude) ?? 0;
    const lng = coordinate(site.longitude) ?? 0;
    const zoom = 11;
    return `https://globalsolaratlas.info/map?c=${lat.toFixed(6)},${lng.toFixed(6)},${zoom}&s=${lat.toFixed(6)},${lng.toFixed(6)}&m=site`;
  }

  function buildGlobalSolarAtlasApiUrls(site = {}, options = {}) {
    const lat = coordinate(site.latitude);
    const lng = coordinate(site.longitude);
    if (lat === null || lng === null) return [];
    const base = String(options.apiBase || options.globalSolarAtlasApiBase || GLOBAL_SOLAR_ATLAS_API_BASE).trim().replace(/\/?$/, '/');
    const latText = lat.toFixed(6);
    const lngText = lng.toFixed(6);
    return [
      `${base}data/lta?loc=${encodeURIComponent(`${latText},${lngText}`)}`
    ];
  }

  function findSolarValue(payload, aliases = []) {
    const wanted = new Set(aliases.map(alias => String(alias).toLowerCase()));
    const seen = new Set();
    const visit = (value) => {
      if (!value || typeof value !== 'object' || seen.has(value)) return undefined;
      seen.add(value);
      if (Array.isArray(value)) {
        for (const item of value) {
          const found = visit(item);
          if (found !== undefined) return found;
        }
        return undefined;
      }
      for (const [key, item] of Object.entries(value)) {
        if (wanted.has(String(key).toLowerCase())) {
          const n = Number(item);
          if (Number.isFinite(n)) return n;
        }
      }
      for (const item of Object.values(value)) {
        const found = visit(item);
        if (found !== undefined) return found;
      }
      return undefined;
    };
    return visit(payload);
  }

  function dailySolarValue(value, digits = 2) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return round(n > 25 ? n / 365 : n, digits);
  }

  function parseGlobalSolarAtlasSolarResource(payload = {}, options = {}) {
    const pvout = findSolarValue(payload, [
      'PVOUT_specific',
      'PVOUT_csi',
      'PVOUT',
      'PVOUT_total',
      'specificYieldKwhPerKwpDay',
      'pvYieldKwhPerKwpDay'
    ]);
    const ghi = findSolarValue(payload, ['GHI', 'ghiKwhM2Day']);
    const dni = findSolarValue(payload, ['DNI', 'dniKwhM2Day']);
    const temp = findSolarValue(payload, ['TEMP', 'temperatureC', 'temperature']);
    const resource = {
      specificYieldKwhPerKwpDay: dailySolarValue(pvout, 2),
      gsaPvoutKwhPerKwpDay: dailySolarValue(pvout, 2),
      ghiKwhM2Day: dailySolarValue(ghi, 2),
      dniKwhM2Day: dailySolarValue(dni, 2),
      temperatureC: Number.isFinite(Number(temp)) ? round(temp, 1) : 0,
      dataSource: String(options.dataSource || 'Global Solar Atlas'),
      retrievalDate: isoNow(options.now).slice(0, 10)
    };
    return Object.values(resource).some(value => Number(value) > 0) ? resource : null;
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
    buildGlobalSolarAtlasApiUrls,
    parseGlobalSolarAtlasSolarResource,
    normalizeEpcDesignProjectList
  };
})(window);
