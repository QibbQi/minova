import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const mergeSource = fs.readFileSync(new URL('../github-sync/merge.js', import.meta.url), 'utf8');

test('inventory management exposes a non-stock pricing strategy table', () => {
  assert.match(html, /Non-Stock Product Pricing Strategy/, 'inventory page includes the non-stock strategy section');
  assert.match(html, /id="non-stock-pricing-list"/, 'non-stock strategy table body is present');
  assert.match(html, /renderNonStockPricingStrategies/, 'renderer is wired for the non-stock strategy table');
  assert.match(html, /saveNonStockPricingStrategy/, 'inline save handler is available');
});

test('non-stock pricing strategy persists in app state and sync merge', () => {
  [
    'let nonStockPricingStrategies = {}',
    'minova_non_stock_pricing_v1',
    'normalizeNonStockPricingStrategies',
    'nonStockPricingStrategies'
  ].forEach((snippet) => {
    assert.match(html, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing state snippet: ${snippet}`);
  });
  assert.match(mergeSource, /nonStockPricingStrategies:\s*\{\s*\.\.\.\(rData\.nonStockPricingStrategies/, 'merge keeps non-stock pricing strategies');
});

test('price list pricing reads non-stock strategy only when inventory average is unavailable', () => {
  const pricing = html.match(/function priceListProductPricing\(product\) \{([\s\S]*?)\n\s*\}/);
  assert.ok(pricing, 'price list pricing helper is present');
  assert.match(pricing[1], /getNonStockPricingStrategy\(p\.id\)/, 'price list reads per-product non-stock strategy');
  assert.match(pricing[1], /inventoryAvg > 0/, 'inventory average remains the preferred cost source');
  assert.match(pricing[1], /strategy\.avgCostOverride/, 'non-stock average cost override is applied as fallback');
});
