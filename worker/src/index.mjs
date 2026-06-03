import {
  ROLE_DEFINITIONS,
  getDefaultPermissionSnapshot,
  mergePermissionSnapshot,
  evaluateQuotePriceAdjustment,
  normalizeRoleId,
  sanitizePermissionSnapshot,
  canPerformAction,
  canManageQuoteApprovals
} from '../../auth/permission-core.mjs';

const COOKIE_NAME = 'minova_session';
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const DEFAULT_ADMIN_EMAIL = 'qibbqi00@google.com';
const ROLE_NAME_TO_KEY = Object.fromEntries(
  Object.entries(ROLE_DEFINITIONS).map(([key, role]) => [role.displayName, key])
);
const BUSINESS_DOMAIN_PERMISSIONS = {
  product: 'products',
  inventory: 'inventory',
  inventory_history: 'inventory',
  sales_record: 'inventory',
  historical_inventory: 'inventory',
  transport: 'transport',
  market_price: 'priceList',
  saved_quote: 'quotes'
};
const BUSINESS_SETTINGS_KEYS = new Set([
  'market_price_settings',
  'subcategories_by_category',
  'profit_settings',
  'installer_profit_settings',
  'installer_quote_settings',
  'non_stock_pricing_strategies'
]);

export default {
  async fetch(request, env) {
    try {
      await ensureBootstrap(env);
      if (request.method === 'OPTIONS') return corsResponse(request, env);

      const url = new URL(request.url);
      if (url.pathname === '/health') return json(request, env, { ok: true, service: 'minova-backend' });
      if (url.pathname === '/auth/login' && request.method === 'POST') return login(request, env);
      if (url.pathname === '/auth/logout' && request.method === 'POST') return logout(request, env);
      if (url.pathname === '/auth/change-password' && request.method === 'POST') return changePassword(request, env);
      if (url.pathname === '/auth/forgot-password' && request.method === 'POST') return forgotPassword(request, env);
      if (url.pathname === '/me' && request.method === 'GET') return me(request, env);
      if (url.pathname === '/admin/roles' && request.method === 'GET') return adminRoles(request, env);
      if (url.pathname === '/admin/users' && request.method === 'GET') return adminUsers(request, env);
      if (url.pathname === '/admin/users' && request.method === 'POST') return adminCreateUser(request, env);
      if (url.pathname === '/admin/users/update' && request.method === 'POST') return adminUpdateUser(request, env);
      if (url.pathname === '/admin/users/delete' && request.method === 'POST') return adminDeleteUser(request, env);
      if (url.pathname === '/admin/users/reset-password' && request.method === 'POST') return adminResetUserPassword(request, env);
      if (url.pathname === '/admin/permissions' && request.method === 'GET') return adminPermissions(request, env);
      if (url.pathname === '/admin/permissions' && request.method === 'POST') return adminSavePermission(request, env);
      if (url.pathname === '/admin/audit-logs' && request.method === 'GET') return adminAuditLogs(request, env);
      if (url.pathname === '/business/bootstrap' && request.method === 'GET') return businessBootstrap(request, env);
      if (url.pathname === '/business/entity/upsert' && request.method === 'POST') return businessEntityUpsert(request, env);
      if (url.pathname === '/business/entity/delete' && request.method === 'POST') return businessEntityDelete(request, env);
      if (url.pathname === '/business/settings' && request.method === 'POST') return businessSettingsSave(request, env);
      if (url.pathname === '/admin/business/migrate-from-static' && request.method === 'POST') return adminBusinessMigrateFromStatic(request, env);
      if (url.pathname === '/quotes' && request.method === 'POST') return quoteSave(request, env);
      if (url.pathname === '/quotes/delete' && request.method === 'POST') return quoteDelete(request, env);
      if (url.pathname.startsWith('/quotes/') && request.method === 'GET') return quoteGet(request, env);
      if (url.pathname === '/quote/check' && request.method === 'POST') return quoteCheck(request, env);
      if (url.pathname === '/quote/approvals' && request.method === 'GET') return quoteApprovals(request, env);
      if (url.pathname === '/quote/approval-request' && request.method === 'POST') return quoteApprovalRequest(request, env);
      if (url.pathname === '/quote/approval-decision' && request.method === 'POST') return quoteApprovalDecision(request, env);
      if (url.pathname === '/audit' && request.method === 'POST') return auditEndpoint(request, env);

      return json(request, env, { error: 'not_found' }, 404);
    } catch (error) {
      return json(request, env, { error: 'server_error', message: String(error?.message || error) }, 500);
    }
  }
};

