# FixNest Railway production deployment

Deploy one Docker application service from `main`, one Railway PostgreSQL service,
and one private application volume. Railway terminates public HTTPS; a Node gateway
inside the application image retains headers, body limits and rate protection,
forwarding to Next.js on loopback. No separate Nginx, worker, Redis or S3 service is
needed. The portable deployment remains in [DEPLOYMENT-DOCKER.md](DEPLOYMENT-DOCKER.md).
See [RAILWAY-VERIFICATION.md](RAILWAY-VERIFICATION.md) for actual verification status.
Never seed/reset production or run the local integration scripts against it.

## Exact dashboard checklist

1. Sign in to Railway with GitHub access to `shashwatmishra18/proptech-maintenance`.
   Inspect the intended project first and reuse existing services/volumes. If new,
   deploy this GitHub repository, branch `main`, naming the service `app`. Hold
   automatic deployment until configuration is complete.
2. Add/select the SSL-enabled PostgreSQL service, called `Postgres` below. Keep
   database access private; do not expose its database port publicly.
3. Attach one private volume to `app` at **`/app/storage`**. Set **one instance**;
   disable sleep/serverless behavior for a reliable demonstration.
4. Obtain only the PostgreSQL public CA through authenticated Railway SSH:

   ```sh
   railway ssh --service Postgres -- openssl x509 -in /var/lib/postgresql/data/certs/root.crt -outform PEM
   ```

   Confirm the path for the selected database image. The [SSL template](https://github.com/railwayapp-templates/postgres-ssl/blob/main/init-ssl.sh)
   stores its CA there and signs the private hostname. Never export private keys.
   If the database rotates its CA, update `DATABASE_CA_CERT` before redeployment;
   do not disable certificate verification to resolve errors.
5. Configure these application variables, adjusting the database service name:

   | Variable | Exact value / source |
   | --- | --- |
   | `NODE_ENV` | `production`, also image default |
   | `DEPLOYMENT_PLATFORM` | `railway` |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` service reference |
   | `DATABASE_CA_CERT` | Manually supplied public PEM from step 4 |
   | `JWT_SECRET` | Manual cryptographically random secret, at least 32 characters; retain across deployments |
   | `APP_ORIGIN` | Exact generated `https://…up.railway.app` origin, without path/trailing slash |
   | `EMAIL_PROVIDER` | `disabled` until Resend is configured; then `resend` |
   | `RESEND_API_KEY` | Manual server-side key, required for `resend` |
   | `EMAIL_FROM` | Manual verified sender, required for `resend` |
   | `STORAGE_BACKEND` | `persistent` |
   | `UPLOAD_ROOT` | `/app/storage/uploads` |
   | `LEGACY_UPLOAD_ROOT` | `/app/storage/legacy` |
   | `DEV_CREDENTIAL_LINKS` | `0` |
   | `RAILWAY_RUN_UID` | `0` for mount initialization; runtime drops to UID/GID 1001 |
   | `PORT` | Railway supplied; do not override/hardcode |
   | `RAILWAY_VOLUME_MOUNT_PATH` | Railway supplied from `/app/storage` volume |

   Generate a JWT secret privately, for example `openssl rand -hex 48`; never
   commit it or log it. Missing database URL options are normalized to
   `sslmode=require`, `sslaccept=strict`, `connection_limit=5`, `pool_timeout=10`.
   Explicit insecure TLS settings fail. The public CA becomes a private temporary
   PEM for Prisma, including during pre-deploy when there is no application volume.
6. In application Settings configure:

   | Setting | Value |
   | --- | --- |
   | Builder | Dockerfile, repository root `/`, file `Dockerfile` |
   | Start command | `node scripts/production-start.cjs`, also image CMD |
   | Pre-deploy command | `node scripts/migrate-deploy.cjs` |
   | Pre-deploy timeout | 300 seconds |
   | Healthcheck path / timeout | `/api/health` / 120 seconds |
   | Instance count | 1 |
   | Restart policy | On failure, maximum 3 retries |
   | Wait for CI | Enabled for GitHub automatic deployments |

   Generate a public domain under Networking; set `APP_ORIGIN` before release.
   Use dashboard settings: Railway currently [deprecates configuration-as-code](https://docs.railway.com/config-as-code/reference).
7. Deploy. The explicit pre-deploy command applies committed migrations before
   replacement traffic; nonzero exit blocks rollout. Its [separate container](https://docs.railway.com/deployments/pre-deploy-command)
   has service variables/private networking, without the upload volume. The image
   includes Prisma CLI/engines. Startup never migrates or seeds. Do not invoke a
   second migration runner simultaneously.
8. Require migration success, `railway_gateway_started` with `uid:1001`, and
   HTTPS `/api/health` returning 200. Missing secrets, untrusted CA or unreachable
   PostgreSQL must fail startup/readiness. Inspect root/login and static assets.
9. Bootstrap the initial manager through private JSON standard input:

   ```sh
   railway ssh --service app -- node scripts/bootstrap-manager.cjs --confirm-bootstrap < /PRIVATE/bootstrap.json
   ```

   JSON contains `name`, `email`, `password`, validated by the shared policy.
   On Windows pipe `Get-Content -Raw -LiteralPath 'C:\PRIVATE\bootstrap.json'` to
   the same SSH command. Restrict file permissions and remove the file securely
   after onboarding. No password arguments/history/logs; an existing email fails
   without overwriting any account. The compiled existing CLI is in the image.
10. Enable automatic deployment from `main` with [Wait for CI](https://docs.railway.com/deployments/github-autodeploys).
    Confirm the hosted workflow is green and perform public acceptance before
    creating any release tag.

## Runtime, storage and security

Railway [mounts volumes as root](https://docs.railway.com/volumes). Startup checks
fixed paths, prepares only `/app/storage`, `uploads`, `legacy`, then drops groups
and UID/GID to 1001 before opening HTTP listeners. No existing files are copied,
deleted or recursively changed. Review readability of an existing volume explicitly.
Copy legacy files into `legacy` manually with checksum verification, retain the
source, and back up both directories alongside PostgreSQL. Neither is public.

The gateway listens on Railway's dynamic `PORT`; Next.js binds loopback only.
It rejects foreign hosts/origins, public storage paths, JSON above 64 KiB, and
upload bodies above 26 MiB. Existing limits remain five images, 5 MiB each. At
most two upload requests are active. Credential routes share 30/minute per IP
(burst 20); upload routes 10/minute (burst 10). Global budgets are 300/minute
(burst 100) and 30/minute (burst 20). Rejections return 429 with `Retry-After`.

Client identity uses ingress `X-Real-IP` from Railway's [networking specification](https://docs.railway.com/networking/public-networking/specs-and-limits),
not client `X-Forwarded-For`. Do not expose an additional unconfigured ingress or
place an unconfigured CDN/proxy in front. Private project peers are trusted;
global budgets still bound differing identities. Limits are process-local and
reset on restart, making one instance essential.

CSP, HSTS, frame denial, nosniff, no-referrer and restricted permissions apply to
pages, assets, errors and health. API/authenticated responses are private/no-store.
Application authorization still protects attachment downloads. Existing JWT
account versions, role/property isolation, credential token hashing, transaction
rollback and stale-update handling remain unchanged.

## Email and public acceptance

For email enable `resend`, a valid server key and verified `EMAIL_FROM`. Links
use HTTPS `APP_ORIGIN`. Confirm real inbox delivery and single-use acceptance/
reset before claiming email readiness. Explicit `disabled` allows deployment but
cannot deliver onboarding/recovery email; generic responses never reveal raw
links or development receipts. Never enable `DEV_CREDENTIAL_LINKS` in production.

Record public URL, deployed commit and results: tenant registration; secure
login/logout; manager bootstrap; staff invitation; properties/units/occupancy;
HIGH-priority ticket; assignment and OPEN → ASSIGNED → IN_PROGRESS → DONE; notes;
notification ownership/read status; private upload/download and unauthorized
access; password reset/old-session rejection; mobile navigation; HTTPS assets,
headers, rate limits and readiness. Use approved acceptance accounts, without
destructive automated production tests. Local tests do not prove this acceptance.

## Backups, rollback and costs

Configure PostgreSQL-volume and application-volume backups separately in each
Backups tab. Enable daily/weekly schedules if available on the selected plan;
take a manual backup before risky maintenance. Railway documents daily retention
6 days, weekly 27 days, monthly 89 days and incremental storage billing; [check
current availability/limits](https://docs.railway.com/volumes/backups) in the dashboard.
Do not promise free backups or PITR.

Also retain encrypted, access-controlled off-platform PostgreSQL dumps and archives
of `uploads` plus `legacy`. Export through authenticated service SSH using existing
database environment/local database authentication; never expose a database port
or put passwords in arguments. Verify binary exports and archive checksums.
Restore into a separate recovery database/project/volume, check record counts,
ticket downloads and permissions. Do not rehearse by overwriting production.
Previous local backup/restore evidence is in [RELEASE-VERIFICATION.md](RELEASE-VERIFICATION.md).

Rollback application code to its prior verified commit/image while retaining
volumes. Migrations persist: review schema compatibility and prefer a forward fix
rather than blindly reversing SQL. Railway [prohibits volume replicas and incurs
brief redeploy downtime](https://docs.railway.com/volumes/reference); no zero-downtime
claim is made. This design is intentionally for single-instance small-scale use.

Monitor readiness, restarts, delivery failures, disk growth and backups. Two
services consume CPU/RAM, two volumes storage, and backups/egress can incur charges.
Check current [Railway plans](https://docs.railway.com/pricing/plans) and Resend
allowances before launch. Durable PostgreSQL and private attachments cannot depend
on an unlimited-free assumption. Shared storage/rate protection for future scaling
is outside this release.
