# Part 19 validation

Completed locally 2026-11-22. Sharing backend only; UI is Part 20 and hosted release/real Google collaboration acceptance is Part 21. No production or hosted preview database was changed, and no deployment/push was performed. Part 18's pending two-account and redeployment acceptance remains pending.

## Implemented

- Schema 4 for SQLite/PostgreSQL: memberships, hashed seven-day invitations and Google `email_verified` flag. Owners, board JSON/names/revisions, identities and OAuth attempts survive migration. Existing boards receive no members. Local schema-3 upgrades take a `.pre-sharing.db` backup before migration.
- Owner-only invite creation/list/revocation and member list/removal; owned/joined board lists report roles. Members read/edit cards/columns and use the same board-scoped AI routes. Board renaming and operator imports remain owner-only.
- Google callback retains verification only from boolean `true` in a cryptographically validated ID token. Existing identities default false until Google sign-in. Acceptance matches normalized verified email, attaches the internal user ID, and never merges identities.
- Single-use token hashes; raw links returned only on creation. Links use fragments, acceptance/inspection use JSON bodies, error output omits submitted values, and metadata excludes token/hash. No analytics integration was added. Platform-wide logging behavior is not independently verified here.
- Transactional acceptance and membership uniqueness; same-user retries are idempotent while membership/invitation remain valid. Removal prevents a consumed link from restoring access. Board locking serializes removal, acceptance and writes. AI calls release database connections and recheck access before returning/saving.

Contract and official references: [SHARING_API.md](SHARING_API.md). Rollout/compatibility: [DATABASE_OPERATIONS.md](DATABASE_OPERATIONS.md).

## Results

| Check | Result |
| --- | --- |
| Complete backend suite, Python 3.14, SQLite and disposable PostgreSQL 18 | 321 passed, 3 expected skips |
| Frontend Vitest | 78 passed |
| TypeScript and ESLint | Passed |
| `docker build --target test -t kanban-part19-test .` | Passed, including Next.js production static export |
| `git diff --check` | Passed |

Backend command: `docker run --rm --network kanban-part18 -e TEST_DATABASE_URL=postgresql://postgres:part18-disposable@kanban-part18-postgres/kanban_test kanban-part19-test`. This targets the existing disposable integration database, never the production restore/backup containers. The suite resets its public schema; never substitute a wanted database URL. SQLite uses temporary test files. The three skips are two SQLite-specific backup checks under PostgreSQL and one cloud-runtime check under SQLite.

Frontend commands from `frontend/`: `npm.cmd run test:run`, `npm.cmd run typecheck`, `npm.cmd run lint`.

Tests cover two accepted members sharing the same saved board, independent owned boards, unauthorized/foreign-board access, owner-only sharing/rename, Origin protection, wrong/unverified email, actual signed Google claim handling, expiry/revocation, duplicate invitations, hash-only storage and metadata, concurrent replay, two invitations converging on one membership, removal/reinvite, and stale manual/AI conflict preservation. A blocked manual transaction and an in-flight mocked AI reply cannot commit after removal on either database; answer-only replies also recheck access. Migration preservation, rollback on injected SQL failure, repeatability, and automatic local backup are exercised. Existing owner-targeted import and initial-board/sign-in regression tests pass.

The first full run found three old migration fixtures that erased version records but retained schema-4 artifacts. Updated the fixtures to remove those artifacts when reconstructing older databases; the actual populated version-2/version-3 SQL migration tests also pass. Final results above use the built image with final sources.

No new dependencies, frontend components or AI prompts were changed. No live provider or browser sharing test was performed for this backend-only part. Synthetic authenticated TestClient sessions exercise the real API/storage path; Google claim tests use signed mock provider tokens. Real users, frontend sharing behavior, hosted migration grants, deployment persistence and hosted token/log handling remain later release checks.
