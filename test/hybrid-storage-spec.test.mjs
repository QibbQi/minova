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

function loadHybridHelpers() {
  const source = [
    extractFunction('isHybridStorageCategory'),
    extractFunction('formatCapacityValue'),
    extractFunction('parseHybridStorageSpec'),
    extractFunction('formatHybridStorageSpec'),
    extractFunction('getProductDisplaySpec')
  ].join('\n');
  const context = {
    normalizeProductCategory(category) {
      return String(category || '').trim();
    }
  };
  vm.runInNewContext(`${source}\nglobalThis.__helpers = { isHybridStorageCategory, parseHybridStorageSpec, formatHybridStorageSpec, getProductDisplaySpec };`, context);
  return context.__helpers;
}

test('hybrid storage specs split inverter kW and battery kWh from old combined spec', () => {
  const { parseHybridStorageSpec, formatHybridStorageSpec, getProductDisplaySpec } = loadHybridHelpers();
  assert.deepEqual(JSON.parse(JSON.stringify(parseHybridStorageSpec('5.5kW-10kWh'))), {
    inverterKw: 5.5,
    batteryKwh: 10
  });
  assert.equal(formatHybridStorageSpec({ inverterKw: 125, batteryKwh: 261 }), '125 kW / 261 kWh');
  assert.equal(getProductDisplaySpec({ category: 'All-in-One System', spec: '5.5kW-10kWh' }), '5.5 kW / 10 kWh');
  assert.equal(getProductDisplaySpec({ category: 'C&I Storage', spec: '125kW-261kWh' }), '125 kW / 261 kWh');
  assert.equal(getProductDisplaySpec({ category: 'PV Module', spec: '610W' }), '610W');
});

test('product modal and import/export expose separate hybrid storage inputs', () => {
  assert.match(html, /id="m-inverter-kw"/, 'product modal exposes inverter capacity');
  assert.match(html, /id="m-battery-kwh"/, 'product modal exposes battery capacity');
  assert.match(html, /inverterKw:\s*hybrid \?/, 'saveProduct persists inverterKw for hybrid categories');
  assert.match(html, /batteryKwh:\s*hybrid \?/, 'saveProduct persists batteryKwh for hybrid categories');
  assert.match(html, /inverterKw:\s*\['逆变器kW'/, 'import aliases include inverter kW');
  assert.match(html, /batteryKwh:\s*\['电池kWh'/, 'import aliases include battery kWh');
  assert.match(html, /'Inverter kW'/, 'export template includes inverter kW');
  assert.match(html, /'Battery kWh'/, 'export template includes battery kWh');
});

test('quotation insertion uses display spec with slash formatting', () => {
  assert.match(html, /candidate\.spec = getProductDisplaySpec\(p\) \|\| '';/, 'inventory picker fills candidate quote spec from display spec');
  assert.match(html, /spec: getProductDisplaySpec\(p\) \|\| ''/, 'new quote rows use display spec');
  assert.doesNotMatch(html, /candidate\.spec = p\.spec \|\| '';/, 'quote picker no longer writes raw product spec');
});
