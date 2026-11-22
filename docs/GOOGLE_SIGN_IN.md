# Google sign-in (Part 13)

## Sharing boards (Part 20 local implementation)

The owner selects **Share board**, enters the recipient's Google email, and chooses **Create invitation**. Copy the link while it is visible and share it manually; it is not emailed automatically and cannot be retrieved later. Pending links expire after seven days and can be revoked in the same dialog. List members there, choose **Remove member**, then **Confirm removal** to end access. Members can edit cards/columns and use the assistant; the owner alone renames the board and manages sharing.

Recipients open the link, sign in with the invited Google account, then explicitly choose **Accept invitation**. **Use another Google account** keeps the invitation while signing out so they can retry with the right account. Existing accounts may need a fresh sign-in to verify their email after schema 4. An unavailable/expired/revoked/consumed link needs a replacement from the owner. Accepted boards appear as **(Shared)** in the selector; no board copy is created. Closing the invitation without joining returns to the user's own boards.

Saved changes load on refresh or when the window regains focus and there is no pending local edit/save. This is not live synchronization. If a save conflicts, the latest board loads and the draft remains for review, explicit retry, or cancellation. Failed column renames retain their draft: Enter retries and Escape cancels. AI conversations stay private to the user's session/board. Removing access clears that board and its chat state on the next API/focus check and opens an available board. The pending invitation token alone uses tab session storage to survive Google navigation; acceptance/dismissal clears it.

These controls are implemented and tested locally; production sharing and real Google acceptance are Part 21. See [Part 20 validation](PART20_VALIDATION.md).

The backend now handles Google's authorization-code flow using Authlib 1.9.9. The frontend loads sign-in options from `/api/auth/config`: Google appears when configured, and the password form appears only when local demo login is explicitly enabled. Each Google subject owns its own board; email/name are display information. Local demo data is never assigned to a Google account automatically.

## Local setup

