import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const mergeSource = readFileSync(new URL('../github-sync/merge.js', import.meta.url), 'utf8');

test('EPC design tab is placed between Product List and Engineering Workspace', () => {
  const databasePos = html.indexOf('id="tab-database"');
  const epcPos = html.indexOf('id="tab-epcdesign"');
  const engineeringPos = html.indexOf('id="tab-engineering"');

  assert.ok(databasePos > -1, 'database tab exists');
  assert.ok(epcPos > databasePos, 'EPC tab is after Product List');
  assert.ok(engineeringPos > epcPos, 'Engineering tab is after EPC tab');
  assert.match(html, /id="tab-epcdesign"[^>]*aria-label="Hybrid EPC Design"/);
  assert.match(html, /id="tab-epcdesign"[\s\S]*?<svg/);
  assert.match(html, /<script src="\.\/epc-design-engine\.global\.js\?v=epc-design-v2"><\/script>\s*<script type="module">\s*const \{/);
  assert.doesNotMatch(html, /<script type="module">\s*import \{\s*EPC_DESIGN_DEFAULTS/);
});

test('EPC design workspace exposes quick detailed map solar and report surfaces', () => {
  const section = html.match(/<main id="view-epcdesign"[\s\S]*?<main id="view-engineering"/);
  assert.ok(section, 'EPC design view exists before Engineering workspace');
  const source = section[0];

  for (const snippet of [
    'Quick Design',
    'Detailed Design',
    'Use Current Location',
    'Global Solar Atlas',
    'epc-design-map',
    'epc-round-up-sizing',
    'data-epc-field="designTargets.roundUpSizing"',
    'Round up',
    'epc-recommendation-target-toggle',
    'data-epc-recommendation-target="50"',
    'data-epc-recommendation-target="80"',
    'data-epc-recommendation-target="100"',
    'setEpcRecommendationTarget(50)',
    'setEpcRecommendationTarget(100)',
    'epc-design-schemes',
    'epc-design-formula-trace',
    'epc-design-boq',
    'epc-design-risks',
    'downloadEpcDesignReport'
  ]) {
    assert.match(source, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing EPC UI snippet: ${snippet}`);
  }
  assert.doesNotMatch(source, /Genset Replacement PV \+ BESS \+ Diesel Workspace/);
  assert.doesNotMatch(source, /Data quality:/);
  assert.doesNotMatch(source, /id="epc-design-quality"/);
  assert.doesNotMatch(source, />Engineering Calc</);
  assert.match(source, /<button[^>]*data-epc-download="engineering"[^>]*class="[^"]*\bhidden\b/);
});

test('EPC formula trace shows formula data instead of a raw inputs column', () => {
  assert.match(html, /function formatEpcFormulaData\(inputs = \{\}\)/);
  assert.match(html, />Formula Data<\/th>/);
  assert.match(html, /Object\.entries\(inputs \|\| \{\}\)/);
  assert.doesNotMatch(html, /<th class="px-3 py-2">Inputs<\/th>/);
  assert.doesNotMatch(html, /JSON\.stringify\(item\.inputs\)/);
});

test('EPC detailed engineering inputs are permission-gated separately from quick design', () => {
  assert.match(html, /id="epc-advanced-inputs"[^>]*data-epc-advanced-section="true"/);
  assert.match(html, /id="epc-detailed-fields"[^>]*data-epc-engineering-section="true"/);
  assert.match(html, /canPerformAction\?\.\('epcDesignEngineering', 'read'\)/);
  assert.match(html, /canPerformAction\?\.\('epcDesignEngineering', 'edit'\)/);
  assert.match(html, /const engineeringOnly = !!el\.closest\('#epc-detailed-fields'\)/);
});

test('EPC quick and detailed modes keep inputs and target controls scoped', () => {
  assert.match(html, /function updateEpcModeSpecificUi\(\)/);
  assert.match(html, /id="epc-detail-inputs-panel"[^>]*data-epc-detail-inputs-panel="true"/);
  assert.match(html, /document\.getElementById\('epc-detail-inputs-panel'\)\?\.classList\.toggle\('hidden', !detailed\)/);
  assert.match(html, /document\.getElementById\('epc-advanced-inputs'\)\?\.classList\.toggle\('hidden', !detailed\)/);
  assert.match(html, /document\.getElementById\('epc-recommendation-target-toggle'\)\?\.classList\.toggle\('hidden', epcDesignMode === 'detailed'\)/);
  assert.match(html, /id="epc-change-working-time-row"[^>]*data-epc-hide-for-load-method="equipment_schedule"[^>]*class="rounded-xl border border-slate-200 bg-slate-50 p-2\.5"/);
  assert.match(html, /title="When checked, original genset average load is multiplied by the new PV working hours to update Daily Load and downstream sizing\."/);
  assert.doesNotMatch(html, /<p[^>]*>When checked, original genset average load is multiplied by the new PV working hours to update Daily Load and downstream sizing\.<\/p>/);
});

test('EPC quick inputs keep support hours and module wattage while detailed inputs expand horizontally below the main workspace', () => {
  const supportPos = html.indexOf('id="epc-support-hours"');
  const modulePos = html.indexOf('id="epc-module-wp"');
  const detailPanelPos = html.indexOf('id="epc-detail-inputs-panel"');
  const gridEndPos = html.indexOf('<div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">', detailPanelPos);

  assert.ok(supportPos > -1 && modulePos > -1 && detailPanelPos > -1, 'required EPC inputs exist');
  assert.ok(supportPos < detailPanelPos, 'Support Hours remains in the quick input column');
  assert.ok(modulePos < detailPanelPos, 'Module Wp remains in the quick input column');
  assert.ok(detailPanelPos < gridEndPos, 'Detail Inputs panel is before lower tabbed panels');
  assert.match(html, /id="epc-load-measurement-method"[^>]*data-epc-field="loads\.measurementMethod"/);
  assert.match(html, />Load Measurement<\/label>/);
  assert.match(html, />Diesel \/ SFC estimate<\/option>/);
  assert.match(html, /measurementMethod:\s*'diesel_sfc_estimate'/);
  assert.match(html, /setInputValue\('epc-load-measurement-method', project\.loads\.measurementMethod \|\| 'diesel_sfc_estimate'\)/);
  assert.doesNotMatch(html, /id="epc-project-name"/);
  assert.match(html, /id="epc-detail-inputs-panel"[^>]*class="hidden bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mb-5"/);
  assert.match(html, /id="epc-advanced-inputs"[^>]*class="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 gap-3 p-4"/);
  assert.doesNotMatch(html, /id="epc-advanced-inputs"[^>]*space-y-3/);
});

test('EPC wizard steps expose realtime completion ticks', () => {
  assert.match(html, /data-epc-step="load"/);
  assert.match(html, /data-epc-step-check="load"/);
  assert.match(html, /onmouseenter="scheduleEpcWizardStepHint\('load'\)"/);
  assert.match(html, /onmouseleave="clearEpcWizardStepHint\('load'\)"/);
  assert.match(html, /function getEpcWizardStepRequirements\(project, result\)/);
  assert.match(html, /function scheduleEpcWizardStepHint\(step\)/);
  assert.match(html, /setTimeout\(\(\) => showEpcWizardStepHint\(step\), 1000\)/);
  assert.match(html, /data-epc-step-hint="load"/);
  assert.match(html, /Missing: /);
  assert.match(html, /measurementMethod === 'energy_meter'/);
  assert.match(html, /measurementMethod === 'equipment_schedule'/);
  assert.match(html, /measurementMethod === 'genset_kva_load_factor'/);
  assert.match(html, /dieselTotalLiters/);
  assert.match(html, /data-epc-step-check="pcs"/);
  assert.match(html, /data-epc-step-check="battery"/);
  assert.match(html, /data-epc-step-check="pv"/);
  assert.match(html, /data-epc-step-check="ems"/);
  assert.match(html, /function updateEpcWizardStepStatus\(result, project = getActiveEpcDesignProject\(\)\)/);
  assert.match(html, /epc-step-complete/);
  assert.match(html, /epc-step-pending/);
  assert.match(html, /updateEpcWizardStepStatus\(result, project\)/);
});

test('EPC workspace guides junior engineers through load PCS battery PV steps', () => {
  for (const snippet of [
    'epc-wizard-steps',
    'Step 1 Load',
    'Step 2 PCS',
    'Step 3 Battery',
    'Step 4 PV & Strings',
    'Step 5 EMS Simulation',
    'epc-day-start-time',
    'epc-day-finish-time',
    'epc-change-working-time-row',
    'epc-change-working-time',
    'change working time',
    'onEpcScheduleInputChanged',
    'updateEpcWorkingTimeVisibility',
    'epc-peak-load-factor',
    'data-epc-field="loads.peakLoadSafetyFactor"',
    'epc-allowed-genset-load',
    'data-epc-help="peak-load-factor"',
    'data-epc-help="allowed-genset-load"',
    'data-epc-help="critical-load"',
    'Peak Load = Avg Load x Safety Factor',
    'Peak Shaving PCS covers Peak minus this value',
    'Must-run load for backup or island mode',
    'epc-support-hours',
    'epc-module-wp',
    'epc-modules-per-string',
    'epc-combiner-inputs',
    'epc-energy-flow-table'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing guided EPC UI snippet: ${snippet}`);
  }
  assert.doesNotMatch(html, /data-epc-field="loads\.peakLoadKw"/);
  assert.doesNotMatch(html, /epc-night-work-enabled/);
  assert.doesNotMatch(html, /Work in night time/);
});

test('EPC map controls expose browser IP and manual location fallbacks', () => {
  for (const snippet of [
    'Use Current Location',
    'Use IP Location',
    'Fetch GSA Solar Data',
    'epc-map-current-location',
    'epc-map-pin-location',
    'epc-solar-pvout',
    'data-epc-solar-metric="pvout"',
    'data-epc-solar-metric="ghi"',
    'data-epc-solar-metric="dni"',
    'data-epc-solar-metric="temp"',
    'data-epc-help="solar-pvout"',
    'data-epc-help="solar-ghi"',
    'data-epc-help="solar-dni"',
    'data-epc-help="solar-temp"',
    'Specific photovoltaic power output from GSA',
    'Global horizontal irradiation from GSA',
    'Direct normal irradiation from GSA',
    'Ambient temperature from GSA',
    'project.solarResource.gsaPvoutKwhPerKwpDay',
    'window.fetchEpcGlobalSolarAtlasResource',
    'parseGlobalSolarAtlasSolarResource',
    'buildGlobalSolarAtlasApiUrls',
    'window.useEpcIpLocation',
    'ipapi.co/json',
    'Location permission was denied'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing location fallback snippet: ${snippet}`);
  }
  assert.doesNotMatch(html, /epc-solar-import/);
  assert.doesNotMatch(html, /Import pasted GSA values/);
  assert.doesNotMatch(html, /Paste GSA\/PVsyst values/);
  assert.doesNotMatch(html, /window\.importEpcSolarResource/);
});

test('EPC detailed inputs expose title pointers instead of inline helper paragraphs', () => {
  const section = html.match(/<section id="epc-detail-inputs-panel"[\s\S]*?<\/section>/);
  assert.ok(section, 'Detail Inputs section exists');
  const detailSection = section[0];
  for (const snippet of [
    'data-epc-help="detail-inputs"',
    'data-epc-help="target-replacement"',
    'data-epc-help="available-area"',
    'data-epc-help="peak-load-factor"',
    'data-epc-help="allowed-genset-load"',
    'data-epc-help="load-equipment-type"',
    'data-epc-help="bess-role"',
    'data-epc-help="pv-yield"',
    'data-epc-help="min-soc"',
    'data-epc-help="bess-dod"',
    'data-epc-help="power-factor"',
    'data-epc-help="critical-load"',
    'data-epc-help="modules-per-string"',
    'data-epc-help="combiner-inputs"',
    'data-epc-detail-group="load-site"',
    'data-epc-detail-group="battery-soc"',
    'data-epc-detail-group="solar-string"',
    'data-epc-detail-group="electrical-protection"',
    'Load & Site',
    'Battery & SOC',
    'Solar & Strings',
    'Electrical & Protection',
    'Detailed Design uses Target % here as the calculation standard.',
    'Target diesel replacement percentage used as the detailed design standard.',
    'Available site area for PV layout feasibility and land-use checks.',
    'Peak Load = Avg Load x Safety Factor; PCS is then rounded up to the next 0.5MW.',
    'Diesel power intentionally kept online; Peak Shaving PCS covers Peak minus this value.',
    'Select the operating load type so the model can keep recommendations tied to the site duty.',
    'Defines the battery operating purpose used by sizing, recommendation, and risk notes.',
    'Daily PV yield used for PV sizing; this should follow GSA PVOUT when solar data is fetched.',
    'Minimum battery state of charge reserved in EMS Flow.',
    'Usable battery depth of discharge applied to BESS sizing and EMS Flow SOC upper limit.',
    'Power factor used for AC current and voltage architecture checks.',
    'Must-run load for backup or island mode; blank falls back to average load.',
    'PV modules per string used for string count and combiner sizing.',
    'Combiner input count used to estimate combiner quantity from total strings.'
  ]) {
    assert.match(detailSection, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing detail helper snippet: ${snippet}`);
  }
  assert.doesNotMatch(detailSection, /epc-help-dot/);
  assert.doesNotMatch(detailSection, /data-tip=/);
  assert.match(detailSection, /title="Detailed Design uses Target % here as the calculation standard\."/);
  assert.match(detailSection, /title="Target diesel replacement percentage used as the detailed design standard\."/);
  assert.match(detailSection, /title="Must-run load for backup or island mode; blank falls back to average load\."/);
  assert.doesNotMatch(detailSection, /<p class="mt-1 text-\[10px\] leading-snug text-slate-400">Peak Load = Avg Load x Safety Factor/);
  assert.doesNotMatch(detailSection, /<p class="mt-1 text-\[10px\] leading-snug text-slate-400">Diesel power intentionally kept online/);
  assert.doesNotMatch(detailSection, /<p class="mt-1 text-\[10px\] leading-snug text-slate-400">Must-run load for backup or island mode/);
});

test('EPC engine preserves the Load Measurement method', () => {
  assert.match(html, /data-epc-field="loads\.measurementMethod"/);
  assert.match(html, /setNestedValue\(draft, path, value\)/);
  assert.match(html, /loads:\s*\{[^}]*measurementMethod:\s*'diesel_sfc_estimate'/s);
});

test('EPC load measurement modes expose method-specific inputs and state', () => {
  for (const snippet of [
    'data-epc-load-method-panel="energy_meter"',
    'data-epc-load-method-panel="equipment_schedule"',
    'data-epc-load-method-panel="genset_kva_load_factor"',
    'data-epc-load-method-panel="diesel_sfc_estimate"',
    'Upload Energy Meter File',
    'Raw Peak',
    'Smoothed Peak',
    'Edit Schedule',
    'epc-equipment-schedule-operating-hours',
    'loads.equipmentScheduleOperatingHours',
    'epc-equipment-schedule-duty',
    'loads.equipmentScheduleDutyCycle',
    'epc-equipment-schedule-simultaneity',
    'loads.equipmentScheduleSimultaneityFactor',
    'epc-equipment-schedule-flow-row',
    'epc-equipment-schedule-flow-toggle',
    'Schedule Load kW',
    'useEquipmentScheduleForEmsFlow',
    'epc-working-time-controls',
    'data-epc-hide-for-load-method="equipment_schedule"',
    'epc-equipment-schedule-modal',
    'epc-genset-kva',
    'data-epc-field="loads.gensetKvaInput.gensetKva"',
    'data-epc-field="loads.gensetKvaInput.powerFactor"',
    'data-epc-field="loads.gensetKvaInput.loadFactor"',
    'data-epc-field="loads.gensetKvaInput.runtimeHours"',
    'data-epc-field="loads.gensetKvaInput.overloadFactor"',
    'parseEpcEnergyMeterFile',
    'renderEpcLoadMeasurementPanels',
    'openEpcEquipmentScheduleModal',
    'saveEpcEquipmentScheduleRows',
    'energyMeterSummary',
    'equipmentSchedule',
    'equipmentScheduleOperatingHours',
    'gensetKvaInput'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing measurement UI snippet: ${snippet}`);
  }
  assert.match(html, /load:\s*!\s*requirements\.load\.missing\.length && result\.load\?\.dailyLoadKwh > 0 && result\.load\?\.averageLoadKw > 0 && result\.load\?\.peakLoadKw > 0/);
});

test('EPC Diesel SFC and SOC inputs are placed in the correct panels', () => {
  const dieselPanel = html.match(/<div data-epc-load-method-panel="diesel_sfc_estimate"[\s\S]*?<\/div>\s*<div class="grid grid-cols-2 gap-2">\s*<div>\s*<label class="block text-\[10px\] font-black text-slate-400 uppercase mb-1">Country/);
  assert.ok(dieselPanel, 'diesel estimate panel should be found before site inputs');
  assert.match(dieselPanel[0], /id="epc-sfc"/);
  assert.match(dieselPanel[0], /SFC L\/kWh/);

  const detailSection = html.match(/<div id="epc-advanced-inputs"[\s\S]*?<div>\s*<label class="epc-field-label text-\[10px\] font-black text-slate-400 uppercase mb-1" title="Must-run load/);
  assert.ok(detailSection, 'detail inputs should be found');
  assert.doesNotMatch(detailSection[0], /id="epc-sfc"/);
  assert.match(detailSection[0], /id="epc-min-soc"/);
  assert.match(detailSection[0], /Min SOC %/);
  assert.match(detailSection[0], /id="epc-bess-dod"/);
  assert.match(detailSection[0], /DoD %/);
  assert.match(html, /readEpcDodPercentInput/);
  assert.match(html, /setPercentInputValue\('epc-bess-dod'/);
});

test('EPC Equipment Schedule modal no longer exposes per-row duty and simultaneity', () => {
  const modalStart = html.indexOf('id="epc-equipment-schedule-modal"');
  const modalEnd = html.indexOf('id="epc-equipment-schedule-rows"', modalStart);
  const modalHeader = html.slice(modalStart, modalEnd);
  assert.ok(modalStart >= 0 && modalEnd > modalStart);
  assert.doesNotMatch(modalHeader, />Duty</);
  assert.doesNotMatch(modalHeader, />Simult\.</);
  assert.doesNotMatch(html, /data-epc-equipment-field="dutyCycle"/);
  assert.doesNotMatch(html, /data-epc-equipment-field="simultaneityFactor"/);
});

test('EPC EMS flow exposes animated system diagram and clickable hour rows', () => {
  for (const snippet of [
    'epc-flow-diagram',
    'epc-flow-svg',
    'epc-flow-summary',
    'selectEpcEnergyFlowHour',
    'data-epc-flow-hour',
    'data-epc-flow-hour-button',
    'epc-flow-line',
    'epc-flow-line-active',
    'epc-flow-node',
    'epc-flow-sun',
    'epc-flow-pv',
    'epc-flow-inverter',
    'epc-flow-battery',
    'epc-flow-genset',
    'epc-flow-load',
    'epc-flow-curtailment',
    'epc-flow-label',
    'epc-flow-node-frame',
    'epc-flow-orthogonal',
    'renderEpcSocBadge',
    'renderEpcFlowTotalRow',
    'epc-flow-total-row',
    'epc-soc-battery',
    'epc-soc-fill',
    'Total',
    'epc-load-equipment-type',
    'data-epc-field="loads.equipmentType"',
    'Crusher',
    'Conveyor',
    'Mining Machine',
    'Water Pump'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing animated flow snippet: ${snippet}`);
  }
  const flowRenderer = html.match(/function renderEpcEnergyFlow\(result\)[\s\S]*?function renderEpcReports\(result\)/);
  assert.ok(flowRenderer, 'EMS Flow renderer should be found');
  assert.doesNotMatch(flowRenderer[0], /renderEpcDeviceWork/, 'Device Work should not be embedded inside EMS Flow');
  assert.doesNotMatch(flowRenderer[0], /epc-device-work-panel/, 'Device Work panel should live in its own tab');
  assert.doesNotMatch(html, /class="[^"]*epc-flow-node[^"]*epc-flow-ems/, 'EMS should not be rendered as a flow node');
  assert.doesNotMatch(html, /<text[^>]*>EMS<\/text>/, 'PV should not terminate at an EMS node');
});

test('EPC Device Work is a standalone chart page with status analysis', () => {
  assert.match(html, /data-epc-panel-tab="flow"[\s\S]*?EMS Flow[\s\S]*?data-epc-panel-tab="devicework"[\s\S]*?Device Work[\s\S]*?data-epc-panel-tab="batterycontrol"[\s\S]*?Battery Control[\s\S]*?data-epc-panel-tab="pvsimulator"[\s\S]*?PV Simulator[\s\S]*?data-epc-panel-tab="reports"[\s\S]*?Reports/);
  for (const snippet of [
    'id="epc-device-work-page"',
    'data-epc-panel="devicework"',
    'renderEpcDeviceWorkPage',
    'renderEpcDeviceWorkChart',
    'renderEpcDeviceWorkAnalysis',
    'renderEpcDeviceWorkPath',
    'getEpcDeviceWorkTimelineRows',
    'getEpcDeviceWorkRowsForSettings',
    'getEpcDeviceWorkPathD',
    'getEpcDeviceWorkMetricUnit',
    'previewEpcDeviceWorkRange',
    'resetEpcDeviceWorkRange',
    'setEpcDeviceWorkInterval',
    'setEpcDeviceWorkRange',
    'setEpcDeviceWorkPeakBandTime',
    'setEpcDeviceWorkPeakBandVisible',
    'setEpcDeviceWorkPeakBandColor',
    'toggleEpcDeviceWorkColorPicker',
    'setEpcDeviceWorkSeriesColor',
    'EPC_DEVICE_WORK_COLOR_PRESETS',
    'epc-device-work-chart',
    'epc-device-work-svg',
    'epc-device-work-legend',
    'epc-device-work-controls',
    'epc-device-work-range-controls',
    'epc-device-work-reset',
    'epc-device-work-time-row',
    'data-epc-device-interval="1"',
    'data-epc-device-interval="5"',
    'data-epc-device-interval="15"',
    'data-epc-device-interval="30"',
    'data-epc-device-interval="60"',
    'data-epc-device-interval="120"',
    'data-epc-device-interval="360"',
    'data-epc-device-interval="720"',
    'epc-device-work-range-track',
    'epc-device-work-range-fill',
    'epc-device-work-range-start',
    'epc-device-work-range-end',
    'epc-device-work-range-ticks',
    'epc-device-work-range-start-label',
    'epc-device-work-range-end-label',
    'epc-device-work-zero-label',
    'epc-device-work-zero-line',
    'epc-device-work-axis-left',
    'epc-device-work-axis-right',
    'epc-device-work-peak-band',
    'epc-device-work-peak-toggle',
    'epc-device-work-peak-color',
    'epc-device-work-peak-start',
    'epc-device-work-peak-end',
    'Workday Peak',
    'epc-device-work-peak-label-below',
    'epc-device-work-line-pv',
    'epc-device-work-line-load',
    'epc-device-work-line-battery',
    'epc-device-work-line-genset',
    'epc-device-work-line-soc',
    'epc-device-work-analysis',
    'data-epc-device-analysis="pv"',
    'data-epc-device-analysis="load"',
    'data-epc-device-analysis="battery"',
    'data-epc-device-analysis="genset"',
    'data-epc-device-analysis="soc"',
    'data-epc-device-color-series="pv"',
    'data-epc-device-color-series="load"',
    'data-epc-device-color-series="battery"',
    'data-epc-device-color-series="genset"',
    'data-epc-device-color-series="soc"',
    'epc-device-work-color-trigger',
    'epc-device-work-color-anchor',
    'epc-device-work-color-popover',
    'z-index:9999',
    'kWh/period',
    'EPC_DEVICE_WORK_DEFAULT_PEAK_START_MINUTE',
    'EPC_DEVICE_WORK_DEFAULT_PEAK_END_MINUTE',
    'toggleEpcEmsFlowSeries',
    'restoreEpcEmsFlowSeries',
    'emsFlowDisplaySettings',
    'visibleSeries',
    'intervalMinutes',
    'selectedRange',
    'peakBand',
    'seriesColors',
    'Power axis padding 10%'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing Device Work chart snippet: ${snippet}`);
  }
  assert.match(html, /intervalMinutes\) : 5/, 'Device Work interval default should be 5 minutes');
  assert.match(html, /oninput="previewEpcDeviceWorkRange\('start', this\.value\)"/, 'range start should preview without rerendering every step');
  assert.match(html, /onchange="setEpcDeviceWorkRange\('start', this\.value\)"/, 'range start should commit on release');
  for (const removedSnippet of [
    'smoothDeviceWorkPath',
    'setEpcDeviceWorkLineStyle',
    'epc-device-work-style-smooth',
    'lineStyle:'
  ]) {
    assert.doesNotMatch(html, new RegExp(removedSnippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `removed Device Work snippet still present: ${removedSnippet}`);
  }
});

test('EPC PV Simulator is a standalone page feeding EMS and Device Work PV data', () => {
  const section = html.match(/<main id="view-epcdesign"[\s\S]*?<main id="view-engineering"/);
  assert.ok(section, 'EPC design view exists');
  const source = section[0];

  for (const snippet of [
    'data-epc-panel-tab="pvsimulator"',
    'PV Simulator',
    'id="epc-pv-simulator-page"',
    'data-epc-panel="pvsimulator"',
    'renderEpcPvSimulatorPage(result)',
    'function renderEpcPvSimulatorPage(result)',
    'function buildEpcPvSimulatorProfile(',
    'function generateEpcPvSimulator(',
    'epc-pv-simulator-weather',
    'epc-pv-simulator-lock-seed',
    'epc-pv-simulator-seed',
    'Fixed random state',
    'weather_mode',
    'cloud_state',
    'temperature_factor',
    'soiling_factor',
    'inverter_limit_active',
    'curtailment_active',
    'solarResource.hourlyPvProfile',
    "dataSource: 'PV Simulator'"
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing PV Simulator snippet: ${snippet}`);
  }

  const deviceWorkPos = source.indexOf('data-epc-panel-tab="devicework"');
  const batteryControlPos = source.indexOf('data-epc-panel-tab="batterycontrol"');
  const pvSimulatorPos = source.indexOf('data-epc-panel-tab="pvsimulator"');
  const reportsPos = source.indexOf('data-epc-panel-tab="reports"');
  assert.ok(deviceWorkPos < batteryControlPos, 'Battery Control tab is after Device Work');
  assert.ok(batteryControlPos < pvSimulatorPos, 'PV Simulator tab is after Battery Control');
  assert.ok(pvSimulatorPos < reportsPos, 'PV Simulator tab is before Reports');
});

test('EPC PV Simulator auto-syncs recommendation rating and project DC AC ratio', () => {
  for (const snippet of [
    'function getEpcRecommendedPvRatedKw(result = {})',
    'function refreshEpcPvSimulatorProfileForRecommendation(project, result)',
    'refreshEpcPvSimulatorProfileForRecommendation(project, result)',
    'P rated kW (DC)',
    'Live Recommendation PV DC',
    'epc-pv-simulator-rated-kw',
    'readonly',
    'PV DC',
    'PV AC',
    'DC/AC ratio',
    'epc-design-dc-ac-ratio',
    'data-epc-field="assumptions.pvDcAcRatio"',
    'epc-pv-simulator-ac-kw',
    'epc-pv-simulator-random-scale',
    'epc-pv-simulator-cloud-volatility',
    'epc-pv-simulator-event-impact',
    'updateEpcPvSimulatorFromControls()',
    'function updateEpcPvSimulatorFromControls(',
    'function getEpcPvSimulatorDomSettings(result = {}, { regenerateSeed = false } = {})',
    'getEpcPvSimulatorDomSettings(result, { regenerateSeed: true })',
    'const projectDcAcRatio = Number(project.assumptions?.pvDcAcRatio)',
    'epc-pv-simulator-dc-ac',
    'readonly'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing PV Simulator refinement snippet: ${snippet}`);
  }
  assert.doesNotMatch(html, /Math\.random\(\) \* 100000/, 'PV Simulator should use deterministic seed helpers for random profile state');
});

test('EPC PV Simulator display focuses daylight chart and hourly preview table', () => {
  for (const snippet of [
    'function getEpcPvSimulatorDisplayRows(rows = [], intervalMinutes = 60)',
    'timelineMinute >= 6 * 60',
    'timelineMinute <= 20 * 60',
    'renderEpcPvSimulatorChart(getEpcPvSimulatorDisplayRows(preview.rows || [], 5))',
    'getEpcPvSimulatorDisplayRows(preview.rows || [], 60)',
    '06:00',
    '20:00'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing PV Simulator daylight snippet: ${snippet}`);
  }
  assert.doesNotMatch(html, /\(preview\.rows \|\| \[\]\)\.filter\(\(_, index\) => index % 36 === 0\)/, 'PV Simulator table should not use fixed 3-hour sampling');
});

test('EPC Device Work profile renders realistic load and genset device behavior', () => {
  for (const snippet of [
    'function buildEpcDeviceWorkProfileRows(sourceRows = [], settings = {})',
    'function applyEpcDeviceWorkSocLedger(profiled = [], settings = {})',
    'function getEpcEmsFlowProfileRows(result = {})',
    'function getEpcDeviceWorkModelSettings(raw = {})',
    'function updateEpcDeviceWorkModelSettings()',
    'const numberOrDefault = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;',
    'function dispatchEpcDeviceWorkProfileRow(row = {}, model = EPC_DEVICE_WORK_DEFAULT_MODEL, batteryControl = EPC_BATTERY_CONTROL_DEFAULT)',
    'function epcDeviceWorkDeterministicNoise(seed = 0)',
    'function getEpcDeviceWorkLoadShockMultiplier(row, index, rows, model = EPC_DEVICE_WORK_DEFAULT_MODEL, component = \'load\')',
    'function getEpcDeviceWorkActiveWindow(rows = [], component = \'load\')',
    'function quantizeEpcDeviceWorkGensetPlatform(value, peakValue, platforms = EPC_DEVICE_WORK_GENSET_PLATFORMS, enabled = true)',
    'function getEpcDeviceWorkStepPathD(series, rows, xForIndex, yForPower, yForSoc)',
    "series.id === 'load' || series.id === 'genset'",
    'Load shock is a concept-design visual assumption',
    'deterministic pseudo-random',
    'EPC_DEVICE_WORK_LOAD_NOISE_RATIO',
    'EPC_DEVICE_WORK_LOAD_SHOCK_MINUTES',
    'EPC_DEVICE_WORK_GENSET_PLATFORMS',
    'getEpcEmsFlowProfileRows(result)',
    'buildEpcDeviceWorkProfileRows(result.energyFlow?.rows || [], settings)',
    'const sourceRows = getEpcEmsFlowProfileRows(result);',
    'const path = (series.id === \'load\' || series.id === \'genset\')',
    'profile rows',
    'deviceWorkModel',
    'epc-device-work-model-controls',
    'epc-device-work-apply-ems',
    'epc-device-work-load-noise-pct',
    'epc-device-work-load-shock-count',
    'epc-device-work-load-shock-duration-min',
    'epc-device-work-load-shock-impact-pct',
    'epc-device-work-load-shock-position',
    'epc-device-work-genset-shock-count',
    'epc-device-work-genset-shock-duration-min',
    'epc-device-work-genset-shock-impact-pct',
    'epc-device-work-genset-shock-position',
    'Apply profile to EMS Flow',
    'Load noise %',
    'Load shock count',
    'Load shock position',
    'Genset shock count',
    'Genset shock position',
    'data-epc-device-model-row="load"',
    'data-epc-device-model-row="genset"'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing Device Work profile snippet: ${snippet}`);
  }

  const profileSource = html.match(/function buildEpcDeviceWorkProfileRows\(sourceRows = \[\], settings = \{\}\)[\s\S]*?function getEpcDeviceWorkRowsForSettings/);
  assert.ok(profileSource, 'Device Work profile source should be found');
  assert.doesNotMatch(profileSource[0], /Math\.random\(\)/, 'Device Work profile must be deterministic across refreshes');
  assert.doesNotMatch(profileSource[0], /(^|[^.A-Za-z0-9_$])round\(/, 'Device Work profile must use browser-local rounding helpers');
  assert.match(html, /loadKw:\s*epcChartRound\(loadKwWithShock, 2\)/, 'Load profile should include deterministic fluctuation and shock');
  const shockSource = html.match(/function getEpcDeviceWorkLoadShockMultiplier\([\s\S]*?function quantizeEpcDeviceWorkGensetPlatform/);
  assert.ok(shockSource, 'Device Work shock source should be found');
  assert.match(shockSource[0], /const activeWindow = getEpcDeviceWorkActiveWindow\(rows, component\)/, 'shock position should use the active equipment window');
  assert.doesNotMatch(shockSource[0], /const firstMinute = Number\(rows\[0\]/, 'shock position should not start at the first zero-load timeline row');
  assert.match(html, /pvToLoadKw:\s*epcChartRound\(adjusted\.pvToLoadKw, 2\)/, 'PV to load should come from SOC-ledger dispatch output');
  assert.match(html, /batteryToLoadKw:\s*epcChartRound\(adjusted\.batteryToLoadKw, 2\)/, 'Battery should come from SOC-ledger dispatch output');
  assert.match(html, /gensetToLoadKw:\s*epcChartRound\(adjusted\.gensetToLoadKw, 2\)/, 'Genset should come from SOC-ledger dispatch output');
  assert.match(html, /let pvToLoadKw = Math\.min\(pvOutputKw, loadKw\)/, 'PV should serve load before charging or curtailing');
  assert.match(html, /let remainingLoadKw = Math\.max\(0, loadKw - pvToLoadKw\)/, 'Battery and genset should only serve remaining load');
  assert.match(html, /const demandKw = remainingLoadKw;/, 'Genset should serve only the remaining load unless strategy changes');
  assert.match(html, /const socMaxPct = Math\.max\(0, Math\.min\(100, Number\(row\.socMaxPct\) \|\| 100\)\)/, 'Device Work dispatch should know the active EMS max SOC');
  assert.match(html, /const socMinPct = Math\.max\(0, Math\.min\(socMaxPct, Number\(row\.socMinPct\) \|\| 0\)\)/, 'Device Work dispatch should know the active EMS min SOC');
  assert.match(html, /const batteryCanCharge = socPct === null \|\| socPct < socMaxPct - 0\.05/, 'Battery should not charge when displayed SOC is already capped');
  assert.match(html, /const batteryCanDischarge = socPct === null \|\| socPct > socMinPct \+ 0\.05/, 'Battery should not discharge when displayed SOC is already at minimum');
  assert.match(html, /const batteryChargeAllowedKw = batteryCanCharge \? surplusPvKw : 0/, 'PV surplus should curtail instead of charging at max SOC');
  assert.match(html, /const batteryDischargeAllowedKw = batteryCanDischarge \? Math\.max\(0, Number\(row\.batteryDischargeLimitKw\) \|\| 0\) : 0/, 'Battery discharge should be capped by SOC energy headroom');
  assert.match(html, /socKwh = Math\.max\(minSocKwh, Math\.min\(maxSocKwh, socKwh\)\)/, 'Device Work SOC should be maintained by a sequential energy ledger');
  assert.match(html, /socPct: epcChartRound\(adjusted\.socPct, 1\)/, 'Profile rows should expose recalculated SOC from the ledger');
  const flowRenderer = html.match(/function renderEpcEnergyFlow\(result\)[\s\S]*?function renderEpcReports\(result\)/);
  assert.ok(flowRenderer, 'EMS Flow renderer should be found');
  assert.match(flowRenderer[0], /getEpcEnergyFlowDisplayRows\(result\)/, 'EMS Flow table should use profiled display rows');
  assert.doesNotMatch(flowRenderer[0], /const rows = result\.energyFlow\?\.rows \|\| \[\]/, 'EMS Flow table should not render raw rows directly');
});

test('EPC Battery Control is a standalone page between Device Work and PV Simulator', () => {
  assert.match(html, /data-epc-panel-tab="devicework"[\s\S]*?Device Work[\s\S]*?data-epc-panel-tab="batterycontrol"[\s\S]*?Battery Control[\s\S]*?data-epc-panel-tab="pvsimulator"[\s\S]*?PV Simulator/);
  for (const snippet of [
    'id="epc-battery-control-page"',
    'data-epc-panel="batterycontrol"',
    'function getEpcBatteryControlSettings(raw = {})',
    'function renderEpcBatteryControlPage(result)',
    'function updateEpcBatteryControlSettings()',
    'function updateEpcBatteryManualOverride(',
    'function addEpcBatteryControlCustomStrategy()',
    'function removeEpcBatteryControlCustomStrategy(',
    'EPC_BATTERY_CONTROL_DEFAULT',
    'customStrategies',
    'epc-battery-control-mode',
    'epc-battery-control-interval',
    'epc-battery-control-priority',
    'epc-battery-control-custom-strategy',
    'epc-battery-control-custom-label',
    'Add manual strategy',
    'epc-battery-control-manual-table',
    'epc-battery-control-pv-battery-',
    'epc-battery-control-battery-load-',
    'PV -> Load',
    'Battery -> Load',
    'Genset -> Load',
    'PV -> Battery',
    'Auto strategy priority',
    'Manual battery power requests',
    'renderEpcBatteryControlPage(result)'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing Battery Control snippet: ${snippet}`);
  }
});

test('EPC Device Work model controls update the profile immediately', () => {
  const modelControls = html.match(/<div id="epc-device-work-model-controls"[\s\S]*?<\/div>\s*<\/div>\s*`;/);
  assert.ok(modelControls, 'Device Work model controls should be found');
  for (const id of [
    'epc-device-work-load-noise-pct',
    'epc-device-work-load-shock-count',
    'epc-device-work-load-shock-duration-min',
    'epc-device-work-load-shock-impact-pct',
    'epc-device-work-genset-shock-count',
    'epc-device-work-genset-shock-duration-min',
    'epc-device-work-genset-shock-impact-pct'
  ]) {
    const changePattern = new RegExp(`id="${id}"[^>]*onchange="updateEpcDeviceWorkModelSettings\\(\\)"`);
    const inputPattern = new RegExp(`id="${id}"[^>]*oninput="updateEpcDeviceWorkModelSettings\\(\\)"`);
    const scheduledInputPattern = new RegExp(`id="${id}"[^>]*oninput="scheduleEpcDeviceWorkModelUpdate\\(\\)"`);
    assert.match(modelControls[0], changePattern, `${id} should update the chart after its value is committed`);
    assert.doesNotMatch(modelControls[0], inputPattern, `${id} should not replace the focused input on every keystroke`);
    assert.match(modelControls[0], scheduledInputPattern, `${id} should debounce live profile updates`);
  }
  assert.match(html, /function scheduleEpcDeviceWorkModelUpdate\(\)/);
  assert.match(modelControls[0], /data-epc-device-model-row="load"/);
  assert.match(modelControls[0], /data-epc-device-model-row="genset"/);
  assert.doesNotMatch(modelControls[0], /id="epc-device-work-genset-step-enabled"/);
  assert.doesNotMatch(modelControls[0], /id="epc-device-work-genset-platforms"/);
});

test('EPC Device Work exposes auditable load work rows at 5-minute and hourly resolution', () => {
  for (const snippet of [
    'function getEpcDeviceWorkLoadTableRows(rows = [], intervalMinutes = 5)',
    'function renderEpcDeviceWorkLoadTable(result)',
    'function renderEpcDeviceWorkLoadSummaryRow(rows = [])',
    'function setEpcDeviceWorkLoadTableInterval(minutes)',
    'id="epc-device-work-load-table"',
    'id="epc-device-work-load-table-5m"',
    'id="epc-device-work-load-table-60m"',
    'Base load kW',
    'Noise kW',
    'Shock kW',
    'Modeled load kW',
    'Battery load kW',
    'Genset load kW',
    'Unmet kW',
    'baseLoadKw:',
    'loadNoiseKw:',
    'loadShockKw:'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing Device Work load table snippet: ${snippet}`);
  }
  assert.match(html, /const weightedAverageKeys = \['baseLoadKw', 'loadNoiseKw', 'loadShockKw', 'loadKw', 'pvToLoadKw', 'batteryToLoadKw', 'gensetToLoadKw', 'unmetLoadKw'\]/);
  assert.match(html, /const finalSoc = items\.at\(-1\)\?\.socPct/);
  assert.match(html, /<tfoot class="sticky bottom-0 z-10/);
  assert.match(html, />Summary</);
  assert.match(html, /const summarizeEnergy = key =>/);
  assert.match(html, /renderEpcDeviceWorkAnalysis\(result\)[\s\S]*renderEpcDeviceWorkLoadTable\(result\)/, 'load table should render below the chart analysis cards');
});

test('EPC Battery Control keeps available battery ahead of genset and curtailment last', () => {
  for (const snippet of [
    'batteryFirstAboveMinSoc',
    'gensetShockPreemptBattery',
    'Battery before genset while SOC remains above Min SOC',
    'Curtailment is the final sink after load and battery charging',
    'epc-battery-control-battery-first',
    'epc-battery-control-genset-shock-preempt'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing battery priority guardrail: ${snippet}`);
  }
  const dispatch = html.match(/function dispatchEpcDeviceWorkProfileRow\(row = \{\}, model = EPC_DEVICE_WORK_DEFAULT_MODEL, batteryControl = EPC_BATTERY_CONTROL_DEFAULT\)[\s\S]*?function applyEpcDeviceWorkSocLedger/);
  assert.ok(dispatch, 'Device Work dispatch source should be found');
  assert.match(dispatch[0], /let batteryLimitKw = batteryDischargeAllowedKw;/, 'battery dispatch should use all SOC-safe power before genset');
  assert.match(dispatch[0], /const chargeKw = Math\.min\(surplusPvKw, batteryChargeLimitedKw\);/, 'all chargeable PV surplus should go to battery before curtailment');
  assert.match(dispatch[0], /const gensetShockMayPreempt = settings\.gensetShockPreemptBattery === true;/, 'genset shock preemption should be an explicit strategy setting');
  assert.match(dispatch[0], /curtailmentKw: Math\.max\(0, surplusPvKw\)/, 'curtailment should only receive final PV surplus');
  assert.match(dispatch[0], /gensetReason/, 'dispatch should explain why genset was required');
  assert.match(html, /batteryDischargeLimitReason/, 'SOC ledger should expose the active battery discharge limit reason');
  assert.match(html, /PCS limit/, 'PCS-limited residual load should be explicit');
});

test('EPC EMS table uses fixed five-minute or hourly display with final SOC', () => {
  for (const snippet of [
    'function setEpcEmsFlowTableInterval(minutes)',
    'epc-ems-flow-table-5m',
    'epc-ems-flow-table-60m',
    'emsTableIntervalMinutes',
    'Genset reason',
    'max-h-[32rem] overflow-auto',
    '<thead class="sticky top-0 z-10',
    '<tfoot class="sticky bottom-0 z-10'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing fixed EMS table snippet: ${snippet}`);
  }
  const hourlyMerge = html.match(/function mergeEpcEnergyFlowRowsByHour\(rows = \[\]\)[\s\S]*?function getEpcEnergyFlowDisplayRows/);
  assert.ok(hourlyMerge, 'hourly EMS merge should be found');
  assert.match(hourlyMerge[0], /const finalRow = items\.at\(-1\)/, 'hourly SOC should come from the final five-minute row');
  assert.match(hourlyMerge[0], /socPct: epcChartRound\(finalRow\?\.socPct/, 'hourly SOC should not be averaged');
  assert.doesNotMatch(html, /id="epc-ems-flow-merge-hourly"/, 'legacy Merge hourly checkbox should be removed');
});

test('EPC finish time changes do not open the working time confirmation dialog', () => {
  const handler = html.match(/window\.onEpcScheduleInputChanged = \(source = ''\) => \{[\s\S]*?window\.onEpcDesignInputChanged\(\);\n        \}/);
  assert.ok(handler, 'schedule input handler should be found');
  assert.match(handler[0], /source !== 'finish'/, 'finish-time edits should bypass the confirmation prompt');
  assert.doesNotMatch(handler[0], /source === 'finish'[\s\S]{0,500}confirm\(/, 'finish-time branch should not call confirm');
});

test('EPC energy flow uses compact non-overlapping lane layout', () => {
  for (const snippet of [
    'viewBox="0 0 1180 460"',
    'epc-flow-node-card',
    'epc-flow-lane-main',
    'epc-flow-lane-branch',
    'epc-flow-lane-genset',
    'epc-flow-label-badge',
    'markerWidth="6"',
    'markerHeight="6"',
    'stroke-width: 3.2',
    'stroke-dasharray: 7 9',
    'renderEpcFlowNode',
    'M512 142 V118 Q512 106 524 106 H632',
    'M512 230 V330 Q512 342 524 342 H632',
    'M306 386 V414 Q306 426 326 426 H1076 V238',
    'Math.max(82, Math.min(150, text.length * 7.4 + 18))',
    'circle cx="42" cy="52" r="5.5"'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing lane layout snippet: ${snippet}`);
  }
  assert.doesNotMatch(html, /text x="59" y="124"[^>]*>\$\{formatEpcNumber\(row\?\./, 'node kW values should be inside compact cards, not below node labels');
});

test('EPC design projects persist through app state and sync merge', () => {
  for (const snippet of [
    'let epcDesignProjects = []',
    'let epcDesignDefaults =',
    'minova_epc_design_projects_v1',
    'minova_epc_design_defaults_v1',
    'normalizeEpcDesignProjectList',
    'epcDesignProjects',
    'epcDesignDefaults'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing state snippet: ${snippet}`);
  }
  assert.match(mergeSource, /epcDesignProjects:\s*mergeByKey/);
  assert.match(mergeSource, /epcDesignDefaults:\s*\{\s*\.\.\.\(rData\.epcDesignDefaults/);
});

test('EPC workspace exposes Topology and Electrical engineering panels', () => {
  const section = html.match(/<main id="view-epcdesign"[\s\S]*?<main id="view-engineering"/);
  assert.ok(section, 'EPC design view exists before Engineering workspace');
  const source = section[0];
  for (const snippet of [
    'data-epc-panel-tab="topology"',
    "setEpcPanelTab('topology')",
    '>Topology</button>',
    'data-epc-panel-tab="electrical"',
    "setEpcPanelTab('electrical')",
    '>Electrical</button>',
    'id="epc-topology-workspace"',
    'data-epc-panel="topology"',
    'id="epc-electrical-workspace"',
    'data-epc-panel="electrical"'
  ]) {
    assert.match(source, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing EPC panel snippet: ${snippet}`);
  }
  assert.match(html, /renderEpcTopologyWorkspace\(result, project\)/);
  assert.match(html, /renderEpcElectricalWorkspace\(result\)/);
  assert.match(html, /renderEpcTopologyWorkspace\(result, project\)[\s\S]*renderEpcElectricalWorkspace\(result\)/);
});

test('EPC Topology and Electrical panels render graph validation LV MV and cable screening', () => {
  for (const snippet of [
    'function renderEpcTopologyWorkspace(result, project = getActiveEpcDesignProject())',
    'function renderEpcTopologySld(topology = {})',
    'function updateEpcSelectedTopology(value)',
    'id="epc-topology-selector"',
    'Standard Topology Library',
    'LV_BUS',
    'MV_BUS',
    'AC_MV_POWER',
    'topologyValidation.errors',
    'topologyValidation.warnings',
    'Apply suggested fix manually',
    'function renderEpcElectricalWorkspace(result)',
    'Architecture Comparison',
    'Transformer Sizing',
    'Cable Sizing Screening',
    'Protection Matrix',
    'electricalArchitecture.candidates',
    'cableScreening.candidates',
    'protectionMatrix.functions',
    'concept-stage protection matrix'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing EPC topology/electrical snippet: ${snippet}`);
  }
});

test('EPC EMS Flow renders topology-aware standard components and validation state', () => {
  const flowRenderer = html.match(/function renderEpcFlowDiagram\(result, row\)[\s\S]*?function renderEpcSocBadge/);
  assert.ok(flowRenderer, 'EMS Flow renderer should be found');
  for (const snippet of [
    'function buildEpcTopologyFlowRenderModel(result, row)',
    'function renderEpcTopologyFlowDiagram(result, row)',
    'result.topologyFlow',
    'topologyFlow.nodes',
    'topologyFlow.edges',
    'flowKeys',
    'Step-up TX',
    'MV Switchboard',
    'Ring RMU',
    'MV BUS',
    'Load TX',
    'LV BUS',
    'topologyFlow.validationBlocked',
    'epc-flow-line-blocked',
    'renderEpcTopologyFlowDiagram(result, selectedRow)'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing topology-aware flow snippet: ${snippet}`);
  }
  assert.doesNotMatch(flowRenderer[0], /<path class="\$\{flowLineClass\(row\?\.pvOutputKw/, 'EMS Flow should not render fixed legacy paths directly');
});

test('EPC EMS Flow splits simultaneous battery charge discharge and exposes topology selector', () => {
  for (const snippet of [
    'id="epc-flow-topology-selector"',
    'renderEpcFlowTopologySelector(result)',
    'result.topologySelection',
    'requiresMvTopology',
    'lv-pcs-charge',
    'bess-tx-pcs-charge',
    'pcs-battery-charge',
    'battery-pcs-discharge',
    'pcs-lv-discharge',
    'flowKeyMode',
    "edge.flowKeyMode === 'net'",
    'EPC_TOPOLOGY_FLOW_LABEL_KEYS',
    'const EPC_TOPOLOGY_FLOW_NODE_H = 96',
    'function epcTopologyFlowPairLaneRoute',
    'function epcTopologyFlowPcsAcLaneRoute',
    'function epcTopologyFlowControlRoute',
    "edge.role === 'control' ? epcTopologyFlowControlRoute",
    "edge.id === 'lv-pcs-charge'",
    "edge.id === 'bess-tx-pcs-charge'",
    "edge.id === 'pcs-lv-discharge'",
    "edge.id === 'pcs-tx-discharge'",
    "edge.id === 'pcs-battery-charge'",
    "edge.id === 'battery-pcs-discharge'",
    'Math.abs(start.y - end.y) < 6',
    'M${start.x} ${start.y} H${end.x}',
    "edge.id === 'pv-curtailment'",
    "CURTAILMENT: { stroke: '#f59e0b'",
    'y="74"',
    'y="88"',
    'markerWidth="4"',
    "renderEpcFlowLabel(edge.value, edge.route.labelX, edge.route.labelY, '')",
    "role === 'control' ? Math.max(90, laneY + 110)",
    'updateEpcSelectedTopology(this.value)'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing split-flow selector snippet: ${snippet}`);
  }
  const valueHelper = html.match(/function epcTopologyFlowValue\(edge = \{\}, row = \{\}\)[\s\S]*?function epcTopologyFlowLineType/);
  assert.ok(valueHelper, 'topology flow value helper should exist');
  assert.doesNotMatch(valueHelper[0], /reduce\(\(total, key\) => total \+ Math\.max/, 'edge labels should not sum charge and discharge keys on one line');
  const edgeLabelHelper = html.match(/function renderEpcTopologyFlowEdgeLabel\(edge = \{\}\)[\s\S]*?function renderEpcTopologyFlowNode/);
  assert.ok(edgeLabelHelper, 'topology edge label helper should exist');
  assert.doesNotMatch(edgeLabelHelper[0], /PV -> Battery|Battery -> Load/, 'line labels should only show transfer kW, not semantic route text');
});

test('EPC topology-aware flow routes through visible LV bus card and balanced battery PCS lines', () => {
  const nodeRenderer = html.match(/function renderEpcTopologyFlowNode\(node = \{\}, row = \{\}\)[\s\S]*?function renderEpcTopologyFlowDiagram/);
  const pairRoute = html.match(/function epcTopologyFlowPairLaneRoute\(source = \{\}, target = \{\}, edge = \{\}\)[\s\S]*?function epcTopologyFlowPcsAcLaneRoute/);
  const lvRoute = html.match(/function epcTopologyFlowLvBusRoute\(source = \{\}, target = \{\}, edge = \{\}\)[\s\S]*?function epcTopologyFlowControlRoute/);

  assert.ok(nodeRenderer, 'topology node renderer should exist');
  assert.ok(pairRoute, 'battery PCS route helper should exist');
  assert.ok(lvRoute, 'LV bus route helper should exist');
  assert.doesNotMatch(nodeRenderer[0], /renderEpcTopologyFlowVerticalBusNode/, 'source LV bus should use the standard visible LV_BUS card renderer');
  assert.match(pairRoute[0], /const laneOffset = edge\.id === 'pcs-battery-charge' \? -14 : 14/);
  assert.match(pairRoute[0], /d: `M\$\{start\.x\} \$\{start\.y\} H\$\{end\.x\}`/);
  assert.doesNotMatch(pairRoute[0], /V\$\{laneY\}/, 'battery PCS lanes should be straight balanced lines, not dogleg routes');
  assert.match(lvRoute[0], /epcTopologyFlowPort\(target, 'left'\)/);
  assert.match(lvRoute[0], /epcTopologyFlowPort\(source, 'right'\)/);
});

test('EPC inputs expose split load count and ratio controls for EMS Flow', () => {
  for (const snippet of [
    'id="epc-load-count"',
    'data-epc-field="loads.loadCount"',
    'id="epc-load-split-controls"',
    'function renderEpcLoadSplitControls(project',
    'data-epc-load-split-ratio',
    'function epcLoadSplitsFromDom',
    'function updateEpcLoadSplitRatio',
    'Load Qty',
    'Allocation %',
    'must equal 100%',
    'rebalanceEpcLoadSplits',
    'setEpcStandardTopologyDirty(project)',
    'project.loads.loadSplits[index] =',
    "field === 'label'",
    'Number(value)'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing split load UI snippet: ${snippet}`);
  }
  const splitHandler = html.match(/function updateEpcLoadSplitRatio\(index, value, field = 'ratio'\)[\s\S]*?window\.updateEpcLoadSplitRatio/);
  assert.ok(splitHandler, 'split update handler should exist');
  assert.doesNotMatch(splitHandler[0], /const project = captureEpcDesignFromDom\(\);\s*project\.loads\.loadSplits = epcLoadSplitsFromDom/, 'split handler should apply the explicit edited value before rerendering');
});

test('EPC topology-aware flow can label per-branch split load power', () => {
  for (const snippet of [
    'loadSplit:',
    'row?.loadSplits',
    'edge.flowKeys.some(key => EPC_TOPOLOGY_FLOW_LABEL_KEYS.includes(key) || key.startsWith',
    'ring-rmu-load-1',
    'lv-load-bus-1-load-1'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing split load flow snippet: ${snippet}`);
  }
});

test('EPC custom topology connection modal exposes add remove and standard copy behavior', () => {
  for (const snippet of [
    'id="epc-topology-connection-modal"',
    'openEpcTopologyConnectionModal',
    'closeEpcTopologyConnectionModal',
    'copyEpcStandardTopologyToCustom',
    'addEpcCustomTopologyConnection',
    'removeEpcCustomTopologyConnection',
    'validateEpcCustomTopologyConnectionDraft',
    'Customize Connections',
    'Copy standard topology to Custom',
    'data-epc-custom-connection-row',
    'epc-custom-edge-source',
    'epc-custom-edge-target',
    'epc-custom-edge-type',
    'canEditEpcEngineering()'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing custom connection snippet: ${snippet}`);
  }
});
