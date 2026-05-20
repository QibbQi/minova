import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const modelMatch = html.match(/\/\/ INSTALLER_QUOTE_MODEL_START([\s\S]*?)\/\/ INSTALLER_QUOTE_MODEL_END/);

assert.ok(modelMatch, 'installer quote model block is present in index.html');
assert.match(html, /id="install-unit-price-myr"/, 'install modal exposes RM unit price');
assert.match(html, /id="install-subtotal-myr"/, 'install modal exposes RM subtotal');
assert.match(html, /id="install-qty-unit"/, 'install modal shows a quantity unit label');

const sandbox = {
  window: {},
  console,
};
vm.createContext(sandbox);
vm.runInContext(`${modelMatch[1]}; window.__testInstallerModel = { normalizeInstallerQuoteSettings, computeInstallerCost };`, sandbox);

const { normalizeInstallerQuoteSettings, computeInstallerCost } = sandbox.window.__testInstallerModel;

test('computes RESI Excel base cost and additive installer profit', () => {
  const settings = normalizeInstallerQuoteSettings(null);
  const result = computeInstallerCost(11.7, 'home', settings, { cnPct: 5, myPct: 15 }, 1.72);

  assert.equal(result.baseMyr, 13635);
  assert.equal(result.finalMyr, 16362);
  assert.equal(result.finalCny, 28142.64);
  assert.equal(result.detail.find((item) => item.key === 'powerStudy').amount, 0);
});

test('adds RESI power study when system size is above 15 kWp', () => {
  const settings = normalizeInstallerQuoteSettings(null);
  const result = computeInstallerCost(16, 'home', settings, { cnPct: 0, myPct: 0 }, 1.72);

  assert.equal(result.detail.find((item) => item.key === 'powerStudy').amount, 1000);
  assert.equal(result.baseMyr, 17000);
});

test('computes C&S tiered cost from Proposed System Size', () => {
  const settings = normalizeInstallerQuoteSettings(null);
  const result = computeInstallerCost(100, 'biz', settings, { cnPct: 0, myPct: 0 }, 1.72);

  assert.equal(result.detail.find((item) => item.key === 'powerStudy').amount, 5000);
  assert.equal(result.detail.find((item) => item.key === 'design').amount, 3600);
  assert.equal(result.detail.find((item) => item.key === 'db').amount, 10500);
  assert.equal(result.baseMyr, 76100);
});
