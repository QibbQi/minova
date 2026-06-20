(function(global){
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
  totalStringInputs: 0,
  standardTopologyLibrary: null
});

const SCHEME_TARGETS = [
  { id: 'replace-50', label: '50% Diesel Replacement', replacementPct: 50, priority: 'Conservative' },
  { id: 'replace-80', label: '80% Recommended Replacement', replacementPct: 80, priority: 'Recommended' },
  { id: 'replace-100', label: '100% Theoretical Replacement', replacementPct: 100, priority: 'Theoretical' }
];

const POWER_NODE_TYPES = [
  'GRID', 'PV_ARRAY', 'PV_INVERTER', 'BATTERY', 'PCS', 'HYBRID_INVERTER', 'GENSET',
  'LV_BUS', 'MV_BUS', 'MV_SWITCHBOARD', 'LV_SWITCHBOARD', 'TRANSFORMER',
  'METER', 'ATS', 'STS', 'LOAD', 'CRITICAL_LOAD_PANEL', 'CURTAILMENT', 'EMS', 'SCADA'
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

const STANDARD_TOPOLOGY_LIBRARY_VERSION = 2;

const ARCHITECTURE_TOPOLOGY_MAP = {
  lv_415_centralized: { topologyId: 'C3', voltageV: 415, variantId: 'lv_415_centralized' },
  lv_415_distributed: { topologyId: 'C3', voltageV: 415, variantId: 'lv_415_distributed' },
  lv_800_microgrid: { topologyId: 'C3', voltageV: 800, variantId: 'lv_800_microgrid' },
  mv_6_6_radial: { topologyId: 'C5', voltageV: 6600, variantId: 'mv_6_6_radial' },
  mv_11_radial: { topologyId: 'C5', voltageV: 11000, variantId: 'mv_11_radial' },
  mv_11_ring: { topologyId: 'C7', voltageV: 11000, variantId: 'mv_11_ring' }
};

const STANDARD_COMPONENT_CATALOG = [
  { id: 'pv-array-default', role: 'PV_ARRAY', type: 'PV_ARRAY', label: 'PV Array' },
  { id: 'pv-inverter-default', role: 'PV_INVERTER', type: 'PV_INVERTER', label: 'PV Inverter' },
  { id: 'battery-default', role: 'BATTERY', type: 'BATTERY', label: 'Battery' },
  { id: 'pcs-default', role: 'PCS', type: 'PCS', label: 'PCS' },
  { id: 'genset-default', role: 'GENSET', type: 'GENSET', label: 'Genset' },
  { id: 'lv-bus-default', role: 'LV_BUS', type: 'LV_BUS', label: 'Source LV BUS' },
  { id: 'lv-switchboard-card', role: 'LV_BUS', type: 'LV_SWITCHBOARD', label: 'Source LV Switchboard' },
  { id: 'step-up-tx-default', role: 'TRANSFORMER', type: 'TRANSFORMER', label: 'Step-up TX' },
  { id: 'mv-switchboard-default', role: 'MV_SWITCHBOARD', type: 'MV_SWITCHBOARD', label: 'MV Switchboard' },
  { id: 'mv-bus-default', role: 'MV_BUS', type: 'MV_BUS', label: 'MV BUS' },
  { id: 'ring-rmu-card', role: 'MV_BUS', type: 'MV_BUS', label: 'Ring RMU' },
  { id: 'load-tx-default', role: 'TRANSFORMER', type: 'TRANSFORMER', label: 'Load TX' },
  { id: 'load-default', role: 'LOAD', type: 'LOAD', label: 'Load' },
  { id: 'ems-default', role: 'EMS', type: 'EMS', label: 'EMS Controller' },
  { id: 'curtailment-default', role: 'CURTAILMENT', type: 'CURTAILMENT', label: 'Curtailment' }
];

const STANDARD_TRANSFORMER_KVA = [100, 160, 250, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500];

const EMS_FLOW_DISPLAY_SERIES = ['pv', 'load', 'battery', 'genset', 'soc'];

const EPC_BOQ_PACKAGES = Object.freeze([
  'PV System',
  'BESS',
  'Electrical Distribution',
  'EMS & Monitoring',
  'Auxiliary',
  'Documents & Certification'
]);

const EPC_LOCAL_800V_REFERENCE = Object.freeze({
  id: 'lv_800_microgrid',
  name: '800V Microgrid',
  pvMwp: 4,
  bessMwh: 10,
  pcsMw: 8,
  source: 'Local procurement BOQ reference',
  recommendation: 'Use as a high-reliability procurement reference, not as the default economic architecture.'
});
const FEEDER_ZONING_DEFAULTS = Object.freeze({
  voltageLv: 415,
  powerFactor: 0.85,
  maxVoltageDropPct: 5,
  maxFeederCurrentA: 800,
  mandatoryMeteringKw: 200,
  crusherMergeDistanceM: 100,
  pumpMaxAssetsPerFeeder: 3,
  proximityBucketM: 80,
  breakerMargin: 1.25,
  cableAmpacityMargin: 1.1,
  upstreamBreakerRatio: 1.6,
  cableResistanceOhmPerKm: 0.125
});
const FEEDER_DIVERSITY_FACTORS = Object.freeze({
  crusher: 0.9,
  screen: 0.7,
  pump: 0.8,
  vfd: 0.8,
  auxiliary: 0.5,
  load: 0.75
});
const EMS_FLOW_SERIES_DEFAULT_COLORS = {
  pv: '#f59e0b',
  load: '#2563eb',
  battery: '#16a34a',
  genset: '#ef4444',
  soc: '#0ea5e9'
};
const EMS_FLOW_INTERVAL_MINUTES = [1, 5, 15, 30, 60, 120, 360, 720];
const EMS_FLOW_X_AXIS_TICK_HOURS = [2, 3, 4, 6];
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
  if (raw.includes('asset') || raw.includes('feeder') || raw.includes('fuel_mapping')) return 'asset_genset_fuel_mapping';
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
  const rawTopologyFlowLabelOffsets = input.topologyFlowLabelOffsets && typeof input.topologyFlowLabelOffsets === 'object'
    ? input.topologyFlowLabelOffsets
    : {};
  const topologyFlowLabelOffsets = Object.fromEntries(Object.entries(rawTopologyFlowLabelOffsets)
    .map(([edgeId, offset]) => {
      const id = String(edgeId || '').trim();
      if (!id || !offset || typeof offset !== 'object') return null;
      return [id, {
        dx: clamp(offset.dx, -600, 600, 0),
        dy: clamp(offset.dy, -600, 600, 0)
      }];
    })
    .filter(Boolean));
  return {
    visibleSeries: visibleSeries.length ? visibleSeries : [...EMS_FLOW_DISPLAY_SERIES],
    mergeHourly: input.mergeHourly !== false,
    emsTableIntervalMinutes,
    intervalMinutes: EMS_FLOW_INTERVAL_MINUTES.includes(Number(input.intervalMinutes)) ? Number(input.intervalMinutes) : 5,
    xAxisTickHours: EMS_FLOW_X_AXIS_TICK_HOURS.includes(Number(input.xAxisTickHours)) ? Number(input.xAxisTickHours) : 'auto',
    selectedRange,
    peakBand: {
      visible: peakBandInput.visible === false ? false : true,
      color: normalizeLightHexColor(peakBandColor, '#fee2e2'),
      startMinute,
      endMinute: endMinute > startMinute ? endMinute : Math.min(24 * 60, startMinute + 60)
    },
    topologyFlowLabelOffsets,
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
  if (method === 'asset_genset_fuel_mapping') return 'Asset + Genset Fuel Mapping';
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
    componentId: String(node.componentId || ''),
    componentRole: String(node.componentRole || componentRoleForNode({ type })).trim(),
    componentIcon: String(node.componentIcon || ''),
    busOrientation: String(node.busOrientation || '').trim(),
    loadSplitId: String(node.loadSplitId || '').trim(),
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
    protectionRef: String(edge.protectionRef || ''),
    loadSplitId: String(edge.loadSplitId || '').trim(),
    route: edge.route && typeof edge.route === 'object'
      ? {
        manualRoute: Boolean(edge.route.manualRoute),
        locked: Boolean(edge.route.locked),
        waypoints: Array.isArray(edge.route.waypoints)
          ? edge.route.waypoints.map(point => ({ x: asNumber(point?.x, 0), y: asNumber(point?.y, 0) }))
          : []
      }
      : undefined
  };
}

function normalizeLoadCount(value) {
  const n = Math.round(asNumber(value, 1));
  return Math.min(12, Math.max(1, Number.isFinite(n) ? n : 1));
}

function normalizeAssetType(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (raw.includes('crusher') || raw.includes('jaw') || raw.includes('cone') || raw.includes('vsi') || raw.includes('gyratory') || raw.includes('lokotrack')) return 'crusher';
  if (raw.includes('screen') || raw.includes('conveyor')) return 'screen';
  if (raw.includes('pump')) return 'pump';
  if (raw.includes('vfd') || raw.includes('variable_frequency')) return 'vfd';
  if (raw.includes('meter')) return 'metering';
  if (raw.includes('light') || raw.includes('workshop') || raw.includes('aux')) return 'auxiliary';
  return raw || 'load';
}

function normalizeAssetGroup(row = {}, index = 0) {
  const assetType = normalizeAssetType(row.assetType || row.type || row.feederType);
  const assetCount = Math.max(0, Math.round(asNumber(row.assetCount ?? row.count ?? row.quantity, 1)));
  const feederCabinetQty = Math.max(0, Math.round(asNumber(row.feederCabinetQty ?? row.feederQty ?? row.cabinetQty, assetCount > 0 ? 1 : 0)));
  return {
    id: String(row.id || `asset-group-${index + 1}`).trim() || `asset-group-${index + 1}`,
    zone: String(row.zone || row.area || row.plant || '').trim() || 'Common',
    label: String(row.label || row.name || row.equipment || `${assetType} branch ${index + 1}`).trim(),
    assetType,
    assetCount,
    ratedKw: asNumber(row.ratedKw ?? row.powerKw, 0),
    ratedKva: asNumber(row.ratedKva ?? row.kva, 0),
    feederType: normalizeAssetType(row.feederType || assetType),
    feederCabinetQty,
    vfdCabinetQty: Math.max(0, Math.round(asNumber(row.vfdCabinetQty ?? row.vfdQty, assetType === 'vfd' ? feederCabinetQty : 0))),
    meteringCabinetQty: Math.max(0, Math.round(asNumber(row.meteringCabinetQty ?? row.meteringQty, 0))),
    ratioPct: Math.max(0, asNumber(row.ratioPct ?? row.percent ?? row.allocationPct, 0)),
    source: String(row.source || '').trim()
  };
}

function normalizeAssetGroups(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((row, index) => normalizeAssetGroup(row, index))
    .filter(row => row.assetCount > 0 || row.feederCabinetQty > 0 || row.ratioPct > 0);
}

function normalizeGensetAssets(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((row, index) => {
      const ratedKva = asNumber(row?.ratedKva ?? row?.kva, 0);
      const ratedKw = asNumber(row?.ratedKw ?? row?.kw, 0);
      const fuelLiters = asNumber(row?.fuelLiters ?? row?.dieselLiters, 0);
      const explicitMethod = normalizeGensetEstimateMethod(row?.estimateMethod ?? row?.generationMethod);
      const hasCapacityProfile = ratedKva > 0 || ratedKw > 0;
      const estimateMethod = explicitMethod === 'kva_profile' && !hasCapacityProfile && fuelLiters > 0
        ? 'fuel_sfc'
        : explicitMethod || (fuelLiters > 0 ? 'fuel_sfc' : 'kva_profile');
      return {
        id: String(row?.id || `genset-${index + 1}`).trim() || `genset-${index + 1}`,
        zone: String(row?.zone || row?.area || row?.plant || '').trim() || 'Common',
        label: String(row?.label || row?.name || `Genset ${index + 1}`).trim(),
        name: String(row?.name || row?.label || `Genset ${index + 1}`).trim(),
        estimateMethod,
        ratedKva,
        ratedKw,
        powerFactor: clamp(row?.powerFactor ?? row?.pf, 0.1, 1, 0.8),
        loadFactor: clamp(row?.loadFactor ?? row?.gensetLoadFactor, 0, 1, 0.7),
        overloadFactor: clamp(row?.overloadFactor ?? row?.peakFactor, 0, 1.5, 0.95),
        assetCode: String(row?.assetCode || row?.code || '').trim(),
        supportedAssetIds: normalizeIdList(row?.supportedAssetIds ?? row?.assetIds ?? row?.supportedAssets),
        fuelLiters,
        fuelPeriodDays: Math.max(1, asNumber(row?.fuelPeriodDays ?? row?.dieselPeriodDays, 1)),
        runtimeHours: asNumber(row?.runtimeHours ?? row?.fuelRuntimeHours ?? row?.hours, 0),
        hoursPerDay: asNumber(row?.hoursPerDay ?? row?.runtimeHours ?? row?.fuelRuntimeHours ?? row?.hours, 0),
        sfcLPerKwh: asNumber(row?.sfcLPerKwh ?? row?.dieselSfcLPerKwh, EPC_DESIGN_DEFAULTS.dieselSfcLPerKwh)
      };
    })
    .filter(row => row.id || row.label);
}

function normalizeGensetEstimateMethod(value = '') {
  const raw = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['kva_profile', 'kva', 'rated_kva', 'load_factor'].includes(raw)) return 'kva_profile';
  if (['fuel_sfc', 'fuel', 'sfc', 'diesel_sfc'].includes(raw)) return 'fuel_sfc';
  return '';
}

function normalizeAssetGensetLoadBasis(value = '') {
  const raw = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['asset_list', 'assets', 'asset', 'load_asset_list'].includes(raw)) return 'asset_list';
  if (['genset_fuel_mapping', 'fuel_mapping', 'genset_fuel', 'fuel_sfc', 'fuel'].includes(raw)) return 'genset_fuel_mapping';
  return 'genset_fuel_mapping';
}

