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

const POWER_NODE_TYPES = [
  'GRID', 'PV_ARRAY', 'PV_INVERTER', 'BATTERY', 'PCS', 'HYBRID_INVERTER', 'GENSET',
  'LV_BUS', 'MV_BUS', 'MV_SWITCHBOARD', 'LV_SWITCHBOARD', 'TRANSFORMER',
  'METER', 'ATS', 'STS', 'LOAD', 'CRITICAL_LOAD_PANEL', 'EMS', 'SCADA'
];

const POWER_EDGE_TYPES = ['DC_POWER', 'AC_LV_POWER', 'AC_MV_POWER', 'COMMUNICATION', 'CONTROL'];

const STANDARD_TOPOLOGY_META = [
  {
    id: 'C2',
    name: 'C2 PV + Genset, No Battery',
    category: 'off-grid',
    description: 'PV inverter and genset share a common LV bus; requires penetration, reverse power and minimum genset loading review.'
  },
  {
    id: 'C3',
    name: 'C3 AC-Coupled PV + BESS + Genset',
    category: 'off-grid',
    description: 'PV inverter, PCS and genset connect to a common AC bus under EMS dispatch.'
  },
  {
    id: 'C5',
    name: 'C5 Off-Grid Microgrid',
    category: 'off-grid',
    description: 'Grid-forming BESS, PV and genset supply critical and flexible loads through LV/MV distribution.'
  },
  {
    id: 'C7',
    name: 'C7 MV Ring Microgrid',
    category: 'off-grid',
    description: 'PV, BESS and DG stations collect into an MV switchboard and ring RMU for long-distance multi-load sites.'
  }
];

const STANDARD_TRANSFORMER_KVA = [100, 160, 250, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500];

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

