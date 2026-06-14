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
  assert.match(html, /load:\s*result\.load\?\.dailyLoadKwh > 0 && result\.load\?\.averageLoadKw > 0 && result\.load\?\.peakLoadKw > 0/);
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
  assert.match(html, /data-epc-panel-tab="flow"[\s\S]*?EMS Flow[\s\S]*?data-epc-panel-tab="devicework"[\s\S]*?Device Work[\s\S]*?data-epc-panel-tab="reports"[\s\S]*?Reports/);
  for (const snippet of [
    'id="epc-device-work-page"',
    'data-epc-panel="devicework"',
    'renderEpcDeviceWorkPage',
    'renderEpcDeviceWorkChart',
    'renderEpcDeviceWorkAnalysis',
    'renderEpcDeviceWorkPath',
    'getEpcDeviceWorkRowsForSettings',
    'getEpcDeviceWorkPathD',
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
    'data-epc-device-interval="15"',
    'data-epc-device-interval="30"',
    'data-epc-device-interval="60"',
    'data-epc-device-interval="120"',
    'data-epc-device-interval="360"',
    'data-epc-device-interval="720"',
    'epc-device-work-range-track',
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
    'epc-device-work-color-popover',
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
  for (const removedSnippet of [
    'smoothDeviceWorkPath',
    'setEpcDeviceWorkLineStyle',
    'epc-device-work-style-smooth',
    'lineStyle:'
  ]) {
    assert.doesNotMatch(html, new RegExp(removedSnippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `removed Device Work snippet still present: ${removedSnippet}`);
  }
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