export function allowedOrigin(request, env) {
  const origin = request.headers.get('origin') || '';
  const allowed = String(env.MINOVA_ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (origin === 'null') return 'null';
  if (origin && allowed.includes(origin)) return origin;
  if (origin && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) return origin;
  return allowed[0] || '*';
}

function withCors(request, env, headers = {}) {
  return {
    ...headers,
    'access-control-allow-origin': allowedOrigin(request, env),
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type, authorization'
  };
}

function corsResponse(request, env) {
  return new Response(null, { status: 204, headers: withCors(request, env) });
}

function json(request, env, body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: withCors(request, env, { ...JSON_HEADERS, ...headers })
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function ensureBootstrap(env) {
  const db = env.minova_auth_db;
  if (!db) throw new Error('D1 binding minova_auth_db is missing');
  await ensureUsersEmailColumn(db);
  await ensureBusinessTables(db);

  for (const [id, role] of Object.entries(ROLE_DEFINITIONS)) {
    await db.prepare(`
      INSERT OR IGNORE INTO roles (name, description)
      VALUES (?, ?)
    `).bind(role.displayName, role.defaultHolder ? `Default holder: ${role.defaultHolder}` : '').run();

    const roleRow = await db.prepare('SELECT id FROM roles WHERE name = ?').bind(role.displayName).first();
    if (!roleRow?.id) continue;
    const snapshot = getDefaultPermissionSnapshot(id);
    await db.prepare(`
      INSERT INTO permissions (role_id, permission_json)
      VALUES (?, ?)
    `).bind(roleRow.id, JSON.stringify(snapshot)).run().catch(async () => {
      await db.prepare('UPDATE permissions SET permission_json = ? WHERE role_id = ?')
        .bind(JSON.stringify(snapshot), roleRow.id).run();
    });
  }

  const existing = await db.prepare('SELECT id, password_hash FROM users WHERE username = ?').bind('admin').first();
  const adminEmail = normalizePasswordResetEmail(env.MINOVA_INITIAL_ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL);
  if (env.MINOVA_INITIAL_ADMIN_PASSWORD) {
    const password = await hashPassword(env.MINOVA_INITIAL_ADMIN_PASSWORD);
    const adminRole = await db.prepare('SELECT id FROM roles WHERE name = ?').bind(ROLE_DEFINITIONS.admin.displayName).first();
    if (!existing) {
      await db.prepare(`
        INSERT INTO users (username, name, email, password_hash, role_id, status)
        VALUES (?, ?, ?, ?, ?, 'active')
      `).bind('admin', 'Kelvin', adminEmail, password.encoded, adminRole?.id || 1).run();
    } else if (!String(existing.password_hash || '').startsWith('pbkdf2')) {
      await db.prepare(`
        UPDATE users SET name = ?, email = ?, password_hash = ?, role_id = ?, status = 'active' WHERE username = ?
      `).bind('Kelvin', adminEmail, password.encoded, adminRole?.id || 1, 'admin').run();
    }
  }
  if (existing && adminEmail) {
    await db.prepare("UPDATE users SET email = ? WHERE username = 'admin' AND COALESCE(email, '') = ''").bind(adminEmail).run();
  }
}

async function ensureBusinessTables(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS business_entities (
      domain TEXT NOT NULL,
      record_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_by INTEGER,
      PRIMARY KEY (domain, record_id)
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS business_settings (
      setting_key TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_by INTEGER
    )
  `).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_business_entities_domain_status ON business_entities(domain, status)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_business_entities_updated_at ON business_entities(updated_at)').run();
}

async function login(request, env) {
  const body = await readJson(request);
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!username || !password) return json(request, env, { error: 'missing_credentials' }, 400);

  const user = await env.minova_auth_db.prepare(`
    SELECT u.id, u.username, u.name, u.email, u.password_hash, u.role_id, u.status, u.last_login_at, r.name AS role_name
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.username = ?
  `).bind(username).first();

  if (!user || user.status !== 'active') {
    await writeAudit(env, null, username, 'login_failed', 'user', username, { reason: 'not_found_or_inactive' });
    return json(request, env, { error: 'invalid_credentials' }, 401);
  }

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    await writeAudit(env, user.id, user.username, 'login_failed', 'user', String(user.id), { reason: 'bad_password' });
    return json(request, env, { error: 'invalid_credentials' }, 401);
  }

  const token = randomToken();
  const tokenHash = await sha256Hex(token + String(env.MINOVA_SESSION_SECRET || 'minova-dev-secret'));
  const ttl = Number(env.MINOVA_SESSION_TTL_SECONDS || 28800);
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  await env.minova_auth_db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(tokenHash, user.id, expiresAt).run();
  await env.minova_auth_db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').bind(user.id).run();
  await writeAudit(env, user.id, user.username, 'login_success', 'user', String(user.id), {});

  const headers = {
    'set-cookie': `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${ttl}`
  };
  return json(request, env, {
    ok: true,
    user: publicUser(user),
    permission: await permissionForUser(env, user),
    sessionToken: token,
    sessionExpiresAt: expiresAt
  }, 200, headers);
}

async function forgotPassword(request, env) {
  const body = await readJson(request);
  const email = normalizePasswordResetEmail(body.email);
  if (!email) return json(request, env, { error: 'invalid_email' }, 400);

  const user = await env.minova_auth_db.prepare(`
    SELECT id, username, name, email, status
    FROM users
    WHERE lower(COALESCE(email, '')) = ?
    LIMIT 1
  `).bind(email).first();
  if (!user || user.status !== 'active') {
    await writeAudit(env, null, email, 'password_reset_failed', 'user', email, { reason: 'email_not_found_or_inactive' });
    return json(request, env, { error: 'email_not_found' }, 404);
  }

  const temporaryPassword = generateTemporaryPassword();
  const password = await hashPassword(temporaryPassword);
  await env.minova_auth_db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .bind(password.encoded, user.id).run();
  await env.minova_auth_db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run();
  await writeAudit(env, user.id, user.username, 'password_reset_by_email', 'user', String(user.id), { email });
  return json(request, env, {
    ok: true,
    username: user.username,
    name: user.name,
    temporaryPassword,
    forcePasswordChange: true,
    message: 'Temporary password generated. Sign in with it and change the password immediately.'
  });
}

async function logout(request, env) {
  const session = await currentSession(request, env);
  if (session) {
    await env.minova_auth_db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(session.tokenHash).run();
    await writeAudit(env, session.user.id, session.user.username, 'logout', 'user', String(session.user.id), {});
  }
  return json(request, env, { ok: true }, 200, {
    'set-cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0`
  });
}

async function changePassword(request, env) {
  const session = await requireSession(request, env);
  if (session.response) return session.response;
  const body = await readJson(request);
  const payload = validatePasswordChangeRequest(body);
  if (!payload.ok) return json(request, env, { error: payload.error }, 400);
  const password = await hashPassword(payload.nextPassword);
  await env.minova_auth_db.prepare(`
    UPDATE users SET password_hash = ? WHERE id = ?
  `).bind(password.encoded.replace('pbkdf2$', 'pbkdf2-final$'), session.user.id).run();
  await writeAudit(env, session.user.id, session.user.username, 'password_changed', 'user', String(session.user.id), {});
  return json(request, env, { ok: true });
}

async function me(request, env) {
  const session = await requireSession(request, env);
  if (session.response) return session.response;
  return json(request, env, {
    ok: true,
    user: publicUser(session.user),
    permission: await permissionForUser(env, session.user)
  });
}

async function adminRoles(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;
  const rows = await env.minova_auth_db.prepare('SELECT id, name, description FROM roles ORDER BY name').all();
  return json(request, env, {
    ok: true,
    roles: (rows.results || []).map(role => {
      const key = roleKeyFromName(role.name);
      return {
        ...role,
        role_key: key,
        default_holder: ROLE_DEFINITIONS[key]?.defaultHolder || '',
        price_adjust_pct_limit: ROLE_DEFINITIONS[key]?.priceAdjustPctLimit ?? null
      };
    })
  });
}

async function adminUsers(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;
  const rows = await env.minova_auth_db.prepare(`
    SELECT u.id, u.username, u.name, u.email, u.role_id, u.status, u.last_login_at, u.created_at, r.name AS role_name
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    ORDER BY u.id
  `).all();
  return json(request, env, {
    ok: true,
    users: (rows.results || []).map(user => ({ ...publicUser(user), created_at: user.created_at, last_login_at: user.last_login_at }))
  });
}

async function adminCreateUser(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;
  const payload = normalizeUserCreatePayload(await readJson(request));
  if (!payload.ok) return json(request, env, { error: payload.error || 'invalid_user_payload' }, 400);
  const password = await hashPassword(payload.password);
  const roleId = await roleIdFromKey(env, payload.role);
  const result = await env.minova_auth_db.prepare(`
    INSERT INTO users (username, name, email, role_id, password_hash, status)
    VALUES (?, ?, ?, ?, ?, 'active')
  `).bind(payload.username, payload.name, payload.email, roleId, password.encoded).run();
  await writeAudit(env, gate.user.id, gate.user.username, 'admin_create_user', 'user', payload.username, { role: payload.role });
  return json(request, env, { ok: true, id: result.meta?.last_row_id || null });
}

async function adminUpdateUser(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;
  const payload = normalizeUserUpdatePayload(await readJson(request));
  if (!payload.ok) return json(request, env, { error: payload.error || 'invalid_user_payload' }, 400);
  const roleId = await roleIdFromKey(env, payload.role);
  await env.minova_auth_db.prepare(`
    UPDATE users
    SET name = ?, email = ?, role_id = ?, status = ?
    WHERE id = ?
  `).bind(payload.name, payload.email, roleId, payload.status, payload.id).run();
  await writeAudit(env, gate.user.id, gate.user.username, 'admin_update_user', 'user', String(payload.id), payload);
  return json(request, env, { ok: true, user: payload });
}

async function adminDeleteUser(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;
  const payload = normalizeUserDeletePayload(await readJson(request));
  if (!payload.ok) return json(request, env, { error: payload.error }, 400);

  const target = await env.minova_auth_db.prepare(`
    SELECT u.id, u.username, u.name, u.status, r.name AS role_name
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.id = ?
  `).bind(payload.id).first();
  if (!target) return json(request, env, { error: 'user_not_found' }, 404);

  const adminCountRow = await env.minova_auth_db.prepare(`
    SELECT COUNT(*) AS count
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.status = 'active' AND r.name = ?
  `).bind(ROLE_DEFINITIONS.admin.displayName).first();
  const guard = canSoftDeleteUser({
    currentUserId: gate.user.id,
    targetUserId: target.id,
    targetRole: roleKeyFromName(target.role_name),
    activeAdminCount: Number(adminCountRow?.count || 0)
  });
  if (!guard.ok) return json(request, env, { error: guard.error }, 400);

  await env.minova_auth_db.prepare("UPDATE users SET status = 'inactive' WHERE id = ?").bind(target.id).run();
  await env.minova_auth_db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id).run();
  await writeAudit(env, gate.user.id, gate.user.username, 'admin_delete_user', 'user', String(target.id), {
    username: target.username,
    previousStatus: target.status
  });
  return json(request, env, { ok: true, id: target.id, status: 'inactive' });
}

