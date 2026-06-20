import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const mergeSource = readFileSync(new URL('../github-sync/merge.js', import.meta.url), 'utf8');

function extractFunction(name, untilName) {
  const pattern = new RegExp(`function ${name}\\([\\s\\S]*?\\n        function ${untilName}\\(`);
  const match = html.match(pattern);
  assert.ok(match, `${name} source should be found`);
  return match[0].replace(new RegExp(`\\n        function ${untilName}\\($`), '');
}

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
  assert.doesNotMatch(source, /Apply Quarry \/ TJQ Template/);
  assert.doesNotMatch(source, /applyEpcQuarryProcurementProfile/);
  assert.doesNotMatch(source, /buildEpcQuarryProcurementProfile/);
  assert.match(source, /<button[^>]*data-epc-download="engineering"[^>]*class="[^"]*\bhidden\b/);
});

test('EPC formula trace shows formula data instead of a raw inputs column', () => {
  assert.match(html, /function formatEpcFormulaData\(inputs = \{\}\)/);
  assert.match(html, />Formula Data<\/th>/);
  assert.match(html, /Object\.entries\(inputs \|\| \{\}\)/);
  assert.doesNotMatch(html, /<th class="px-3 py-2">Inputs<\/th>/);
  assert.doesNotMatch(html, /JSON\.stringify\(item\.inputs\)/);
});

test('EPC BOQ exposes dual professional views with manual and Product List controls', () => {
  for (const snippet of [
    'Customer Summary',
    'Engineering Detail',
    'BOQ readiness',
    '>Equipment<',
    '>Spec<',
    '>Quantity<',
    '>Unit<',
    '>Protection<',
    'Product Binding',
    'Add Manual Item',
    'Select Product',
    'openEpcBoqProductPicker',
    'addEpcBoqManualItem',
    'data-epc-boq-view="customer"',
    'data-epc-boq-view="engineering"',
    'data-epc-boq-field="quantity"',
    'epc-boq-product-picker-modal'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing BOQ UI snippet: ${snippet}`);
  }
  assert.doesNotMatch(html, /Equipment \/ 设备名称|Spec \/ 规格参数|Protection \/ 防护防腐/);
});

test('EPC BOQ manual package selector row deletion drag ordering and unit choices are wired', () => {
  for (const snippet of [
    'id="epc-boq-manual-package-select"',
    "'PV System'",
    "'BESS'",
    "'Electrical Distribution'",
    "'EMS & Monitoring'",
    "'Auxiliary'",
    "'Documents & Certification'",
    'renderEpcBoqPackageOptions',
    'deleteEpcBoqEquipment',
    'restoreEpcBoqEquipment',
    'Delete Equipment',
    'Restore hidden equipment',
    'draggable="true"',
    'onDragStart',
    'dropEpcBoqRow',
    'data-epc-boq-line-id',
    'epc-boq-unit-options',
    'list="epc-boq-unit-options"'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing BOQ package control snippet: ${snippet}`);
  }
  assert.doesNotMatch(html, /Delete Package|deleteEpcBoqPackage|restoreEpcBoqPackage|hiddenPackages/);
});

test('EPC risks expose checkbox acknowledgement and report-gating status', () => {
  for (const snippet of [
    'toggleEpcRiskAcknowledgement',
    'saveEpcRiskAcknowledgement',
    'data-epc-risk-checkbox',
    'data-epc-risk-reason',
    'data-epc-risk-signer',
    'manual-acknowledged',
    'auto-cleared',
    'hasBlockingEpcReportRisks'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing risk acknowledgement snippet: ${snippet}`);
  }
});

test('EPC Reports are fixed-page PDF downloads with full diagrams and XLSX BOQ export', () => {
  for (const snippet of [
    'Customer EPC Report PDF',
    'BOQ & Procurement PDF',
    'Engineering Handoff PDF',
    'Resolve or acknowledge all open High risks before downloading reports.',
    'buildEpcReportFixedPageElement',
    'renderEpcCustomerReportPages',
    'renderEpcReportOnlyTopologyFlowDiagram',
    'getEpcReportConnectionFlowRow',
    'renderEpcReportOnlyDeviceWorkDiagram',
    'EMS Flow Diagram',
    'Device Work Diagram',
    'downloadEpcBoqWorkbook',
    'Complete BOQ XLSX',
    "XLSX.utils.book_append_sheet(workbook, customerWorksheet, 'Customer Summary')",
    "XLSX.utils.book_append_sheet(workbook, engineeringWorksheet, 'Engineering Detail')",
    'html2pdf().set',
    'previousScrollX',
    'const reportPageCount = Math.max(1, element.querySelectorAll',
    'const reportHeight = reportPageCount * 760',
    "element.style.position = 'absolute'",
    "element.style.height = `${reportHeight}px`",
    "overlay.style.padding = '0'",
    'window.scrollTo(0, 0)',
    'x: 0',
    'width: 1123',
    'height: reportHeight',
    'scrollY: 0',
    'pagebreak',
    'epc-report-page',
    'hasBlockingEpcReportRisks',
    'epc-device-work-chart-title',
    '.epc-report-only-device .epc-device-work-chart-title{display:none!important}',
    '.epc-report-only-device .epc-device-work-hover-layer{display:none!important}'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing report PDF snippet: ${snippet}`);
  }
  assert.doesNotMatch(html, /engineering-calculation\.json/);
  assert.doesNotMatch(html, /-summary\.html/);
  assert.doesNotMatch(html, /left = '-10000px'|zIndex = '-1'/);
  assert.doesNotMatch(html, /epc-report-print-surface \.epc-flow-diagram,\s*\.epc-report-print-surface \.epc-device-work-chart\{max-height:[^}]+overflow:hidden/);
  assert.match(html, /epc-report-rendering-overlay/);
});

