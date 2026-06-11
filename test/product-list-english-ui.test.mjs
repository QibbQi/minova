import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function snippetBetween(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing marker: ${startMarker}`);
  const end = html.indexOf(endMarker, start);
  assert.notEqual(end, -1, `Missing end marker: ${endMarker}`);
  return html.slice(start, end);
}

function mainSnippet(startMarker) {
  const start = html.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing marker: ${startMarker}`);
  const end = html.indexOf('\n    </main>', start);
  assert.notEqual(end, -1, `Missing </main> after: ${startMarker}`);
  return html.slice(start, end);
}

function embeddedState() {
  const startMarker = '<script id="minova-embedded-state" type="application/json">';
  const start = html.indexOf(startMarker);
  assert.notEqual(start, -1, 'Missing embedded state script');
  const bodyStart = start + startMarker.length;
  const end = html.indexOf('</script>', bodyStart);
  assert.notEqual(end, -1, 'Missing embedded state end script');
  return JSON.parse(html.slice(bodyStart, end).trim());
}

function normalizedBypassText(source) {
  return source
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/data:image\/[^"']+/g, ' ')
    .replace(/\bhidden\b/g, ' ')
    .replace(/style="display:\s*none;?"/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

test('product list tab labels and related modal UI are English', () => {
  const databaseTab = mainSnippet('<main id="view-database"');
  const supplierModal = snippetBetween('<div id="supplier-modal"', '<div id="modal"');
  const productModal = snippetBetween('<div id="modal"', '<div id="inventory-modal"');
  const importModal = snippetBetween('<div id="import-modal"', '<script id="minova-embedded-state"');
  const productListUi = `${databaseTab}\n${supplierModal}\n${productModal}\n${importModal}`;

  [
    '产品清单',
    '公司信息',
    '供应商信息表单',
    '后台产品清单',
    '批量导入',
    '入库新产品',
    '编辑供应商',
    '编辑产品档案',
    '批量导入产品',
    '取消',
    '下一步'
  ].forEach((text) => {
    assert.equal(productListUi.includes(text), false, `Unexpected Chinese UI text: ${text}`);
  });

  [
    'Product',
    'List',
    'Company Information',
    'Supplier Master Data',
    'Product Master List',
    'Bulk Import',
    'New Product',
    'Edit Supplier',
    'Edit Product Record',
    'Cancel',
    'Next'
  ].forEach((text) => {
    assert.equal(productListUi.includes(text), true, `Missing English UI text: ${text}`);
  });
});

test('hidden-bypass check exposes English product list UI with migrated category data', () => {
  const databaseTab = mainSnippet('<main id="view-database"');
  const supplierModal = snippetBetween('<div id="supplier-modal"', '<div id="modal"');
  const productModal = snippetBetween('<div id="modal"', '<div id="inventory-modal"');
  const importModal = snippetBetween('<div id="import-modal"', '<script id="minova-embedded-state"');
  const bypassText = normalizedBypassText(`${databaseTab}\n${supplierModal}\n${productModal}\n${importModal}`);

  [
    'Company Information',
    'Supplier Master Data',
    'Product Master List',
    'Loading suppliers...',
    'Loading product records...',
    'Edit Supplier',
    'Edit Product Record',
    'Bulk Import Products'
  ].forEach((text) => {
    assert.equal(bypassText.includes(text), true, `Hidden-bypass text is missing: ${text}`);
  });

  [
    '供应商信息表单',
    '后台产品清单',
    '编辑供应商',
    '编辑产品档案',
    '批量导入产品',
    '产品质量'
  ].forEach((text) => {
    assert.equal(bypassText.includes(text), false, `Hidden-bypass text still exposes Chinese UI: ${text}`);
  });

  const state = embeddedState();
  assert.equal(
    state.data.products.some((product) => product.category === 'PV Module'),
    true,
    'Embedded product data should use English category keys'
  );
  assert.equal(html.includes("['光伏组件', 'PV Module']"), true, 'Missing legacy category alias');
  assert.equal(html.includes("['明匠', 'Mingjiang']"), true, 'Missing display-only supplier mapping');
});

test('product master exposes product type and role view controls', () => {
  const databaseTab = mainSnippet('<main id="view-database"');
  [
    'id="product-master-type-controls"',
    'id="product-master-role-controls"',
    'setProductMasterTypeView',
    'setProductMasterRoleView',
    'ESS / Hybrid Storage',
    'BOS / Accessories',
    'Engineering / Technical',
    'Commercial / Audit'
  ].forEach((text) => {
    assert.equal(databaseTab.includes(text) || html.includes(text), true, `Missing Product Master view UI: ${text}`);
  });
});

test('product master type groups map current product categories without schema migration', () => {
  [
    "id: 'ess'",
    "categories: ['All-in-One System', 'C&I Storage']",
    "id: 'bos'",
    "categories: ['Accessory']",
    'function getProductTypeGroup(product)',
    'window.getProductTypeGroup = getProductTypeGroup'
  ].forEach((text) => {
    assert.equal(html.includes(text), true, `Missing product type grouping logic: ${text}`);
  });
});

test('product master role views define permission-aware column sets', () => {
  [
    "id: 'sales'",
    "id: 'engineering'",
    "id: 'procurement'",
    "id: 'commercial'",
    "id: 'full'",
    "sensitiveField: 'cost'",
    "sensitiveField: 'supplierContact'",
    'function getDefaultProductRoleView()',
    "sales_management: 'sales'",
    "supply_chain: 'procurement'",
    "operation_management: 'engineering'",
    "price_auditor: 'commercial'",
    "admin: 'full'"
  ].forEach((text) => {
    assert.equal(html.includes(text), true, `Missing Product Master role view rule: ${text}`);
  });
});

test('product master v2 exposes search and md-inspired technical field surfaces', () => {
  const databaseTab = mainSnippet('<main id="view-database"');
  const productModal = snippetBetween('<div id="modal"', '<div id="inventory-modal"');
  const script = snippetBetween('const PRODUCT_MASTER_TYPE_STORAGE_KEY', '// --- Select器逻辑 ---');

  [
    'id="product-master-search"',
    'minova_product_master_search_v1',
    'Product Master Details',
    'id: `m-master-${key}`',
    'PRODUCT_MASTER_COMMON_FIELD_KEYS.map(key =>',
    'id="product-master-technical-fields"',
    'id="product-master-details-fields"',
    'Power_W',
    'Rated_AC_Power_kW',
    'Nominal_Energy_kWh',
    'PCS_Rated_Power_kW'
  ].forEach((text) => {
    assert.equal(
      databaseTab.includes(text) || productModal.includes(text) || script.includes(text),
      true,
      `Missing Product Master V2 UI or helper text: ${text}`
    );
  });
});

test('product master v2 saves lightweight masterData and technicalSpecs without replacing legacy fields', () => {
  const script = snippetBetween('const PRODUCT_MASTER_TYPE_STORAGE_KEY', '// --- 批量导入逻辑 ---');

  [
    'masterData: readProductMasterDataFromModal()',
    'technicalSpecs: readProductTechnicalSpecsFromModal(category)',
    'fillProductMasterDetails(p)',
    "renderProductModalMasterDetailFields(product.category || document.getElementById('m-category')?.value || '', md)",
    'renderProductTechnicalFields(category, p?.technicalSpecs || {})',
    'spec: hybridSpec || document.getElementById(\'m-spec\').value',
    'scenario: normalizeProductSubcategory(document.getElementById(\'m-scenario\').value)',
    'inverterKw: hybrid ?',
    'batteryKwh: hybrid ?'
  ].forEach((text) => {
    assert.equal(script.includes(text), true, `Missing V2 save/load compatibility logic: ${text}`);
  });
});

test('product master v2 category specs map pv inverter battery and ess fields', () => {
  [
    "id: 'pv'",
    "id: 'inverter'",
    "id: 'battery'",
    "id: 'ess'",
    'powerW',
    'moduleEfficiencyPct',
    'ratedAcPowerKw',
    'mpptQty',
    'nominalEnergyKwh',
    'cycleLife',
    'pcsRatedPowerKw',
    'emsIncluded'
  ].forEach((text) => {
    assert.equal(html.includes(text), true, `Missing category technical field mapping: ${text}`);
  });
});

test('product master v2 search covers base supplier certification and technical values', () => {
  const script = snippetBetween('const PRODUCT_MASTER_TYPE_STORAGE_KEY', '// --- Select器逻辑 ---');

  [
    'function getProductMasterSearchQuery()',
    'function productMatchesProductMasterSearch(product, query)',
    'flattenProductMasterValues(product.masterData)',
    'flattenProductMasterValues(product.technicalSpecs)',
    'getProductSupplierDisplay(product)',
    'getProductCertificationRequirements(product)',
    'searchFilteredProducts',
    'renderProductMasterControls(products.length, filteredProducts.length, searchFilteredProducts.length)'
  ].forEach((text) => {
    assert.equal(script.includes(text), true, `Missing Product Master search behavior: ${text}`);
  });
});

test('product master v2 role views and template include added master columns', () => {
  [
    "model: { key: 'model', label: 'Model'",
    "brand: { key: 'brand', label: 'Brand'",
    "series: { key: 'series', label: 'Series'",
    "voltage: { key: 'voltage', label: 'Voltage'",
    "phase: { key: 'phase', label: 'Phase'",
    "status: { key: 'status', label: 'Status'",
    "technicalSummary: { key: 'technicalSummary', label: 'Technical Summary'",
    "efficiencyCapacity: { key: 'efficiencyCapacity', label: 'Efficiency / Capacity'",
    "'SKU / Model'",
    "'Voltage Class'",
    "'Power_W'",
    "'Rated_AC_Power_kW'",
    "'Nominal_Energy_kWh'",
    "'PCS_Rated_Power_kW'"
  ].forEach((text) => {
    assert.equal(html.includes(text), true, `Missing V2 Product Master column/template field: ${text}`);
  });
});

test('product master v3 role views focus on role workflows', () => {
  [
    "id: 'sales'",
    "columns: ['id', 'name', 'quoteReadiness', 'supplyRoute', 'certificationReadiness', 'application', 'warranty', 'leadTime', 'quotePrice', 'actions']",
    "id: 'engineering'",
    "compatibilityStatus",
    "attachedSpecs",
    "certificationRequirements",
    "id: 'procurement'",
    "sourceType",
    "commercialSupplier",
    "factoryBrandOwner",
    "authorizationStatus",
    "id: 'commercial'",
    "sourceRisk",
    "certificationGap",
    "marketAlignment"
  ].forEach((text) => {
    assert.equal(html.includes(text), true, `Missing V3 role workflow column rule: ${text}`);
  });
});

test('product master v3 separates certification requirements links and attached files', () => {
  const productModal = snippetBetween('<div id="modal"', '<div id="inventory-modal"');
  const script = snippetBetween('const PRODUCT_MASTER_TYPE_STORAGE_KEY', '// --- Select器逻辑 ---');

  [
    'Certification Requirements',
    'id="m-cert-record-picker"',
    'id="m-cert-selected-summary"',
    'certificationRequirementIds',
    'openProductCertificationEvidence',
    'External Certificate Link',
    'Product Certification Files',
    'Attached Certs',
    'Certification Status'
  ].forEach((text) => {
    assert.equal(productModal.includes(text) || script.includes(text), true, `Missing V3 certification clarity UI: ${text}`);
  });

  assert.equal(productModal.includes('id="m-cert-country-list"'), false, 'Product certification editor should not expose country checkbox requirements');
  assert.equal(html.includes('function renderCertificationCountryChoices'), false, 'Country-based certification picker should be removed from product maintenance');

  [
    'productMasterAttachedCertFiles(product)',
    'productMasterCertificationStatus(product)',
    'ctx.masterData.certificateLink',
    'flattenProductMasterValues(productMasterAttachedCertFiles(product))'
  ].forEach((text) => {
    assert.equal(script.includes(text), true, `Missing V3 certification clarity logic: ${text}`);
  });
});

test('engineering workspace exposes certification matrix filters and seeded catalog state', () => {
  const engineeringTab = mainSnippet('<main id="view-engineering"');
  const script = snippetBetween('const PRODUCT_MASTER_TYPE_STORAGE_KEY', '// --- Select器逻辑 ---');
  const state = embeddedState();
  const catalog = state.data.certificationRequirementsCatalog || [];

  [
    'Engineering Workspace',
    'id="engineering-workspace-certification"',
    'id="engineering-workspace-product-master"',
    'id="engineering-mode-standard"',
    'id="engineering-mode-matrix"',
    'id="engineering-cert-view-mode"',
    'id="engineering-cert-edit-mode"',
    'id="engineering-add-record-button"',
    'id="engineering-search-products-primary"',
    'id="engineering-standard-search-filters"',
    'id="engineering-standard-level-filters"',
    'id="engineering-standard-category-filters"',
    'id="engineering-standard-match-card"',
    'id="engineering-refresh-product-results"',
    'id="engineering-open-quotation"',
    'id="engineering-standard-panel"',
    'id="engineering-matrix-panel"',
    'id="engineering-standard-list"',
    'id="engineering-standard-product-results"',
    'id="engineering-class-filter"',
    'id="engineering-architecture-class-toolbar"',
    'id="engineering-architecture-class-edit-actions"',
    'id="engineering-add-architecture-class"',
    'id="engineering-delete-architecture-class"',
    'id="engineering-level-filters"',
    'id="engineering-category-filters"',
    'id="engineering-cert-list"',
    'id="engineering-certification-workspace-panel"',
    'id="engineering-product-master-panel"',
    'id="engineering-product-master-type-filter"',
    'id="engineering-product-master-detail-group"',
    'id="engineering-product-master-detail-state"',
    'id="engineering-product-master-cert-filter"',
    'id="engineering-product-master-search"',
    'id="engineering-product-master-summary"',
    'id="engineering-product-master-list"',
    'id="engineering-product-master-mode-product"',
    'id="engineering-product-master-mode-detail"',
    'id="engineering-product-master-product-mode-panel"',
    'id="engineering-product-master-detail-mode-panel"',
    'id="engineering-detail-template-category"',
    'id="engineering-detail-template-group"',
    'id="engineering-detail-template-fields"',
    'id="engineering-detail-template-field-form"',
    'id="engineering-detail-template-field-name"',
    'id="engineering-detail-template-target-group"',
    'id="engineering-detail-template-custom-group"',
    'id="engineering-detail-template-add-field"',
    'id="engineering-detail-template-save-field"',
    'id="engineering-detail-template-cancel-edit"',
    'id="engineering-detail-template-bulk-list"',
    'id="engineering-detail-template-add-product"',
    'id="engineering-detail-template-reuse-product"',
    'id="engineering-detail-template-preview-save"',
    'id="engineering-detail-template-bulk-scope"',
    'mt-5 grid grid-cols-1 gap-4',
    'sm:grid-cols-[minmax(0,1fr)_180px_minmax(0,1fr)_auto_auto]',
    'whitespace-nowrap min-w-[96px]',
    'Product mode',
    'Detail mode',
    'Class & Filters',
    'View mode',
    'Edit mode',
    'Add Class',
    'Delete Class'
  ].forEach((text) => {
    assert.equal(engineeringTab.includes(text), true, `Missing engineering workspace UI: ${text}`);
  });
  assert.ok(
    engineeringTab.indexOf('id="engineering-workspace-certification"') < engineeringTab.indexOf('id="engineering-summary"'),
    'Engineering workspace switch should sit above the summary cards'
  );
  [
    'md:flex-row md:items-start md:justify-between',
    'md:ml-auto md:text-right',
    'brand-yellow-surface',
    'brand-yellow-action',
    'brand-yellow-inactive',
    'bg-purple-700 text-white shadow-sm',
    'text-purple-700 brand-yellow-inactive'
  ].forEach((text) => {
    assert.equal(engineeringTab.includes(text), true, `Missing engineering workspace switch layout/color: ${text}`);
  });
  assert.ok(
    engineeringTab.indexOf('id="engineering-add-record-button"') > engineeringTab.indexOf('id="engineering-cert-edit-mode"')
      && engineeringTab.indexOf('id="engineering-add-record-button"') < engineeringTab.indexOf('id="engineering-standard-match-card"'),
    'Add Record should live with certification edit controls before matched products'
  );
  assert.ok(
    engineeringTab.indexOf('id="engineering-search-products-primary"') > engineeringTab.indexOf('id="engineering-open-quotation"')
      && engineeringTab.indexOf('id="engineering-search-products-primary"') < engineeringTab.indexOf('id="engineering-standard-product-results"'),
    'Primary Search Product button should sit inside Matched Products after Open Quotation'
  );
  assert.ok(
    engineeringTab.indexOf('id="engineering-search"') < engineeringTab.indexOf('id="engineering-filter-note"')
      && engineeringTab.indexOf('id="engineering-filter-note"') < engineeringTab.indexOf('id="engineering-search-products-primary"'),
    'Record search box should no longer contain the Search Product action'
  );
  assert.ok(
    engineeringTab.indexOf('id="engineering-quote-source-default"') > engineeringTab.indexOf('id="engineering-standard-match-card"')
      && engineeringTab.indexOf('id="engineering-quote-price-default"') > engineeringTab.indexOf('id="engineering-standard-match-card"'),
    'Default Source and Default Price should live inside the Matched Products card'
  );
  assert.ok(
    engineeringTab.indexOf('id="engineering-standard-product-results"') > engineeringTab.indexOf('id="engineering-search-products-primary"')
      && engineeringTab.indexOf('id="engineering-standard-product-results"') < engineeringTab.indexOf('id="engineering-standard-list"'),
    'Matched Products should sit below Search Product and above the standard record list'
  );
  assert.equal(html.includes('id="engineering-cert-detail-modal"'), true, 'Missing engineering detail modal');
  assert.equal(html.includes('id="engineering-detail-product-search-modal"'), true, 'Missing engineering detail product search modal');
  assert.equal(html.includes('id="engineering-detail-product-search-category"'), true, 'Missing engineering detail product search category filter');
  assert.equal(html.includes('id="engineering-detail-product-search-group"'), true, 'Missing engineering detail product search group filter');
  assert.equal(html.includes('id="engineering-detail-product-search-criteria"'), true, 'Missing engineering detail product search criteria');
  assert.equal(html.includes('id="engineering-detail-product-search-results"'), true, 'Missing engineering detail product search results');
  [
    'id="engineering-architecture-class-modal"',
    'id="engineering-architecture-class-id"',
    'id="engineering-architecture-class-name"',
    'id="engineering-architecture-class-level-filters"',
    'id="engineering-architecture-class-category-filters"',
    'id="engineering-architecture-class-record-cards"',
    'id="engineering-architecture-class-save"'
  ].forEach((text) => {
    assert.equal(html.includes(text), true, `Missing Architecture Class modal UI: ${text}`);
  });

  ['A1', 'A2', 'B', 'C', 'D', 'E', 'Mandatory', 'Utility Preferred', 'International Finance Preferred', 'Optional', 'PV_MODULE', 'INVERTER', 'BATTERY'].forEach((text) => {
    assert.equal(engineeringTab.includes(text) || html.includes(text), true, `Missing engineering filter value: ${text}`);
  });

  assert.equal(catalog.some(record => record.id === 'PV-001' && record.sourceCategory === 'PV_MODULE'), true, 'Missing seeded PV certification record');
  assert.equal(catalog.some(record => record.id === 'INV-001' && record.sourceCategory === 'INVERTER'), true, 'Missing seeded inverter certification record');
  assert.equal(catalog.some(record => record.id === 'BESS-001' && record.sourceCategory === 'BATTERY'), true, 'Missing seeded battery/BESS certification record');

  [
    'let certificationRequirementsCatalog = []',
    'let productCertificationEvidence = []',
    'let productMasterDetailTemplates = []',
    'function normalizeProductMasterDetailTemplate',
    'function getProductMasterDetailTemplate',
    'function setEngineeringProductMasterMode',
    'function renderEngineeringProductMasterDetailMode',
    'function saveProductMasterDetailTemplate',
    'function resetProductMasterDetailFieldForm',
    'function beginProductMasterDetailTemplateFieldAdd',
    'function saveProductMasterDetailTemplateFieldForm',
    'function beginProductMasterDetailTemplateFieldEdit',
    'function nextProductMasterDetailCustomFieldKey',
    'function productMasterDetailTemplateFieldLabel',
    'function saveProductMasterDetailTemplateFieldLabel',
    'function productMasterDetailSafeDomId',
    'function productMasterDetailFieldValueOptions',
    'function productMasterDetailFieldDatalistId',
    'function renderProductMasterDetailHistoryInputControl',
    'function productModalHistoryTemplate',
    'function productModalHistoryChoices',
    'function renderProductModalHistoryInput',
    'function renderProductModalMasterDetailFields',
    'function renderProductMasterDetailBulkEditorControl',
    'function toggleProductMasterDetailBulkHistoryMenu',
    'function applyProductMasterDetailBulkHistoryValue',
    'function filterProductMasterDetailBulkHistoryValues',
    'function deleteProductMasterDetailBulkHistoryValue',
    'function openEngineeringDetailProductSearch',
    'function renderEngineeringDetailProductSearchCriteria',
    'function readEngineeringDetailProductSearchFilters',
    'function parseEngineeringDetailNumber',
    'function productMatchesEngineeringDetailFilters',
    'function searchEngineeringDetailProducts',
    'function renderEngineeringDetailProductSearchResults',
    'function closeEngineeringDetailProductSearch',
    'function runEngineeringQuoteAddCompletion',
    'function confirmEngineeringDetailSearchQuoteAdded',
    'function addEngineeringDetailSearchProductToQuote',
    'function deleteProductMasterDetailTemplateField',
    'function previewEngineeringProductMasterBulkSave',
    'function normalizeCertificationRequirement',
    'function certificationProductCategoryOptions',
    'function renderCertificationProductCategoryOptions',
    'function syncEngineeringRequirementEditorSourceCategory',
    'function syncEngineeringProductCategoryInput',
    'function readEngineeringDetailProductCategory',
    'function renderEngineeringWorkspace',
    'function setEngineeringCertificationEditMode',
    'function syncEngineeringCertificationEditChrome',
    'function renderEngineeringArchitectureClassOptions',
    'function addEngineeringArchitectureClass',
    'function nextEngineeringArchitectureClassId',
    'function openEngineeringArchitectureClassModal',
    'function renderEngineeringArchitectureClassModalFilters',
    'function renderEngineeringArchitectureClassRecordCards',
    'function selectedEngineeringArchitectureClassRecordIds',
    'function saveEngineeringArchitectureClassModal',
    'function closeEngineeringArchitectureClassModal',
    'function deleteEngineeringArchitectureClass',
    'function setEngineeringWorkspaceView',
    'function setEngineeringWorkspaceMode',
    'function renderEngineeringProductMasterWorkspace',
    'function engineeringProductMasterVisibleProducts',
    'function productMasterDetailGroupStatus',
    'function setEngineeringProductMasterFilter',
    'function pruneEngineeringStandardSelectionToRows',
    'function openEngineeringRequirementEditor',
    'function saveEngineeringRequirementEditor',
    'function deleteEngineeringRequirementRecord',
    'function searchEngineeringStandardProducts',
    'function renderEngineeringMatchedProductRows',
    'function refreshEngineeringProductResults',
    'function addEngineeringProductToQuote',
    'function getEngineeringRequirementLinkedProducts',
    'function canManageEngineeringRecord',
    'MINOVA_ENGINEERING_QUOTE_DEFAULTS_KEY',
    'MINOVA_ENGINEERING_CLASS_STORAGE_KEY',
    'recordIds',
    'PRODUCT_MASTER_DETAIL_HISTORY_HIDDEN_STORAGE_KEY',
    "getFifoBatchesForProduct(productId)[0]",
    "ids.every(id => selected.has(id))",
    "querySelectorAll('#engineering-standard-level-filters input[data-engineering-level]:checked')",
    "querySelectorAll('#engineering-standard-category-filters input[data-engineering-category]:checked')",
    'engineeringStandardSelectedIds.delete(id)',
    "const visibleIds = new Set(rows.map(record => String(record.id || '').trim()).filter(Boolean))",
    "document.getElementById('engineering-standard-search-filters')",
    "document.getElementById('engineering-architecture-class-edit-actions')",
    "document.getElementById('engineering-standard-match-card')",
    "document.getElementById('engineering-search-products-primary')",
    "classList.toggle('hidden', !inCertification || engineeringWorkspaceMode !== 'standard')",
    "summary?.classList.toggle('hidden', engineeringWorkspaceView !== 'certification')",
    "classList.toggle('hidden', inProductMaster)",
    "'px-4 py-2 rounded-lg text-xs font-black bg-purple-700 text-white shadow-sm'",
    'Unable to find products containing every selected standard record.',
    'nextCertificationCatalog.length || !certificationRequirementsCatalog.length',
    "const CERTIFICATION_PRODUCT_CATEGORY_DEFAULTS = {",
    'id="engineering-detail-product-category-select"',
    'id="engineering-detail-product-category-custom"',
    "BATTERY: ['Battery Pack / System', 'BMS', 'EMS', 'BESS PCS', 'BESS System']",
    "const sourceOptions = certificationProductCategoryOptions(source)",
    "nextCertificationRequirementIdForCategory(source)",
    "productCategory: readEngineeringDetailProductCategory()",
    'window.nextCertificationRequirementIdForCategory = nextCertificationRequirementIdForCategory',
    'window.syncEngineeringRequirementEditorSourceCategory = syncEngineeringRequirementEditorSourceCategory',
    'window.syncEngineeringProductCategoryInput = syncEngineeringProductCategoryInput',
    'value="__custom__"',
    "persistEntityToD1('certification_requirement'",
    "deleteEntityFromD1('certification_requirement'",
    "persistEntityToD1('product_certification_evidence'",
    "persistEntityToD1('product_master_detail_template'",
    "deleteEntityFromD1('product_master_detail_template'",
    "localStorage.setItem('minova_product_master_detail_templates_v1'",
    'Search Product',
    'data-engineering-detail-value-options',
    'return `<div class="relative min-w-[220px]">',
    'data-engineering-detail-history-target',
    'data-engineering-detail-history-menu',
    'data-engineering-detail-history-option',
    'data-engineering-detail-history-delete',
    'onclick="toggleProductMasterDetailBulkHistoryMenu(this)"',
    'onclick="applyProductMasterDetailBulkHistoryValue(this)"',
    'onclick="deleteProductMasterDetailBulkHistoryValue(this)"',
    "const onInputAttr = [hasHistoryChoices ? 'filterProductMasterDetailBulkHistoryValues(this)' : '', onInput].filter(Boolean).join('; ')",
    'title="Show history values"',
    'title="Delete history value"',
    'border-t-slate-700',
    'aria-hidden="true"',
    'data-engineering-detail-product-row',
    'data-engineering-detail-template-field',
    'Bulk Product Maintenance is editing',
    "productMasterDetailSafeDomId(`${template.id || 'template'}-${fieldKey}`)",
    "Array.from(new Set([...options, value].map",
    "querySelectorAll('#engineering-detail-template-bulk-list input[data-engineering-detail-product]')",
    'Product data will not be changed.',
    "valueText.includes(query)",
    "menu.classList.toggle('hidden', !(query && shown > 0))",
    "localStorage.setItem(PRODUCT_MASTER_DETAIL_HISTORY_HIDDEN_STORAGE_KEY",
    'renderEngineeringProductMasterDetailBulkList(template);',
    "input.dataset.engineeringDetailProduct",
    "input.dataset.engineeringDetailTemplateField || input.dataset.engineeringDetailField",
    ".filter(product => normalizeProductCategory(product.category, '') === template.category)",
    'Find products by selected detail fields, then add a match to Quotation Builder.',
    'Matched Products',
    'data-engineering-detail-search-field',
    'data-engineering-detail-search-kind="number"',
    'data-engineering-detail-search-min',
    'data-engineering-detail-search-max',
    'data-engineering-detail-search-value',
    "renderProductMasterDetailHistoryInputControl({",
    "data-engineering-detail-search-value=\"${safeKey}\"",
    "row.querySelectorAll('[data-engineering-detail-history-option]')",
    'data-product-modal-history-field',
    'renderProductModalHistoryInput({',
    "const sync = 'updateSubcatSuggestions(); window.renderProductModalSpecHistoryFields?.({ category: this.value }); updateProductPriceUnitNote(); renderProductModalMasterDetailFields(this.value, readProductMasterDataFromModal()); renderProductTechnicalFields(this.value); maybeFillProductCertificationDefaults()'",
    "id: 'm-category'",
    "id: 'm-scenario'",
    "id: 'm-spec'",
    "id: 'm-inverter-kw'",
    "id: 'm-battery-kwh'",
    "fieldKey: 'spec'",
    "fieldKey: 'inverterKw'",
    "fieldKey: 'batteryKwh'",
    "PRODUCT_MASTER_COMMON_FIELD_KEYS.map(key =>",
    'Search Products',
    'Add to Quotation Builder',
    "productMatchesEngineeringDetailFilters(product, template, filters)",
    "addEngineeringDetailSearchProductToQuote('${htmlSafe(product.id || '')}')",
    'Added to Quotation Builder. Open Quotation now?',
    '__engineeringQuoteAddAfterAdd',
    "const match = String(value ?? '').replace(/,/g, '').match(/-?\\d+(?:\\.\\d+)?/)",
    "if (min !== null && max !== null && min > max)",
    "return filters.every(filter =>",
    "filter.exact ? productText === target : productText.includes(target)",
    'function productMasterDetailGroupDefinition',
    'function normalizeProductMasterDetailGroupKey',
    'function productMasterDetailGroupSelectOptions',
    'Save to group',
    'Custom group name',
    'Save Field',
    'customDetail',
    "if (fieldKey.startsWith('customDetail')) return 'technicalSpecs'",
    'Save Name',
    'fieldLabels',
    'detailGroupLabel',
    'productMasterDetailTemplateFieldLabel(key, template)',
    "const fieldLabels = { ...(template.fieldLabels || {}) }",
    'minova-data/certifications/products/${pid}/${safeRecordId}/${file.name}'
  ].forEach((text) => {
    assert.equal(html.includes(text), true, `Missing engineering workspace behavior: ${text}`);
  });

  const standardSearch = html.match(/function searchEngineeringStandardProducts\(\) \{([\s\S]*?)\n\s*\}\n\s*window\.searchEngineeringStandardProducts/);
  assert.ok(standardSearch, 'Standard Search Product handler should exist');
  assert.equal(standardSearch[1].includes('openEngineeringStandardProductModal'), false, 'Standard Search Product should render inline results without opening a modal');

  const standardListRenderer = html.match(/function renderEngineeringStandardList\(rows = \[\]\) \{([\s\S]*?)\n\s*\}\n\s*function pruneEngineeringStandardSelectionToRows/);
  assert.ok(standardListRenderer, 'Standard record table renderer should exist');
  assert.match(standardListRenderer[1], /engineeringCertificationEditMode/, 'Standard record actions should depend on certification edit mode');
  assert.match(standardListRenderer[1], /openEngineeringRequirementEditor/, 'Standard record edit action should open the requirement editor in edit mode');

  const matrixListRenderer = html.match(/function renderEngineeringMatrixList\(rows = \[\]\) \{([\s\S]*?)\n\s*\}\n\s*function engineeringProductMasterFilterValue/);
  assert.ok(matrixListRenderer, 'Matrix record table renderer should exist');
  assert.match(matrixListRenderer[1], /engineeringCertificationEditMode/, 'Matrix record actions should depend on certification edit mode');
  assert.match(matrixListRenderer[1], /deleteEngineeringRequirementRecord/, 'Matrix record delete action should be available in edit mode');

  const classMatcher = html.match(/function engineeringRecordMatchesClass\(record, classId\) \{([\s\S]*?)\n\s*\}\n\s*function engineeringVisibleRecords/);
  assert.ok(classMatcher, 'Architecture Class matcher should exist');
  assert.match(classMatcher[1], /recordIds/, 'Custom Architecture Classes should match selected record IDs exactly');

  const addClassHandler = html.match(/function addEngineeringArchitectureClass\(\) \{([\s\S]*?)\n\s*\}\n\s*window\.addEngineeringArchitectureClass/);
  assert.ok(addClassHandler, 'Add Class handler should exist');
  assert.match(addClassHandler[1], /openEngineeringArchitectureClassModal/, 'Add Class should open the class builder modal instead of browser prompts');
  assert.equal(addClassHandler[1].includes('prompt('), false, 'Add Class should not use prompt dialogs');

  const detailSearchResults = html.match(/function renderEngineeringDetailProductSearchResults\(matches = \[\], template = engineeringDetailProductSearchTemplate\(\), filters = \[\]\) \{([\s\S]*?)\n\s*\}\n\s*window\.renderEngineeringDetailProductSearchResults/);
  assert.ok(detailSearchResults, 'Detail Search result renderer should exist');
  assert.match(detailSearchResults[1], /addEngineeringDetailSearchProductToQuote\('\$\{htmlSafe\(product\.id \|\| ''\)\}'\)/, 'Detail Search quote-add button should use the post-add open quotation prompt');
  assert.equal(detailSearchResults[1].includes("addEngineeringProductToQuote('${htmlSafe(product.id || '')}')"), false, 'Detail Search should not bypass the post-add prompt wrapper');

  const engineeringQuoteAdd = html.match(/function addEngineeringProductToQuote\(productId, options = \{\}\) \{([\s\S]*?)\n\s*\}\n\s*window\.addEngineeringProductToQuote/);
  assert.ok(engineeringQuoteAdd, 'Engineering quote-add handler should exist');
  assert.match(engineeringQuoteAdd[1], /afterAdd/, 'Engineering quote-add handler should accept an optional completion callback');
  assert.match(engineeringQuoteAdd[1], /confirm\('No stock is available\. Add this product from Price List instead\?'\)/, 'Inventory-first fallback should ask before using Price List');
  assert.match(engineeringQuoteAdd[1], /addFromPriceList\(defaults\.priceType\)/, 'Inventory-first fallback should reuse the selected default price type');
  assert.equal(engineeringQuoteAdd[1].includes('promptEngineeringPriceType'), false, 'Inventory-first fallback should use the Price List flow without the old price prompt');

  const fieldTemplateMarkup = engineeringTab.slice(
    engineeringTab.indexOf('<div class="text-sm font-black text-slate-700">Field Template</div>'),
    engineeringTab.indexOf('<div class="text-sm font-black text-slate-700">Bulk Product Maintenance</div>')
  );
  assert.equal(fieldTemplateMarkup.includes('Select existing field'), false, 'Field Template should not expose an existing-field picker');
  assert.equal(fieldTemplateMarkup.includes('Required'), false, 'Field Template should not expose required checkboxes');

  const fieldRenderer = html.match(/function renderEngineeringProductMasterDetailFields\(template\) \{([\s\S]*?)\n\s*\}\n\s*function productsForProductMasterDetailTemplate/);
  assert.ok(fieldRenderer, 'Field Template renderer should exist');
  assert.equal(fieldRenderer[1].includes('toggleProductMasterDetailTemplateRequired'), false, 'Field Template renderer should not wire required toggles');
  assert.equal(fieldRenderer[1].includes('masterData'), false, 'Field Template rows should not show internal masterData labels');
  assert.equal(fieldRenderer[1].includes('technicalSpecs'), false, 'Field Template rows should not show internal technicalSpecs labels');
  assert.match(fieldRenderer[1], /productMasterDetailGroupLabel\(template\.detailGroup\)/, 'Field Template rows should show the selected details group label');

  const templateNormalizer = html.match(/function normalizeProductMasterDetailTemplate\(record = \{\}\) \{([\s\S]*?)\n\s*\}\n\s*function normalizeProductMasterDetailTemplates/);
  assert.ok(templateNormalizer, 'Template normalizer should exist');
  assert.equal(templateNormalizer[1].includes("? record.detailGroup : 'basic'"), false, 'Custom detail groups should not normalize back to basic');
  assert.match(templateNormalizer[1], /normalizeProductMasterDetailGroupKey\(record\.detailGroup \|\| 'basic'\)/, 'Template normalizer should preserve normalized custom detail groups');

  assert.equal(html.includes('Enter an existing field key to add to this template'), false, 'Add Field should not use the old prompt flow');
  assert.equal(html.includes('Edit field key. Use an existing masterData or technicalSpecs key'), false, 'Edit Field should not use the old prompt flow');
  assert.equal(html.includes('Choose replacement field'), false, 'Edit Field should rename the field label instead of replacing the field key');
  assert.equal(html.includes('Save Edit'), false, 'Edit Field should expose Save Name instead of a generic replacement save');
  assert.equal(html.includes('Use Product Data'), false, 'Detail Search should not reuse product data into the bulk table');
  assert.equal(html.includes('applyEngineeringDetailProductSearchSelection'), false, 'Detail Search should remove the old product reuse copy flow');
  assert.equal(html.includes('Import Excel Preview'), false, 'Detail mode should not expose the Excel preview button');
  assert.equal(html.includes('id="engineering-detail-import-file"'), false, 'Detail mode should not keep the Excel preview file input');
  assert.equal(html.includes('xl:grid-cols-[0.9fr_1.5fr]'), false, 'Detail mode should stack Field Template above Bulk Product Maintenance to avoid squeezed controls');
  assert.equal(html.includes('No products loaded.'), false, 'Bulk Product Maintenance should not ship a stale static no-products placeholder');
  assert.equal(html.includes('<input type="text" id="m-spec"'), false, 'Specification should use the Product modal history input control');
  assert.equal(html.includes('<input type="number" id="m-inverter-kw"'), false, 'Hybrid inverter capacity should use the Product modal history input control');
  assert.equal(html.includes('<input type="number" id="m-battery-kwh"'), false, 'Hybrid battery capacity should use the Product modal history input control');
});

test('engineering product master detail mode keeps template state and import preview separate from product schema', () => {
  const state = embeddedState();
  const engineeringTab = mainSnippet('<main id="view-engineering"');

  assert.ok(Array.isArray(state.data.productMasterDetailTemplates), 'Embedded state should include productMasterDetailTemplates');
  [
    'Basic',
    'Electrical',
    'Mechanical',
    'Certification',
    'Commercial',
    'Documents',
    'CESC vertical key-value preview',
    'Midea model matrix preview',
    'Unmatched fields stay in preview',
    'No product fields are created automatically'
  ].forEach((text) => {
    assert.equal(engineeringTab.includes(text) || html.includes(text), true, `Missing Detail mode UX text: ${text}`);
  });
});

test('engineering permissions are enforced in UI and documented for future tabs', () => {
  const guide = readFileSync(new URL('../agents.md', import.meta.url), 'utf8');

  [
    "applyEngineeringPermissions()",
    "window.__minovaAuth?.canPerformAction?.('engineering', 'edit')",
    "window.__minovaAuth?.canPerformAction?.('engineering', 'delete')",
    "window.__minovaAuth?.canPerformAction?.('engineering', 'upload')",
    "window.__minovaAuth?.canPerformAction?.('quotes', 'edit')"
  ].forEach((text) => {
    assert.equal(html.includes(text), true, `Missing engineering permission guard: ${text}`);
  });

  assert.equal(guide.includes('新增顶层页面必须同步权限维护'), true, 'Agent guide should remember new tabs need savable role permissions');
});

test('product master v3 adds supply route fields without replacing canonical supplier', () => {
  const productModal = snippetBetween('<div id="modal"', '<div id="inventory-modal"');
  const script = snippetBetween('const PRODUCT_MASTER_TYPE_STORAGE_KEY', '// --- 批量导入逻辑 ---');

  [
    'Supply Route',
    'id="m-source-type"',
    'Direct Factory',
    'Authorized Distributor',
    'Dealer',
    'EPC Partner',
    'id="m-commercial-supplier-code"',
    'id="m-factory-supplier-code"',
    'id="m-brand-owner-supplier-code"',
    'id="m-authorization-status"',
    'id="m-authorization-expiry"',
    'id="m-source-remark"'
  ].forEach((text) => {
    assert.equal(productModal.includes(text), true, `Missing V3 supply route modal field: ${text}`);
  });

  [
    'function getProductSourcing(product = {})',
    'function readProductSourcingFromModal(canonicalSupplierCode = \'\')',
    'function fillProductSourcingDetails(product = {})',
    'sourcing: readProductSourcingFromModal(supplier.code)',
    'supplierCode: supplier.code',
    'vendor: getSupplierDisplayName(supplier)'
  ].forEach((text) => {
    assert.equal(script.includes(text), true, `Missing V3 sourcing save/load behavior: ${text}`);
  });
});

test('product master v3 exposes compatibility matrix workspace and state plumbing', () => {
  const databaseTab = mainSnippet('<main id="view-database"');
  const script = snippetBetween('const PRODUCT_MASTER_TYPE_STORAGE_KEY', '// --- Select器逻辑 ---');

  [
    'Compatibility Matrix',
    'id="compatibility-panel"',
    'id="compatibility-search"',
    'id="compatibility-relation-filter"',
    'id="compatibility-status-filter"',
    'id="compatibility-list"',
    'id="compatibility-modal"',
    'id="compat-relation-type"',
    'id="compat-source-product"',
    'id="compat-target-product"',
    'id="compat-status"'
  ].forEach((text) => {
    assert.equal(databaseTab.includes(text) || html.includes(text), true, `Missing V3 compatibility workspace UI: ${text}`);
  });

  [
    'let compatibilityRules = []',
    'localStorage.setItem(\'minova_compatibility_rules_v1\'',
    'compatibilityRules = normalizeCompatibilityRules(data?.compatibilityRules)',
    'function normalizeCompatibilityRule(rule = {})',
    'function getProductCompatibilitySummary(product)',
    'function openProductCompatibilityDetails(productId)',
    'function renderCompatibilityMatrix()',
    'function saveCompatibilityRule()',
    'persistEntityToD1(\'compatibility_rule\''
  ].forEach((text) => {
    assert.equal(script.includes(text) || html.includes(text), true, `Missing V3 compatibility state or behavior: ${text}`);
  });
});

test('product master v3 import export includes sourcing and compatibility matrix sheets', () => {
  [
    "'Source Type'",
    "'Commercial Supplier Code'",
    "'Factory Supplier Code'",
    "'Brand Owner Supplier Code'",
    "'Authorization Status'",
    "'Authorization Expiry'",
    "'Source Remark'",
    "'Compatibility Matrix'",
    "'Relation Type'",
    "'Source Product ID'",
    "'Target Product ID'",
    "importCompatibilityData",
    "processCompatibilityImport()",
    "XLSX.utils.book_append_sheet(workbook, compatibilityWorksheet, 'Compatibility Matrix')"
  ].forEach((text) => {
    assert.equal(html.includes(text), true, `Missing V3 import/export compatibility field: ${text}`);
  });
});

test('supplier master v4 exposes brand channel partners and a channel partner table', () => {
  const databaseTab = mainSnippet('<main id="view-database"');
  const supplierModal = snippetBetween('<div id="supplier-modal"', '<div id="modal"');
  const channelModal = snippetBetween('<div id="channel-partner-modal"', '<div id="modal"');

  [
    'Channel Partners',
    'id="channel-partner-panel"',
    'id="channel-partner-list"',
    'id="channel-partner-search"',
    'id="channel-partner-type-filter"',
    'id="channel-partner-brand-filter"'
  ].forEach((text) => {
    assert.equal(databaseTab.includes(text), true, `Missing V4 channel partner table UI: ${text}`);
  });

  [
    'Brand Channel Partners',
    'id="supplier-channel-partner-editor"',
    'addSupplierChannelPartnerDraft',
    'removeSupplierChannelPartnerDraft'
  ].forEach((text) => {
    assert.equal(supplierModal.includes(text) || html.includes(text), true, `Missing V4 supplier modal channel editor: ${text}`);
  });

  [
    'id="channel-partner-modal"',
    'id="channel-partner-brand-code"',
    'id="channel-partner-type"',
    'id="channel-partner-country"',
    'id="channel-partner-name"',
    'saveChannelPartner'
  ].forEach((text) => {
    assert.equal(channelModal.includes(text) || html.includes(text), true, `Missing V4 channel partner modal: ${text}`);
  });
});

test('product supply route v4 uses channel partner selection and direct factory simplified UI', () => {
  const productModal = snippetBetween('<div id="modal"', '<div id="inventory-modal"');
  const script = snippetBetween('const PRODUCT_MASTER_TYPE_STORAGE_KEY', '// --- 批量导入逻辑 ---');

  [
    'onchange="updateSupplyRouteVisibility()"',
    'id="m-channel-partner-wrap"',
    'id="m-channel-partner-id"',
    'id="m-commercial-supplier-wrap"',
    'id="m-factory-supplier-wrap"',
    'id="m-brand-owner-supplier-wrap"'
  ].forEach((text) => {
    assert.equal(productModal.includes(text), true, `Missing V4 supply route simplified UI: ${text}`);
  });

  [
    'function updateSupplyRouteVisibility()',
    'function updateProductChannelPartnerOptions()',
    'channelPartnerId',
    "if (sourceType === 'Direct Factory')",
    'getProductChannelPartner(product)'
  ].forEach((text) => {
    assert.equal(script.includes(text), true, `Missing V4 supply route channel logic: ${text}`);
  });
});

test('channel partners v4 are included in state d1 merge and export surfaces', () => {
  [
    'let channelPartners = []',
    'localStorage.setItem(\'minova_channel_partners_v1\'',
    'channelPartners = normalizeChannelPartners(data?.channelPartners)',
    'channelPartners,',
    "persistEntityToD1('channel_partner'",
    "'Channel Partners'",
    "'Channel Partner ID'",
    "'Brand Supplier Code'"
  ].forEach((text) => {
    assert.equal(html.includes(text), true, `Missing V4 channel partner state/export behavior: ${text}`);
  });
});

test('product import still accepts legacy Chinese column headers', () => {
  [
    "id: '产品编号'",
    "name: '产品全称'",
    "vendor: '供应商'",
    "certificationCountries: ['产品认证国家'",
    "certificationStandards: ['产品认证标准'"
  ].forEach((text) => {
    assert.equal(html.includes(text), true, `Missing legacy import compatibility text: ${text}`);
  });
});

test('product base prices support supplier-defaulted CNY and MYR currencies', () => {
  const productModal = snippetBetween('<div id="modal"', '<div id="inventory-modal"');
  const script = snippetBetween('function normalizeSupplierRecord', '// --- 批量导入逻辑 ---');

  [
    'id="m-price-currency"',
    'onchange="updateProductPriceCurrencyUi()"',
    'CNY ¥',
    'MYR RM',
    'Base Cost (<span id="m-cost-currency-label">¥</span>)',
    'Base Price (<span id="m-price-currency-label">¥</span>)'
  ].forEach((text) => {
    assert.equal(productModal.includes(text), true, `Product modal is missing currency UI: ${text}`);
  });

  [
    'function inferSupplierPriceCurrency',
    'function getProductCostCny',
    'function getProductPriceCny',
    "costCurrency: productCurrency",
    "priceCurrency: productCurrency",
    'updateProductCurrencyFromSupplier({ skipExisting: true })',
    "document.getElementById('m-price-currency').value = getProductCurrency(p, 'cost')",
    'getProductCostCny(p)'
  ].forEach((text) => {
    assert.equal(script.includes(text), true, `Product currency logic is missing: ${text}`);
  });

  assert.match(script, /getProductPriceCny\((p|product)\)/, 'Product renderer should read normalized product price values');
  assert.match(script, /china[\s\S]*CNY/i, 'Supplier country inference should default China suppliers to CNY');
  assert.match(script, /malaysia[\s\S]*MYR/i, 'Supplier country inference should default Malaysia suppliers to MYR');
});
