import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing helper: ${name}`);
  let depth = 0;
  let bodyStarted = false;
  for (let i = start; i < html.length; i += 1) {
    const ch = html[i];
    if (ch === '{') {
      depth += 1;
      bodyStarted = true;
    } else if (ch === '}') {
      depth -= 1;
      if (bodyStarted && depth === 0) return html.slice(start, i + 1);
    }
  }
  assert.fail(`could not extract helper: ${name}`);
}

function loadPricingHelpers() {
  const source = [
    extractFunction('normalizePricingUnit'),
    extractFunction('inferProductPricingUnit'),
    extractFunction('inferProductUnitQtyPerPcs'),
    extractFunction('getProductPricingMeta')
  ].join('\n');
  const context = {
    normalizeUnitLabel(unit) {
      const raw = String(unit || '').trim();
      if (!raw || raw === '个') return 'pcs';
      if (['pc', 'piece', 'pieces'].includes(raw.toLowerCase())) return 'pcs';
      if (raw === '套' || raw.toLowerCase() === 'set') return 'set';
      return raw;
    },
    normalizeProductCategory(category) {
      return String(category || '').trim();
    },
    getMarketCategoryUnitMeta(category) {
      const units = {
        'PV Module': 'W',
        Inverter: 'kW',
        Battery: 'kWh',
        Accessory: 'pcs',
        'All-in-One System': 'set',
        'C&I Storage': 'kWh'
      };
      return { unit: units[String(category || '').trim()] || 'pcs', source: 'auto', updatedAt: 1 };
    }
  };
  vm.runInNewContext(`${source}\nglobalThis.__helpers = { normalizePricingUnit, inferProductPricingUnit, inferProductUnitQtyPerPcs, getProductPricingMeta };`, context);
  return context.__helpers;
}

test('pricing metadata infers industry units and pcs multipliers from existing products', () => {
  const { getProductPricingMeta } = loadPricingHelpers();
  const plain = value => JSON.parse(JSON.stringify(value));

  assert.deepEqual(plain(getProductPricingMeta({ category: 'PV Module', spec: '610W' })), {
    priceBasisUnit: 'W',
    unitQtyPerPcs: 610,
    source: 'inferred',
    label: '610 W/pcs'
  });
  assert.deepEqual(plain(getProductPricingMeta({ category: 'Inverter', spec: '25kW' })), {
    priceBasisUnit: 'kW',
    unitQtyPerPcs: 25,
    source: 'inferred',
    label: '25 kW/pcs'
  });
  assert.deepEqual(plain(getProductPricingMeta({ category: 'Battery', spec: '5kWh' })), {
    priceBasisUnit: 'kWh',
    unitQtyPerPcs: 5,
    source: 'inferred',
    label: '5 kWh/pcs'
  });
  assert.deepEqual(plain(getProductPricingMeta({ category: 'Accessory', spec: 'pcs' })), {
    priceBasisUnit: 'pcs',
    unitQtyPerPcs: 1,
    source: 'inferred',
    label: '1 pcs/pcs'
  });
});

test('explicit product pricing fields override category and parsed spec defaults', () => {
  const { getProductPricingMeta } = loadPricingHelpers();
  const plain = value => JSON.parse(JSON.stringify(value));
  assert.deepEqual(
    plain(getProductPricingMeta({ category: 'PV Module', spec: '610W', priceBasisUnit: 'kW', unitQtyPerPcs: 0.61 })),
    {
      priceBasisUnit: 'kW',
      unitQtyPerPcs: 0.61,
      source: 'explicit',
      label: '0.61 kW/pcs'
    }
  );
});

test('price list and quotation pickers use product pricing metadata for pcs conversion', () => {
  const priceList = html.match(/function priceListProductPricing\(product\) \{([\s\S]*?)\n\s*\}/);
  const invPicker = html.match(/function getPickerInventoryPcsPricing\(item,\s*product,\s*priceType\s*=\s*getPickerSelectedPriceType\(\)\) \{([\s\S]*?)\n\s*\}/);
  const productPicker = html.match(/function getPriceListProductPcsPricing\(product,\s*priceType\s*=\s*getPickerSelectedPriceType\(\)\) \{([\s\S]*?)\n\s*\}/);
  assert.ok(priceList, 'price list pricing helper is present');
  assert.ok(invPicker, 'inventory picker pricing helper is present');
  assert.ok(productPicker, 'price-list picker pricing helper is present');
  assert.match(priceList[1], /getProductPricingMeta\(p,\s*batches\[0\]\)/, 'price list pricing reads product pricing metadata');
  assert.match(invPicker[1], /getProductPricingMeta\(p,\s*item\)/, 'inventory picker reads product pricing metadata');
  assert.match(productPicker[1], /getProductPricingMeta\(p\)/, 'price-list picker reads product pricing metadata');
});

test('product modal and import/export expose pricing unit fields', () => {
  assert.match(html, /id="m-price-basis-unit"/, 'product modal exposes price basis unit');
  assert.match(html, /id="m-unit-qty-per-pcs"/, 'product modal exposes qty per pcs');
  assert.match(html, /priceBasisUnit:\s*normalizePricingUnit/, 'saveProduct persists priceBasisUnit');
  assert.match(html, /unitQtyPerPcs:\s*parseFloat\(document\.getElementById\('m-unit-qty-per-pcs'\)/, 'saveProduct persists unitQtyPerPcs');
  assert.match(html, /priceBasisUnit:\s*\['计价单位'/, 'import aliases include price basis unit');
  assert.match(html, /'Price Basis Unit'/, 'export template includes price basis unit');
  assert.match(html, /'Qty per PCS'/, 'export template includes qty per pcs');
});
