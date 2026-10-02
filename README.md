# Property Maintenance Management System

A Next.js maintenance-ticket MVP for tenants, managers, and technicians. Tickets move from OPEN to ASSIGNED to IN_PROGRESS to DONE. Phase 1 role restrictions and private attachments remain enforced.

## Requirements

- Node.js 22 LTS and npm (Docker also uses Node 22).
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
node --test scripts/security.test.cjs
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
- GET/PATCH /api/notifications: recent alerts / mark notifications read.

## Workflow Logic & Architecture

### Allowed Transitions
- `OPEN -> ASSIGNED` (Manager assigns, logs entry)
- `ASSIGNED -> IN_PROGRESS` (Technician marks started)
- `IN_PROGRESS -> DONE` (Technician marks complete)

These rules are strictly enforced in `lib/services/TicketService.ts`. Reverting to previous states or skipping states returns a `400 Bad Request`.

## ER Diagram

```mermaid
erDiagram
```sh
 User {
     String id PK
     String name
     String email UK
     String password
     Role role
     DateTime createdAt
 }
 Ticket {
     String id PK
     String title
     String description
     Status status
     Priority priority
     String tenantId FK
     String assignedToId FK
     DateTime createdAt
     DateTime updatedAt
 }
 TicketImage {
     String id PK
     String ticketId FK
     String imageUrl
 }
 ActivityLog {
     String id PK
     String ticketId FK
     String userId FK
     String action
     DateTime createdAt
 }
 Notification {
     String id PK
     String userId FK
     String message
     Boolean read
     DateTime createdAt
 }
```

```sh
 User ||--o{ Ticket : "TenantTickets"
 User ||--o{ Ticket : "AssignedTickets"
 Ticket ||--o{ TicketImage : "has"
 Ticket ||--o{ ActivityLog : "has logs"
 User ||--o{ ActivityLog : "creates"
 User ||--o{ Notification : "receives"
```
```
