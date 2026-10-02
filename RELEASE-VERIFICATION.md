# Phase 10 verification record

Verified locally on 2026-10-03; no production resources accessed or modified.

This is the preserved Phase 10 portable Docker/Nginx evidence. Final Railway
preparation and its separate verification boundary are recorded in
[RAILWAY-VERIFICATION.md](RAILWAY-VERIFICATION.md); deployment instructions are
in [DEPLOYMENT.md](DEPLOYMENT.md).

## Results

- Clean `npm ci --no-audit --no-fund`: 486 packages installed.
- `npm audit`: zero vulnerabilities.
- Prisma schema validation/generation, TypeScript without incremental cache,
  ESLint and Next.js production build: passed.
- Existing security/reliability/UI/release/property/ticket/account/notification
  tests: all **65 passed**, preserved unchanged.
- New production tests: **4 passed** (environment/origin/TLS rejection, safe
  manager bootstrap, edge configuration, real persistent storage adapter).
- Safe seed configuration check: passed; **no database operations executed**.
- Standalone startup/assets/auth boundaries/missing-key smoke: passed.
- Development and production Compose configurations: validated.
- Both GitHub Actions workflows: local YAML parsing and structural checks passed;
  hosted execution still needs GitHub to run the pushed workflow. No production
  credentials are required for verification; release image publishing is manual.
- Five existing migrations reviewed and unchanged; local migrate deploy/status
  reported no pending migrations, with old-record snapshots preserved.
- Full live PostgreSQL suite passed: registration/login/logout, property/unit
  ownership and occupancy, priority persistence, creation, assignment/reassignment,
  OPEN → ASSIGNED → IN_PROGRESS → DONE, notes, cancellation/reopening,
  protected private/legacy attachments, search/filter/pagination, notifications,
  invitation/recovery/password changes, inactive account denial, session versions,
  transaction rollback and stale/concurrent update races.
- Final Linux runtime and separate operator image built successfully. Runtime
  runs as UID 1001; assets, native bcrypt/Prisma, private/legacy downloads, notes,
  no `.env`, no development token receipts, and volume persistence after restart
  passed against the local database. External email was disabled in workflow QA.
- Real Nginx HTTPS proxy: syntax passed, ready response, static CSS, CSP/security
  headers, private-path denial, middleware-header spoof denial, oversized JSON
  **413**, and actual rate-limit **429 with Retry-After** all passed.
- A separate local TLS PostgreSQL container restored a QA backup. The operator
  image applied migrations using `sslmode=require&sslaccept=strict` and a mounted
  local CA. Actual production entrypoint started, health/login/account access
  passed; removing the trusted CA caused certificate rejection. Provider email
  values in this startup-only test were dummy values; no mail endpoint was called.
- Actual manager bootstrap created a new local fixture and refused repeat use.
- Local backup restored into a **new retained database**; user/ticket/image/token
  counts matched. Original QA database and attachment volumes were retained.
- Production UI sanity: notification-to-ticket navigation and account forms
  worked; checked 320/390/1280 px layouts without horizontal overflow.
- Intended-file secret/token scan and whitespace check: passed. Local backups,
  certificates, credential receipts and QA files are excluded from Git/images.

## Deployment status and limits

No public hosting/domain, managed PostgreSQL, Resend credentials or production
storage volume were available. No live URL or remote delivery is claimed.
The supported architecture uses private persistent file storage, not S3; object
storage is not implemented or remotely tested. A single app instance and one
direct-traffic Nginx edge are supported. Scaling needs a shared private filesystem
and distributed/central edge limits. CSP permits inline Next hydration scripts;
it is a practical baseline rather than a nonce-based policy.

Provision the external services, set private configuration, build/select matching
immutable app/ops images, migrate explicitly, bootstrap one manager, start app and
edge, and run public HTTPS acceptance checks using [DEPLOYMENT.md](DEPLOYMENT.md).
No destructive seed, database reset, old-record deletion or automatic deployment
was performed. Stop after Phase 10.