function normalizeIdList(value = []) {
  if (Array.isArray(value)) {
    return value.map(item => String(item || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(/[,;|/]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizeStartType(value = '') {
  const raw = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (raw.includes('vfd')) return 'vfd';
  if (raw.includes('soft')) return 'soft_start';
  if (raw.includes('dol')) return 'DOL';
  return raw || '';
}

function normalizeAssetInputs(value = [], options = {}) {
  const fallbackHours = asNumber(options.operationHoursPerDay, 8);
  return (Array.isArray(value) ? value : [])
    .map((row, index) => {
      const rawType = String(row?.assetType || row?.type || row?.equipmentType || '').trim();
      const type = normalizeAssetType(rawType);
      const quantity = Math.max(1, Math.round(asNumber(row?.qty ?? row?.quantity ?? row?.assetCount, 1)));
      const rawName = String(row?.name || row?.label || row?.equipment || '').trim();
      const rawId = String(row?.id || row?.assetId || '').trim();
      const name = String(rawName || `${type} ${index + 1}`).trim();
      const id = String(rawId || idSafe(name) || `asset-${index + 1}`).trim() || `asset-${index + 1}`;
      const operationHours = clamp(row?.operationHours ?? row?.hours ?? row?.runtimeHours, 0, 24, fallbackHours);
      const zone = String(row?.zone || row?.areaZone || row?.plant || '').trim() || 'Common';
      const line = String(row?.line || row?.productionLine || '').trim();
      const area = String(row?.area || row?.location || '').trim();
      const conveyorSystem = String(row?.conveyorSystem || row?.conveyor || '').trim();
      const kw = asNumber(row?.kw ?? row?.ratedKw ?? row?.powerKw, 0);
      const distanceM = Math.max(0, asNumber(row?.distanceM ?? row?.distance_m, 0));
      const assignedGensetIds = normalizeIdList(row?.assignedGensetIds ?? row?.gensetIds ?? row?.gensetId);
      const hasExplicitId = Boolean(rawId && !/^asset-\d+$/i.test(rawId));
      const hasDraftContent = Boolean(
        rawName ||
        hasExplicitId ||
        rawType ||
        zone !== 'Common' ||
        line ||
        area ||
        conveyorSystem ||
        kw > 0 ||
        distanceM > 0 ||
        operationHours > 0 ||
        assignedGensetIds.length
      );
      return {
        id,
        name,
        label: name,
        type,
        assetType: type,
        zone,
        line,
        area,
        conveyorSystem,
        kw,
        qty: quantity,
        startTime: normalizeTime(row?.startTime ?? row?.operationStartTime ?? row?.startAt, '00:00'),
        startType: normalizeStartType(row?.startType ?? row?.start_type),
        distanceM,
        operationHours,
        dutyFactor: clamp(row?.dutyFactor ?? row?.duty ?? row?.loadFactor, 0, 1, 1),
        simultaneityFactor: clamp(row?.simultaneityFactor ?? row?.simultaneity ?? row?.coincidenceFactor, 0, 1, 1),
        assignedGensetIds,
        fuelLiters: asNumber(row?.fuelLiters ?? row?.dieselLiters, 0),
        fuelPeriodDays: Math.max(1, asNumber(row?.fuelPeriodDays ?? row?.dieselPeriodDays, 1)),
        fuelRuntimeHours: asNumber(row?.fuelRuntimeHours ?? row?.runtimeHours, 0),
        powerKnown: kw > 0,
        draftPowerMissing: !(kw > 0),
        hasDraftContent
      };
    })
    .filter(row => row.qty > 0 && (row.kw > 0 || row.hasDraftContent));
}

function reconcileAssetGensetMappings(assetInputs = [], gensets = []) {
  const assets = assetInputs.map(asset => ({ ...asset, assignedGensetIds: normalizeIdList(asset.assignedGensetIds) }));
  const gensetRows = gensets.map(genset => ({ ...genset, supportedAssetIds: normalizeIdList(genset.supportedAssetIds) }));
  const assetById = new Map(assets.map(asset => [asset.id, asset]));
  const gensetById = new Map(gensetRows.map(genset => [genset.id, genset]));
  gensetRows.forEach(genset => {
    genset.supportedAssetIds.forEach(assetId => {
      const asset = assetById.get(assetId);
      if (asset && !asset.assignedGensetIds.includes(genset.id)) asset.assignedGensetIds.push(genset.id);
    });
  });
  assets.forEach(asset => {
    asset.assignedGensetIds.forEach(gensetId => {
      const genset = gensetById.get(gensetId);
      if (genset && !genset.supportedAssetIds.includes(asset.id)) genset.supportedAssetIds.push(asset.id);
    });
  });
  const mappingWarnings = [];
  assets.forEach(asset => {
    if (!asset.assignedGensetIds.length) {
      mappingWarnings.push({
        id: `unmapped-asset-${asset.id}`,
        level: 'medium',
        assetId: asset.id,
        message: `Unmapped asset ${asset.id} has no assigned genset.`
      });
    }
  });
  return { assets, gensets: gensetRows, mappingWarnings };
}

function buildAssetTimeProfile(assetInputs = [], feeders = []) {
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, label: `${String(hour).padStart(2, '0')}:00`, loadKw: 0, assets: [] }));
  const feederProfiles = Object.fromEntries(feeders.map(feeder => [feeder.feederId, {
    feederId: feeder.feederId,
    zone: feeder.zone,
    hourly: Array.from({ length: 24 }, (_, hour) => ({ hour, loadKw: 0 })),
    peakProfileKw: 0,
    dailyKwh: 0
  }]));
  const feederByAsset = new Map();
  feeders.forEach(feeder => (feeder.assets || []).forEach(assetId => feederByAsset.set(assetId, feeder.feederId)));
  assetInputs.forEach(asset => {
    const startMinute = timeToMinutes(asset.startTime || '00:00', '00:00');
    const durationMinutes = Math.max(0, Math.round(asNumber(asset.operationHours, 0) * 60));
    if (!durationMinutes) return;
    const loadKw = asset.kw * asset.qty * asset.dutyFactor * asset.simultaneityFactor;
    const feederId = feederByAsset.get(asset.id);
    for (let offset = 0; offset < durationMinutes; offset += 60) {
      const hour = Math.floor(((startMinute + offset) % 1440) / 60);
      hourly[hour].loadKw = round(hourly[hour].loadKw + loadKw, 4);
      if (!hourly[hour].assets.includes(asset.id)) hourly[hour].assets.push(asset.id);
      if (feederId && feederProfiles[feederId]) {
        const feederHour = feederProfiles[feederId].hourly[hour];
        feederHour.loadKw = round(feederHour.loadKw + loadKw, 4);
      }
    }
  });
  Object.values(feederProfiles).forEach(profile => {
    profile.peakProfileKw = round(profile.hourly.reduce((max, row) => Math.max(max, row.loadKw), 0), 4);
    profile.dailyKwh = round(profile.hourly.reduce((sum, row) => sum + row.loadKw, 0), 4);
  });
  return {
    hourly: hourly.map(row => ({ ...row, loadKw: round(row.loadKw, 4) })),
    peakKw: round(hourly.reduce((max, row) => Math.max(max, row.loadKw), 0), 4),
    dailyKwh: round(hourly.reduce((sum, row) => sum + row.loadKw, 0), 4),
    feederProfiles: Object.values(feederProfiles)
  };
}

function calculateGensetGenerationRow(genset = {}, defaults = {}) {
  const method = normalizeGensetEstimateMethod(genset.estimateMethod) || 'fuel_sfc';
  const pf = clamp(genset.powerFactor, 0.1, 1, defaults.powerFactor || 0.8);
  const runtimeHours = Math.max(0, asNumber(genset.runtimeHours, 0) > 0
    ? asNumber(genset.runtimeHours, 0)
    : asNumber(genset.hoursPerDay, 0) > 0
      ? asNumber(genset.hoursPerDay, 0)
      : asNumber(defaults.runtimeHours, 0));
  const ratedKw = asNumber(genset.ratedKw, 0) > 0 ? asNumber(genset.ratedKw, 0) : asNumber(genset.ratedKva, 0) * pf;
  const loadFactor = clamp(genset.loadFactor, 0, 1, 0.7);
  const overloadFactor = clamp(genset.overloadFactor, 0, 1.5, 0.95);
  const sfc = Math.max(0.001, asNumber(genset.sfcLPerKwh, defaults.sfcLPerKwh || EPC_DESIGN_DEFAULTS.dieselSfcLPerKwh));
  const dailyFuel = asNumber(genset.fuelLiters, 0) / Math.max(1, asNumber(genset.fuelPeriodDays, 1));
  const dailyKwh = method === 'kva_profile'
    ? ratedKw * loadFactor * runtimeHours
    : dailyFuel > 0 ? dailyFuel / sfc : 0;
  const averageKw = runtimeHours > 0 ? dailyKwh / runtimeHours : 0;
  const peakSupportKw = ratedKw > 0 ? ratedKw * overloadFactor : averageKw;
  return {
    id: genset.id,
    name: genset.name || genset.label || genset.id,
    zone: genset.zone || 'Common',
    estimateMethod: method,
    ratedKva: asNumber(genset.ratedKva, 0),
    ratedKw: round(ratedKw, 4),
    powerFactor: round(pf, 4),
    loadFactor: round(loadFactor, 4),
    overloadFactor: round(overloadFactor, 4),
    runtimeHours: round(runtimeHours, 4),
    fuelLiters: asNumber(genset.fuelLiters, 0),
    fuelPeriodDays: Math.max(1, asNumber(genset.fuelPeriodDays, 1)),
    sfcLPerKwh: round(sfc, 4),
    dailyKwh: round(dailyKwh, 4),
    averageKw: round(averageKw, 4),
    peakSupportKw: round(peakSupportKw, 4),
    supportedAssetIds: normalizeIdList(genset.supportedAssetIds)
  };
}

function buildGensetGenerationSummary(gensets = [], defaults = {}) {
  const rows = gensets.map(genset => calculateGensetGenerationRow(genset, defaults));
  const fuelRows = rows.filter(row => row.estimateMethod === 'fuel_sfc' && row.dailyKwh > 0);
  const kvaRows = rows.filter(row => row.estimateMethod === 'kva_profile' && row.dailyKwh > 0);
  const totalFuelProfileDailyKwh = round(fuelRows.reduce((sum, row) => sum + row.dailyKwh, 0), 4);
  const totalKvaProfileDailyKwh = round(kvaRows.reduce((sum, row) => sum + row.dailyKwh, 0), 4);
  const energyBasisRows = fuelRows.length ? fuelRows : rows.filter(row => row.dailyKwh > 0);
  const energyBasisDailyKwh = round(energyBasisRows.reduce((sum, row) => sum + row.dailyKwh, 0), 4);
  return {
    rows,
    totalDailyKwh: round(rows.reduce((sum, row) => sum + row.dailyKwh, 0), 4),
    totalFuelProfileDailyKwh,
    totalKvaProfileDailyKwh,
    energyBasisDailyKwh,
    energyBasisMethod: fuelRows.length ? 'fuel_sfc' : energyBasisRows.length ? 'kva_profile' : 'none',
    energyBasisRuntimeHours: round(energyBasisRows.reduce((max, row) => Math.max(max, row.runtimeHours), 0), 4),
    totalAverageKw: round(rows.reduce((sum, row) => sum + row.averageKw, 0), 4),
    totalPeakSupportKw: round(rows.reduce((sum, row) => sum + row.peakSupportKw, 0), 4),
    maxRuntimeHours: round(rows.reduce((max, row) => Math.max(max, row.runtimeHours), 0), 4)
  };
}

function feederDiversityFactor(type = 'load') {
  return FEEDER_DIVERSITY_FACTORS[normalizeAssetType(type)] ?? FEEDER_DIVERSITY_FACTORS.load;
}

function normalizeFeederZoningRules(raw = {}) {
  const source = raw || {};
  return {
    maxFeederCurrentA: Math.max(1, asNumber(source.maxFeederCurrentA ?? source.max_feeder_current_a, FEEDER_ZONING_DEFAULTS.maxFeederCurrentA)) || FEEDER_ZONING_DEFAULTS.maxFeederCurrentA,
    mandatoryMeteringKw: Math.max(0, asNumber(source.mandatoryMeteringKw ?? source.mandatory_metering_kw, FEEDER_ZONING_DEFAULTS.mandatoryMeteringKw)),
    maxVoltageDropPct: Math.max(0.1, asNumber(source.maxVoltageDropPct ?? source.max_voltage_drop_pct ?? source.max_voltage_drop, FEEDER_ZONING_DEFAULTS.maxVoltageDropPct)) || FEEDER_ZONING_DEFAULTS.maxVoltageDropPct,
    crusherMergeDistanceM: Math.max(0, asNumber(source.crusherMergeDistanceM ?? source.crusher_merge_distance_m, FEEDER_ZONING_DEFAULTS.crusherMergeDistanceM)),
    pumpMaxAssetsPerFeeder: Math.max(1, Math.round(asNumber(source.pumpMaxAssetsPerFeeder ?? source.pump_max_assets_per_feeder, FEEDER_ZONING_DEFAULTS.pumpMaxAssetsPerFeeder))) || FEEDER_ZONING_DEFAULTS.pumpMaxAssetsPerFeeder,
    proximityBucketM: Math.max(1, asNumber(source.proximityBucketM ?? source.proximity_bucket_m, FEEDER_ZONING_DEFAULTS.proximityBucketM)) || FEEDER_ZONING_DEFAULTS.proximityBucketM
  };
}

function calculateFeederCurrentA(totalKw = 0, system = {}) {
  const voltage = Math.max(1, asNumber(system.voltageLv, FEEDER_ZONING_DEFAULTS.voltageLv));
  const pf = Math.max(0.1, asNumber(system.powerFactor, FEEDER_ZONING_DEFAULTS.powerFactor));
  return (Math.max(0, totalKw) * 1000) / (Math.sqrt(3) * voltage * pf);
}

function calculateFeederVoltageDropPct(currentA = 0, distanceM = 0, system = {}) {
  const voltage = Math.max(1, asNumber(system.voltageLv, FEEDER_ZONING_DEFAULTS.voltageLv));
  const resistance = asNumber(system.cableResistanceOhmPerKm, FEEDER_ZONING_DEFAULTS.cableResistanceOhmPerKm);
  return (Math.max(0, currentA) * resistance * (Math.max(0, distanceM) / 1000) / voltage) * 100;
}

function assetGensetClusterKey(asset = {}) {
  const ids = normalizeIdList(asset.assignedGensetIds).sort();
  return ids.length ? ids.join('+') : 'UNKNOWN';
}

function assetDistanceBucket(asset = {}, thresholdM = FEEDER_ZONING_DEFAULTS.proximityBucketM) {
  const distance = Math.max(0, asNumber(asset.distanceM, 0));
  if (!(distance > 0)) return 'unknown-distance';
  return `d${Math.floor(distance / Math.max(1, thresholdM))}`;
}

function assetHasProcessGroupingBasis(asset = {}) {
  return Boolean(String(asset.line || asset.area || asset.conveyorSystem || '').trim());
}

function assetSequenceHint(ids = []) {
  const parsed = ids.map(id => {
    const match = String(id || '').match(/([A-Za-z]+)\s*0*(\d+)$/);
    return match ? { prefix: match[1].toUpperCase(), number: Number(match[2]) } : null;
  }).filter(Boolean);
  if (parsed.length < 2) return false;
  const prefix = parsed[0].prefix;
  const numbers = parsed.map(item => item.number).sort((a, b) => a - b);
  return parsed.every(item => item.prefix === prefix)
    && numbers.every((number, index) => index === 0 || number - numbers[index - 1] <= 1);
}

function buildFeederAssumptionMeta(assets = [], system = {}) {
  if (!assets.length) return { assumed: false, confidenceScore: 100, confidenceBand: 'high', assumption: '', needsVerification: [] };
  const zones = new Set(assets.map(asset => asset.zone || 'Common'));
  const types = new Set(assets.map(asset => normalizeAssetType(asset.type)));
  const clusters = new Set(assets.map(asset => assetGensetClusterKey(asset)));
  const distances = assets.map(asset => Math.max(0, asNumber(asset.distanceM, 0))).filter(distance => distance > 0);
  const hasProcessBasis = assets.every(asset => assetHasProcessGroupingBasis(asset));
  const assumed = !hasProcessBasis;
  const distanceClose = distances.length > 1 ? Math.max(...distances) - Math.min(...distances) <= 80 : distances.length === 1;
  let score = 0;
  if (zones.size === 1) score += 30;
  if (types.size === 1) score += 25;
  if (clusters.size === 1 && !clusters.has('UNKNOWN')) score += 20;
  if (distanceClose) score += 15;
  if (assetSequenceHint(assets.map(asset => asset.id))) score += 10;
  if (types.size > 1) score -= 30;
  if (zones.size > 1) score -= 50;
  if (!hasProcessBasis) score -= 20;
  if (assets.some(asset => !(asset.kw > 0))) score -= 20;
  const confidenceScore = Math.max(0, Math.min(assumed ? 79 : 100, score));
  const confidenceBand = confidenceScore >= 80 ? 'high' : confidenceScore >= 60 ? 'medium' : confidenceScore >= 40 ? 'low' : 'review';
  return {
    assumed,
    confidenceScore,
    confidenceBand,
    assumption: assumed ? 'Grouped by zone + type + genset cluster + distance because line/area/conveyor is unknown.' : 'Grouped by explicit line/area/conveyor process basis.',
    needsVerification: assumed ? [
      'confirm same production line',
      'confirm motor kW',
      'confirm starter type',
      'confirm cable route'
    ] : []
  };
}

function feederGroupingKey(asset = {}, rules = FEEDER_ZONING_DEFAULTS) {
  const zone = asset.zone || 'Common';
  const type = normalizeAssetType(asset.type);
  const cluster = assetGensetClusterKey(asset);
  const zoningRules = normalizeFeederZoningRules(rules);
  const proximity = assetDistanceBucket(asset, zoningRules.proximityBucketM);
  if (type === 'vfd' || asset.startType === 'vfd') return `vfd:${asset.id}`;
  if (!assetHasProcessGroupingBasis(asset)) return `${type}:${zone}:cluster:${cluster}:${proximity}`;
  if (type === 'crusher') {
    const line = asset.line || 'line';
    return asset.distanceM > 0 && asset.distanceM < zoningRules.crusherMergeDistanceM ? `crusher:${zone}:${line}:near` : `crusher:${zone}:${line}:${asset.id}`;
  }
  if (type === 'screen') return `screen:${zone}:${asset.conveyorSystem || asset.line || asset.area || 'screen'}`;
  if (type === 'pump') return `pump:${zone}:${asset.area || asset.line || 'pump'}`;
  return `${type}:${zone}:${asset.area || asset.line || asset.id}`;
}

function buildFeederRow(assets = [], index = 0, system = {}, splitReason = '', rules = FEEDER_ZONING_DEFAULTS) {
  const zoningRules = normalizeFeederZoningRules(rules);
  const primary = assets[0] || {};
  const type = normalizeAssetType(primary.type || 'load');
  const assumptionMeta = buildFeederAssumptionMeta(assets, system);
  const connectedKw = assets.reduce((sum, asset) => sum + asset.kw * asset.qty, 0);
  const operatingKw = assets.reduce((sum, asset) => sum + asset.kw * asset.qty * asset.dutyFactor * asset.simultaneityFactor, 0);
  const dailyKwh = assets.reduce((sum, asset) => sum + asset.kw * asset.qty * asset.operationHours * asset.dutyFactor * asset.simultaneityFactor, 0);
  const distanceM = assets.reduce((max, asset) => Math.max(max, asset.distanceM), 0);
  const currentA = calculateFeederCurrentA(connectedKw, system);
  const breakerA = currentA * FEEDER_ZONING_DEFAULTS.breakerMargin;
  const cableAmpacityA = breakerA * FEEDER_ZONING_DEFAULTS.cableAmpacityMargin;
  const voltageDropPct = calculateFeederVoltageDropPct(currentA, distanceM, system);
  const meteringRequired = connectedKw > zoningRules.mandatoryMeteringKw;
  const assignedGensetIds = Array.from(new Set(assets.flatMap(asset => asset.assignedGensetIds || [])));
  const feederId = `${idSafe(primary.zone || 'zone')}-${idSafe(type)}-f${index + 1}`;
  const review = currentA > zoningRules.maxFeederCurrentA || voltageDropPct > zoningRules.maxVoltageDropPct;
  return {
    feederId,
    zone: primary.zone || 'Common',
    type,
    sourceBus: `${idSafe(primary.zone || 'zone').toUpperCase()}_${idSafe(assetGensetClusterKey(primary)).toUpperCase()}_CLUSTER_BUS`,
    assets: assets.map(asset => asset.id),
    assetNames: assets.map(asset => asset.name),
    assetCount: assets.reduce((sum, asset) => sum + asset.qty, 0),
    totalKw: round(connectedKw, 2),
    operatingKw: round(operatingKw, 2),
    dailyKwh: round(dailyKwh, 2),
    currentA: round(currentA, 2),
    breakerA: round(breakerA, 2),
    cableAmpacityA: round(cableAmpacityA, 2),
    voltageDropPct: round(voltageDropPct, 2),
    cableStatus: voltageDropPct > zoningRules.maxVoltageDropPct ? 'REVIEW' : 'PASS',
    distanceM: round(distanceM, 2),
    requiresVfd: type === 'vfd' || assets.some(asset => asset.startType === 'vfd'),
    meteringRequired,
    assignedGensetIds,
    splitReason,
    assumed: assumptionMeta.assumed,
    confidenceScore: assumptionMeta.confidenceScore,
    confidenceBand: assumptionMeta.confidenceBand,
    assumption: assumptionMeta.assumption,
    needsVerification: assumptionMeta.needsVerification,
    status: review ? 'REVIEW' : assumptionMeta.assumed ? 'ASSUMED' : 'PASS',
    source: 'feeder-zoning'
  };
}

function buildFeederRowsFromAssets(assets = [], system = {}, rules = FEEDER_ZONING_DEFAULTS) {
  const zoningRules = normalizeFeederZoningRules(rules);
  const grouped = new Map();
  assets.forEach(asset => {
    const key = feederGroupingKey(asset, zoningRules);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(asset);
  });
  const rows = [];
  let index = 0;
  for (const groupAssets of grouped.values()) {
    const row = buildFeederRow(groupAssets, index, system, '', zoningRules);
    if (row.type === 'pump' && row.assetCount > zoningRules.pumpMaxAssetsPerFeeder) {
      groupAssets.forEach(asset => {
        rows.push(buildFeederRow([asset], index, system, 'pump-count', zoningRules));
        index += 1;
      });
      continue;
    }
    if (row.currentA > zoningRules.maxFeederCurrentA && groupAssets.length > 1) {
      groupAssets.forEach(asset => {
        rows.push(buildFeederRow([asset], index, system, 'current-limit', zoningRules));
        index += 1;
      });
      continue;
    }
    rows.push({
      ...row,
      splitReason: row.currentA > zoningRules.maxFeederCurrentA ? 'current-limit' : row.splitReason
    });
    index += 1;
  }
  return rows;
}

function buildFeederZoning(assetInputs = [], gensets = [], options = {}) {
  const normalizedAssets = normalizeAssetInputs(assetInputs, options);
  const normalizedGensets = normalizeGensetAssets(gensets);
  const reconciled = reconcileAssetGensetMappings(normalizedAssets, normalizedGensets);
  const assets = reconciled.assets;
  const gensetRows = reconciled.gensets;
  const rules = normalizeFeederZoningRules(options.feederZoningRules || options);
  const system = {
    voltageLv: asNumber(options.voltageLv ?? options.voltage_lv, FEEDER_ZONING_DEFAULTS.voltageLv),
    powerFactor: asNumber(options.powerFactor ?? options.pf, FEEDER_ZONING_DEFAULTS.powerFactor),
    maxVoltageDropPct: rules.maxVoltageDropPct,
    cableResistanceOhmPerKm: asNumber(options.cableResistanceOhmPerKm, FEEDER_ZONING_DEFAULTS.cableResistanceOhmPerKm)
  };
  let feeders = buildFeederRowsFromAssets(assets, system, rules);
  const assetTimeProfile = buildAssetTimeProfile(assets, feeders);
  const profileByFeeder = new Map(assetTimeProfile.feederProfiles.map(profile => [profile.feederId, profile]));
  feeders = feeders.map(row => {
    const profile = profileByFeeder.get(row.feederId);
    return {
      ...row,
      peakProfileKw: round(profile?.peakProfileKw ?? row.operatingKw ?? row.totalKw, 4),
      profileDailyKwh: round(profile?.dailyKwh ?? row.dailyKwh, 4)
    };
  });
  const gensetGeneration = buildGensetGenerationSummary(gensetRows, {
    powerFactor: system.powerFactor,
    runtimeHours: options.operationHoursPerDay,
    sfcLPerKwh: options.sfcLPerKwh || EPC_DESIGN_DEFAULTS.dieselSfcLPerKwh
  });
  const zones = Array.from(new Set(assets.map(asset => asset.zone || 'Common')));
  const zoneDistances = Object.fromEntries(zones.map(zone => [
    zone,
    Math.max(0, ...assets.filter(asset => asset.zone === zone).map(asset => asset.distanceM))
  ]));
  const loadSplits = (() => {
    const total = feeders.reduce((sum, row) => sum + Math.max(0, row.peakProfileKw || row.operatingKw || row.totalKw), 0);
    if (!feeders.length) return [];
    const equalRatio = feeders.length ? Math.floor((100 / feeders.length) * 100) / 100 : 100;
    let assigned = 0;
    return feeders.map((row, index) => {
      const ratioPct = index === feeders.length - 1
        ? round(Math.max(0, 100 - assigned), 2)
        : total > 0
          ? round(((row.peakProfileKw || row.operatingKw || row.totalKw) / total) * 100, 2)
          : equalRatio;
      assigned += ratioPct;
      return {
        id: `load-${index + 1}`,
        label: `${row.zone} ${row.type} ${index + 1}`,
        ratioPct,
        assetGroupId: row.feederId,
        feederId: row.feederId,
        zone: row.zone,
        assetType: row.type,
        assets: row.assets.slice(),
        assetNames: row.assetNames.slice()
      };
    });
  })();
  const assetGroups = feeders.map((row, index) => ({
    id: row.feederId,
    zone: row.zone,
    label: `${row.zone} ${row.type} feeder ${index + 1}`,
    assetType: row.type,
    assetCount: row.assetCount,
    ratedKw: row.totalKw,
    ratedKva: round((row.operatingKw * feederDiversityFactor(row.type) * 1.25) / Math.max(0.1, system.powerFactor), 2),
    feederType: row.type,
    feederCabinetQty: 1,
    vfdCabinetQty: row.requiresVfd ? 1 : 0,
    meteringCabinetQty: row.meteringRequired ? 1 : 0,
    ratioPct: loadSplits[index]?.ratioPct || 0,
    source: 'feeder-zoning',
    feederId: row.feederId
  }));
  const transformers = feeders.map(row => ({
    feederId: row.feederId,
    zone: row.zone,
    kva: round((row.operatingKw * feederDiversityFactor(row.type) * 1.25) / Math.max(0.1, system.powerFactor), 2),
    diversityFactor: feederDiversityFactor(row.type)
  }));
  const cables = feeders.map(row => ({
    feederId: row.feederId,
    cable: `${Math.max(1, Math.ceil(row.cableAmpacityA / 400))}x(3C cable, final mm2 by vendor)`,
    ampacityA: row.cableAmpacityA,
    voltageDropPct: row.voltageDropPct,
    status: row.cableStatus
  }));
  const metering = feeders
    .filter(row => row.meteringRequired)
    .map(row => ({
      level: 'Feeder',
      pointId: `${row.feederId.toUpperCase()}_METER`,
      feederId: row.feederId,
      zone: row.zone,
      loadKw: row.totalKw
    }));
  const topologyRecommendations = [];
  if (zones.length > 1 || Object.values(zoneDistances).some(distance => distance > 200)) {
    topologyRecommendations.push({
      id: 'zone-split',
      severity: 'medium',
      recommendation: 'Use zone-aware feeder branches because assets are distributed across zones or long routes.'
    });
  }
  if (feeders.some(row => row.splitReason === 'current-limit')) {
    topologyRecommendations.push({
      id: 'split-high-current-feeder',
      severity: 'high',
      recommendation: 'Split feeder or move to MV/transformer branch where 415V feeder current exceeds 800A.'
    });
  }
  if (feeders.some(row => row.requiresVfd)) {
    topologyRecommendations.push({
      id: 'vfd-isolation',
      severity: 'medium',
      recommendation: 'Keep VFD loads on independent feeders with reactor, bypass/isolation and harmonic review.'
    });
  }
  if (metering.length) {
    topologyRecommendations.push({
      id: 'feeder-metering',
      severity: 'medium',
      recommendation: 'Add feeder-level metering for loads above 200kW and expose those points in EMS.'
    });
  }
  if (transformers.length) {
    topologyRecommendations.push({
      id: 'load-transformers',
      severity: 'medium',
      recommendation: 'Create per-zone load transformer schedule from feeder kVA and diversity factors.'
    });
  }
  return {
    system,
    rules,
    zones,
    assets,
    gensets: gensetRows,
    feeders,
    assetTimeProfile,
    gensetGeneration,
    mappingWarnings: reconciled.mappingWarnings,
    transformers,
    cables,
    metering,
    boq: feeders.map(row => ({
      feeder: row.feederId,
      breaker: `${Math.ceil(row.breakerA / 50) * 50}A ${row.breakerA >= 800 ? 'ACB' : 'MCCB'}`,
      cable: cables.find(item => item.feederId === row.feederId)?.cable || '',
      metering: row.meteringRequired,
      zone: row.zone
    })),
    assetGroups,
    loadSplits,
    topologyRecommendations
  };
}

function loadSplitsFromAssetGroups(assetGroups = []) {
  const groups = normalizeAssetGroups(assetGroups);
  if (!groups.length) return [];
  const totalRatio = groups.reduce((sum, row) => sum + row.ratioPct, 0);
  const totalAssets = groups.reduce((sum, row) => sum + Math.max(0, row.assetCount), 0);
  return groups.map((row, index) => ({
    id: `load-${index + 1}`,
    label: row.label || `${row.zone} ${row.assetType}`,
    ratioPct: totalRatio > 0
      ? row.ratioPct
      : totalAssets > 0
        ? (row.assetCount / totalAssets) * 100
        : 100 / groups.length,
    assetGroupId: row.id,
    feederId: row.feederId || row.id,
    zone: row.zone,
    assetType: row.assetType
  }));
}

function buildLoadAssetSummary(assetGroups = [], gensets = []) {
  const groups = normalizeAssetGroups(assetGroups);
  const gensetRows = normalizeGensetAssets(gensets);
  const sumBy = predicate => groups.reduce((sum, row) => sum + (predicate(row) ? row.feederCabinetQty : 0), 0);
  const zoneSet = new Set(groups.map(row => row.zone).filter(Boolean));
  const gensetZoneSet = new Set(gensetRows.map(row => row.zone).filter(Boolean));
  return {
    branchCount: groups.length,
    zoneCount: zoneSet.size,
    zones: Array.from(zoneSet),
    assetCount: groups.reduce((sum, row) => sum + row.assetCount, 0),
    gensetCount: gensetRows.length,
    gensetZoneCount: gensetZoneSet.size,
    gensetZones: Array.from(gensetZoneSet),
    feederCabinetCount: groups.reduce((sum, row) => sum + row.feederCabinetQty, 0),
    crusherFeederCabinetCount: sumBy(row => row.assetType === 'crusher' || row.feederType === 'crusher'),
    screenFeederCabinetCount: sumBy(row => row.assetType === 'screen' || row.feederType === 'screen'),
    pumpFeederCabinetCount: sumBy(row => row.assetType === 'pump' || row.feederType === 'pump'),
    auxiliaryFeederCabinetCount: sumBy(row => row.assetType === 'auxiliary' || row.feederType === 'auxiliary'),
    vfdCabinetCount: groups.reduce((sum, row) => sum + row.vfdCabinetQty, 0),
    meteringCabinetCount: groups.reduce((sum, row) => sum + row.meteringCabinetQty, 0),
    assetGroups: groups,
    gensets: gensetRows
  };
}

function normalizeLoadSplits(value = [], count = 1) {
  const loadCount = normalizeLoadCount(count);
  const input = Array.isArray(value) ? value : [];
  const rows = Array.from({ length: loadCount }, (_, index) => {
    const item = input[index] && typeof input[index] === 'object' ? input[index] : {};
    return {
      id: String(item.id || `load-${index + 1}`).trim() || `load-${index + 1}`,
      label: String(item.label || `Load ${index + 1}`).trim() || `Load ${index + 1}`,
      ratioPct: Math.max(0, asNumber(item.ratioPct ?? item.percent ?? item.allocationPct, loadCount ? 100 / loadCount : 100)),
      ...(item.assetGroupId ? { assetGroupId: String(item.assetGroupId) } : {}),
      ...(item.feederId ? { feederId: String(item.feederId) } : {}),
      ...(item.zone ? { zone: String(item.zone) } : {}),
      ...(item.assetType ? { assetType: String(item.assetType) } : {}),
      ...(Array.isArray(item.assets) ? { assets: normalizeIdList(item.assets) } : {}),
      ...(Array.isArray(item.assetNames) ? { assetNames: item.assetNames.map(name => String(name || '').trim()).filter(Boolean) } : {})
    };
  });
  const total = rows.reduce((sum, row) => sum + row.ratioPct, 0);
  if (!(total > 0)) {
    const equal = Math.floor((100 / loadCount) * 100) / 100;
    let assigned = 0;
    return rows.map((row, index) => {
      const ratioPct = index === rows.length - 1 ? round(100 - assigned, 2) : equal;
      assigned += ratioPct;
      return { ...row, ratioPct };
    });
  }
  let assigned = 0;
  return rows.map((row, index) => {
    const ratioPct = index === rows.length - 1
      ? round(100 - assigned, 2)
      : round((row.ratioPct / total) * 100, 2);
    assigned += ratioPct;
    return { ...row, ratioPct };
  });
}

function defaultLoadSplitsForTopology(loads = {}) {
  if (loads.manualLoadSplits || String(loads.loadSplitSource || '').trim().toLowerCase() === 'manual') {
    const manualCount = normalizeLoadCount(loads.loadCount ?? (Array.isArray(loads.loadSplits) ? loads.loadSplits.length : 1));
    return normalizeLoadSplits(loads.loadSplits || [], manualCount);
  }
  const assetSplits = loadSplitsFromAssetGroups(loads.assetGroups || []);
  if (assetSplits.length) return normalizeLoadSplits(assetSplits, assetSplits.length);
  const count = normalizeLoadCount(loads.loadCount ?? (Array.isArray(loads.loadSplits) ? loads.loadSplits.length : 1));
  return normalizeLoadSplits(loads.loadSplits || [], count);
}

function splitLoadKw(loadKw = 0, loadSplits = []) {
  let assigned = 0;
  return loadSplits.map((split, index) => {
    const value = index === loadSplits.length - 1
      ? round(Math.max(0, loadKw - assigned), 2)
      : round(Math.max(0, loadKw) * split.ratioPct / 100, 2);
    assigned += value;
    return {
      ...split,
      loadKw: value
    };
  });
}

function normalizeArchitectureId(value) {
  const id = String(value || '').trim();
  return ARCHITECTURE_TOPOLOGY_MAP[id] ? id : '';
}

function topologyIdForArchitecture(architectureId, recommended = {}) {
  const id = normalizeArchitectureId(architectureId);
  if (id === 'lv_415_centralized' && !(asNumber(recommended?.pcsRecommendedMw, 0) > 0 || asNumber(recommended?.bessRecommendedMwh, 0) > 0)) {
    return 'C2';
  }
  return ARCHITECTURE_TOPOLOGY_MAP[id]?.topologyId || '';
}

function voltageForArchitecture(architectureId, fallback = 11000) {
  return ARCHITECTURE_TOPOLOGY_MAP[normalizeArchitectureId(architectureId)]?.voltageV || fallback;
}

function componentRoleForNode(node = {}) {
  if (node.componentRole) return String(node.componentRole).trim().toUpperCase();
  const type = String(node.type || '').trim().toUpperCase();
  if (type === 'LV_BUS' || type === 'LV_SWITCHBOARD') return 'LV_BUS';
  if (type === 'MV_BUS') return 'MV_BUS';
  if (type === 'MV_SWITCHBOARD') return 'MV_SWITCHBOARD';
  return type;
}

function normalizeComponentCatalog(value = []) {
  const merged = new Map();
  [...STANDARD_COMPONENT_CATALOG, ...(Array.isArray(value) ? value : [])].forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const id = String(item.id || '').trim();
    const role = String(item.role || '').trim().toUpperCase();
    const type = String(item.type || '').trim().toUpperCase();
    if (!id || !role || !POWER_NODE_TYPES.includes(type)) return;
    merged.set(id, {
      id,
      role,
      type,
      label: String(item.label || type.replaceAll('_', ' ')).trim(),
      icon: String(item.icon || '').trim()
    });
  });
  return [...merged.values()];
}