async function adminResetUserPassword(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;
  const payload = normalizeUserResetPasswordPayload(await readJson(request));
  if (!payload.ok) return json(request, env, { error: payload.error }, 400);
  if (payload.id === Number(gate.user.id)) {
    return json(request, env, { error: 'use_forgot_password_for_admin_self_reset' }, 400);
  }
  const adminPasswordOk = await verifyPassword(payload.adminPassword, gate.user.password_hash);
  if (!adminPasswordOk) return json(request, env, { error: 'invalid_admin_password' }, 403);

  const target = await env.minova_auth_db.prepare(`
    SELECT u.id, u.username, u.name, u.status, r.name AS role_name
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.id = ?
  `).bind(payload.id).first();
  if (!target) return json(request, env, { error: 'user_not_found' }, 404);
  if (target.status !== 'active') return json(request, env, { error: 'user_inactive' }, 400);

  const temporaryPassword = generateTemporaryPassword();
  const password = await hashPassword(temporaryPassword);
  await env.minova_auth_db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .bind(password.encoded, target.id).run();
  await env.minova_auth_db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id).run();
  await writeAudit(env, gate.user.id, gate.user.username, 'admin_reset_user_password', 'user', String(target.id), {
    username: target.username,
    role: roleKeyFromName(target.role_name)
  });
  return json(request, env, {
    ok: true,
    id: target.id,
    username: target.username,
    name: target.name,
    temporaryPassword,
    forcePasswordChange: true
  });
}

async function adminPermissions(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;
  const rows = await env.minova_auth_db.prepare(`
    SELECT p.role_id, p.permission_json, p.created_at, r.name AS role_name
    FROM permissions p
    LEFT JOIN roles r ON r.id = p.role_id
    ORDER BY p.role_id
  `).all();
  const permissions = (rows.results || []).map(row => ({
    role: roleKeyFromName(row.role_name),
    permission: safeParse(row.permission_json, getDefaultPermissionSnapshot(roleKeyFromName(row.role_name))),
    updatedAt: row.created_at
  }));
  return json(request, env, { ok: true, permissions });
}

async function adminSavePermission(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;
  const body = await readJson(request);
  const role = normalizeRoleId(body.role || body.permission?.role || 'read_only');
  const permission = sanitizePermissionSnapshot(role, body.permission || body);
  const roleId = await roleIdFromKey(env, role);
  const encoded = JSON.stringify(permission);
  const update = await env.minova_auth_db.prepare('UPDATE permissions SET permission_json = ? WHERE role_id = ?')
    .bind(encoded, roleId).run();
  if (!update.meta?.changes) {
    await env.minova_auth_db.prepare('INSERT INTO permissions (role_id, permission_json) VALUES (?, ?)')
      .bind(roleId, encoded).run();
  }
  await writeAudit(env, gate.user.id, gate.user.username, 'admin_update_permission', 'role', role, { permission });
  return json(request, env, { ok: true, role, permission });
}

