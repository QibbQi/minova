export const DEFAULT_API_BASE_URL = 'https://minova-backend.qibbqi00.workers.dev';

export const ROLE_DEFINITIONS = {
  admin: {
    id: 'admin',
    displayName: 'Admin',
    defaultHolder: 'Kelvin',
    priceAdjustPctLimit: null
  },
  supply_chain: {
    id: 'supply_chain',
    displayName: 'Supply-chain management',
    defaultHolder: 'Daniel',
    priceAdjustPctLimit: 10
  },
  sales: {
    id: 'sales',
    displayName: 'Sales',
    defaultHolder: '',
    priceAdjustPctLimit: 5
  },
  sales_management: {
    id: 'sales_management',
    displayName: 'Sales management',
    defaultHolder: 'MJ',
    priceAdjustPctLimit: 10
  },
  operation_management: {
    id: 'operation_management',
    displayName: 'Operation management',
    defaultHolder: 'Billy',
    priceAdjustPctLimit: 10
  },
  price_auditor: {
    id: 'price_auditor',
    displayName: 'Price Auditor(Supervisor)',
    defaultHolder: 'Hao',
    priceAdjustPctLimit: 12
  },
  read_only: {
    id: 'read_only',
    displayName: 'Read-only/visitor',
    defaultHolder: '',
    priceAdjustPctLimit: 0
  }
};

export const ALL_TABS = [
  'quotation',
  'pvcalc',
  'costcalc',
  'database',
  'pricelist',
  'inventory',
  'transport',
  'admin'
];

export const PERMISSION_RESOURCES = [
  'quotes',
  'products',
  'priceList',
  'inventory',
  'transport',
  'suppliers',
  'quoteSettings',
  'admin'
];

export const PERMISSION_ACTIONS = [
  'read',
  'edit',
  'delete',
  'upload',
  'download',
  'approve',
  'approvalRequest'
];

export const SENSITIVE_FIELDS = [
  'cost',
  'margin',
  'supplierContact'
];

const ROLE_TABS = {
  admin: ALL_TABS,
  sales: ['quotation', 'pvcalc', 'pricelist'],
  sales_management: ['quotation', 'pvcalc', 'pricelist', 'admin'],
  supply_chain: ['database', 'inventory', 'transport', 'pricelist'],
  operation_management: ['database', 'inventory', 'transport'],
  price_auditor: ['quotation', 'costcalc', 'pricelist', 'admin'],
  read_only: ['quotation', 'pvcalc', 'pricelist']
};

const READ_ONLY_ACTIONS = {
  quotes: ['read'],
  products: ['read'],
  priceList: ['read'],
  inventory: ['read'],
  transport: ['read'],
  suppliers: ['read'],
  quoteSettings: [],
  admin: []
};

const ROLE_ACTIONS = {
  admin: {
    quotes: ['read', 'edit', 'delete', 'download', 'approve'],
    products: ['read', 'edit', 'delete', 'upload'],
    priceList: ['read', 'edit', 'delete'],
    inventory: ['read', 'edit', 'delete'],
    transport: ['read', 'edit', 'delete', 'upload'],
    suppliers: ['read', 'edit', 'delete'],
    quoteSettings: ['read', 'edit'],
    admin: ['read', 'edit', 'delete']
  },
  sales: {
    quotes: ['read', 'edit', 'download', 'approvalRequest'],
    products: ['read'],
    priceList: ['read'],
    inventory: [],
    transport: [],
    suppliers: [],
    quoteSettings: [],
    admin: []
  },
  sales_management: {
    quotes: ['read', 'edit', 'download', 'approvalRequest', 'approve'],
    products: ['read'],
    priceList: ['read'],
    inventory: [],
    transport: [],
    suppliers: [],
    quoteSettings: [],
    admin: ['read']
  },
  supply_chain: {
    quotes: ['read', 'edit', 'download', 'approvalRequest'],
    products: ['read', 'edit', 'delete', 'upload'],
    priceList: ['read', 'edit'],
    inventory: ['read', 'edit', 'delete'],
    transport: ['read', 'edit', 'delete', 'upload'],
    suppliers: ['read', 'edit', 'delete'],
    quoteSettings: [],
    admin: []
  },
  operation_management: {
    quotes: ['read', 'edit', 'download', 'approvalRequest'],
    products: ['read', 'edit', 'delete'],
    priceList: ['read'],
    inventory: ['read', 'edit', 'delete'],
    transport: ['read', 'edit', 'delete'],
    suppliers: ['read'],
    quoteSettings: [],
    admin: []
  },
  price_auditor: {
    quotes: ['read', 'edit', 'delete', 'download', 'approvalRequest', 'approve'],
    products: ['read', 'delete'],
    priceList: ['read', 'edit'],
    inventory: ['read', 'delete'],
    transport: ['read', 'delete'],
    suppliers: ['read'],
    quoteSettings: ['read', 'edit'],
    admin: ['read']
  },
  read_only: READ_ONLY_ACTIONS
};

