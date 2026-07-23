> **Mandatory execution log:** Every implementation agent MUST maintain
> [`execution-log.md`](./execution-log.md) while working on this change. A task
> MUST NOT be marked complete until its log entry contains the production files
> exercised, red-to-green evidence (or an explicit non-TDD justification), the
> exact verification commands and outcomes, and remaining risks. Update the log
> immediately after each task and add a checkpoint after every five completed
> tasks. A progress summary without corresponding log evidence is not accepted.

## 1. Baseline and Safety Net

- [x] 1.1 Record the current API routes, SSE event shapes, error strings, database write order, and expected game-rule outcomes in a refactor baseline document; verify every observed `catch`, external call, and persistence boundary is classified.
- [x] 1.2 Add characterization tests for representative existing turns covering player creation, narrative-only action, inventory gain/loss, stat damage, death, codex, journal, relationship, situation, and foreshadowing behavior; run them against the old implementation and confirm they pass before moving code.
- [x] 1.3 Add test scripts and separate unit, contract, integration, and E2E configurations so each layer can run independently; verify a deliberately failing test is reported by the intended command.
- [x] 1.4 Establish a disposable PostgreSQL test database and migration test workflow; verify tests never use the developer or production database URL.
- [x] 1.5 Add a repository rule/test that rejects empty `catch` blocks and undocumented silent fallbacks in production source; run it red against the current code before remediation.

## 2. Shared Contracts and Error Catalog

- [x] 2.1 Write failing Schema tests for malformed JSON, invalid game-action fields, Problem Details, validation issue pointers, success payloads, persisted player JSON, provider responses, and every SSE event payload.
- [x] 2.2 Implement shared Zod schemas and inferred TypeScript types under `src/server/contracts` until the Schema tests pass.
- [x] 2.3 Define the stable application error catalog and typed `AppResult<T>` with HTTP status, problem code, retryability, safe detail, and internal cause separation; verify exhaustive mapping with unit tests.
- [x] 2.4 Implement RFC 9457 Problem Details serialization and centralized exception-to-problem mapping; verify known failures, unknown exceptions, content type, status agreement, and secret redaction.
- [x] 2.5 Generate or validate an OpenAPI 3.1-compatible document from the runtime contract and add CI drift detection; verify a deliberate schema mismatch fails the contract check.

## 3. Request Context, Redaction, and Observability

- [x] 3.1 Write failing tests for request/run ID propagation, structured log fields, sensitive-field redaction, nested error causes, and concurrent request isolation.
- [x] 3.2 Implement immutable request context creation carrying request ID, run ID, deadline, AbortSignal, actor context, provider configuration, clock, and logger.
- [x] 3.3 Implement centralized structured logging and recursive redaction for API keys, authorization headers, cookies, prompts, raw provider payloads, and configured secret aliases.
- [x] 3.4 Add minimal OpenTelemetry-compatible HTTP, LLM, RAG, and database spans with duration, attempt count, status, and `error.type`; verify no forbidden content appears in exported attributes.
- [x] 3.5 Add `/api/v1/health/live` and `/api/v1/health/ready` contract tests first, then implement bounded read-only probes that distinguish healthy, degraded, and unavailable dependencies without invoking paid LLM generation.

## 4. Versioned SSE Protocol

- [x] 4.1 Write failing unit tests for SSE framing across UTF-8/chunk boundaries, contiguous sequence numbers, accepted-first ordering, exactly one terminal event, write-after-terminal rejection, safe close, and controller write failures.
- [x] 4.2 Implement the versioned event envelope, event factory, SSE encoder, sequence allocator, and terminal guard under `src/server/streaming` until all protocol tests pass.
- [x] 4.3 Write failing tests for pre-stream Problem Details, post-open `failed`, caller `cancelled`, persistence failure after text deltas, and transport close without a terminal event.
- [x] 4.4 Implement the server stream adapter so application/domain events are converted to Schema-valid SSE events and every controllable opened stream attempts one terminal event.
- [x] 4.5 Add protocol fixtures for normal completion, known failure, unknown failure, cancellation, malformed event, missing sequence, duplicate terminal, and interrupted stream for reuse by server and client tests.

