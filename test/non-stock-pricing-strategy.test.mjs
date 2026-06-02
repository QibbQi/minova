import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const mergeSource = fs.readFileSync(new URL('../github-sync/merge.js', import.meta.url), 'utf8');

test('inventory management exposes a non-stock pricing strategy table', () => {
  assert.match(html, /Non-Stock Product Pricing Strategy/, 'inventory page includes the non-stock strategy section');
  assert.match(html, /id="non-stock-pricing-list"/, 'non-stock strategy table body is present');
  assert.match(html, /id="non-stock-currency-toggle"/, 'non-stock strategy table has a currency toggle');
  assert.match(html, /id="non-stock-target-home"/, 'non-stock strategy table has a RESI display toggle');
  assert.match(html, /id="non-stock-target-biz"/, 'non-stock strategy table has a C&I display toggle');
  assert.match(html, /non-stock-purchase-\$\{sid\}/, 'non-stock strategy captures expected purchase price');
  assert.match(html, /non-stock-shipping-\$\{sid\}/, 'non-stock strategy captures expected freight rate');
  assert.match(html, /non-stock-domestic-\$\{sid\}/, 'non-stock strategy captures expected domestic tax rate');
  assert.match(html, /renderNonStockPricingStrategies/, 'renderer is wired for the non-stock strategy table');
  assert.match(html, /saveNonStockPricingStrategy/, 'inline save handler is available');
});

test('inventory and non-stock tables share live FX currency display controls', () => {
  assert.match(html, /id="inventory-currency-toggle"/, 'inventory table has a currency toggle');
  assert.match(html, /window\.toggleInventoryCurrency/, 'inventory currency toggle is wired');
  assert.match(html, /window\.toggleNonStockCurrency/, 'non-stock currency toggle is wired');
  assert.match(html, /formatInventoryAmount\(purchaseTotal, 2\)/, 'inventory purchase totals use live FX display formatting');
  assert.match(html, /formatNonStockAmount\(pricing\.avgCost \|\| 0, 4, unit\)/, 'non-stock expected average cost uses live FX display formatting');
  assert.match(html, /oninput="window\.refreshFxDependentPricingViews\(\)"/, 'manual live FX edits refresh dependent pricing views');
  assert.match(html, /window\.refreshFxDependentPricingViews\(\); \} \}/, 'fetched live FX refreshes dependent pricing views');
  assert.match(html, /window\.refreshFxDependentPricingViews/, 'shared FX refresh helper exists');
});

test('non-stock strategy shows RESI and C&I profit split by company', () => {
  assert.match(html, /window\.setNonStockProfitTarget/, 'non-stock strategy can switch RESI and C&I display target');
  assert.match(html, /window\.renderNonStockProfitSplitCell = renderNonStockProfitSplitCell/, 'non-stock profit split helper is exposed for module-safe rendering checks');
  assert.match(html, /renderNonStockProfitSplitCell\(pricing, 'cn'\)/, 'non-stock strategy renders CN parent profit split');
  assert.match(html, /renderNonStockProfitSplitCell\(pricing, 'my'\)/, 'non-stock strategy renders Malaysia subsidiary profit split');
  assert.match(html, /pricing\.cnBizPct : pricing\.cnHomePct/, 'CN profit split follows selected RESI or C&I margin');
  assert.match(html, /pricing\.myBizPct : pricing\.myHomePct/, 'Malaysia profit split follows selected RESI or C&I margin');
});

test('non-stock strategy columns follow formula calculation order', () => {
  const section = html.match(/Non-Stock Product Pricing Strategy[\s\S]*?<tbody id="non-stock-pricing-list"/);
  assert.ok(section, 'non-stock table section is present');
  const ordered = [
    'Base Cost',
    'Purchase Price',
    'Qty/PCS',
    'PCS Purchase Price',
    'Freight %',
    'Domestic Tax %',
    'Expected Avg Cost',
    'Expected PCS Cost',
    'Duty %',
    'SST %',
    'Grey %',
    'Tariff Fee',
    'CN Parent Profit',
    'Malaysia Profit',
    'Clearance PCS',
    'Grey PCS'
  ];
  let pos = -1;
  for (const label of ordered) {
    const next = section[0].indexOf(label);
    assert.ok(next > pos, `${label} should appear after the previous formula column`);
    pos = next;
  }
});

test('non-stock strategy exposes per-pcs expected cost and tariff fee formulas', () => {
  assert.match(html, /const expectedPcsCost = \(pricing\.avgCost \|\| 0\) \* \(pricing\.pcsMultiplier \|\| 1\)/, 'expected pcs cost multiplies expected average cost by pcs multiplier');
  assert.match(html, /const clearanceTariffFee = expectedPcsCost \* \(\(pricing\.dutyPct \|\| 0\) \+ \(pricing\.sstPct \|\| 0\)\) \/ 100/, 'clearance tariff fee uses duty plus SST');
  assert.match(html, /const greyTariffFee = expectedPcsCost \* \(\(pricing\.grayPct \|\| 0\) \/ 100\)/, 'grey tariff fee uses grey percentage');
  assert.match(html, /formatNonStockAmount\(expectedPcsCost, 2, 'pcs'\)/, 'expected pcs cost is displayed per pcs');
  assert.match(html, /formatNonStockAmount\(clearanceTariffFee, 2, 'pcs'\)/, 'clearance tariff fee is displayed per pcs');
  assert.match(html, /formatNonStockAmount\(greyTariffFee, 2, 'pcs'\)/, 'grey tariff fee is displayed per pcs');
});

test('non-stock pricing strategy persists in app state and sync merge', () => {
  [
    'let nonStockPricingStrategies = {}',
    'minova_non_stock_pricing_v1',
    'normalizeNonStockPricingStrategies',
    'nonStockPricingStrategies',
    'purchasePrice',
    'shippingRatePct',
    'domesticTaxRatePct'
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
  assert.match(pricing[1], /strategy\.purchasePrice/, 'non-stock expected purchase price is applied as fallback');
  assert.match(pricing[1], /strategy\.shippingRatePct/, 'non-stock expected freight rate is applied as fallback');
  assert.match(pricing[1], /strategy\.domesticTaxRatePct/, 'non-stock expected domestic tax rate is applied as fallback');
  assert.match(pricing[1], /basePurchaseCost \+ expectedFreightCost \+ expectedDomesticTaxCost/, 'non-stock fallback uses landed average cost before pricing');
});
