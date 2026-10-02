# FixNest Railway verification

## Actual production deployment — 2026-10-03

FixNest is live at **https://app-production-e601.up.railway.app**.
One project, `FixNest`, contains the GitHub-backed `app` service and private
SSL-enabled PostgreSQL 18 service `Postgres`. The application runs one replica,
with its private `app-volume` mounted at `/app/storage`. There is no public
database TCP proxy. The deployed application commit is `e7e3b6f`, built from
`shashwatmishra18/proptech-maintenance`, branch `main`; its
[hosted verification workflow passed](https://github.com/shashwatmishra18/proptech-maintenance/actions/runs/37063011706).
Wait for CI is enabled for automatic GitHub deployments.

Production deployment `938d75b1-e7ee-4d05-a3d8-608e3d1e1608` succeeded.
The configured pre-deploy command `node scripts/migrate-deploy.cjs` applied all
five existing migrations. A subsequent read-only query confirmed every migration
finished with no rollback, and `pg_stat_ssl` confirmed the real application
database connection uses TLS. The actual database public CA is configured;
strict certificate verification and bounded connection options remain enabled.
No seed, reset, `db push`, or migration-development command ran in production.

Startup logged `railway_gateway_started` with UID 1001. The storage root,
`uploads`, and `legacy` directories are owned by UID/GID 1001. Railway uses
`/api/health` with a 120-second timeout; HTTPS readiness returned only
`{"status":"ready"}` with HTTP 200. The initial user-owned Manager was created
using the existing bootstrap CLI with a masked private prompt and JSON stdin.
No password appeared in chat, command arguments, or saved credential files.

### Live acceptance results

- Homepage, login, registration, recovery/invitation screens, metadata, icon,
  security headers, and HTTPS readiness passed. Mobile verification at 390 × 844
  found no horizontal overflow (document width 375).
- Tenant registration, secure login cookies, role dashboards, profile updates,
  password change, old-session revocation, and generic recovery passed.
- Manager property/unit creation, tenant assignment, stale-version conflict,
  property isolation, and ticket search/filter/pagination passed.
- One synthetic maintenance request retained HIGH priority; tenant notes,
  notification history, authorized links, and mark-read passed.
- Private image upload/download passed. Anonymous, other-tenant, and other-manager
  attachment requests were denied. Foreign ticket/property access, staff signup,
  middleware bypass attempts, direct private file paths, and foreign origins
  were rejected. Oversized JSON returned 413.
- Live credential and upload budgets returned 429 with `Retry-After` despite
  spoofed forwarding headers. API cache responses retained `no-store`.
- Restarting the deployed app preserved the session, ticket, and exact private
  image bytes. Both services subsequently reported SUCCESS with one running replica.
- Email is explicitly disabled. A technician invitation honestly returned
  `delivered: false`, without a token or URL; the account stayed inactive and
  ticket assignment to it was rejected. Known/missing-account recovery responses
  matched and disclosed no credential tokens.
- All 78 automated tests passed again. Branding build/type/lint/audit and
  standalone checks also passed; application audit reported zero vulnerabilities.

No application defect was discovered. Early acceptance-harness expectations were
corrected for the existing role-specific dashboards, authorization statuses, and
manager notification links; application behavior was not changed. Synthetic
acceptance accounts were retained, including accounts from the early harness
attempt. Only one synthetic property/unit/ticket and one linked image were created;
no production records were deleted. No large fixture runner ran against production.

### Remaining acceptance limitations

Real technician activation/login, ticket assignment/reassignment, and the
technician IN_PROGRESS → DONE lifecycle await actual email delivery. Production
token fixtures were deliberately not inserted. Those workflows, transaction
rollback, concurrent ticket mutations, strict TLS failures, and database-outage
readiness/recovery passed the isolated local PostgreSQL/container verification
below; they are not claimed as live production results. The production database
was not intentionally stopped to simulate an outage.

To enable delivery later, configure the `app` service's Railway Variables:
`EMAIL_PROVIDER=resend`, `RESEND_API_KEY` (private Resend API key), and `EMAIL_FROM`
(verified sender). `APP_ORIGIN` is already the exact live HTTPS origin, which the
existing invitation/recovery URL generator uses. Actual outbound email and
received links remain unverified until those credentials are supplied privately.

## Historical preparation verification

The following records the earlier local-only preparation on 2026-10-03,
before the production deployment above. Railway dashboard opened to the login page;
there is no authenticated Railway session, CLI token or production credential
available to this task. No Railway resource was provisioned or modified. No
production database was connected, migrated, reset or seeded. There is no live
production URL, public acceptance result or `v1.0.0` tag from this work.

## Repository and architecture

- Primary platform: Railway, GitHub `main`, existing Dockerfile, one application
  service and one private SSL PostgreSQL service. No separate Nginx is required:
  Railway supplies HTTPS and the in-image Node gateway supplies request/header
  protection. The portable Nginx/Compose deployment remains documented separately.
- Railway `PORT` is dynamic. Gateway binds it on `0.0.0.0`; Next.js binds a
  separate loopback port. Graceful shutdown forwards termination to Next.js.
- One private application volume at `/app/storage`, containing `uploads` and
  `legacy`. Fixed-path initialization drops root to UID/GID 1001 before HTTP.
  No recursive file changes, automatic legacy copying or public file serving.
- Explicit pre-deploy `node scripts/migrate-deploy.cjs`; Prisma CLI/engines are
  packaged in the app image. Database URL normalization enforces strict TLS and
  a bounded connection pool, with trusted public CA material supplied separately.
  No migration or seed executes during application startup.
- Existing explicit manager bootstrap is compiled into the runtime image and
  accepts private JSON stdin. No overwrite, role-registration bypass or password
  argument was added. Explicit email disablement is permitted only for Railway;
  configured Resend remains validated. No development bearer-link exposure.
- Gateway enforces body sizes, bounded uploads, shared credential IP budgets,
  global budgets, host/origin checks, forwarded-header normalization and security
  headers. Limits are process-local: exactly one instance. Existing application
  authorization, database transactions and stale-update handling remain intact.
- GitHub CI on `main` retains every previous test and adds nine Railway tests,
  operator compilation and a final-image operator dependency check. Hosted CI
  execution must be confirmed on GitHub; local YAML validation is not that proof.

## Exact verification results

| Check | Result |
| --- | --- |
| Clean `npm ci --no-audit --no-fund` | Passed; 486 packages |
| `npm audit` | Passed; zero vulnerabilities |
| Prisma validation and generation | Passed |
| `npx tsc --noEmit --incremental false` | Passed |
| Compiled operator TypeScript | Passed |
| ESLint | Passed |
| Next.js production build | Passed; 36 generated routes |
| Existing `npm test` | 65/65 passed, unchanged |
| Existing production tests | 4/4 passed, unchanged |
| New Railway tests | 9/9 passed |
| Total automated tests | **78 passed, zero failed** |
| Seed configuration check | Passed; no database operations |
| Standalone smoke | Passed: startup, static assets, missing-secret/security boundaries |
| Existing full live integration | Passed against localhost:55432 development PostgreSQL |
| Final Railway application image | Built and verified against localhost-only TLS PostgreSQL |
| Preserved portable operator image | Built successfully |
| CI YAML structure | Validated locally; hosted execution not claimed |
| Git diff / secret review | Whitespace checks passed; no real tokens, passwords, keys or private PEM tracked |

Application image verified:
`sha256:b337d8ae351159a722a82eafc57338af8a9d766370e74ac7c34b547c999c6e29`.
Portable operator image:
`sha256:0e9dc2af63dac8610d99bffa3850392eecdb1e8d1bba5cfede4bfa71e361b53d`.

### Real PostgreSQL regression suite

The guarded existing integration runner applied migration deploy/status, then
verified all fields of existing users, tickets, images, logs, notifications,
properties, units, credential tokens and account events remained unchanged.
It passed registration races, secure login/logout, role/directory restrictions,
property/unit ownership and occupancy races, all priority values, uploads,
protected attachment authorization, assignment/start/completion races, notes,
notification ownership/count/read cutoffs, ticket searches and pagination,
reassignment/cancellation/reopening, account/staff onboarding, single-use token
hashing/expiry/replacement/consumption races, password changes/reset and JWT
revocation, activation guards, and real transaction rollback under injected
failure. New additive local fixtures remain; nothing was reset or seeded.

### Final Railway-style container verification

A new isolated PostgreSQL container bound only to `127.0.0.1:55433`, with its own
TLS certificate and retained named data volume, exercised the final application
image. `prisma migrate deploy` applied all five committed migrations; a second
invocation reported no pending migrations. Pre-deploy ran without the application
volume. Wrong CA and explicit insecure TLS options exited nonzero. Native Prisma
queries confirmed TLS in PostgreSQL `pg_stat_ssl`.

The app was bound only to `127.0.0.1:3108`, supplied `PORT=3211`, started with a
root-owned `/app/storage` volume, and ran both gateway PID 1 and Next.js as
`nextjs` UID 1001. Docker's dynamic-port healthcheck became healthy. Actual checks:

- Login/static assets; tenant registration and secure session cookie; compiled
  manager bootstrap succeeded, repeated bootstrap failed without changing the
  existing account; property/unit creation and occupancy assignment.
- Staff invitation persisted without revealing a token/link. A known hashed
  **local QA fixture**, with email deliberately disabled, exercised the real
  single-use invitation acceptance endpoint and technician login. Recovery
  responses exposed no token; no environment file or development receipt existed
  in the image/volume. This does not prove external email delivery.
- Private PNG upload, HIGH-priority ticket and persisted OPEN status, manager
  assignment, concurrent IN_PROGRESS requests producing one 200/one 409, tenant/
  technician notes, DONE and repeated-update conflict, scoped search and safe
  notification links/read operation.
- Unauthenticated/nonowner downloads rejected; authorized tenant/assigned
  technician reads succeeded. Protected legacy attachment reads also succeeded
  from the same private volume, while direct `/uploads/…` reads returned 404.
  Both new and legacy attachments survived an application restart.
- Database outage returned generic 503; restarting only this new QA database
  restored 200 readiness. Logout expired the browser cookie. Security headers
  appeared on pages, assets, health and errors; foreign host/origin and middleware
  spoof requests failed; streamed oversized JSON returned 413; a real credential
  burst returned 429 with `Retry-After` despite changing `X-Forwarded-For`.

The runtime check found and fixed a missing `zod` dependency for the compiled
bootstrap CLI in the standalone image. Rebuilt image checks and the full local
container workflow passed afterward. CI now checks those image dependencies.
A new notification test assertion initially expected an internal `ticketId`;
it was corrected to the existing safe public `ticketHref` contract. Application
notification behavior was not changed.

Task-owned Railway QA containers are stopped after verification. All new and
existing database/attachment volumes, fixtures and prior backup evidence are
retained. The original isolated integration PostgreSQL service remains running.
Local certificates, keys and compiled operator outputs are ignored and excluded
from the build context; no real credentials are included in this record.

## External release work remaining

Follow the exact checklist and variable table in [DEPLOYMENT.md](DEPLOYMENT.md):
sign in, authorize the repository, select/create the intended project, add/select
private PostgreSQL, attach `/app/storage`, export its public CA, set server secrets,
generate the HTTPS domain and `APP_ORIGIN`, configure pre-deploy/health/one instance,
confirm hosted CI, deploy, bootstrap the manager, configure backups and perform
public acceptance. Add a Resend key and verified sender and confirm inbox delivery
before claiming email onboarding/recovery readiness.

Both database and application volume backups are required. Prior **local**
backup/restore results are retained in [RELEASE-VERIFICATION.md](RELEASE-VERIFICATION.md);
Railway backup scheduling/restoration has not been configured or tested here.
Check paid-plan allowances, CPU/RAM, volume storage, backup/egress costs and Resend
limits. Volume deployments permit one instance and can have brief redeploy downtime.

`main` is prepared for Railway deployment, but public production readiness is
**pending authenticated provisioning and public acceptance**. Do not create a
release tag until that evidence exists. Commit/push identities are reported with
the task's final result; no history rewrite or force push is permitted.
