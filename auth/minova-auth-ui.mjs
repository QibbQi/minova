import {
  DEFAULT_API_BASE_URL,
  ROLE_DEFINITIONS,
  ALL_TABS,
  PERMISSION_RESOURCES,
  PERMISSION_ACTIONS,
  SENSITIVE_FIELDS,
  getDefaultPermissionSnapshot,
  mergePermissionSnapshot,
  sanitizePermissionSnapshot,
  canAccessTab,
  canAccessDataSync,
  canManageQuoteApprovals,
  canPerformAction,
  canViewSensitiveField,
  evaluateQuotePriceAdjustment,
  buildWatermarkText
} from './permission-core.mjs';

const AUTH_API_BASE_KEY = 'minova_auth_api_base_v1';
const AUTH_SESSION_KEY = 'minova_auth_session_v1';
const AUTH_SESSION_EXPIRES_KEY = 'minova_auth_session_expires_v1';
const normalizeApiBase = (value) => {
  const base = String(value || '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^/\s]+/i.test(base) ? base : '';
};
const state = {
  apiBase: normalizeApiBase(window.MINOVA_AUTH_API_BASE) || normalizeApiBase(localStorage.getItem(AUTH_API_BASE_KEY)) || DEFAULT_API_BASE_URL,
  sessionToken: localStorage.getItem(AUTH_SESSION_KEY) || '',
  sessionExpiresAt: localStorage.getItem(AUTH_SESSION_EXPIRES_KEY) || '',
  user: null,
  permission: null,
  ready: false,
  locked: true,
  quoteCheck: null
};
const adminState = {
  roles: [],
  users: [],
  permissions: [],
  approvals: [],
  auditLogs: [],
  selectedRole: 'admin',
  activePanel: 'dashboard',
  showInactiveUsers: false,
  resetUserId: null
};
const businessState = {
  loaded: false,
  source: 'static',
  hasD1Data: false,
  lastBootstrapAt: '',
  lastPersistAt: '',
  lastMigrationAt: '',
  pendingWrites: 0,
  failedWrites: 0,
  entityCount: 0,
  quoteCount: 0,
  lastError: ''
};

const TAB_LABELS = {
  quotation: 'Quotation Builder',
  pvcalc: 'PV + ESS Calculator',
  costcalc: 'Quote Settings',
  database: 'Product List',
  pricelist: 'Price List',
  inventory: 'Inventory Mgmt',
  transport: 'Transport Mgmt',
  admin: 'Admin Backend'
};

const RESOURCE_LABELS = {
  quotes: 'Quotation',
  products: 'Products',
  priceList: 'Price List',
  inventory: 'Inventory',
  transport: 'Transport',
  suppliers: 'Suppliers',
  quoteSettings: 'Quote Settings',
  admin: 'Admin Backend'
};

const ACTION_LABELS = {
  read: 'Read',
  edit: 'Edit',
  delete: 'Delete',
  upload: 'Upload',
  download: 'Download',
  approve: 'Approve',
  approvalRequest: 'Request Approval'
};

const SENSITIVE_LABELS = {
  cost: 'Cost',
  margin: 'Margin',
  supplierContact: 'Supplier Contacts'
};

const ADMIN_PANELS = [
  ['dashboard', 'Dashboard'],
  ['users', 'Users'],
  ['permissions', 'Role Permissions'],
  ['approvals', 'Approvals'],
  ['logs', 'Operation Logs']
];

function publishAuthApi() {
  const api = window.__minovaAuth && typeof window.__minovaAuth === 'object' ? window.__minovaAuth : {};
  Object.assign(api, {
    state,
    canAccessTab: tab => canAccessTab(state.permission, tab),
    canPerformAction: (resource, action) => canPerformAction(state.permission, resource, action),
    canViewSensitiveField: field => canViewSensitiveField(state.permission, field),
    evaluateLocalQuote,
    requestQuoteApproval,
    auditEvent,
    logout
  });
  try {
    window.__minovaAuth = api;
  } catch {
    // Some embedded browser bridges make window non-extensible after load.
  }
}

function publishBusinessApi() {
  const api = window.__minovaBusiness && typeof window.__minovaBusiness === 'object' ? window.__minovaBusiness : {};
  Object.assign(api, {
    state: businessState,
    bootstrap: bootstrapBusinessData,
    upsertEntity: (domain, recordId, payload) => businessWrite('/business/entity/upsert', { domain, recordId, payload }),
    upsertEntities: (items) => businessWrite('/business/entity/upsert', { items }),
    deleteEntity: (domain, recordId) => businessWrite('/business/entity/delete', { domain, recordId }),
    saveSettings: (settings) => businessWrite('/business/settings', { settings }),
    saveQuote: (quote) => businessWrite('/quotes', quote),
    getQuote: (id) => authFetch(`/quotes/${encodeURIComponent(id)}`),
    deleteQuote: (id) => businessWrite('/quotes/delete', { id }),
    persistStateSnapshot,
    migrateFromStatic
  });
  try {
    window.__minovaBusiness = api;
  } catch {
    // Keep the UI usable even if an embedded browser locks globals.
  }
}

function syncAuthDomState() {
  const authenticated = !!state.user;
  const syncAuthorized = authenticated && canAccessDataSync(state.permission);
  document.body.classList.toggle('minova-authenticated', authenticated);
  document.body.classList.toggle('minova-sync-authorized', syncAuthorized);
  if (authenticated) document.body.dataset.minovaAuthUser = state.user.username || state.user.name || 'user';
  else delete document.body.dataset.minovaAuthUser;
  document.dispatchEvent(new CustomEvent('minova-auth-changed', { detail: { authenticated, syncAuthorized } }));
}

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[ch]));

