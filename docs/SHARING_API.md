# Shared-board API (Part 19)

Local implementation contract; Part 20 adds the UI and Part 21 is the hosted release. See [user instructions](GOOGLE_SIGN_IN.md#sharing-boards-part-20-local-implementation).

Schema 4 adds `board_memberships` (board/user composite primary key, joined timestamp) and `board_invitations` (generated ID, board, normalized email, unique SHA-256 token hash, seven-day expiry, revoked timestamp, accepted user/timestamp). Foreign keys cascade with board/user deletion. The owner remains `boards.user_id`; owners are not duplicated as members. Migration preserves all existing board data and creates no memberships. Google identities gain `email_verified`, default false; existing accounts must sign in again before accepting invitations. Only a validated Google ID token can update this flag. Email is compared case-insensitively after trimming; no dot/plus/alias rewriting or identity merging.

| Endpoint under `/api` | Permission and result |
| --- | --- |
| `GET /boards` | Owned and joined metadata with `role: owner/member`; initial-board compatibility routes still select an owned board. |
| `GET/PUT /boards/{id}`, `POST /boards/{id}/chat` | Owner or accepted member; revision checks apply to everyone. |
| `PATCH /boards/{id}` | Owner only; shares the board revision. |
| `POST /boards/{id}/invitations` | Owner; `{email}`; 201 metadata plus one-time `link`. Duplicate active email invite or existing collaborator returns 409. |
| `GET /boards/{id}/invitations` | Owner; metadata/status only, never token/hash/link. |
| `DELETE /boards/{id}/invitations/{invite_id}` | Owner; 204; idempotent revocation. |
| `GET /boards/{id}/members` | Owner; accepted member IDs and Google display profile only. |
| `DELETE /boards/{id}/members/{user_id}` | Owner; 204; idempotent removal; owner removal rejected. |
| `POST /invitations/inspect` | Signed-in, verified intended Google email; `{token}`; validated board name/status, without granting access. |
| `POST /invitations/accept` | Same checks; transactional single-use acceptance, returns board metadata; retry by the same accepted user succeeds only while membership exists. |

Invitation links use `APP_BASE_URL/#invite=<token>` so tokens stay out of HTTP request URLs, access logs and referrers. The UI consumes the fragment, retains the pending token in tab session storage for Google sign-in, and sends it only in JSON bodies; do not add analytics for fragments/bodies. Acceptance/dismissal clears the stored token. No unauthenticated invitation lookup or automatic email. All API responses are no-store and writes retain same-origin enforcement. Unknown/nonmember boards return 404; members attempting owner actions get 403. Invalid, expired, revoked or consumed invitations use generic errors and disclose no board data; wrong/unverified accounts receive 403 without consuming the invitation.

Revoking an invitation prevents acceptance/retry; it does not remove an existing membership. Remove that member separately to revoke board access. A successful acceptance retry requires the same verified email, the same internal user, an unexpired/unrevoked invitation, and a current membership.

All access-changing operations and board writes lock the same board row in PostgreSQL before checking membership; SQLite uses `BEGIN IMMEDIATE`. This orders removal and writes: a removal committed first prevents a waiting write from saving. AI calls hold no transaction; commit rechecks access, including answer-only replies. Revision checks continue to reject stale collaborators with 409. A new invitation is required to rejoin after removal; an old consumed token cannot restore access. Operators may import only into boards owned by the explicitly selected identity.

References: [Google ID token claims](https://developers.google.com/identity/openid-connect/openid-connect), [PostgreSQL row locking](https://www.postgresql.org/docs/18/explicit-locking.html). No dependencies are added or upgraded.
