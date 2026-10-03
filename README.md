# FixNest — Property Maintenance Management Platform

A property-aware maintenance application for tenants, managers, and technicians. Managers manage their own properties, units, and tenant assignments. Tickets move from OPEN to ASSIGNED to IN_PROGRESS to DONE; role restrictions and private attachments remain enforced.

[Live FixNest application](https://app-production-e601.up.railway.app) · [Production verification](RAILWAY-VERIFICATION.md).

## Requirements

- Node.js 22 LTS and npm (Docker also uses Node 22). The patched runtime is Next.js 15.5.24 with React 18; cookies and route parameters use its async APIs.
- PostgreSQL 15, either local or through Docker Compose.
- Docker Desktop with its Linux engine running for container deployment.

## Local setup

Run commands from the repository root.

1. Install exactly the locked dependencies:

```sh
npm ci
```

2. Copy .env.example to .env. Configure these values:

| Variable | Purpose |
| --- | --- |
| DATABASE_URL | PostgreSQL connection URL used by the app and Prisma CLI; localhost for a database published on the host |
| JWT_SECRET | Cryptographically random secret of at least 32 characters; missing/short secrets fail safely |
| POSTGRES_USER | Docker database user (default proptech) |
| POSTGRES_PASSWORD | Required Docker database password; choose your own |
| POSTGRES_DB | Docker database name (default proptech_db) |
| POSTGRES_PORT | Localhost-only database port on the host (default 5432) |
| DOCKER_DATABASE_URL | App's connection URL inside Docker; use db as hostname and the same database credentials |

DATABASE_URL and DOCKER_DATABASE_URL follow postgresql://USER:PASSWORD@HOST:5432/DATABASE?schema=public. URL-encode special characters in credentials. Keep real values only in ignored environment files or your deployment secret store. Changing POSTGRES_* does not change users/passwords in an existing PostgreSQL volume.

Generate JWT_SECRET locally using Node's crypto.randomBytes(48).toString('hex'), store it privately, and never commit it. Rotating the secret invalidates existing sessions. No default secret is supplied.

3. Start the database (if using Docker):

```sh
docker compose up -d db
```

4. Apply the existing migrations and generate the client:

```sh
npx prisma migrate deploy
npx prisma generate
```

Prisma 5 loads the root .env automatically. The schema defines DATABASE_URL; no prisma.config.ts is needed. These setup steps do not reset the database. Do not use migrate reset or the demo seed on data you need to preserve.

5. Start development:

```sh
npm run dev
```

Open http://localhost:3000/login or /register. Public registration creates TENANT accounts only; existing MANAGER and TECHNICIAN accounts remain usable.

## Optional demo seed — destructive

The seed deletes ALL users, tickets, activity logs, images, and notifications from the selected database before creating demo records. Run it only against a disposable development database you explicitly intend to replace. It never runs automatically during install, build, startup, or Docker deployment.
It now refuses databases containing properties or units before deleting anything. On an eligible disposable database it creates a demo property/unit and assigns the new demo tenant. Re-running it against that populated portfolio is deliberately refused.

```sh
npm run prisma:seed
```

Prisma's npx prisma db seed uses the same command. The seed has its own CommonJS tsconfig and uses the already installed ts-node. To check module loading/type compatibility WITHOUT executing database queries:

```sh
npm run prisma:seed:check
```

Demo accounts created only when you deliberately run the seed:

| Role | Email | Password |
| --- | --- | --- |
| Tenant | tenant@test.com | password123 |
| Manager | manager@test.com | password123 |
| Technician | tech@test.com | password123 |

## Verification and production build

```sh
npx prisma validate
npx prisma generate
npx tsc --noEmit --incremental false
npm run lint
npm test
npm run prisma:seed:check
npm run build
```

After building, run node scripts/standalone-smoke.cjs to verify standalone startup, assets, and unauthenticated security boundaries without database queries. It uses port 3102 and stops its test servers automatically.

The security suite uses database mocks and real JWT signing; it does not modify a database. The build uses a bundled local font and does not require Google Fonts access. It produces .next/standalone/server.js, .next/static, and public assets. The postbuild step removes environment files that Next.js otherwise traces into standalone output; deploy only the sanitized output and inject secrets at runtime.

For a normal local production run after building:

```sh
npm run start
```

For a standalone deployment, copy public and .next/static alongside the standalone output as the Dockerfile does, inject environment variables at runtime, then run node server.js.

## Docker deployment

Configure .env as above, including POSTGRES_PASSWORD, DOCKER_DATABASE_URL, and JWT_SECRET. The app profile is optional so docker compose up -d db continues to start only PostgreSQL.

```sh
docker compose up -d db
npx prisma migrate deploy
docker compose --profile app up -d --build
```

Alternatively build the image alone:

```sh
docker build -t proptech-app .
```

Migrations require the development Prisma CLI and must be run explicitly before deploying the application; the runtime image does not run migrations or seeds. Runtime secrets are not required for image builds and are excluded from the build context. The app runs as a non-root user on port 3000. Compose waits for the database health check before starting it.

New uploads live in writable storage/uploads, persisted through the uploads volume. Existing public/uploads files are retained and mounted read-only for compatibility. Their direct public URLs are blocked; the attachment API checks ticket access before reading them. Never expose either directory through a reverse proxy or static file host. Back up both attachment storage and the database, and do not remove Docker volumes containing data you need.

## API overview

- POST /api/auth/login, /api/auth/register, /api/auth/logout: sessions and tenant-only registration.
- GET/POST /api/tickets: role-filtered listing / tenant creation.
- GET /api/tickets/:id: details subject to ticket access rules.
- POST /api/tickets/:id/status: manager assigns a technician.
- PATCH /api/tickets/:id/status: assigned technician starts/completes work.
- POST /api/tickets/:id/notes: authorized ticket user adds a note.
- POST /api/upload: tenant uploads up to five JPG/PNG images, maximum 5MB each.
- GET /api/attachments/:id: authorized ticket attachment access; private, uncached responses.
- GET /api/users?role=TECHNICIAN: manager-only technician IDs/names for assignment.
- GET /api/metrics: role-specific counts.
- GET/PATCH /api/notifications: recent alerts / mark only supplied notification IDs read (`{ "ids": ["uuid"] }`, maximum ten). PATCH returns the remaining unread count.
- DELETE /api/upload: tenant cleanup of owned, unlinked private uploads (`{ "imageUrls": [...] }`, maximum five). Linked attachments are retained.
- GET/POST /api/properties, GET/PATCH /api/properties/:id: manager's own properties.
- POST /api/properties/:id/units, PATCH /api/properties/:id/units/:unitId: create/edit owned units; no deletion.
- GET /api/tenant-assignment?email=... and PATCH /api/tenant-assignment: manager exact-email lookup and assignment (`email`, nullable `unitId`, `expectedVersion`).
- GET /api/occupancy: authenticated tenant's current property/unit, or null.

## Properties, units, and migration

Managers use `/manager/properties` to create/edit properties and units and assign existing tenants. Each property has one owning manager. Unit identifiers are trimmed, normalized to uppercase, and unique within a property; different properties may reuse an identifier. A tenant has at most one current unit; multiple tenants may share a unit. Tenant occupancy invitations, deletion, leases, and occupancy history remain deferred.

Tenant lookup requires an exact email and returns only unassigned tenants or tenants already in the manager's properties. Managers can move those tenants between their own units or remove an assignment; they cannot claim another manager's occupied tenant. Assignment uses an expected version and locks the tenant row, so stale concurrent changes are rejected. Cross-manager transfers remain deferred.

New ticket requests require an assigned unit. The server locks the same tenant row and derives both location IDs from current occupancy; client-supplied `propertyId` or `unitId` is rejected. Tickets retain that location when the tenant subsequently moves. Property/unit names and addresses reflect current basic information, not a historical snapshot. Technician access remains limited to assigned tickets; technicians have no property browser.

Manager ticket lists, metrics, details, assignment, notes, and attachments require the property's owning manager. New creation/completion notifications go only to that manager, alongside existing tenant/technician notifications. Previous notification records are preserved unchanged and remain recipient-only.

Migration `20261002090000_property_foundation` only adds tables, nullable relations, indexes, and constraints. Existing users, tickets, images, notes/activity, and notifications are retained. The old schema had no separate location column; any free-text location stays in its original title/description. Legacy tickets retain null property/unit, are labelled in the UI, and remain readable by their reporting tenant and assigned technician. Managers cannot access unmapped legacy tickets because ownership is unknown; no association is inferred from current occupancy. A reviewed legacy mapping process remains a future operation.

Apply `npx prisma migrate deploy` before rolling out the new app and regenerate the Prisma client for host development. Do not reset or seed existing databases. The composite foreign key enforces unit/property consistency; only tenants may hold occupancy. No new environment variables are required. The existing readiness probe confirms connectivity, so migration status must still be checked explicitly.

Run `npm test` for all suites, including `scripts/properties.test.cjs`. The existing opt-in `scripts/integration.cjs` now verifies migration field preservation, two-manager isolation, structured and legacy tickets, occupancy/unit concurrency, and the full prior workflow on isolated local PostgreSQL. Container smoke fixtures also include a new local property/unit. Both retain data; neither runs the seed.

## Core workflow reliability

Ticket creation accepts LOW, MEDIUM, HIGH, or URGENT priority; omitted priority defaults to MEDIUM. New titles, descriptions, and notes are stored as plain text and rendered through React text expressions. Existing encoded records are not rewritten or automatically decoded.

Creation, assignment, and status changes commit their ticket state, activity logs, and notifications together. Assignment and status changes use conditional updates against the expected previous state; stale or repeated writes return 409. Invalid transitions and completed-ticket notes return 400. Unexpected errors return a generic 500 response.

Attachment consumption and cleanup serialize on the uploader's existing database row. Cleanup only removes owned private files without a ticket reference; legacy and linked attachments are never removed. Partial writes are cleaned up immediately, and failed ticket creation attempts clean up known uploads. A lost upload response or process crash can still leave an unlinked file; no automatic historical cleanup is performed.

Mutation forms guard duplicate clicks and restore their buttons after failures. Logout clears the session cookie and navigates to login after success. Notification reads target the displayed subset, and local read state changes only after server confirmation.

Run focused regression coverage with `node --test scripts/security.test.cjs scripts/reliability.test.cjs`. Reliability tests exercise real handlers/services with mocked database transactions, filesystem operations, and client hooks; they do not replace integration tests against PostgreSQL.

## Application UI

The public homepage offers sign-in and tenant registration. Signed-in visitors to `/` are redirected to their role dashboard. Tenant metrics display the API's total submitted and pending counts; manager and technician dashboards retain their existing supported metrics. Dashboard requests have independent loading, retryable error, and intentional empty states.

All three authorized ticket views expose notes until completion or cancellation. Assignment, status, and note controls share the existing duplicate-submission guard. Ticket detail errors distinguish missing tickets, forbidden access, expired sessions, and service/network failures; stale controls are hidden after a failed refresh. Notes clear only after a successful save.

Notification dropdowns retain targeted reads and confirmed server counts, with loading, refresh/read errors, retry controls, and visible read labels. Notification records have no structured ticket ID, so items deliberately remain unlinked. Shared ticket cards, wrapping text, responsive detail columns, labelled form controls, a skip link, and native keyboard-accessible controls support desktop and mobile use.

Run the UI regression suite with `node --test scripts/ui.test.cjs`, or run all suites with `npm test`. These lightweight tests cover request-state recovery, role redirects, dashboard states, note permissions/submission, and safe error messages without additional framework dependencies.

## Workflow Logic & Architecture

### Allowed Transitions
- `OPEN -> ASSIGNED` (Manager assigns, logs entry)
- `ASSIGNED -> IN_PROGRESS` (Technician marks started)
- `IN_PROGRESS -> DONE` (Technician marks complete)

These rules are enforced server-side. Managers may additionally reassign active work, cancel active tickets, and reopen completed tickets under the rules below.

## Ticket operations (Phase 7)

All dashboards search on title, description, property name, and unit identifier using server-side, case-insensitive literal matching. Search is trimmed and limited to 120 characters; empty search behaves normally. Counts and results always share the tenant-own, manager-owned-property, or technician-assigned scope. Legacy unmapped tickets keep reporter/assigned-technician access and remain excluded from manager lists.

`GET /api/tickets` accepts `q`, `status`, `priority`, `sort`, `page`, and `pageSize`. Managers additionally filter by UUID `propertyId`, `unitId`, and `technicianId`; technicians may filter by `propertyId`. Invalid, unknown, repeated, or role-inappropriate parameters return 400. Unknown or inaccessible valid IDs produce scoped empty results. Sort is an allowlist: `newest` (default), `oldest`, `priority` (URGENT first), or `updated`, with stable ID tie-breaking. Pages default to 1, page size to 12 (maximum 50; page maximum 10000). The response data is `{ tickets, total, page, pageSize, totalPages }`; out-of-range pages clamp to the last page. Count and page are read in one repeatable-read transaction. This replaces the earlier array response; all repository consumers are updated.

Dashboard filters, sort and page persist in the URL, including refresh/back navigation. Apply resets the page; Clear resets the query. Filter choices from `GET /api/tickets/options` expose only managed properties/units or the technician's assigned-ticket properties. The existing manager-only global technician name/ID directory remains available; no technician-property membership is inferred.

`POST /api/tickets/:id/operations` requires `expectedVersion` plus one of:

- `{ action: "reassign", technicianId, expectedVersion }`: owning manager only, ASSIGNED or IN_PROGRESS, different valid technician. Work returns to ASSIGNED so the destination explicitly starts it. The previous technician immediately loses ticket/note/attachment access.
- `{ action: "cancel", expectedVersion }`: reporting tenant while OPEN, or owning manager while OPEN/ASSIGNED/IN_PROGRESS. CANCELLED is terminal; ticket, assignment, images, notes and history are retained. Assigned technicians retain historical read access but cannot continue work or add notes.
- `{ action: "reopen", expectedVersion }`: owning manager only, DONE → OPEN, assignment cleared. Tenants and technicians cannot reopen; cancellation cannot be reopened.

Initial OPEN → ASSIGNED remains separate from reassignment. Normal work stays ASSIGNED → IN_PROGRESS → DONE, assigned technician only. UI confirms reassignment, cancellation and reopening. Activity names both technicians and records cancellation/reopening explicitly. New lifecycle notifications reach affected tenant, owning manager, previous technician and destination technician where relevant, excluding the initiating user. State, version, activity and notifications commit together or roll back together.

Every successful assignment, work transition, lifecycle operation or note increments the ticket version. New operations require a version; existing assignment/status/note endpoints accept optional `expectedVersion` for backward compatibility, and the UI always sends it. All writes use conditional version/state predicates, so incompatible concurrent requests have one winner and a 409 loser. Authorization is checked before version disclosure: a technician whose access was already revoked gets 403 instead. Notes recheck current access inside their write transaction. Stale UI writes refresh details and retain unsaved notes. Existing metrics keep their definitions; cancelled requests are not pending work.

Migration `20261002160000_ticket_operations` only appends CANCELLED to the enum and adds `Ticket.version` default 0. Existing statuses, rows, attachments, history and notifications are preserved. Apply `npx prisma migrate deploy` before the app rollout; regenerate Prisma for host development. No new environment variables, seed or database reset are needed.

Run `node --test scripts/ticket-operations.test.cjs` (included in `npm test`). The guarded local `scripts/integration.cjs` also runs `scripts/ticket-operations.integration.cjs`: real PostgreSQL scoped queries, isolation, protected attachments, lifecycle authorization, notification rollback, and barrier-controlled reassignment/start/cancel/completion/reopen races. It retains unique fixtures and snapshots all existing tables before migration. UI tests cover role controls, native confirmation, stale refresh, and restored filter choices.

## Accounts and staff onboarding (Phase 8)

Public signup remains TENANT-only. Managers use `/manager/staff` to invite technicians; manager provisioning remains an operator/bootstrap action. Staff ownership records the inviting manager and only that manager may revoke/renew invitations or deactivate/reactivate the technician. Existing technicians without onboarding ownership remain globally assignable but cannot be deactivated through an arbitrary manager's account UI. Technician-property membership is unchanged and deferred.

Invitation creation provisions an inactive technician with an unusable random password. Tokens contain 256 random bits; PostgreSQL stores only SHA-256 hashes, purpose, bound email/role, credential version, creator, expiry, and used/revoked timestamps. Invitations expire after 48 hours. Acceptance sets a validated password and activates the account atomically. Used/expired/revoked links fail safely; renew rotates an unused invitation and invalidates previous links. Duplicate accounts/invitations return 409. Accepted invitations cannot be renewed or reused.

All new passwords require at least 10 characters, nonblank content, and at most 72 UTF-8 bytes to prevent bcrypt truncation. Spaces are allowed; arbitrary complexity rules are omitted. Passwords use bcrypt. Existing shorter credentials can still sign in; their next change must meet the shared policy. `/account` shows name, email and role, permits name editing, and requires the current password and matching confirmation for password changes. Email, role, and status are never self-editable.

Forgot-password responses are identical for known, inactive and unknown emails and never contain reset links. Recovery tokens expire after 30 minutes, are single-use, and are invalidated by a newer request or credential change. Reset completion invalidates previous sessions. Credential delivery can use the Phase 9 email adapter; responses remain generic regardless of configuration or delivery result.

For local development testing only, set `DEV_CREDENTIAL_LINKS=1` with `NODE_ENV=development` and a local `APP_ORIGIN` (default `http://localhost:3000`). The delivery abstraction writes private files to ignored `storage/dev-credentials`; the manager also receives an invitation URL immediately after creation/renewal. An operator can read the matching reset file locally for QA. Bearer tokens stay in URL fragments, are submitted in request bodies, and are omitted from audit records. Keep local files and links private. This sink is disabled in production even if the flag is set, and its files are excluded from Docker. Production reset responses never return tokens or pretend to deliver email. When invitation email is unconfigured or fails, only the inviting manager receives a secure invitation URL in the create/renew response. The URL is displayed once in Staff, can be copied or hidden, and is never included in staff history or stored in plaintext. Renew rotates it; revoke disables any unused invitation. The existing HTTPS APP_ORIGIN determines its destination. No Resend credentials or new flags are required for this fallback.

Only accepted technicians may be reactivated. Deactivation requires reassignment or completion of ALL ASSIGNED/IN_PROGRESS work, including work belonging to other managers; historical tickets and activity remain intact. Assignment/reassignment and status changes serialize on the technician row, preventing assignment to a simultaneously disabled account. All active technicians remain available in the existing global assignment directory.

`User.active` defaults true and `authVersion` defaults zero. New JWTs include the version; existing JWTs without it mean zero and remain valid until a credential/status change. Every server-authenticated API request and server session lookup checks the current database account, role, active status, and version. Edge middleware retains signature/route checks; APIs enforce live account state. Password change/reset and deactivation/reactivation increment the version, invalidating all earlier JWTs. Logout still removes only the current browser cookie. Lightweight account events record invitation and credential/status operations without secrets; no audit-log product is added.

Migration `20261002190000_account_credentials` only adds user fields, ownership relations, token/event tables, and indexes. Existing users, password hashes, roles, tickets, images and histories are preserved. Apply `npx prisma migrate deploy` before app rollout and regenerate Prisma for host development; never reset or run the destructive seed. Normal production operation does not require enabling development delivery.

New endpoints: `GET/PATCH /api/account`, `POST /api/account/password`, `GET/POST /api/staff`, `PATCH /api/staff/:id`, `DELETE/POST /api/staff/invitations/:id` (revoke/renew), `POST /api/auth/forgot-password`, and `PUT/POST /api/auth/invitation` or `/api/auth/reset-password` (inspect/complete bearer link). Staff status updates require `expectedVersion`. Token acceptance and password mutations serialize on the user row and commit state, token consumption/revocation, and audit together.

Run `node --test scripts/accounts.test.cjs` or `npm test`. The guarded local `scripts/integration.cjs` additionally runs `scripts/accounts.integration.cjs` for real PostgreSQL token consumption, ownership, password changes, resets, session invalidation, inactive accounts, account audit, and competing token/account/ticket mutations. Fixtures are retained. Continue using edge authentication rate limits from the deployment checklist; no in-process rate-limit substitute is introduced.

## Notifications and communication (Phase 9)

Notifications now have a nullable Ticket reference. New ticket creation, assignment, work-start, completion, reassignment, cancellation and reopening notifications store the actual ticket ID in their existing transaction. Legacy/account rows remain readable without guessed links. Notes stay in ticket activity without generating updates for every edit; account events remain in the security audit.

The bell shows ten recent updates and marks only displayed unread IDs. `/notifications` provides newest-first history, read/unread indicators, an unread filter, individual reads, and pagination (20 per UI page, API maximum 50). `GET /api/notifications` accepts only `page`, `pageSize`, and `state=all|unread`. Counts, metadata and rows use the authenticated user. Links use the explicit relation after checking current role/ownership/assignment. Reassigned technicians retain their own historical messages but lose links to inaccessible tickets; ticket APIs independently enforce access.

`PATCH /api/notifications` accepts `{ids: UUID[]}` (maximum 50) or `{all:true,before: snapshotAt}`. Mark-all affects only the current user and the server-provided history cutoff, retaining later arrivals as unread. The bell polls every 30 seconds while visible; history does not poll and signals the bell after read updates. History queries use a repeatable-read snapshot and deterministic timestamp/ID ordering.

Production invitation/reset delivery uses the EmailSender interface and a Resend HTTPS adapter without an SDK dependency. Configure `EMAIL_PROVIDER=resend`, private `RESEND_API_KEY`, a verified `EMAIL_FROM`, and root HTTPS `APP_ORIGIN=https://your-domain`. Compose forwards these values at runtime. See [Resend send-email API](https://resend.com/docs/api-reference/emails/send-email). Delivery runs after credential transactions commit, uses minimal plain-text content, token fragments, an idempotency hash, and an eight-second timeout. Provider acceptance means accepted/queued, not confirmed inbox receipt. Managers see acceptance, failure, or missing configuration. Renewal rotates the token and revokes earlier unused links; failed delivery never consumes an invitation. Reset responses remain generic. Invitation fallback URLs are returned only by manager-authorized create/renew operations when delivery is unavailable; public responses, other managers, staff history, application logs and database records never expose plaintext tokens.

The opt-in local development sink is unchanged; nonproduction modes never call the remote adapter. Automated PostgreSQL tests disable the provider and remote boundary tests use mocks. Real remote delivery requires operator credentials/domain configuration and is unverified locally. Ticket lifecycle emails and email preferences remain deferred; in-app lifecycle updates remain enabled.

Migration `20261002210000_notification_tickets` adds the nullable relation and lookup/history indexes only. Old messages and read states are preserved. Apply `npx prisma migrate deploy` before app rollout and regenerate Prisma for host development. Never reset or seed existing data.

Run `npm test` or `node --test scripts/notifications.test.cjs`. The guarded local integration runner includes `scripts/notifications.integration.cjs` for ownership, counts/pagination, read cutoffs, legacy rows, role-specific links, lost assignment access and lifecycle references, alongside prior account/ticket races and rollback checks. Run standalone and container smoke checks after building.

## Release verification and operations

Run `npm ci --no-audit --no-fund`, the checks above, `npm run audit:security` (see `BRACES-MITIGATION.md` for the single guarded advisory exception), and `node scripts/standalone-smoke.cjs`. `npm test` runs security, reliability, UI, and release edge-case tests. No seed runs in these checks.

For opt-in live tests, start a separate local Compose project named `proptech-maintenance-integration`, with `POSTGRES_PORT=55432`, using the configured development credentials. Set `RUN_LIVE_INTEGRATION=1` and `INTEGRATION_DATABASE_URL` to the private localhost:55432 URL for `proptech_db`, then run `node scripts/integration.cjs` after building. The script refuses remote hosts or other ports/databases, applies existing migrations, and creates unique local fixtures without resetting or deleting records. It uses HTTP port 3103 and stops its test server. Never point it at a forwarded production database.

For container QA, build `proptech-release-candidate`, run it on localhost:3105 connected to the isolated Compose network, and mount a dedicated named volume at `/app/storage/uploads` plus the legacy directory read-only. Set `QA_CONTAINER_NAME` to a `proptech-phase5-*` container name and the same integration environment, then run `node scripts/container-smoke.cjs`. This checks native bcrypt/Prisma execution, protected uploads, legacy support, and persistence across a container restart. Test records and volumes are retained.

The public `GET /api/health` returns 200 only with a valid JWT secret and reachable PostgreSQL, or generic 503 otherwise. It exposes no credentials or database details and is never cached. Docker uses it as a readiness check; migrations must still be deployed explicitly before app rollout.

Production deployment requires a TLS reverse proxy, request-size and authentication rate limits at the edge, private database access, appropriate database privileges, protected runtime secrets, and tested backups of the database and both attachment stores. Apply migrations with an appropriately privileged connection before starting the image; application startup performs neither migration nor seed. The database port is bound only to localhost by default. Compose's application port should be exposed only through your intended proxy/firewall configuration.

Do not bake legacy uploads into an image: they are excluded from the build context and must be mounted. All app instances using the same database must share the same private attachment storage. Keep the existing volume's UID/GID 1001 writable by the app. Missing environment variables or database connectivity leave readiness unhealthy, rather than reporting a working deployment.

Registration accepts passwords up to 72 UTF-8 bytes to prevent bcrypt truncation. Existing password hashes and user records are not rewritten. Sessions use seven-day JWTs with live account/version validation; logout removes the browser cookie, credential/status changes revoke earlier account sessions, and secret rotation invalidates all tokens. There is no per-device session-management workflow.

Known operational limits: unlinked uploads after a process crash or lost response may require a controlled manual review; linked or legacy files must not be deleted. Organizations, scheduling, lifecycle email preferences, and remote email-delivery verification remain deferred.

## ER Diagram

```mermaid
erDiagram
    User ||--o{ Property : manages
    Property ||--o{ Unit : contains
    Unit o|--o{ User : houses
    Property o|--o{ Ticket : locates
    Unit o|--o{ Ticket : locates
    User ||--o{ Ticket : reports
    User ||--o{ Ticket : assigned
    Ticket ||--o{ TicketImage : contains
    Ticket ||--o{ ActivityLog : records
    User ||--o{ ActivityLog : writes
    User ||--o{ Notification : receives
```

## Production release

See [DEPLOYMENT.md](DEPLOYMENT.md) for the supported private-volume deployment,
explicit migrations/manager bootstrap, HTTPS edge, CI, backups and rollback.
The development Compose file is not the public production deployment configuration.

Railway is the primary deployment path: one Docker application service, one
PostgreSQL service, and `/app/storage` as a private volume. Its dynamic `PORT`
is served by the in-image Node gateway; Next.js binds loopback. The runtime
retains headers/body/rate protections without a separate Nginx service and drops
to UID 1001 after fixed-path volume initialization. Migrations run only through
the explicit pre-deploy command, never application startup. Resend may be
explicitly disabled until a key and verified sender are available, without
exposing invitation/reset links. See [RAILWAY-VERIFICATION.md](RAILWAY-VERIFICATION.md)
for deployment access and evidence, and [DEPLOYMENT-DOCKER.md](DEPLOYMENT-DOCKER.md)
for the preserved portable Docker/Nginx alternative. Railway permits one instance
with the volume; redeployments can briefly interrupt service.

Run `node --test scripts/railway.test.cjs` for focused runtime/gateway checks.
`scripts/railway-container-smoke.cjs` is an opt-in additive local test restricted
to `proptech-railway-app`, localhost port 3108 and TLS PostgreSQL port 55433.
It requires `RUN_LIVE_INTEGRATION=1`, `QA_CONTAINER_NAME=proptech-railway-app`, and
`INTEGRATION_DATABASE_URL` for local `proptech_db` with strict TLS and the local
QA certificate. Never use a production tunnel or production data for this test.