function idSafe(value, fallback = 'item') {
  const raw = String(value || '').trim().toLowerCase();
  const safe = raw.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe || fallback;
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
  const emsTableIntervalMinutes = [5, 60].includes(Number(input.emsTableIntervalMinutes))
    ? Number(input.emsTableIntervalMinutes)
    : (input.mergeHourly === false ? 5 : 60);
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
  const normalizeShockPosition = (value) => {
    const raw = String(value || '').trim().toLowerCase();
    return ['startup', 'early', 'middle', 'late', 'distributed'].includes(raw) ? raw : 'startup';
  };
  const batteryControlInput = input.batteryControl && typeof input.batteryControl === 'object' ? input.batteryControl : {};
  const allowedPriority = ['pv_to_load', 'battery_to_load', 'genset_to_load', 'pv_to_battery'];
  const rawPriority = Array.isArray(batteryControlInput.priorityOrder) ? batteryControlInput.priorityOrder : allowedPriority;
  const priorityOrder = rawPriority
    .map(item => String(item || '').trim().toLowerCase())
    .filter((item, index, array) => allowedPriority.includes(item) && array.indexOf(item) === index);
  allowedPriority.forEach(item => {
    if (!priorityOrder.includes(item)) priorityOrder.push(item);
  });
  const manualOverrides = Array.isArray(batteryControlInput.manualOverrides)
    ? batteryControlInput.manualOverrides.map(item => {
        const legacyBatteryKw = clamp(item?.batteryKw, -100000, 100000, 0);
        const batteryLoadKw = round(clamp(item?.batteryLoadKw, 0, 100000, legacyBatteryKw < 0 ? Math.abs(legacyBatteryKw) : 0), 2);
        const pvBatteryKw = batteryLoadKw > 0
          ? 0
          : round(clamp(item?.pvBatteryKw, 0, 100000, legacyBatteryKw > 0 ? legacyBatteryKw : 0), 2);
        return {
          timelineMinute: Math.round(clamp(item?.timelineMinute, 0, 24 * 60, 0)),
          pvBatteryKw,
          batteryLoadKw
        };
      }).filter(item => item.pvBatteryKw > 0 || item.batteryLoadKw > 0)
    : [];
  const customStrategies = Array.isArray(batteryControlInput.customStrategies)
    ? batteryControlInput.customStrategies.map((item, index) => {
        const rawOrder = Array.isArray(item?.priorityOrder) ? item.priorityOrder : [];
        const customPriorityOrder = rawOrder
          .map(priority => String(priority || '').trim().toLowerCase())
          .filter((priority, priorityIndex, array) => allowedPriority.includes(priority) && array.indexOf(priority) === priorityIndex);
        allowedPriority.forEach(priority => {
          if (!customPriorityOrder.includes(priority)) customPriorityOrder.push(priority);
        });
        return {
          id: String(item?.id || `custom-${index + 1}`).trim().slice(0, 48) || `custom-${index + 1}`,
          label: String(item?.label || `Manual strategy ${index + 1}`).trim().slice(0, 80) || `Manual strategy ${index + 1}`,
          priorityOrder: customPriorityOrder
        };
      }).filter((item, index, array) => array.findIndex(other => other.id === item.id) === index)
    : [];
  return {
    visibleSeries: visibleSeries.length ? visibleSeries : [...EMS_FLOW_DISPLAY_SERIES],
    mergeHourly: input.mergeHourly !== false,
    emsTableIntervalMinutes,
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
      loadShockCount: Math.round(clamp(deviceWorkModelInput.loadShockCount ?? deviceWorkModelInput.shockCount, 0, 4, 2)),
      loadShockDurationMinutes: clamp(deviceWorkModelInput.loadShockDurationMinutes ?? deviceWorkModelInput.shockDurationMinutes, 1, 60, 14),
      loadShockImpactPct: clamp(deviceWorkModelInput.loadShockImpactPct ?? deviceWorkModelInput.shockImpactPct, 0, 40, 20),
      loadShockPosition: normalizeShockPosition(deviceWorkModelInput.loadShockPosition),
      gensetShockCount: Math.round(clamp(deviceWorkModelInput.gensetShockCount, 0, 4, 0)),
      gensetShockDurationMinutes: clamp(deviceWorkModelInput.gensetShockDurationMinutes, 1, 60, 12),
      gensetShockImpactPct: clamp(deviceWorkModelInput.gensetShockImpactPct, 0, 40, 0),
      gensetShockPosition: normalizeShockPosition(deviceWorkModelInput.gensetShockPosition),
      gensetStepEnabled: deviceWorkModelInput.gensetStepEnabled === false ? false : true,
      gensetPlatforms: gensetPlatforms.length ? gensetPlatforms : [0.3, 0.5, 0.75, 1]
    },
    batteryControl: {
      mode: String(batteryControlInput.mode || '').toLowerCase() === 'manual' ? 'manual' : 'auto',
      manualIntervalMinutes: [5, 60].includes(Number(batteryControlInput.manualIntervalMinutes)) ? Number(batteryControlInput.manualIntervalMinutes) : 60,
      batteryFirstAboveMinSoc: batteryControlInput.batteryFirstAboveMinSoc === false ? false : true,
      gensetShockPreemptBattery: batteryControlInput.gensetShockPreemptBattery === true,
      priorityOrder,
      customStrategies,
      manualOverrides
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

function normalizePowerNodeType(value) {
  const raw = String(value || '').trim().toUpperCase();
  return POWER_NODE_TYPES.includes(raw) ? raw : 'LOAD';
}

function normalizePowerEdgeType(value) {
  const raw = String(value || '').trim().toUpperCase();
  return POWER_EDGE_TYPES.includes(raw) ? raw : 'AC_LV_POWER';
}

function normalizePowerNode(node = {}, index = 0) {
  const type = normalizePowerNodeType(node.type);
  const electrical = node.electrical && typeof node.electrical === 'object' ? node.electrical : {};
  return {
    id: String(node.id || `${idSafe(type)}-${index + 1}`).trim(),
    type,
    label: String(node.label || type.replaceAll('_', ' ')).trim(),
    position: {
      x: asNumber(node.position?.x, index * 160),
      y: asNumber(node.position?.y, 0)
    },
    electrical: {
      ratedPowerKw: asNumber(electrical.ratedPowerKw, 0),
      ratedEnergyKwh: asNumber(electrical.ratedEnergyKwh, 0),
      voltageV: asNumber(electrical.voltageV, type.includes('MV') ? 11000 : type.includes('LV') ? 415 : 0),
      frequencyHz: asNumber(electrical.frequencyHz, 50),
      pf: asNumber(electrical.pf, EPC_DESIGN_DEFAULTS.powerFactor),
      faultRatingKa: asNumber(electrical.faultRatingKa, 0)
    },
    equipmentRef: String(node.equipmentRef || ''),
    siteAssetRef: String(node.siteAssetRef || ''),
    locked: Boolean(node.locked),
    autoGenerated: node.autoGenerated !== false
  };
}

function normalizePowerEdge(edge = {}, index = 0) {
  const type = normalizePowerEdgeType(edge.type);
  return {
    id: String(edge.id || `edge-${index + 1}`).trim(),
    source: String(edge.source || '').trim(),
    target: String(edge.target || '').trim(),
    type,
    direction: String(edge.direction || (type === 'DC_POWER' ? 'ONE_WAY' : 'BIDIRECTIONAL')).toUpperCase() === 'ONE_WAY' ? 'ONE_WAY' : 'BIDIRECTIONAL',
    voltageV: asNumber(edge.voltageV, 0),
    maxPowerKw: asNumber(edge.maxPowerKw, 0),
    calculatedCurrentA: asNumber(edge.calculatedCurrentA, 0),
    routeLengthM: asNumber(edge.routeLengthM, 0),
    cableDesignRef: String(edge.cableDesignRef || ''),
    protectionRef: String(edge.protectionRef || '')
  };
}

function buildStandardTopologyGraph(id = 'C5') {
  const topologyId = STANDARD_TOPOLOGY_META.some(item => item.id === id) ? id : 'C5';
  const node = (nodeId, type, label, x, y, voltageV = 0) => ({
    id: nodeId,
    type,
    label,
    position: { x, y },
    electrical: { voltageV },
    autoGenerated: true
  });
  const edge = (edgeId, source, target, type, direction = 'ONE_WAY', voltageV = 0) => ({
    id: edgeId,
    source,
    target,
    type,
    direction,
    voltageV
  });
  const commonEms = node('ems', 'EMS', 'EMS Controller', 520, 330, 0);
  if (topologyId === 'C2') {
    return {
      nodes: [
        node('pv-array', 'PV_ARRAY', 'PV Array', 40, 60, 1000),
        node('pv-inverter', 'PV_INVERTER', 'PV Inverter', 220, 60, 415),
        node('genset', 'GENSET', 'Genset', 220, 210, 415),
        node('lv-bus', 'LV_BUS', 'Common 415V Bus', 430, 130, 415),
        node('load', 'LOAD', 'Loads', 650, 130, 415),
        commonEms
      ],
      edges: [
        edge('pv-dc', 'pv-array', 'pv-inverter', 'DC_POWER', 'ONE_WAY', 1000),
        edge('pv-lv', 'pv-inverter', 'lv-bus', 'AC_LV_POWER', 'ONE_WAY', 415),
        edge('genset-lv', 'genset', 'lv-bus', 'AC_LV_POWER', 'ONE_WAY', 415),
        edge('lv-load', 'lv-bus', 'load', 'AC_LV_POWER', 'ONE_WAY', 415),
        edge('ems-pv', 'ems', 'pv-inverter', 'COMMUNICATION', 'BIDIRECTIONAL', 0),
        edge('ems-genset', 'ems', 'genset', 'CONTROL', 'BIDIRECTIONAL', 0)
      ]
    };
  }
  if (topologyId === 'C3') {
    return {
      nodes: [
        node('pv-array', 'PV_ARRAY', 'PV Array', 40, 50, 1000),
        node('pv-inverter', 'PV_INVERTER', 'PV Inverter', 220, 50, 415),
        node('battery', 'BATTERY', 'Battery', 40, 210, 800),
        node('pcs', 'PCS', 'PCS', 220, 210, 415),
        node('genset', 'GENSET', 'Genset', 220, 340, 415),
        node('lv-bus', 'LV_BUS', 'Common 415V Bus', 450, 160, 415),
        node('load', 'LOAD', 'Loads', 670, 160, 415),
        commonEms
      ],
      edges: [
        edge('pv-dc', 'pv-array', 'pv-inverter', 'DC_POWER', 'ONE_WAY', 1000),
        edge('pv-lv', 'pv-inverter', 'lv-bus', 'AC_LV_POWER', 'ONE_WAY', 415),
        edge('lv-pcs-charge', 'lv-bus', 'pcs', 'AC_LV_POWER', 'ONE_WAY', 415),
        edge('pcs-battery-charge', 'pcs', 'battery', 'DC_POWER', 'ONE_WAY', 800),
        edge('battery-pcs-discharge', 'battery', 'pcs', 'DC_POWER', 'ONE_WAY', 800),
        edge('pcs-lv-discharge', 'pcs', 'lv-bus', 'AC_LV_POWER', 'ONE_WAY', 415),
        edge('genset-lv', 'genset', 'lv-bus', 'AC_LV_POWER', 'ONE_WAY', 415),
        edge('lv-load', 'lv-bus', 'load', 'AC_LV_POWER', 'ONE_WAY', 415),
        edge('ems-pcs', 'ems', 'pcs', 'COMMUNICATION', 'BIDIRECTIONAL', 0)
      ]
    };
  }
  if (topologyId === 'C7') {
    return {
      nodes: [
        node('pv-array', 'PV_ARRAY', 'PV Station', 40, 60, 1000),
        node('pv-inverter', 'PV_INVERTER', 'PV Inverter', 210, 60, 415),
        node('pv-tx', 'TRANSFORMER', 'PV Step-up TX', 380, 60, 11000),
        node('battery', 'BATTERY', 'BESS', 40, 190, 800),
        node('pcs', 'PCS', 'PCS', 210, 190, 415),
        node('bess-tx', 'TRANSFORMER', 'BESS Step-up TX', 380, 190, 11000),
        node('genset', 'GENSET', 'DG Station', 210, 320, 415),
        node('dg-tx', 'TRANSFORMER', 'DG Step-up TX', 380, 320, 11000),
        node('mv-bus', 'MV_SWITCHBOARD', '11kV Main Switchboard', 590, 190, 11000),
        node('rmu', 'MV_BUS', 'Ring RMU', 780, 190, 11000),
        node('load-tx', 'TRANSFORMER', 'Local Step-down TX', 970, 190, 415),
        node('lv-bus', 'LV_BUS', 'Local 415V Bus', 1160, 190, 415),
        node('load', 'LOAD', 'LV Loads', 1350, 190, 415),
        commonEms
      ],
      edges: [
        edge('pv-dc', 'pv-array', 'pv-inverter', 'DC_POWER', 'ONE_WAY', 1000),
        edge('pv-tx-lv', 'pv-inverter', 'pv-tx', 'AC_LV_POWER', 'ONE_WAY', 415),
        edge('pv-mv', 'pv-tx', 'mv-bus', 'AC_MV_POWER', 'ONE_WAY', 11000),
        edge('mv-bess-charge', 'mv-bus', 'bess-tx', 'AC_MV_POWER', 'ONE_WAY', 11000),
        edge('bess-tx-pcs-charge', 'bess-tx', 'pcs', 'AC_LV_POWER', 'ONE_WAY', 415),
        edge('pcs-battery-charge', 'pcs', 'battery', 'DC_POWER', 'ONE_WAY', 800),
        edge('battery-pcs-discharge', 'battery', 'pcs', 'DC_POWER', 'ONE_WAY', 800),
        edge('pcs-tx-discharge', 'pcs', 'bess-tx', 'AC_LV_POWER', 'ONE_WAY', 415),
        edge('bess-mv-discharge', 'bess-tx', 'mv-bus', 'AC_MV_POWER', 'ONE_WAY', 11000),
        edge('dg-tx-lv', 'genset', 'dg-tx', 'AC_LV_POWER', 'ONE_WAY', 415),
        edge('dg-mv', 'dg-tx', 'mv-bus', 'AC_MV_POWER', 'ONE_WAY', 11000),
        edge('mv-ring', 'mv-bus', 'rmu', 'AC_MV_POWER', 'BIDIRECTIONAL', 11000),
        edge('rmu-load-tx', 'rmu', 'load-tx', 'AC_MV_POWER', 'ONE_WAY', 11000),
        edge('load-tx-lv', 'load-tx', 'lv-bus', 'AC_LV_POWER', 'ONE_WAY', 415),
        edge('lv-load', 'lv-bus', 'load', 'AC_LV_POWER', 'ONE_WAY', 415),
        edge('ems-mv-switchboard', 'ems', 'mv-bus', 'COMMUNICATION', 'BIDIRECTIONAL', 0),
        edge('ems-pcs', 'ems', 'pcs', 'COMMUNICATION', 'BIDIRECTIONAL', 0)
      ]
    };
  }
  return {
    nodes: [
      node('pv-array', 'PV_ARRAY', 'PV Array', 40, 40, 1000),
      node('pv-inverter', 'PV_INVERTER', 'PV Inverter', 220, 40, 415),
      node('battery', 'BATTERY', 'Battery', 40, 180, 800),
      node('pcs', 'PCS', 'Grid-forming PCS', 220, 180, 415),
      node('genset', 'GENSET', 'Genset', 220, 320, 415),
      node('lv-bus', 'LV_BUS', 'Microgrid 415V Bus', 450, 180, 415),
      node('step-up-tx', 'TRANSFORMER', 'Step-up TX', 620, 180, 11000),
      node('mv-switchboard', 'MV_SWITCHBOARD', 'MV Switchboard', 800, 180, 11000),
      node('ring-rmu', 'MV_BUS', 'Ring RMU', 980, 180, 11000),
      node('mv-bus', 'MV_BUS', 'MV BUS', 1160, 180, 11000),
      node('load-tx', 'TRANSFORMER', 'Load TX', 1340, 180, 415),
      node('lv-load-bus', 'LV_BUS', 'LV BUS', 1520, 180, 415),
      node('critical-load', 'CRITICAL_LOAD_PANEL', 'Critical Loads', 1700, 120, 415),
      node('load', 'LOAD', 'Flexible Loads', 1700, 250, 415),
      commonEms
    ],
    edges: [
      edge('pv-dc', 'pv-array', 'pv-inverter', 'DC_POWER', 'ONE_WAY', 1000),
      edge('pv-lv', 'pv-inverter', 'lv-bus', 'AC_LV_POWER', 'ONE_WAY', 415),
      edge('lv-pcs-charge', 'lv-bus', 'pcs', 'AC_LV_POWER', 'ONE_WAY', 415),
      edge('pcs-battery-charge', 'pcs', 'battery', 'DC_POWER', 'ONE_WAY', 800),
      edge('battery-pcs-discharge', 'battery', 'pcs', 'DC_POWER', 'ONE_WAY', 800),
      edge('pcs-lv-discharge', 'pcs', 'lv-bus', 'AC_LV_POWER', 'ONE_WAY', 415),
      edge('genset-lv', 'genset', 'lv-bus', 'AC_LV_POWER', 'ONE_WAY', 415),
      edge('lv-step-up', 'lv-bus', 'step-up-tx', 'AC_LV_POWER', 'BIDIRECTIONAL', 415),
      edge('step-up-mv', 'step-up-tx', 'mv-switchboard', 'AC_MV_POWER', 'BIDIRECTIONAL', 11000),
      edge('mv-switchboard-rmu', 'mv-switchboard', 'ring-rmu', 'AC_MV_POWER', 'BIDIRECTIONAL', 11000),
      edge('rmu-mv-bus', 'ring-rmu', 'mv-bus', 'AC_MV_POWER', 'BIDIRECTIONAL', 11000),
      edge('mv-load-tx', 'mv-bus', 'load-tx', 'AC_MV_POWER', 'ONE_WAY', 11000),
      edge('load-tx-lv-bus', 'load-tx', 'lv-load-bus', 'AC_LV_POWER', 'ONE_WAY', 415),
      edge('load-tx-critical', 'lv-load-bus', 'critical-load', 'AC_LV_POWER', 'ONE_WAY', 415),
      edge('load-tx-flex', 'lv-load-bus', 'load', 'AC_LV_POWER', 'ONE_WAY', 415),
      edge('ems-pcs', 'ems', 'pcs', 'COMMUNICATION', 'BIDIRECTIONAL', 0),
      edge('ems-mv-switchboard', 'ems', 'mv-switchboard', 'COMMUNICATION', 'BIDIRECTIONAL', 0)
    ]
  };
}

function normalizeSelectedTopologyId(value, site = {}) {
  const raw = String(value || '').trim().toUpperCase();
  if (raw === 'CUSTOM' || STANDARD_TOPOLOGY_META.some(item => item.id === raw)) return raw;
  const gridMode = String(site.gridMode || '').toLowerCase();
  return gridMode.includes('island') || gridMode.includes('off') ? 'C5' : 'C3';
}

function normalizePowerTopology(rawTopology = {}, selectedTopologyId = 'C5') {
  const input = rawTopology && typeof rawTopology === 'object' ? rawTopology : {};
  const hasCustomGraph = Array.isArray(input.nodes) && input.nodes.length;
  const base = hasCustomGraph ? input : buildStandardTopologyGraph(selectedTopologyId);
  const nodes = (Array.isArray(base.nodes) ? base.nodes : [])
    .map((node, index) => normalizePowerNode(node, index))
    .filter(node => node.id);
  const nodeIds = new Set(nodes.map(node => node.id));
  const edges = (Array.isArray(base.edges) ? base.edges : [])
    .map((edge, index) => normalizePowerEdge(edge, index))
    .filter(edge => edge.id && nodeIds.has(edge.source) && nodeIds.has(edge.target));
  return { selectedTopologyId, nodes, edges };
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
  const rawPvDcAcRatio = Number(assumptions.pvDcAcRatio ?? defaults.pvDcAcRatio);
  normalizedAssumptions.pvDcAcRatio = Number.isFinite(rawPvDcAcRatio) && rawPvDcAcRatio >= 1
    ? rawPvDcAcRatio
    : 1.2;
  const selectedTopologyId = normalizeSelectedTopologyId(raw.selectedTopologyId || raw.topology?.selectedTopologyId, {
    gridMode: site.gridMode || raw.gridMode || 'hybrid'
  });
  const topology = normalizePowerTopology(raw.topology || {}, selectedTopologyId);

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
    selectedTopologyId,
    topology,
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
      roundUpSizing: Boolean(designTargets.roundUpSizing ?? raw.roundUpSizing),
      capacityOverrides: normalizeCapacityOverrides(designTargets.capacityOverrides || raw.capacityOverrides || {})
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

function positiveNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeCapacityOverrides(value = {}) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    pvMwp: positiveNumberOrNull(input.pvMwp ?? input.pv_mwp),
    pcsMw: positiveNumberOrNull(input.pcsMw ?? input.pcs_mw),
    bessMwh: positiveNumberOrNull(input.bessMwh ?? input.bess_mwh)
  };
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

function applyCapacityOverridesToScheme(project, scheme = {}) {
  const overrides = project.designTargets.capacityOverrides || {};
  const flags = {
    pvMwp: positiveNumberOrNull(overrides.pvMwp) !== null,
    pcsMw: positiveNumberOrNull(overrides.pcsMw) !== null,
    bessMwh: positiveNumberOrNull(overrides.bessMwh) !== null
  };
  const pvRecommendedMwp = flags.pvMwp ? positiveNumberOrNull(overrides.pvMwp) : scheme.pvRecommendedMwp;
  const pcsRecommendedMw = flags.pcsMw ? positiveNumberOrNull(overrides.pcsMw) : scheme.pcsRecommendedMw;
  const bessRecommendedMwh = flags.bessMwh ? positiveNumberOrNull(overrides.bessMwh) : scheme.bessRecommendedMwh;
  const batteryKwh = Math.max(0.001, asNumber(bessRecommendedMwh, 0) * 1000);
  const pcsKw = asNumber(pcsRecommendedMw, 0) * 1000;
  const requiredAreaM2 = asNumber(pvRecommendedMwp, 0) * asNumber(project.assumptions.groundPvAreaM2PerMwp, EPC_DESIGN_DEFAULTS.groundPvAreaM2PerMwp);
  const dod = asNumber(project.assumptions.bessDod, EPC_DESIGN_DEFAULTS.bessDod);
  const efficiency = asNumber(project.assumptions.bessDischargeEfficiency, EPC_DESIGN_DEFAULTS.bessDischargeEfficiency);
  const supportedLoadKw = Math.max(0.001, asNumber(scheme.supportedLoadKw, 0));
  return {
    ...scheme,
    calculatedPvRecommendedMwp: scheme.pvRecommendedMwp,
    calculatedPcsRecommendedMw: scheme.pcsRecommendedMw,
    calculatedBessRecommendedMwh: scheme.bessRecommendedMwh,
    pvRecommendedMwp,
    pcsRecommendedMw,
    bessRecommendedMwh,
    capacityOverrideFlags: flags,
    hasCapacityOverride: flags.pvMwp || flags.pcsMw || flags.bessMwh,
    requiredAreaM2,
    areaUtilizationPct: project.site.availableAreaM2 > 0 ? (requiredAreaM2 / project.site.availableAreaM2) * 100 : 0,
    cRate: pcsKw / batteryKwh,
    equivalentDurationHours: batteryKwh / Math.max(0.001, pcsKw),
    usableDurationAtSupportedLoadHours: (batteryKwh * dod * efficiency) / supportedLoadKw
  };
}

function buildCapacityOverrideTraces(project, recommended = {}, now) {
  if (!recommended.hasCapacityOverride) return [];
  const specs = [
    ['pvMwp', 'PV Capacity Override', 'calculatedPvRecommendedMwp', 'pvRecommendedMwp', 'MWp'],
    ['pcsMw', 'PCS Capacity Override', 'calculatedPcsRecommendedMw', 'pcsRecommendedMw', 'MW'],
    ['bessMwh', 'BESS Capacity Override', 'calculatedBessRecommendedMwh', 'bessRecommendedMwh', 'MWh']
  ];
  return specs
    .filter(([flag]) => recommended.capacityOverrideFlags?.[flag])
    .map(([flag, label, calculatedKey, effectiveKey, unit]) => buildFormulaTrace({
      key: `capacityOverride.${flag}`,
      label,
      formula: 'Manual final capacity override',
      inputs: {
        calculatedRecommendation: round(recommended[calculatedKey], 4),
        manualOverride: round(project.designTargets.capacityOverrides?.[flag], 4)
      },
      result: round(recommended[effectiveKey], 4),
      unit,
      assumptionSource: 'Manual Override',
      now
    }));
}

function calculateCurrentA(powerKw, voltageKv, pf) {
  return powerKw > 0 && voltageKv > 0 && pf > 0
    ? powerKw / (Math.sqrt(3) * voltageKv * pf)
    : 0;
}

function nextStandardTransformerKva(requiredKva) {
  const required = Math.max(0, asNumber(requiredKva, 0));
  return STANDARD_TRANSFORMER_KVA.find(kva => kva >= required) || roundUpStep(required, 2500);
}

function buildTransformerSizing(designKw, pf, loadingTarget = 0.85) {
  const requiredKva = designKw > 0 ? designKw / Math.max(0.001, pf * loadingTarget) : 0;
  return {
    requiredKva: round(requiredKva, 2),
    loadingTarget,
    selectedStandardKva: nextStandardTransformerKva(requiredKva),
    formula: 'MaximumCoincident_kW / (PF x LoadingTarget)',
    notes: [
      'Budget-level transformer sizing only.',
      'Verify temperature, altitude, harmonics, bidirectional power flow, N-1 and motor-starting voltage dip.'
    ]
  };
}

function estimateVoltageDropPct({ currentA, voltageKv, distanceM, conductor = 'AL', sizeMm2 = 240, parallelRuns = 1, pf = 0.95 }) {
  const lengthKm = Math.max(0, asNumber(distanceM, 0)) / 1000;
  const voltageV = Math.max(1, asNumber(voltageKv, 0) * 1000);
  const runs = Math.max(1, asNumber(parallelRuns, 1));
  const resistanceBase = conductor === 'CU' ? 0.0175 : 0.0282;
  const resistance = (resistanceBase * 1000) / Math.max(1, asNumber(sizeMm2, 1));
  const reactance = voltageKv >= 6 ? 0.09 : 0.08;
  const cosPhi = clamp(pf, 0.1, 1, 0.95);
  const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi ** 2));
  const deltaV = Math.sqrt(3) * asNumber(currentA, 0) * lengthKm * ((resistance / runs) * cosPhi + (reactance / runs) * sinPhi);
  return (deltaV / voltageV) * 100;
}