test('EPC reports and BOQ workbook expose architecture and asset feeder outputs without procurement advisor', () => {
  for (const snippet of [
    'renderEpcReportAssetMapping',
    'renderEpcReportArchitectureDecision',
    'Architecture Decision',
    '800V Microgrid',
    '11kV Ring',
    'Asset / Feeder Mapping',
    'result.architectureComparison?.candidates',
    'result.feederZoning?.feeders',
    'result.loadAssetSummary?.assetGroups',
    'epcBoqWorkbookArchitectureComparisonRows',
    'epcBoqWorkbookAssetListRows',
    'epcBoqWorkbookFeederZoningRows',
    'epcBoqWorkbookAssetMappingRows',
    'Voltage / Bus',
    'Parallel Runs',
    'Feeder ID',
    'Assigned Genset',
    "XLSX.utils.book_append_sheet(workbook, architectureWorksheet, 'Architecture Comparison')",
    "XLSX.utils.book_append_sheet(workbook, assetListWorksheet, 'Asset List')",
    "XLSX.utils.book_append_sheet(workbook, feederZoningWorksheet, 'Feeder Zoning')",
    "XLSX.utils.book_append_sheet(workbook, assetWorksheet, 'Asset Mapping')"
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing asset feeder report snippet: ${snippet}`);
  }

  const reportPages = html.match(/function renderEpcCustomerReportPages\(result = \{\}, kind = 'customer'\)[\s\S]*?function buildEpcReportFixedPageElement/);
  assert.ok(reportPages, 'customer report page builder should be found');
  assert.match(reportPages[0], /renderEpcReportArchitectureDecision\(result\)/);
  assert.match(reportPages[0], /renderEpcReportAssetMapping\(result\)/);
  assert.doesNotMatch(html, /renderEpcReportProcurementAdvisory/);
  assert.doesNotMatch(html, /Procurement Gap Review/);
  assert.doesNotMatch(html, /epcBoqWorkbookProcurementAdvisorRows/);
  assert.doesNotMatch(html, /Procurement Advisor/);
  assert.doesNotMatch(html, /procurementAdvisory/);
});

test('EPC report-only EMS Flow uses a static connection map instead of an operating hour', () => {
  const reportRenderer = html.match(/function renderEpcReportOnlyTopologyFlowDiagram\(result = \{\}\)[\s\S]*?function renderEpcReportOnlyDeviceWorkDiagram/);
  assert.ok(reportRenderer, 'report-only EMS Flow renderer should be found');
  assert.match(reportRenderer[0], /getEpcReportConnectionFlowRow\(result\)/);
  assert.doesNotMatch(reportRenderer[0], /getEpcReportFlowRow\(result\)/);

  const reportPages = html.match(/function renderEpcCustomerReportPages\(result = \{\}, kind = 'customer'\)[\s\S]*?function buildEpcReportFixedPageElement/);
  assert.ok(reportPages, 'customer report page builder should be found');
  assert.match(reportPages[0], /Topology-aware connection map/);
  assert.doesNotMatch(reportPages[0], /representative operating point/);
});

test('EPC report-only Device Work hides embedded chart subtitles', () => {
  const reportCss = html.match(/\.epc-report-only-device \.epc-device-work-chart[\s\S]*?\.epc-report-table/);
  assert.ok(reportCss, 'report-only device CSS should be found');
  assert.match(reportCss[0], /\.epc-report-only-device \.epc-device-work-chart-title\{display:none!important\}/);
  assert.match(reportCss[0], /\.epc-report-only-device \.epc-device-work-hover-layer\{display:none!important\}/);

  const reportRenderer = html.match(/function renderEpcReportOnlyDeviceWorkDiagram\(result = \{\}\)[\s\S]*?function chunkEpcReportRows/);
  assert.ok(reportRenderer, 'report-only Device Work renderer should be found');
  assert.match(reportRenderer[0], /renderEpcDeviceWorkChart\(result\)/);
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
    'Detail Setting',
    'Assets List',
    'data-epc-detail-tab="settings"',
    'data-epc-detail-tab="assets"',
    'data-epc-detail-page="settings"',
    'data-epc-detail-page="assets"',
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
    'PV modules per string used for string count and combiner sizing.',
    'Combiner input count used to estimate combiner quantity from total strings.'
  ]) {
    assert.match(detailSection, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing detail helper snippet: ${snippet}`);
  }
  assert.doesNotMatch(detailSection, /epc-help-dot/);
  assert.doesNotMatch(detailSection, /data-tip=/);
  assert.match(detailSection, /title="Detailed Design uses Target % here as the calculation standard\."/);
  assert.match(detailSection, /title="Target diesel replacement percentage used as the detailed design standard\."/);
  const settingsPage = detailSection.match(/data-epc-detail-page="settings"[\s\S]*?data-epc-detail-page="assets"/);
  const assetsPage = detailSection.match(/data-epc-detail-page="assets"[\s\S]*/);
  assert.ok(settingsPage, 'settings detail page should be found');
  assert.ok(assetsPage, 'assets detail page should be found');
  assert.doesNotMatch(settingsPage[0], /Load Qty|id="epc-load-count"|id="epc-load-split-controls"/);
  assert.match(assetsPage[0], /Load Qty/);
  assert.match(assetsPage[0], /id="epc-load-count"/);
  assert.match(assetsPage[0], /id="epc-load-split-controls"/);
  assert.match(assetsPage[0], /id="epc-asset-list-rows"/);
  assert.match(assetsPage[0], /id="epc-genset-list-rows"/);
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
    'data-epc-load-method-panel="asset_genset_fuel_mapping"',
    'data-epc-load-method-panel="diesel_sfc_estimate"',
    'Asset + Genset Fuel Mapping',
    'epc-asset-method-status',
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
    'renderEpcAssetListRows',
    'renderEpcGensetListRows',
    'saveEpcAssetListRows',
    'saveEpcGensetFuelRows',
    'energyMeterSummary',
    'equipmentSchedule',
    'equipmentScheduleOperatingHours',
    'gensetKvaInput'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing measurement UI snippet: ${snippet}`);
  }
  assert.match(html, /load:\s*!\s*requirements\.load\.missing\.length && result\.load\?\.dailyLoadKwh > 0 && result\.load\?\.averageLoadKw > 0 && result\.load\?\.peakLoadKw > 0/);
});

test('EPC Assets List keeps genset fuel mapping conditional and searchable', () => {
  const assetsPage = html.match(/<div id="epc-assets-list-page"[\s\S]*?<\/div>\s*<\/section>\s*<div id="epc-equipment-schedule-modal"/);
  assert.ok(assetsPage, 'assets detail page should be found');
  const assetTable = assetsPage[0].match(/<div class="rounded-2xl border border-slate-200 overflow-hidden">[\s\S]*?<div id="epc-genset-fuel-mapping-panel"/);
  assert.ok(assetTable, 'asset table section should be found');
  for (const snippet of [
    'id="epc-genset-fuel-mapping-panel"',
    'data-epc-genset-fuel-mapping-panel="true"',
    'Save Genset Fuel'
  ]) {
    assert.match(assetsPage[0], new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing asset/genset mapping UI snippet: ${snippet}`);
  }

  for (const snippet of [
    "epcSuggestionInputCell('asset', 'zone'",
    "epcSuggestionInputCell('asset', 'line'",
    "epcSuggestionInputCell('asset', 'area'",
    "epcSuggestionInputCell('asset', 'conveyorSystem'",
    "epcSuggestionInputCell('asset', 'assignedGensetIds'",
    "epcSuggestionInputCell('genset', 'supportedAssetIds'",
    'epc-asset-conveyor-options',
    "epcInputCell('asset', 'startTime'",
    'type="time"',
    'data-epc-asset-field="startType"',
    'estimateMethod',
    'kVA Profile',
    'Fuel / SFC',
    'powerFactor',
    'loadFactor',
    'overloadFactor'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing asset/genset mapping source snippet: ${snippet}`);
  }
  for (const snippet of [
    '<th class="px-2 py-2 text-right">Fuel L</th>',
    '<th class="px-2 py-2 text-right">Fuel Days</th>',
    '<th class="px-2 py-2 text-right">Fuel h</th>',
    "epcInputCell('asset', 'fuelLiters'",
    "epcInputCell('asset', 'fuelPeriodDays'",
    "epcInputCell('asset', 'fuelRuntimeHours'",
    "'Fuel Liters'",
    "'Fuel Runtime Hours'"
  ]) {
    assert.doesNotMatch(assetTable[0], new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `Asset List should not expose obsolete fuel input: ${snippet}`);
  }
  for (const snippet of [
    'row.powerFactor ?? 0.8',
    'row.loadFactor ?? 0.7',
    'row.overloadFactor ?? 0.95'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing genset default snippet: ${snippet}`);
  }

  const measurementRenderer = extractFunction('renderEpcLoadMeasurementPanels', 'renderEpcDesignWorkspace');
  assert.match(measurementRenderer, /epc-genset-fuel-mapping-panel/);
  assert.match(measurementRenderer, /measurementMethod === 'asset_genset_fuel_mapping'/);

  const saveAssets = html.match(/window\.saveEpcAssetListRows = \(\) => \{[\s\S]*?\n        \};/);
  assert.ok(saveAssets, 'save assets handler should exist');
  assert.doesNotMatch(saveAssets[0], /project\.loads\.measurementMethod = 'asset_genset_fuel_mapping'/);

  for (const snippet of [
    'function buildEpcAssetSuggestionOptions',
    'function epcSuggestionInputCell',
    'function syncEpcAssetGensetMappings',
    'window.saveEpcGensetFuelRows'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing mapping helper snippet: ${snippet}`);
  }
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
    'setEpcDeviceWorkXAxisTickHours',
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
    'epc-device-work-axis-density',
    'X Axis Density',
    'data-epc-device-x-axis="auto"',
    'data-epc-device-x-axis="2"',
    'data-epc-device-x-axis="3"',
    'data-epc-device-x-axis="4"',
    'data-epc-device-x-axis="6"',
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
    'xAxisTickHours',
    'peakBand',
    'seriesColors',
    'Power axis padding 10%',
    'getEpcDeviceWorkXAxisTicks',
    'showEpcDeviceWorkHoverSnap',
    'hideEpcDeviceWorkHoverSnap',
    'epc-device-work-hover-layer',
    'epc-device-work-hover-capture',
    'epc-device-work-hover-guide',
    'epc-device-work-hover-marker',
    'epc-device-work-hover-tooltip',
    'epc-device-work-hover-tooltip-lines',
    'epc-device-work-analysis-color',
    'getEpcDeviceWorkHoverGroup',
    'renderEpcDeviceWorkHoverTooltipLines',
    'data-epc-hover-group',
    'onmousemove="showEpcDeviceWorkHoverSnap(event)"',
    'onmouseleave="hideEpcDeviceWorkHoverSnap()"'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing Device Work chart snippet: ${snippet}`);
  }
  assert.match(html, /intervalMinutes\) : 5/, 'Device Work interval default should be 5 minutes');
  assert.match(html, /oninput="previewEpcDeviceWorkRange\('start', this\.value\)"/, 'range start should preview without rerendering every step');
  assert.match(html, /onchange="setEpcDeviceWorkRange\('start', this\.value\)"/, 'range start should commit on release');
  assert.match(html, /Time Step[\s\S]*?X Axis Density[\s\S]*?Workday Peak/, 'x-axis density controls should be between time step and workday peak');
  assert.match(html, /nearestGroup\.length/, 'hover should collect overlapping series at the snapped point');
  assert.match(html, /createElementNS\('http:\/\/www\.w3\.org\/2000\/svg', 'tspan'\)/, 'hover tooltip should render SVG tspan lines when series overlap');
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
    'function shouldAutoPrepareEpcPvSimulatorProfile(project = {})',
    'function ensureEpcPvSimulatorProfileForInputs(project, result)',
    'function refreshEpcPvSimulatorProfileForRecommendation(project, result)',
    'ensureEpcPvSimulatorProfileForInputs(project, result)',
    'refreshEpcPvSimulatorProfileForRecommendation(project, result)',
    "project.solarResource?.dataSource === 'PV Simulator'",
    'project.solarResource?.pvSimulator',
    'project.solarResource?.hourlyPvProfile',
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
  assert.match(html, /const keys = \['pvOutputKw', 'loadKw', 'pvToBatteryKw', 'batteryToLoadKw', 'gensetToLoadKw', 'curtailmentKw'\]/, 'SOC should not be linearly interpolated as a power series');
  assert.doesNotMatch(html, /const keys = \['pvOutputKw', 'loadKw', 'pvToBatteryKw', 'batteryToLoadKw', 'gensetToLoadKw', 'curtailmentKw', 'socPct'\]/, 'SOC interpolation creates apparent SOC movement with zero energy flow');
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
  assert.match(html, /const weightedAverageKeys = \['baseLoadKw', 'loadNoiseKw', 'loadShockKw', 'loadKw', 'pvToLoadKw', 'pvToBatteryKw', 'batteryToLoadKw', 'gensetToLoadKw', 'unmetLoadKw'\]/);
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