1. In Google Cloud, configure a Web application OAuth client as described in [AUTH_DEPLOYMENT.md](AUTH_DEPLOYMENT.md#google-cloud-setup). Register this exact redirect URI: `http://localhost:8000/api/auth/google/callback`.
2. Add these server-only settings to the ignored root `.env`, using your actual client values and a newly generated random session secret of at least 32 bytes. Do not put them in frontend files or share them in chat.

```dotenv
GOOGLE_CLIENT_ID=<your Web application client ID>
GOOGLE_CLIENT_SECRET=<your client secret>
SESSION_SECRET=<a long random secret>
APP_BASE_URL=http://localhost:8000
ALLOW_DEMO_LOGIN=false
```

3. Run the normal start script to rebuild/recreate the container. Open `http://localhost:8000` and select **Continue with Google**. Google may offer an account chooser or consent screen. The callback returns to your private board.
4. Create or edit a card, reload, sign out, and sign in again. Confirm your board persists. Repeat with a second Google account and confirm it has its own board. App logout leaves your Google account signed in to Google.

The local session secret, base URL, and Google client settings are configured in the ignored root `.env`, and demo login is disabled. Live Google discovery/authorization redirects were verified, including the localhost callback and S256 PKCE. The user completed real Google consent; the database contains one verified identity with one valid private board, preserved across new connections. The full two-account production smoke test remains Part 15. Partial Google configuration or an insufficient session secret fails startup with setting names only, never secret values.

For the Next.js development proxy, use `APP_BASE_URL=http://localhost:3000`, register `http://localhost:3000/api/auth/google/callback`, and access the app on port 3000. Configure one browser origin per run. `127.0.0.1` and `localhost`, or two different ports, are different origins; mutation requests from the other origin return 403.

## Storage and production settings

Migration 2 adds `oauth_login_states`; migration 3 enables multiple named boards; migration 4 adds memberships, invitations and verified-email claims. Run the explicit migration command against the direct `DATABASE_MIGRATION_URL` before starting the current PostgreSQL backend; source startup requires versions 1-4 and never migrates production. Production currently remains on schema 3. See [database operations](DATABASE_OPERATIONS.md) for backups and release compatibility. Local SQLite upgrades preserve board JSON/revisions and back up the prior database before migrating.

Preview/production require `APP_ENV=preview` or `production`, a PostgreSQL `DATABASE_URL`, explicit HTTPS `APP_BASE_URL`, both Google client settings, a stable session secret of at least 32 characters, and disabled demo login. Hostnames, separate databases, Google registrations, and Vercel deployment remain Parts 14-15. Use separate secrets/client registrations for preview and production.

## Security behavior

- Independent random state, browser binding, nonce, and S256 PKCE verifier. The database stores hashes of state/binding plus nonce/verifier for ten minutes. Only an opaque HttpOnly browser-binding cookie reaches the browser; no verifier or provider token enters the app session.
- The callback atomically consumes an unexpired matching state/binding before contacting Google. Cancellation, token failure, expiry, or replay requires a new start. Expired records are removed during sign-in start. Callback state works across app instances and uses the same SQL behavior on SQLite/PostgreSQL.
- Authlib builds the authorization URL, exchanges the code with the stored verifier, and verifies the signed ID token against Google's discovered public keys. Explicit issuer/audience requirements and library nonce/expiration/authorized-party checks run before provisioning. Only the canonical Google issuer and exact subject select the internal user.
- This implementation uses the Starlette client's `create_authorization_url`, `fetch_access_token`, and `parse_id_token` methods directly after our atomic state handling. Its default session/cache state methods are intentionally unused: the verifier stays server-side and consumption is a single database operation. Authlib 1.9.9 selects the existing HTTPX2 integration, verified in the resolved source and signed-token tests; no additional HTTPX dependency is needed.
- App sessions contain internal user ID plus an absolute eight-hour expiry. Cookies are HttpOnly, SameSite=Lax, Path=/, host-only, and Secure for HTTPS. The short-lived binding cookie is scoped to `/api/auth/google`. Google tokens are discarded after validation. Sign-in clears the old app session before setting the new identity.
- Every unsafe API request, including demo login and logout, requires an exact Origin match with `APP_BASE_URL`. Missing, null, or foreign Origin returns 403. CLI clients/tests must send `Origin` explicitly. No credentialed cross-origin API access is enabled.
- Success always redirects to `/`; caller-supplied `next`/redirect values are unused. Errors redirect to a fixed, allowlisted `auth_error` code with a safe retry message. Provider errors/tokens never appear in the URL or UI. API/auth responses and redirects use `Cache-Control: no-store`.
- Uvicorn access logging strips query strings from Google auth paths; Authlib protocol debug logging is disabled because it includes PKCE verifiers. Do not enable request-body/protocol tracing. Verify hosting-platform request-log redaction separately during deployment, since application filtering cannot control external access logs.

A copied signed session remains valid until expiry, user deletion, or signing-secret rotation. Browser logout clears that browser's app session; server-side per-session revocation remains outside scope.

## Assistant popup and board layout

Production supports multiple private named boards on schema 3. Use **New board** to create an empty board, **Rename board** to change its name, and the **Board** selector to switch. Selection is retained in the URL for refresh and Back/Forward. Manual saves and AI updates apply only to the selected board; finish pending work/open drafts before switching. Each board's assistant draft/history stays separate during the signed-in session and clears on reload, logout, expiry, or account change. See [Part 18 release and acceptance](PART18_VALIDATION.md).

Select **Board assistant** above the columns to open the modal. Close with its button or Escape; keyboard focus returns to the launcher. Draft/history remain when the popup is closed, including during an outstanding request; they clear on reload, sign-out, expiry, or account change. AI writes retain the existing conflict and pending-request protections.

The assistant occupies no board width when closed. All five columns fit in one desktop row; tablet/mobile columns wrap into two or one columns without horizontal scrolling. Normal vertical scrolling remains available for long boards. No cards or column IDs are changed by the layout.