function buildCableCandidate({ voltageClass, voltageKv, designKw, distanceM, pf, conductor, sizeMm2, ampacityA, derating = 0.8 }) {
  const currentA = calculateCurrentA(designKw, voltageKv, pf);
  const effectiveAmpacityA = Math.max(1, ampacityA * derating);
  const parallelRuns = Math.max(1, Math.ceil(currentA / effectiveAmpacityA));
  const voltageDropPct = estimateVoltageDropPct({ currentA, voltageKv, distanceM, conductor, sizeMm2, parallelRuns, pf });
  const estimatedLossKw = voltageKv > 0 ? round(designKw * (voltageDropPct / 100) * 0.45, 2) : 0;
  let status = 'PASS';
  if (parallelRuns > 6 || voltageDropPct > 5) status = 'FAIL';
  else if (parallelRuns > 2 || voltageDropPct > 3) status = 'REVIEW';
  return {
    voltageClass,
    conductor,
    sizeMm2,
    parallelRuns,
    ampacityA,
    derating,
    designCurrentA: round(currentA, 2),
    voltageDropPct: round(voltageDropPct, 2),
    estimatedLossKw,
    status
  };
}

function buildCableScreening(project, designKw, pf) {
  const distanceM = Math.max(project.site.distanceToInterconnectionM || 0, project.electrical.distanceToInterconnectionM || 0, 1);
  return {
    method: 'Ampacity -> derating -> voltage drop -> parallel runs -> LV/MV concept comparison',
    candidates: [
      buildCableCandidate({ voltageClass: '415V', voltageKv: 0.415, designKw, distanceM, pf, conductor: 'CU', sizeMm2: 630, ampacityA: 850, derating: 0.8 }),
      buildCableCandidate({ voltageClass: '415V', voltageKv: 0.415, designKw, distanceM, pf, conductor: 'AL', sizeMm2: 630, ampacityA: 720, derating: 0.8 }),
      buildCableCandidate({ voltageClass: '6.6kV', voltageKv: 6.6, designKw, distanceM, pf, conductor: 'AL', sizeMm2: 240, ampacityA: 360, derating: 0.85 }),
      buildCableCandidate({ voltageClass: '11kV', voltageKv: 11, designKw, distanceM, pf, conductor: 'AL', sizeMm2: 240, ampacityA: 360, derating: 0.85 })
    ],
    disclaimer: 'Budget screening only; final cable selection requires local standard, installation method, soil/ambient derating, short-circuit withstand and protection coordination.'
  };
}

