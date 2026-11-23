# Part 21: shared-board release

Release work performed 2026-11-23, source `71fb8a3d9e016abb93ffddf6de8c550f8ddfa7d8`. Real three-account Google acceptance remains pending; automated preview evidence uses explicitly synthetic identities.

## Backup and migration rehearsal

- Production initially had schema versions 1–3, three users, six boards and three Google identities. No synthetic identities were inserted into production.
- Saved a PostgreSQL 18 custom-format backup at `/private/part21-before-schema4.dump` in Docker volume `kanban-part21-private-backups`. Private fingerprints include board names, contents, ownership and revisions, user rows, Google identities and OAuth state. Neither backup nor fingerprints are deployment inputs.
- Restored the archive into the initially empty `kanban-part21-restore` database on the isolated `kanban-part21` Docker network, without a published port. Applied schema 4 with the application migration code, then verified versions 1–4 and preservation of all original record fingerprints. The added `email_verified` flag defaults to false; existing Google users refresh it through a new Google sign-in.
- Regression tests use a different disposable database, `kanban-part21-postgres/kanban_test`. The destructive PostgreSQL test fixture was never run against the restored backup or hosted databases.
- Took a second production backup immediately before cutover, `/private/part21-cutover.dump`, in the same private volume, with a fresh fingerprint baseline. Preserve this volume and Docker storage.

## Automated checks

| Check | Result |
| --- | --- |
| Backend SQLite and disposable PostgreSQL | 321 passed, 3 expected skips |
| Frontend unit/component suite | 88 passed |
| ESLint and TypeScript | Passed |
| Desktop/mobile Playwright, disposable localhost:8003 fixture | 62 passed, 6 expected skips |
| Hosted synthetic sharing | 67 HTTP checks passed |
| Hosted live AI answer/update | 6 checks passed |
| Hosted live AI/manual overlap | 4 checks passed |
| Hosted removal during pending live AI request | 7 checks passed |
| Hosted redeployment persistence | 9 checks passed |

Backend checks reused `kanban-part20-test`, which contains the unchanged Part 20 application/test code. Frontend checks ran from the current repository. Each Vercel release also built the current frontend static export and matching backend. Expected browser skips are the two local live-provider cases, two localhost:8002 multi-board fixture cases, duplicate mobile persistence, and native mobile drag/drop. Live AI was separately exercised against hosted preview.

## Hosted preview

Preview uses its existing separate database, restricted runtime login and independent signing secret. Upgraded only that database to schema 4 and explicitly granted DML on membership/invitation tables and sequence usage. Production was unchanged during these checks.

First preview: `dpl_4QJvcJiUfSxbAMjMUvr8FhAJW4Z8`, `https://kanban-7t353joms-belwalparth.vercel.app`, build 31 seconds. Stable preview origin: `https://kanban-app-git-part18-preview-belwalparth.vercel.app`. The first request reached the older schema-3 deployment through a stale alias and failed startup. Logs identified that deployment; explicitly assigning the preview alias to the new schema-4 build fixed it. The tested new deployment had zero error/fatal records in the final 15-minute log sample; this is a bounded sample, not continuous monitoring.

Created four clearly synthetic preview identities: owner, two invited members and outsider. Signed test sessions were created only for these identities in the preview database; this does not verify Google consent or callback. Tests exercised:

- No access before explicit invitation acceptance; email binding and wrong-account rejection; two members accepting; duplicate invitation/replay behavior; joined-board roles.
- Member rejection from sharing management and board renaming; outsider rejection from read/write/AI; membership on one board does not expose another private board.
- Shared card/column changes, movement and revision conflicts seen by owner and both members; invitation metadata contains no token/link/hash.
- Pending invitation revocation; member removal blocks reads and writes; a consumed invitation cannot restore removed access; explicit reinvitation works.
- Live provider answer and exact saved board update from invited-member sessions, visible to all three sessions.
- A manual member update during a pending live AI request won; AI returned 409 and the saved manual state remained unchanged.
- Removing a member while that member's live AI HTTP request remained pending caused AI to return 404; no proposed change committed. Reinvitation restored access for persistence testing.

Second preview: `dpl_38NEakwdTzUro62PqwahZ7hLdHjV`, `https://kanban-e89899nk1-belwalparth.vercel.app`, build 30 seconds. Requests to this fresh deployment verified exact board contents/revision, owned/shared lists, two memberships, accepted invitations and outsider rejection. The original preview alias was retained for real-user testing and its temporary share link.

Agent-browser verified the hosted owner workspace and accessible Share board dialog. A preview-only Vercel share link with a 23-hour lifetime was supplied privately in the conversation for real-user testing; deployment protection remains enabled. The link is not recorded here.

## Production cutover

Released production build: `dpl_99j8if5yUUGH9st4UaMF6BhvKEaF`, `https://kanban-i63y6z3vy-belwalparth.vercel.app`, Ready, 37-second build. It was first staged with domain assignment skipped. Applied the rehearsed transactional migration, matched sharing-table/sequence grants to the one existing board-DML role, verified private data fingerprints against the fresh cutover baseline, checked staged health, then explicitly promoted the same build to `https://kanban-app-seven-nu.vercel.app`.

The first grant verification stopped because an old local production env pull contained a masked database Secret rather than a usable runtime connection. Sanitized diagnostics showed a connection-string ProgrammingError, not a failed migration or SQL permission error. The corrected operator inspected existing database grants and matched permissions on new sharing tables to roles already holding all four board DML privileges, without decrypting or printing runtime credentials. Schema migration had succeeded and staged health returned 200 before promotion.

All six existing boards, names, contents, ownership, revisions and original user/identity fingerprints were preserved. Public production checks passed 30 requests: the existing 18 checks plus 12 checks confirming the published JS includes the sharing controls and unauthenticated sharing routes remain protected. Google sign-in configuration/redirect/cookie settings, API no-store behavior, private route rejection, assets and missing routes passed. Agent-browser confirmed the production sign-in screen. A final five-minute error/fatal log sample for this deployment returned zero records; it does not establish continuous monitoring.

The user initially checked the live site before promotion and saw no Share board control because it still served the recovered schema-3 release. After promotion, instructed the user to refresh the usual live URL, select an owned board and use Share board beside Rename board. Real-account acceptance should now use production; no preview data or synthetic sessions were copied into production.

## Real-account acceptance still required

The user confirmed they can arrange an owner and two other Google users. Each must sign in independently; do not manufacture production sessions or claim synthetic preview identities completed Google OAuth.

1. Owner creates a test board, invites two verified Google emails and shares the two single-display invitation links manually. Each recipient signs in and explicitly accepts.
2. All three see the same saved cards/columns and AI updates after refresh and sign-out/in. Each retains access to their own private boards without exposing them to the others.
3. Members cannot manage access or rename the board. A separate nonmember cannot access it. Revoke a pending invitation, remove a member and verify recovery/access denial.
4. Verify persistence after the follow-up production redeployment. Record outcomes without invitation tokens, Google subjects, OAuth state/codes, cookies, emails or private board contents.

Until these results arrive, Parts 18 and 21 acceptance must remain explicitly incomplete.
