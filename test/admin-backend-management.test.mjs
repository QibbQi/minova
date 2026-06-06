import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  canAccessDataSync,
  canManageQuoteApprovals,
  sanitizePermissionSnapshot,
  canAccessTab,
  canPerformAction
} from '../auth/permission-core.mjs';

import {
  buildBusinessBootstrapPayload,
  businessSnapshotToItems,
  buildHealthPayload,
  canSoftDeleteUser,
  domainPermission,
  normalizeAdminBusinessEntitiesQuery,
  normalizeAdminBusinessEntityMutation,
  normalizeAdminBusinessSettingsPayload,
  normalizeBusinessEntityDeletePayload,
  normalizeBusinessEntityUpsertPayload,
  normalizeBusinessSettingsPayload,
  normalizeQuoteCrudPayload,
  normalizeAuditLogFilters,
  normalizeUserCreatePayload,
  normalizeUserDeletePayload,
  normalizeUserResetPasswordPayload,
  normalizeUserUpdatePayload,
  validatePasswordChangeRequest
} from '../worker/src/index.mjs';

const authUiSource = readFileSync(new URL('../auth/minova-auth-ui.mjs', import.meta.url), 'utf8');
const indexHtmlSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('permission sanitization filters unknown tabs resources and actions', () => {
  const permission = sanitizePermissionSnapshot('sales', {
    tabs: ['quotation', 'madeUpTab'],
    actions: {
      quotes: ['read', 'edit', 'burnEverything'],
      unknownResource: ['read']
    },
    sensitiveFields: ['margin', 'secretField'],
    quote: { priceAdjustPctLimit: 7 },
    watermark: { enabled: false }
  });

  assert.deepEqual(permission.tabs, ['quotation']);
  assert.deepEqual(permission.actions.quotes, ['read', 'edit']);
  assert.equal(permission.actions.unknownResource, undefined);
  assert.deepEqual(permission.sensitiveFields, ['margin']);
  assert.equal(permission.quote.priceAdjustPctLimit, 7);
  assert.equal(permission.watermark.enabled, false);
});

test('admin permission sanitization preserves backend access and admin actions', () => {
  const permission = sanitizePermissionSnapshot('admin', {
    tabs: ['quotation'],
    actions: { quotes: ['read'] },
    quote: { priceAdjustPctLimit: 5 }
  });

  assert.equal(canAccessTab(permission, 'admin'), true);
  assert.equal(canPerformAction(permission, 'admin', 'read'), true);
  assert.equal(canPerformAction(permission, 'admin', 'edit'), true);
  assert.equal(canPerformAction(permission, 'admin', 'delete'), true);
  assert.equal(permission.quote.priceAdjustPctLimit, null);
});

test('password change request requires matching confirmation', () => {
  assert.deepEqual(
    validatePasswordChangeRequest({ nextPassword: 'abcdefgh', nextPasswordConfirm: 'abcdefgi' }),
    { ok: false, error: 'password_mismatch' }
  );
  assert.deepEqual(
    validatePasswordChangeRequest({ nextPassword: 'abcdefgh', nextPasswordConfirm: 'abcdefgh' }),
    { ok: true, nextPassword: 'abcdefgh' }
  );
});

test('user update payload normalizes editable account fields', () => {
  assert.deepEqual(normalizeUserUpdatePayload({
    id: '7',
    name: '  Daniel  ',
    email: ' DANIEL@Example.COM ',
    role: 'supply_chain',
    status: 'inactive'
  }), {
    ok: true,
    id: 7,
    name: 'Daniel',
    email: 'daniel@example.com',
    role: 'supply_chain',
    status: 'inactive'
  });

  assert.equal(normalizeUserUpdatePayload({ id: 0, name: '', role: 'ghost' }).ok, false);
});

test('user create payload accepts six character temporary passwords', () => {
  assert.deepEqual(normalizeUserCreatePayload({
    username: 'sales01',
    name: 'Sales One',
    email: ' SALES01@Example.COM ',
    role: 'sales',
    password: '123456'
  }), {
    ok: true,
    username: 'sales01',
    name: 'Sales One',
    email: 'sales01@example.com',
    role: 'sales',
    password: '123456'
  });

  assert.equal(normalizeUserCreatePayload({ username: 'a', name: 'A', password: '12345' }).error, 'password_too_short');
});

test('data sync visibility follows admin edit authorization', () => {
  assert.equal(canAccessDataSync(sanitizePermissionSnapshot('admin')), true);
  assert.equal(canAccessDataSync(sanitizePermissionSnapshot('sales_management')), false);
  assert.equal(canAccessDataSync(sanitizePermissionSnapshot('sales_management', {
    actions: { admin: ['read', 'edit'] }
  })), true);
});