async function quoteCheck(request, env) {
  const session = await requireSession(request, env);
  if (session.response) return session.response;
  const body = await readJson(request);
  const permission = await permissionForUser(env, session.user);
  const result = evaluateQuotePriceAdjustment(permission, body.quoteRows || []);
  await writeAudit(env, session.user.id, session.user.username, 'quote_check', 'quote', String(body.quoteNo || ''), result);
  return json(request, env, { ok: true, ...result });
}

async function quoteApprovalRequest(request, env) {
  const session = await requireSession(request, env);
  if (session.response) return session.response;
  const body = await readJson(request);
  const permission = await permissionForUser(env, session.user);
  const result = evaluateQuotePriceAdjustment(permission, body.quoteRows || []);
  if (!result.requiresApproval) return json(request, env, { ok: true, approvalRequired: false, check: result });

  const insert = await env.minova_auth_db.prepare(`
    INSERT INTO quote_approvals (quote_no, requester_user_id, deviation_pct, status, remarks)
    VALUES (?, ?, ?, 'pending', ?)
  `).bind(
    String(body.quoteNo || ''),
    session.user.id,
    result.maxDeviationPct,
    JSON.stringify({ customerName: body.customerName || '', approvalRole: permission.quote?.approvalRole || 'price_auditor', limitPct: result.limitPct, payload: body, check: result })
  ).run();
  const id = insert.meta?.last_row_id || null;
  await writeAudit(env, session.user.id, session.user.username, 'quote_approval_requested', 'quote_approval', String(id || ''), result);
  return json(request, env, { ok: true, approvalRequired: true, approvalId: id, check: result });
}

async function quoteApprovals(request, env) {
  const gate = await requireSession(request, env);
  if (gate.response) return gate.response;
  const permission = await permissionForUser(env, gate.user);
  if (!canManageQuoteApprovals(permission)) return json(request, env, { error: 'forbidden' }, 403);

  const url = new URL(request.url);
  const status = normalizeApprovalStatus(url.searchParams.get('status') || 'pending');
  const limit = boundedLimit(url.searchParams.get('limit'), 100, 200);
  const baseSql = `
    SELECT qa.id, qa.quote_no, qa.requester_user_id, qa.deviation_pct, qa.status, qa.approver_user_id,
      qa.remarks, qa.created_at, qa.decided_at,
      requester.username AS requester_username, requester.name AS requester_name,
      approver.username AS approver_username, approver.name AS approver_name
    FROM quote_approvals qa
    LEFT JOIN users requester ON requester.id = qa.requester_user_id
    LEFT JOIN users approver ON approver.id = qa.approver_user_id
  `;
  const rows = status === 'all'
    ? await env.minova_auth_db.prepare(`${baseSql} ORDER BY qa.id DESC LIMIT ?`).bind(limit).all()
    : await env.minova_auth_db.prepare(`${baseSql} WHERE qa.status = ? ORDER BY qa.id DESC LIMIT ?`).bind(status, limit).all();

  const approvals = (rows.results || []).map(row => {
    const detail = safeParse(row.remarks, {});
    return {
      id: row.id,
      quoteNo: row.quote_no,
      customerName: detail.customerName || detail.payload?.customerName || '',
      requesterUserId: row.requester_user_id,
      requesterName: row.requester_name || row.requester_username || '',
      requesterUsername: row.requester_username || '',
      deviationPct: row.deviation_pct,
      limitPct: detail.limitPct ?? detail.check?.limitPct ?? null,
      status: row.status || 'pending',
      approverUserId: row.approver_user_id,
      approverName: row.approver_name || row.approver_username || '',
      note: detail.decisionNote || (typeof detail === 'string' ? detail : ''),
      createdAt: row.created_at || '',
      decidedAt: row.decided_at || '',
      detail
    };
  });
  await writeAudit(env, gate.user.id, gate.user.username, 'quote_approvals_viewed', 'quote_approval', status, { limit });
  return json(request, env, { ok: true, approvals });
}

