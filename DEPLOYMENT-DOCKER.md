# FixNest portable production deployment and recovery

## Architecture and boundaries

Use one Linux Docker host with Nginx terminating HTTPS, a non-root Next.js
standalone container, managed PostgreSQL, a private persistent upload volume,
and Resend. `compose.production.yml` is separate from the local database Compose
configuration. No production database container, fixture data or seed is started.
This is intentionally a small-scale, single application instance deployment.
Ephemeral/serverless hosts are unsuitable without a shared private storage adapter.
Object storage is not implemented or claimed verified; persistent private storage
is the selected supported production alternative.

The upload adapter uses `UPLOAD_ROOT` in production and `storage/uploads` locally.
Legacy attachments remain in a separately mounted read-only `public/uploads`.
Random UUID filenames, ownership locks, signature/type checks, five images at
5 MiB each, and authenticated download authorization are preserved. Neither
directory is served by Nginx. Downloads are proxied through authorized application
responses with private/no-store caching. Preserve both directories when migrating
hosts: explicitly copy, compare checksums and retain the source. Never copy or
delete attachments automatically during startup. No vendor credentials or public
object URLs are needed.

## Provisioning and secrets

1. Provision a Linux host with Docker Compose, enough disk for uploads/backups,
   and at least 2 GiB RAM (build elsewhere if necessary). Restrict SSH; expose
   only 80/443. Create DNS for the public hostname. Install a valid TLS certificate
   using the host's ACME client with automated renewal and Nginx reload.
2. Create an empty managed PostgreSQL database. Enable provider-required TLS,
   backups and restricted network access. Use provider CA validation where
   supported; never disable certificate validation. Runtime account needs normal
   application CRUD; operator migration account needs schema privileges.
3. Create a persistent Docker volume (not an anonymous ephemeral container disk),
   ensure its root is writable by UID/GID 1001, and create/preserve the legacy
   directory. Never use `docker compose down -v` or prune production volumes.
4. Verify a sending domain in Resend and issue a least-privilege sending key.
   Real delivery needs that key and a verified sender; tests use mocks and never
   send mail to QA accounts. Provider acceptance is not proof of inbox delivery.
5. Create a private, mode-0600 environment file **outside the checkout**:

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require&sslaccept=strict&connection_limit=5&pool_timeout=10
JWT_SECRET=YOUR_CRYPTOGRAPHIC_RANDOM_48_BYTE_HEX_VALUE
APP_ORIGIN=https://your-public-domain.example
EMAIL_PROVIDER=resend
EMAIL_FROM=Maintenance <support@your-verified-domain.example>
RESEND_API_KEY=YOUR_PRIVATE_SENDING_KEY
STORAGE_BACKEND=persistent
UPLOAD_ROOT=/app/storage/uploads
DEV_CREDENTIAL_LINKS=0
```

Generate JWT_SECRET with `openssl rand -hex 48`; keep it stable across releases.
Rotate it deliberately to revoke all sessions. URL-encode database credentials.
Prisma 5 requires `sslmode=require&sslaccept=strict`; its default certificate
acceptance is permissive. For a provider-specific CA mount the CA read-only into
both app and ops containers and append `sslcert=/ABSOLUTE/provider-ca.pem`.
The supplied `compose.ca.yml` does this: set `DATABASE_CA_PATH` to the provider CA
file, use `sslcert=/run/provider-ca.pem`, and include
`-f compose.ca.yml` after `-f compose.production.yml` in every operator/app command.
Do not use libpq-only `verify-full`/`sslrootcert` options with this Prisma version.
Managed pooling: budget five connections per app replica plus operator headroom;
use a provider-supported direct connection for migrations. For PgBouncer follow
the provider's Prisma 5 connection instructions, including `pgbouncer=true` if
required. Long-running containers use one Prisma client per process. No query
or database engine error logging is enabled, because errors can contain private
parameters. Generic operational events omit secrets and user content.

Set these Compose interpolation variables in a private shell/env file:
`APP_IMAGE`, matching `OPS_IMAGE`, `PRODUCTION_ENV_FILE` (absolute file path),
`UPLOAD_VOLUME` (existing volume name), `LEGACY_UPLOAD_PATH` (absolute directory),
`TLS_CERT_PATH` (directory containing fullchain.pem and privkey.pem), and
`PUBLIC_HOSTNAME` (exact domain matching APP_ORIGIN; no scheme or path).
Container startup rejects incomplete production configuration, missing TLS in
DATABASE_URL, non-HTTPS/non-root/loopback APP_ORIGIN, development token exposure,
or an unwritable upload mount. Build requires no production secrets.

Provision a newly chosen volume explicitly before the first rollout:

```sh
docker volume create "$UPLOAD_VOLUME"
docker run --rm --user 0 -v "$UPLOAD_VOLUME:/data" --entrypoint chown \
  "$APP_IMAGE" 1001:1001 /data