function normalizeTemplateNodes(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((node) => {
      if (!node || typeof node !== 'object') return null;
      const id = String(node.id || '').trim();
      if (!id) return null;
      return {
        id,
        label: node.label === undefined ? undefined : String(node.label || '').trim(),
        type: node.type === undefined ? undefined : String(node.type || '').trim().toUpperCase(),
        componentId: node.componentId === undefined ? undefined : String(node.componentId || '').trim(),
        position: node.position && typeof node.position === 'object'
          ? { x: asNumber(node.position.x, 0), y: asNumber(node.position.y, 0) }
          : undefined,
        electrical: node.electrical && typeof node.electrical === 'object' ? { ...node.electrical } : undefined,
        busOrientation: node.busOrientation === undefined ? undefined : String(node.busOrientation || '').trim(),
        componentRole: node.componentRole === undefined ? undefined : String(node.componentRole || '').trim().toUpperCase()
      };
    })
    .filter(Boolean);
}

function normalizeTemplateEdges(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((edge) => {
      if (!edge || typeof edge !== 'object') return null;
      const id = String(edge.id || '').trim();
      if (!id) return null;
      return {
        id,
        source: edge.source === undefined ? undefined : String(edge.source || '').trim(),
        target: edge.target === undefined ? undefined : String(edge.target || '').trim(),
        type: edge.type === undefined ? undefined : String(edge.type || '').trim().toUpperCase(),
        direction: edge.direction === undefined ? undefined : String(edge.direction || '').trim().toUpperCase(),
        voltageV: edge.voltageV === undefined ? undefined : asNumber(edge.voltageV, 0)
      };
    })
    .filter(Boolean);
}

function normalizeRouteTemplate(value = {}) {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).map(([edgeId, route]) => {
    const cleanRoute = route && typeof route === 'object' ? route : {};
    const waypoints = Array.isArray(cleanRoute.waypoints)
      ? cleanRoute.waypoints.map(point => ({ x: asNumber(point?.x, 0), y: asNumber(point?.y, 0) }))
      : [];
    return [String(edgeId), {
      manualRoute: Boolean(cleanRoute.manualRoute || waypoints.length),
      locked: Boolean(cleanRoute.locked),
      waypoints
    }];
  }));
}

function normalizeTemplateViewport(value = {}) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    x: Math.max(0, asNumber(input.x, 0)),
    y: Math.max(0, asNumber(input.y, 0)),
    zoom: clamp(asNumber(input.zoom, 1), 0.35, 2.5, 1)
  };
}

function normalizeTemplateCanvas(value = {}) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    width: Math.max(1180, Math.round(asNumber(input.width, 1180))),
    height: Math.max(420, Math.round(asNumber(input.height, 420)))
  };
}

function normalizeTopologyTemplateVariant(value = {}) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    nodes: normalizeTemplateNodes(input.nodes || []),
    edges: normalizeTemplateEdges(input.edges || []),
    removedNodeIds: normalizeRemovedNodeIds(input.removedNodeIds || []),
    removedEdgeIds: normalizeRemovedEdgeIds(input.removedEdgeIds || []),
    routes: normalizeRouteTemplate(input.routes || {}),
    viewport: normalizeTemplateViewport(input.viewport || {}),
    canvas: normalizeTemplateCanvas(input.canvas || {})
  };
}

function normalizeRemovedNodeIds(value = []) {
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .map(item => String(item || '').trim())
    .filter(Boolean)));
}

function normalizeRemovedEdgeIds(value = []) {
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .map(item => String(item || '').trim())
    .filter(Boolean)));
}

function normalizeCustomTemplateId(value = '') {
  const id = String(value || '').trim().toUpperCase();
  return /^[CR]\d+$/.test(id) ? id : '';
}

function isStandardTopologyId(value = '') {
  const id = String(value || '').trim().toUpperCase();
  return STANDARD_TOPOLOGY_META.some(item => item.id === id);
}

function nextCustomTemplateId(customTemplates = {}, templateClass = 'RESI') {
  const cls = String(templateClass || '').trim().toUpperCase() === 'C&I' ? 'C&I' : 'RESI';
  const prefix = cls === 'C&I' ? 'C' : 'R';
  const min = cls === 'C&I' ? 1 : 4;
  const used = Object.keys(customTemplates || {})
    .map(normalizeCustomTemplateId)
    .filter(id => id.startsWith(prefix))
    .map(id => Number(id.slice(1)))
    .filter(Number.isFinite);
  const reserved = new Set(STANDARD_TOPOLOGY_META.map(item => item.id));
  let next = Math.max(min, used.length ? Math.max(...used) + 1 : min);
  while (reserved.has(`${prefix}${next}`)) next += 1;
  return `${prefix}${next}`;
}

function normalizeCustomTopologyTemplates(value = {}) {
  const templates = {};
  Object.entries(value && typeof value === 'object' ? value : {}).forEach(([templateId, template]) => {
    const id = normalizeCustomTemplateId(template?.id || templateId);
    if (!id || isStandardTopologyId(id) || !template || typeof template !== 'object') return;
    const variants = {};
    Object.entries(template.architectureVariants || {}).forEach(([architectureId, variant]) => {
      const archId = normalizeArchitectureId(architectureId);
      if (archId) variants[archId] = normalizeTopologyTemplateVariant(variant);
    });
    const templateClass = String(template.class || template.templateClass || '').trim().toUpperCase() === 'C&I' ? 'C&I' : 'RESI';
    const baseTopologyId = isStandardTopologyId(template.baseTopologyId) ? String(template.baseTopologyId).toUpperCase() : 'C5';
    templates[id] = {
      id,
      name: String(template.name || `${id} Custom Topology`).trim() || `${id} Custom Topology`,
      class: templateClass,
      baseTopologyId,
      sourceTopologyId: isStandardTopologyId(template.sourceTopologyId) ? String(template.sourceTopologyId).toUpperCase() : baseTopologyId,
      architectureVariants: variants
    };
  });
  return templates;
}