test('soft delete payload and guard protect current user and final admin', () => {
  assert.deepEqual(normalizeUserDeletePayload({ id: '9' }), { ok: true, id: 9 });
  assert.equal(normalizeUserDeletePayload({ id: 0 }).error, 'invalid_user_id');

  assert.deepEqual(canSoftDeleteUser({
    currentUserId: 1,
    targetUserId: 1,
    targetRole: 'sales',
    activeAdminCount: 2
  }), { ok: false, error: 'cannot_delete_self' });

  assert.deepEqual(canSoftDeleteUser({
    currentUserId: 1,
    targetUserId: 2,
    targetRole: 'admin',
    activeAdminCount: 1
  }), { ok: false, error: 'cannot_delete_last_admin' });

  assert.deepEqual(canSoftDeleteUser({
    currentUserId: 1,
    targetUserId: 2,
    targetRole: 'sales',
    activeAdminCount: 1
  }), { ok: true });
});

test('reset password payload requires a target and admin password', () => {
  assert.deepEqual(normalizeUserResetPasswordPayload({ id: '8', adminPassword: 'secret123' }), {
    ok: true,
    id: 8,
    adminPassword: 'secret123'
  });
  assert.equal(normalizeUserResetPasswordPayload({ id: '8', adminPassword: '' }).error, 'missing_admin_password');
  assert.equal(normalizeUserResetPasswordPayload({ id: 0, adminPassword: 'secret123' }).error, 'invalid_user_id');
});

test('quote approval management follows approve permission', () => {
  assert.equal(canManageQuoteApprovals(sanitizePermissionSnapshot('sales')), false);
  assert.equal(canManageQuoteApprovals(sanitizePermissionSnapshot('price_auditor')), true);
  assert.equal(canManageQuoteApprovals(sanitizePermissionSnapshot('admin')), true);
});

test('audit log filters are normalized for admin log view', () => {
  assert.deepEqual(normalizeAuditLogFilters({
    user: ' Kelvin ',
    action: ' admin_update_user ',
    limit: '500'
  }), {
    user: 'Kelvin',
    action: 'admin_update_user',
    limit: 200
  });
});

test('auth UI prefers the stable Worker API on non-Minova domains', () => {
  assert.match(authUiSource, /function initialApiBase\(\)/);
  assert.match(authUiSource, /if \(isMinovaDomainPage\(\) && stored\) return stored;/);
  assert.match(authUiSource, /return DEFAULT_API_BASE_URL;/);
  assert.match(authUiSource, /if \(configured\) return uniqueValues\(\[configured, DEFAULT_API_BASE_URL, stored\]\);/);
});