async function quoteApprovalDecision(request, env) {
  const gate = await requireSession(request, env);
  if (gate.response) return gate.response;
  const permission = await permissionForUser(env, gate.user);
  if (!canManageQuoteApprovals(permission)) return json(request, env, { error: 'forbidden' }, 403);
  const body = await readJson(request);
  const id = Number(body.approvalId || 0);
  const decision = String(body.decision || '').trim() === 'approved' ? 'approved' : 'rejected';
  if (!id) return json(request, env, { error: 'missing_approval_id' }, 400);
  const existing = await env.minova_auth_db.prepare('SELECT remarks FROM quote_approvals WHERE id = ?').bind(id).first();
  const detail = safeParse(existing?.remarks, {});
  const nextDetail = typeof detail === 'object' && detail
    ? { ...detail, decisionNote: String(body.note || '').trim() }
    : { decisionNote: String(body.note || '').trim() };
  await env.minova_auth_db.prepare(`
    UPDATE quote_approvals
    SET status = ?, approver_user_id = ?, remarks = ?, decided_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(decision, gate.user.id, JSON.stringify(nextDetail), id).run();
  await writeAudit(env, gate.user.id, gate.user.username, `quote_approval_${decision}`, 'quote_approval', String(id), {
    note: String(body.note || '').trim()
  });
  return json(request, env, { ok: true, status: decision });
}

async function auditEndpoint(request, env) {
  const session = await requireSession(request, env);
  if (session.response) return session.response;
  const body = await readJson(request);
  await writeAudit(env, session.user.id, session.user.username, String(body.action || 'frontend_event'), String(body.targetType || ''), String(body.targetId || ''), body.detail || {});
  return json(request, env, { ok: true });
}

async function adminAuditLogs(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;
  const filters = normalizeAuditLogFilters(Object.fromEntries(new URL(request.url).searchParams.entries()));
  const clauses = [];
  const binds = [];
  if (filters.user) {
    clauses.push("(u.username LIKE ? OR u.name LIKE ? OR CAST(a.user_id AS TEXT) = ?)");
    binds.push(`%${filters.user}%`, `%${filters.user}%`, filters.user);
  }
  if (filters.action) {
    clauses.push('a.action = ?');
    binds.push(filters.action);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await env.minova_auth_db.prepare(`
    SELECT a.id, a.user_id, a.action, a.target_type, a.target_id, a.detail_json, a.created_at,
      u.username, u.name, r.name AS role_name
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN roles r ON r.id = u.role_id
    ${where}
    ORDER BY a.id DESC
    LIMIT ?
  `).bind(...binds, filters.limit).all();
  return json(request, env, {
    ok: true,
    logs: (rows.results || []).map(row => ({
      id: row.id,
      userId: row.user_id,
      username: row.username || '',
      name: row.name || row.username || '',
      role: roleKeyFromName(row.role_name),
      roleName: row.role_name || '',
      action: row.action,
      targetType: row.target_type || '',
      targetId: row.target_id || '',
      detail: safeParse(row.detail_json, {}),
      createdAt: row.created_at || ''
    }))
  });
}

async function businessBootstrap(request, env) {
  const gate = await requireSession(request, env);
  if (gate.response) return gate.response;
  const permission = await permissionForUser(env, gate.user);
  const domains = Object.keys(BUSINESS_DOMAIN_PERMISSIONS).filter(domain => canReadBusinessDomain(permission, domain));
  let rows = { results: [] };
  if (domains.length) {
    const placeholders = domains.map(() => '?').join(',');
    rows = await env.minova_auth_db.prepare(`
      SELECT domain, record_id, payload_json, status, updated_at
      FROM business_entities
      WHERE status != 'deleted' AND domain IN (${placeholders})
      ORDER BY updated_at DESC
    `).bind(...domains).all();
  }
  const settingsRows = await env.minova_auth_db.prepare('SELECT setting_key, payload_json, updated_at FROM business_settings').all();
  const settings = {};
  const settingsUpdatedAt = {};
  for (const row of settingsRows.results || []) {
    const resource = businessSettingPermission(row.setting_key);
    if (resource && !canPerformAction(permission, resource, 'read')) continue;
    settings[row.setting_key] = safeParse(row.payload_json, {});
    settingsUpdatedAt[row.setting_key] = row.updated_at || '';
  }
  const payload = buildBusinessBootstrapPayload(rows.results || [], settings);
  payload.ok = true;
  payload.source = 'd1';
  payload.settingsUpdatedAt = settingsUpdatedAt;
  payload.hasD1Data = (rows.results || []).length > 0 || Object.keys(settings).length > 0;
  return json(request, env, payload);
}

async function businessEntityUpsert(request, env) {
  const gate = await requireSession(request, env);
  if (gate.response) return gate.response;
  const permission = await permissionForUser(env, gate.user);
  const payload = normalizeBusinessEntityUpsertPayload(await readJson(request));
  if (!payload.ok) return json(request, env, { error: payload.error }, 400);
  for (const item of payload.items) {
    if (!canWriteBusinessDomain(permission, item.domain)) return json(request, env, { error: 'forbidden', domain: item.domain }, 403);
  }
  await upsertBusinessEntities(env, payload.items, gate.user.id);
  await writeAudit(env, gate.user.id, gate.user.username, 'business_entity_upsert', 'business', String(payload.items.length), {
    domains: [...new Set(payload.items.map(item => item.domain))]
  });
  return json(request, env, { ok: true, count: payload.items.length });
}

async function businessEntityDelete(request, env) {
  const gate = await requireSession(request, env);
  if (gate.response) return gate.response;
  const permission = await permissionForUser(env, gate.user);
  const payload = normalizeBusinessEntityDeletePayload(await readJson(request));
  if (!payload.ok) return json(request, env, { error: payload.error }, 400);
  if (!canDeleteBusinessDomain(permission, payload.domain)) return json(request, env, { error: 'forbidden' }, 403);
  await env.minova_auth_db.prepare(`
    UPDATE business_entities
    SET status = 'deleted', updated_at = CURRENT_TIMESTAMP, updated_by = ?
    WHERE domain = ? AND record_id = ?
  `).bind(gate.user.id, payload.domain, payload.recordId).run();
  await writeAudit(env, gate.user.id, gate.user.username, 'business_entity_delete', payload.domain, payload.recordId, {});
  return json(request, env, { ok: true });
}

async function businessSettingsSave(request, env) {
  const gate = await requireSession(request, env);
  if (gate.response) return gate.response;
  const permission = await permissionForUser(env, gate.user);
  const payload = normalizeBusinessSettingsPayload(await readJson(request));
  if (!payload.ok) return json(request, env, { error: payload.error }, 400);
  for (const key of Object.keys(payload.settings)) {
    const resource = businessSettingPermission(key);
    if (!resource || !canPerformAction(permission, resource, 'edit')) {
      return json(request, env, { error: 'forbidden', settingKey: key }, 403);
    }
  }
  await upsertBusinessSettings(env, payload.settings, gate.user.id);
  await writeAudit(env, gate.user.id, gate.user.username, 'business_settings_upsert', 'business_settings', String(Object.keys(payload.settings).length), {
    keys: Object.keys(payload.settings)
  });
  return json(request, env, { ok: true, count: Object.keys(payload.settings).length });
}

async function quoteSave(request, env) {
  const gate = await requireSession(request, env);
  if (gate.response) return gate.response;
  const permission = await permissionForUser(env, gate.user);
  if (!canPerformAction(permission, 'quotes', 'edit')) return json(request, env, { error: 'forbidden' }, 403);
  const payload = normalizeQuoteCrudPayload(await readJson(request));
  if (!payload.ok) return json(request, env, { error: payload.error }, 400);
  const nowIso = new Date().toISOString();
  const doc = {
    v: 1,
    id: payload.id,
    name: payload.name,
    customerName: payload.customerName,
    quoteNo: payload.quoteNo,
    createdAt: payload.createdAt || nowIso,
    updatedAt: nowIso,
    timestamp: Date.now(),
    snapshot: payload.snapshot
  };
  await upsertBusinessEntities(env, [{ domain: 'saved_quote', recordId: payload.id, payload: doc }], gate.user.id);
  await writeAudit(env, gate.user.id, gate.user.username, 'quote_saved_d1', 'saved_quote', payload.id, {
    name: payload.name,
    quoteNo: payload.quoteNo
  });
  return json(request, env, { ok: true, quote: doc });
}

async function quoteGet(request, env) {
  const gate = await requireSession(request, env);
  if (gate.response) return gate.response;
  const permission = await permissionForUser(env, gate.user);
  if (!canPerformAction(permission, 'quotes', 'read')) return json(request, env, { error: 'forbidden' }, 403);
  const id = decodeURIComponent(new URL(request.url).pathname.replace(/^\/quotes\//, '')).trim();
  if (!id) return json(request, env, { error: 'missing_quote_id' }, 400);
  const row = await env.minova_auth_db.prepare(`
    SELECT payload_json FROM business_entities
    WHERE domain = 'saved_quote' AND record_id = ? AND status != 'deleted'
  `).bind(id).first();
  if (!row) return json(request, env, { error: 'quote_not_found' }, 404);
  return json(request, env, { ok: true, quote: safeParse(row.payload_json, null) });
}

async function quoteDelete(request, env) {
  const gate = await requireSession(request, env);
  if (gate.response) return gate.response;
  const permission = await permissionForUser(env, gate.user);
  if (!canPerformAction(permission, 'quotes', 'delete')) return json(request, env, { error: 'forbidden' }, 403);
  const body = await readJson(request);
  const id = String(body.id || body.quoteId || '').trim();
  if (!id) return json(request, env, { error: 'missing_quote_id' }, 400);
  await env.minova_auth_db.prepare(`
    UPDATE business_entities
    SET status = 'deleted', updated_at = CURRENT_TIMESTAMP, updated_by = ?
    WHERE domain = 'saved_quote' AND record_id = ?
  `).bind(gate.user.id, id).run();
  await writeAudit(env, gate.user.id, gate.user.username, 'quote_deleted_d1', 'saved_quote', id, {});
  return json(request, env, { ok: true });
}

async function adminBusinessMigrateFromStatic(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;
  const body = await readJson(request);
  const data = body.data && typeof body.data === 'object'
    ? body.data
    : body.state?.data && typeof body.state.data === 'object'
      ? body.state.data
      : {};
  const quoteDocs = Array.isArray(body.quotes) ? body.quotes : [];
  const { items, settings } = businessSnapshotToItems(data, quoteDocs);
  await upsertBusinessEntities(env, items, gate.user.id);
  await upsertBusinessSettings(env, settings, gate.user.id);
  await writeAudit(env, gate.user.id, gate.user.username, 'business_migrate_from_static', 'business', 'static', {
    entityCount: items.length,
    settingKeys: Object.keys(settings)
  });
  return json(request, env, { ok: true, itemCount: items.length, entityCount: items.length, settingCount: Object.keys(settings).length });
}

async function permissionForUser(env, user) {
  const role = roleKeyFromName(user.role_name);
  const row = await env.minova_auth_db.prepare('SELECT permission_json FROM permissions WHERE role_id = ?').bind(user.role_id).first();
  return mergePermissionSnapshot({ role }, safeParse(row?.permission_json, {}));
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email || '',
    role: roleKeyFromName(user.role_name),
    status: user.status,
    forcePasswordChange: isTemporaryPasswordHash(user.password_hash)
  };
}

async function currentSession(request, env) {
  const token = sessionTokenFromRequest(request);
  if (!token) return null;
  const tokenHash = await sha256Hex(token + String(env.MINOVA_SESSION_SECRET || 'minova-dev-secret'));
  const row = await env.minova_auth_db.prepare(`
    SELECT s.token_hash, s.expires_at, u.id, u.username, u.name, u.password_hash, u.role_id, u.status, r.name AS role_name
    , u.email
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE s.token_hash = ?
  `).bind(tokenHash).first();
  if (!row || new Date(row.expires_at).getTime() <= Date.now() || row.status !== 'active') return null;
  return {
    tokenHash,
    user: {
      id: row.id,
      username: row.username,
      name: row.name,
      email: row.email || '',
      role_id: row.role_id,
      role_name: row.role_name,
      status: row.status,
      password_hash: row.password_hash
    }
  };
}

export function sessionTokenFromRequest(request) {
  const auth = String(request.headers.get('authorization') || '').trim();
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) return bearer;
  return cookieValue(request.headers.get('cookie') || '', COOKIE_NAME);
}

async function ensureUsersEmailColumn(db) {
  try {
    await db.prepare("ALTER TABLE users ADD COLUMN email TEXT DEFAULT ''").run();
  } catch {
    // Existing databases already have the column, or the migration created it.
  }
}

export function normalizePasswordResetEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) return '';
  return normalized;
}

export function validatePasswordChangeRequest(body = {}) {
  const nextPassword = String(body.nextPassword || '');
  const nextPasswordConfirm = String(body.nextPasswordConfirm || '');
  if (nextPassword.length < 8) return { ok: false, error: 'password_too_short' };
  if (nextPassword !== nextPasswordConfirm) return { ok: false, error: 'password_mismatch' };
  return { ok: true, nextPassword };
}

export function normalizeUserCreatePayload(body = {}) {
  const username = String(body.username || '').trim();
  const name = String(body.name || '').trim();
  const email = normalizePasswordResetEmail(body.email || '');
  const role = normalizeRoleId(body.role || 'read_only');
  const password = String(body.password || '');
  if (!username) return { ok: false, error: 'missing_username' };
  if (!name) return { ok: false, error: 'missing_name' };
  if (String(body.email || '').trim() && !email) return { ok: false, error: 'invalid_email' };
  if (password.length < 6) return { ok: false, error: 'password_too_short' };
  return { ok: true, username, name, email, role, password };
}

export function normalizeUserUpdatePayload(body = {}) {
  const id = Number(body.id || body.userId || 0);
  const name = String(body.name || '').trim();
  const email = normalizePasswordResetEmail(body.email || '');
  const role = normalizeRoleId(body.role || 'read_only');
  const status = String(body.status || 'active').trim() === 'inactive' ? 'inactive' : 'active';
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'invalid_user_id' };
  if (!name) return { ok: false, error: 'invalid_name' };
  if (String(body.email || '').trim() && !email) return { ok: false, error: 'invalid_email' };
  return { ok: true, id, name, email, role, status };
}

export function normalizeUserDeletePayload(body = {}) {
  const id = Number(body.id || body.userId || 0);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'invalid_user_id' };
  return { ok: true, id };
}

export function canSoftDeleteUser({ currentUserId, targetUserId, targetRole, activeAdminCount } = {}) {
  if (Number(currentUserId) === Number(targetUserId)) return { ok: false, error: 'cannot_delete_self' };
  if (normalizeRoleId(targetRole) === 'admin' && Number(activeAdminCount || 0) <= 1) {
    return { ok: false, error: 'cannot_delete_last_admin' };
  }
  return { ok: true };
}

export function normalizeUserResetPasswordPayload(body = {}) {
  const id = Number(body.id || body.userId || 0);
  const adminPassword = String(body.adminPassword || '');
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'invalid_user_id' };
  if (!adminPassword) return { ok: false, error: 'missing_admin_password' };
  return { ok: true, id, adminPassword };
}

export function normalizeAuditLogFilters(raw = {}) {
  const user = String(raw.user || raw.username || '').trim();
  const action = String(raw.action || '').trim();
  return {
    ...(user ? { user } : {}),
    ...(action ? { action } : {}),
    limit: boundedLimit(raw.limit, 100, 200)
  };
}

export function domainPermission(domain) {
  const resource = BUSINESS_DOMAIN_PERMISSIONS[String(domain || '').trim()];
  return resource ? { resource, read: 'read', write: 'edit', delete: 'delete' } : null;
}

export function normalizeBusinessEntityUpsertPayload(body = {}) {
  const rawItems = Array.isArray(body.items) ? body.items : [body];
  const items = [];
  for (const raw of rawItems) {
    const domain = String(raw?.domain || '').trim();
    const recordId = String(raw?.recordId || raw?.record_id || raw?.id || raw?.payload?.id || '').trim();
    if (!domainPermission(domain)) return { ok: false, error: 'invalid_business_domain' };
    if (!recordId) return { ok: false, error: 'missing_record_id' };
    const payload = raw?.payload && typeof raw.payload === 'object' ? raw.payload : {};
    items.push({ domain, recordId, payload });
  }
  if (!items.length) return { ok: false, error: 'empty_business_payload' };
  return { ok: true, items };
}

export function normalizeBusinessEntityDeletePayload(body = {}) {
  const domain = String(body.domain || '').trim();
  const recordId = String(body.recordId || body.record_id || body.id || '').trim();
  if (!domainPermission(domain)) return { ok: false, error: 'invalid_business_domain' };
  if (!recordId) return { ok: false, error: 'missing_record_id' };
  return { ok: true, domain, recordId };
}

export function normalizeBusinessSettingsPayload(body = {}) {
  const settings = {};
  if (body.settings && typeof body.settings === 'object') {
    for (const [key, value] of Object.entries(body.settings)) {
      if (BUSINESS_SETTINGS_KEYS.has(key)) settings[key] = value && typeof value === 'object' ? value : {};
    }
  } else {
    const key = String(body.settingKey || body.setting_key || '').trim();
    if (!BUSINESS_SETTINGS_KEYS.has(key)) return { ok: false, error: 'invalid_setting_key' };
    settings[key] = body.payload && typeof body.payload === 'object' ? body.payload : {};
  }
  if (!Object.keys(settings).length) return { ok: false, error: 'empty_settings_payload' };
  return { ok: true, settings };
}

export function normalizeQuoteCrudPayload(body = {}) {
  const id = String(body.id || body.quoteId || '').trim();
  const name = String(body.name || '').trim();
  const customerName = String(body.customerName || '').trim();
  const quoteNo = String(body.quoteNo || '').trim();
  const snapshot = body.snapshot && typeof body.snapshot === 'object' ? body.snapshot : null;
  if (!id) return { ok: false, error: 'missing_quote_id' };
  if (!name) return { ok: false, error: 'missing_quote_name' };
  if (!snapshot) return { ok: false, error: 'missing_quote_snapshot' };
  return { ok: true, id, name, customerName, quoteNo, snapshot, createdAt: String(body.createdAt || '').trim() };
}

function businessSettingPermission(key) {
  if (['market_price_settings', 'subcategories_by_category', 'non_stock_pricing_strategies'].includes(key)) return 'priceList';
  if (['profit_settings', 'installer_profit_settings', 'installer_quote_settings'].includes(key)) return 'quoteSettings';
  return '';
}

export function businessSnapshotToItems(data = {}, quotes = []) {
  const arr = (value) => Array.isArray(value) ? value : [];
  const items = [
    ...arr(data.products).map(record => ({ domain: 'product', recordId: recordIdFor(record), payload: record })),
    ...arr(data.inventory).map(record => ({ domain: 'inventory', recordId: recordIdFor(record), payload: record })),
    ...arr(data.inventoryHistory).map((record, index) => ({ domain: 'inventory_history', recordId: recordIdFor(record, index), payload: record })),
    ...arr(data.salesRecords).map((record, index) => ({ domain: 'sales_record', recordId: recordIdFor(record, index), payload: record })),
    ...arr(data.historicalInventory).map((record, index) => ({ domain: 'historical_inventory', recordId: recordIdFor(record, index), payload: record })),
    ...arr(data.transportRecords).map(record => ({ domain: 'transport', recordId: recordIdFor(record), payload: record })),
    ...arr(data.marketPrices?.records).map(record => ({ domain: 'market_price', recordId: recordIdFor(record), payload: record })),
    ...arr(quotes).map(record => ({ domain: 'saved_quote', recordId: recordIdFor(record), payload: record }))
  ].filter(item => item.recordId);
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

export function buildBusinessBootstrapPayload(rows = [], settings = {}) {
  const bucket = {
    product: [],
    inventory: [],
    inventory_history: [],
    sales_record: [],
    historical_inventory: [],
    transport: [],
    market_price: [],
    saved_quote: []
  };
  const updatedAt = {};
  for (const row of rows || []) {
    const domain = String(row.domain || '').trim();
    if (!bucket[domain]) continue;
    const payload = safeParse(row.payload_json, null);
    if (!payload || typeof payload !== 'object') continue;
    bucket[domain].push(payload);
    updatedAt[domain] = maxIso(updatedAt[domain], row.updated_at || '');
    if (domain === 'saved_quote' && row.updated_at && !payload.updatedAt) payload.updatedAt = row.updated_at;
  }
  const quoteIndex = {
    v: 1,
    updatedAt: updatedAt.saved_quote || '',
    quotes: bucket.saved_quote
      .map(quote => ({
        id: String(quote.id || '').trim(),
        name: quote.name || quote.customerName || quote.id || '',
        customerName: quote.customerName || '',
        quoteNo: quote.quoteNo || '',
        createdAt: quote.createdAt || quote.updatedAt || '',
        updatedAt: quote.updatedAt || '',
        timestamp: Number(quote.timestamp || Date.parse(quote.updatedAt || quote.createdAt || '') || 0)
      }))
      .filter(quote => quote.id)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
  };
  return {
    data: {
      products: bucket.product,
      inventory: bucket.inventory,
      inventoryHistory: bucket.inventory_history,
      salesRecords: bucket.sales_record,
      historicalInventory: bucket.historical_inventory,
      transportRecords: bucket.transport,
      marketPrices: {
        records: bucket.market_price,
        categoryUnits: settings.market_price_settings?.categoryUnits || {},
        deletedRecordIds: settings.market_price_settings?.deletedRecordIds || []
      },
      subcategoriesByCategory: settings.subcategories_by_category || {},
      profitSettings: settings.profit_settings || null,
      installerProfitSettings: settings.installer_profit_settings || null,
      installerQuoteSettings: settings.installer_quote_settings || null,
      nonStockPricingStrategies: settings.non_stock_pricing_strategies || {}
    },
    quoteIndex,
    updatedAt
  };
}

function recordIdFor(record, index = 0) {
  const id = String(record?.id || '').trim();
  if (id) return id;
  const ts = record?.ts ?? record?.timestamp ?? record?.createdAt ?? record?.updatedAt ?? '';
  const parts = [record?.productId, record?.batchNo, record?.quoteNo, ts, index].map(v => String(v ?? '').trim()).filter(Boolean);
  return parts.length ? parts.join(':') : '';
}

function maxIso(left, right) {
  const l = Date.parse(left || '') || 0;
  const r = Date.parse(right || '') || 0;
  return r > l ? right : (left || right || '');
}

function canReadBusinessDomain(permission, domain) {
  const meta = domainPermission(domain);
  return !!meta && canPerformAction(permission, meta.resource, meta.read);
}

function canWriteBusinessDomain(permission, domain) {
  const meta = domainPermission(domain);
  return !!meta && canPerformAction(permission, meta.resource, meta.write);
}

function canDeleteBusinessDomain(permission, domain) {
  const meta = domainPermission(domain);
  return !!meta && canPerformAction(permission, meta.resource, meta.delete);
}

async function upsertBusinessEntities(env, items, userId) {
  for (const item of items || []) {
    await env.minova_auth_db.prepare(`
      INSERT INTO business_entities (domain, record_id, payload_json, status, updated_by)
      VALUES (?, ?, ?, 'active', ?)
      ON CONFLICT(domain, record_id) DO UPDATE SET
        payload_json = excluded.payload_json,
        status = 'active',
        updated_at = CURRENT_TIMESTAMP,
        updated_by = excluded.updated_by
    `).bind(item.domain, item.recordId, JSON.stringify(item.payload || {}), userId || null).run();
  }
}

async function upsertBusinessSettings(env, settings, userId) {
  for (const [key, value] of Object.entries(settings || {})) {
    if (!BUSINESS_SETTINGS_KEYS.has(key)) continue;
    await env.minova_auth_db.prepare(`
      INSERT INTO business_settings (setting_key, payload_json, updated_by)
      VALUES (?, ?, ?)
      ON CONFLICT(setting_key) DO UPDATE SET
        payload_json = excluded.payload_json,
        updated_at = CURRENT_TIMESTAMP,
        updated_by = excluded.updated_by
    `).bind(key, JSON.stringify(value || {}), userId || null).run();
  }
}

function normalizeApprovalStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (['pending', 'approved', 'rejected', 'all'].includes(status)) return status;
  return 'pending';
}

function boundedLimit(value, fallback = 100, max = 200) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(1, Math.min(max, Math.floor(n)));
}

export function generateTemporaryPassword(length = 12) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

async function requireSession(request, env) {
  const session = await currentSession(request, env);
  if (!session) return { response: json(request, env, { error: 'unauthorized' }, 401) };
  return session;
}

async function requireAdmin(request, env) {
  const session = await requireSession(request, env);
  if (session.response) return session;
  if (roleKeyFromName(session.user.role_name) !== 'admin') return { response: json(request, env, { error: 'forbidden' }, 403) };
  return session;
}

async function writeAudit(env, userId, username, action, targetType, targetId, detail) {
  await env.minova_auth_db.prepare(`
    INSERT INTO audit_logs (user_id, action, target_type, target_id, detail_json)
    VALUES (?, ?, ?, ?, ?)
  `).bind(userId || null, action, targetType || username || '', targetId || '', JSON.stringify(detail || {})).run();
}

function cookieValue(cookie, key) {
  return String(cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${key}=`))?.slice(key.length + 1) || '';
}