function normalizeStandardTopologyLibrary(value = {}) {
  const input = value && typeof value === 'object' ? value : {};
  const templates = {};
  Object.entries(input.templates || {}).forEach(([topologyId, template]) => {
    const id = String(topologyId || '').trim().toUpperCase();
    if (!STANDARD_TOPOLOGY_META.some(item => item.id === id)) return;
    const variants = {};
    Object.entries(template?.architectureVariants || {}).forEach(([architectureId, variant]) => {
      const archId = normalizeArchitectureId(architectureId);
      if (archId) variants[archId] = normalizeTopologyTemplateVariant(variant);
    });
    templates[id] = { architectureVariants: variants };
  });
  const customTemplates = normalizeCustomTopologyTemplates(input.customTemplates || {});
  return {
    version: Math.max(STANDARD_TOPOLOGY_LIBRARY_VERSION, Math.round(asNumber(input.version, STANDARD_TOPOLOGY_LIBRARY_VERSION))),
    templates,
    customTemplates,
    nextCustomTemplateIds: {
      RESI: nextCustomTemplateId(customTemplates, 'RESI'),
      'C&I': nextCustomTemplateId(customTemplates, 'C&I')
    },
    componentCatalog: normalizeComponentCatalog(input.componentCatalog || [])
  };
}

function getStandardTopologyTemplate(library = {}, topologyId = 'C5', architectureId = '') {
  const normalizedTopologyId = String(topologyId || 'C5').trim().toUpperCase();
  const normalizedArchitectureId = normalizeArchitectureId(architectureId);
  if (library.customTemplates?.[normalizedTopologyId]) {
    return library.customTemplates[normalizedTopologyId].architectureVariants?.[normalizedArchitectureId] || null;
  }
  return library.templates?.[normalizedTopologyId]?.architectureVariants?.[normalizedArchitectureId] || null;
}

function applyStandardTopologyTemplate(graph = {}, template = null, library = normalizeStandardTopologyLibrary()) {
  if (!template) return graph;
  const catalogById = new Map((library.componentCatalog || []).map(item => [item.id, item]));
  const nodeOverrides = new Map((template.nodes || []).map(item => [item.id, item]));
  const edgeOverrides = new Map((template.edges || []).map(item => [item.id, item]));
  const removedNodeIds = new Set(normalizeRemovedNodeIds(template.removedNodeIds || []));
  const removedEdgeIds = new Set(normalizeRemovedEdgeIds(template.removedEdgeIds || []));
  const nodes = (graph.nodes || []).filter(node => !removedNodeIds.has(node.id)).map((node) => {
    const override = nodeOverrides.get(node.id);
    if (!override) return node;
    let next = { ...node };
    if (override.position) next.position = { ...override.position };
    if (override.label !== undefined && override.label) next.label = override.label;
    if (override.busOrientation !== undefined) next.busOrientation = override.busOrientation;
    if (override.electrical) next.electrical = { ...(next.electrical || {}), ...override.electrical };
    const requestedComponent = catalogById.get(override.componentId);
    const currentRole = componentRoleForNode(next);
    if (requestedComponent && requestedComponent.role === currentRole) {
      next = {
        ...next,
        type: requestedComponent.type,
        label: requestedComponent.label || next.label,
        componentId: requestedComponent.id,
        componentRole: requestedComponent.role,
        componentIcon: requestedComponent.icon || ''
      };
    } else if (override.type && POWER_NODE_TYPES.includes(override.type) && componentRoleForNode({ type: override.type, componentRole: override.componentRole }) === currentRole) {
      next = { ...next, type: override.type, componentRole: currentRole };
    }
    return next;
  });
  const generatedNodeIds = new Set((graph.nodes || []).map(node => node.id));
  const nodeIds = new Set(nodes.map(node => node.id));
  (template.nodes || []).forEach((override) => {
    if (!override?.id || nodeIds.has(override.id) || generatedNodeIds.has(override.id) || removedNodeIds.has(override.id)) return;
    const requestedComponent = catalogById.get(override.componentId);
    const type = requestedComponent?.type || override.type;
    if (!POWER_NODE_TYPES.includes(type)) return;
    const role = requestedComponent?.role || componentRoleForNode({ type, componentRole: override.componentRole });
    nodes.push({
      id: override.id,
      type,
      label: override.label || requestedComponent?.label || type.replaceAll('_', ' '),
      position: override.position || { x: 0, y: 0 },
      electrical: override.electrical || { voltageV: 0 },
      busOrientation: override.busOrientation,
      componentId: requestedComponent?.id || override.componentId,
      componentRole: role,
      componentIcon: requestedComponent?.icon || ''
    });
    nodeIds.add(override.id);
  });
  const edges = (graph.edges || []).filter(edge => !removedEdgeIds.has(edge.id) && !removedNodeIds.has(edge.source) && !removedNodeIds.has(edge.target)).map((edge) => {
    const override = edgeOverrides.get(edge.id);
    const route = template.routes?.[edge.id];
    const next = override ? {
      ...edge,
      source: override.source || edge.source,
      target: override.target || edge.target,
      type: override.type && POWER_EDGE_TYPES.includes(override.type) ? override.type : edge.type,
      direction: override.direction === 'BIDIRECTIONAL' ? 'BIDIRECTIONAL' : override.direction === 'ONE_WAY' ? 'ONE_WAY' : edge.direction,
      voltageV: override.voltageV === undefined ? edge.voltageV : override.voltageV
    } : { ...edge };
    if (route) next.route = route;
    return next;
  }).filter(edge => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  const edgeIds = new Set(edges.map(edge => edge.id));
  (template.edges || []).forEach((edge) => {
    if (removedEdgeIds.has(edge.id) || edgeIds.has(edge.id) || removedNodeIds.has(edge.source) || removedNodeIds.has(edge.target) || !nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return;
    edges.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: edge.type && POWER_EDGE_TYPES.includes(edge.type) ? edge.type : 'AC_LV_POWER',
      direction: edge.direction === 'BIDIRECTIONAL' ? 'BIDIRECTIONAL' : 'ONE_WAY',
      voltageV: edge.voltageV === undefined ? 0 : edge.voltageV,
      route: template.routes?.[edge.id]
    });
  });
  return { nodes, edges, removedNodeIds: Array.from(removedNodeIds), removedEdgeIds: Array.from(removedEdgeIds) };
}

function appendLoadBranchTopology(nodes, edges, node, edge, splits = [], options = {}) {
  const sourceId = options.sourceId || 'ring-rmu';
  const startX = asNumber(options.startX, 1160);
  const startY = asNumber(options.startY, 80);
  const gapY = asNumber(options.gapY, 150);
  const mvVoltageV = asNumber(options.voltageV, 11000);
  splits.forEach((split, index) => {
    const branch = index + 1;
    const y = startY + index * gapY;
    const loadSplitId = split.id || `load-${branch}`;
    const rmuId = `rmu-load-${branch}`;
    const txId = `load-tx-${branch}`;
    const lvBusId = `lv-load-bus-${branch}`;
    const loadId = `load-${branch}`;
    nodes.push(
      node(rmuId, 'MV_BUS', `RMU Station ${branch}`, startX, y, mvVoltageV, { loadSplitId }),
      node(txId, 'TRANSFORMER', `Load TX ${branch}`, startX + 170, y, 415, { loadSplitId }),
      node(lvBusId, 'LV_BUS', `LV BUS ${branch}`, startX + 340, y, 415, { loadSplitId }),
      node(loadId, 'LOAD', split.label || `Load ${branch}`, startX + 510, y, 415, { loadSplitId })
    );
    edges.push(
      edge(`${sourceId}-load-${branch}`, sourceId, rmuId, 'AC_MV_POWER', 'ONE_WAY', mvVoltageV, { loadSplitId }),
      edge(`${rmuId}-${txId}`, rmuId, txId, 'AC_MV_POWER', 'ONE_WAY', mvVoltageV, { loadSplitId }),
      edge(`${txId}-${lvBusId}`, txId, lvBusId, 'AC_LV_POWER', 'ONE_WAY', 415, { loadSplitId }),
      edge(`${lvBusId}-${loadId}`, lvBusId, loadId, 'AC_LV_POWER', 'ONE_WAY', 415, { loadSplitId })
    );
  });
}

function appendLvLoadBranchTopology(nodes, edges, node, edge, splits = [], options = {}) {
  const sourceId = options.sourceId || 'lv-bus';
  const startX = asNumber(options.startX, 650);
  const startY = asNumber(options.startY, 90);
  const gapY = asNumber(options.gapY, 130);
  splits.forEach((split, index) => {
    const branch = index + 1;
    const y = startY + index * gapY;
    const loadSplitId = split.id || `load-${branch}`;
    const lvBusId = `lv-load-bus-${branch}`;
    const loadId = `load-${branch}`;
    nodes.push(
      node(lvBusId, 'LV_BUS', `LV BUS ${branch}`, startX, y, 415, { loadSplitId }),
      node(loadId, 'LOAD', split.label || `Load ${branch}`, startX + 190, y, 415, { loadSplitId })
    );
    edges.push(
      edge(`${sourceId}-load-${branch}`, sourceId, lvBusId, 'AC_LV_POWER', 'ONE_WAY', 415, { loadSplitId }),
      edge(`${lvBusId}-${loadId}`, lvBusId, loadId, 'AC_LV_POWER', 'ONE_WAY', 415, { loadSplitId })
    );
  });
}

function buildStandardTopologyGraph(id = 'C5', loads = {}, options = {}) {
  const architectureId = normalizeArchitectureId(options.architectureId);
  const topologyLibrary = normalizeStandardTopologyLibrary(options.standardTopologyLibrary || {});
  const requestedTopologyId = String(id || 'C5').trim().toUpperCase();
  const customTemplate = isStandardTopologyId(requestedTopologyId) ? null : topologyLibrary.customTemplates?.[requestedTopologyId] || null;
  const architectureTopologyId = topologyIdForArchitecture(architectureId);
  const topologyId = isStandardTopologyId(requestedTopologyId)
    ? requestedTopologyId
    : isStandardTopologyId(architectureTopologyId)
      ? architectureTopologyId
      : customTemplate?.baseTopologyId || 'C5';
  const finalize = (graph) => {
    const template = customTemplate
      ? getStandardTopologyTemplate(topologyLibrary, requestedTopologyId, architectureId)
      : getStandardTopologyTemplate(topologyLibrary, topologyId, architectureId);
    const applied = applyStandardTopologyTemplate(graph, template, topologyLibrary);
    return {
      ...applied,
      sourceTopologyId: customTemplate ? requestedTopologyId : topologyId,
      baseTopologyId: topologyId
    };
  };
  const loadSplits = defaultLoadSplitsForTopology(loads);
  const gensetCount = Math.max(0, Math.round(asNumber(loads.gensetCount, 0))) || normalizeGensetAssets(loads.gensets || []).length;
  const gensetLabel = gensetCount > 1 ? `DG Station (${gensetCount} units)` : 'Genset';
  const node = (nodeId, type, label, x, y, voltageV = 0, extra = {}) => ({
    id: nodeId,
    type,
    label,
    position: { x, y },
    electrical: { voltageV },
    autoGenerated: true,
    ...extra
  });
  const edge = (edgeId, source, target, type, direction = 'ONE_WAY', voltageV = 0, extra = {}) => ({
    id: edgeId,
    source,
    target,
    type,
    direction,
    voltageV,
    ...extra
  });
  const commonEms = node('ems', 'EMS', 'EMS Controller', 520, 430, 0);
  if (topologyId === 'C2') {
    const nodes = [
      node('pv-array', 'PV_ARRAY', 'PV Array', 40, 60, 1000),
      node('pv-inverter', 'PV_INVERTER', 'PV Inverter', 220, 60, 415),
      node('curtailment', 'CURTAILMENT', 'Curtailment', 430, 0, 415),
      node('genset', 'GENSET', gensetLabel, 220, 210, 415),
      node('lv-bus', 'LV_BUS', 'Common 415V Bus', 430, 130, 415, { busOrientation: 'vertical' }),
      commonEms
    ];
    const edges = [
      edge('pv-dc', 'pv-array', 'pv-inverter', 'DC_POWER', 'ONE_WAY', 1000),
      edge('pv-curtailment', 'pv-inverter', 'curtailment', 'AC_LV_POWER', 'ONE_WAY', 415),
      edge('pv-lv', 'pv-inverter', 'lv-bus', 'AC_LV_POWER', 'ONE_WAY', 415),
      edge('genset-lv', 'genset', 'lv-bus', 'AC_LV_POWER', 'ONE_WAY', 415),
      edge('ems-pv', 'ems', 'pv-inverter', 'COMMUNICATION', 'BIDIRECTIONAL', 0),
      edge('ems-genset', 'ems', 'genset', 'CONTROL', 'BIDIRECTIONAL', 0)
    ];
    appendLvLoadBranchTopology(nodes, edges, node, edge, loadSplits, { sourceId: 'lv-bus', startX: 650, startY: 80, gapY: 130 });
    return finalize({
      nodes,
      edges
    });
  }
  if (topologyId === 'C3') {
    const nodes = [
      node('pv-array', 'PV_ARRAY', 'PV Array', 40, 50, 1000),
      node('pv-inverter', 'PV_INVERTER', 'PV Inverter', 220, 50, 415),
      node('curtailment', 'CURTAILMENT', 'Curtailment', 450, 20, 415),
      node('battery', 'BATTERY', 'Battery', 40, 210, 800),
      node('pcs', 'PCS', 'PCS', 220, 210, 415),
      node('genset', 'GENSET', gensetLabel, 220, 340, 415),
      node('lv-bus', 'LV_BUS', 'Common 415V Bus', 450, 160, 415, { busOrientation: 'vertical' }),
      commonEms
    ];
    const edges = [
      edge('pv-dc', 'pv-array', 'pv-inverter', 'DC_POWER', 'ONE_WAY', 1000),
      edge('pv-curtailment', 'pv-inverter', 'curtailment', 'AC_LV_POWER', 'ONE_WAY', 415),
      edge('pv-lv', 'pv-inverter', 'lv-bus', 'AC_LV_POWER', 'ONE_WAY', 415),
      edge('lv-pcs-charge', 'lv-bus', 'pcs', 'AC_LV_POWER', 'ONE_WAY', 415),
      edge('pcs-battery-charge', 'pcs', 'battery', 'DC_POWER', 'ONE_WAY', 800),
      edge('battery-pcs-discharge', 'battery', 'pcs', 'DC_POWER', 'ONE_WAY', 800),
      edge('pcs-lv-discharge', 'pcs', 'lv-bus', 'AC_LV_POWER', 'ONE_WAY', 415),
      edge('genset-lv', 'genset', 'lv-bus', 'AC_LV_POWER', 'ONE_WAY', 415),
      edge('ems-pcs', 'ems', 'pcs', 'COMMUNICATION', 'BIDIRECTIONAL', 0)
    ];
    appendLvLoadBranchTopology(nodes, edges, node, edge, loadSplits, { sourceId: 'lv-bus', startX: 670, startY: 90, gapY: 130 });
    return finalize({
      nodes,
      edges
    });
  }
  if (topologyId === 'C7') {
    const nodes = [
      node('pv-array', 'PV_ARRAY', 'PV Station', 40, 60, 1000),
      node('pv-inverter', 'PV_INVERTER', 'PV Inverter', 220, 60, 415),
      node('curtailment', 'CURTAILMENT', 'Curtailment', 460, 40, 415),
      node('battery', 'BATTERY', 'BESS', 40, 210, 800),
      node('pcs', 'PCS', 'PCS', 220, 210, 415),
      node('genset', 'GENSET', gensetCount > 1 ? gensetLabel : 'DG Station', 220, 350, 415),
      node('lv-bus', 'LV_BUS', 'Source 415V Bus', 460, 210, 415, { busOrientation: 'vertical' }),
      node('step-up-tx', 'TRANSFORMER', 'Step-up TX', 650, 210, 11000),
      node('mv-bus', 'MV_SWITCHBOARD', '11kV Main Switchboard', 840, 210, 11000),
      node('ring-rmu', 'MV_BUS', '11kV Ring RMU', 1030, 210, 11000),
      commonEms
    ];
    const edges = [
      edge('pv-dc', 'pv-array', 'pv-inverter', 'DC_POWER', 'ONE_WAY', 1000),
      edge('pv-curtailment', 'pv-inverter', 'curtailment', 'AC_LV_POWER', 'ONE_WAY', 415),
      edge('pv-lv', 'pv-inverter', 'lv-bus', 'AC_LV_POWER', 'ONE_WAY', 415),
      edge('lv-pcs-charge', 'lv-bus', 'pcs', 'AC_LV_POWER', 'ONE_WAY', 415),
      edge('pcs-battery-charge', 'pcs', 'battery', 'DC_POWER', 'ONE_WAY', 800),
      edge('battery-pcs-discharge', 'battery', 'pcs', 'DC_POWER', 'ONE_WAY', 800),
      edge('pcs-lv-discharge', 'pcs', 'lv-bus', 'AC_LV_POWER', 'ONE_WAY', 415),
      edge('genset-lv', 'genset', 'lv-bus', 'AC_LV_POWER', 'ONE_WAY', 415),
      edge('lv-step-up', 'lv-bus', 'step-up-tx', 'AC_LV_POWER', 'BIDIRECTIONAL', 415),
      edge('step-up-mv', 'step-up-tx', 'mv-bus', 'AC_MV_POWER', 'BIDIRECTIONAL', 11000),
      edge('mv-ring', 'mv-bus', 'ring-rmu', 'AC_MV_POWER', 'BIDIRECTIONAL', 11000),
      edge('ems-mv-switchboard', 'ems', 'mv-bus', 'COMMUNICATION', 'BIDIRECTIONAL', 0),
      edge('ems-pcs', 'ems', 'pcs', 'COMMUNICATION', 'BIDIRECTIONAL', 0)
    ];
    appendLoadBranchTopology(nodes, edges, node, edge, loadSplits, { sourceId: 'ring-rmu', startX: 1220, startY: 70, gapY: 150, voltageV: 11000 });
    return finalize({
      nodes,
      edges
    });
  }
  if (topologyId === 'C5' && ['mv_6_6_radial', 'mv_11_radial'].includes(architectureId)) {
    const mvVoltageV = voltageForArchitecture(architectureId, 11000);
    const mvLabel = mvVoltageV === 6600 ? '6.6kV' : '11kV';
    const nodes = [
      node('pv-array', 'PV_ARRAY', 'PV Array', 40, 40, 1000),
      node('pv-inverter', 'PV_INVERTER', 'PV Inverter', 220, 40, 415),
      node('curtailment', 'CURTAILMENT', 'Curtailment', 450, 20, 415),
      node('battery', 'BATTERY', 'Battery', 40, 180, 800),
      node('pcs', 'PCS', 'Grid-forming PCS', 220, 180, 415),
      node('genset', 'GENSET', gensetLabel, 220, 320, 415),
      node('lv-bus', 'LV_BUS', 'Microgrid 415V Bus', 450, 180, 415, { busOrientation: 'vertical' }),
      node('step-up-tx', 'TRANSFORMER', 'Step-up TX', 620, 180, mvVoltageV),
      node('mv-switchboard', 'MV_SWITCHBOARD', `${mvLabel} MV Switchboard`, 800, 180, mvVoltageV),
      commonEms
    ];
    const edges = [
      edge('pv-dc', 'pv-array', 'pv-inverter', 'DC_POWER', 'ONE_WAY', 1000),
      edge('pv-curtailment', 'pv-inverter', 'curtailment', 'AC_LV_POWER', 'ONE_WAY', 415),
      edge('pv-lv', 'pv-inverter', 'lv-bus', 'AC_LV_POWER', 'ONE_WAY', 415),
      edge('lv-pcs-charge', 'lv-bus', 'pcs', 'AC_LV_POWER', 'ONE_WAY', 415),
      edge('pcs-battery-charge', 'pcs', 'battery', 'DC_POWER', 'ONE_WAY', 800),
      edge('battery-pcs-discharge', 'battery', 'pcs', 'DC_POWER', 'ONE_WAY', 800),
      edge('pcs-lv-discharge', 'pcs', 'lv-bus', 'AC_LV_POWER', 'ONE_WAY', 415),
      edge('genset-lv', 'genset', 'lv-bus', 'AC_LV_POWER', 'ONE_WAY', 415),
      edge('lv-step-up', 'lv-bus', 'step-up-tx', 'AC_LV_POWER', 'BIDIRECTIONAL', 415),
      edge('step-up-mv', 'step-up-tx', 'mv-switchboard', 'AC_MV_POWER', 'BIDIRECTIONAL', mvVoltageV),
      edge('ems-pcs', 'ems', 'pcs', 'COMMUNICATION', 'BIDIRECTIONAL', 0),
      edge('ems-mv-switchboard', 'ems', 'mv-switchboard', 'COMMUNICATION', 'BIDIRECTIONAL', 0)
    ];
    appendLoadBranchTopology(nodes, edges, node, edge, loadSplits, { sourceId: 'mv-switchboard', startX: 980, startY: 50, gapY: 150, voltageV: mvVoltageV });
    return finalize({
      nodes,
      edges
    });
  }
  const nodes = [
      node('pv-array', 'PV_ARRAY', 'PV Array', 40, 40, 1000),
      node('pv-inverter', 'PV_INVERTER', 'PV Inverter', 220, 40, 415),
      node('curtailment', 'CURTAILMENT', 'Curtailment', 450, 20, 415),
      node('battery', 'BATTERY', 'Battery', 40, 180, 800),
      node('pcs', 'PCS', 'Grid-forming PCS', 220, 180, 415),
      node('genset', 'GENSET', gensetLabel, 220, 320, 415),
      node('lv-bus', 'LV_BUS', 'Microgrid 415V Bus', 450, 180, 415, { busOrientation: 'vertical' }),
      node('step-up-tx', 'TRANSFORMER', 'Step-up TX', 620, 180, 11000),
      node('mv-switchboard', 'MV_SWITCHBOARD', 'MV Switchboard', 800, 180, 11000),
      node('ring-rmu', 'MV_BUS', 'Ring RMU', 980, 180, 11000),
      commonEms
    ];
  const edges = [
      edge('pv-dc', 'pv-array', 'pv-inverter', 'DC_POWER', 'ONE_WAY', 1000),
      edge('pv-curtailment', 'pv-inverter', 'curtailment', 'AC_LV_POWER', 'ONE_WAY', 415),
      edge('pv-lv', 'pv-inverter', 'lv-bus', 'AC_LV_POWER', 'ONE_WAY', 415),
      edge('lv-pcs-charge', 'lv-bus', 'pcs', 'AC_LV_POWER', 'ONE_WAY', 415),
      edge('pcs-battery-charge', 'pcs', 'battery', 'DC_POWER', 'ONE_WAY', 800),
      edge('battery-pcs-discharge', 'battery', 'pcs', 'DC_POWER', 'ONE_WAY', 800),
      edge('pcs-lv-discharge', 'pcs', 'lv-bus', 'AC_LV_POWER', 'ONE_WAY', 415),
      edge('genset-lv', 'genset', 'lv-bus', 'AC_LV_POWER', 'ONE_WAY', 415),
      edge('lv-step-up', 'lv-bus', 'step-up-tx', 'AC_LV_POWER', 'BIDIRECTIONAL', 415),
      edge('step-up-mv', 'step-up-tx', 'mv-switchboard', 'AC_MV_POWER', 'BIDIRECTIONAL', 11000),
      edge('mv-switchboard-rmu', 'mv-switchboard', 'ring-rmu', 'AC_MV_POWER', 'BIDIRECTIONAL', 11000),
      edge('ems-pcs', 'ems', 'pcs', 'COMMUNICATION', 'BIDIRECTIONAL', 0),
      edge('ems-mv-switchboard', 'ems', 'mv-switchboard', 'COMMUNICATION', 'BIDIRECTIONAL', 0)
    ];
  appendLoadBranchTopology(nodes, edges, node, edge, loadSplits, { sourceId: 'ring-rmu', startX: 1160, startY: 50, gapY: 150, voltageV: 11000 });
  return finalize({
    nodes,
    edges
  });
}