function buildElectricalArchitecture(project, designKw, pf, distance, lvCurrentA, mvRecommended) {
  const existingMv = asNumber(project.electrical.existingMvVoltageKv, 0);
  const newMvSystem = Boolean(project.electrical.newMvSystem);
  const candidateSpecs = [
    ['lv_415_centralized', '415V Centralized', 0.415, 'LV', 1],
    ['lv_415_distributed', 'Distributed 415V', 0.415, 'LV', 2],
    ['mv_6_6_radial', '6.6kV Radial', 6.6, 'MV', 3],
    ['mv_11_radial', '11kV Radial', 11, 'MV', 4],
    ['mv_11_ring', '11kV Ring', 11, 'MV', 5]
  ];
  const candidates = candidateSpecs.map(([id, name, voltageKv, voltageClass, reliabilityScore]) => {
    const currentA = calculateCurrentA(designKw, voltageKv, pf);
    const voltageDropPct = estimateVoltageDropPct({
      currentA,
      voltageKv,
      distanceM: Math.max(1, distance),
      conductor: voltageClass === 'LV' ? 'CU' : 'AL',
      sizeMm2: voltageClass === 'LV' ? 630 : 240,
      parallelRuns: voltageClass === 'LV' ? Math.max(1, Math.ceil(currentA / 680)) : 1,
      pf
    });
    let status = 'PASS';
    const reasons = [];
    if (voltageClass === 'LV' && currentA > 2500) {
      status = 'FAIL';
      reasons.push('High 415V current');
    }
    if (voltageClass === 'LV' && distance > 200 && designKw > 500) {
      status = status === 'FAIL' ? 'FAIL' : 'REVIEW';
      reasons.push('Long LV route');
    }
    if (id === 'mv_6_6_radial' && existingMv === 6.6) reasons.push('Matches existing 6.6kV system');
    if (id === 'mv_11_radial' && newMvSystem) reasons.push('Malaysia new MV system screening option');
    if (id === 'mv_11_ring' && (designKw > 3000 || distance > 500)) reasons.push('Expansion and long-distance reliability option');
    const score = reliabilityScore
      + (status === 'PASS' ? 3 : status === 'REVIEW' ? 1 : -4)
      + (id === 'mv_6_6_radial' && existingMv === 6.6 ? 4 : 0)
      + (id.startsWith('mv_11') && newMvSystem ? 2 : 0)
      + (id === 'mv_11_ring' && designKw > 3000 ? 3 : 0)
      + (id === 'mv_11_ring' && distance > 500 ? 3 : 0)
      + (id === 'lv_415_distributed' && !mvRecommended ? 2 : 0);
    return {
      id,
      name,
      voltageKv,
      voltageClass,
      currentA: round(currentA, 2),
      voltageDropPct: round(voltageDropPct, 2),
      reliabilityScore,
      status,
      score,
      reasons
    };
  });
  const eligible = candidates.filter(candidate => candidate.status !== 'FAIL');
  const recommended = (eligible.length ? eligible : candidates)
    .reduce((best, candidate) => candidate.score > best.score ? candidate : best, candidates[0]);
  return {
    candidates,
    recommendedId: recommended.id,
    recommendation: `${recommended.name} is preferred for concept screening; compare CAPEX, cable count, protection complexity and local O&M before final design.`,
    disclaimer: 'Experience-rule architecture screening only; not a statutory requirement or final engineering design.'
  };
}