test('EPC hourly EMS merge ignores next-day boundary rows when carrying SOC', () => {
  const source = [
    extractFunction('epcMinutesToTime', 'epcAddHoursToTime'),
    extractFunction('epcChartRound', 'normalizeEpcDeviceWorkPeakBandColor'),
    extractFunction('getEpcEnergyFlowDurationHours', 'mergeEpcEnergyFlowLoadSplits'),
    extractFunction('mergeEpcEnergyFlowLoadSplits', 'mergeEpcEnergyFlowRowsByHour'),
    extractFunction('mergeEpcEnergyFlowRowsByHour', 'getEpcEnergyFlowDisplayRows'),
    'return mergeEpcEnergyFlowRowsByHour;'
  ].join('\n');
  const mergeRows = Function(source)();
  const zeroFlow = minute => ({
    hourLabel: `${String(Math.floor(minute / 60)).padStart(2, '0')}:00`,
    timelineMinute: minute,
    intervalMinutes: 5,
    durationHours: 5 / 60,
    pvOutputKw: 0,
    loadKw: 0,
    pvToLoadKw: 0,
    pvToBatteryKw: 0,
    batteryToLoadKw: 0,
    gensetToLoadKw: 0,
    pcsLimitKw: 500,
    curtailmentKw: 0
  });
  const rows = [
    { ...zeroFlow(0), socPct: 82.4 },
    { ...zeroFlow(55), socPct: 82.4 },
    { ...zeroFlow(60), socPct: 82.4 },
    { ...zeroFlow(65), socPct: 82.4 },
    { ...zeroFlow(115), socPct: 82.4 },
    { ...zeroFlow(1500), socPct: 86.1 }
  ];

  const merged = mergeRows(rows);
  const oneToTwo = merged.find(row => row.hour === 1);

  assert.equal(oneToTwo?.socPct, 82.4);
});

