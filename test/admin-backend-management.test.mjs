import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canAccessDataSync,
  canManageQuoteApprovals,
  sanitizePermissionSnapshot,
  canAccessTab,
  canPerformAction
} from '../auth/permission-core.mjs';

import {
  buildBusinessBootstrapPayload,
  canSoftDeleteUser,
  domainPermission,
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

test('business domain permission maps D1 domains to RBAC resources', () => {
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

test('business bootstrap payload reshapes entity rows into app state', () => {
  const payload = buildBusinessBootstrapPayload([
    { domain: 'product', record_id: 'P1', payload_json: '{"id":"P1","name":"PV"}', updated_at: '2026-06-03 01:00:00' },
    { domain: 'inventory', record_id: 'I1', payload_json: '{"id":"I1","productId":"P1"}', updated_at: '2026-06-03 01:01:00' },
    { domain: 'market_price', record_id: 'M1', payload_json: '{"id":"M1","category":"PV Module"}', updated_at: '2026-06-03 01:02:00' },
    { domain: 'saved_quote', record_id: 'Q1', payload_json: '{"id":"Q1","name":"Quote 1","snapshot":{}}', updated_at: '2026-06-03 01:03:00' }
  ], {
    market_price_settings: { categoryUnits: { 'PV Module': 'W' }, deletedRecordIds: ['old'] },
    subcategories_by_category: { 'PV Module': ['Bifacial'] }
  });

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
