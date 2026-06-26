import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('quotation tools expose a price-list picker beside inventory picker', () => {
  assert.match(html, /From Inventory ↓/, 'inventory picker remains available');
  assert.match(html, /From Price List ↓/, 'price-list picker button is present');
  assert.match(html, /id="price-list-picker-list"/, 'price-list picker has its own list container');
  assert.match(html, /id="price-list-picker-country"/, 'price-list picker exposes supplier country filter');
});

test('quotation picker popovers are pinned by button clicks', () => {
  const toolbar = html.match(/<div class="no-print mt-6 flex gap-3">([\s\S]*?)<button id="btn-split"/);
  assert.ok(toolbar, 'quotation toolbar block is present');
  assert.match(toolbar[1], /data-quote-picker-trigger="inventory"[\s\S]*onclick="toggleQuotePickerMenu\('inventory', event\)"/, 'inventory picker trigger toggles by click');
  assert.match(toolbar[1], /data-quote-picker-trigger="price-list"[\s\S]*onclick="toggleQuotePickerMenu\('price-list', event\)"/, 'price-list picker trigger toggles by click');
  assert.match(toolbar[1], /data-quote-picker-trigger="installation"[\s\S]*onclick="toggleQuotePickerMenu\('installation', event\)"/, 'installation picker trigger toggles by click');
  assert.match(toolbar[1], /data-quote-picker-menu="inventory"/, 'inventory picker menu is addressable');
  assert.match(toolbar[1], /data-quote-picker-menu="price-list"/, 'price-list picker menu is addressable');
  assert.match(toolbar[1], /data-quote-picker-menu="installation"/, 'installation picker menu is addressable');
  assert.doesNotMatch(toolbar[1], /group-hover:block/, 'quotation picker menus do not depend on hover to stay open');
  assert.match(html, /window\.toggleQuotePickerMenu\s*=/, 'click toggle helper is exposed');
});

test('price-list picker is product-backed and not stock-gated', () => {
  const renderer = html.match(/window\.renderPriceListPicker\s*=\s*\(\)\s*=> \{([\s\S]*?)\n\s*\};/);
  assert.ok(renderer, 'price-list picker renderer is defined');
  assert.match(renderer[1], /products\.filter/, 'price-list picker reads product master data');
  assert.doesNotMatch(renderer[1], /quantity\s*>\s*0/, 'price-list picker does not require inventory quantity');
  assert.match(renderer[1], /Supplier Country:/, 'price-list picker displays supplier country or region');
  assert.match(renderer[1], /Delivery:/, 'price-list picker displays product delivery time');
});

test('price-list picker adds quote rows without an inventory id', () => {
  const addHelper = html.match(/function addPriceListProductToQuote\(productId,\s*priceType\) \{([\s\S]*?)\n\s*\}/);
  assert.ok(addHelper, 'price-list quote insertion helper is present');
  assert.match(addHelper[1], /productId/, 'helper stores the product id on the quote row');
  assert.match(html, /candidate\.inventoryId\s*=\s*''/, 'helper leaves reused rows without an inventory id');
  assert.match(html, /inventoryId:\s*''/, 'helper leaves inserted rows without an inventory id');
  assert.match(html, /window\.pickPriceListProduct\s*=/, 'price-list picker exposes a pick function');
});

test('price-list picker reuses the same pcs price strategy as Product Price List', () => {
  const helper = html.match(/function getPriceListProductPcsPricing\(product,\s*priceType\s*=\s*getPickerSelectedPriceType\(\)\) \{([\s\S]*?)\n\s*\}/);
  assert.ok(helper, 'price-list picker pricing helper is present');
  assert.match(helper[1], /priceListProductPricing\(p\)/, 'picker uses Product Price List pricing model');
  assert.match(helper[1], /getPickerSelectedPriceValue\(pricing,\s*priceType\)/, 'picker uses the selected clearance/grey and RESI/C&I price');
  assert.doesNotMatch(helper[1], /getProductPriceCny\(p\)\s*\*\s*pcsMultiplier/, 'picker must not bypass price-list pricing with base product price');
});