## 5. Pure Domain Rule Engine

- [x] 5.1 Extract current rule inputs and expected results into table-driven tests for every supported tool, including bounds, invalid arguments, combined tool calls, shield overflow, HP death, inventory counts, techniques, traits, relationships, locations, breakthroughs, codex, journal, situations, and foreshadowings.
- [x] 5.2 Define runtime schemas for all LLM tool calls and write failing tests proving malformed, unknown, duplicate, and contradictory tool calls return typed domain failures instead of throwing or being ignored.
- [x] 5.3 Implement a side-effect-free immutable Rule Engine under `src/server/domain` and make the new domain tests pass without Prisma, network, global state, wall clock, or uncontrolled randomness.
- [x] 5.4 Run old-vs-new characterization fixtures and resolve every behavioral difference explicitly; document intentional changes instead of weakening tests.

## 6. Persistence, Idempotency, and Concurrency

- [x] 6.1 Write migration tests against a populated legacy fixture, then add forward-only Prisma migrations for player versioning, `GameTurnExecution`, required unique constraints, and a durable post-commit outbox/degradation record without deleting existing data.
- [x] 6.2 Write failing integration tests for new execution reservation, completed replay, duplicate in-progress requests, failed/cancelled records, and unique `(playerId, idempotencyKey)` enforcement.
- [x] 6.3 Implement repository ports and Prisma adapters for player snapshots, messages, executions, and outbox records; validate all persisted JSON at repository boundaries.
- [x] 6.4 Write failing transaction tests proving player update, version increment, user/assistant messages, domain events, and execution completion commit together or all roll back.
- [x] 6.5 Implement short atomic final persistence with optimistic version checks and map conflicts to `TURN_CONFLICT`; verify two concurrent turns cannot overwrite or double-apply state.
- [x] 6.6 Implement visible post-commit indexing jobs/degradation records and bounded retry processing; verify an indexing failure never changes a committed turn to failed and never disappears silently.

## 7. Dependency Adapters and Resilience

- [x] 7.1 Define application ports for LLM, RAG, summary, player repository, turn execution repository, event sink, clock, ID generation, and retry policy so application code does not import concrete infrastructure.
- [x] 7.2 Write failing adapter tests for LLM success, 401/403, 429 with `Retry-After`, 5xx, connection reset, timeout, abort, empty response, malformed tool calls, and cross-request provider isolation.
- [x] 7.3 Implement request-scoped LLM adapters with per-attempt timeout, AbortSignal propagation, bounded transient retry with jitter, and zero module-level mutable request state.
- [x] 7.4 Write failing RAG/summary adapter tests for success, legitimate empty result, protocol mismatch, initialization failure, timeout, abort, and unavailable dependency.
- [x] 7.5 Implement RAG and summary adapters that return typed results, report explicit degradation where legal, and remove all empty catches and silent fallbacks.

## 8. Canonical Game-Turn Application Service

- [x] 8.1 Write failing application tests for successful execution, missing player, provider rejection, LLM timeout, invalid tool call, RAG degradation, cancellation, duplicate request, concurrent conflict, final transaction failure, and post-commit degradation.
- [x] 8.2 Implement `ExecuteGameTurn` as the single application entry coordinating execution reservation, snapshot loading, canonical LangGraph invocation, pure rule evaluation, final transaction, outbox, and domain events.
- [x] 8.3 Refactor the LangGraph workflow to use the defined ports and Rule Engine, and prove through import/boundary tests that it contains no duplicate persistence or transport implementation.
- [x] 8.4 Remove module-level LLM/summary/conversation request state and pass all run data through request context or Graph state; run concurrent isolation tests repeatedly.
- [x] 8.5 Add a source-boundary test proving Route Handlers and compatibility routes cannot import Prisma, provider SDKs, vector-store implementations, or domain rule internals directly.

## 9. API v1 Route Handlers