```

## Explicit release

Require a passing Verify release workflow for the exact commit before releasing.
The manual Build explicit release images workflow publishes immutable commit tags
to GHCR; configure the GitHub `release` environment with required reviewers. It
does not deploy a host or consume production credentials. Alternatively:

```sh
docker build --target runner -t YOUR_REGISTRY/proptech:COMMIT .
docker build --target ops -t YOUR_REGISTRY/proptech:ops-COMMIT .
```

Record the previous image, check backup/status, acquire an operator release lock
(one release at a time), and use the matching ops image:

```sh
docker compose -f compose.production.yml --profile ops config --quiet
docker compose -f compose.production.yml run --rm migrate
# This runs npx prisma migrate deploy's equivalent installed Prisma CLI.
# Stop here if migration fails; do not seed/reset/retry blindly.
docker compose -f compose.production.yml up -d app
docker compose -f compose.production.yml up -d edge
curl --fail https://YOUR_DOMAIN/api/health
```

The five existing migrations remain in order: initial schema, nullable property
foundation, CANCELLED enum/version, account credentials, notification references.
They add schema/defaults/relations and preserve legacy rows; no migration drops
or truncates records. PostgreSQL enum addition is not used in the same migration.
Indexes may lock briefly: release during low traffic and inspect provider limits.
For a source checkout, the explicit equivalent is `npx prisma migrate deploy`.
Never run `migrate dev`, `db push`, `migrate reset` or the demo seed in production.

Bootstrap the first manager once using the ops image and secure standard input:

```sh
# Supply JSON {"name":"...","email":"...","password":"..."} from a private
# password-manager-generated input file or pipe; never place a real password
# in shell history or command-line arguments. Remove the temporary input safely.
docker compose -f compose.production.yml run --rm -T migrate \
  node node_modules/ts-node/dist/bin.js --project tsconfig.seed.json \
  prisma/bootstrap-manager.ts --confirm-bootstrap < /PRIVATE/bootstrap.json
```

The CLI enforces the application's 10-character/72-byte policy, hashes with
bcrypt, refuses existing email and never overwrites users. Public registration
remains tenant-only. No production demo/sample data is automatically installed.

## Edge security and operations

Nginx accepts direct public traffic and overwrites forwarded headers; do not place
an unconfigured CDN/proxy in front (otherwise rate limits see its shared IP).
Nginx accepts only PUBLIC_HOSTNAME and rejects other hosts. Cookies remain Secure, HttpOnly,
SameSite=Lax. APP_ORIGIN creates HTTPS invitation/reset links; raw tokens stay
in fragments, not request query strings. Keep provider dashboards/logs private.

Credentials endpoints share 30 requests/minute/IP with a 20-request burst;
uploads allow 10/minute/IP with a 10-request burst. Shared Nginx worker memory
enforces limits, returns 429/Retry-After, and needs no per-app memory counter.
JSON bodies have a 64 KiB edge limit; uploads have 26 MiB envelope limit with
application signature/type/per-image/count checks. Existing ticket/search/note
schemas bound individual text lengths. No public app port permits edge bypass.
Adapt limits for shared NAT users if measured traffic requires it.

Headers include practical CSP (Next hydration requires unsafe-inline), nosniff,
no-referrer, frame denial, permissions restrictions and one-year HSTS at TLS edge.
Private APIs explicitly send no-store. Nginx has no filesystem root or cache.
Errors/logs omit request URLs, bodies, cookies, tokens and IP addresses. Monitor
HTTP 5xx, readiness, disk space and provider mail failures. Docker rotates logs.
`/api/health` is public no-store readiness: SELECT 1 and signing-key validation,
returning only ready/unavailable (503). Process reachability is separate from
dependency readiness; do not restart indefinitely for a transient DB outage.
Docker runs as UID 1001 and forwards SIGTERM to Node with 30 seconds grace.

All account tokens, JWT version checks, notification state and concurrency locks
are shared through PostgreSQL. Multiple replicas require a shared writable upload
filesystem mounted at the same path and one shared rate-limiting edge. This Compose
release supports one app replica; do not scale across hosts with local volumes.
For multiple independent edges use provider-distributed limits, not isolated zones.

## Backup, restore and rollback

Enable daily managed DB backups with at least 14 days retention and PITR where
available. Snapshot/back up private and legacy upload volumes daily to encrypted
off-host storage with restricted credentials and 30-day retention. Back up before
each release and coordinate DB/file snapshots; retain immutable images and config
references. Confirm backups by restoring into a **new isolated database and new
volume**, running migrate status and comparing row counts/files/checksums. Never
restore over production as a drill. Review capacity/retention and access quarterly.

Rollback app independently: set APP_IMAGE to the recorded previous immutable image,
keep the existing upload volumes and run `up -d app`, then readiness/smoke checks.
Do not blindly roll migrations backward. Check previous app/schema compatibility;
forward-fix schema failures with a reviewed new migration. A full data restore is
an explicit incident decision with downtime and data-loss assessment.

## Acceptance and common failures

After deployment verify health, tenant-only registration/login, manager property
isolation, assigned-unit ticket upload, technician assignment/start/note/completion,
notification links, credential email completion and protected attachment/logout.
Use dedicated operator-approved QA users; no automatic destructive seed.

503/startup failure: check secret presence, HTTPS origin, TLS DB URL and UID 1001
mount permissions without printing secrets. Migration failure: inspect Prisma
status privately and repair the cause before rollout. Upload failure: disk quota,
mount permissions and signature/size limits. Mail unavailable: verified sender,
provider key and origin; renew invitation safely after correcting delivery. 429:
wait Retry-After; check shared-IP traffic before changing limits. Certificate
renewal: test ACME renewal and reload edge. Static asset errors: ensure matching
immutable image, never mix `.next` versions. Keep app port private.

External host/domain/TLS, managed database, private volume and verified Resend
credentials must be provisioned by the operator if unavailable locally. No live
production URL or remote delivery/storage verification is implied by local QA.

References: [Nginx request limiting](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html),
[Docker production Compose](https://docs.docker.com/compose/how-tos/production/),
[Prisma PostgreSQL TLS options](https://docs.prisma.io/docs/orm/core-concepts/supported-databases/postgresql).