test('EPC hourly EMS merge carries SOC across zero-flow hours', () => {
  const source = [
    extractFunction('epcMinutesToTime', 'epcAddHoursToTime'),
    extractFunction('epcChartRound', 'normalizeEpcDeviceWorkPeakBandColor'),
    extractFunction('getEpcEnergyFlowDurationHours', 'mergeEpcEnergyFlowLoadSplits'),
    extractFunction('mergeEpcEnergyFlowLoadSplits', 'mergeEpcEnergyFlowRowsByHour'),
    extractFunction('mergeEpcEnergyFlowRowsByHour', 'getEpcEnergyFlowDisplayRows'),
    'return mergeEpcEnergyFlowRowsByHour;'
  ].join('\n');
  const mergeRows = Function(source)();
  const zeroFlow = (minute, socPct) => ({
    timelineMinute: minute,
    intervalMinutes: 5,
    durationHours: 5 / 60,
    pvOutputKw: 0,
    loadKw: 0,
    pvToLoadKw: 0,
    pvToBatteryKw: 0,
    batteryToLoadKw: 0,
    gensetToLoadKw: 0,
    pcsLimitKw: 500,
    curtailmentKw: 0,
    socPct
  });
  const rows = [
    zeroFlow(0, 82.4),
    zeroFlow(55, 82.4),
    zeroFlow(60, 86.1),
    zeroFlow(65, 86.1),
    zeroFlow(115, 86.1)
  ];

  const merged = mergeRows(rows);

  assert.equal(merged.find(row => row.hour === 1)?.socPct, 82.4);
});

test('EPC hourly EMS merge carries previous day SOC across midnight zero-flow rows', () => {
  const source = [
    extractFunction('epcMinutesToTime', 'epcAddHoursToTime'),
    extractFunction('epcChartRound', 'normalizeEpcDeviceWorkPeakBandColor'),
    extractFunction('getEpcEnergyFlowDurationHours', 'mergeEpcEnergyFlowLoadSplits'),
    extractFunction('mergeEpcEnergyFlowLoadSplits', 'mergeEpcEnergyFlowRowsByHour'),
    extractFunction('mergeEpcEnergyFlowRowsByHour', 'getEpcEnergyFlowDisplayRows'),
    'return mergeEpcEnergyFlowRowsByHour;'
  ].join('\n');
  const mergeRows = Function(source)();
  const zeroFlow = (minute, socPct) => ({
    timelineMinute: minute,
    intervalMinutes: 5,
    durationHours: 5 / 60,
    pvOutputKw: 0,
    loadKw: 0,
    pvToLoadKw: 0,
    pvToBatteryKw: 0,
    batteryToLoadKw: 0,
    gensetToLoadKw: 0,
    pcsLimitKw: 500,
    curtailmentKw: 0,
    socPct
  });
  const rows = [
    zeroFlow(0, 86.1),
    zeroFlow(5, 86.1),
    zeroFlow(55, 86.1),
    zeroFlow(1380, 82.4),
    zeroFlow(1435, 82.4)
  ];

  const merged = mergeRows(rows);

  assert.equal(merged.find(row => row.hour === 0)?.socPct, 82.4);
});

