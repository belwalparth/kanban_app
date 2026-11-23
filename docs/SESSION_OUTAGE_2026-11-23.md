# Production session outage, 2026-11-23

Restored service by rolling production back to `dpl_57MK5x6TiXZfb8QgZ759du1Zs577` (`https://kanban-ht7rbbz05-belwalparth.vercel.app`). No database migration or data replacement was performed.

## Cause

The live UI showed "Couldn't check your session. Please try again." Both `/api/auth/session` and `/api/health` returned HTTP 500 with `FUNCTION_INVOCATION_FAILED`. Runtime logs for `dpl_27jnxWP6vwEHnVESzam9YQxAvuv9` showed `check_schema` failing during application startup with `Run the database migration command before starting the app`.

The current source requires schema versions 1–4. Read-only production inspection confirmed versions 1–3, three users, six boards and three Google identities. The sharing code had reached production before the Part 21 database migration. A subsequent Vercel runtime import error also appeared in the failed startup logs; restoring the compatible release resolved the observed API failures without a runtime code change.

## Recovery and validation

- Verified the previous release's health endpoint returned HTTP 200 against the existing database before rollback.
- Vercel confirmed successful production rollback to the release above.
- Existing public smoke script passed all 18 requests after rollback: HTML/assets, health, Google authentication configuration, unauthenticated access rejection, origin protection, missing routes, and Google redirect/cookie settings.
- Browser verification confirmed the Google sign-in screen loads after recovery. Completing sign-in with a real Google account remains a user check.

## Next release

Current source still requires schema 4. Do not redeploy it against schema 3. Complete the Part 21 backup, migration rehearsal, isolated preview validation, runtime grants and coordinated schema/code release first. Rollback affects production auto-assignment; inspect that setting before the next release and explicitly promote the tested deployment as needed. Sharing remains pending hosted release.

Subsequent resolution on 2026-11-23: completed the backup/rehearsal, isolated hosted verification, schema-4 migration, permission checks and coordinated promotion. Sharing is now live; real three-account acceptance remains pending. See [Part 21 validation](PART21_VALIDATION.md) for the current release and compatible recovery targets.
