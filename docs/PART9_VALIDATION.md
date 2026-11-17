# Part 9: structured chat API and validation

Completed on 2026-11-17. The backend supports authenticated questions and validated AI board updates. The sidebar and browser conversation state remain Part 10.

## API contract

`POST /api/chat` uses the same signed session cookie as the board API. Request:

```json
{
  "revision": 0,
  "message": "Move card-3 to done and add a release checklist to todo.",
  "history": [
    { "role": "user", "content": "What is in progress?" },
    { "role": "assistant", "content": "The dashboard prototype is in progress." }
  ]
}
```

Use the revision from the latest `GET /api/board`. History is optional and contains previous messages, excluding the current question. Accept at most 20 entries, each with role `user` or `assistant`. Each message/question is trimmed, nonblank text of at most 4000 characters. Reject system roles, unknown fields, invalid types, and client-supplied board/user identity with 422. Revision must be a nonnegative integer.

Successful response fields:

| Field | Meaning |
| --- | --- |
| `reply` | Validated assistant text. |
| `updated` | Whether the backend committed a changed board. |
| `state` | Canonical `{ "revision": ..., "board": { "columns": [...] } }`, matching the existing board API envelope. |

Question-only replies and identical board proposals do not increment the revision. A changed board commits once, even if several cards change. The future sidebar should display `reply` safely as text and apply `state` to the existing shared board state.

The endpoint sends the authenticated user's current board, question, and supplied history to OpenRouter. The board comes from SQLite, never the request body. No history, question, or reply is persisted in SQLite. Part 10 will keep history in browser-session memory and clear it on logout.

## Implementation

`backend/app/chat.py` defines strict request, AI response, and endpoint response models. Pydantic generates the requested JSON Schema from the AI response model. The model must return `reply` plus `board`, where `board` is null for an answer or the complete proposed board for a change. Both fields are required in the structured response.

The system prompt instructs the model to preserve fixed columns, existing card IDs, and unrequested text/cards, and to return a complete document for multi-card operations. Board text/history are labeled untrusted; only the current SQLite snapshot is authoritative. Models cannot choose the owner, revision, database path, or SQL operation.

The board schema now exposes the five allowed column-ID values and exactly-five-column array bound to structured-output providers. The existing server validators additionally enforce column order and card-ID uniqueness. Full response and board validation happen before any write; malformed or invalid proposals return a sanitized 502 without saving any part of the proposal.

SQLite reads/writes run in the thread pool. The initial read closes before awaiting OpenRouter; no database transaction is held during the network call. A stale initial revision returns 409 before calling AI. A changed proposal reuses the existing owner-scoped transactional save against the original revision. Concurrent edits produce 409, preserving the newer board. Answer-only/no-op replies also recheck the revision after AI returns, rejecting responses based on a board that has since changed.

Provider failures use Part 8's sanitized 502/503/504 responses. Existing authentication, missing-board, busy-database, and rollback behavior remains. API responses are uncached. No automatic retry, merge, output repair, or replay is performed.

Chat calls permit up to 8192 output tokens; the arithmetic check retains its 2048 default. Part 8's runtime-only key and zero-priced-provider restrictions remain in place. An over-limit/incomplete provider response is rejected rather than saved.

## Model selection and diagnosed issue

Current default: `nvidia/nemotron-3.5-super-vl:free`. The public catalog listed zero token pricing and structured-output support; the full live contract check passed with this model. [OpenRouter catalog](https://openrouter.ai/api/v1/models).

The earlier Ling model passed arithmetic but repeatedly failed the fuller board response validation. Sanitized diagnostics showed all five column IDs replaced by the unexpected value `背`. Initially, that business constraint was enforced by the server validator but represented as arbitrary strings in the provider-facing JSON Schema. Added explicit allowed-ID choices and exactly-five-column bounds, with regression tests; the order/uniqueness validators remain.

Further Ling responses were still rejected under the tighter schema, so the NVIDIA free model was tested with the identical contract. It passed an answer-only check and the combined card-operation check. The user had authorized switching to any free model. Defaults in code, Compose, and README now agree; `OPENROUTER_MODEL` can override them.

One live attempt encountered 429. A later minimal request returned 200, confirming the provider was responding again. No paid model was used, and rejected responses never changed the saved board.

## Validation results

- `docker build --target test -t kanban-app-test .` succeeded, including the production frontend export/type checks.
- `docker run --rm --network none kanban-app-test`: **147 passed**. No live key or network is needed for this suite.
- Mocked chat tests cover canonical context/history/schema forwarding, input limits, auth, invalid roles/ownership fields, answer-only/no-op replies, single and combined create/edit/move/delete/rename operations, invalid JSON/boards, duplicate IDs, wrong column IDs/count/order, provider failures, missing keys, and strict schema constraints.
- Revision tests cover stale input before a call and edits made while AI is responding, for both answer-only and update responses. The concurrent write succeeds while the provider is pending, verifying no open database transaction spans that call.
- A failed database write rolls back the entire AI update. A second seeded user's chat changes only that user's board.
- Live `app.check_chat` passed using the selected NVIDIA free model. It creates a temporary seeded SQLite database, validates a question-only response without changing revision, then validates and persists one combined create/edit/move response. It checks the entire resulting board, including preservation of unchanged data, and removes the temporary database.
- The synthetic live check did not read or change the user's saved board. No credentials or raw user data were printed.
- Final app build/start succeeded; Compose reports healthy and the configured runtime model matches the verified default.
- `git diff --check` passed. No frontend source changed, so standalone frontend/browser suites were not repeated.

## Check it yourself

Recommended live check from the project root:

```powershell
docker compose exec -T app python -m app.check_chat
```

It makes two free-model requests using synthetic data and leaves your board untouched. Expect:

```text
Model: nvidia/nemotron-3.5-super-vl:free
Answer-only reply validated; revision unchanged.
Combined card creation, editing, and movement validated and saved atomically.
Temporary database removed; your saved board was not read or changed.
```

To call the actual endpoint against your saved board, sign in and obtain its revision first. This sends your current saved board to OpenRouter:

```powershell
$null = Invoke-RestMethod -Method Post -Uri http://localhost:8000/api/auth/login -ContentType 'application/json' -Body '{"username":"user","password":"password"}' -SessionVariable chatSession
$board = Invoke-RestMethod -Uri http://localhost:8000/api/board -WebSession $chatSession
$payload = @{ revision = $board.revision; message = 'How many cards are on this board? Do not change anything.'; history = @() } | ConvertTo-Json -Depth 20
$answer = Invoke-RestMethod -Method Post -Uri http://localhost:8000/api/chat -WebSession $chatSession -ContentType 'application/json' -Body $payload
$answer.reply
$answer.updated
```

Expect an answer and `False`, with the revision unchanged. For an update, fetch a fresh revision and request a small identifiable change, such as adding a card titled `AI test` to the column with ID `todo`. Expect `updated=True` and a higher revision; refresh the board page to see it. The Part 10 sidebar will apply returned state automatically.

For offline regression checks:

```powershell
docker build --target test -t kanban-app-test .
docker run --rm --network none kanban-app-test
```

References: [OpenRouter structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs), [Pydantic JSON Schema generation](https://docs.pydantic.dev/latest/concepts/json_schema/), and the approved [database design](DATABASE.md).
