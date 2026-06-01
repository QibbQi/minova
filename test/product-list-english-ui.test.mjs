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
    'getProductPriceCny(p)',
    'getProductCostCny(p)'
  ].forEach((text) => {
    assert.equal(script.includes(text), true, `Product currency logic is missing: ${text}`);
  });

  assert.match(script, /china[\s\S]*CNY/i, 'Supplier country inference should default China suppliers to CNY');
  assert.match(script, /malaysia[\s\S]*MYR/i, 'Supplier country inference should default Malaysia suppliers to MYR');
});