test('EPC sub-hourly Load Work Profile carries previous day SOC across midnight zero-flow rows', () => {
  const source = [
    extractFunction('epcMinutesToTime', 'epcAddHoursToTime'),
    extractFunction('epcChartRound', 'normalizeEpcDeviceWorkPeakBandColor'),
    extractFunction('applyEpcDeviceWorkDurations', 'epcDeviceWorkDeterministicNoise'),
    extractFunction('getEpcEnergyFlowDurationHours', 'mergeEpcEnergyFlowLoadSplits'),
    extractFunction('getEpcDeviceWorkLoadTableRows', 'setEpcDeviceWorkLoadTableInterval'),
    'return getEpcDeviceWorkLoadTableRows;'
  ].join('\n');
  const getRows = Function(source)();
  const zeroFlow = (minute, socPct) => ({
    timelineMinute: minute,
    intervalMinutes: 1,
    durationHours: 1 / 60,
    baseLoadKw: 0,
    loadNoiseKw: 0,
    loadShockKw: 0,
    loadKw: 0,
    pvToLoadKw: 0,
    pvToBatteryKw: 0,
    batteryToLoadKw: 0,
    gensetToLoadKw: 0,
    unmetLoadKw: 0,
    socPct
  });
  const rows = getRows([
    zeroFlow(0, 86.1),
    zeroFlow(1, 86.1),
    zeroFlow(59, 86.1),
    zeroFlow(1380, 82.4),
    zeroFlow(1439, 82.4)
  ], 1);

  assert.equal(rows.find(row => row.timelineMinute === 0)?.socPct, 82.4);
  assert.equal(rows.find(row => row.timelineMinute === 1)?.socPct, 82.4);
});

