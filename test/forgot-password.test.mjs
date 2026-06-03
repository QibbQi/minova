import test from 'node:test';
import assert from 'node:assert/strict';

import {
  allowedOrigin,
  normalizePasswordResetEmail,
  generateTemporaryPassword,
  sessionTokenFromRequest
} from '../worker/src/index.mjs';

test('normalizes valid password reset email and rejects invalid input', () => {
  assert.equal(normalizePasswordResetEmail('  Kelvin@Example.COM '), 'kelvin@example.com');
  assert.equal(normalizePasswordResetEmail('missing-at-symbol'), '');
  assert.equal(normalizePasswordResetEmail('a@b'), '');
});

test('generates a readable temporary password for email reset', () => {
  const password = generateTemporaryPassword();
  assert.equal(password.length, 12);
  assert.match(password, /^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]+$/);
});

test('cors origin resolver allows local file pages', () => {
  const env = { MINOVA_ALLOWED_ORIGINS: 'https://minovamy.com,https://qibbqi.github.io,http://localhost:8080' };
  const fileRequest = new Request('https://minova-backend.qibbqi00.workers.dev/auth/login', {
    headers: { origin: 'null' }
  });
  const localRequest = new Request('https://minova-backend.qibbqi00.workers.dev/auth/login', {
    headers: { origin: 'http://127.0.0.1:8082' }
  });
  const pagesRequest = new Request('https://minova-backend.qibbqi00.workers.dev/auth/login', {
    headers: { origin: 'https://qibbqi.github.io' }
  });
  assert.equal(allowedOrigin(fileRequest, env), 'null');
  assert.equal(allowedOrigin(localRequest, env), 'http://127.0.0.1:8082');
  assert.equal(allowedOrigin(pagesRequest, env), 'https://qibbqi.github.io');
});

test('session token can be read from bearer header or cookie', () => {
  const bearerRequest = new Request('https://minova-backend.qibbqi00.workers.dev/me', {
    headers: { authorization: 'Bearer session_abc' }
  });
  const cookieRequest = new Request('https://minova-backend.qibbqi00.workers.dev/me', {
    headers: { cookie: 'other=1; minova_session=session_cookie; theme=dark' }
  });

  assert.equal(sessionTokenFromRequest(bearerRequest), 'session_abc');
  assert.equal(sessionTokenFromRequest(cookieRequest), 'session_cookie');
});
