import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  PERMISSION_SCHEMA_VERSION,
  canAccessTab,
  canPerformAction,
  getDefaultPermissionSnapshot,
  mergePermissionSnapshot
} from '../auth/permission-core.mjs';
import { domainPermission, normalizeBusinessSettingsPayload } from '../worker/src/index.mjs';

const authUiSource = readFileSync(new URL('../auth/minova-auth-ui.mjs', import.meta.url), 'utf8');

test('EPC design permissions expose quick design and engineering download separately', () => {
  assert.equal(PERMISSION_SCHEMA_VERSION, 3);

  const sales = getDefaultPermissionSnapshot('sales');
  assert.equal(canAccessTab(sales, 'epcdesign'), true);
  assert.equal(canPerformAction(sales, 'epcDesign', 'edit'), true);
  assert.equal(canPerformAction(sales, 'epcDesign', 'download'), true);
  assert.equal(canPerformAction(sales, 'epcDesignEngineering', 'edit'), false);
  assert.equal(canPerformAction(sales, 'epcDesignEngineering', 'download'), false);

  const supply = getDefaultPermissionSnapshot('supply_chain');
  assert.equal(canPerformAction(supply, 'epcDesignEngineering', 'edit'), true);
  assert.equal(canPerformAction(supply, 'epcDesignEngineering', 'download'), true);

  const auditor = getDefaultPermissionSnapshot('price_auditor');
  assert.equal(canAccessTab(auditor, 'epcdesign'), true);
  assert.equal(canPerformAction(auditor, 'epcDesign', 'download'), true);
  assert.equal(canPerformAction(auditor, 'epcDesignEngineering', 'download'), true);

  const visitor = getDefaultPermissionSnapshot('read_only');
  assert.equal(canAccessTab(visitor, 'epcdesign'), false);
  assert.equal(canPerformAction(visitor, 'epcDesign', 'download'), false);
});

test('legacy permissions migrate EPC design tab and resources into schema v3', () => {
  const migrated = mergePermissionSnapshot({ role: 'sales' }, {
    schemaVersion: 2,
    role: 'sales',
    tabs: ['quotation', 'pvcalc', 'pricelist'],
    actions: {
      quotes: ['read', 'edit', 'download'],
      products: ['read'],
      priceList: ['read']
    }
  });

  assert.equal(migrated.schemaVersion, 3);
  assert.equal(canAccessTab(migrated, 'epcdesign'), true);
  assert.equal(canPerformAction(migrated, 'epcDesign', 'read'), true);
  assert.equal(canPerformAction(migrated, 'epcDesign', 'download'), true);
  assert.deepEqual(migrated.actions.epcDesignEngineering, []);
});

test('EPC design domains and settings map through Worker and auth UI permission gates', () => {
  assert.deepEqual(domainPermission('epc_design_project'), { resource: 'epcDesign', read: 'read', write: 'edit', delete: 'delete' });
  assert.deepEqual(domainPermission('epc_design_defaults'), { resource: 'epcDesignEngineering', read: 'read', write: 'edit', delete: 'delete' });
  assert.equal(normalizeBusinessSettingsPayload({ settingKey: 'epc_design_defaults', payload: { sfc: 0.27 } }).ok, true);

  assert.match(authUiSource, /epc_design_project:\s*'epcDesign'/);
  assert.match(authUiSource, /epc_design_defaults:\s*'epcDesignEngineering'/);
  assert.match(authUiSource, /epc_design_defaults[\s\S]*epcDesignEngineering/);
});
