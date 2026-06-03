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
assert.match(html, /id="btn-installer-region-peninsular"/, 'quote settings expose a Peninsular Malaysia installer toggle');
assert.match(html, /id="btn-installer-region-sabahSarawak"/, 'quote settings expose a Sabah / Sarawak installer toggle');
assert.match(html, /openInstallModal\('peninsular'\)/, 'quotation builder can add Peninsular Malaysia installation work');
assert.match(html, /openInstallModal\('sabahSarawak'\)/, 'quotation builder can add Sabah / Sarawak installation work');

const sandbox = {
  window: {},
  console,
};
vm.createContext(sandbox);
vm.runInContext(`${modelMatch[1]}; window.__testInstallerModel = { normalizeInstallerQuoteSettings, computeInstallerCost };`, sandbox);

const { normalizeInstallerQuoteSettings, computeInstallerCost } = sandbox.window.__testInstallerModel;

test('computes RESI variable installation cost and additive installer profit', () => {
  const settings = normalizeInstallerQuoteSettings(null);
  const result = computeInstallerCost(11.7, 'home', settings, { cnPct: 5, myPct: 15 }, 1.72);

  assert.equal(result.baseMyr, 6435);
  assert.equal(result.finalMyr, 7722);
  assert.equal(result.finalCny, 13281.84);
  assert.equal(result.detail.map((item) => item.key).join(','), 'installation,frameMounting,cable');
});

test('does not add RESI fixed items when system size is above 15 kWp', () => {
  const settings = normalizeInstallerQuoteSettings(null);
  const result = computeInstallerCost(16, 'home', settings, { cnPct: 0, myPct: 0 }, 1.72);

  assert.equal(result.detail.some((item) => item.key === 'powerStudy'), false);
  assert.equal(result.baseMyr, 8800);
});

test('computes C&I cost from variable items only', () => {
  const settings = normalizeInstallerQuoteSettings(null);
  const result = computeInstallerCost(100, 'biz', settings, { cnPct: 0, myPct: 0 }, 1.72);

  assert.equal(result.detail.some((item) => item.key === 'powerStudy'), false);
  assert.equal(result.detail.some((item) => item.key === 'design'), false);
  assert.equal(result.detail.some((item) => item.key === 'db'), false);
  assert.equal(result.baseMyr, 55000);
});

test('keeps Peninsular Malaysia and Sabah / Sarawak installation fees separate', () => {
  const settings = normalizeInstallerQuoteSettings({
    regions: {
      peninsular: { installationRmPerKwp: 250, frameMountingRmPerKwp: 240, cableRmPerKwp: 60 },
      sabahSarawak: { installationRmPerKwp: 320, frameMountingRmPerKwp: 260, cableRmPerKwp: 90 },
    },
  });

  const west = computeInstallerCost(10, 'home', settings, { cnPct: 0, myPct: 0 }, 1.72, 'peninsular');
  const east = computeInstallerCost(10, 'home', settings, { cnPct: 0, myPct: 0 }, 1.72, 'sabahSarawak');

  assert.equal(west.region, 'peninsular');
  assert.equal(east.region, 'sabahSarawak');
  assert.equal(west.baseMyr, 5500);
  assert.equal(east.baseMyr, 6700);
  assert.equal(settings.installationRmPerKwp, 250);
});

test('migrates legacy installer fee fields into both regional fee sets', () => {
  const settings = normalizeInstallerQuoteSettings({
    installationRmPerKwp: 280,
    frameMountingRmPerKwp: 220,
    cableRmPerKwp: 70,
  });

  assert.deepEqual(JSON.parse(JSON.stringify(settings.regions.peninsular)), {
    installationRmPerKwp: 280,
    frameMountingRmPerKwp: 220,
    cableRmPerKwp: 70,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(settings.regions.sabahSarawak)), {
    installationRmPerKwp: 280,
    frameMountingRmPerKwp: 220,
    cableRmPerKwp: 70,
  });
});
