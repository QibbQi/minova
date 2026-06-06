import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const moduleBody = readFileSync(new URL('../module_body.js', import.meta.url), 'utf8');

test('top app header uses compact responsive sizing inside its frame', () => {
  assert.match(html, /\.app-shell-header/, 'compact header CSS is present');
  assert.match(html, /\.app-shell-tab/, 'compact nav tab CSS is present');
  assert.match(html, /<header class="[^"]*app-shell-header/, 'header uses compact shell class');
  assert.match(html, /id="tab-database"[^>]*app-shell-tab/, 'main nav tabs use compact tab class');
  assert.match(html, /font-size:\s*clamp\(/, 'header text uses bounded responsive font sizing');
});

test('top app header exposes icon tooltips and keeps English-only controls compact', () => {
  assert.match(html, /\.app-shell-header\s*\{[\s\S]*?overflow:\s*visible;/, 'header allows icon tooltips to escape the frame');
  assert.match(html, /\.app-shell-nav\s*\{[\s\S]*?overflow:\s*visible;/, 'nav allows icon tooltips to escape the frame');
  assert.match(html, /<img src="\.\/logo\.png"[^>]*alt="MINOVA logo"/, 'brand uses the graphical logo mark');
  assert.match(html, /<span class="block">MINOVA<\/span>/, 'brand title uses the text logo name');
  assert.doesNotMatch(html, /id="btn-lang"/, 'language toggle is removed from the top header');
  assert.doesNotMatch(html, /EN \/ 中/, 'Chinese language toggle label is removed');
  assert.doesNotMatch(moduleBody, /EN \/ 中|中 \/ EN/, 'mirrored runtime no longer restores Chinese language toggle labels');
  assert.match(moduleBody, /const langButton = document\.getElementById\('btn-lang'\);[\s\S]*?if \(langButton\)/, 'mirrored runtime guards legacy language button refresh');
  assert.match(html, /const langButton = document\.getElementById\('btn-lang'\);[\s\S]*?if \(langButton\)/, 'legacy language refresh is guarded when the button is absent');
});