function buildProtectionMatrix(project, electrical) {
  const needsMv = Boolean(electrical.mvRecommended);
  const gridMode = String(project.site.gridMode || '').toLowerCase();
  const island = gridMode.includes('island') || gridMode.includes('off');
  return {
    functions: [
      { code: 'OVERCURRENT', label: 'Overcurrent', status: 'REQUIRED', notes: 'Feeder, bus and source protection review.' },
      { code: 'EARTH_FAULT', label: 'Earth Fault', status: 'REQUIRED', notes: 'Coordinate with earthing system and neutral treatment.' },
      { code: 'UNDER_OVER_VOLTAGE', label: 'U/O Voltage', status: 'REQUIRED', notes: 'Concept function only; no final setting.' },
      { code: 'UNDER_OVER_FREQUENCY', label: 'U/O Frequency', status: 'REQUIRED', notes: 'Required for island/grid-forming operation.' },
      { code: 'REVERSE_POWER', label: 'Reverse Power', status: island ? 'REVIEW' : 'REQUIRED', notes: 'Check genset and grid/PCC export behavior.' },
      { code: 'SYNC_CHECK', label: 'Sync Check', status: 'REVIEW', notes: 'Required where genset/grid synchronization is automated.' },
      { code: 'ANTI_ISLANDING', label: 'Anti-Islanding', status: island ? 'REVIEW' : 'REQUIRED', notes: 'Grid-connected export paths require utility review.' },
      { code: 'TRANSFORMER_PROTECTION', label: 'Transformer Protection', status: needsMv ? 'REQUIRED' : 'REVIEW', notes: 'Applies to step-up/step-down transformer packages.' },
      { code: 'EMERGENCY_STOP', label: 'Emergency Stop', status: 'REQUIRED', notes: 'Coordinate BESS, PCS, genset and PV shutdown scope.' }
    ],
    disclaimer: 'Concept-stage protection matrix only; final relay settings, short-circuit study and coordination study are excluded.'
  };
}