function safeParse(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function roleKeyFromName(name) {
  const exact = ROLE_NAME_TO_KEY[String(name || '').trim()];
  if (exact) return exact;
  const normalized = String(name || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return ROLE_DEFINITIONS[normalized] ? normalized : 'read_only';
}

async function roleIdFromKey(env, roleKey) {
  const key = ROLE_DEFINITIONS[roleKey] ? roleKey : 'read_only';
  const name = ROLE_DEFINITIONS[key].displayName;
  const row = await env.minova_auth_db.prepare('SELECT id FROM roles WHERE name = ?').bind(name).first();
  if (row?.id) return row.id;
  const inserted = await env.minova_auth_db.prepare('INSERT INTO roles (name, description) VALUES (?, ?)')
    .bind(name, ROLE_DEFINITIONS[key].defaultHolder ? `Default holder: ${ROLE_DEFINITIONS[key].defaultHolder}` : '').run();
  return inserted.meta?.last_row_id || 1;
}

function isTemporaryPasswordHash(encoded) {
  return String(encoded || '').startsWith('pbkdf2$');
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function hashPassword(password, salt = randomToken()) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100000 },
    key,
    256
  );
  const hash = bytesToBase64Url(new Uint8Array(bits));
  return { salt, hash, encoded: `pbkdf2$${salt}$${hash}` };
}

async function verifyPassword(password, expectedHash) {
  const raw = String(expectedHash || '');
  if (raw.startsWith('pbkdf2$') || raw.startsWith('pbkdf2-final$')) {
    const [, salt, hash] = raw.split('$');
    const next = await hashPassword(password, salt);
    return timingSafeEqual(next.hash, hash);
  }
  return timingSafeEqual(password, raw);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64Url(bytes) {
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function timingSafeEqual(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left.length !== right.length) return false;
  let out = 0;
  for (let i = 0; i < left.length; i += 1) out |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return out === 0;
}