const ROLE_SENSITIVE_FIELDS = {
  admin: ['cost', 'margin', 'supplierContact'],
  supply_chain: ['cost', 'margin', 'supplierContact'],
  sales: [],
  sales_management: ['margin'],
  operation_management: ['margin'],
  price_auditor: ['cost', 'margin'],
  read_only: []
};

export function normalizeRoleId(roleId) {
  const key = String(roleId || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (key === 'supply_chain_management') return 'supply_chain';
  if (key === 'operation') return 'operation_management';
  if (key === 'price_auditor_supervisor' || key === 'price_auditor_(supervisor)') return 'price_auditor';
  if (ROLE_DEFINITIONS[key]) return key;
  return 'read_only';
}

function listToSet(values) {
  return new Set(Array.isArray(values) ? values.map(v => String(v || '').trim()).filter(Boolean) : []);
}

function cloneActions(actions) {
  const out = {};
  Object.entries(actions || {}).forEach(([resource, values]) => {
    out[resource] = [...listToSet(values)];
  });
  return out;
}

export function getDefaultPermissionSnapshot(roleId = 'read_only', overrides = {}) {
  const role = normalizeRoleId(roleId);
  const definition = ROLE_DEFINITIONS[role] || ROLE_DEFINITIONS.read_only;
  const tabs = overrides.tabs || ROLE_TABS[role] || ROLE_TABS.read_only;
  const actions = {
    ...cloneActions(ROLE_ACTIONS[role] || READ_ONLY_ACTIONS),
    ...cloneActions(overrides.actions || {})
  };
  const sensitiveFields = overrides.sensitiveFields || ROLE_SENSITIVE_FIELDS[role] || [];

  return {
    role,
    roleName: definition.displayName,
    tabs: [...listToSet(tabs)],
    actions,
    sensitiveFields: [...listToSet(sensitiveFields)],
    quote: {
      priceAdjustPctLimit: Object.prototype.hasOwnProperty.call(overrides, 'priceAdjustPctLimit')
        ? overrides.priceAdjustPctLimit
        : definition.priceAdjustPctLimit,
      approvalRole: overrides.approvalRole || 'price_auditor',
      approvalRoleName: ROLE_DEFINITIONS.price_auditor.displayName,
      allowMultiLevelApproval: true,
      approvalIsPermanent: false
    },
    watermark: {
      enabled: overrides.watermarkEnabled !== false,
      includeInPdf: false,
      marker: 'VOID QUOTE'
    }
  };
}

export function canAccessTab(permissionSnapshot, tab) {
  if (!permissionSnapshot) return false;
  return listToSet(permissionSnapshot.tabs).has(String(tab || '').trim());
}

export function canPerformAction(permissionSnapshot, resource, action) {
  if (!permissionSnapshot) return false;
  const actions = permissionSnapshot.actions || {};
  return listToSet(actions[resource]).has(String(action || '').trim());
}

export function canAccessDataSync(permissionSnapshot) {
  return canPerformAction(permissionSnapshot, 'admin', 'edit');
}

export function canManageQuoteApprovals(permissionSnapshot) {
  return canPerformAction(permissionSnapshot, 'quotes', 'approve');
}

export function canViewSensitiveField(permissionSnapshot, field) {
  if (!permissionSnapshot) return false;
  return listToSet(permissionSnapshot.sensitiveFields).has(String(field || '').trim());
}

function asFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function getQuoteRowBasePrice(row) {
  if (!row || typeof row !== 'object') return 0;
  const explicit = asFiniteNumber(row.basePrice, NaN);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const current = asFiniteNumber(row.price, 0);
  return current > 0 ? current : 0;
}

export function evaluateQuotePriceAdjustment(permissionSnapshot, quoteRows = []) {
  const limitRaw = permissionSnapshot?.quote?.priceAdjustPctLimit;
  const limitPct = limitRaw === null || limitRaw === undefined ? null : asFiniteNumber(limitRaw, 0);
  const rows = Array.isArray(quoteRows) ? quoteRows : [];
  const deviations = rows
    .filter(row => row && !row.isBlank)
    .map(row => {
      const basePrice = getQuoteRowBasePrice(row);
      const price = asFiniteNumber(row.price, 0);
      const deviationPct = basePrice > 0 ? ((price - basePrice) / basePrice) * 100 : 0;
      return {
        id: row.id || '',
        description: row.description || '',
        basePrice,
        price,
        deviationPct,
        absDeviationPct: Math.abs(deviationPct)
      };
    });
  const maxDeviationPct = deviations.reduce((max, row) => Math.max(max, row.absDeviationPct), 0);
  const maxRounded = Math.round(maxDeviationPct * 100) / 100;
  const violatingRows = limitPct === null
    ? []
    : deviations.filter(row => row.absDeviationPct > limitPct + 0.000001);

  return {
    allowed: limitPct === null || violatingRows.length === 0,
    requiresApproval: limitPct !== null && violatingRows.length > 0,
    limitPct,
    maxDeviationPct: maxRounded,
    violatingRows: violatingRows.map(row => ({
      ...row,
      deviationPct: Math.round(row.deviationPct * 100) / 100,
      absDeviationPct: Math.round(row.absDeviationPct * 100) / 100
    }))
  };
}

export function buildWatermarkText({ user } = {}) {
  const name = String(user?.name || user?.displayName || '-').trim() || '-';
  return `${name} / VOID QUOTE`;
}

function boundedPercentage(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n * 100) / 100));
}

