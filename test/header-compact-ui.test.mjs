import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('top app header uses compact responsive sizing inside its frame', () => {
  assert.match(html, /\.app-shell-header/, 'compact header CSS is present');
  assert.match(html, /\.app-shell-tab/, 'compact nav tab CSS is present');
  assert.match(html, /<header class="[^"]*app-shell-header/, 'header uses compact shell class');
  assert.match(html, /id="tab-database"[^>]*app-shell-tab/, 'main nav tabs use compact tab class');
  assert.match(html, /font-size:\s*clamp\(/, 'header text uses bounded responsive font sizing');
});
