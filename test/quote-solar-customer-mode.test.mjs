import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('solar calculation inputs expose a snapshot-friendly RESI/C&S mode toggle', () => {
  assert.match(html, /id="quote-solar-customer-mode"/, 'hidden solar customer mode field is present');
  assert.match(html, /id="quote-solar-customer-home"/, 'RESI solar mode button is present');
  assert.match(html, /id="quote-solar-customer-biz"/, 'C&S solar mode button is present');
  assert.match(html, /setQuoteSolarCustomerMode\('home'\)/, 'RESI button wires to solar mode helper');
  assert.match(html, /setQuoteSolarCustomerMode\('biz'\)/, 'C&S button wires to solar mode helper');
});

test('solar customer mode has helpers and does not drive installer formulas', () => {
  assert.match(html, /function getQuoteSolarCustomerMode\(/, 'solar customer getter is defined');
  assert.match(html, /window\.setQuoteSolarCustomerMode\s*=/, 'solar customer setter is exposed');
  assert.match(html, /function renderQuoteSolarCustomerMode\(/, 'solar customer renderer is defined');
  assert.match(html, /function syncPickerCustomerModeToQuoteSolar\(/, 'picker sync helper is defined');

  const installerScenario = html.match(/function getInstallerScenario\(\) \{([\s\S]*?)\n\s*\}/);
  assert.ok(installerScenario, 'installer scenario helper is present');
  assert.doesNotMatch(installerScenario[1], /pickerCustomerMode|getPickerCustomerMode|quote-solar-customer/i);
  assert.match(installerScenario[1], /return 'home'/, 'installer scenario remains RESI-only for now');
});

test('picker customer mode asks before diverging from the solar mode', () => {
  const pickerSetter = html.match(/window\.setPickerCustomerMode\s*=\s*\(mode,\s*opts\s*=\s*\{\}\)\s*=> \{([\s\S]*?)\n\s*\};/);
  assert.ok(pickerSetter, 'picker customer setter is present');
  assert.match(pickerSetter[1], /next !== solarMode/, 'setter detects mismatch with solar mode');
  assert.match(pickerSetter[1], /confirm\(/, 'setter confirms before allowing mismatch');
  assert.match(pickerSetter[1], /opts\.force/, 'automatic solar sync can bypass the confirmation');
});
