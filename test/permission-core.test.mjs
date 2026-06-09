import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_API_BASE_URL,
  ROLE_DEFINITIONS,
  getDefaultPermissionSnapshot,
  canAccessTab,
  canPerformAction,
  canViewSensitiveField,
  evaluateQuotePriceAdjustment,
  buildWatermarkText
} from '../auth/permission-core.mjs';

test('default API base points to the deployed Worker URL', () => {
  assert.equal(DEFAULT_API_BASE_URL, 'https://minova-backend.qibbqi00.workers.dev');
});

test('role defaults include the requested Minova roles and holders', () => {
  assert.equal(ROLE_DEFINITIONS.admin.displayName, 'Admin');
  assert.equal(ROLE_DEFINITIONS.admin.defaultHolder, 'Kelvin');
  assert.equal(ROLE_DEFINITIONS.supply_chain.defaultHolder, 'Daniel');
  assert.equal(ROLE_DEFINITIONS.sales_management.defaultHolder, 'MJ');
  assert.equal(ROLE_DEFINITIONS.operation_management.defaultHolder, 'Billy');
  assert.equal(ROLE_DEFINITIONS.price_auditor.defaultHolder, 'Hao');
});

test('tab permissions follow the responsibility-based matrix', () => {
  const admin = getDefaultPermissionSnapshot('admin');
  const sales = getDefaultPermissionSnapshot('sales');
  const supply = getDefaultPermissionSnapshot('supply_chain');
  const auditor = getDefaultPermissionSnapshot('price_auditor');
  const visitor = getDefaultPermissionSnapshot('read_only');

  assert.equal(canAccessTab(admin, 'admin'), true);
  assert.equal(canAccessTab(admin, 'engineering'), true);
  assert.equal(canAccessTab(sales, 'quotation'), true);
  assert.equal(canAccessTab(sales, 'engineering'), false);
  assert.equal(canAccessTab(sales, 'inventory'), false);
  assert.equal(canAccessTab(supply, 'inventory'), true);
  assert.equal(canAccessTab(supply, 'engineering'), false);
  assert.equal(canAccessTab(supply, 'quotation'), false);
  assert.equal(canAccessTab(getDefaultPermissionSnapshot('operation_management'), 'engineering'), true);
  assert.equal(canAccessTab(auditor, 'costcalc'), true);
  assert.equal(canAccessTab(auditor, 'engineering'), false);
  assert.equal(canAccessTab(visitor, 'quotation'), true);
});

test('sensitive field permissions match the approved matrix', () => {
  assert.equal(canViewSensitiveField(getDefaultPermissionSnapshot('sales'), 'cost'), false);
  assert.equal(canViewSensitiveField(getDefaultPermissionSnapshot('price_auditor'), 'cost'), true);
  assert.equal(canViewSensitiveField(getDefaultPermissionSnapshot('operation_management'), 'margin'), true);
  assert.equal(canViewSensitiveField(getDefaultPermissionSnapshot('operation_management'), 'supplierContact'), false);
  assert.equal(canViewSensitiveField(getDefaultPermissionSnapshot('supply_chain'), 'supplierContact'), true);
});

test('delete action permissions are restricted to approved roles', () => {
  assert.equal(canPerformAction(getDefaultPermissionSnapshot('sales'), 'quotes', 'delete'), false);
  assert.equal(canPerformAction(getDefaultPermissionSnapshot('operation_management'), 'inventory', 'delete'), true);
  assert.equal(canPerformAction(getDefaultPermissionSnapshot('price_auditor'), 'products', 'delete'), true);
});

test('quote price adjustment blocks downloads beyond role limits', () => {
  const sales = getDefaultPermissionSnapshot('sales');
  const auditor = getDefaultPermissionSnapshot('price_auditor');
  const admin = getDefaultPermissionSnapshot('admin');
  const rows = [
    { id: 'a', basePrice: 100, price: 104, quantity: 1 },
    { id: 'b', basePrice: 200, price: 214, quantity: 1 }
  ];

  const salesResult = evaluateQuotePriceAdjustment(sales, rows);
  assert.equal(salesResult.allowed, false);
  assert.equal(salesResult.requiresApproval, true);
  assert.equal(salesResult.maxDeviationPct, 7);

  const auditorResult = evaluateQuotePriceAdjustment(auditor, rows);
  assert.equal(auditorResult.allowed, true);
  assert.equal(auditorResult.limitPct, 12);

  const adminResult = evaluateQuotePriceAdjustment(admin, [{ basePrice: 100, price: 10 }]);
  assert.equal(adminResult.allowed, true);
  assert.equal(adminResult.limitPct, null);
});

test('watermark text includes name and VOID marker only', () => {
  const text = buildWatermarkText({
    user: { name: 'Kelvin', username: 'admin' },
    quoteNo: 'Q-001',
    customerName: 'ABC Solar',
    now: new Date('2026-06-03T08:00:00Z')
  });

  assert.match(text, /Kelvin/);
  assert.match(text, /VOID QUOTE/);
  assert.doesNotMatch(text, /admin/);
  assert.doesNotMatch(text, /Q-001/);
  assert.doesNotMatch(text, /ABC Solar/);
});