test('EPC sub-hourly EMS and Device Work profiles apply midnight SOC carry before display', () => {
  const deviceProfile = html.match(/function buildEpcDeviceWorkProfileRows\(sourceRows = \[\], settings = \{\}\)[\s\S]*?function getEpcDeviceWorkRowsForSettings/);
  assert.ok(deviceProfile, 'Device Work profile source should be found');
  assert.match(deviceProfile[0], /return carryEpcZeroFlowSocRows\(\s*applyEpcDeviceWorkSocLedger\(/, 'Device Work profile rows should be SOC-carried before any chart or table display');

  const emsProfile = html.match(/function getEpcEmsFlowProfileRows\(result = \{\}\)[\s\S]*?function getEpcEnergyFlowDurationHours/);
  assert.ok(emsProfile, 'EMS Flow profile source should be found');
  assert.match(emsProfile[0], /return carryEpcZeroFlowSocRows\(profileRows, \{ wrapDay: true \}\)/, 'EMS sub-hourly rows should use the same SOC carry as hourly rows');
});

test('EPC Load Work Profile exposes PV battery charge and preserves charging SOC', () => {
  const source = [
    extractFunction('epcMinutesToTime', 'epcAddHoursToTime'),
    extractFunction('epcChartRound', 'normalizeEpcDeviceWorkPeakBandColor'),
    extractFunction('applyEpcDeviceWorkDurations', 'epcDeviceWorkDeterministicNoise'),
    extractFunction('getEpcEnergyFlowDurationHours', 'mergeEpcEnergyFlowLoadSplits'),
    extractFunction('getEpcDeviceWorkLoadTableRows', 'setEpcDeviceWorkLoadTableInterval'),
    'return getEpcDeviceWorkLoadTableRows;'
  ].join('\n');
  const getRows = Function(source)();
  const rows = getRows([
    {
      timelineMinute: 1020,
      intervalMinutes: 5,
      durationHours: 5 / 60,
      baseLoadKw: 0,
      loadNoiseKw: 0,
      loadShockKw: 0,
      loadKw: 0,
      pvToLoadKw: 0,
      pvToBatteryKw: 77,
      batteryToLoadKw: 0,
      gensetToLoadKw: 0,
      unmetLoadKw: 0,
      socPct: 76.3
    },
    {
      timelineMinute: 1075,
      intervalMinutes: 5,
      durationHours: 5 / 60,
      baseLoadKw: 0,
      loadNoiseKw: 0,
      loadShockKw: 0,
      loadKw: 0,
      pvToLoadKw: 0,
      pvToBatteryKw: 77,
      batteryToLoadKw: 0,
      gensetToLoadKw: 0,
      unmetLoadKw: 0,
      socPct: 82.4
    }
  ], 60);
  const chargingHour = rows.find(row => row.timelineMinute === 1020);

  assert.equal(chargingHour?.pvToBatteryKw, 77);
  assert.equal(chargingHour?.socPct, 82.4);
  assert.match(html, /PV battery kW/);
  assert.match(html, /summarizeEnergy\('pvToBatteryKw'\)/);
  assert.match(html, /colspan="11"/);
});

test('EPC hourly EMS Flow preserves load split branch values after merging rows', () => {
  assert.match(html, /function mergeEpcEnergyFlowLoadSplits\(items = \[\]\)/, 'hourly merge should have a load split aggregator');
  const hourlyMerge = html.match(/function mergeEpcEnergyFlowRowsByHour\(rows = \[\]\)[\s\S]*?function getEpcEnergyFlowDisplayRows/);
  assert.ok(hourlyMerge, 'hourly EMS merge should be found');
  assert.match(hourlyMerge[0], /loadSplits: mergeEpcEnergyFlowLoadSplits\(items\)/, 'merged hourly rows should retain per-branch load kW for EMS Flow labels and animation');
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
    'function updateEpcSelectedTopology(value, options = {})',
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

test('EPC Electrical workspace exposes PASS architecture choose controls', () => {
  const electricalRenderer = html.match(/function renderEpcElectricalWorkspace\(result\)[\s\S]*?function flowLineClass/);
  assert.ok(electricalRenderer, 'electrical workspace renderer should exist');
  for (const snippet of [
    'chooseEpcElectricalArchitecture',
    'data-epc-architecture-choose',
    "candidate.status === 'PASS'",
    'selectedArchitectureId',
    'selectedArchitectureWarning'
  ]) {
    assert.match(electricalRenderer[0], new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing electrical choose snippet: ${snippet}`);
  }
});

test('EPC SLD workspace exposes move route save and reset controls', () => {
  for (const snippet of [
    'Electrical SLD Workspace',
    'renderEpcSldWorkspaceToolbar',
    'setEpcSldWorkspaceMode',
    'epc-sld-mode',
    'Move',
    'Route',
    'Reset Saved',
    'Save Topology',
    'openEpcTopologySaveModal',
    'confirmSaveEpcTopologyTemplate',
    'epcSldTemplateDraft',
    'stageEpcSldTemplateNodePosition',
    'stageEpcSldTemplateEdgeRoute',
    'resetEpcSldTemplateDraft',
    'saveEpcStandardTopologyNodePosition',
    'saveEpcStandardTopologyEdgeRoute',
    'resetEpcStandardTopologySaved',
    'standardTopologyLibrary',
    'data-epc-sld-node',
    'data-epc-sld-edge',
    'canEditEpcEngineering()'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing SLD workspace snippet: ${snippet}`);
  }
  assert.doesNotMatch(html, /data-epc-sld-mode="replace"/);
  assert.doesNotMatch(html, />Replace<\/button>/);
  assert.doesNotMatch(html, /Apply Replacement/);
});

test('EPC SLD workspace renders validation cards below nodes and edges', () => {
  const renderer = html.match(/function renderEpcTopologyWorkspace\(result, project = getActiveEpcDesignProject\(\)\)[\s\S]*?function renderEpcElectricalWorkspace/);
  assert.ok(renderer, 'topology workspace renderer should exist');
  const body = renderer[0];
  assert.match(body, /data-epc-topology-validation-grid/);
  assert.match(body, /Nodes[\s\S]*Edges[\s\S]*data-epc-topology-validation-grid/);
  assert.doesNotMatch(body, /<aside class="space-y-3">/);
  for (const snippet of [
    'Topology valid for concept screen',
    'Errors',
    'Warnings',
    'Apply suggested fix manually'
  ]) {
    assert.match(body, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing moved validation snippet: ${snippet}`);
  }
});

test('EPC SLD workspace exposes route drag handles and zoom controls', () => {
  const toolbar = html.match(/function renderEpcSldWorkspaceToolbar\(result = \{\}\)[\s\S]*?function renderEpcTopologySld/);
  const renderer = html.match(/function renderEpcTopologySld\(topology = \{\}\)[\s\S]*?function getEpcTopologySelectionState/);
  const endpointSaver = html.match(/function saveEpcStandardTopologyEdgeEndpoint\(edgeId, endpoint = 'target', nodeId = ''\)[\s\S]*?window\.saveEpcStandardTopologyEdgeEndpoint/);
  assert.ok(toolbar, 'SLD toolbar renderer should exist');
  assert.ok(renderer, 'SLD topology renderer should exist');
  assert.ok(endpointSaver, 'SLD endpoint saver should exist');

	for (const snippet of [
		'Zoom -',
		'Zoom +',
		'Fit',
		'setEpcSldViewportZoom',
		'fitEpcSldViewport',
		'calculateEpcSldFitViewport',
		'saveEpcStandardTopologyViewport',
		'applyEpcSldViewportPreview',
		'iconButton',
		'iconSvg',
		'title="${label}"',
		'aria-label="${label}"',
		'inline-flex h-9 w-9',
		'zoomOut',
		'zoomIn'
	]) {
		assert.match(toolbar[0], new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing SLD zoom toolbar snippet: ${snippet}`);
	}
	assert.doesNotMatch(toolbar[0], /100%/, 'SLD toolbar should not expose the reset-to-100-percent button');
	assert.doesNotMatch(toolbar[0], /resetEpcSldViewportZoom/, 'SLD toolbar should not call the removed 100 percent zoom action');
  for (const snippet of [
    "['add', 'Add']",
    "['delete', 'Delete']",
    'openEpcSldAddNodeModal',
    'data-epc-sld-delete-marker',
    'deleteEpcSldTopologyNode'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing SLD add/delete snippet: ${snippet}`);
  }

  for (const snippet of [
    'data-epc-sld-waypoint',
    'data-epc-sld-segment',
    'data-epc-sld-edge-hit',
    'data-epc-sld-route-preview',
    'data-epc-sld-node-port',
    'handleEpcSldEdgePointerDown',
    'startEpcSldRouteEndpointDrag',
    'findEpcSldSnapTarget',
    'saveEpcStandardTopologyEdgeEndpoint',
    'updateEpcSldRoutePreview',
    'startEpcSldRouteWaypointDrag',
    'startEpcSldRouteSegmentDrag',
    'startEpcSldPanDrag',
    'getEpcSldCanvasMetrics',
    'variant.viewport',
    'variant.canvas'
  ]) {
    assert.match(renderer[0], new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing SLD route/viewport snippet: ${snippet}`);
  }

  assert.doesNotMatch(renderer[0], /Math\.min\(1010/);
  assert.doesNotMatch(renderer[0], /Math\.min\(330/);
  assert.doesNotMatch(renderer[0], /onpointerdown="event\.stopPropagation\(\)"/);
  assert.doesNotMatch(html, /handleEpcSldEdgePointerDown[\s\S]{0,500}saveEpcStandardTopologySelectedEdgeRoute/);
  assert.match(renderer[0], /viewBox="\$\{htmlSafe\(viewBox\)\}"/);
  for (const snippet of [
    'generatedFromDirect',
    'epc-sld-route-preview-active',
    'snapTarget',
    'window.moveEpcSldRouteDrag',
    'window.endEpcSldRouteDrag',
    'applyEpcSldViewportPreview(epcSldDrag.next, epcSldDrag.canvas)',
    'saveEpcCustomTopologyDraftMutation',
    "project.selectedTopologyId !== 'CUSTOM'",
    'CUSTOM topology connection endpoint staged',
    'CUSTOM topology route staged',
    'CUSTOM topology layout staged',
    'getEpcSldWorkspaceResultForEditing',
    'getEpcSldTemplateContext(result)'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing SLD route drag implementation snippet: ${snippet}`);
  }
  assert.match(endpointSaver[0], /saveEpcCustomTopologyDraftMutation/, 'endpoint drops should persist into CUSTOM topology draft');
});

test('EPC SLD workspace exposes select connect history and move snap controls', () => {
  const toolbar = html.match(/function renderEpcSldWorkspaceToolbar\(result = \{\}\)[\s\S]*?function renderEpcTopologySld/);
  const renderer = html.match(/function renderEpcTopologySld\(topology = \{\}\)[\s\S]*?function getEpcTopologySelectionState/);
  assert.ok(toolbar, 'SLD toolbar renderer should exist');
  assert.ok(renderer, 'SLD topology renderer should exist');

  for (const snippet of [
    "['select', 'Select']",
    "['connect', 'Connect']",
    'Undo',
    'Redo',
    'History',
    'undoEpcSldHistory',
    'redoEpcSldHistory',
    'openEpcSldHistoryModal',
    'epcSldHistory',
    'pushEpcSldHistorySnapshot',
    'restoreEpcSldHistorySnapshot',
    'clearEpcSldHistory'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing SLD history/control snippet: ${snippet}`);
  }

  for (const snippet of [
    'epcSldSelectedNodeIds',
    'startEpcSldSelectMarquee',
    'moveEpcSldSelectMarquee',
    'endEpcSldSelectMarquee',
    'data-epc-sld-select-marquee',
    'data-epc-sld-selected-node',
    'getEpcSldNodeRect',
    'rectsIntersect'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing SLD select snippet: ${snippet}`);
  }

  for (const snippet of [
    'epcSldConnectDraft',
    'startEpcSldConnectFromPort',
    'moveEpcSldConnectDrag',
    'endEpcSldConnectDrag',
    'completeEpcSldConnectToPort',
    'inferEpcSldConnectionEdge',
    'stageEpcSldInferredConnection',
    'openEpcSldConnectManualEditor',
    'data-epc-sld-connect-preview',
    'data-epc-sld-connect-port',
    'epc-sld-connect-preview-active'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing SLD connect snippet: ${snippet}`);
  }

  for (const snippet of [
    'findEpcSldNodeAlignmentSnap',
    'applyEpcSldNodeDragPreview',
    'data-epc-sld-snap-guide',
    'epcSldDrag.groupNodeIds',
    'epcSldDrag.groupInitial',
    'saveEpcStandardTopologyNodePositions'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing SLD move snap snippet: ${snippet}`);
  }

  assert.match(renderer[0], /epcSldWorkspaceMode === 'route' \|\| epcSldWorkspaceMode === 'connect'/, 'ports should render in route and connect modes');
  assert.doesNotMatch(toolbar[0], /locked by Electrical/, 'SLD edit modes must not be locked by Electrical architecture');
});

test('EPC SLD workspace can add and delete topology nodes', () => {
  for (const snippet of [
    'id="epc-sld-add-node-modal"',
    'openEpcSldAddNodeModal',
    'closeEpcSldAddNodeModal',
    'renderEpcSldAddNodePalette',
    'saveEpcSldAddedNode',
    'generateEpcSldCustomNodeId',
    'epc-sld-node-template',
    'epc-sld-node-label',
    'epc-sld-node-type',
    'epc-sld-node-voltage',
    'epc-sld-node-bus-orientation',
    'removedNodeIds',
    'deleteEpcSldTopologyNode',
    'clearEpcRemovedNodeTombstone',
    'data-epc-sld-delete-marker'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing SLD add/delete node snippet: ${snippet}`);
  }
  assert.match(html, /setEpcSldWorkspaceMode\('add'\)[\s\S]*openEpcSldAddNodeModal/, 'Add mode should open the add-node modal');
  assert.doesNotMatch(html, /data-epc-sld-mode="add"[\s\S]{0,180}locked by Electrical/, 'Add mode must not be locked by Electrical architecture');
  assert.doesNotMatch(html, /data-epc-sld-mode="delete"[\s\S]{0,180}locked by Electrical/, 'Delete mode must not be locked by Electrical architecture');
});

test('EPC topology selector and save modal support custom templates', () => {
  for (const snippet of [
    'customTemplates',
    'renderEpcCustomTemplateSelectorOptions',
    'CUSTOM - Manual Graph',
    'data-epc-topology-save',
    'epc-topology-save-modal',
    'epc-custom-template-name',
    'epc-custom-template-class',
    'epc-custom-template-generated-id',
    'generateNextEpcCustomTemplateId',
    'saveEpcSldCustomTemplate',
    'overwriteEpcSldTemplateVariant',
    'C&I',
    'RESI'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing custom template save snippet: ${snippet}`);
  }
});

test('EPC Topology selector is editable while EMS Flow remains electrical locked', () => {
  const topologyWorkspace = html.match(/function renderEpcTopologyWorkspace\(result, project = getActiveEpcDesignProject\(\)\)[\s\S]*?function renderEpcElectricalWorkspace/);
  const flowSelector = html.match(/function renderEpcFlowTopologySelector\(result = \{\}\)[\s\S]*?function renderEpcTopologyWorkspace/);
  assert.ok(topologyWorkspace, 'Topology workspace renderer should exist');
  assert.ok(flowSelector, 'EMS Flow topology selector renderer should exist');

  for (const snippet of [
    'function getEpcTopologyWorkspaceResult(result = {}, project = getActiveEpcDesignProject())',
    'const workspaceResult = getEpcTopologyWorkspaceResult(result, project)',
    'renderEpcTopologySelectorOptions(workspaceResult, { enforceElectricalLock: false',
    "updateEpcSelectedTopology(this.value, { enforceElectricalLock: false })",
    'renderEpcFlowTopologySelectorOptions(result)',
    "updateEpcSelectedTopology(this.value, { enforceElectricalLock: true })"
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing split selector snippet: ${snippet}`);
  }
  assert.doesNotMatch(topologyWorkspace[0], /locked by Electrical/);
  assert.match(flowSelector[0], /locked by Electrical|requiresMvTopology|MV PASS only/);
});

test('EPC EMS Flow renders topology-aware standard components and validation state', () => {
  const flowRenderer = html.match(/function renderEpcFlowDiagram\(result, row\)[\s\S]*?function renderEpcSocBadge/);
  const topologyRenderer = html.match(/function renderEpcTopologyFlowDiagram\(result, row, options = \{\}\)[\s\S]*?function renderEpcFlowDiagram/);
  assert.ok(flowRenderer, 'EMS Flow renderer should be found');
  assert.ok(topologyRenderer, 'topology EMS Flow renderer should be found');
  for (const snippet of [
    'function buildEpcTopologyFlowRenderModel(result, row)',
    'function renderEpcTopologyFlowDiagram(result, row, options = {})',
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
    'renderEpcTopologyFlowZoneSummary',
    'zone-aware grouping',
    '11kV ring selected to reduce MW-level LV current and support distributed quarry loads.',
    '9 units / TJQ1 4 / TJQ2 5',
    'epc-flow-line-blocked',
    'renderEpcTopologyFlowDiagram(result, selectedRow)'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing topology-aware flow snippet: ${snippet}`);
  }
  assert.match(html, /function renderEpcTopologyFlowDiagram\(result, row, options = \{\}\)/);
  assert.match(html, /data-epc-flow-zone-summary="true"/);
  assert.match(html, /const feederZoning = result\.feederZoning \|\| \{\};/);
  assert.match(html, /includeZoneSummary === false/);
  assert.match(html, /renderEpcTopologyFlowDiagram\(result, selectedRow, \{ includeZoneSummary: false \}\)/);
  assert.match(topologyRenderer[0], /<svg id="epc-flow-svg"[\s\S]*?<\/svg>[\s\S]*?renderEpcTopologyFlowZoneSummary\(result\)/, 'zone-aware grouping should render below the EMS Flow SVG');
  assert.doesNotMatch(flowRenderer[0], /<path class="\$\{flowLineClass\(row\?\.pvOutputKw/, 'EMS Flow should not render fixed legacy paths directly');
  assert.doesNotMatch(flowRenderer[0], /Customize Connections|openEpcTopologyConnectionModal/, 'EMS Flow should not expose topology editing controls');
});

test('EPC EMS Flow splits simultaneous battery charge discharge and exposes topology selector', () => {
  for (const snippet of [
    'id="epc-flow-topology-selector"',
    'renderEpcFlowTopologySelector(result)',
    'toggleEpcTopologyFlowLabelMoveMode',
    'epcTopologyFlowLabelMoveMode',
    'startEpcTopologyFlowLabelDrag',
    'saveEpcTopologyFlowLabelOffset',
    'epc-flow-label-move-enabled',
    'EPC_TOPOLOGY_FLOW_LABEL_MAX_DISTANCE',
    'EPC_TOPOLOGY_FLOW_LABEL_SNAP_DISTANCE',
    'constrainEpcTopologyFlowLabelOffset',
    'getEpcTopologyFlowLabelRoutePoint',
    'data-epc-topology-flow-label',
    'topologyFlowLabelOffsets',
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
    "'loadKw'",
    'y="74"',
    'y="88"',
    'markerWidth="4"',
    "renderEpcFlowLabel(edge.value, edge.route.labelX, edge.route.labelY, '', {",
    'edgeId: edge.id',
    'offset: labelOffsets[edge.id] || {}',
    "role === 'control' ? Math.max(90, laneY + 110)",
    "updateEpcSelectedTopology(this.value, { enforceElectricalLock: true })"
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing split-flow selector snippet: ${snippet}`);
  }
  const valueHelper = html.match(/function epcTopologyFlowValue\(edge = \{\}, row = \{\}\)[\s\S]*?function epcTopologyFlowLineType/);
  assert.ok(valueHelper, 'topology flow value helper should exist');
  assert.doesNotMatch(valueHelper[0], /reduce\(\(total, key\) => total \+ Math\.max/, 'edge labels should not sum charge and discharge keys on one line');
  const edgeLabelHelper = html.match(/function renderEpcTopologyFlowEdgeLabel\(edge = \{\}, labelOffsets = \{\}\)[\s\S]*?function renderEpcTopologyFlowNode/);
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

test('EPC topology-aware flow can render manual SLD routes from standard templates', () => {
  const renderModel = html.match(/function buildEpcTopologyFlowRenderModel\(result, row\)[\s\S]*?function renderEpcTopologyFlowEdge/);
  assert.ok(renderModel, 'topology flow render model should exist');
  for (const snippet of [
    'epcTopologyFlowManualRoute',
    'edge.route?.manualRoute',
    'edge.route?.waypoints',
    'manualRoute'
  ]) {
    assert.match(renderModel[0], new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing manual route snippet: ${snippet}`);
  }
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
  const assetsPage = html.match(/data-epc-detail-page="assets"[\s\S]*?<\/section>/);
  assert.ok(assetsPage, 'assets list page should hold split controls');
  assert.match(assetsPage[0], /id="epc-load-count"/);
  assert.match(assetsPage[0], /id="epc-load-split-controls"/);
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
    'epcCustomConnectionEditId',
    'selectEpcCustomTopologyConnection',
    'clearEpcCustomConnectionEdit',
    'saveEpcCustomTopologyConnection',
    'renderEpcCustomConnectionPreview',
    'addEpcCustomTopologyConnection',
    'removeEpcCustomTopologyConnection',
    'removedEdgeIds',
    'clearEpcRemovedEdgeTombstone',
    'validateEpcCustomTopologyConnectionDraft',
    'Customize Connections',
    'Edit Connection',
    'Save Connection',
    'Cancel Edit',
    'Copy standard topology to Custom',
    'epc-custom-connection-editor-title',
    'epc-custom-connection-save-label',
    'epc-custom-connection-preview',
    'data-epc-custom-connection-row',
    'data-epc-custom-connection-selected',
    'epc-custom-edge-source',
    'epc-custom-edge-target',
    'epc-custom-edge-type',
    'canEditEpcEngineering()'
  ]) {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing custom connection snippet: ${snippet}`);
  }
});
