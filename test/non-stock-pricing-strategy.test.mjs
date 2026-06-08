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
  assert.match(html, /id="non-stock-purchase-price-head"/, 'purchase price header can show the active currency');
  assert.match(html, /non-stock-purchase-\$\{sid\}/, 'non-stock strategy captures expected purchase price');
  assert.match(html, /non-stock-shipping-\$\{sid\}/, 'non-stock strategy captures expected freight rate');
  assert.match(html, /non-stock-domestic-\$\{sid\}/, 'non-stock strategy captures expected domestic tax rate');
  assert.match(html, /renderNonStockPricingStrategies/, 'renderer is wired for the non-stock strategy table');
  assert.match(html, /saveNonStockPricingStrategy/, 'inline save handler is available');
});

test('inventory and non-stock tables share live FX currency display controls', () => {
  assert.match(html, /id="inventory-rate-myr-cny"/, 'inventory page exposes its own live FX rate input');
  assert.match(html, /Live FX Rate \(MYR to CNY\)/, 'inventory page labels the page-level live FX rate');
  const inventorySection = html.match(/<main id="view-inventory"[\s\S]*?<main id="view-transport"/);
  assert.ok(inventorySection, 'inventory view section is present');
  assert.match(inventorySection[0], /id="inventory-rate-myr-cny"/, 'inventory FX rate input is inside the inventory view');
  assert.match(inventorySection[0], /id="inventory-sync-quote-fx"/, 'inventory FX refresh button has a stable hook');
  assert.match(inventorySection[0], /Sync Quote FX/, 'inventory FX sync button is inside the inventory view');
  assert.match(inventorySection[0], /onclick="window\.refreshInventoryLiveFx\(\{ render: true, btn: this \}\)"/, 'inventory FX button fetches a live rate directly');
  assert.match(html, /id="inventory-currency-toggle"/, 'inventory table has a currency toggle');
  assert.match(html, /window\.toggleInventoryCurrency/, 'inventory currency toggle is wired');
  assert.match(html, /onclick="window\.toggleInventoryCurrency\(\)"/, 'inventory currency button calls the module-safe global');
  assert.match(html, /window\.toggleNonStockCurrency/, 'non-stock currency toggle is wired');
  assert.match(html, /function getInventoryFxRateCnyPerMyr\(\)/, 'inventory page has a dedicated FX getter');
  assert.match(html, /formatAmountFromCnyForTable\(valueCny, getInventoryDisplayCurrency\(\), digits, unit, getInventoryFxRateCnyPerMyr\(\)\)/, 'inventory amounts use the page FX rate');
  assert.match(html, /formatAmountFromCnyForTable\(valueCny, getNonStockDisplayCurrency\(\), digits, unit, getInventoryFxRateCnyPerMyr\(\)\)/, 'non-stock amounts use the inventory page FX rate');
  assert.match(html, /formatInventoryAmount\(purchaseTotal, 2\)/, 'inventory purchase totals use live FX display formatting');
  assert.match(html, /formatNonStockAmount\(pricing\.avgCost \|\| 0, 4, unit\)/, 'non-stock expected average cost uses live FX display formatting');
  assert.match(html, /nonStockDisplayFromCny\(purchaseCnyValue\)/, 'purchase price input displays the active currency amount');
  assert.match(html, /nonStockCnyFromDisplay\(purchaseDisplay\)/, 'purchase price saves back to CNY');
  assert.match(html, /oninput="window\.refreshInventoryFxDependentViews\(\)"/, 'manual inventory FX edits refresh inventory page pricing views');
  assert.match(html, /onchange="window\.refreshInventoryFxDependentViews\(\)"/, 'committed inventory FX edits refresh inventory page pricing views');
  assert.match(html, /window\.refreshInventoryLiveFx\?\.\(\{ render: true \}\)/, 'opening the inventory tab fetches a fresh live FX rate for the page');
  assert.match(html, /window\.refreshInventoryLiveFx = async/, 'inventory page has a dedicated live FX refresh helper');
  assert.match(html, /window\.applyInventoryFxRate/, 'inventory page applies fetched FX rates to page and Quote Settings controls');
  assert.match(html, /window\.syncInventoryFxRateFromQuoteSettings/, 'inventory page keeps a Quote Settings FX fallback');
});

