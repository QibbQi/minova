import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('product, price, inventory, and non-stock tables expose column freeze controls', () => {
  [
    'product-list',
    'price-list',
    'inventory',
    'non-stock-pricing',
    'engineering-standard',
    'engineering-matrix',
    'engineering-product-master',
    'engineering-detail-bulk'
  ].forEach((tableKey) => {
    assert.match(html, new RegExp(`data-freeze-table="${tableKey}"`), `${tableKey} table is registered for frozen columns`);
    assert.match(html, new RegExp(`(?:cycleFrozenColumns\\('${tableKey}', 3\\)|renderFreezeColumnButton\\('${tableKey}', 3\\))`), `${tableKey} table header renders a freeze button`);
  });
  assert.match(html, /function renderFreezeColumnButton\(tableKey, maxColumns = 3\)/, 'dynamic table headers can render freeze buttons');
  assert.match(html, /class="flex flex-col items-start gap-1"/, 'freeze buttons sit below the first header label');
  const productMasterSection = html.match(/Product Master List[\s\S]*?<tbody id="db-list"/);
  assert.ok(productMasterSection, 'product master table section is present');
  assert.match(productMasterSection[0], /data-freeze-table="product-list"/, 'product list freeze registration is on Product Master List');
  assert.doesNotMatch(productMasterSection[0], /Sales Management/, 'product list freeze registration is not on Sales Management');
  assert.match(html, /window\.cycleFrozenColumns = \(tableKey, maxColumns = 3\) =>/, 'freeze button cycles selected frozen columns');
  assert.match(html, /window\.applyFrozenColumns = \(tableKey\) =>/, 'sticky column application helper exists');
  assert.match(html, /position = 'sticky'/, 'frozen columns use sticky positioning');
  assert.match(html, /localStorage\.setItem\('minova_frozen_table_columns_v1'/, 'freeze choices persist locally');
});

test('dynamic table renderers reapply frozen columns after rerendering rows', () => {
  [
    /window\.renderDb = \(\) => \{[\s\S]*?window\.applyFrozenColumns\('product-list'\);[\s\S]*?\n\s*\};/,
    /window\.renderPriceList = \(\) => \{[\s\S]*?window\.applyFrozenColumns\('price-list'\);[\s\S]*?\n\s*\};/,
    /window\.renderInventory = \(\) => \{[\s\S]*?window\.applyFrozenColumns\('inventory'\);[\s\S]*?\n\s*\};/,
    /window\.renderNonStockPricingStrategies = \(\) => \{[\s\S]*?window\.applyFrozenColumns\('non-stock-pricing'\);[\s\S]*?\n\s*\};/,
    /function renderEngineeringStandardList\(rows = \[\]\) \{[\s\S]*?window\.applyFrozenColumns\('engineering-standard'\);[\s\S]*?\n\s*\}/,
    /function renderEngineeringMatrixList\(rows = \[\]\) \{[\s\S]*?window\.applyFrozenColumns\('engineering-matrix'\);[\s\S]*?\n\s*\}/,
    /function renderEngineeringProductMasterWorkspace\(\) \{[\s\S]*?window\.applyFrozenColumns\('engineering-product-master'\);[\s\S]*?\n\s*\}/,
    /function renderEngineeringProductMasterDetailBulkList\(template\) \{[\s\S]*?window\.applyFrozenColumns\('engineering-detail-bulk'\);[\s\S]*?\n\s*\}/
  ].forEach((pattern) => assert.match(html, pattern));
});

test('price list hover tooltip is a compact market and quote comparison', () => {
  const tooltip = html.match(/window\.showPriceListTooltip = \(event, productId\) => \{([\s\S]*?)\n\s*\};/);
  assert.ok(tooltip, 'price list tooltip renderer exists');
  assert.match(tooltip[1], /renderPriceListTooltipComparison\(p, r, market\)/, 'tooltip delegates quote comparison rendering');
  assert.match(html, /function renderPriceListTooltipComparison\(product, pricing, market\)/, 'comparison renderer exists');
  assert.match(html, /30D Market/, 'tooltip keeps 30-day market context');
  assert.match(html, /Unit Price/, 'tooltip shows unit price labels');
  assert.match(html, /PCS Price/, 'tooltip shows pcs price labels');
  assert.match(html, /Clearance RESI/, 'tooltip compares Clearance RESI');
  assert.match(html, /Clearance C&I/, 'tooltip compares Clearance C&I');
  assert.match(html, /Grey RESI/, 'tooltip compares Grey RESI');
  assert.match(html, /Grey C&I/, 'tooltip compares Grey C&I');
  assert.match(html, /priceVarianceClass/, 'tooltip uses color-coded price variance');
  assert.match(tooltip[1], /tooltip\.style\.width = 'auto'/, 'tooltip width can adapt to content');
  assert.match(tooltip[1], /tooltip\.style\.maxWidth = `\$\{Math\.max\(320, Math\.min\(560, window\.innerWidth - 24\)\)\}px`/, 'tooltip max width adapts to viewport');
  assert.match(tooltip[1], /const shouldOpenUp = belowSpace < tooltipHeight \+ 18 && aboveSpace > belowSpace/, 'tooltip opens upward near the bottom edge');
  assert.doesNotMatch(tooltip[1], /Formula:/, 'tooltip no longer shows formula text');
  assert.doesNotMatch(tooltip[1], /Clearance Cost:/, 'tooltip no longer shows clearance cost calculation');
  assert.doesNotMatch(tooltip[1], /Grey Cost:/, 'tooltip no longer shows grey cost calculation');
  assert.doesNotMatch(tooltip[1], /Certifications:/, 'tooltip no longer shows certification details');
});

test('global market tooltip is cleared when quote rows or pages change', () => {
  assert.match(html, /<div id="global-tooltip"[^>]*hidden"[^>]*><\/div>/, 'global tooltip starts empty and hidden');
  assert.match(html, /window\.hideGlobalTooltip = \(\) => \{[\s\S]*?tooltip\.innerHTML = '';[\s\S]*?\};/, 'global tooltip clear helper hides and empties stale content');
  assert.match(html, /window\.hidePriceListTooltip = window\.hideGlobalTooltip;/, 'price-list and market hover use the same cleanup helper');
  assert.match(html, /window\.switchTab = \(tab\) => \{[\s\S]*?window\.hideGlobalTooltip\?\.\(\);/, 'switching pages clears any active tooltip');
  assert.match(html, /function renderQuote\(\) \{[\s\S]*?window\.hideGlobalTooltip\?\.\(\);/, 'rerendering quote rows clears any active tooltip');
  assert.match(html, /window\.removeRow = \(id\) => \{[\s\S]*?window\.hideGlobalTooltip\?\.\(\);/, 'deleting a quote row clears any active tooltip');
});