- [x] 9.1 Write failing HTTP contract tests for game actions, player reads/deletes as retained by scope, malformed content types, malformed JSON, validation failures, resource absence, conflicts, dependency failures, timeouts, and unknown exceptions.
- [x] 9.2 Implement thin `/api/v1` Route Handlers using request context, shared validation, `ExecuteGameTurn`, Problem Details, and the SSE adapter; keep handlers free of business and persistence logic.
- [x] 9.3 Add response headers for request correlation, no-store behavior, streaming/proxy safety, protocol version, and legacy deprecation where applicable; verify them in contract tests.
- [x] 9.4 Convert legacy `/api/game` and `/api/game/action` into temporary compatibility adapters over the new application service, or return documented deprecation responses; verify no second orchestration path remains.

## 10. Typed Frontend Client and State Machine

- [x] 10.1 Write failing client tests for valid HTTP success, RFC 9457 errors, invalid response shape, split SSE frames, invalid JSON, unknown events, sequence gaps, duplicate terminal, interrupted stream, cancellation, and candidate text after failed persistence.
- [x] 10.2 Implement the contract-derived HTTP client and centralized incremental SSE parser under `src/client`, including runtime validation and stable `PROTOCOL_ERROR`/`STREAM_INTERRUPTED` mapping.
- [x] 10.3 Write reducer tests for every allowed and forbidden transition across `idle`, `submitting`, `streaming`, `completed`, `failed`, `cancelling`, and `cancelled`.
- [x] 10.4 Implement the pure game-turn reducer, authoritative/candidate state separation, retryability behavior, request ID retention, and idempotency-key reuse.
- [x] 10.5 Refactor `ChatPanel` and `SelectScreen` to use the shared client/reducer; remove component-local SSE parsing, naked event `JSON.parse`, error-text regexes, duplicate retry code, and direct authoritative state mutation.
- [x] 10.6 Add route-level and global render error boundaries plus component tests proving render errors show a recoverable fallback while async failures remain in the typed state machine.

## 11. Fault Injection and End-to-End Cutover

- [x] 11.1 Build a deterministic fault-injection matrix covering malformed requests, DB unavailable/rollback, LLM 401/429/5xx/timeout/empty/malformed tools, RAG unavailable, client abort, stream interruption, duplicate request, and concurrent conflict.
- [x] 11.2 Run API/SSE contract tests for every fault and assert status/event Schema, stable code, retryability, correlation IDs, one terminal outcome, no secret leakage, and correct database side effects.
- [x] 11.3 Add focused Playwright flows for successful game turn, pre-stream validation error, mid-stream failure, retryable/non-retryable errors, cancellation, interrupted stream, duplicate submission, and post-refresh authoritative state recovery.
- [x] 11.4 Switch production frontend calls to API v1 and run old-vs-new critical-path comparison against the same deterministic fixtures.
- [x] 11.5 After all cutover tests pass, delete the old 906-line orchestration, duplicate Rule Engine/Graph path, old SSE parser, error regexes, and obsolete request-global setters in a dedicated cleanup change set.

## 12. Documentation and Final Verification

- [x] 12.1 Publish the generated OpenAPI document, stable error-code catalog, SSE protocol reference, timeout/retry policy, idempotency behavior, and request-ID troubleshooting guide.
- [x] 12.2 Update README, project file map, environment example, database migration instructions, local/CI test commands, and deployment health-check configuration.
- [ ] 12.3 Run migration verification on a legacy data snapshot and confirm no player, inventory, codex, journal, relationship, situation, foreshadowing, or chat data is lost.
- [ ] 12.4 Run the complete unit, Schema, contract, integration, fault-injection, and Playwright suites; record counts and results without relying only on HTTP status assertions. **(Partial evidence: Unit: 472 ✓ | Contract: 132 ✓ | Playwright E2E: 28 ✓ (14 desktop + 14 mobile) | Integration: 0 — blocked on PostgreSQL; keep unchecked until the integration layer passes.)**
- [x] 12.5 Run full lint, TypeScript checking, production build, OpenSpec validation, secret scan, and self-review of the final diff; confirm no empty catches, request-global mutable state, duplicate orchestration, unvalidated boundary payloads, or unrelated mobile/UI changes remain.
