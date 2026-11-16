# Part 3 validation

Validated on 2026-11-16 with Windows, installed Google Chrome, and Docker Desktop Linux containers.

## Result

FastAPI serves the exported Next.js board at http://localhost:8000. Docker builds the frontend with Node.js and copies only its static output into the Python runtime. The final healthy container has no Node executable and no forwarded OpenRouter key.

The UI uses the approved navy, blue, purple, yellow, and supporting gray palette, with local/system fonts. It supports card creation, title/details editing, deletion, column renaming, and native desktop drag/drop. The editor's column selector provides the same movement operation for keyboard/touch users. Save/create commits changes; Cancel/Escape discards drafts. The title receives focus on open and focus returns to the opener on dismissal. Layout scrolls horizontally within the board on narrow screens.

Board state is still in browser memory and resets on refresh. Login, persistence, and chat are later parts.

## Automated checks

- Frontend: 21 passing Vitest tests (12 board helper tests, 9 component interaction tests).
- ESLint CLI and TypeScript checking pass. Both were also checked in the clean Linux frontend test stage.
- Production Next.js static export succeeds locally and in Docker.
- Backend: 8 passing tests for page serving, health, JSON API 404s, static scripts, missing pages/assets, traversal protection, and real exported JS/CSS delivery.
- Playwright against the running Docker app: 11 passed, 1 intentionally skipped. Desktop tests include actual drag/drop and same-column drops. Mobile tests use the editor to move cards; native touch drag/drop is outside this implementation.
- Browser checks cover hydration, create/edit/move/delete, counts/progress, cancel/Escape/focus restoration, rename, refresh reset, horizontal overflow containment, modal width, and keyboard tab order. No page runtime errors or failed network requests were observed in the hydration checks.
- Reviewed desktop board and mobile editor screenshots generated under ignored `frontend/test-results/`.
- Runtime build/start succeeds and Compose reports healthy. `git diff --check` passes; Git may report local LF/CRLF conversion notices on Windows.

## Reproduce

From the project root with Docker running:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start.ps1
docker build --target frontend-test -t kanban-frontend-test .
docker run --rm kanban-frontend-test
docker build --target test -t kanban-app-test .
docker run --rm kanban-app-test
```

For browser tests using installed Google Chrome, from `frontend/` with Node.js 24 or newer:

```powershell
npm.cmd ci
$env:PLAYWRIGHT_CHANNEL = 'chrome'
npm.cmd run test:e2e -- --workers=2
```

Alternatively install Playwright Chromium using `npx playwright install chromium`, omit the channel override, and run `npm run test:e2e`.

## Manual checklist

1. Open http://localhost:8000. Expect five columns and six demo cards; `/api/health` still returns `{"status":"ok"}`.
2. Add a card. A blank title cannot be submitted; fill title/details and create it. Cancel a second draft and confirm no extra card appears.
3. Edit a card's title/details and save. Edit it again, then Cancel or press Escape; its saved text should remain.
4. Drag a card to another column. Alternatively edit it and select another column. The destination and card counts should update without duplication.
5. Rename a column and delete a card. There should still be five columns.
6. Narrow the browser: scroll within the board to reach columns; the editor should fit the screen. Use Tab/Enter/Escape to operate the editor.
7. Refresh: demo data returns. This is expected until Part 7 introduces persistence.

## Dependency and tooling notes

The npm lockfile records the versions resolved from the registry, including Next.js 16.4.6, React 19.3.1, TypeScript 6.0.3, Vitest 5.1.0, and Playwright 1.65.1. Builds use `npm ci`.

Current Vitest/Vite uses Oxc rather than the old esbuild JSX configuration; configured the supported transformer after the initial test run identified an untransformed JSX parse error. Next.js updated its generated TypeScript declarations and JSX setting during the upgrade. Lint uses ESLint's flat configuration because current Next.js no longer provides `next lint`.

Initial real-browser tests showed the close button received focus on dialog open: React's `autoFocus` did not produce a native `autofocus` attribute before `showModal()`. Explicitly focusing the title after opening, with layout-effect cleanup to close and restore focus, resolved the failure on desktop and mobile.

`npm audit --omit=dev` reports zero vulnerabilities. The full audit reports seven moderate findings through the lint toolchain's transitive `minimatch` dependency. A compatible `npm audit fix` did not resolve them; no forced major dependency overrides were introduced. npm also marks the registry's selected ESLint 9.39.5 release deprecated. These development packages are not copied into the final Python runtime.

Browser validation used Chromium/Chrome only, with mobile emulation rather than a physical phone. Native macOS/Linux start/stop execution remains untested as recorded in Part 2.

References consulted: [Next.js static exports](https://nextjs.org/docs/app/guides/static-exports), [Next.js upgrade guidance](https://nextjs.org/docs/app/guides/upgrading/version-16), [Vitest guide](https://vitest.dev/guide/), [Vite Oxc configuration](https://vite.dev/config/shared-options#oxc), and [Playwright Docker guidance](https://playwright.dev/docs/docker).
