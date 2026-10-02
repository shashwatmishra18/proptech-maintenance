# Property Maintenance Management System

A Next.js maintenance-ticket MVP for tenants, managers, and technicians. Tickets move from OPEN to ASSIGNED to IN_PROGRESS to DONE. Phase 1 role restrictions and private attachments remain enforced.

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

## Core workflow reliability

Ticket creation accepts LOW, MEDIUM, HIGH, or URGENT priority; omitted priority defaults to MEDIUM. New titles, descriptions, and notes are stored as plain text and rendered through React text expressions. Existing encoded records are not rewritten or automatically decoded.

Creation, assignment, and status changes commit their ticket state, activity logs, and notifications together. Assignment and status changes use conditional updates against the expected previous state; stale or repeated writes return 409. Invalid transitions and completed-ticket notes return 400. Unexpected errors return a generic 500 response.

Attachment consumption and cleanup serialize on the uploader's existing database row. Cleanup only removes owned private files without a ticket reference; legacy and linked attachments are never removed. Partial writes are cleaned up immediately, and failed ticket creation attempts clean up known uploads. A lost upload response or process crash can still leave an unlinked file; no automatic historical cleanup is performed.

Mutation forms guard duplicate clicks and restore their buttons after failures. Logout clears the session cookie and navigates to login after success. Notification reads target the displayed subset, and local read state changes only after server confirmation.

Run focused regression coverage with `node --test scripts/security.test.cjs scripts/reliability.test.cjs`. Reliability tests exercise real handlers/services with mocked database transactions, filesystem operations, and client hooks; they do not replace integration tests against PostgreSQL.

## Application UI

The public homepage offers sign-in and tenant registration. Signed-in visitors to `/` are redirected to their role dashboard. Tenant metrics display the API's total submitted and pending counts; manager and technician dashboards retain their existing supported metrics. Dashboard requests have independent loading, retryable error, and intentional empty states.

All three authorized ticket views expose notes until completion. Assignment, status, and note controls share the existing duplicate-submission guard. Ticket detail errors distinguish missing tickets, forbidden access, expired sessions, and service/network failures; stale controls are hidden after a failed refresh. Notes clear only after a successful save.

Notification dropdowns retain targeted reads and confirmed server counts, with loading, refresh/read errors, retry controls, and visible read labels. Notification records have no structured ticket ID, so items deliberately remain unlinked. Shared ticket cards, wrapping text, responsive detail columns, labelled form controls, a skip link, and native keyboard-accessible controls support desktop and mobile use.

Run the UI regression suite with `node --test scripts/ui.test.cjs`, or run all suites with `npm test`. These lightweight tests cover request-state recovery, role redirects, dashboard states, note permissions/submission, and safe error messages without additional framework dependencies.

## Workflow Logic & Architecture

### Allowed Transitions
- `OPEN -> ASSIGNED` (Manager assigns, logs entry)
- `ASSIGNED -> IN_PROGRESS` (Technician marks started)
- `IN_PROGRESS -> DONE` (Technician marks complete)

These rules are strictly enforced in `lib/services/TicketService.ts`. Reverting to previous states or skipping states returns a `400 Bad Request`.

## Release verification and operations

Run `npm ci --no-audit --no-fund`, the checks above, `npm audit`, and `node scripts/standalone-smoke.cjs`. `npm test` runs security, reliability, UI, and release edge-case tests. No seed runs in these checks.

For opt-in live tests, start a separate local Compose project named `proptech-maintenance-integration`, with `POSTGRES_PORT=55432`, using the configured development credentials. Set `RUN_LIVE_INTEGRATION=1` and `INTEGRATION_DATABASE_URL` to the private localhost:55432 URL for `proptech_db`, then run `node scripts/integration.cjs` after building. The script refuses remote hosts or other ports/databases, applies existing migrations, and creates unique local fixtures without resetting or deleting records. It uses HTTP port 3103 and stops its test server. Never point it at a forwarded production database.

For container QA, build `proptech-release-candidate`, run it on localhost:3105 connected to the isolated Compose network, and mount a dedicated named volume at `/app/storage/uploads` plus the legacy directory read-only. Set `QA_CONTAINER_NAME` to a `proptech-phase5-*` container name and the same integration environment, then run `node scripts/container-smoke.cjs`. This checks native bcrypt/Prisma execution, protected uploads, legacy support, and persistence across a container restart. Test records and volumes are retained.

The public `GET /api/health` returns 200 only with a valid JWT secret and reachable PostgreSQL, or generic 503 otherwise. It exposes no credentials or database details and is never cached. Docker uses it as a readiness check; migrations must still be deployed explicitly before app rollout.

Production deployment requires a TLS reverse proxy, request-size and authentication rate limits at the edge, private database access, appropriate database privileges, protected runtime secrets, and tested backups of the database and both attachment stores. Apply migrations with an appropriately privileged connection before starting the image; application startup performs neither migration nor seed. The database port is bound only to localhost by default. Compose's application port should be exposed only through your intended proxy/firewall configuration.

Do not bake legacy uploads into an image: they are excluded from the build context and must be mounted. All app instances using the same database must share the same private attachment storage. Keep the existing volume's UID/GID 1001 writable by the app. Missing environment variables or database connectivity leave readiness unhealthy, rather than reporting a working deployment.

Registration accepts passwords up to 72 UTF-8 bytes to prevent bcrypt truncation. Existing password hashes and user records are not rewritten. Sessions are stateless JWTs with seven-day expiry; logout removes the browser cookie, while secret rotation invalidates all tokens. There is no individual token revocation or account-management workflow.

Known operational limits: unlinked uploads after a process crash or lost response may require a controlled manual review; linked or legacy files must not be deleted. Search, pagination, staff invitations, password reset, organizations, notification history, and scheduling remain outside this release.

## ER Diagram

```mermaid
erDiagram
    User ||--o{ Ticket : reports
    User ||--o{ Ticket : assigned
    Ticket ||--o{ TicketImage : contains
    Ticket ||--o{ ActivityLog : records
    User ||--o{ ActivityLog : writes
    User ||--o{ Notification : receives
```
