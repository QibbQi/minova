# Minova Worker Auth Backend

This folder contains the deployable Cloudflare Worker for Minova login, role permissions, quote approval checks, and audit logging.

Configured deployment:

- Worker: `minova-backend`
- Worker URL: `https://minova-backend.qibbqi00.workers.dev`
- D1 database: `minova-auth-db`
- D1 binding: `minova_auth_db`
- Future custom API host: `https://api.minovamy.com`

Before production use, set secrets and deploy:

```bash
npx wrangler secret put MINOVA_SESSION_SECRET
npx wrangler secret put MINOVA_INITIAL_ADMIN_PASSWORD
npx wrangler d1 migrations apply minova-auth-db --remote
npx wrangler d1 execute minova-auth-db --remote --file=./sql/seed-roles.sql
npx wrangler deploy
```

The initial admin account is seeded only when `MINOVA_INITIAL_ADMIN_PASSWORD` is available and no `admin` user exists:

- username: `admin`
- name: `Kelvin`
- email: `qibbqi00@google.com`
- role: `admin`
- forced password change: enabled

Do not commit the plaintext temporary password.