function normalizeSelectedTopologyId(value, site = {}) {
  const raw = String(value || '').trim().toUpperCase();
  if (raw === 'CUSTOM' || isStandardTopologyId(raw) || normalizeCustomTemplateId(raw)) return raw;
  const gridMode = String(site.gridMode || '').toLowerCase();
  return gridMode.includes('island') || gridMode.includes('off') ? 'C5' : 'C3';
}

function isLoadBranchNode(node = {}) {
  const id = String(node.id || '').trim();
  return Boolean(node.loadSplitId)
    || /^rmu-load-\d+$/.test(id)
    || /^load-tx-\d+$/.test(id)
    || /^lv-load-bus-\d+$/.test(id)
    || /^load-\d+$/.test(id);
}

function isLoadBranchEdge(edge = {}) {
  const endpoints = `${edge.source || ''} ${edge.target || ''}`;
  return Boolean(edge.loadSplitId)
    || /(^|\s)(rmu-load|load-tx|lv-load-bus|load)-\d+(\s|$)/.test(endpoints);
}

function mergeCustomTopologyWithGeneratedLoads(input = {}, loads = {}, options = {}) {
  const sourceTopologyId = isStandardTopologyId(input.sourceTopologyId) ? String(input.sourceTopologyId).toUpperCase()
    : isStandardTopologyId(input.baseTopologyId) ? String(input.baseTopologyId).toUpperCase()
      : topologyIdForArchitecture(options.architectureId) || 'C5';
  const generated = buildStandardTopologyGraph(sourceTopologyId, loads, options);
  const customNodes = new Map((Array.isArray(input.nodes) ? input.nodes : []).map(node => [String(node.id || ''), node]));
  const customEdges = new Map((Array.isArray(input.edges) ? input.edges : []).map(edge => [String(edge.id || ''), edge]));
  const removedNodeIds = new Set(normalizeRemovedNodeIds(input.removedNodeIds || generated.removedNodeIds || []));
  const removedEdgeIds = new Set(normalizeRemovedEdgeIds(input.removedEdgeIds || generated.removedEdgeIds || []));
  const generatedNodeIds = new Set((generated.nodes || []).map(node => node.id));
  const generatedEdgeIds = new Set((generated.edges || []).map(edge => edge.id));
  const nodes = (generated.nodes || []).filter(node => !removedNodeIds.has(node.id)).map((node) => {
    const custom = customNodes.get(node.id);
    if (isLoadBranchNode(node)) {
      return custom?.position ? { ...node, position: custom.position } : node;
    }
    if (!custom || isLoadBranchNode(custom)) return node;
    return {
      ...node,
      ...custom,
      id: node.id,
      type: custom.type || node.type,
      label: custom.label || node.label,
      electrical: { ...(node.electrical || {}), ...(custom.electrical || {}) },
      position: custom.position || node.position
    };
  });
  customNodes.forEach((node, id) => {
    if (!id || generatedNodeIds.has(id) || removedNodeIds.has(id) || isLoadBranchNode(node)) return;
    nodes.push(node);
  });
  const nodeIds = new Set(nodes.map(node => node.id));
  const edges = (generated.edges || []).filter(edge => !removedEdgeIds.has(edge.id) && !removedNodeIds.has(edge.source) && !removedNodeIds.has(edge.target)).map((edge) => {
    const custom = customEdges.get(edge.id);
    if (isLoadBranchEdge(edge)) return custom?.route ? { ...edge, route: custom.route } : edge;
    if (!custom || isLoadBranchEdge(custom)) return edge;
    return {
      ...edge,
      ...custom,
      id: edge.id,
      source: custom.source || edge.source,
      target: custom.target || edge.target,
      type: custom.type || edge.type,
      direction: custom.direction || edge.direction,
      voltageV: custom.voltageV === undefined ? edge.voltageV : custom.voltageV,
      route: custom.route || edge.route
    };
  }).filter(edge => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  customEdges.forEach((edge, id) => {
    if (!id || generatedEdgeIds.has(id) || removedEdgeIds.has(id) || removedNodeIds.has(edge.source) || removedNodeIds.has(edge.target) || isLoadBranchEdge(edge)) return;
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) edges.push(edge);
  });
  return {
    selectedTopologyId: 'CUSTOM',
    sourceTopologyId,
    baseTopologyId: generated.baseTopologyId || sourceTopologyId,
    removedNodeIds: Array.from(removedNodeIds),
    removedEdgeIds: Array.from(removedEdgeIds),
    nodes,
    edges
  };
}

function normalizePowerTopology(rawTopology = {}, selectedTopologyId = 'C5', loads = {}, options = {}) {
  const input = rawTopology && typeof rawTopology === 'object' ? rawTopology : {};
  const hasCustomGraph = selectedTopologyId === 'CUSTOM'
    && ((Array.isArray(input.nodes) && input.nodes.length)
      || (Array.isArray(input.edges) && input.edges.length)
      || (Array.isArray(input.removedNodeIds) && input.removedNodeIds.length)
      || (Array.isArray(input.removedEdgeIds) && input.removedEdgeIds.length));
  const base = hasCustomGraph ? mergeCustomTopologyWithGeneratedLoads(input, loads, options) : buildStandardTopologyGraph(selectedTopologyId, loads, {
    architectureId: options.architectureId,
    standardTopologyLibrary: options.standardTopologyLibrary
  });
  const nodes = (Array.isArray(base.nodes) ? base.nodes : [])
    .map((node, index) => normalizePowerNode(node, index))
    .filter(node => node.id);
  const nodeIds = new Set(nodes.map(node => node.id));
  const edges = (Array.isArray(base.edges) ? base.edges : [])
    .map((edge, index) => normalizePowerEdge(edge, index))
    .filter(edge => edge.id && nodeIds.has(edge.source) && nodeIds.has(edge.target));
  return {
    selectedTopologyId,
    sourceTopologyId: base.sourceTopologyId || selectedTopologyId,
    baseTopologyId: base.baseTopologyId || selectedTopologyId,
    removedNodeIds: normalizeRemovedNodeIds(base.removedNodeIds || input.removedNodeIds || []),
    removedEdgeIds: normalizeRemovedEdgeIds(base.removedEdgeIds || input.removedEdgeIds || []),
    nodes,
    edges
  };
}

function normalizeBoqLineId(value = '', fallback = '') {
  const raw = String(value || fallback || '').trim();
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback;
}

function normalizeBoqPackage(value = '', fallback = 'Auxiliary') {
  const raw = String(value || '').trim();
  return EPC_BOQ_PACKAGES.includes(raw) ? raw : fallback;
}

function normalizeBoqHiddenPackages(value = []) {
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .map(item => normalizeBoqPackage(item, ''))
    .filter(Boolean)));
}

function normalizeBoqLineIdList(value = []) {
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .map(item => normalizeBoqLineId(item))
    .filter(Boolean)));
}

function normalizeBoqManualItems(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((item, index) => {
      const source = item && typeof item === 'object' ? item : {};
      const id = normalizeBoqLineId(source.id, `manual-${index + 1}`);
      const quantity = asNumber(source.quantity, 0);
      return {
        id,
        package: normalizeBoqPackage(source.package, 'Auxiliary'),
        item: String(source.item || source.name || '').trim(),
        spec: String(source.spec || source.description || '').trim(),
        quantity,
        unit: String(source.unit || 'lot').trim() || 'lot',
        protection: String(source.protection || '').trim(),
        remark: String(source.remark || source.notes || '').trim(),
        productId: String(source.productId || '').trim(),
        productName: String(source.productName || '').trim(),
        supplierName: String(source.supplierName || '').trim(),
        nodeType: String(source.nodeType || '').trim(),
        source: 'manual',
        mandatory: Boolean(source.mandatory),
        manual: true
      };
    })
    .filter(item => item.item || item.spec || item.quantity > 0);
}

function normalizeBoqLineSelections(value = {}) {
  const input = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(Object.entries(input)
    .map(([key, raw]) => {
      const item = raw && typeof raw === 'object' ? raw : {};
      const id = normalizeBoqLineId(key);
      if (!id) return null;
      const quantityOverride = asNumber(item.quantityOverride, 0);
      return [id, {
        productId: String(item.productId || '').trim(),
        productName: String(item.productName || '').trim(),
        supplierName: String(item.supplierName || '').trim(),
        quantityOverride: quantityOverride > 0 ? quantityOverride : 0,
        unitOverride: String(item.unitOverride || '').trim(),
        specOverride: String(item.specOverride || '').trim(),
        protectionOverride: String(item.protectionOverride || '').trim(),
        remark: String(item.remark || item.notes || '').trim()
      }];
    })
    .filter(Boolean));
}

function normalizeEpcBoqState(value = {}) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    manualItems: normalizeBoqManualItems(input.manualItems || []),
    lineSelections: normalizeBoqLineSelections(input.lineSelections || {}),
    hiddenPackages: normalizeBoqHiddenPackages(input.hiddenPackages || []),
    hiddenLineIds: normalizeBoqLineIdList(input.hiddenLineIds || []),
    lineOrder: normalizeBoqLineIdList(input.lineOrder || [])
  };
}