function buildEmsStateMachine(project) {
  const island = String(project.site.gridMode || '').toLowerCase().includes('island');
  return {
    modes: [
      'PV_PRIORITY',
      'BATTERY_SUPPORT',
      'GENSET_SUPPORT',
      island ? 'ISLAND_OPERATION' : 'GRID_NORMAL',
      'BLACK_START',
      'LOAD_SHEDDING',
      'MAINTENANCE',
      'FAULT'
    ],
    operatorActions: [
      'Confirm genset remote start/stop availability.',
      'Define low SOC alarm and manual genset start path if no remote start exists.',
      'Confirm load shedding priority for critical and flexible loads.'
    ],
    disclaimer: 'EMS modes are budget-stage logic blocks and must be validated with vendor controller capability.'
  };
}

function standardTopologies() {
  return STANDARD_TOPOLOGY_META.map(meta => {
    const graph = normalizePowerTopology(buildStandardTopologyGraph(meta.id), meta.id);
    return {
      ...meta,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      nodes: graph.nodes,
      edges: graph.edges
    };
  });
}

function topologyHasMvDistribution(topology = {}) {
  const nodes = Array.isArray(topology.nodes) ? topology.nodes : [];
  const edges = Array.isArray(topology.edges) ? topology.edges : [];
  return nodes.some(node => isMvNode(node))
    || edges.some(edge => edge.type === 'AC_MV_POWER' || asNumber(edge.voltageV, 0) >= 6000);
}

function isMvArchitecture(candidate = {}) {
  return candidate.voltageClass === 'MV' || asNumber(candidate.voltageKv, 0) >= 6.6 || String(candidate.id || '').startsWith('mv_');
}

function buildTopologySelection(project = {}, electricalArchitecture = {}) {
  const candidates = Array.isArray(electricalArchitecture.candidates) ? electricalArchitecture.candidates : [];
  const passArchitectures = candidates.filter(candidate => candidate.status === 'PASS');
  const recommended = candidates.find(candidate => candidate.id === electricalArchitecture.recommendedId) || {};
  const recommendedMvPass = recommended.status === 'PASS' && isMvArchitecture(recommended);
  const passRequiresMv = passArchitectures.length > 0 && passArchitectures.every(candidate => isMvArchitecture(candidate));
  const requiresMvTopology = Boolean(recommendedMvPass || passRequiresMv);
  const allTopologies = standardTopologies();
  const selectableTopologies = allTopologies.filter(topology => !requiresMvTopology || topologyHasMvDistribution(topology));
  const blockedTopologies = allTopologies
    .filter(topology => !selectableTopologies.some(item => item.id === topology.id))
    .map(topology => ({
      ...topology,
      blockedReason: 'Electrical recommended architecture is MV PASS; common 415V bus-only topologies are locked.'
    }));
  const selectedTopologyId = String(project.selectedTopologyId || project.topology?.selectedTopologyId || 'C5').toUpperCase();
  return {
    requiresMvTopology,
    recommendedArchitectureId: electricalArchitecture.recommendedId || '',
    passArchitectureIds: passArchitectures.map(candidate => candidate.id),
    selectableTopologies,
    blockedTopologies,
    selectedTopologyId,
    selectedTopologyAllowed: selectedTopologyId === 'CUSTOM' || selectableTopologies.some(topology => topology.id === selectedTopologyId),
    message: requiresMvTopology
      ? 'Electrical PASS recommendation is MV; EMS Flow topology selection is limited to MV-capable C5/C7 layouts.'
      : 'Electrical PASS recommendation allows LV common-bus and MV-capable topology layouts.'
  };
}

function isMvNode(node) {
  return node?.type === 'MV_BUS' || node?.type === 'MV_SWITCHBOARD' || asNumber(node?.electrical?.voltageV, 0) >= 6000;
}

function isLvSourceNode(node) {
  const voltage = asNumber(node?.electrical?.voltageV, 0);
  return ['PV_INVERTER', 'PCS', 'GENSET', 'LV_BUS', 'LV_SWITCHBOARD', 'HYBRID_INVERTER'].includes(node?.type)
    || (voltage > 0 && voltage < 1000);
}