test('non-stock FX refresh preserves current table values before rerendering', () => {
  assert.match(html, /function captureNonStockPricingDraftsFromDom\(\)/, 'non-stock table can capture current editable values before rerendering');
  assert.match(html, /window\.__nonStockRenderedRateCnyPerMyr/, 'non-stock table records the rate used for the current render');
  assert.match(html, /window\.__nonStockRenderedCurrency/, 'non-stock table records the currency used for the current render');
  assert.match(html, /nonStockCnyFromDisplay\(purchaseDisplay, renderedCurrency, renderedRate\)/, 'purchase price draft converts using the prior rendered rate');
  assert.match(html, /captureNonStockPricingDraftsFromDom\(\);\s*window\.nonStockDisplayCurrency/, 'currency toggle captures drafts before changing display currency');
  assert.match(html, /window\.refreshInventoryFxDependentViews = \(\) => \{\s*captureNonStockPricingDraftsFromDom\(\);/, 'inventory FX refresh captures drafts before rerendering dependent views');
  assert.match(html, /const strategy = draftStrategies\[p\.id\]/, 'renderer prefers captured drafts during live FX refresh');
});

test('non-stock purchase price is maintainable with update time', () => {
  assert.match(html, /Price Updated/, 'non-stock table shows purchase price maintenance time');
  assert.match(html, /formatNonStockPriceUpdatedAt\(strategy\.updatedAt\)/, 'non-stock rows render strategy update time');
  assert.match(html, /updatedAt: new Date\(\)\.toISOString\(\)/, 'saving non-stock strategy records the maintenance time');
});

test('non-stock strategy shows RESI and C&I profit split by company', () => {
  assert.match(html, /window\.setNonStockProfitTarget/, 'non-stock strategy can switch RESI and C&I display target');
  assert.match(html, /window\.renderNonStockProfitSplitCell = renderNonStockProfitSplitCell/, 'non-stock profit split helper is exposed for module-safe rendering checks');
  assert.match(html, /renderNonStockProfitSplitCell\(pricing, 'cn'\)/, 'non-stock strategy renders CN parent profit split');
  assert.match(html, /renderNonStockProfitSplitCell\(pricing, 'my'\)/, 'non-stock strategy renders subsidiary profit split');
  assert.match(html, /pricing\.cnBizPct : pricing\.cnHomePct/, 'CN profit split follows selected RESI or C&I margin');
  assert.match(html, /pricing\.subsidiaryBizPct/, 'subsidiary profit split follows selected C&I margin');
  assert.match(html, /pricing\.subsidiaryHomePct/, 'subsidiary profit split follows selected RESI margin');
});

test('company margin formulas include every current subsidiary', () => {
  assert.match(html, /if \(!seenCompanyIds\.has\('cn_parent'\)\)/, 'CN Parent Company is restored when missing from saved settings');
  assert.match(html, /locked: id === 'cn_parent'/, 'CN Parent Company is mandatory and locked');
  assert.match(html, /const homeProfitBreakdown = getProfitPctBreakdown\('home', cat, sub\)/, 'inventory pricing reads all RESI company margins');
  assert.match(html, /const bizProfitBreakdown = getProfitPctBreakdown\('biz', cat, sub\)/, 'inventory pricing reads all C&I company margins');
  assert.match(html, /const homeMul = 1 \+ homeProfitPct \/ 100/, 'RESI price multiplier uses the dynamic company total');
  assert.match(html, /const bizMul = 1 \+ bizProfitPct \/ 100/, 'C&I price multiplier uses the dynamic company total');
  assert.match(html, /filter\(row => row\.id !== 'cn_parent'\)/, 'subsidiary display totals every non-CN company');
});

test('non-stock strategy columns follow formula calculation order', () => {
  const section = html.match(/Non-Stock Product Pricing Strategy[\s\S]*?<tbody id="non-stock-pricing-list"/);
  assert.ok(section, 'non-stock table section is present');
  const ordered = [
    'Source Type',
    'Unit',
    'Base Cost',
    'Purchase Price',
    'Price Updated',
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
    'Subsidiary Profit',
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

test('authorized distributor non-stock rows show source type and default all tax percentages to zero', () => {
  const section = html.match(/Non-Stock Product Pricing Strategy[\s\S]*?<tbody id="non-stock-pricing-list"/);
  assert.ok(section, 'non-stock table section is present');
  assert.ok(section[0].indexOf('Source Type') > section[0].indexOf('Category'), 'Source Type should appear after Category');
  assert.ok(section[0].indexOf('Unit') > section[0].indexOf('Source Type'), 'Unit should appear after Source Type');

  assert.match(html, /function getProductSourceTypeLabel\(product\)/, 'non-stock table uses a product source type label helper');
  assert.match(html, /getProductSourceTypeLabel\(p\)/, 'non-stock rows render the product source type');
  assert.match(html, /if \(getProductSourceTypeLabel\(product\) === 'Authorized Distributor'\) \{\s*return \{ shippingRatePct: 0, domesticTaxRatePct: 0, dutyPct: 0, sstPct: 0, grayPct: 0 \};\s*\}/, 'authorized distributor defaults all non-stock tax percentages to zero');
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