function normalizeRiskAcknowledgements(value = {}) {
  const input = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(Object.entries(input)
    .map(([key, raw]) => {
      const item = raw && typeof raw === 'object' ? raw : {};
      const id = normalizeBoqLineId(key);
      const reason = String(item.reason || '').trim();
      const signer = String(item.signer || item.signature || '').trim();
      if (!id || !reason || !signer) return null;
      return [id, {
        reason,
        signer,
        signedAt: String(item.signedAt || item.acknowledgedAt || '').trim(),
        mode: 'manual'
      }];
    })
    .filter(Boolean));
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
    const assetGensetLoadBasis = normalizeAssetGensetLoadBasis(loads.assetGensetLoadBasis ?? raw.assetGensetLoadBasis);
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
    const gensetAssets = normalizeGensetAssets(loads.gensets || raw.gensets || []);
    const assetInputs = normalizeAssetInputs(loads.assets || raw.assets || [], { operationHoursPerDay: dayHours });
    const feederZoningRules = normalizeFeederZoningRules({
        maxVoltageDropPct: electrical.maxVoltageDropPct ?? raw.maxVoltageDropPct,
        ...(loads.feederZoningRules || raw.feederZoningRules || {})
    });
    const feederZoning = buildFeederZoning(assetInputs, gensetAssets, {
        operationHoursPerDay: dayHours,
        voltageLv: asNumber(electrical.voltageLv ?? electrical.lvVoltageV ?? raw.voltageLv, FEEDER_ZONING_DEFAULTS.voltageLv),
        powerFactor: asNumber(electrical.powerFactor ?? raw.powerFactor, FEEDER_ZONING_DEFAULTS.powerFactor),
        feederZoningRules
    });
    const assetGroups = assetInputs.length
        ? normalizeAssetGroups(feederZoning.assetGroups)
        : normalizeAssetGroups(loads.assetGroups || raw.assetGroups || []);
    const assetLoadSplits = assetInputs.length
        ? feederZoning.loadSplits
        : loadSplitsFromAssetGroups(assetGroups);
    const inferredLoadCount = assetLoadSplits.length || (Array.isArray(loads.loadSplits) ? loads.loadSplits.length : 1);
    const requestedLoadCount = normalizeLoadCount(loads.loadCount ?? raw.loadCount ?? inferredLoadCount);
    const manualLoadSplits = Boolean(loads.manualLoadSplits ?? raw.manualLoadSplits)
      || String(loads.loadSplitSource || raw.loadSplitSource || '').trim().toLowerCase() === 'manual';
    const loadCount = manualLoadSplits
        ? requestedLoadCount
        : assetLoadSplits.length
        ? normalizeLoadCount(assetLoadSplits.length)
        : requestedLoadCount;
    const loadSplits = manualLoadSplits
        ? normalizeLoadSplits(loads.loadSplits || raw.loadSplits || [], loadCount)
        : assetLoadSplits.length
        ? normalizeLoadSplits(assetLoadSplits, loadCount)
        : normalizeLoadSplits(loads.loadSplits || raw.loadSplits || [], loadCount);
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
  delete normalizedAssumptions.standardTopologyLibrary;
  const normalizedCalculationAssumptions = {
    ...defaults,
    ...(raw.calculationAssumptions && typeof raw.calculationAssumptions === 'object' ? raw.calculationAssumptions : {}),
    standardTopologyLibrary: normalizeStandardTopologyLibrary(defaults.standardTopologyLibrary || {})
  };
  const selectedArchitectureId = normalizeArchitectureId(electrical.selectedArchitectureId || raw.selectedArchitectureId);
  const selectedTopologyId = normalizeSelectedTopologyId(raw.selectedTopologyId || raw.topology?.selectedTopologyId, {
    gridMode: site.gridMode || raw.gridMode || 'hybrid'
  });
  const topology = normalizePowerTopology(raw.topology || {}, selectedTopologyId, { loadCount, loadSplits, assetGroups, gensets: gensetAssets, gensetCount: gensetAssets.length }, {
    architectureId: selectedArchitectureId,
    standardTopologyLibrary: normalizedCalculationAssumptions.standardTopologyLibrary
  });

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
    gensets: gensetAssets,
    loadProfile: Array.isArray(raw.loadProfile) ? raw.loadProfile : Array.isArray(raw.load_profile) ? raw.load_profile : [],
    selectedTopologyId,
    topology,
      loads: {
        measurementMethod,
        assetGensetLoadBasis,
        feederZoningRules,
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
        loadCount,
        loadSplits,
        manualLoadSplits,
        loadSplitSource: manualLoadSplits ? 'manual' : assetLoadSplits.length ? 'asset_feeder_zoning' : 'input',
        assets: assetInputs,
        assetGroups,
        assetFeederGroups: assetGroups,
        feederZoning,
        gensets: gensetAssets,
        gensetCount: gensetAssets.length,
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
      newMvSystem: Boolean(electrical.newMvSystem),
      selectedArchitectureId,
      localReferenceArchitecture: normalizeArchitectureId(electrical.localReferenceArchitecture || raw.localReferenceArchitecture),
      selectedArchitectureChosenAt: String(electrical.selectedArchitectureChosenAt || raw.selectedArchitectureChosenAt || ''),
      selectedArchitectureSource: selectedArchitectureId ? String(electrical.selectedArchitectureSource || raw.selectedArchitectureSource || 'user') : ''
    },
    assumptions: normalizedAssumptions,
    calculationAssumptions: normalizedCalculationAssumptions,
    boq: normalizeEpcBoqState(raw.boq || {}),
    riskAcknowledgements: normalizeRiskAcknowledgements(raw.riskAcknowledgements || {}),
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
      equipmentType: inputs.equipmentType,
      loadCount: inputs.loadCount,
      loadSplits: inputs.loadSplits
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
  else if (project.loads.measurementMethod === 'asset_genset_fuel_mapping' && project.loads.assets.length) score += 26;
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

function calculateAssetGensetFuelLoad(project, now) {
  const assets = Array.isArray(project.loads.assets) ? project.loads.assets : [];
  const feeders = Array.isArray(project.loads.feederZoning?.feeders) ? project.loads.feederZoning.feeders : [];
  const assetTimeProfile = project.loads.feederZoning?.assetTimeProfile || {};
  const generation = project.loads.feederZoning?.gensetGeneration || buildGensetGenerationSummary(project.gensets || project.loads.gensets || [], {
    powerFactor: project.electrical?.powerFactor || FEEDER_ZONING_DEFAULTS.powerFactor,
    sfcLPerKwh: project.assumptions.dieselSfcLPerKwh
  });
  const loadBasis = normalizeAssetGensetLoadBasis(project.loads.assetGensetLoadBasis);
  const assetDailyKwh = assets.reduce((sum, asset) => {
    return sum + asset.kw * asset.qty * asset.operationHours * asset.dutyFactor * asset.simultaneityFactor;
  }, 0);
  const assetOperatingKw = assets.reduce((sum, asset) => {
    return sum + asset.kw * asset.qty * asset.dutyFactor * asset.simultaneityFactor;
  }, 0);
  const connectedPeakKw = assets.reduce((sum, asset) => sum + asset.kw * asset.qty, 0);
  const assetFuelDailyKwh = assets.reduce((sum, item) => {
    const dailyFuel = asNumber(item.fuelLiters, 0) / Math.max(1, asNumber(item.fuelPeriodDays, 1));
    const sfc = Math.max(0.001, asNumber(item.sfcLPerKwh, project.assumptions.dieselSfcLPerKwh));
    return sum + (dailyFuel > 0 ? dailyFuel / sfc : 0);
  }, 0);
  const fuelDailyKwh = generation.energyBasisDailyKwh || assetFuelDailyKwh;
  const profileActiveHours = Array.isArray(assetTimeProfile.hourly)
    ? assetTimeProfile.hourly.filter(row => asNumber(row.loadKw, 0) > 0).length
    : 0;
  const assetOperatingHours = Math.max(1, profileActiveHours, assets.reduce((max, asset) => Math.max(max, asset.operationHours), 0) || project.loads.operationHoursPerDay || 0);
  const usingAssetBasis = loadBasis === 'asset_list';
  const dailyLoadKwh = usingAssetBasis
    ? assetDailyKwh > 0 ? assetDailyKwh : fuelDailyKwh
    : generation.energyBasisDailyKwh > 0 ? generation.energyBasisDailyKwh : assetDailyKwh > 0 ? assetDailyKwh : fuelDailyKwh;
  const operatingHours = usingAssetBasis
    ? assetOperatingHours
    : generation.energyBasisRuntimeHours > 0
      ? generation.energyBasisRuntimeHours
      : generation.maxRuntimeHours > 0
        ? generation.maxRuntimeHours
        : assetOperatingHours;
  const averageLoadKw = dailyLoadKwh / operatingHours;
  const feederPeakKw = feeders.reduce((sum, row) => sum + Math.max(row.peakProfileKw || 0, row.operatingKw || 0, row.totalKw || 0), 0);
  const peakSafetyKw = averageLoadKw * Math.max(1, project.loads.peakLoadSafetyFactor || project.assumptions.peakLoadFactor);
  const gensetCapacityPeakKw = Math.max(0, generation.totalPeakSupportKw || 0);
  const peakLoadKw = usingAssetBasis
    ? Math.max(peakSafetyKw, connectedPeakKw, feederPeakKw, gensetCapacityPeakKw)
    : Math.max(peakSafetyKw, gensetCapacityPeakKw);
  const sourceLabel = usingAssetBasis ? 'Asset List' : 'Genset Fuel Mapping';
  return decorateLoadResult(project, {
    dailyLoadKwh: round(dailyLoadKwh, 4),
    averageLoadKw: round(averageLoadKw, 4),
    peakLoadKw: round(peakLoadKw, 4),
    operatingHours: round(operatingHours, 4),
    assetGensetLoadBasis: loadBasis,
    assetDailyKwh: round(assetDailyKwh, 4),
    fuelDailyKwh: round(fuelDailyKwh, 4),
    assetOperatingKw: round(assetOperatingKw, 4),
    gensetCapacityPeakKw: round(gensetCapacityPeakKw, 4),
    loadSource: sourceLabel
  }, [
    buildFormulaTrace({
      key: 'dailyLoadKwh',
      label: 'Daily Load',
      formula: usingAssetBasis
        ? 'Σ Asset kW x Qty x Hours x Duty x Simultaneity'
        : 'Σ Fuel/SFC genset generation estimate, fallback to kVA profile or asset kWh if fuel data is incomplete',
      inputs: { assetCount: assets.length, assetDailyKwh: round(assetDailyKwh, 4), fuelDailyKwh: round(fuelDailyKwh, 4), gensetDailyKwh: round(generation.totalDailyKwh || 0, 4), assetGensetLoadBasis: loadBasis, energyBasisMethod: generation.energyBasisMethod || 'asset' },
      result: round(dailyLoadKwh, 4),
      unit: 'kWh/day',
      assumptionSource: sourceLabel,
      now
    }),
    buildFormulaTrace({
      key: 'averageLoadKw',
      label: 'Average Load',
      formula: usingAssetBasis ? 'Asset Daily kWh / Active Asset Operating Window' : 'Genset Fuel Daily kWh / Genset Runtime Window',
      inputs: { dailyLoadKwh: round(dailyLoadKwh, 4), operatingHours: round(operatingHours, 4) },
      result: round(averageLoadKw, 4),
      unit: 'kW',
      assumptionSource: sourceLabel,
      now
    }),
    buildFormulaTrace({
      key: 'peakLoadKw',
      label: 'Peak Load',
      formula: usingAssetBasis
        ? 'Max connected asset kW, feeder peak kW, genset capacity and average load safety factor'
        : 'Max genset kVA capacity and average load safety factor; Asset List kW is allocation/topology only',
      inputs: {
        averageLoadKw: round(averageLoadKw, 4),
        peakSafetyKw: round(peakSafetyKw, 4),
        connectedPeakKw: round(connectedPeakKw, 4),
        feederPeakKw: round(feederPeakKw, 4),
        gensetCapacityPeakKw: round(gensetCapacityPeakKw, 4),
        assetGensetLoadBasis: loadBasis
      },
      result: round(peakLoadKw, 4),
      unit: 'kW',
      assumptionSource: sourceLabel,
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
  if (project.loads.measurementMethod === 'asset_genset_fuel_mapping') return calculateAssetGensetFuelLoad(project, now);
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
      buildCableCandidate({ voltageClass: '800V', voltageKv: 0.8, designKw, distanceM, pf, conductor: 'CU', sizeMm2: 630, ampacityA: 850, derating: 0.8 }),
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
    ['lv_800_microgrid', '800V Microgrid', 0.8, 'LV800', 2.5],
    ['mv_6_6_radial', '6.6kV Radial', 6.6, 'MV', 3],
    ['mv_11_radial', '11kV Radial', 11, 'MV', 4],
    ['mv_11_ring', '11kV Ring', 11, 'MV', 5]
  ];
  const candidates = candidateSpecs.map(([id, name, voltageKv, voltageClass, reliabilityScore]) => {
    const currentA = calculateCurrentA(designKw, voltageKv, pf);
    const is800vReference = id === EPC_LOCAL_800V_REFERENCE.id;
    const voltageDropPct = estimateVoltageDropPct({
      currentA,
      voltageKv,
      distanceM: Math.max(1, distance),
      conductor: voltageClass === 'LV' || is800vReference ? 'CU' : 'AL',
      sizeMm2: voltageClass === 'LV' || is800vReference ? 630 : 240,
      parallelRuns: voltageClass === 'LV' || is800vReference ? Math.max(1, Math.ceil(currentA / 680)) : 1,
      pf
    });
    let status = is800vReference ? 'REVIEW' : 'PASS';
    const reasons = [];
    const riskNotes = [];
    if (voltageClass === 'LV' && currentA > 2500) {
      status = 'FAIL';
      reasons.push('High 415V current');
      riskNotes.push('High MW-level 415V current drives heavy busbar and multi-run cable scope.');
    }
    if (voltageClass === 'LV' && distance > 200 && designKw > 500) {
      status = status === 'FAIL' ? 'FAIL' : 'REVIEW';
      reasons.push('Long LV route');
      riskNotes.push('Long LV route needs voltage-drop and fault-level validation.');
    }
    if (is800vReference) {
      reasons.push('Local BOQ reference option');
      riskNotes.push('800V reduces current versus 415V but still requires protection selectivity review.');
      riskNotes.push('Equipment supply, local EPC familiarity, O&M spares and multiple transformer interfaces must be confirmed.');
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
      reasons,
      riskNotes,
      recommendation: id === 'mv_11_ring'
        ? 'Recommended for quarry multi-zone loads, long routes and future expansion.'
        : is800vReference
          ? EPC_LOCAL_800V_REFERENCE.recommendation
          : status === 'FAIL'
            ? 'Not recommended for this concept case.'
            : 'Comparison option; validate CAPEX, protection and local O&M before selection.'
    };
  });
  const eligible = candidates.filter(candidate => candidate.status !== 'FAIL');
  const calculatedRecommended = (eligible.length ? eligible : candidates)
    .reduce((best, candidate) => candidate.score > best.score ? candidate : best, candidates[0]);
  const selectedArchitectureId = normalizeArchitectureId(project.electrical.selectedArchitectureId);
  const selectedCandidate = candidates.find(candidate => candidate.id === selectedArchitectureId);
  const selectedArchitectureValid = Boolean(selectedCandidate && selectedCandidate.status === 'PASS');
  const recommended = selectedArchitectureValid ? selectedCandidate : calculatedRecommended;
  const selectedArchitectureWarning = selectedArchitectureId && !selectedArchitectureValid
    ? `${selectedCandidate?.name || selectedArchitectureId} is no longer PASS; falling back to ${calculatedRecommended.name}.`
    : '';
  return {
    candidates,
    recommendedId: recommended.id,
    calculatedRecommendedId: calculatedRecommended.id,
    selectedArchitectureId,
    selectedArchitectureValid,
    selectedArchitectureWarning,
    recommendation: `${recommended.name} is preferred for concept screening; compare CAPEX, cable count, protection complexity and local O&M before final design.`,
    disclaimer: 'Experience-rule architecture screening only; not a statutory requirement or final engineering design.'
  };
}

function pickArchitectureCableCandidate(candidate = {}, cableScreening = {}) {
  const voltageLabel = asNumber(candidate.voltageKv, 0) >= 1
    ? `${asNumber(candidate.voltageKv, 0)}kV`
    : `${Math.round(asNumber(candidate.voltageKv, 0) * 1000)}V`;
  const matches = (cableScreening.candidates || []).filter(cable => cable.voltageClass === voltageLabel);
  if (!matches.length) return null;
  return matches.reduce((best, item) => {
    if (item.parallelRuns !== best.parallelRuns) return item.parallelRuns < best.parallelRuns ? item : best;
    return item.voltageDropPct < best.voltageDropPct ? item : best;
  }, matches[0]);
}

function buildArchitectureComparison(project, electricalArchitecture = {}, cableScreening = {}) {
  const localReferenceId = normalizeArchitectureId(project.electrical.localReferenceArchitecture) || EPC_LOCAL_800V_REFERENCE.id;
  const candidates = (electricalArchitecture.candidates || []).map((candidate) => {
    const cable = pickArchitectureCableCandidate(candidate, cableScreening);
    const riskNotes = Array.isArray(candidate.riskNotes) && candidate.riskNotes.length
      ? candidate.riskNotes
      : candidate.reasons || [];
    const localReference = candidate.id === localReferenceId;
    const recommended = candidate.id === electricalArchitecture.recommendedId;
    return {
      ...candidate,
      localReference,
      recommended,
      parallelRuns: cable?.parallelRuns || (candidate.voltageClass === 'LV' || candidate.voltageClass === 'LV800'
        ? Math.max(1, Math.ceil(asNumber(candidate.currentA, 0) / 680))
        : 1),
      cableStatus: cable?.status || '',
      cableVoltageDropPct: cable ? round(cable.voltageDropPct, 2) : round(candidate.voltageDropPct, 2),
      riskNotes,
      recommendation: recommended
        ? `${candidate.name} is recommended for this concept case.`
        : localReference
          ? EPC_LOCAL_800V_REFERENCE.recommendation
          : candidate.recommendation || 'Comparison option; validate with detailed engineering before procurement.'
    };
  });
  const localReference = candidates.find(candidate => candidate.id === localReferenceId)
    || candidates.find(candidate => candidate.id === EPC_LOCAL_800V_REFERENCE.id)
    || null;
  return {
    recommendedId: electricalArchitecture.recommendedId || '',
    calculatedRecommendedId: electricalArchitecture.calculatedRecommendedId || '',
    selectedArchitectureId: electricalArchitecture.selectedArchitectureId || '',
    localReference,
    candidates,
    basis: 'Concept comparison of New-Hybrid recommendation against the local 800V procurement BOQ reference.',
    recommendation: '11kV ring selected to reduce MW-level LV current and support distributed quarry loads.',
    localReferenceMeta: EPC_LOCAL_800V_REFERENCE
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

function standardTopologies(options = {}) {
  const library = normalizeStandardTopologyLibrary(options.standardTopologyLibrary || {});
  const loads = options.loads || {};
  const architectureId = normalizeArchitectureId(options.architectureId);
  const standard = STANDARD_TOPOLOGY_META.map(meta => {
    const graph = normalizePowerTopology(buildStandardTopologyGraph(meta.id, loads, {
      architectureId,
      standardTopologyLibrary: library
    }), meta.id, loads, {
      architectureId,
      standardTopologyLibrary: library
    });
    return {
      ...meta,
      baseTopologyId: graph.baseTopologyId || meta.id,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      removedNodeIds: graph.removedNodeIds,
      removedEdgeIds: graph.removedEdgeIds,
      nodes: graph.nodes,
      edges: graph.edges
    };
  });
  const custom = Object.values(library.customTemplates || {}).map(template => {
    const graph = normalizePowerTopology({}, template.id, loads, {
      architectureId,
      standardTopologyLibrary: library
    });
    return {
      id: template.id,
      name: template.name,
      category: 'custom',
      class: template.class,
      description: `${template.class} saved custom topology`,
      baseTopologyId: graph.baseTopologyId || template.baseTopologyId,
      sourceTopologyId: template.id,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      removedNodeIds: graph.removedNodeIds,
      removedEdgeIds: graph.removedEdgeIds,
      nodes: graph.nodes,
      edges: graph.edges
    };
  });
  return [...standard, ...custom];
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
  const allTopologies = standardTopologies({
    standardTopologyLibrary: project.calculationAssumptions?.standardTopologyLibrary,
    loads: project.loads,
    architectureId: electricalArchitecture.recommendedId
  });
  const architectureTopologyId = topologyIdForArchitecture(electricalArchitecture.recommendedId);
  const architectureLocked = Boolean(electricalArchitecture.selectedArchitectureId && electricalArchitecture.selectedArchitectureValid && architectureTopologyId);
  const selectableTopologies = allTopologies.filter(topology => architectureLocked
    ? topology.id === architectureTopologyId || topology.baseTopologyId === architectureTopologyId
    : !requiresMvTopology || topologyHasMvDistribution(topology));
  const blockedTopologies = allTopologies
    .filter(topology => !selectableTopologies.some(item => item.id === topology.id))
    .map(topology => ({
      ...topology,
      blockedReason: architectureLocked
        ? `Chosen Electrical architecture uses ${architectureTopologyId}; other standard topologies are locked.`
        : 'Electrical recommended architecture is MV PASS; common 415V bus-only topologies are locked.'
    }));
  const selectedTopologyId = String(project.selectedTopologyId || project.topology?.selectedTopologyId || 'C5').toUpperCase();
  return {
    requiresMvTopology,
    recommendedArchitectureId: electricalArchitecture.recommendedId || '',
    selectedArchitectureId: electricalArchitecture.selectedArchitectureId || '',
    architectureTopologyId,
    architectureLocked,
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
    CURTAILMENT: 'Curtailment',
    EMS: 'EMS',
    SCADA: 'SCADA',
    METER: 'Meter'
  };
  const label = String(node.label || '').trim();
  if (node.type === 'GENSET' && label && !/^genset$/i.test(label)) return label;
  if (/ring\s*rmu/i.test(label)) return 'Ring RMU';
  if (/mv\s*switchboard/i.test(label)) return 'MV Switchboard';
  if (/load\s*tx/i.test(label)) return 'Load TX';
  if (/step[-\s]*up/i.test(label)) return 'Step-up TX';
  return typeLabels[node.type] || label || String(node.type || 'Node').replaceAll('_', ' ');
}

function topologyFlowRole(edge = {}, source = {}, target = {}) {
  if (edge.type === 'COMMUNICATION' || edge.type === 'CONTROL') return 'control';
  if (source.type === 'CURTAILMENT' || target.type === 'CURTAILMENT') return 'curtail';
  if (['lv-pcs-charge', 'mv-bess-charge', 'bess-tx-pcs-charge'].includes(edge.id)) return 'battery';
  if (source.type === 'PV_ARRAY' || source.type === 'PV_INVERTER' || target.type === 'PV_INVERTER') return 'pv';
  if (source.type === 'BATTERY' || target.type === 'BATTERY' || source.type === 'PCS' || target.type === 'PCS') return 'battery';
  if (source.type === 'GENSET' || target.type === 'GENSET') return 'genset';
  return edge.type === 'AC_MV_POWER' ? 'mv' : 'load';
}

function topologyFlowKeysForEdge(edge = {}, source = {}, target = {}) {
  if (edge.type === 'COMMUNICATION' || edge.type === 'CONTROL') return [];
  if (edge.loadSplitId) return [`loadSplit:${edge.loadSplitId}`];
  const edgeFlowKeys = {
    'pv-dc': ['pvOutputKw'],
    'pv-curtailment': ['curtailmentKw'],
    'pv-lv': ['pvToLoadKw', 'pvToBatteryKw'],
    'pv-tx-lv': ['pvToLoadKw', 'pvToBatteryKw'],
    'pv-mv': ['pvToLoadKw', 'pvToBatteryKw'],
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
  if (source.type === 'CURTAILMENT' || target.type === 'CURTAILMENT') return ['curtailmentKw'];
  if (source.type === 'PV_INVERTER' || target.type === 'PV_INVERTER') return ['pvToLoadKw', 'pvToBatteryKw'];
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
    ratedPowerKw: asNumber(node.electrical?.ratedPowerKw, 0),
    componentId: String(node.componentId || '').trim(),
    componentRole: String(node.componentRole || componentRoleForNode(node)).trim(),
    componentIcon: String(node.componentIcon || '').trim(),
    busOrientation: String(node.busOrientation || '').trim(),
    loadSplitId: String(node.loadSplitId || '').trim()
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
      loadSplitId: String(edge.loadSplitId || '').trim(),
      role,
      blocked,
      warning,
      flowKeys,
      flowKeyMode,
      route: edge.route && typeof edge.route === 'object'
        ? {
          manualRoute: Boolean(edge.route.manualRoute),
          locked: Boolean(edge.route.locked),
          waypoints: Array.isArray(edge.route.waypoints)
            ? edge.route.waypoints.map(point => ({ x: asNumber(point?.x, 0), y: asNumber(point?.y, 0) }))
            : []
        }
        : undefined
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
  const voltageOptions = [0.415, 0.8, 6.6, 11].map(optionVoltage => ({
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
  const effectiveArchitecture = electricalArchitecture.candidates.find(candidate => candidate.id === electricalArchitecture.recommendedId);
  const displayArchitecture = project.electrical.selectedArchitectureId && effectiveArchitecture ? effectiveArchitecture.name : architecture;
  return {
    designKw,
    roundedPvMwp,
    lvCurrentA,
    voltageOptions,
    flags,
    mvRecommended,
    architecture: displayArchitecture,
    architectureCandidates: electricalArchitecture.candidates,
    architectureRecommendedId: electricalArchitecture.recommendedId,
    architectureCalculatedRecommendedId: electricalArchitecture.calculatedRecommendedId,
    selectedArchitectureId: electricalArchitecture.selectedArchitectureId,
    selectedArchitectureValid: electricalArchitecture.selectedArchitectureValid,
    selectedArchitectureWarning: electricalArchitecture.selectedArchitectureWarning,
    transformerSizing,
    cableScreening,
    recommendation: mvRecommended
      ? 'Recommend 11kV MV integration or transformer-based architecture; LV-only 415V current is high.'
      : 'LV integration is feasible for concept stage; verify cable voltage drop and protection study.'
  };
}

function countTopologyNodes(topology = {}, predicate = () => false) {
  return (Array.isArray(topology.nodes) ? topology.nodes : []).filter(predicate).length;
}

function topologyNodeTypeCount(topology = {}, type = '') {
  return countTopologyNodes(topology, node => String(node.type || '') === type);
}

function hasTopologyNode(topology = {}, predicate = () => false) {
  return countTopologyNodes(topology, predicate) > 0;
}

function buildBoqRow(row = {}) {
  const quantity = asNumber(row.quantity, 0);
  return {
    id: normalizeBoqLineId(row.id, row.item),
    package: String(row.package || 'General').trim() || 'General',
    item: String(row.item || '').trim(),
    spec: String(row.spec || '').trim(),
    quantity: round(quantity, quantity % 1 === 0 ? 0 : 2),
    unit: String(row.unit || 'lot').trim() || 'lot',
    protection: String(row.protection || '').trim(),
    remark: String(row.remark || '').trim(),
    source: String(row.source || 'calculated').trim(),
    mandatory: row.mandatory !== false,
    nodeType: String(row.nodeType || '').trim(),
    productId: String(row.productId || '').trim(),
    productName: String(row.productName || '').trim(),
    supplierName: String(row.supplierName || '').trim(),
    manual: Boolean(row.manual),
    calculatedQuantity: row.calculatedQuantity === undefined ? round(quantity, quantity % 1 === 0 ? 0 : 2) : row.calculatedQuantity
  };
}

function applyBoqLineSelections(rows = [], selections = {}) {
  return rows.map((row) => {
    const selection = selections[row.id];
    if (!selection) return row;
    const quantity = selection.quantityOverride > 0 ? selection.quantityOverride : row.quantity;
    const bound = Boolean(selection.productId);
    return {
      ...row,
      quantity: round(quantity, quantity % 1 === 0 ? 0 : 2),
      unit: selection.unitOverride || row.unit,
      spec: selection.specOverride || row.spec,
      protection: selection.protectionOverride || row.protection,
      remark: selection.remark || row.remark,
      productId: selection.productId,
      productName: selection.productName,
      supplierName: selection.supplierName,
      source: bound ? 'product-bound' : row.source,
      manual: row.manual
    };
  });
}

function boqPackageOrder(packageName = '') {
  const idx = EPC_BOQ_PACKAGES.indexOf(String(packageName || '').trim());
  return idx === -1 ? EPC_BOQ_PACKAGES.length : idx;
}

function sortBoqRows(rows = [], lineOrder = []) {
  const orderMap = new Map(normalizeBoqLineIdList(lineOrder).map((id, index) => [id, index]));
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const packageDiff = boqPackageOrder(a.row.package) - boqPackageOrder(b.row.package);
      if (packageDiff) return packageDiff;
      const aOrder = orderMap.has(a.row.id) ? orderMap.get(a.row.id) : Number.POSITIVE_INFINITY;
      const bOrder = orderMap.has(b.row.id) ? orderMap.get(b.row.id) : Number.POSITIVE_INFINITY;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.index - b.index;
    })
    .map(item => item.row);
}

function buildBoq(project, recommended, context = {}) {
  const topology = context.topology || project.topology || {};
  const topologyFlow = context.topologyFlow || {};
  const pvStringDesign = context.pvStringDesign || {};
  const electricalArchitecture = context.electricalArchitecture || {};
  const loadAssetSummary = context.loadAssetSummary || buildLoadAssetSummary(project.loads?.assetGroups || [], project.gensets || project.loads?.gensets || []);
  const loadSplits = Array.isArray(project.loads?.loadSplits) ? project.loads.loadSplits : [];
  const nodes = Array.isArray(topology.nodes) ? topology.nodes : [];
  const flowNodes = new Map((Array.isArray(topologyFlow.nodes) ? topologyFlow.nodes : []).map(node => [node.id, node]));
  const validFlowEdges = (Array.isArray(topologyFlow.edges) ? topologyFlow.edges : []).filter(edge => !edge.blocked);
  const hasMvArchitecture = String(electricalArchitecture.recommendedId || '').startsWith('mv_')
    || nodes.some(node => String(node.type || '').startsWith('MV_'))
    || validFlowEdges.some(edge => asNumber(edge.voltageV, 0) >= 6000);
  const loadNodeCount = topologyNodeTypeCount(topology, 'LOAD') || Math.max(1, loadSplits.length || project.loads?.loadCount || 1);
  const flowLoadFeederCount = validFlowEdges.filter(edge => {
    const target = flowNodes.get(edge.target);
    return target?.type === 'LOAD' && (edge.flowKeys || []).some(key => String(key).startsWith('loadSplit:'));
  }).length;
  const loadFeederCount = flowLoadFeederCount || loadNodeCount;
  const stepUpTransformerCount = countTopologyNodes(topology, node => node.type === 'TRANSFORMER' && /step[-\s]?up/i.test(`${node.id} ${node.label}`));
  const loadTransformerCount = countTopologyNodes(topology, node => node.type === 'TRANSFORMER' && /load[-\s]?tx|load transformer/i.test(`${node.id} ${node.label}`));
  const mvSwitchboardCount = topologyNodeTypeCount(topology, 'MV_SWITCHBOARD');
  const ringRmuCount = countTopologyNodes(topology, node => /ring[-\s]?rmu/i.test(`${node.id} ${node.label}`));
  const mvBranchRmuCount = countTopologyNodes(topology, node => node.type === 'MV_BUS' && /rmu[-\s]?load/i.test(`${node.id} ${node.label}`));
  const lvBusCount = topologyNodeTypeCount(topology, 'LV_BUS');
  const topologyGensetCount = topologyNodeTypeCount(topology, 'GENSET');
  const gensetCount = Math.max(topologyGensetCount, loadAssetSummary.gensetZoneCount || 0);
  const gensetAssetCount = Math.max(loadAssetSummary.gensetCount || 0, topologyGensetCount);
  const emsCount = topologyNodeTypeCount(topology, 'EMS');
  const pvInverterNodeCount = topologyNodeTypeCount(topology, 'PV_INVERTER');
  const pvInverterUnitCount = Math.max(pvInverterNodeCount, recommended.pvRecommendedMwp > 0 ? Math.ceil((recommended.pvRecommendedMwp * 1000) / 800) : 0);
  const bessContainerCount = recommended.bessRecommendedMwh > 0
    ? Math.max(topologyNodeTypeCount(topology, 'BATTERY'), Math.ceil(recommended.bessRecommendedMwh / 5))
    : 0;
  const pcsUnitCount = recommended.pcsRecommendedMw > 0
    ? Math.max(topologyNodeTypeCount(topology, 'PCS'), Math.ceil(recommended.pcsRecommendedMw / 2.5))
    : 0;
  const rows = [];
  const add = (row, options = {}) => {
    const built = buildBoqRow(row);
    const includeZero = Boolean(options.includeZero);
    if (!built.id || !built.item) return;
    if (built.quantity <= 0 && !includeZero) return;
    rows.push(built);
  };

  add({
    id: 'pv-array-capacity',
    package: 'PV System',
    item: 'PV array DC capacity',
    spec: `Concept DC capacity based on ${project.solarResource?.dataSource || 'current solar resource'}`,
    quantity: round(recommended.pvRecommendedMwp, 2),
    unit: 'MWp',
    protection: 'Outdoor PV equipment, site-specific corrosion class',
    remark: recommended.hasCapacityOverride ? 'Manual capacity override active' : 'Calculated from selected replacement target',
    source: 'calculated',
    mandatory: true
  });
  add({
    id: 'pv-module-count',
    package: 'PV System',
    item: 'PV modules',
    spec: `${pvStringDesign.moduleWp || project.assumptions?.moduleWp || EPC_DESIGN_DEFAULTS.moduleWp}Wp module, ${pvStringDesign.modulesPerString || project.assumptions?.modulesPerString || EPC_DESIGN_DEFAULTS.modulesPerString} modules/string`,
    quantity: pvStringDesign.modules || 0,
    unit: 'pcs',
    protection: 'Junction box IP65 or above, C5-M frame if required',
    remark: `Array target ${round(recommended.pvRecommendedMwp, 2)} MWp`,
    source: 'calculated',
    mandatory: true
  });
  add({
    id: 'pv-mounting',
    package: 'PV System',
    item: 'PV mounting structure',
    spec: 'Fixed tilt mounting, complete clamps, anchors and bracing',
    quantity: recommended.pvRecommendedMwp > 0 ? 1 : 0,
    unit: 'lot',
    protection: 'Hot-dip galvanized / C5-M coating by site condition',
    remark: 'Final quantity by layout and civil survey',
    source: 'calculated',
    mandatory: true
  });
  add({
    id: 'pv-string-count',
    package: 'PV System',
    item: 'PV strings',
    spec: `${pvStringDesign.modulesPerString || project.assumptions?.modulesPerString || EPC_DESIGN_DEFAULTS.modulesPerString} modules per string`,
    quantity: pvStringDesign.strings || 0,
    unit: 'string',
    protection: 'DC1500V design basis',
    remark: 'String count from current module wattage',
    source: 'calculated',
    mandatory: true
  });
  add({
    id: 'pv-combiner-box',
    package: 'PV System',
    item: 'Smart PV combiner box',
    spec: `${pvStringDesign.combinerInputs || project.assumptions?.combinerInputs || EPC_DESIGN_DEFAULTS.combinerInputs} inputs, DC1500V, SPD and monitoring`,
    quantity: pvStringDesign.combiners || 0,
    unit: 'pcs',
    protection: 'IP65, C5-M when outdoor',
    remark: 'Connect monitoring to EMS where applicable',
    source: 'calculated',
    mandatory: true
  });
  add({
    id: 'pv-inverter',
    package: 'PV System',
    item: 'PV inverter / inverter station',
    spec: '800kW class, 415V/50Hz concept basis',
    quantity: pvInverterUnitCount,
    unit: 'pcs',
    protection: 'IP65, C5-M when outdoor',
    remark: `${pvInverterNodeCount || 1} topology node(s), unit count rounded by capacity`,
    source: 'topology',
    nodeType: 'PV_INVERTER',
    mandatory: true
  });
  add({
    id: 'pv-dc-cable',
    package: 'PV System',
    item: 'PV DC cable and connectors',
    spec: 'DC1500V flame-retardant PV cable and waterproof connectors',
    quantity: recommended.pvRecommendedMwp > 0 ? 1 : 0,
    unit: 'lot',
    protection: 'UV-resistant, corrosion-resistant accessories',
    remark: 'Final length by layout',
    source: 'calculated',
    mandatory: true
  });

  add({
    id: 'bess-energy-capacity',
    package: 'BESS',
    item: 'BESS usable energy package',
    spec: 'LFP battery system, liquid cooling/fire protection by vendor design',
    quantity: round(recommended.bessRecommendedMwh, 2),
    unit: 'MWh',
    protection: 'Outdoor IP65, C5-M when required',
    remark: 'Concept energy capacity before vendor finalization',
    source: 'calculated',
    mandatory: recommended.bessRecommendedMwh > 0
  });
  add({
    id: 'bess-container',
    package: 'BESS',
    item: 'BESS container / cabinet',
    spec: 'Containerized battery system including racks, HVAC and internal DC protection',
    quantity: bessContainerCount,
    unit: 'set',
    protection: 'IP65, C5-M outdoor enclosure',
    remark: `${topologyNodeTypeCount(topology, 'BATTERY') || 1} battery topology node(s)`,
    source: 'topology',
    nodeType: 'BATTERY',
    mandatory: recommended.bessRecommendedMwh > 0
  });
  add({
    id: 'pcs-capacity',
    package: 'BESS',
    item: 'PCS power capacity',
    spec: 'Bidirectional PCS, grid-forming/off-grid capable where required',
    quantity: round(recommended.pcsRecommendedMw, 2),
    unit: 'MW',
    protection: 'IP65, C5-M when outdoor',
    remark: 'PCS sizing from selected BESS role and peak/load support logic',
    source: 'calculated',
    mandatory: recommended.pcsRecommendedMw > 0
  });
  add({
    id: 'pcs-units',
    package: 'BESS',
    item: 'PCS units',
    spec: '2.5MW class unit concept basis',
    quantity: pcsUnitCount,
    unit: 'pcs',
    protection: 'IP65, C5-M when outdoor',
    remark: `${topologyNodeTypeCount(topology, 'PCS') || 1} PCS topology node(s)`,
    source: 'topology',
    nodeType: 'PCS',
    mandatory: recommended.pcsRecommendedMw > 0
  });
  add({ id: 'bms', package: 'BESS', item: 'Battery management system BMS', spec: 'Cell voltage, temperature, SOC/SOH, balancing and protection interface', quantity: bessContainerCount, unit: 'set', protection: 'Integrated in BESS enclosure', remark: 'Linked with PCS and EMS', source: 'calculated', mandatory: recommended.bessRecommendedMwh > 0 });
  add({ id: 'bess-fire-suppression', package: 'BESS', item: 'BESS fire detection and suppression', spec: 'Smoke/heat/flammable gas detection and battery fire suppression package', quantity: bessContainerCount, unit: 'set', protection: 'Battery enclosure fire-rated package', remark: 'Vendor design to confirm local compliance', source: 'calculated', mandatory: recommended.bessRecommendedMwh > 0 });
  add({ id: 'bess-thermal-control', package: 'BESS', item: 'BESS thermal and dehumidification system', spec: 'Liquid cooling / HVAC and dehumidification package', quantity: bessContainerCount, unit: 'set', protection: 'Outdoor-rated auxiliary system', remark: 'High humidity and temperature duty basis', source: 'calculated', mandatory: recommended.bessRecommendedMwh > 0 });

  add({ id: 'mv-step-up-transformer', package: 'Electrical Distribution', item: 'Step-up transformer', spec: `${project.electrical?.voltageKv || EPC_DESIGN_DEFAULTS.lvVoltageKv}kV to MV step-up transformer package`, quantity: hasMvArchitecture ? stepUpTransformerCount : 0, unit: 'set', protection: 'Outdoor enclosure / transformer protection by site', remark: 'Counted from final SLD topology', source: 'topology', nodeType: 'TRANSFORMER', mandatory: hasMvArchitecture });
  add({ id: 'mv-switchboard', package: 'Electrical Distribution', item: 'MV Switchboard', spec: `${electricalArchitecture.recommendedId || 'MV'} architecture switchgear package`, quantity: hasMvArchitecture ? mvSwitchboardCount : 0, unit: 'set', protection: 'MV switchgear enclosure by project environment', remark: 'Counted from final SLD topology', source: 'topology', nodeType: 'MV_SWITCHBOARD', mandatory: hasMvArchitecture });
  add({ id: 'ring-rmu', package: 'Electrical Distribution', item: 'Ring RMU', spec: '11kV ring main unit concept package', quantity: hasMvArchitecture ? ringRmuCount : 0, unit: 'set', protection: 'Outdoor MV enclosure as required', remark: 'Main ring node counted from final SLD topology', source: 'topology', nodeType: 'MV_BUS', mandatory: ringRmuCount > 0 });
  add({ id: 'mv-load-branch-rmu', package: 'Electrical Distribution', item: 'MV load branch RMU / feeder bay', spec: 'MV feeder interface to downstream load transformer', quantity: hasMvArchitecture ? mvBranchRmuCount : 0, unit: 'set', protection: 'Outdoor MV enclosure as required', remark: 'One per MV load branch where shown in SLD', source: 'topology', nodeType: 'MV_BUS', mandatory: mvBranchRmuCount > 0 });
  add({ id: 'load-transformer', package: 'Electrical Distribution', item: 'Load step-down transformer', spec: 'MV to 415V transformer for load branch', quantity: hasMvArchitecture ? loadTransformerCount : 0, unit: 'set', protection: 'Transformer protection and enclosure by site', remark: 'One per MV-to-LV load branch where shown in SLD', source: 'topology', nodeType: 'TRANSFORMER', mandatory: loadTransformerCount > 0 });
  add({ id: 'lv-bus', package: 'Electrical Distribution', item: 'LV bus / distribution board', spec: '415V busbar, incomer, metering and feeder protection', quantity: lvBusCount, unit: 'set', protection: 'IP65, C5-M when outdoor', remark: 'Counted from LV bus nodes in final SLD', source: 'topology', nodeType: 'LV_BUS', mandatory: lvBusCount > 0 });
  add({ id: 'load-feeder', package: 'Electrical Distribution', item: 'Load feeder / distribution circuit', spec: '415V outgoing feeder to site load branch', quantity: loadFeederCount, unit: 'way', protection: 'Breaker, metering, SPD and cable termination by load', remark: 'Derived from valid EMS/topology load edges', source: 'topology', nodeType: 'LOAD', mandatory: loadFeederCount > 0 });
  add({ id: 'genset-interface', package: 'Electrical Distribution', item: 'Genset interface panel', spec: '415V synchronization / remote start-stop interface', quantity: gensetCount, unit: 'set', protection: 'IP65, C5-M when outdoor', remark: loadAssetSummary.gensetCount ? 'Grouped by genset zone; asset-level controls are listed in EMS scope' : 'Existing genset interface where applicable', source: loadAssetSummary.gensetCount ? 'asset-mapping' : 'topology', nodeType: 'GENSET', mandatory: gensetCount > 0 });
  add({ id: 'crusher-feeder-cabinet', package: 'Electrical Distribution', item: 'Crusher feeder cabinet', spec: 'Motor feeder / MCC outgoing panel for crusher branches', quantity: loadAssetSummary.crusherFeederCabinetCount || 0, unit: 'set', protection: 'MCCB/ACB, motor protection and metering by branch', remark: 'Derived from asset mapping', source: 'asset-mapping', mandatory: loadAssetSummary.crusherFeederCabinetCount > 0 });
  add({ id: 'screen-feeder-cabinet', package: 'Electrical Distribution', item: 'Screen and conveyor feeder cabinet', spec: 'Motor feeder panel for screen and conveyor branches', quantity: loadAssetSummary.screenFeederCabinetCount || 0, unit: 'set', protection: 'MCCB, overload, emergency stop and local isolation', remark: 'Derived from asset mapping', source: 'asset-mapping', mandatory: loadAssetSummary.screenFeederCabinetCount > 0 });
  add({ id: 'pump-feeder-cabinet', package: 'Electrical Distribution', item: 'Pump feeder cabinet', spec: 'Pump feeder panel with motor protection and local control interface', quantity: loadAssetSummary.pumpFeederCabinetCount || 0, unit: 'set', protection: 'Motor protection relay, overload and isolator', remark: 'Derived from asset mapping', source: 'asset-mapping', mandatory: loadAssetSummary.pumpFeederCabinetCount > 0 });
  add({ id: 'auxiliary-feeder-cabinet', package: 'Electrical Distribution', item: 'Auxiliary feeder cabinet', spec: 'Auxiliary lighting/workshop feeder panel', quantity: loadAssetSummary.auxiliaryFeederCabinetCount || 0, unit: 'set', protection: 'MCB/MCCB feeder protection and local isolation', remark: 'Derived from asset mapping', source: 'asset-mapping', mandatory: loadAssetSummary.auxiliaryFeederCabinetCount > 0 });
  add({ id: 'vfd-feeder-cabinet', package: 'Electrical Distribution', item: 'VFD feeder cabinet', spec: 'Variable frequency drive cabinet for crusher/pump speed control branches', quantity: loadAssetSummary.vfdCabinetCount || 0, unit: 'set', protection: 'Input/output reactor, bypass/isolation and motor protection', remark: 'Derived from asset mapping', source: 'asset-mapping', mandatory: loadAssetSummary.vfdCabinetCount > 0 });
  add({ id: 'zone-metering-cabinet', package: 'Electrical Distribution', item: 'Zone metering cabinet', spec: 'Dedicated branch metering and feeder status collection by production zone', quantity: loadAssetSummary.meteringCabinetCount || 0, unit: 'set', protection: 'Multifunction meter, CTs, SPD and communication gateway', remark: 'Derived from asset mapping', source: 'asset-mapping', mandatory: loadAssetSummary.meteringCabinetCount > 0 });
  add({ id: 'surge-earthing', package: 'Electrical Distribution', item: 'Surge protection and earthing system', spec: 'AC/DC SPD and combined grounding network', quantity: nodes.length ? 1 : 0, unit: 'lot', protection: 'Corrosion-resistant grounding electrodes', remark: 'Final resistance and lightning study by detailed design', source: 'calculated', mandatory: true });

  add({ id: 'ems-controller', package: 'EMS & Monitoring', item: 'EMS main controller', spec: 'PV/BESS/genset/load dispatch logic with programmable operation modes', quantity: Math.max(emsCount, 1), unit: 'set', protection: 'IP65 industrial enclosure where field-mounted', remark: 'Linked to topology-aware EMS Flow', source: 'ems-flow', nodeType: 'EMS', mandatory: true });
  add({ id: 'ems-data-acquisition', package: 'EMS & Monitoring', item: 'Data acquisition unit', spec: 'Voltage, current, power, temperature, SOC and feeder status acquisition', quantity: validFlowEdges.length ? 1 : 0, unit: 'lot', protection: 'Industrial communication modules', remark: 'Covers valid active EMS Flow edges only', source: 'ems-flow', mandatory: true });
  add({ id: 'genset-remote-control', package: 'EMS & Monitoring', item: 'Genset remote control interface', spec: 'Remote start-stop, breaker status and EMS dispatch interface per genset', quantity: gensetAssetCount, unit: 'set', protection: 'Industrial I/O and protocol gateway', remark: loadAssetSummary.gensetCount ? 'Expanded from asset list rather than single topology symbol' : 'Counted from topology genset node', source: loadAssetSummary.gensetCount ? 'asset-mapping' : 'topology', nodeType: 'GENSET', mandatory: gensetAssetCount > 0 });
  add({ id: 'genset-metering-runtime', package: 'EMS & Monitoring', item: 'Genset metering and runtime monitor', spec: 'Power, fuel/runtime and synchronization/breaker status monitoring per genset', quantity: gensetAssetCount, unit: 'set', protection: 'Revenue-grade or industrial meter with RS485/Ethernet interface', remark: loadAssetSummary.gensetCount ? 'Expanded from asset list for dispatch and maintenance visibility' : 'Counted from topology genset node', source: loadAssetSummary.gensetCount ? 'asset-mapping' : 'topology', nodeType: 'GENSET', mandatory: gensetAssetCount > 0 });
  add({ id: 'ems-hmi', package: 'EMS & Monitoring', item: 'Local HMI / operator panel', spec: 'Industrial touch screen for local monitoring and parameter setting', quantity: 1, unit: 'set', protection: 'IP65 for field panel or indoor console', remark: 'Operator interface for commissioning and O&M', source: 'ems-flow', mandatory: true });
  add({ id: 'ems-remote-communication', package: 'EMS & Monitoring', item: 'Remote communication terminal', spec: '4G/fiber router, remote alarm and maintenance access', quantity: 1, unit: 'set', protection: 'Industrial communication enclosure', remark: 'Final SIM/fiber scope by site survey', source: 'ems-flow', mandatory: true });

  add({ id: 'aux-ventilation-fire', package: 'Auxiliary', item: 'Auxiliary ventilation, fire and maintenance package', spec: 'Ventilation/HVAC, extinguishers, seals, tools and meters', quantity: 1, unit: 'lot', protection: 'Outdoor and corrosion-resistant accessories', remark: 'Scope refined by detailed layout and vendor manuals', source: 'calculated', mandatory: true });
  add({ id: 'documents-certification', package: 'Documents & Certification', item: 'Documentation and certification package', spec: 'IEC/UL/CE certificates, SLD, wiring drawings, manuals and commissioning records', quantity: 1, unit: 'lot', protection: 'N/A', remark: 'Customer handover document set', source: 'calculated', mandatory: true });

  const hiddenPackages = new Set(normalizeBoqHiddenPackages(project.boq?.hiddenPackages || []));
  const hiddenLineIds = new Set(normalizeBoqLineIdList(project.boq?.hiddenLineIds || []));
  const selectedRows = applyBoqLineSelections(rows, project.boq?.lineSelections || {})
    .filter(row => !hiddenPackages.has(row.package) && !hiddenLineIds.has(row.id));
  const manualRows = normalizeBoqManualItems(project.boq?.manualItems || [])
    .filter(row => !hiddenPackages.has(row.package) && !hiddenLineIds.has(row.id));
  return sortBoqRows([...selectedRows, ...manualRows], project.boq?.lineOrder || []);
}

function applyRiskStatuses(project, risks = [], context = {}) {
  const acknowledgements = normalizeRiskAcknowledgements(project.riskAcknowledgements || {});
  return risks.map((risk) => {
    const id = normalizeBoqLineId(risk.id);
    const acknowledgement = acknowledgements[id];
    const selectedArchitectureId = String(context.electricalArchitecture?.selectedArchitectureId || project.electrical?.selectedArchitectureId || '');
    const selectedArchitectureValid = Boolean(context.electricalArchitecture?.selectedArchitectureValid);
    if (id === 'electrical-mv-current' && selectedArchitectureId === 'mv_11_ring' && selectedArchitectureValid) {
      return {
        ...risk,
        id,
        status: 'auto-cleared',
        blocking: false,
        clearedBy: 'Selected 11kV Ring architecture avoids the 415V high-current concept risk.'
      };
    }
    if (acknowledgement) {
      return {
        ...risk,
        id,
        status: 'manual-acknowledged',
        blocking: false,
        acknowledgement
      };
    }
    return {
      ...risk,
      id,
      status: 'open',
      blocking: risk.level === 'High'
    };
  });
}

function buildReportGate(risks = []) {
  const blockingRisks = risks.filter(risk => risk.level === 'High' && risk.blocking !== false);
  return {
    blocked: blockingRisks.length > 0,
    blockingHighRiskCount: blockingRisks.length,
    blockingRiskIds: blockingRisks.map(risk => risk.id)
  };
}

function buildRisks(project, load, electrical, recommended, context = {}) {
  const risks = [];
  const addRisk = (id, level, area, issue) => risks.push({ id, level, area, issue });
  if (project.loads.measurementMethod !== 'energy_meter') {
    addRisk('load-measurement', 'High', 'Load', 'Sizing is not based on measured meter data; measured load curve is required before guarantee.');
  }
  if (project.solarResource.dataSource === 'Malaysia Default') {
    addRisk('solar-resource-default', 'Medium', 'Solar', 'Solar resource uses Malaysia default yield; import Global Solar Atlas or PVsyst data for precise design.');
  }
  if (electrical.mvRecommended) {
    addRisk('electrical-mv-current', 'High', 'Electrical', '415V current exceeds concept threshold; 11kV MV architecture should be checked.');
  }
  if (project.site.availableAreaM2 > 0 && recommended.requiredAreaM2 > project.site.availableAreaM2) {
    addRisk('civil-pv-area', 'High', 'Civil', 'Required PV area exceeds available area; phase or reduce PV capacity.');
  }
  if (recommended.hasCapacityOverride) {
    addRisk('capacity-override', 'Medium', 'Sizing', 'Manual capacity override is active; calculated recommendation should remain auditable before final quote.');
  }
  if (recommended.bessRecommendedMwh > 0) {
    addRisk('bess-vendor-validation', 'Medium', 'BESS', 'BESS duty, DoD, C-rate, thermal/fire separation and EMS sequence require vendor validation.');
  }
  return applyRiskStatuses(project, risks, context);
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

function assetListHourlyLoadProfile(project, load) {
  if (project.loads.measurementMethod !== 'asset_genset_fuel_mapping') return [];
  const profile = project.loads.feederZoning?.assetTimeProfile;
  const hourly = Array.isArray(profile?.hourly) ? profile.hourly : [];
  const profileDailyKwh = asNumber(profile?.dailyKwh, hourly.reduce((sum, row) => sum + asNumber(row.loadKw, 0), 0));
  if (!(profileDailyKwh > 0)) return [];
  return hourly
    .filter(row => asNumber(row.loadKw, 0) > 0)
    .map(row => {
      const hour = Math.round(asNumber(row.hour, 0));
      return {
        hour,
        hourLabel: `${formatMinutes(hour * 60)}-${formatMinutes(hour * 60 + 60, hour >= 23 ? 1 : 0)}`,
        flowKey: `asset-list-${hour}`,
        loadKw: round(asNumber(row.loadKw, 0), 2),
        assets: Array.isArray(row.assets) ? row.assets.slice() : []
      };
    });
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
  const assetLoadProfile = assetListHourlyLoadProfile(project, load);
  const loadProfile = scheduleLoadProfile.length ? scheduleLoadProfile : assetLoadProfile.length ? assetLoadProfile : project.loadProfile.length ? project.loadProfile : defaultHourlyLoadProfile(project, load);
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
      const rowLoadSplits = splitLoadKw(round(loadKw, 2), project.loads.loadSplits || []);
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
          socPct: batteryKwh > 0 ? round((socKwh / batteryKwh) * 100, 1) : 0,
          loadSplits: rowLoadSplits
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
    method: `EMS order: PV -> Load, Excess PV -> Battery, Battery -> Load, Genset -> Load, curtail surplus.${densePvProfile ? ' PV profile source: PV Simulator.' : ''}${scheduleLoadProfile.length ? ' Load profile source: Equipment Schedule timetable.' : assetLoadProfile.length ? ' Load profile source: Asset List timetable.' : ''}`,
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
    calculatedRecommendedId: electrical.architectureCalculatedRecommendedId || '',
    selectedArchitectureId: electrical.selectedArchitectureId || '',
    selectedArchitectureValid: Boolean(electrical.selectedArchitectureValid),
    selectedArchitectureWarning: electrical.selectedArchitectureWarning || '',
    recommendation: (electrical.architectureCandidates || []).some(candidate => candidate.id === electrical.architectureRecommendedId)
      ? `${(electrical.architectureCandidates || []).find(candidate => candidate.id === electrical.architectureRecommendedId).name} is preferred for this concept screen.`
      : electrical.recommendation,
    disclaimer: 'Experience-rule architecture screening only; not a statutory requirement or final engineering design.'
  };
  const cableScreening = electrical.cableScreening || { candidates: [] };
  const architectureComparison = buildArchitectureComparison(project, electricalArchitecture, cableScreening);
  let topologySelection = buildTopologySelection(project, electricalArchitecture);
  const topologyBuildOptions = {
    architectureId: electricalArchitecture.recommendedId,
    standardTopologyLibrary: project.calculationAssumptions?.standardTopologyLibrary
  };
  let topologyProject = project.selectedTopologyId === 'CUSTOM'
    ? project
    : {
      ...project,
      topology: normalizePowerTopology({ selectedTopologyId: project.selectedTopologyId }, project.selectedTopologyId, project.loads, topologyBuildOptions)
    };
  if (project.selectedTopologyId !== 'CUSTOM' && !topologySelection.selectedTopologyAllowed && topologySelection.selectableTopologies.length) {
    const autoSelectedTopologyId = topologySelection.selectableTopologies[0].id;
    topologyProject = {
      ...project,
      selectedTopologyId: autoSelectedTopologyId,
      topology: normalizePowerTopology({ selectedTopologyId: autoSelectedTopologyId }, autoSelectedTopologyId, project.loads, topologyBuildOptions)
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
  const loadAssetSummary = buildLoadAssetSummary(topologyProject.loads?.assetGroups || [], topologyProject.gensets || topologyProject.loads?.gensets || []);
  const feederZoning = topologyProject.loads?.feederZoning || buildFeederZoning(topologyProject.loads?.assets || [], topologyProject.gensets || topologyProject.loads?.gensets || [], {
    operationHoursPerDay: topologyProject.loads?.operationHoursPerDay,
    voltageLv: FEEDER_ZONING_DEFAULTS.voltageLv,
    powerFactor: topologyProject.electrical?.powerFactor || FEEDER_ZONING_DEFAULTS.powerFactor
  });
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
  const boq = buildBoq(topologyProject, recommended, {
    topology: topologyProject.topology,
    topologyFlow,
    electricalArchitecture,
    pvStringDesign,
    loadAssetSummary,
    feederZoning
  });
  const risks = buildRisks(project, load, electrical, recommended, { electricalArchitecture });
  const reportGate = buildReportGate(risks);
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
    standardTopologies: standardTopologies({
      standardTopologyLibrary: project.calculationAssumptions?.standardTopologyLibrary,
      loads: project.loads,
      architectureId: electricalArchitecture.recommendedId
    }),
    topologyValidation,
    topologyFlow,
    topologySelection,
    loadAssetSummary,
    feederZoning,
    electrical,
    electricalArchitecture,
    architectureComparison,
    cableScreening,
    protectionMatrix,
    emsStateMachine,
    energyFlow,
    pvStringDesign,
    boq,
    risks,
    reportGate,
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
  const moduleWpValue = Math.max(1, asNumber(moduleWp, EPC_DESIGN_DEFAULTS.moduleWp));
  const modulesPerStringValue = Math.max(1, asNumber(modulesPerString, EPC_DESIGN_DEFAULTS.modulesPerString));
  const modules = Math.ceil((asNumber(targetPvMwp, 0) * 1000000) / moduleWpValue);
  const strings = Math.ceil(modules / modulesPerStringValue);
  const fullStringModuleCount = strings * modulesPerStringValue;
  const stringRoundingGapModules = Math.max(0, fullStringModuleCount - modules);
  const architecture = String(inverterArchitecture || 'central');
  const combiners = architecture === 'string'
    ? 0
    : Math.ceil(strings / Math.max(1, asNumber(combinerInputs, EPC_DESIGN_DEFAULTS.combinerInputs)));
  const inputCount = asNumber(totalStringInputs, 0);
  const warnings = [];
  if (inputCount > 0 && modules / inputCount < asNumber(minimumExpectedModulesPerString, 18)) {
    warnings.push('Review module/string ratio: total string inputs imply unusually low modules per string.');
  }
  if (stringRoundingGapModules > 0) {
    warnings.push(`Full string procurement requires ${fullStringModuleCount} modules, ${stringRoundingGapModules} more than the target module count.`);
  }
  return {
    targetPvMwp: asNumber(targetPvMwp, 0),
    moduleWp: moduleWpValue,
    modules,
    modulesPerString: modulesPerStringValue,
    strings,
    fullStringModuleCount,
    stringRoundingGapModules,
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


  global.MinovaEpcDesignEngine={EPC_DESIGN_VERSION,GLOBAL_SOLAR_ATLAS_API_BASE,EPC_DESIGN_DEFAULTS,buildEpcDesignProjectFromQuickInputs,calculateEpcDesignProject,calculatePvStringDesign,buildGlobalSolarAtlasUrl,buildGlobalSolarAtlasApiUrls,parseGlobalSolarAtlasSolarResource,normalizeEpcDesignProject,normalizeEpcDesignProjectList};
})(typeof window!=="undefined"?window:globalThis);
