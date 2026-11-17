# Part 8 validation

Historical milestone: Part 9 subsequently changed the default to `nvidia/nemotron-3.5-super-vl:free` after testing the full board contract. See [Part 9 validation](PART9_VALIDATION.md). The arithmetic result below records the original Part 8 check.

Verified on 2026-11-17 using Docker Desktop Linux containers and the root `.env` configuration.

## Model selection and live result

Selected `inclusionai/ling-3.2-flash:free`. OpenRouter's live public model catalog listed zero prompt/completion prices, text input/output, and both `response_format` and `structured_outputs` parameters. The originally named `recraft/recraft-v4.1-flash-v2:free` was absent from that catalog; the user had authorized switching to any free model. [OpenRouter model catalog](https://openrouter.ai/api/v1/models).

The live backend command succeeded:

```text
Model: inclusionai/ling-3.2-flash:free
2+2 = 4; structured response validated.
```

It sent only a synthetic arithmetic prompt, requesting a strict JSON object with one integer `answer` field. The check validated exactly `{"answer":4}`. No board JSON, chat history, or user data was sent. This confirms basic structured connectivity; the larger board response contract is still Part 9.

Structured-output support is endpoint-dependent. The client passes `response_format` when requested and sets `provider.require_parameters=true` so routing respects required parameters. [OpenRouter structured-output guidance](https://openrouter.ai/docs/guides/features/structured-outputs).

## Implementation

- `backend/app/openrouter.py`: small async HTTPX2 client for the fixed OpenRouter chat-completions URL. Uses a 30-second network timeout, a 2048-token output limit, environment-based configuration, and optional structured response format.
- Requests require an explicit `:free` model and cap prompt, completion, and per-request pricing at zero. No paid model list/fallback is configured and the application does not automatically retry requests. Provider selection can still operate among eligible zero-priced endpoints. [OpenRouter maximum-price routing](https://openrouter.ai/docs/guides/routing/provider-selection#maximum-price).
- `backend/app/check_ai.py`: explicit CLI smoke check, separate from startup and routine tests. Prints only the selected model and validated result; exits nonzero with a sanitized error on failure.
- Compose passes `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` at runtime. The key remains in root `.env` or the host environment; it is not a Docker build argument or copied into the image. Blank/missing keys leave the board usable but prevent AI calls.
- HTTPX2 was moved from the development dependency group to runtime dependencies and `uv.lock` regenerated; the resolved version is 2.16.0. No AI SDK or new frontend dependencies were added.

`OpenRouterError` carries a safe message and status for later API integration:

| Situation | Status |
| --- | --- |
| Missing key, non-free configuration, rejected credentials, rate limit, provider 5xx | 503 |
| Network connection failure, rejected request, malformed/empty/incomplete response | 502 |
| Request timeout | 504 |

Provider bodies, authorization headers, and underlying network exception text are not included in these errors. Truncated, filtered, tool-call, or failed completions are not accepted as completed text answers.

## Verification

- Public model metadata was queried and official completion/structured-output/routing documentation reviewed before selection.
- `docker build --target test -t kanban-app-test .` succeeded, including the static frontend production build/type checking.
- `docker run --rm kanban-app-test`: **104 passed**. Existing board/database/auth/static checks remain green.
- OpenRouter tests use `MockTransport`, synthetic credentials, and mocked CLI responses. They cover headers, model/configuration, free-only routing, timeout settings, structured payload forwarding, missing keys, rejected paid models, provider/network errors, no application retries, malformed/empty/incomplete output, and arithmetic validation. They do not need a real key or call OpenRouter.
- The explicit live command succeeded using the existing key supplied through Compose; it was not printed or read into tool output.
- A runtime check confirmed the key is configured, `/app/.env` is absent, and the key's bytes are absent from all exported frontend assets. No secret values were printed during that check.
- Container build/start succeeded and Compose reports healthy. SQLite board data was not modified by the AI check.
- `git diff --check` passed. Frontend tests/browser suites were not repeated because no frontend behavior changed.

Initial sandbox access to the public model catalog was blocked; approved network access fetched the metadata. No application error was inferred from that environment restriction.

## Repeat the check

From the project root with Docker running:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start.ps1
docker compose exec -T app python -m app.check_ai
```

The second command performs one live free-model request. Expect the model line and `2+2 = 4; structured response validated.` Automated tests remain separate:

```powershell
docker build --target test -t kanban-app-test .
docker run --rm kanban-app-test
```

To change the model, set `OPENROUTER_MODEL` in root `.env` to a current explicit `:free` model supporting structured responses, restart through the start script, and rerun the live check. `OPENROUTER_API_KEY` is required only for live calls; do not paste it into commands, frontend files, or test fixtures.

The UI is unchanged. There is no public AI endpoint, conversation handling, or AI board update yet. Those are Parts 9 and 10.