const authFetch = async (path, options = {}) => {
  const headers = {
    'content-type': 'application/json',
    ...(state.sessionToken ? { authorization: `Bearer ${state.sessionToken}` } : {}),
    ...(options.headers || {})
  };
  let res;
  try {
    res = await fetch(`${state.apiBase}${path}`, {
      ...options,
      credentials: 'include',
      headers
    });
  } catch (error) {
    const defaultBase = normalizeApiBase(DEFAULT_API_BASE_URL);
    const currentBase = normalizeApiBase(state.apiBase);
    if (defaultBase && currentBase && currentBase !== defaultBase) {
      state.apiBase = defaultBase;
      try { localStorage.setItem(AUTH_API_BASE_KEY, defaultBase); } catch {}
      res = await fetch(`${state.apiBase}${path}`, {
        ...options,
        credentials: 'include',
        headers
      });
    } else {
      throw error;
    }
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.error || `Request failed: ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
};

const businessRecordIdFor = (record, index = 0) => {
  const value = record?.id ?? record?.recordId ?? record?.quoteId ?? record?.sku ?? record?.code ?? record?.batchNo ?? record?.orderNo ?? '';
  return String(value || `record-${index + 1}`).trim();
};

const BUSINESS_RESOURCE_BY_DOMAIN = {
  product: 'products',
  inventory: 'inventory',
  inventory_history: 'inventory',
  sales_record: 'inventory',
  historical_inventory: 'inventory',
  transport: 'transport',
  market_price: 'priceList',
  saved_quote: 'quotes'
};

function canWriteBusinessDomain(domain) {
  const resource = BUSINESS_RESOURCE_BY_DOMAIN[domain];
  return !!resource && canPerformAction(state.permission, resource, 'edit');
}

function businessSnapshotToPayload(snapshot = {}) {
  const data = snapshot?.data && typeof snapshot.data === 'object' ? snapshot.data : snapshot;
  const arr = value => Array.isArray(value) ? value : [];
  const items = [
    ...arr(data.products).map((record, index) => ({ domain: 'product', recordId: businessRecordIdFor(record, index), payload: record })),
    ...arr(data.inventory).map((record, index) => ({ domain: 'inventory', recordId: businessRecordIdFor(record, index), payload: record })),
    ...arr(data.inventoryHistory).map((record, index) => ({ domain: 'inventory_history', recordId: businessRecordIdFor(record, index), payload: record })),
    ...arr(data.salesRecords).map((record, index) => ({ domain: 'sales_record', recordId: businessRecordIdFor(record, index), payload: record })),
    ...arr(data.historicalInventory).map((record, index) => ({ domain: 'historical_inventory', recordId: businessRecordIdFor(record, index), payload: record })),
    ...arr(data.transportRecords).map((record, index) => ({ domain: 'transport', recordId: businessRecordIdFor(record, index), payload: record })),
    ...arr(data.marketPrices?.records).map((record, index) => ({ domain: 'market_price', recordId: businessRecordIdFor(record, index), payload: record }))
  ].filter(item => item.recordId && item.payload && typeof item.payload === 'object');
  const settings = {
    market_price_settings: {
      categoryUnits: data.marketPrices?.categoryUnits || {},
      deletedRecordIds: data.marketPrices?.deletedRecordIds || []
    },
    subcategories_by_category: data.subcategoriesByCategory || {},
    profit_settings: data.profitSettings || {},
    installer_profit_settings: data.installerProfitSettings || {},
    installer_quote_settings: data.installerQuoteSettings || {},
    non_stock_pricing_strategies: data.nonStockPricingStrategies || {}
  };
  return { items, settings };
}

async function businessWrite(path, body) {
  businessState.pendingWrites += 1;
  businessState.lastError = '';
  publishBusinessApi();
  try {
    const data = await authFetch(path, {
      method: 'POST',
      body: JSON.stringify(body || {})
    });
    businessState.lastPersistAt = new Date().toISOString();
    return data;
  } catch (error) {
    businessState.failedWrites += 1;
    businessState.lastError = error.message || String(error);
    throw error;
  } finally {
    businessState.pendingWrites = Math.max(0, businessState.pendingWrites - 1);
    renderAdminDashboard();
    publishBusinessApi();
  }
}

let persistTimer = null;
let queuedSnapshot = null;
function persistStateSnapshot(snapshot) {
  if (!state.user || !snapshot) return Promise.resolve({ skipped: true });
  queuedSnapshot = snapshot;
  if (persistTimer) clearTimeout(persistTimer);
  return new Promise(resolve => {
    persistTimer = setTimeout(async () => {
      const current = queuedSnapshot;
      queuedSnapshot = null;
      persistTimer = null;
      try {
        const payload = businessSnapshotToPayload(current);
        const allowedItems = payload.items.filter(item => canWriteBusinessDomain(item.domain));
        const allowedSettings = {};
        if (canPerformAction(state.permission, 'priceList', 'edit')) {
          allowedSettings.market_price_settings = payload.settings.market_price_settings;
          allowedSettings.subcategories_by_category = payload.settings.subcategories_by_category;
          allowedSettings.non_stock_pricing_strategies = payload.settings.non_stock_pricing_strategies;
        }
        if (canPerformAction(state.permission, 'quoteSettings', 'edit')) {
          allowedSettings.profit_settings = payload.settings.profit_settings;
          allowedSettings.installer_profit_settings = payload.settings.installer_profit_settings;
          allowedSettings.installer_quote_settings = payload.settings.installer_quote_settings;
        }
        if (allowedItems.length) await businessWrite('/business/entity/upsert', { items: allowedItems });
        if (Object.keys(allowedSettings).length) await businessWrite('/business/settings', { settings: allowedSettings });
        businessState.source = 'd1';
        businessState.hasD1Data = true;
        businessState.entityCount = allowedItems.length;
        resolve({ ok: true, count: allowedItems.length });
      } catch (error) {
        console.warn('D1 business persist failed; static/GitHub fallback remains active.', error);
        resolve({ ok: false, error: error.message || String(error) });
      }
    }, 600);
  });
}

async function bootstrapBusinessData({ apply = true } = {}) {
  if (!state.user) return null;
  try {
    const data = await authFetch('/business/bootstrap');
    businessState.loaded = true;
    businessState.source = data.hasD1Data ? 'd1' : 'static';
    businessState.hasD1Data = !!data.hasD1Data;
    businessState.lastBootstrapAt = new Date().toISOString();
    businessState.entityCount = Object.values(data.updatedAt || {}).filter(Boolean).length;
    businessState.quoteCount = Array.isArray(data.quoteIndex?.quotes) ? data.quoteIndex.quotes.length : 0;
    businessState.lastError = '';
    if (apply && data.hasD1Data && typeof window.applyBusinessDataFromD1 === 'function') {
      window.applyBusinessDataFromD1(data.data || {}, data.quoteIndex || null);
    } else if (apply && data.quoteIndex && typeof window.applyD1QuoteIndex === 'function') {
      window.applyD1QuoteIndex(data.quoteIndex);
    }
    document.dispatchEvent(new CustomEvent('minova-business-sync', { detail: businessState }));
    renderAdminDashboard();
    publishBusinessApi();
    return data;
  } catch (error) {
    businessState.loaded = false;
    businessState.source = 'fallback';
    businessState.lastError = error.message || String(error);
    document.dispatchEvent(new CustomEvent('minova-business-sync', { detail: businessState }));
    renderAdminDashboard();
    publishBusinessApi();
    return null;
  }
}

async function migrateFromStatic(snapshot = window.getMinovaBusinessStateSnapshot?.()) {
  if (!snapshot) throw new Error('No static business snapshot is available.');
  const body = {
    state: snapshot?.data ? snapshot : { v: 1, updatedAt: new Date().toISOString(), data: snapshot },
    quotes: window.getSavedQuoteDocumentsForD1?.() || []
  };
  const data = await businessWrite('/admin/business/migrate-from-static', body);
  businessState.lastMigrationAt = new Date().toISOString();
  businessState.hasD1Data = true;
  businessState.source = 'd1';
  businessState.entityCount = data.itemCount || businessState.entityCount;
  return data;
}

async function auditEvent(action, targetType = '', targetId = '', detail = {}) {
  try {
    await authFetch('/audit', {
      method: 'POST',
      body: JSON.stringify({ action, targetType, targetId, detail })
    });
  } catch {
    // Audit is best-effort on the browser side; server-side admin actions still write authoritative logs.
  }
}

function currentQuoteRows() {
  const rows = window.__getQuoteRows?.() || window.quoteRows || [];
  return Array.isArray(rows) ? rows : [];
}

function quotePayload() {
  return {
    quoteNo: document.getElementById('quote-no')?.value || '',
    customerName: document.getElementById('input-customer-name')?.value || '',
    quoteRows: currentQuoteRows().map(row => ({
      id: row.id,
      description: row.description || row.descEn || '',
      productId: row.productId || '',
      quantity: Number(row.quantity) || 0,
      basePrice: Number(row.basePrice || row.authBasePrice || row.price || 0),
      price: Number(row.price || 0),
      isBlank: !!row.isBlank
    }))
  };
}

function evaluateLocalQuote() {
  if (!state.permission) return null;
  state.quoteCheck = evaluateQuotePriceAdjustment(state.permission, quotePayload().quoteRows);
  renderQuoteGuard();
  return state.quoteCheck;
}

function ensureAuthShell() {
  if (document.getElementById('minova-auth-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'minova-auth-overlay';
  overlay.className = 'fixed inset-0 z-[10000] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4';
  overlay.innerHTML = `
    <div class="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
      <div class="bg-[#582C83] text-white px-6 py-5">
        <p class="text-xs font-black uppercase tracking-widest opacity-70">Minova Management System</p>
        <h2 class="text-xl font-black mt-1">Backend Login</h2>
      </div>
      <form id="minova-login-form" class="p-6 space-y-4">
        <div>
          <label class="text-xs font-black text-slate-500 uppercase">Account</label>
          <input id="minova-login-username" autocomplete="username" class="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-purple-700" value="admin">
        </div>
        <div>
          <label class="text-xs font-black text-slate-500 uppercase">Password</label>
          <input id="minova-login-password" type="password" autocomplete="current-password" class="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-purple-700">
        </div>
        <p id="minova-login-message" class="hidden text-xs font-bold rounded-lg px-3 py-2"></p>
        <button class="w-full rounded-xl bg-slate-900 text-white font-black py-2.5 hover:bg-black" type="submit">Login</button>
        <button id="minova-forgot-password-open" class="w-full text-xs font-black text-purple-700 hover:text-purple-900" type="button">Forgot password?</button>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#minova-login-form').addEventListener('submit', onLoginSubmit);
  overlay.querySelector('#minova-forgot-password-open').addEventListener('click', showForgotPasswordModal);

  const passwordModal = document.createElement('div');
  passwordModal.id = 'minova-password-change-modal';
  passwordModal.className = 'fixed inset-0 z-[10001] bg-slate-950/80 backdrop-blur-sm hidden items-center justify-center p-4';
  passwordModal.innerHTML = `
    <div class="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
      <div class="bg-amber-500 text-white px-6 py-5">
        <p class="text-xs font-black uppercase tracking-widest opacity-80">Required</p>
        <h2 class="text-xl font-black mt-1">Change Temporary Password</h2>
      </div>
      <form id="minova-password-change-form" class="p-6 space-y-4">
        <div>
          <label class="text-xs font-black text-slate-500 uppercase">New Password</label>
          <input id="minova-next-password" type="password" autocomplete="new-password" class="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-purple-700">
        </div>
        <div>
          <label class="text-xs font-black text-slate-500 uppercase">Confirm New Password</label>
          <input id="minova-next-password-confirm" type="password" autocomplete="new-password" class="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-purple-700">
        </div>
        <p id="minova-password-message" class="text-xs font-bold text-slate-500">Use at least 8 characters.</p>
        <button class="w-full rounded-xl bg-slate-900 text-white font-black py-2.5 hover:bg-black" type="submit">Update Password</button>
      </form>
    </div>
  `;
  document.body.appendChild(passwordModal);
  passwordModal.querySelector('#minova-password-change-form').addEventListener('submit', onPasswordSubmit);

  const forgotModal = document.createElement('div');
  forgotModal.id = 'minova-forgot-password-modal';
  forgotModal.className = 'fixed inset-0 z-[10002] bg-slate-950/80 backdrop-blur-sm hidden items-center justify-center p-4';
  forgotModal.innerHTML = `
    <div class="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
      <div class="bg-[#582C83] text-white px-6 py-5 flex items-start justify-between gap-4">
        <div>
          <p class="text-xs font-black uppercase tracking-widest opacity-70">Account Recovery</p>
          <h2 class="text-xl font-black mt-1">Forgot Password</h2>
        </div>
        <button id="minova-forgot-password-close" type="button" class="text-white/80 hover:text-white text-xl leading-none">&times;</button>
      </div>
      <form id="minova-forgot-password-form" class="p-6 space-y-4">
        <div>
          <label class="text-xs font-black text-slate-500 uppercase">Email</label>
          <input id="minova-forgot-email" type="email" autocomplete="email" placeholder="name@example.com" class="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-purple-700">
        </div>
        <p id="minova-forgot-message" class="text-xs font-bold text-slate-500 leading-relaxed">Enter the email saved in the backend account. A temporary password will be generated for immediate login.</p>
        <div id="minova-forgot-result" class="hidden rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
          <div class="font-black mb-1">Temporary Password</div>
          <code id="minova-forgot-temp-password" class="block rounded-lg bg-white border border-emerald-100 px-3 py-2 text-sm font-black text-slate-900 select-all"></code>
          <p class="mt-2 leading-relaxed">Use this password to log in, then set a new password when prompted.</p>
        </div>
        <button class="w-full rounded-xl bg-slate-900 text-white font-black py-2.5 hover:bg-black" type="submit">Reset Password</button>
      </form>
    </div>
  `;
  document.body.appendChild(forgotModal);
  forgotModal.querySelector('#minova-forgot-password-form').addEventListener('submit', onForgotPasswordSubmit);
  forgotModal.querySelector('#minova-forgot-password-close').addEventListener('click', hideForgotPasswordModal);
  forgotModal.addEventListener('click', event => {
    if (event.target === forgotModal) hideForgotPasswordModal();
  });
}

function setLoginMessage(text, kind = 'error') {
  const el = document.getElementById('minova-login-message');
  if (!el) return;
  el.textContent = text;
  el.className = `text-xs font-bold rounded-lg px-3 py-2 ${kind === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`;
}

function resetLoginFormState() {
  const msg = document.getElementById('minova-login-message');
  const password = document.getElementById('minova-login-password');
  const form = document.getElementById('minova-login-form');
  if (msg) {
    msg.textContent = '';
    msg.className = 'hidden text-xs font-bold rounded-lg px-3 py-2';
  }
  if (password) password.value = '';
  form?.querySelectorAll('button, input').forEach(el => {
    if (el.dataset.authLocked === 'true') return;
    el.disabled = false;
  });
}

async function onLoginSubmit(event) {
  event.preventDefault();
  const username = document.getElementById('minova-login-username')?.value || '';
  const password = document.getElementById('minova-login-password')?.value || '';
  try {
    setLoginMessage('Signing in...', 'info');
    const data = await authFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    setSession(data.user, data.permission, data.sessionToken, data.sessionExpiresAt);
    if (data.user?.forcePasswordChange) showPasswordChangeModal();
    else unlockApp();
  } catch (error) {
    setLoginMessage(error.status === 401 ? 'Invalid account or password.' : `Login failed: ${error.message}`);
  }
}

async function onPasswordSubmit(event) {
  event.preventDefault();
  const nextPassword = document.getElementById('minova-next-password')?.value || '';
  const nextPasswordConfirm = document.getElementById('minova-next-password-confirm')?.value || '';
  const msg = document.getElementById('minova-password-message');
  try {
    if (nextPassword !== nextPasswordConfirm) {
      if (msg) msg.textContent = 'Passwords do not match.';
      return;
    }
    if (msg) msg.textContent = 'Updating...';
    await authFetch('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ nextPassword, nextPasswordConfirm })
    });
    if (state.user) state.user.forcePasswordChange = false;
    hidePasswordChangeModal();
    unlockApp();
  } catch (error) {
    if (msg) msg.textContent = error.status === 400 ? (error.data?.error === 'password_mismatch' ? 'Passwords do not match.' : 'Password must be at least 8 characters.') : `Failed: ${error.message}`;
  }
}