function validationIssue(level, code, edge, message, suggestedFix = null) {
  return {
    level,
    code,
    edgeId: edge?.id || '',
    source: edge?.source || '',
    target: edge?.target || '',
    message,
    ...(suggestedFix ? { suggestedFix } : {})
  };
}

function validatePowerTopology(topology = {}) {
  const nodes = Array.isArray(topology.nodes) ? topology.nodes : [];
  const edges = Array.isArray(topology.edges) ? topology.edges : [];
  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  const errors = [];
  const warnings = [];
  for (const edge of edges) {
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    if (!source || !target) {
      errors.push(validationIssue('ERROR', 'MISSING_NODE', edge, 'Edge source or target node is missing.'));
      continue;
    }
    if ((source.type === 'EMS' || target.type === 'EMS') && !['COMMUNICATION', 'CONTROL'].includes(edge.type)) {
      errors.push(validationIssue('ERROR', 'EMS_POWER_EDGE_INVALID', edge, 'EMS may only connect through communication or control edges.', { changeEdgeType: 'COMMUNICATION' }));
    }
    if (source.type === 'PV_ARRAY' && ['LV_BUS', 'MV_BUS', 'LV_SWITCHBOARD', 'MV_SWITCHBOARD', 'LOAD', 'CRITICAL_LOAD_PANEL'].includes(target.type)) {
      errors.push(validationIssue('ERROR', 'PV_INVERTER_REQUIRED', edge, 'PV array cannot connect directly to an AC bus or load.', { insertNode: 'PV_INVERTER' }));
    }
    if (source.type === 'BATTERY' && ['LV_BUS', 'MV_BUS', 'LV_SWITCHBOARD', 'MV_SWITCHBOARD', 'LOAD', 'CRITICAL_LOAD_PANEL'].includes(target.type)) {
      errors.push(validationIssue('ERROR', 'BATTERY_INVERTER_REQUIRED', edge, 'Battery requires PCS or hybrid inverter before AC connection.', { insertNode: 'PCS' }));
    }
    if (edge.type === 'AC_MV_POWER' && isLvSourceNode(source) && isMvNode(target) && source.type !== 'TRANSFORMER' && target.type !== 'TRANSFORMER') {
      errors.push(validationIssue('ERROR', 'TRANSFORMER_REQUIRED', edge, `${source.label} cannot connect directly to ${target.label} at MV voltage.`, { insertNode: 'TRANSFORMER' }));
    }
    if (['LOAD', 'CRITICAL_LOAD_PANEL'].includes(target.type) && !['LV_BUS', 'LV_SWITCHBOARD', 'MV_BUS', 'MV_SWITCHBOARD', 'TRANSFORMER', 'ATS', 'STS'].includes(source.type)) {
      warnings.push(validationIssue('WARNING', 'BUS_OR_SWITCHBOARD_RECOMMENDED', edge, 'Loads normally connect through a bus, switchboard, transformer, ATS or STS rather than directly from a source.'));
    }
  }
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    suggestedFixes: [...errors, ...warnings]
      .filter(issue => issue.suggestedFix)
      .map(issue => ({ edgeId: issue.edgeId, code: issue.code, ...issue.suggestedFix })),
    disclaimer: 'Topology validation is a concept-stage design check and does not replace detailed SLD or licensed engineering review.'
  };
}

function topologyFlowNodeLabel(node = {}) {
  const typeLabels = {
    PV_ARRAY: 'PV',
    PV_INVERTER: 'PV Inverter',
    HYBRID_INVERTER: 'Hybrid Inverter',
    BATTERY: 'Battery',
    PCS: 'PCS',
    GENSET: 'Genset',
    LV_BUS: 'LV BUS',
    MV_BUS: 'MV BUS',
    LV_SWITCHBOARD: 'LV Switchboard',
    MV_SWITCHBOARD: 'MV Switchboard',
    TRANSFORMER: node.id?.includes('load') ? 'Load TX' : 'Step-up TX',
    ATS: 'ATS',
    STS: 'STS',
    LOAD: 'Load',
    CRITICAL_LOAD_PANEL: 'Critical Load',
    EMS: 'EMS',
    SCADA: 'SCADA',
    METER: 'Meter'
  };
  const label = String(node.label || '').trim();
  if (/ring\s*rmu/i.test(label)) return 'Ring RMU';
  if (/mv\s*switchboard/i.test(label)) return 'MV Switchboard';
  if (/load\s*tx/i.test(label)) return 'Load TX';
  if (/step[-\s]*up/i.test(label)) return 'Step-up TX';
  return typeLabels[node.type] || label || String(node.type || 'Node').replaceAll('_', ' ');
}

function topologyFlowRole(edge = {}, source = {}, target = {}) {
  if (edge.type === 'COMMUNICATION' || edge.type === 'CONTROL') return 'control';
  if (['lv-pcs-charge', 'mv-bess-charge', 'bess-tx-pcs-charge'].includes(edge.id)) return 'battery';
  if (source.type === 'PV_ARRAY' || source.type === 'PV_INVERTER' || target.type === 'PV_INVERTER') return 'pv';
  if (source.type === 'BATTERY' || target.type === 'BATTERY' || source.type === 'PCS' || target.type === 'PCS') return 'battery';
  if (source.type === 'GENSET' || target.type === 'GENSET') return 'genset';
  return edge.type === 'AC_MV_POWER' ? 'mv' : 'load';
}

function topologyFlowKeysForEdge(edge = {}, source = {}, target = {}) {
  if (edge.type === 'COMMUNICATION' || edge.type === 'CONTROL') return [];
  const edgeFlowKeys = {
    'pv-dc': ['pvOutputKw'],
    'pv-lv': ['pvToLoadKw'],
    'pv-tx-lv': ['pvToLoadKw'],
    'pv-mv': ['pvToLoadKw'],
    'lv-pcs-charge': ['pvToBatteryKw'],
    'mv-bess-charge': ['pvToBatteryKw'],
    'bess-tx-pcs-charge': ['pvToBatteryKw'],
    'pcs-battery-charge': ['pvToBatteryKw'],
    'battery-pcs-discharge': ['batteryToLoadKw'],
    'pcs-lv-discharge': ['batteryToLoadKw'],
    'pcs-tx-discharge': ['batteryToLoadKw'],
    'bess-mv-discharge': ['batteryToLoadKw'],
    'genset-lv': ['gensetToLoadKw'],
    'dg-tx-lv': ['gensetToLoadKw'],
    'dg-mv': ['gensetToLoadKw']
  };
  if (edgeFlowKeys[edge.id]) return edgeFlowKeys[edge.id];
  if (source.type === 'PV_ARRAY') return ['pvOutputKw'];
  if (source.type === 'PV_INVERTER' || target.type === 'PV_INVERTER') return ['pvToLoadKw'];
  if (source.type === 'BATTERY' || target.type === 'BATTERY') return edge.direction === 'BIDIRECTIONAL' ? ['pvToBatteryKw', 'batteryToLoadKw'] : ['batteryToLoadKw'];
  if (source.type === 'PCS' || target.type === 'PCS') return edge.direction === 'BIDIRECTIONAL' ? ['pvToBatteryKw', 'batteryToLoadKw'] : ['batteryToLoadKw'];
  if (source.type === 'GENSET' || target.type === 'GENSET') return ['gensetToLoadKw'];
  if (target.type === 'LOAD' || target.type === 'CRITICAL_LOAD_PANEL') return ['loadKw'];
  if (edge.type === 'AC_MV_POWER' || source.type === 'TRANSFORMER' || target.type === 'TRANSFORMER') return ['loadKw'];
  return ['loadKw'];
}

