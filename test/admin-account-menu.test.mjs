import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { getAccountD1Status } from '../auth/account-menu-status.mjs';

const authUiSource = readFileSync(new URL('../auth/minova-auth-ui.mjs', import.meta.url), 'utf8');
const indexHtmlSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('administrator header centralizes account D1 status backup and logout in an accessible menu', () => {
  assert.match(authUiSource, /id="minova-account-menu-toggle"/);
  assert.match(authUiSource, /aria-expanded="false"/);
  assert.match(authUiSource, /id="minova-account-menu-panel"/);
  assert.match(authUiSource, /id="minova-account-menu-d1-status"/);
  assert.match(authUiSource, /id="minova-account-menu-backup"/);
  assert.match(authUiSource, /id="minova-auth-logout"/);
  assert.match(authUiSource, /keydown/);
  assert.match(authUiSource, /button\.offsetParent !== null/);
  assert.match(indexHtmlSource, /\.minova-account-menu-panel/);
});

test('GitHub static backup remains mounted through its original root', () => {
  assert.match(indexHtmlSource, /id="github-sync-root"/);
  assert.match(indexHtmlSource, /GitHub Backup \/ Static Publish/);
});

test('account menu D1 status prioritizes failures and exposes all save states', () => {
  assert.deepEqual(getAccountD1Status({ lastPersistAt: '2026-07-15T15:00:00Z' }).label, 'Saved to D1');
  assert.deepEqual(getAccountD1Status({ pendingWrites: 2 }).label, '2 saving');
  assert.deepEqual(getAccountD1Status({ queuedWrites: 3 }).label, '3 queued');
  const failed = getAccountD1Status({ failedWrites: 1, queuedWrites: 2, lastError: 'Network unavailable' });
  assert.equal(failed.label, '1 failed');
  assert.equal(failed.tone, 'attention');
  assert.equal(failed.attentionCount, 1);
  assert.equal(failed.detail, 'Network unavailable');
});
