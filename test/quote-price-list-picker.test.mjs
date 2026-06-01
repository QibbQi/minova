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
