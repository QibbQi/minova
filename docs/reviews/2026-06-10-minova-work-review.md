# Minova Work Review - 2026-06-10

## Review Scope

Reviewed the current repository structure, recent development history, D1/Worker integration, frontend persistence paths, project guidance, Minova-specific skill, and automated tests.

## Work Content

The project has evolved from a static GitHub Pages quotation tool into a hybrid application:

- `index.html` remains the production UI and contains most quotation, pricing, inventory, PDF, and Site Overview behavior.
- `auth/` adds login, role permissions, sensitive-field controls, approval rules, admin UI, D1 bootstrap, and retryable business writes.
- `worker/` provides the Cloudflare API and D1 persistence for users, sessions, roles, permissions, approvals, audit logs, business entities, settings, and saved quotes.
- Recent product work added non-stock pricing, regional installer costs, role-oriented product views, channel partners, compatibility rules, compact navigation, and stronger D1 permissions.
- GitHub Sync remains useful for static backup, publication, and attachment storage, but is no longer the sole business-data path.

## Methods Observed

- Changes are generally incremental and backed by focused Node tests.
- Business formulas are protected with extraction-based tests from `index.html`.
- Cross-layer D1 work is tested through permission, payload normalization, bootstrap, and UI source assertions.
- The repository preserves compatibility through embedded state, localStorage, static JSON, IndexedDB, GitHub Sync, and D1.
- Large mirrored files are still updated directly, especially `index.html` and `module_body.js`; this works but raises drift risk.

## Standards And Style

- UI style is compact, operational, English-forward, and anchored by Minova purple/yellow branding.
- Exact wording, placement, column order, formulas, regional splits, and hidden-page behavior are treated as business requirements.
- Existing global DOM and inline-handler patterns are preferred over broad framework rewrites.
- State changes require end-to-end checks across UI, snapshots, static fallback, D1 mappings, permissions, and tests.

## Findings

### Important: Project guidance was stale after the D1 migration

`agents.md` and the Minova skill still described the application as purely static and omitted the Worker/D1 primary-data path. This could cause a future change to update only static state and silently miss production data behavior. The guides have been corrected.

### Important: No enforced D1 backup checkpoint existed

The repository had remote migration/deploy commands but no standard pre-change export command, external backup destination, integrity manifest, or rollback checkpoint. A reusable backup script and mandatory workflow have been added. The script waits for repeated stable reads before recording the final hash because large exports may continue settling after Wrangler reports the download step.

### Moderate: Mirrored frontend sources remain a maintenance risk

`index.html` and `module_body.js` are both very large and often change together. Future work must continue checking whether logic is mirrored, because a one-file fix can leave production and extracted code inconsistent.

### Moderate: Commit history mixes product commits with automatic data/publish commits

The history contains many `minova: sync data` and `minova: publish` commits. They are useful audit records but make logical rollback boundaries less obvious. New agent-authored work should use one focused commit per verified logical task and report the full SHA.

## Verification Baseline

- Root Node tests: 94 passed.
- GitHub Sync tests: 12 passed.
- Remote D1 backup created before this governance change and verified with SHA-256.
- No pre-existing uncommitted files were present when the review began.