async function onForgotPasswordSubmit(event) {
  event.preventDefault();
  const email = document.getElementById('minova-forgot-email')?.value || '';
  const msg = document.getElementById('minova-forgot-message');
  const result = document.getElementById('minova-forgot-result');
  const code = document.getElementById('minova-forgot-temp-password');
  try {
    if (msg) {
      msg.textContent = 'Resetting password...';
      msg.className = 'text-xs font-bold text-slate-500 leading-relaxed';
    }
    if (result) result.classList.add('hidden');
    const data = await authFetch('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email })
    });
    if (code) code.textContent = data.temporaryPassword || '';
    if (result) result.classList.remove('hidden');
    if (msg) {
      msg.textContent = `${data.name || data.username || 'Account'} has been reset.`;
      msg.className = 'text-xs font-bold text-emerald-700 leading-relaxed';
    }
    const usernameInput = document.getElementById('minova-login-username');
    const passwordInput = document.getElementById('minova-login-password');
    if (usernameInput && data.username) usernameInput.value = data.username;
    if (passwordInput && data.temporaryPassword) passwordInput.value = data.temporaryPassword;
  } catch (error) {
    if (msg) {
      msg.textContent = error.status === 404 ? 'No active backend account uses this email.' : error.status === 400 ? 'Please enter a valid email address.' : `Reset failed: ${error.message}`;
      msg.className = 'text-xs font-bold text-red-700 leading-relaxed';
    }
  }
}

function setSession(user, permission, sessionToken = state.sessionToken, sessionExpiresAt = state.sessionExpiresAt) {
  state.user = user || null;
  state.permission = mergePermissionSnapshot(user || {}, permission || getDefaultPermissionSnapshot(user?.role || 'read_only'));
  state.sessionToken = String(sessionToken || '');
  state.sessionExpiresAt = String(sessionExpiresAt || '');
  try {
    if (state.sessionToken) localStorage.setItem(AUTH_SESSION_KEY, state.sessionToken);
    if (state.sessionExpiresAt) localStorage.setItem(AUTH_SESSION_EXPIRES_KEY, state.sessionExpiresAt);
  } catch {}
  state.ready = true;
  state.locked = false;
  syncAuthDomState();
  publishAuthApi();
  publishBusinessApi();
}

function lockApp() {
  state.locked = true;
  syncAuthDomState();
  ensureAuthShell();
  const overlay = document.getElementById('minova-auth-overlay');
  if (overlay) overlay.classList.remove('hidden');
  document.body.classList.add('minova-auth-locked');
}

function unlockApp() {
  state.locked = false;
  const overlay = document.getElementById('minova-auth-overlay');
  if (overlay) overlay.classList.add('hidden');
  document.body.classList.remove('minova-auth-locked');
  ensureAdminTab();
  bootstrapBusinessData().finally(() => {
    applyPermissions();
    renderAuthBadge();
    renderWatermark();
    evaluateLocalQuote();
    if (canAccessTab(state.permission, 'admin')) renderAdminDashboard();
  });
  applyPermissions();
  renderAuthBadge();
  renderWatermark();
  evaluateLocalQuote();
  switchToFirstAllowedTab();
}