test('auth UI retries transient backend reads and throttles admin auto-refresh', () => {
  assert.match(authUiSource, /AUTH_FETCH_TIMEOUT_MS = 12000/);
  assert.match(authUiSource, /AUTH_FETCH_RETRY_DELAYS_MS = \[300, 900\]/);
  assert.match(authUiSource, /D1_WRITE_QUEUE_KEY = 'minova_d1_write_queue_v1'/);
  assert.match(authUiSource, /queueBusinessWrite/);
  assert.match(authUiSource, /if \(!state\.user\) return \{ skipped: true, localOnly: true \};/);
  assert.match(authUiSource, /function filterBusinessSettingsForWrite\(settings = \{\}\)/);
  assert.match(authUiSource, /saveSettings: \(settings\) => \{/);
  assert.match(authUiSource, /ADMIN_REFRESH_MIN_INTERVAL_MS = 15000/);
  assert.match(authUiSource, /if \(adminState\.loadingPromise\) return adminState\.loadingPromise;/);
  assert.match(authUiSource, /if \(isAdminViewVisible\(\)\) loadAdminPanel\(\);/);
});

test('D1 write queue only retries transient business failures', () => {
  assert.match(authUiSource, /function isRetryableBusinessWriteError\(error\)/);
  assert.match(authUiSource, /if \(!isRetryableBusinessWriteError\(error\)\) return \{ ok: false, queued: false, error: error\.message \|\| String\(error\) \};/);
  assert.match(authUiSource, /nextRetryAt/);
  assert.match(authUiSource, /forceFlushD1WriteQueue/);
  assert.doesNotMatch(authUiSource, /enqueueD1Write\(path, body, label, 1\);\s*return \{ ok: false, queued: true/s);
});

test('admin endpoint diagnostics do not report cached transient reads as active queue failures', () => {
  assert.match(authUiSource, /function unresolvedAdminEndpointFailures\(\)/);
  assert.match(authUiSource, /\.filter\(\(\[, meta\]\) => !meta\.ok && !meta\.cached\)/);
  assert.match(authUiSource, /const failedEndpoints = unresolvedAdminEndpointFailures\(\);/);
  assert.match(authUiSource, /Endpoint diagnostics/);
});

test('business domain permission maps D1 domains to RBAC resources', () => {
  assert.deepEqual(domainPermission('supplier'), { resource: 'suppliers', read: 'read', write: 'edit', delete: 'delete' });
  assert.deepEqual(domainPermission('product'), { resource: 'products', read: 'read', write: 'edit', delete: 'delete' });
  assert.deepEqual(domainPermission('market_price'), { resource: 'priceList', read: 'read', write: 'edit', delete: 'delete' });
  assert.deepEqual(domainPermission('saved_quote'), { resource: 'quotes', read: 'read', write: 'edit', delete: 'delete' });
  assert.equal(domainPermission('unknown_domain'), null);
});

test('business entity payloads normalize single and batch writes', () => {
  assert.deepEqual(normalizeBusinessEntityUpsertPayload({
    domain: 'product',
    recordId: 'P-1',
    payload: { id: 'P-1', name: 'PV' }
  }), {
    ok: true,
    items: [{ domain: 'product', recordId: 'P-1', payload: { id: 'P-1', name: 'PV' } }]
  });
  assert.equal(normalizeBusinessEntityUpsertPayload({ domain: 'supplier', recordId: 'SUP1', payload: { code: 'SUP1' } }).ok, true);

  assert.deepEqual(normalizeBusinessEntityUpsertPayload({
    items: [
      { domain: 'inventory', recordId: 'I-1', payload: { id: 'I-1' } },
      { domain: 'ghost', recordId: 'G-1', payload: {} }
    ]
  }), { ok: false, error: 'invalid_business_domain' });

  assert.deepEqual(normalizeBusinessEntityDeletePayload({ domain: 'transport', recordId: 'T-1' }), {
    ok: true,
    domain: 'transport',
    recordId: 'T-1'
  });
});

test('business settings and quote CRUD payloads normalize expected shapes', () => {
  assert.deepEqual(normalizeBusinessSettingsPayload({
    settings: {
      market_price_settings: { categoryUnits: { Battery: 'kWh' } },
      ignored: { ok: false }
    }
  }), {
    ok: true,
    settings: {
      market_price_settings: { categoryUnits: { Battery: 'kWh' } }
    }
  });
  assert.equal(normalizeBusinessSettingsPayload({ settingKey: 'ignored', payload: {} }).error, 'invalid_setting_key');
  assert.deepEqual(normalizeQuoteCrudPayload({ id: 'Q1', name: 'Quote 1', snapshot: { quoteRows: [] } }), {
    ok: true,
    id: 'Q1',
    name: 'Quote 1',
    customerName: '',
    quoteNo: '',
    snapshot: { quoteRows: [] },
    createdAt: ''
  });
});

test('admin business data payloads normalize list and edit operations', () => {
  assert.deepEqual(normalizeAdminBusinessEntitiesQuery(new URL('https://api.example/admin/business/entities?domain=supplier&status=deleted&q= lesso &limit=500')), {
    domain: 'supplier',
    status: 'deleted',
    q: 'lesso',
    limit: 200
  });
  assert.deepEqual(normalizeAdminBusinessEntitiesQuery(new URL('https://api.example/admin/business/entities?domain=ghost&status=weird&limit=0')), {
    domain: '',
    status: 'active',
    q: '',
    limit: 100
  });
  assert.deepEqual(normalizeAdminBusinessEntityMutation({
    domain: 'supplier',
    recordId: 'SUP1',
    payload: { id: 'SUP1', code: 'SUP1' }
  }), {
    ok: true,
    domain: 'supplier',
    recordId: 'SUP1',
    payload: { id: 'SUP1', code: 'SUP1' }
  });
  assert.equal(normalizeAdminBusinessEntityMutation({ domain: 'ghost', recordId: 'x', payload: {} }).error, 'invalid_business_domain');
  assert.deepEqual(normalizeAdminBusinessSettingsPayload({
    settings: { profit_settings: { rows: [] }, ignored: {} }
  }), {
    ok: true,
    settings: { profit_settings: { rows: [] } }
  });
});

test('health payload exposes Worker and D1 deep status', () => {
  assert.deepEqual(buildHealthPayload({ d1Ok: true, latencyMs: 27, now: '2026-06-06T00:00:00.000Z' }), {
    ok: true,
    service: 'minova-backend',
    worker: { ok: true },
    d1: { ok: true, latencyMs: 27 },
    timestamp: '2026-06-06T00:00:00.000Z'
  });
  assert.equal(buildHealthPayload({ d1Ok: false, latencyMs: 12 }).ok, false);
});

test('business bootstrap payload reshapes entity rows into app state', () => {
  const payload = buildBusinessBootstrapPayload([
    { domain: 'supplier', record_id: 'SUP1', payload_json: '{"id":"SUP1","code":"SUP1","nameEn":"Supplier"}', updated_at: '2026-06-03 00:59:00' },
    { domain: 'product', record_id: 'P1', payload_json: '{"id":"P1","name":"PV"}', updated_at: '2026-06-03 01:00:00' },
    { domain: 'inventory', record_id: 'I1', payload_json: '{"id":"I1","productId":"P1"}', updated_at: '2026-06-03 01:01:00' },
    { domain: 'market_price', record_id: 'M1', payload_json: '{"id":"M1","category":"PV Module"}', updated_at: '2026-06-03 01:02:00' },
    { domain: 'saved_quote', record_id: 'Q1', payload_json: '{"id":"Q1","name":"Quote 1","snapshot":{}}', updated_at: '2026-06-03 01:03:00' }
  ], {
    market_price_settings: { categoryUnits: { 'PV Module': 'W' }, deletedRecordIds: ['old'] },
    subcategories_by_category: { 'PV Module': ['Bifacial'] }
  });

  assert.deepEqual(payload.data.suppliers, [{ id: 'SUP1', code: 'SUP1', nameEn: 'Supplier' }]);
  assert.deepEqual(payload.data.products, [{ id: 'P1', name: 'PV' }]);
  assert.deepEqual(payload.data.inventory, [{ id: 'I1', productId: 'P1' }]);
  assert.deepEqual(payload.data.marketPrices.records, [{ id: 'M1', category: 'PV Module' }]);
  assert.deepEqual(payload.data.marketPrices.categoryUnits, { 'PV Module': 'W' });
  assert.deepEqual(payload.data.subcategoriesByCategory, { 'PV Module': ['Bifacial'] });
  assert.deepEqual(payload.quoteIndex.quotes, [{
    id: 'Q1',
    name: 'Quote 1',
    customerName: '',
    quoteNo: '',
    createdAt: '2026-06-03 01:03:00',
    updatedAt: '2026-06-03 01:03:00',
    timestamp: Date.parse('2026-06-03 01:03:00')
  }]);
});

test('business snapshot migration maps suppliers into D1 entities', () => {
  const { items } = businessSnapshotToItems({
    suppliers: [{ id: 'supplier_SUP1', code: 'SUP1', nameEn: 'Supplier One' }],
    products: [{ id: 'P1', name: 'PV' }]
  });

  assert.deepEqual(items.filter(item => item.domain === 'supplier'), [{
    domain: 'supplier',
    recordId: 'supplier_SUP1',
    payload: { id: 'supplier_SUP1', code: 'SUP1', nameEn: 'Supplier One' }
  }]);
});

test('quote-setting save paths persist D1 settings directly', () => {
  assert.match(indexHtmlSource, /function persistQuoteSettingsToD1\(\)/);
  assert.match(indexHtmlSource, /function persistProfitSettings[\s\S]*persistQuoteSettingsToD1\(\)/);
  assert.match(indexHtmlSource, /window\.recalcInstallerQuote = \(\) => \{[\s\S]*persistQuoteSettingsToD1\(\)/);
});

test('top navigation tabs use compact SVG icon buttons with hover labels', () => {
  for (const tab of ['quotation', 'pvcalc', 'costcalc', 'database', 'pricelist', 'inventory', 'transport']) {
    assert.match(indexHtmlSource, new RegExp(`id="tab-${tab}"[^>]*aria-label=`));
    assert.match(indexHtmlSource, new RegExp(`id="tab-${tab}"[\\s\\S]*?<svg`));
    assert.match(indexHtmlSource, new RegExp(`id="tab-${tab}"[\\s\\S]*?data-tab-label`));
  }
  assert.match(authUiSource, /renderTabIcon\('admin'\)/);
  assert.match(authUiSource, /button\.setAttribute\('aria-label', TAB_LABELS\.admin\)/);
});