export function sanitizePermissionSnapshot(roleId = 'read_only', raw = {}) {
  const role = normalizeRoleId(roleId || raw?.role || 'read_only');
  const base = getDefaultPermissionSnapshot(role);
  const validTabs = listToSet(ALL_TABS);
  const tabs = (Array.isArray(raw?.tabs) ? raw.tabs : base.tabs)
    .map(tab => String(tab || '').trim())
    .filter(tab => validTabs.has(tab));

  const validResources = listToSet(PERMISSION_RESOURCES);
  const validActions = listToSet(PERMISSION_ACTIONS);
  const actions = {};
  const rawActions = raw?.actions && typeof raw.actions === 'object' ? raw.actions : base.actions;
  Object.entries(rawActions || {}).forEach(([resource, values]) => {
    if (!validResources.has(resource)) return;
    actions[resource] = [...listToSet(values)].filter(action => validActions.has(action));
  });
  PERMISSION_RESOURCES.forEach(resource => {
    if (!actions[resource]) actions[resource] = [];
  });

  const validSensitiveFields = listToSet(SENSITIVE_FIELDS);
  const sensitiveFields = (Array.isArray(raw?.sensitiveFields) ? raw.sensitiveFields : base.sensitiveFields)
    .map(field => String(field || '').trim())
    .filter(field => validSensitiveFields.has(field));

  const quoteLimit = raw?.quote?.priceAdjustPctLimit ?? raw?.priceAdjustPctLimit ?? base.quote.priceAdjustPctLimit;
  const sanitized = {
    ...base,
    role,
    roleName: base.roleName,
    tabs: [...listToSet(tabs)],
    actions,
    sensitiveFields: [...listToSet(sensitiveFields)],
    quote: {
      ...base.quote,
      ...(raw?.quote && typeof raw.quote === 'object' ? raw.quote : {}),
      priceAdjustPctLimit: quoteLimit === null ? null : boundedPercentage(quoteLimit, base.quote.priceAdjustPctLimit || 0)
    },
    watermark: {
      ...base.watermark,
      ...(raw?.watermark && typeof raw.watermark === 'object' ? raw.watermark : {}),
      enabled: raw?.watermark?.enabled !== false
    }
  };

  if (role === 'admin') {
    sanitized.tabs = [...listToSet([...sanitized.tabs, 'admin'])];
    sanitized.actions.admin = [...listToSet([...(sanitized.actions.admin || []), 'read', 'edit', 'delete'])];
    sanitized.quote.priceAdjustPctLimit = null;
  }

  return sanitized;
}

export function mergePermissionSnapshot(user = {}, permission = {}) {
  const role = normalizeRoleId(user.role || permission.role || 'read_only');
  const base = getDefaultPermissionSnapshot(role);
  return sanitizePermissionSnapshot(role, {
    ...base,
    ...permission,
    role,
    roleName: permission.roleName || base.roleName,
    tabs: Array.isArray(permission.tabs) ? permission.tabs : base.tabs,
    actions: permission.actions && typeof permission.actions === 'object' ? permission.actions : base.actions,
    sensitiveFields: Array.isArray(permission.sensitiveFields) ? permission.sensitiveFields : base.sensitiveFields,
    quote: { ...base.quote, ...(permission.quote || {}) },
    watermark: { ...base.watermark, ...(permission.watermark || {}) }
  });
}