function showPasswordChangeModal() {
  const modal = document.getElementById('minova-password-change-modal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
}

function hidePasswordChangeModal() {
  const modal = document.getElementById('minova-password-change-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

function showForgotPasswordModal() {
  const modal = document.getElementById('minova-forgot-password-modal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
  const msg = document.getElementById('minova-forgot-message');
  const result = document.getElementById('minova-forgot-result');
  if (msg) {
    msg.textContent = 'Enter the email saved in the backend account. A temporary password will be generated for immediate login.';
    msg.className = 'text-xs font-bold text-slate-500 leading-relaxed';
  }
  if (result) result.classList.add('hidden');
  setTimeout(() => document.getElementById('minova-forgot-email')?.focus(), 30);
}

function hideForgotPasswordModal() {
  const modal = document.getElementById('minova-forgot-password-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

async function logout() {
  try { await authFetch('/auth/logout', { method: 'POST', body: '{}' }); } catch {}
  state.user = null;
  state.permission = null;
  state.sessionToken = '';
  state.sessionExpiresAt = '';
  state.ready = false;
  Object.assign(businessState, {
    loaded: false,
    source: 'static',
    hasD1Data: false,
    pendingWrites: 0,
    lastError: ''
  });
  syncAuthDomState();
  publishBusinessApi();
  try {
    localStorage.removeItem(AUTH_SESSION_KEY);
    localStorage.removeItem(AUTH_SESSION_EXPIRES_KEY);
  } catch {}
  resetLoginFormState();
  lockApp();
}

function ensureAdminTab() {
  if (!document.getElementById('tab-admin')) {
    const nav = document.querySelector('.app-shell-nav');
    const button = document.createElement('button');
    button.id = 'tab-admin';
    button.type = 'button';
    button.className = 'app-shell-tab px-6 py-2 hover:text-purple-700 transition-all text-sm leading-tight text-center text-slate-500 hover:text-blue-600';
    button.innerHTML = '<span class="block">Admin</span><span class="block">Backend</span>';
    button.addEventListener('click', () => window.switchTab?.('admin'));
    nav?.appendChild(button);
  }
  if (!document.getElementById('view-admin')) {
    const main = document.createElement('main');
    main.id = 'view-admin';
    main.className = 'max-w-7xl mx-auto px-4 mb-20 hidden';
    main.style.display = 'none';
    main.innerHTML = `
      <section class="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div class="p-5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 class="text-xl font-black text-slate-800">Permission Backend</h2>
            <p class="text-xs text-slate-400 mt-1">Manage users, roles, permissions, quote limits, approvals and audit logs from Cloudflare Worker + D1.</p>
          </div>
          <button id="minova-admin-refresh" type="button" class="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-black">Refresh</button>
        </div>
        <div class="px-5 pt-5">
          <p id="minova-admin-status" class="hidden rounded-xl px-4 py-3 text-xs font-bold"></p>
        </div>
        <div class="p-5 border-b border-slate-100">
          <div id="minova-admin-current-user" class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-3"></div>
        </div>
        <div class="px-5 pt-5 border-b border-slate-100">
          <div id="minova-admin-panel-tabs" class="flex flex-wrap gap-2"></div>
        </div>
        <div class="p-5">
          <section id="minova-admin-panel-dashboard" data-admin-panel="dashboard" class="space-y-5">
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div class="border border-slate-200 rounded-xl p-4">
                <h3 class="text-sm font-black text-slate-700 mb-2">Storage Map</h3>
                <div class="text-xs text-slate-500 leading-relaxed space-y-2">
                  <p><b>Backend data:</b> users, roles, permissions, approvals and audit logs are stored in Cloudflare D1.</p>
                  <p><b>Business data:</b> products, inventory, transport, Price List, quote settings and saved quotes now write to D1 first.</p>
                  <p><b>Backup:</b> GitHub <code>minova-data/state.json</code>, <code>minova-data/quotes/</code>, localStorage and IndexedDB remain as transition backups.</p>
                </div>
              </div>
              <div class="border border-slate-200 rounded-xl p-4">
                <h3 class="text-sm font-black text-slate-700 mb-2">D1 Migration</h3>
                <p class="text-xs text-slate-500 leading-relaxed mb-3">Use this once after login to backfill the current embedded/local business data into D1. The operation is idempotent by domain and record ID.</p>
                <button id="minova-admin-migrate-business" type="button" class="rounded-xl bg-purple-700 text-white text-xs font-black px-4 py-2 disabled:opacity-40">Migrate Current Data to D1</button>
              </div>
              <div class="border border-slate-200 rounded-xl p-4">
                <h3 class="text-sm font-black text-slate-700 mb-2">Risk Watch</h3>
                <div id="minova-admin-risk-summary" class="text-xs text-slate-500 space-y-1"></div>
              </div>
            </div>
          </section>
          <section id="minova-admin-panel-users" data-admin-panel="users" class="hidden space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 class="text-lg font-black text-slate-800">Users</h3>
                <p class="text-xs text-slate-400 mt-1">Create users, assign roles, reset temporary passwords, and disable access.</p>
              </div>
              <label class="inline-flex items-center gap-2 text-xs font-black text-slate-500">
                <input id="minova-admin-show-inactive" type="checkbox">
                Show inactive users
              </label>
            </div>
            <form id="minova-admin-create-user-form" class="grid grid-cols-1 md:grid-cols-6 gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3">
              <input id="minova-admin-new-username" class="border border-slate-200 rounded-lg px-3 py-2 text-xs" placeholder="Account">
              <input id="minova-admin-new-name" class="border border-slate-200 rounded-lg px-3 py-2 text-xs" placeholder="Name">
              <input id="minova-admin-new-email" type="email" class="border border-slate-200 rounded-lg px-3 py-2 text-xs" placeholder="Email">
              <select id="minova-admin-new-role" class="border border-slate-200 rounded-lg px-3 py-2 text-xs"></select>
              <input id="minova-admin-new-password" type="password" class="border border-slate-200 rounded-lg px-3 py-2 text-xs" placeholder="Initial password (6+ chars)">
              <button class="rounded-lg bg-slate-900 text-white text-xs font-black px-3 py-2" type="submit">Add User</button>
            </form>
            <div id="minova-admin-users" class="overflow-x-auto border border-slate-200 rounded-xl">Loading...</div>
          </section>
          <section id="minova-admin-panel-permissions" data-admin-panel="permissions" class="hidden space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 class="text-lg font-black text-slate-800">Role Permissions</h3>
                <p class="text-xs text-slate-400 mt-1">Select a role, adjust tabs, actions, sensitive fields, quote limits and watermark.</p>
              </div>
              <div class="flex items-center gap-2">
                <select id="minova-admin-role-select" class="border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold"></select>
                <button id="minova-admin-save-permission" type="button" class="rounded-xl bg-purple-700 text-white text-xs font-black px-4 py-2">Save Role Permission</button>
              </div>
            </div>
            <div id="minova-admin-permission-editor" class="space-y-5"></div>
          </section>
          <section id="minova-admin-panel-approvals" data-admin-panel="approvals" class="hidden space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 class="text-lg font-black text-slate-800">Approvals</h3>
                <p class="text-xs text-slate-400 mt-1">Review over-limit quote price adjustment requests.</p>
              </div>
              <button id="minova-admin-refresh-approvals" type="button" class="rounded-xl bg-slate-900 text-white text-xs font-black px-4 py-2">Refresh Approvals</button>
            </div>
            <div id="minova-admin-approvals" class="overflow-x-auto border border-slate-200 rounded-xl">Loading...</div>
          </section>
          <section id="minova-admin-panel-logs" data-admin-panel="logs" class="hidden space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 class="text-lg font-black text-slate-800">Operation Logs</h3>
                <p class="text-xs text-slate-400 mt-1">Login, user management, permission changes, approval actions and frontend audit events.</p>
              </div>
              <button id="minova-admin-refresh-logs" type="button" class="rounded-xl bg-slate-900 text-white text-xs font-black px-4 py-2">Refresh Logs</button>
            </div>
            <form id="minova-admin-log-filter" class="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3">
              <input id="minova-admin-log-user" class="border border-slate-200 rounded-lg px-3 py-2 text-xs" placeholder="User / account">
              <input id="minova-admin-log-action" class="border border-slate-200 rounded-lg px-3 py-2 text-xs" placeholder="Action">
              <input id="minova-admin-log-limit" type="number" min="1" max="200" class="border border-slate-200 rounded-lg px-3 py-2 text-xs" value="100">
              <button class="rounded-lg bg-slate-900 text-white text-xs font-black px-3 py-2" type="submit">Apply Filter</button>
            </form>
            <div id="minova-admin-logs" class="overflow-x-auto border border-slate-200 rounded-xl">Loading...</div>
          </section>
        </div>
      </section>
    `;
    document.body.insertBefore(main, document.getElementById('cert-attachment-modal') || null);
    main.querySelector('#minova-admin-refresh')?.addEventListener('click', loadAdminPanel);
    main.querySelector('#minova-admin-create-user-form')?.addEventListener('submit', onAdminCreateUser);
    main.querySelector('#minova-admin-show-inactive')?.addEventListener('change', event => {
      adminState.showInactiveUsers = !!event.target.checked;
      renderAdminUsers();
    });
    main.querySelector('#minova-admin-role-select')?.addEventListener('change', event => {
      adminState.selectedRole = event.target.value || 'read_only';
      renderPermissionEditor();
    });
    main.querySelector('#minova-admin-save-permission')?.addEventListener('click', onAdminSavePermission);
    main.querySelector('#minova-admin-migrate-business')?.addEventListener('click', onAdminMigrateBusiness);
    main.querySelector('#minova-admin-refresh-approvals')?.addEventListener('click', loadAdminApprovals);
    main.querySelector('#minova-admin-refresh-logs')?.addEventListener('click', loadAdminLogs);
    main.querySelector('#minova-admin-log-filter')?.addEventListener('submit', event => {
      event.preventDefault();
      loadAdminLogs();
    });
  }
  ensureAdminResetModal();
}

function ensureAdminResetModal() {
  if (document.getElementById('minova-admin-reset-modal')) return;
  const modal = document.createElement('div');
  modal.id = 'minova-admin-reset-modal';
  modal.className = 'fixed inset-0 z-[10003] bg-slate-950/70 backdrop-blur-sm hidden items-center justify-center p-4';
  modal.innerHTML = `
    <div class="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
      <div class="bg-slate-900 text-white px-6 py-5 flex items-start justify-between gap-4">
        <div>
          <p class="text-xs font-black uppercase tracking-widest opacity-70">Admin Verification</p>
          <h2 class="text-xl font-black mt-1">Reset User Password</h2>
        </div>
        <button id="minova-admin-reset-close" type="button" class="text-white/80 hover:text-white text-xl leading-none">&times;</button>
      </div>
      <form id="minova-admin-reset-form" class="p-6 space-y-4">
        <p id="minova-admin-reset-target" class="text-xs text-slate-500 leading-relaxed"></p>
        <div>
          <label class="text-xs font-black text-slate-500 uppercase">Current Admin Password</label>
          <input id="minova-admin-reset-password" type="password" autocomplete="current-password" class="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-purple-700">
        </div>
        <p id="minova-admin-reset-message" class="text-xs font-bold text-slate-500">The target user will be forced to change this temporary password on next login.</p>
        <div id="minova-admin-reset-result" class="hidden rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
          <div class="font-black mb-1">Temporary Password</div>
          <code id="minova-admin-reset-temp-password" class="block rounded-lg bg-white border border-emerald-100 px-3 py-2 text-sm font-black text-slate-900 select-all"></code>
        </div>
        <button class="w-full rounded-xl bg-slate-900 text-white font-black py-2.5 hover:bg-black" type="submit">Reset Password</button>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('#minova-admin-reset-close')?.addEventListener('click', hideAdminResetModal);
  modal.querySelector('#minova-admin-reset-form')?.addEventListener('submit', onAdminResetSubmit);
  modal.addEventListener('click', event => {
    if (event.target === modal) hideAdminResetModal();
  });
}

function showAdminResetModal(userId) {
  const user = adminState.users.find(item => String(item.id) === String(userId));
  if (!user) return;
  adminState.resetUserId = user.id;
  const modal = document.getElementById('minova-admin-reset-modal');
  const target = document.getElementById('minova-admin-reset-target');
  const password = document.getElementById('minova-admin-reset-password');
  const msg = document.getElementById('minova-admin-reset-message');
  const result = document.getElementById('minova-admin-reset-result');
  const code = document.getElementById('minova-admin-reset-temp-password');
  if (target) target.innerHTML = `Reset password for <b>${escapeHtml(user.name || user.username)}</b> (${escapeHtml(user.username || '')}).`;
  if (password) password.value = '';
  if (msg) {
    msg.textContent = 'The target user will be forced to change this temporary password on next login.';
    msg.className = 'text-xs font-bold text-slate-500';
  }
  if (code) code.textContent = '';
  if (result) result.classList.add('hidden');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
  setTimeout(() => password?.focus(), 30);
}

function hideAdminResetModal() {
  const modal = document.getElementById('minova-admin-reset-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

function renderAuthBadge() {
  let badge = document.getElementById('minova-auth-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'minova-auth-badge';
    badge.className = 'flex items-center gap-2';
    document.querySelector('.app-shell-actions')?.prepend(badge);
  }
  badge.innerHTML = `
    <span class="hidden lg:inline-flex px-3 py-2 rounded-xl bg-purple-50 text-purple-800 border border-purple-100 text-[11px] font-black">
      ${escapeHtml(state.user?.name || '-')}: ${escapeHtml(state.permission?.roleName || '-')}
    </span>
    <button type="button" id="minova-auth-logout" class="px-3 py-2 rounded-xl bg-slate-100 text-slate-600 border border-slate-200 text-[11px] font-black hover:bg-slate-200">Logout</button>
  `;
  badge.querySelector('#minova-auth-logout')?.addEventListener('click', logout);
}

function renderWatermark() {
  let watermark = document.getElementById('minova-auth-watermark');
  if (!watermark) {
    watermark = document.createElement('div');
    watermark.id = 'minova-auth-watermark';
    watermark.className = 'fixed inset-0 z-[50] pointer-events-none no-print minova-auth-watermark';
    document.body.appendChild(watermark);
  }
  const quotationView = document.getElementById('view-quotation');
  const quotationVisible = quotationView
    && !quotationView.classList.contains('hidden')
    && quotationView.style.display !== 'none';
  if (!state.permission?.watermark?.enabled || !quotationVisible) {
    watermark.innerHTML = '';
    return;
  }
  const text = buildWatermarkText({
    user: state.user
  });
  watermark.innerHTML = Array.from({ length: 6 }, () => `<span>${escapeHtml(text)}</span>`).join('');
}

function applyPermissions() {
  if (!state.permission) return;
  ALL_TABS.forEach(tab => {
    const allowed = canAccessTab(state.permission, tab);
    const btn = document.getElementById(`tab-${tab}`);
    const view = document.getElementById(`view-${tab}`);
    if (btn) btn.style.display = allowed ? '' : 'none';
    if (!allowed && view) {
      view.classList.add('hidden');
      view.style.display = 'none';
    }
  });

  const pdfBtn = document.getElementById('btn-generate-pdf');
  if (pdfBtn) pdfBtn.style.display = canPerformAction(state.permission, 'quotes', 'download') ? '' : 'none';
  lockResourceView('view-quotation', 'quotes');
  lockResourceView('view-database', 'products');
  lockResourceView('view-inventory', 'inventory');
  lockResourceView('view-transport', 'transport');
  lockResourceView('view-costcalc', 'quoteSettings');
  applySensitiveFieldMasks();
  loadAdminPanel();
}

function lockResourceView(viewId, resource) {
  const view = document.getElementById(viewId);
  if (!view) return;
  const canEdit = canPerformAction(state.permission, resource, 'edit');
  const canDelete = canPerformAction(state.permission, resource, 'delete');
  view.querySelectorAll('input, textarea, select').forEach(el => {
    if (el.closest('#minova-auth-overlay, #minova-password-change-modal, #minova-forgot-password-modal')) return;
    if (el.type === 'search') return;
    if (!canEdit) {
      el.disabled = true;
      el.dataset.authLocked = 'true';
    } else if (el.dataset.authLocked === 'true') {
      el.disabled = false;
      delete el.dataset.authLocked;
    }
  });
  view.querySelectorAll('button').forEach(btn => {
    const text = String(btn.textContent || btn.title || '').toLowerCase();
    const isDelete = text.includes('delete') || text.includes('删除') || text.includes('✕') || text.includes('×');
    if (isDelete && !canDelete) btn.style.display = 'none';
    else if (isDelete) btn.style.display = '';
  });
}

function applySensitiveFieldMasks() {
  document.body.classList.toggle('minova-hide-cost', !canViewSensitiveField(state.permission, 'cost'));
  document.body.classList.toggle('minova-hide-margin', !canViewSensitiveField(state.permission, 'margin'));
  document.body.classList.toggle('minova-hide-supplier-contact', !canViewSensitiveField(state.permission, 'supplierContact'));
}

function switchToFirstAllowedTab() {
  const active = ALL_TABS.find(tab => {
    const view = document.getElementById(`view-${tab}`);
    return view && !view.classList.contains('hidden') && view.style.display !== 'none';
  });
  if (active && canAccessTab(state.permission, active)) return;
  const first = ALL_TABS.find(tab => canAccessTab(state.permission, tab));
  if (first) window.switchTab?.(first);
}

function renderQuoteGuard() {
  let guard = document.getElementById('minova-quote-guard');
  const quoteToolbar = document.querySelector('#view-quotation > .mb-4.no-print');
  if (!guard && quoteToolbar) {
    guard = document.createElement('div');
    guard.id = 'minova-quote-guard';
    guard.className = 'w-full rounded-xl border px-4 py-3 text-xs font-bold hidden';
    quoteToolbar.insertAdjacentElement('afterend', guard);
  }
  if (!guard || !state.quoteCheck) return;
  if (!state.quoteCheck.requiresApproval) {
    guard.className = 'w-full rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 px-4 py-3 text-xs font-bold';
    guard.innerHTML = `Quote price check passed. Max deviation ${state.quoteCheck.maxDeviationPct}% / limit ${state.quoteCheck.limitPct ?? 'unlimited'}.`;
    return;
  }
  guard.className = 'w-full rounded-xl border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-xs font-bold flex items-center justify-between gap-3';
  guard.innerHTML = `
    <span>Quote exceeds ${state.quoteCheck.limitPct}% price limit. Max deviation: ${state.quoteCheck.maxDeviationPct}%. PDF download is blocked.</span>
    <button type="button" id="minova-submit-quote-approval" class="px-3 py-2 rounded-lg bg-red-600 text-white text-xs font-black whitespace-nowrap">Submit Approval</button>
  `;
  guard.querySelector('#minova-submit-quote-approval')?.addEventListener('click', requestQuoteApproval);
}

async function requestQuoteApproval() {
  try {
    const data = await authFetch('/quote/approval-request', {
      method: 'POST',
      body: JSON.stringify(quotePayload())
    });
    const id = data.approvalId ? ` #${data.approvalId}` : '';
    window.alert?.(`Approval request submitted${id}.`);
  } catch (error) {
    window.alert?.(`Approval request failed: ${error.message}`);
  }
}

async function verifyQuoteBeforePdf() {
  if (!canPerformAction(state.permission, 'quotes', 'download')) {
    window.alert?.('Your role cannot download quote PDFs.');
    return false;
  }
  let check = evaluateLocalQuote();
  try {
    const remote = await authFetch('/quote/check', {
      method: 'POST',
      body: JSON.stringify(quotePayload())
    });
    check = remote;
    state.quoteCheck = remote;
    renderQuoteGuard();
  } catch (error) {
    window.alert?.(`Unable to verify quote permissions: ${error.message}`);
    return false;
  }
  if (check?.requiresApproval || check?.allowed === false) {
    renderQuoteGuard();
    window.alert?.('Quote price exceeds your approved range. Submit approval before downloading.');
    return false;
  }
  return true;
}

function patchGlobals() {
  const originalSwitchTab = window.switchTab;
  window.switchTab = (tab) => {
    if (!state.ready || state.locked) {
      lockApp();
      return;
    }
    if (!canAccessTab(state.permission, tab)) {
      window.alert?.('No permission to access this tab.');
      switchToFirstAllowedTab();
      return;
    }
    originalSwitchTab?.(tab);
    applyPermissions();
    renderWatermark();
  };

  const originalOpenCertAttachmentModal = window.openCertAttachmentModal;
  window.openCertAttachmentModal = async (...args) => {
    if (!(await verifyQuoteBeforePdf())) return;
    return originalOpenCertAttachmentModal?.(...args);
  };
  window.generateQuotationPDF = window.openCertAttachmentModal;

  const originalUpdateRow = window.updateRow;
  window.updateRow = (id, field, value) => {
    const rows = currentQuoteRows();
    const row = rows.find(r => String(r.id) === String(id));
    if (field === 'price') {
      if (!canPerformAction(state.permission, 'quotes', 'edit')) {
        window.alert?.('Your role cannot edit quote prices.');
        return;
      }
      if (row && !row.basePrice && !row.authBasePrice) {
        row.authBasePrice = Number(row.price || 0);
        row.basePrice = row.authBasePrice;
      }
    }
    const result = originalUpdateRow?.(id, field, value);
    if (field === 'price') evaluateLocalQuote();
    renderWatermark();
    return result;
  };

  const originalRenderQuote = window.renderQuote;
  if (typeof originalRenderQuote === 'function') {
    window.renderQuote = (...args) => {
      const result = originalRenderQuote(...args);
      applyPermissions();
      evaluateLocalQuote();
      renderWatermark();
      return result;
    };
  }
}

async function loadAdminPanel() {
  if (!state.permission || !canAccessTab(state.permission, 'admin')) return;
  renderAdminPanels();
  renderAdminDashboard();
  try {
    if (canAccessDataSync(state.permission)) {
      const [roles, users, permissions] = await Promise.all([
        authFetch('/admin/roles'),
        authFetch('/admin/users'),
        authFetch('/admin/permissions')
      ]);
      adminState.roles = roles.roles || [];
      adminState.users = users.users || [];
      adminState.permissions = permissions.permissions || [];
      if (!adminState.roles.some(role => role.role_key === adminState.selectedRole)) {
        adminState.selectedRole = state.permission?.role || adminState.roles[0]?.role_key || 'admin';
      }
    }
    await Promise.all([
      loadAdminApprovals({ silent: true }),
      loadAdminLogs({ silent: true })
    ]);
    renderAdminPanels();
    renderAdminDashboard();
    renderAdminRoleOptions();
    renderAdminUsers();
    renderPermissionEditor();
    showAdminMessage('Admin backend refreshed.');
  } catch (error) {
    showAdminMessage(`Admin data unavailable: ${error.message}`, 'error');
  }
}

async function onAdminMigrateBusiness() {
  if (!canAccessDataSync(state.permission)) return;
  const button = document.getElementById('minova-admin-migrate-business');
  try {
    if (button) button.disabled = true;
    showAdminMessage('Migrating current business data to D1...');
    const data = await migrateFromStatic();
    showAdminMessage(`D1 migration saved ${data.itemCount || 0} records and ${data.settingCount || 0} setting groups.`);
    await bootstrapBusinessData({ apply: false });
  } catch (error) {
    showAdminMessage(`D1 migration failed: ${formatAuthError(error)}`, 'error');
  } finally {
    if (button) button.disabled = false;
    renderAdminDashboard();
  }
}

function adminPanelAllowed(panel) {
  if (panel === 'dashboard') return true;
  if (panel === 'approvals') return canManageQuoteApprovals(state.permission);
  return canAccessDataSync(state.permission);
}

function renderAdminPanels() {
  const tabWrap = document.getElementById('minova-admin-panel-tabs');
  if (!tabWrap) return;
  const visiblePanels = ADMIN_PANELS.filter(([panel]) => adminPanelAllowed(panel));
  if (!visiblePanels.some(([panel]) => panel === adminState.activePanel)) {
    adminState.activePanel = visiblePanels[0]?.[0] || 'dashboard';
  }
  tabWrap.innerHTML = visiblePanels.map(([panel, label]) => `
    <button type="button" data-admin-panel-tab="${escapeHtml(panel)}" class="px-4 py-2 rounded-t-xl border border-b-0 text-xs font-black ${panel === adminState.activePanel ? 'bg-white text-purple-700 border-slate-200' : 'bg-slate-50 text-slate-500 border-slate-200 hover:text-slate-900'}">${escapeHtml(label)}</button>
  `).join('');
  tabWrap.querySelectorAll('[data-admin-panel-tab]').forEach(button => {
    button.addEventListener('click', () => {
      adminState.activePanel = button.dataset.adminPanelTab || 'dashboard';
      renderAdminPanels();
    });
  });
  document.querySelectorAll('[data-admin-panel]').forEach(section => {
    const active = section.dataset.adminPanel === adminState.activePanel;
    section.classList.toggle('hidden', !active);
  });
}

function renderAdminDashboard() {
  const activeUsers = adminState.users.filter(user => user.status !== 'inactive').length;
  const pendingApprovals = adminState.approvals.filter(item => item.status === 'pending').length;
  const today = new Date().toISOString().slice(0, 10);
  const todayLogs = adminState.auditLogs.filter(log => String(log.createdAt || '').startsWith(today)).length;
  const userEl = document.getElementById('minova-admin-current-user');
  if (userEl) {
    userEl.innerHTML = [
      dashboardMetric('Current User', state.user?.name || '-', state.user?.username || ''),
      dashboardMetric('Role', state.permission?.roleName || '-', state.permission?.role || ''),
      dashboardMetric('Session', state.ready && !state.locked ? 'Active' : 'Locked', 'Cloudflare session cookie'),
      dashboardMetric('Pending Approvals', pendingApprovals, canManageQuoteApprovals(state.permission) ? 'Visible to approvers' : 'No approval access'),
      dashboardMetric('D1 Business DB', businessState.hasD1Data ? 'Primary' : businessState.source === 'fallback' ? 'Fallback' : 'Ready', businessState.lastError || `${businessState.quoteCount || 0} saved quotes indexed`),
      dashboardMetric('Write Queue', `${businessState.pendingWrites} pending`, `${businessState.failedWrites} failed writes`)
    ].join('');
  }
  const risk = document.getElementById('minova-admin-risk-summary');
  if (risk) {
    const inactiveUsers = adminState.users.filter(user => user.status === 'inactive').length;
    risk.innerHTML = `
      <div>Active users: <b>${escapeHtml(activeUsers)}</b></div>
      <div>Inactive users hidden by default: <b>${escapeHtml(inactiveUsers)}</b></div>
      <div>Pending quote approvals: <b>${escapeHtml(pendingApprovals)}</b></div>
      <div>D1 source: <b>${escapeHtml(businessState.source || 'static')}</b></div>
      <div>D1 last bootstrap: <b>${escapeHtml(businessState.lastBootstrapAt || '-')}</b></div>
      <div>D1 last write: <b>${escapeHtml(businessState.lastPersistAt || '-')}</b></div>
      <div>GitHub Sync button: <b>${canAccessDataSync(state.permission) ? 'visible' : 'hidden'}</b></div>
    `;
  }
}

function dashboardMetric(label, value, hint) {
  return `
    <div class="border border-slate-200 rounded-xl bg-slate-50 px-4 py-3 min-h-[88px]">
      <div class="text-[10px] font-black uppercase text-slate-400">${escapeHtml(label)}</div>
      <div class="text-lg font-black text-slate-800 mt-1 break-words">${escapeHtml(value)}</div>
      <div class="text-[11px] text-slate-500 mt-1 break-words">${escapeHtml(hint || '')}</div>
    </div>
  `;
}

function showAdminMessage(text, kind = 'success') {
  const el = document.getElementById('minova-admin-status');
  if (!el) return;
  el.textContent = text;
  el.className = `rounded-xl px-4 py-3 text-xs font-bold ${kind === 'error' ? 'bg-red-50 text-red-700 border border-red-100' : 'bg-emerald-50 text-emerald-700 border border-emerald-100'}`;
}

function formatAuthError(error) {
  const code = error?.data?.error || error?.message || '';
  const map = {
    missing_username: 'Account is required.',
    missing_name: 'Name is required.',
    invalid_email: 'Email format is invalid.',
    password_too_short: 'Initial password must be at least 6 characters.',
    invalid_user_payload: 'Please check account, name, role and password.',
    cannot_delete_self: 'Current user cannot be deleted.',
    cannot_delete_last_admin: 'Last active Admin cannot be deleted.',
    invalid_admin_password: 'Administrator password is incorrect.',
    use_forgot_password_for_admin_self_reset: 'Use Forgot Password on the login page to reset your own admin account.',
    user_inactive: 'Inactive users cannot be reset.'
  };
  return map[code] || error?.message || String(error || 'Unknown error');
}

function roleOptionsHtml(selected = '') {
  return adminState.roles.map(role => {
    const key = role.role_key || role.role || 'read_only';
    const label = role.name || ROLE_DEFINITIONS[key]?.displayName || key;
    return `<option value="${escapeHtml(key)}" ${key === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('');
}

function renderAdminRoleOptions() {
  const selected = adminState.selectedRole || 'admin';
  const roleSelect = document.getElementById('minova-admin-role-select');
  const newRole = document.getElementById('minova-admin-new-role');
  if (roleSelect) roleSelect.innerHTML = roleOptionsHtml(selected);
  if (newRole) newRole.innerHTML = roleOptionsHtml('read_only');
}

function renderAdminUsers() {
  const usersEl = document.getElementById('minova-admin-users');
  if (!usersEl) return;
  const visibleUsers = adminState.showInactiveUsers
    ? adminState.users
    : adminState.users.filter(user => user.status !== 'inactive');
  const activeAdminCount = adminState.users.filter(user => user.status === 'active' && user.role === 'admin').length;
  usersEl.innerHTML = `
    <table class="min-w-full text-xs">
      <thead class="bg-slate-50 text-slate-500 uppercase">
        <tr>
          <th class="text-left px-3 py-2">Account</th>
          <th class="text-left px-3 py-2">Name</th>
          <th class="text-left px-3 py-2">Email</th>
          <th class="text-left px-3 py-2">Role</th>
          <th class="text-left px-3 py-2">Status</th>
          <th class="text-left px-3 py-2">Last Login</th>
          <th class="text-right px-3 py-2">Actions</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-100">
        ${visibleUsers.map(user => {
          const isCurrent = Number(user.id) === Number(state.user?.id);
          const isLastAdmin = user.role === 'admin' && activeAdminCount <= 1 && user.status === 'active';
          return `
          <tr data-user-id="${escapeHtml(user.id)}">
            <td class="px-3 py-2 font-black text-slate-700">${escapeHtml(user.username || '')}</td>
            <td class="px-3 py-2"><input data-field="name" class="w-36 border border-slate-200 rounded-lg px-2 py-1" value="${escapeHtml(user.name || '')}"></td>
            <td class="px-3 py-2"><input data-field="email" type="email" class="w-48 border border-slate-200 rounded-lg px-2 py-1" value="${escapeHtml(user.email || '')}"></td>
            <td class="px-3 py-2"><select data-field="role" class="w-44 border border-slate-200 rounded-lg px-2 py-1">${roleOptionsHtml(user.role || 'read_only')}</select></td>
            <td class="px-3 py-2">
              <select data-field="status" class="w-28 border border-slate-200 rounded-lg px-2 py-1">
                <option value="active" ${user.status === 'active' ? 'selected' : ''}>Active</option>
                <option value="inactive" ${user.status === 'inactive' ? 'selected' : ''}>Inactive</option>
              </select>
            </td>
            <td class="px-3 py-2 text-slate-500 whitespace-nowrap">${escapeHtml(user.last_login_at || '-')}</td>
            <td class="px-3 py-2 text-right">
              <div class="inline-flex flex-wrap justify-end gap-2">
                <button type="button" data-admin-save-user class="rounded-lg bg-slate-900 text-white px-3 py-1.5 font-black">Save</button>
                <button type="button" data-admin-reset-user class="rounded-lg bg-amber-500 text-white px-3 py-1.5 font-black disabled:opacity-40" ${isCurrent ? 'disabled title="Use Forgot Password for your own account reset."' : ''}>Reset</button>
                <button type="button" data-admin-delete-user class="rounded-lg bg-red-600 text-white px-3 py-1.5 font-black disabled:opacity-40" ${isCurrent || isLastAdmin ? 'disabled' : ''} title="${isCurrent ? 'Current user cannot be deleted.' : isLastAdmin ? 'Last active Admin cannot be deleted.' : 'Disable this user'}">Delete</button>
              </div>
            </td>
          </tr>
        `;
        }).join('') || '<tr><td class="px-3 py-4 text-slate-400" colspan="7">No active users</td></tr>'}
      </tbody>
    </table>
  `;
  usersEl.querySelectorAll('[data-admin-save-user]').forEach(button => {
    button.addEventListener('click', () => onAdminSaveUser(button.closest('tr')));
  });
  usersEl.querySelectorAll('[data-admin-reset-user]').forEach(button => {
    button.addEventListener('click', () => showAdminResetModal(button.closest('tr')?.dataset.userId));
  });
  usersEl.querySelectorAll('[data-admin-delete-user]').forEach(button => {
    button.addEventListener('click', () => onAdminDeleteUser(button.closest('tr')));
  });
}

function permissionForSelectedRole() {
  const role = adminState.selectedRole || 'read_only';
  const existing = adminState.permissions.find(item => item.role === role)?.permission;
  return sanitizePermissionSnapshot(role, existing || getDefaultPermissionSnapshot(role));
}

function checkboxHtml({ name, value, label, checked, disabled = false, attrs = '' }) {
  return `
    <label class="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600">
      <input type="checkbox" name="${escapeHtml(name)}" value="${escapeHtml(value)}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} ${attrs}>
      <span>${escapeHtml(label)}</span>
    </label>
  `;
}

function renderPermissionEditor() {
  const editor = document.getElementById('minova-admin-permission-editor');
  if (!editor) return;
  const permission = permissionForSelectedRole();
  const role = permission.role;
  const adminProtected = role === 'admin';
  const limit = permission.quote?.priceAdjustPctLimit;
  editor.innerHTML = `
    <section class="border border-slate-200 rounded-xl p-4">
      <h4 class="text-sm font-black text-slate-700 mb-3">Visible Tabs</h4>
      <div class="flex flex-wrap gap-2">
        ${ALL_TABS.map(tab => checkboxHtml({
          name: 'admin-tabs',
          value: tab,
          label: TAB_LABELS[tab] || tab,
          checked: permission.tabs.includes(tab),
          disabled: adminProtected && tab === 'admin',
          attrs: 'data-admin-tab'
        })).join('')}
      </div>
    </section>
    <section class="border border-slate-200 rounded-xl overflow-x-auto">
      <table class="min-w-full text-xs">
        <thead class="bg-slate-50 text-slate-500 uppercase">
          <tr>
            <th class="text-left px-3 py-2">Resource</th>
            ${PERMISSION_ACTIONS.map(action => `<th class="text-center px-3 py-2">${escapeHtml(ACTION_LABELS[action] || action)}</th>`).join('')}
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${PERMISSION_RESOURCES.map(resource => `
            <tr>
              <td class="px-3 py-2 font-black text-slate-700">${escapeHtml(RESOURCE_LABELS[resource] || resource)}</td>
              ${PERMISSION_ACTIONS.map(action => {
                const checked = (permission.actions?.[resource] || []).includes(action);
                const disabled = adminProtected && resource === 'admin' && ['read', 'edit', 'delete'].includes(action);
                return `<td class="text-center px-3 py-2"><input type="checkbox" data-admin-resource="${escapeHtml(resource)}" data-admin-action="${escapeHtml(action)}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}></td>`;
              }).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </section>
    <section class="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div class="border border-slate-200 rounded-xl p-4">
        <h4 class="text-sm font-black text-slate-700 mb-3">Sensitive Fields</h4>
        <div class="flex flex-wrap gap-2">
          ${SENSITIVE_FIELDS.map(field => checkboxHtml({
            name: 'admin-sensitive-fields',
            value: field,
            label: SENSITIVE_LABELS[field] || field,
            checked: permission.sensitiveFields.includes(field),
            attrs: 'data-admin-sensitive'
          })).join('')}
        </div>
      </div>
      <div class="border border-slate-200 rounded-xl p-4">
        <h4 class="text-sm font-black text-slate-700 mb-3">Quote Price Limit</h4>
        <label class="flex items-center gap-2 text-xs font-bold text-slate-600 mb-3">
          <input id="minova-admin-unlimited-quote" type="checkbox" ${limit === null ? 'checked' : ''} ${adminProtected ? 'disabled' : ''}>
          Unlimited adjustment
        </label>
        <input id="minova-admin-price-limit" type="number" min="0" max="100" step="0.1" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs" value="${limit === null ? '' : escapeHtml(limit)}" ${limit === null ? 'disabled' : ''}>
      </div>
      <div class="border border-slate-200 rounded-xl p-4">
        <h4 class="text-sm font-black text-slate-700 mb-3">Watermark</h4>
        <label class="flex items-center gap-2 text-xs font-bold text-slate-600">
          <input id="minova-admin-watermark-enabled" type="checkbox" ${permission.watermark?.enabled !== false ? 'checked' : ''}>
          Show webpage watermark for this role
        </label>
        <p class="text-[11px] text-slate-400 mt-3">PDF watermark remains disabled in this version.</p>
      </div>
    </section>
  `;
  editor.querySelector('#minova-admin-unlimited-quote')?.addEventListener('change', event => {
    const input = document.getElementById('minova-admin-price-limit');
    if (input) input.disabled = event.target.checked;
  });
}

function collectPermissionEditor() {
  const role = adminState.selectedRole || 'read_only';
  const editor = document.getElementById('minova-admin-permission-editor');
  const tabs = Array.from(editor?.querySelectorAll('[data-admin-tab]:checked') || []).map(input => input.value);
  const actions = {};
  PERMISSION_RESOURCES.forEach(resource => {
    actions[resource] = Array.from(editor?.querySelectorAll(`[data-admin-resource="${resource}"]:checked`) || [])
      .map(input => input.dataset.adminAction)
      .filter(Boolean);
  });
  const sensitiveFields = Array.from(editor?.querySelectorAll('[data-admin-sensitive]:checked') || []).map(input => input.value);
  const unlimited = document.getElementById('minova-admin-unlimited-quote')?.checked;
  const limitInput = document.getElementById('minova-admin-price-limit')?.value || '0';
  return sanitizePermissionSnapshot(role, {
    role,
    tabs,
    actions,
    sensitiveFields,
    quote: { priceAdjustPctLimit: unlimited ? null : Number(limitInput) },
    watermark: { enabled: document.getElementById('minova-admin-watermark-enabled')?.checked !== false, includeInPdf: false }
  });
}

async function onAdminCreateUser(event) {
  event.preventDefault();
  try {
    await authFetch('/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        username: document.getElementById('minova-admin-new-username')?.value || '',
        name: document.getElementById('minova-admin-new-name')?.value || '',
        email: document.getElementById('minova-admin-new-email')?.value || '',
        role: document.getElementById('minova-admin-new-role')?.value || 'read_only',
        password: document.getElementById('minova-admin-new-password')?.value || ''
      })
    });
    event.target.reset();
    showAdminMessage('User created.');
    await loadAdminPanel();
  } catch (error) {
    showAdminMessage(`Create user failed: ${formatAuthError(error)}`, 'error');
  }
}

async function onAdminSaveUser(row) {
  if (!row) return;
  const id = row.dataset.userId;
  try {
    await authFetch('/admin/users/update', {
      method: 'POST',
      body: JSON.stringify({
        id,
        name: row.querySelector('[data-field="name"]')?.value || '',
        email: row.querySelector('[data-field="email"]')?.value || '',
        role: row.querySelector('[data-field="role"]')?.value || 'read_only',
        status: row.querySelector('[data-field="status"]')?.value || 'active'
      })
    });
    showAdminMessage('User updated.');
    await loadAdminPanel();
  } catch (error) {
    showAdminMessage(`Save user failed: ${formatAuthError(error)}`, 'error');
  }
}

async function onAdminDeleteUser(row) {
  if (!row) return;
  const id = row.dataset.userId;
  const user = adminState.users.find(item => String(item.id) === String(id));
  if (!user) return;
  const ok = window.confirm?.(`Disable user ${user.name || user.username} (${user.username})? This keeps audit history but removes login access.`);
  if (!ok) return;
  try {
    await authFetch('/admin/users/delete', {
      method: 'POST',
      body: JSON.stringify({ id })
    });
    showAdminMessage('User disabled and hidden from active list.');
    await loadAdminPanel();
  } catch (error) {
    showAdminMessage(`Delete user failed: ${formatAuthError(error)}`, 'error');
  }
}

async function onAdminResetSubmit(event) {
  event.preventDefault();
  const msg = document.getElementById('minova-admin-reset-message');
  const result = document.getElementById('minova-admin-reset-result');
  const code = document.getElementById('minova-admin-reset-temp-password');
  try {
    if (msg) {
      msg.textContent = 'Resetting password...';
      msg.className = 'text-xs font-bold text-slate-500';
    }
    if (result) result.classList.add('hidden');
    const data = await authFetch('/admin/users/reset-password', {
      method: 'POST',
      body: JSON.stringify({
        id: adminState.resetUserId,
        adminPassword: document.getElementById('minova-admin-reset-password')?.value || ''
      })
    });
    if (code) code.textContent = data.temporaryPassword || '';
    if (result) result.classList.remove('hidden');
    if (msg) {
      msg.textContent = `${data.name || data.username || 'User'} password has been reset.`;
      msg.className = 'text-xs font-bold text-emerald-700';
    }
    showAdminMessage('Temporary password generated. User must change it at next login.');
    await loadAdminLogs({ silent: true });
    renderAdminDashboard();
  } catch (error) {
    if (msg) {
      msg.textContent = `Reset failed: ${formatAuthError(error)}`;
      msg.className = 'text-xs font-bold text-red-700';
    }
    showAdminMessage(`Reset password failed: ${formatAuthError(error)}`, 'error');
  }
}

async function onAdminSavePermission() {
  try {
    const permission = collectPermissionEditor();
    const data = await authFetch('/admin/permissions', {
      method: 'POST',
      body: JSON.stringify({ role: permission.role, permission })
    });
    showAdminMessage('Role permission saved.');
    if (data.role === state.permission?.role) {
      setSession(state.user, data.permission);
      applyPermissions();
    }
    await loadAdminPanel();
  } catch (error) {
    showAdminMessage(`Save permission failed: ${error.message}`, 'error');
  }
}

async function loadAdminApprovals({ silent = false } = {}) {
  if (!canManageQuoteApprovals(state.permission)) {
    adminState.approvals = [];
    renderAdminApprovals();
    return;
  }
  try {
    const data = await authFetch('/quote/approvals?status=all&limit=100');
    adminState.approvals = data.approvals || [];
    renderAdminApprovals();
    renderAdminDashboard();
    if (!silent) showAdminMessage('Approvals refreshed.');
  } catch (error) {
    if (!silent) showAdminMessage(`Load approvals failed: ${error.message}`, 'error');
  }
}

function renderAdminApprovals() {
  const el = document.getElementById('minova-admin-approvals');
  if (!el) return;
  if (!canManageQuoteApprovals(state.permission)) {
    el.innerHTML = '<div class="px-3 py-4 text-xs text-slate-400">No quote approval permission.</div>';
    return;
  }
  const rows = adminState.approvals || [];
  el.innerHTML = `
    <table class="min-w-full text-xs">
      <thead class="bg-slate-50 text-slate-500 uppercase">
        <tr>
          <th class="text-left px-3 py-2">Quote No</th>
          <th class="text-left px-3 py-2">Customer</th>
          <th class="text-left px-3 py-2">Requester</th>
          <th class="text-left px-3 py-2">Deviation</th>
          <th class="text-left px-3 py-2">Status</th>
          <th class="text-left px-3 py-2">Submitted</th>
          <th class="text-right px-3 py-2">Decision</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-100">
        ${rows.map(row => `
          <tr data-approval-id="${escapeHtml(row.id)}">
            <td class="px-3 py-2 font-black text-slate-700">${escapeHtml(row.quoteNo || '-')}</td>
            <td class="px-3 py-2">${escapeHtml(row.customerName || '-')}</td>
            <td class="px-3 py-2">${escapeHtml(row.requesterName || row.requesterUsername || '-')}</td>
            <td class="px-3 py-2">${escapeHtml(row.deviationPct ?? '-')}${row.limitPct !== null && row.limitPct !== undefined ? ` / limit ${escapeHtml(row.limitPct)}%` : ''}</td>
            <td class="px-3 py-2"><span class="rounded-full px-2 py-1 text-[11px] font-black ${row.status === 'pending' ? 'bg-amber-50 text-amber-700' : row.status === 'approved' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}">${escapeHtml(row.status || 'pending')}</span></td>
            <td class="px-3 py-2 text-slate-500 whitespace-nowrap">${escapeHtml(row.createdAt || '-')}</td>
            <td class="px-3 py-2 text-right">
              <div class="flex flex-col sm:flex-row justify-end gap-2">
                <input data-approval-note class="min-w-[160px] border border-slate-200 rounded-lg px-2 py-1" placeholder="Note">
                <button type="button" data-approval-decision="approved" class="rounded-lg bg-emerald-600 text-white px-3 py-1.5 font-black disabled:opacity-40" ${row.status !== 'pending' ? 'disabled' : ''}>Approve</button>
                <button type="button" data-approval-decision="rejected" class="rounded-lg bg-red-600 text-white px-3 py-1.5 font-black disabled:opacity-40" ${row.status !== 'pending' ? 'disabled' : ''}>Reject</button>
              </div>
            </td>
          </tr>
        `).join('') || '<tr><td class="px-3 py-4 text-slate-400" colspan="7">No approvals</td></tr>'}
      </tbody>
    </table>
  `;
  el.querySelectorAll('[data-approval-decision]').forEach(button => {
    button.addEventListener('click', () => onAdminApprovalDecision(button.closest('tr'), button.dataset.approvalDecision));
  });
}

async function onAdminApprovalDecision(row, decision) {
  if (!row) return;
  try {
    await authFetch('/quote/approval-decision', {
      method: 'POST',
      body: JSON.stringify({
        approvalId: row.dataset.approvalId,
        decision,
        note: row.querySelector('[data-approval-note]')?.value || ''
      })
    });
    showAdminMessage(`Approval ${decision}.`);
    await Promise.all([loadAdminApprovals({ silent: true }), loadAdminLogs({ silent: true })]);
    renderAdminDashboard();
  } catch (error) {
    showAdminMessage(`Approval decision failed: ${error.message}`, 'error');
  }
}

async function loadAdminLogs({ silent = false } = {}) {
  if (!canAccessDataSync(state.permission)) {
    adminState.auditLogs = [];
    renderAdminLogs();
    return;
  }
  const params = new URLSearchParams();
  const user = document.getElementById('minova-admin-log-user')?.value || '';
  const action = document.getElementById('minova-admin-log-action')?.value || '';
  const limit = document.getElementById('minova-admin-log-limit')?.value || '100';
  if (user.trim()) params.set('user', user.trim());
  if (action.trim()) params.set('action', action.trim());
  params.set('limit', limit);
  try {
    const data = await authFetch(`/admin/audit-logs?${params.toString()}`);
    adminState.auditLogs = data.logs || [];
    renderAdminLogs();
    renderAdminDashboard();
    if (!silent) showAdminMessage('Operation logs refreshed.');
  } catch (error) {
    if (!silent) showAdminMessage(`Load operation logs failed: ${error.message}`, 'error');
  }
}

function renderAdminLogs() {
  const el = document.getElementById('minova-admin-logs');
  if (!el) return;
  if (!canAccessDataSync(state.permission)) {
    el.innerHTML = '<div class="px-3 py-4 text-xs text-slate-400">Operation logs are visible to Admin edit roles only.</div>';
    return;
  }
  const rows = adminState.auditLogs || [];
  el.innerHTML = `
    <table class="min-w-full text-xs">
      <thead class="bg-slate-50 text-slate-500 uppercase">
        <tr>
          <th class="text-left px-3 py-2">Time</th>
          <th class="text-left px-3 py-2">User</th>
          <th class="text-left px-3 py-2">Role</th>
          <th class="text-left px-3 py-2">Action</th>
          <th class="text-left px-3 py-2">Target</th>
          <th class="text-left px-3 py-2">Detail</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-100">
        ${rows.map(row => `
          <tr>
            <td class="px-3 py-2 text-slate-500 whitespace-nowrap">${escapeHtml(row.createdAt || '-')}</td>
            <td class="px-3 py-2 font-black text-slate-700">${escapeHtml(row.name || row.username || '-')}<div class="font-normal text-slate-400">${escapeHtml(row.username || '')}</div></td>
            <td class="px-3 py-2">${escapeHtml(row.roleName || row.role || '-')}</td>
            <td class="px-3 py-2 font-black">${escapeHtml(row.action || '-')}</td>
            <td class="px-3 py-2">${escapeHtml([row.targetType, row.targetId].filter(Boolean).join(': ') || '-')}</td>
            <td class="px-3 py-2 max-w-md truncate" title="${escapeHtml(JSON.stringify(row.detail || {}))}">${escapeHtml(JSON.stringify(row.detail || {}))}</td>
          </tr>
        `).join('') || '<tr><td class="px-3 py-4 text-slate-400" colspan="6">No operation logs</td></tr>'}
      </tbody>
    </table>
  `;
}

async function boot() {
  ensureAuthShell();
  publishAuthApi();
  publishBusinessApi();
  patchGlobals();
  lockApp();
  try {
    const data = await authFetch('/me');
    setSession(data.user, data.permission);
    if (data.user?.forcePasswordChange) showPasswordChangeModal();
    else unlockApp();
  } catch {
    lockApp();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