function topologyFlowKeyModeForEdge(edge = {}, flowKeys = []) {
  if (edge.type === 'COMMUNICATION' || edge.type === 'CONTROL') return 'none';
  if (edge.direction === 'BIDIRECTIONAL' || flowKeys.length > 1) return 'net';
  return 'single';
}

function buildTopologyFlowAdapter(topology = {}, validation = validatePowerTopology(topology)) {
  const nodes = Array.isArray(topology.nodes) ? topology.nodes : [];
  const edges = Array.isArray(topology.edges) ? topology.edges : [];
  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  const errorEdgeIds = new Set((validation.errors || []).map(issue => issue.edgeId).filter(Boolean));
  const warningEdgeIds = new Set((validation.warnings || []).map(issue => issue.edgeId).filter(Boolean));
  const flowNodes = nodes.map(node => ({
    id: node.id,
    type: node.type,
    label: topologyFlowNodeLabel(node),
    sourceLabel: node.label,
    position: {
      x: asNumber(node.position?.x, 0),
      y: asNumber(node.position?.y, 0)
    },
    voltageV: asNumber(node.electrical?.voltageV, 0),
    ratedPowerKw: asNumber(node.electrical?.ratedPowerKw, 0)
  }));
  const flowEdges = edges.map(edge => {
    const source = nodeMap.get(edge.source) || {};
    const target = nodeMap.get(edge.target) || {};
    const blocked = errorEdgeIds.has(edge.id);
    const warning = warningEdgeIds.has(edge.id);
    const role = blocked ? 'blocked' : topologyFlowRole(edge, source, target);
    const flowKeys = blocked ? [] : topologyFlowKeysForEdge(edge, source, target);
    const flowKeyMode = topologyFlowKeyModeForEdge(edge, flowKeys);
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: edge.type,
      direction: edge.direction,
      voltageV: asNumber(edge.voltageV, 0),
      role,
      blocked,
      warning,
      flowKeys,
      flowKeyMode
    };
  });
  return {
    topologyId: topology.selectedTopologyId || 'C5',
    validationBlocked: Boolean(validation.errors?.length),
    nodes: flowNodes,
    edges: flowEdges,
    flowBindings: flowEdges.map(edge => ({
      edgeId: edge.id,
      role: edge.role,
      flowKeys: edge.flowKeys,
      flowKeyMode: edge.flowKeyMode,
      blocked: edge.blocked
    })),
    disclaimer: 'Topology-aware EMS Flow is a budget-stage operating schematic. Validate the final SLD, protection study and controller sequence before construction.'
  };
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
  const transformerSizing = buildTransformerSizing(designKw, pf, 0.85);
  const electricalArchitecture = buildElectricalArchitecture(project, designKw, pf, distance, lvCurrentA, mvRecommended);
  const cableScreening = buildCableScreening(project, designKw, pf);
  return {
    designKw,
    roundedPvMwp,
    lvCurrentA,
    voltageOptions,
    flags,
    mvRecommended,
    architecture,
    architectureCandidates: electricalArchitecture.candidates,
    architectureRecommendedId: electricalArchitecture.recommendedId,
    transformerSizing,
    cableScreening,
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
  if (recommended.hasCapacityOverride) {
    risks.push({ level: 'Medium', area: 'Sizing', issue: 'Manual capacity override is active; calculated recommendation should remain auditable before final quote.' });
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
          pcsLimitKw: round(pcsKw, 2),
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
  const calculatedSchemes = getSchemeTargetsForProject(project).map(target => calculateScheme(project, load, target, now));
  const calculatedRecommended = pickRecommendedScheme(calculatedSchemes, project.designTargets.replacementPct);
  const recommended = applyCapacityOverridesToScheme(project, calculatedRecommended);
  const schemes = calculatedSchemes.map(scheme => scheme.id === recommended.id ? recommended : scheme);
  const electrical = calculateElectrical(project, recommended);
  const electricalArchitecture = {
    candidates: electrical.architectureCandidates || [],
    recommendedId: electrical.architectureRecommendedId || '',
    recommendation: (electrical.architectureCandidates || []).some(candidate => candidate.id === electrical.architectureRecommendedId)
      ? `${(electrical.architectureCandidates || []).find(candidate => candidate.id === electrical.architectureRecommendedId).name} is preferred for this concept screen.`
      : electrical.recommendation,
    disclaimer: 'Experience-rule architecture screening only; not a statutory requirement or final engineering design.'
  };
  const cableScreening = electrical.cableScreening || { candidates: [] };
  let topologySelection = buildTopologySelection(project, electricalArchitecture);
  let topologyProject = project;
  if (project.selectedTopologyId !== 'CUSTOM' && !topologySelection.selectedTopologyAllowed && topologySelection.selectableTopologies.length) {
    const autoSelectedTopologyId = topologySelection.selectableTopologies[0].id;
    topologyProject = {
      ...project,
      selectedTopologyId: autoSelectedTopologyId,
      topology: normalizePowerTopology({ selectedTopologyId: autoSelectedTopologyId }, autoSelectedTopologyId)
    };
    topologySelection = {
      ...topologySelection,
      selectedTopologyId: autoSelectedTopologyId,
      selectedTopologyAllowed: true,
      autoSelectedTopologyId,
      message: `${topologySelection.message} Current LV-only topology is displayed as ${autoSelectedTopologyId} until a valid topology is selected.`
    };
  }
  const topologyValidation = validatePowerTopology(topologyProject.topology);
  const topologyFlow = buildTopologyFlowAdapter(topologyProject.topology, topologyValidation);
  const protectionMatrix = buildProtectionMatrix(project, electrical);
  const emsStateMachine = buildEmsStateMachine(project);
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
    }),
    ...buildCapacityOverrideTraces(project, recommended, now)
  ];

  return {
    ...topologyProject,
    load,
    solar: project.solarResource,
    schemes,
    recommendedSchemeId: recommended.id,
    standardTopologies: standardTopologies(),
    topologyValidation,
    topologyFlow,
    topologySelection,
    electrical,
    electricalArchitecture,
    cableScreening,
    protectionMatrix,
    emsStateMachine,
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
    targetPvMwp: asNumber(targetPvMwp, 0),
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
