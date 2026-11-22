# Production recovery

Production: `https://kanban-app-seven-nu.vercel.app`, Vercel project `belwalparth/kanban-app`. The separate `kanban_app` project is not this FastAPI deployment.

## Before a release

Record the production deployment ID, Git commit, schema versions, and database backup/restore point. Keep credentials and board contents out of release notes. Use a database-owner direct connection only in the private operator environment; serving functions use the pooled connection.

Before schema changes, take a provider snapshot or a custom-format `pg_dump` backup stored privately outside the repository. Use a compatible PostgreSQL client version. Verify the backup by restoring to a separate empty database, running `check_schema`, and comparing user/board counts and board revisions. Never point the integration test suite at a backup containing wanted data: its fixture drops the public schema. No production restore or backup rehearsal was performed during Part 15.

## Application rollback

Known working production deployment before the Part 15 persistence redeploy: `dpl_HefJe5wV7vE5iygSfDmNG3dgDnpC`, commit `7ef079b43651c54045158798312b3b42f0b2d6cf`, schema versions 1 and 2.

Production was upgraded to schema 3 on 2026-11-22. The first verified schema-3 release is `dpl_4RrVRh8fnfard7GGMeKfwaNNJbXw`, commit `df4d9415942b0b3da375f9a79d724ce062b08940`. The Part 15 deployment IDs are incompatible rollback targets. Choose a schema-3-compatible release or follow a deliberate database restore plan; see [database operations](DATABASE_OPERATIONS.md).

The pre-upgrade custom-format PostgreSQL 18 backup is `/private/before-schema3-verified.dump` in Docker volume `kanban-part18-private-backups`. Its restore was rehearsed in an isolated database, then schema 3 was applied to the copy and all original data fingerprints verified. Preserve the volume and Docker storage; deleting either destroys this local recovery artifact. The archive predates new multi-board writes and does not merge later changes. See [Part 18 validation](PART18_VALIDATION.md).

1. Inspect the current project and intended prior deployment. Confirm account `belwalparth`, project `kanban-app`, compatible schema, database, `APP_BASE_URL`, and signing secret.
2. In the project dashboard, choose Instant Rollback and review the eligible prior deployment. Hobby supports the immediately previous production deployment. Rollback restores that deployment's original environment values; current project settings do not repair an older deployment's configuration.
3. After rollback, verify `/api/health`, Google sign-in, private board loading, and saved data. Rollback changes the application release, not database contents.
4. Verify deployment auto-assignment before the next release. Use an explicit production promotion when restoring normal release routing.

Earlier deployments before `dpl_HefJe5wV7vE5iygSfDmNG3dgDnpC` had invalid startup configuration and are not verified recovery targets. Confirm the eligible predecessor again after every release. No rollback was executed during verification.

Source: [Vercel Instant Rollback](https://vercel.com/docs/instant-rollback).

## Database recovery

For data loss, stop writes and preserve the current state before choosing a restore point. First rehearse recovery in an isolated database and verify schema, board revisions, identities, and application access there.

In Neon, inspect the production branch's Backup & Restore history window. Point-in-time restore requires an eligible root branch and a timestamp still within its retained history. Restoring overwrites all databases on the branch and discards subsequent changes; it does not merge individual boards. Review the affected branch and time before approving a production restore. A restore temporarily interrupts connections. Verify login and board contents after recovery and record which later changes were lost.

If the required history is unavailable, restore the private dump into an isolated database with the operator's PostgreSQL tools, verify it, and plan the connection cutover. Runtime role grants must be restored or reapplied. Never substitute the local SQLite database or a preview database for production without a deliberate migration.

Neon history duration and provider snapshots remain unverified. Part 18 verified a custom-format dump restore into isolated PostgreSQL and a migration rehearsal; no production restore was performed. Preview and production are separate databases in the same Neon branch, so a provider branch-level restore affects both.

Source: [Neon instant restore](https://neon.com/docs/postgres/backup-restore/branch-restore).

## Logs and credentials

Keep protocol/request-body debugging disabled. Review production errors using a window within the plan's available log retention. Inspect only sanitized summaries; do not copy OAuth codes/state, cookies, database URLs, or API keys into reports. Application log filtering does not establish that every platform trace or export redacts query parameters.

Keep `SESSION_SECRET` stable across ordinary deployments. A deliberate rotation invalidates existing sessions. Rotate database/API credentials through their providers, update the production Secret, and redeploy; never record the replacement value in documentation.
