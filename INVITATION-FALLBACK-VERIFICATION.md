# Technician invitation fallback - 4 October 2026

## Implemented

When production email is unconfigured or fails, the inviting Manager receives
the one-time invitation URL only in the authenticated create/renew response.
The Staff screen displays the requested private-sharing warning and provides
copy, hide, renew, and revoke controls. Any unused invitation may be revoked,
including an expired one. Links are not persisted in the browser or included
in invitation-history responses.

Public registration remains Tenant-only. Existing invitation tokens remain
256-bit random values with SHA-256 hashes stored in PostgreSQL, 48-hour expiry,
TECHNICIAN/email/authVersion binding, ownership and single-use enforcement.
Activation uses the existing transaction and consumes the invitation without
creating another user. Password-recovery responses and the opt-in development
delivery sink retain their existing security behavior.

No migration, production environment change, reset, seed, or dependency update
is included. The unrelated uncommitted frontend revamp remains in the original
checkout; this branch starts at the deployed `914cc10` baseline.

## Verification

- TypeScript and ESLint passed.
- All 84 automated tests passed: 71 application tests and 13 production/Railway
  tests, including six new invitation tests.
- The final production build passed with the original account-completion screen unchanged.
- The full HTTP integration suite passed against only the existing local
  PostgreSQL database on `127.0.0.1:55432`, with all five migrations already
  applied. Existing records were preserved and fixtures retained.
- New real-database checks cover manager-only create responses, other-role and
  other-manager denial, staff-history token omission, renewal invalidating the
  old URL, revocation, regeneration, invited email display, atomic activation,
  successful technician login, single-use rejection, and no duplicate account.
- Existing real-database checks also cover expiry, email/role binding, concurrent
  acceptance, password/session security, and account/ticket rollback.
- Unit tests capture production logs and assert that tokens and URLs do not
  appear, including provider failure. UI tests exercise copy/hide/renew/revoke
  and the exact unconfigured-email warning.

## Authorized dependency mitigation

The user explicitly approved a guard and exception only for GHSA-vfj7-8cjw-p6xm.
See BRACES-MITIGATION.md for scope and removal criteria. npm audit remains active;
all unrelated findings block release. 87 automated tests pass (the existing 84
plus three guard tests). The real local PostgreSQL suite, build, standalone,
operator, schema and lint checks pass. Docker and hosted deployment verification
are in progress. No production data or Manager credentials changed during these checks.
