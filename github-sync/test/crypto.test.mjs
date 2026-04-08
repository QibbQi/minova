import test from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'

if (!globalThis.crypto) globalThis.crypto = webcrypto
if (!globalThis.btoa) globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64')
if (!globalThis.atob) globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary')

const { encryptWithPassphrase, decryptWithPassphrase } = await import('../crypto.js')

test('encrypt/decrypt roundtrip', async () => {
  const payload = await encryptWithPassphrase('pass', 'token123')
  const token = await decryptWithPassphrase('pass', payload)
  assert.equal(token, 'token123')
})

