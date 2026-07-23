# Fault-Injection Matrix

Deterministic fault catalog for the refactored API robustness change.
Each fault maps to a stable error code, HTTP status, retryability decision,
SSE terminal event, and expected side effects.

## Legend

| Column | Meaning |
|--------|---------|
| **Fault** | What goes wrong |
| **Layer** | Where it happens: Request, LLM, RAG, DB, Client |
| **Error Code** | Stable `ErrorCodes` constant |
| **HTTP** | HTTP status in Problem Details |
| **Retryable** | Whether automatic retry is safe |
| **SSE Terminal** | Terminal event sent to stream: `completed`, `failed`, `cancelled` |
| **DB Side Effect** | What's in the database after the fault |
| **Secret Leak** | Risk of leaking API keys, prompts, or PII in error response |
| **Test Coverage** | Unit (U), Contract (C), Integration (I), E2E (E), Playwright (P) |

## 1. Request-Layer Faults

| # | Fault | Layer | Error Code | HTTP | Retryable | SSE Terminal | DB Side Effect | Secret Leak | Coverage |
|---|-------|-------|-----------|------|-----------|-------------|----------------|-------------|----------|
| 1.1 | Malformed JSON body | Request | `MALFORMED_JSON` | 400 | No | N/A (pre-stream) | None | None | C, P |
| 1.2 | Missing required field (input) | Request | `VALIDATION_ERROR` | 422 | No | N/A (pre-stream) | None | None | C, P |
| 1.3 | Invalid field type (playerId as number) | Request | `VALIDATION_ERROR` | 422 | No | N/A (pre-stream) | None | None | C |
| 1.4 | Unknown field in body | Request | `VALIDATION_ERROR` (strict) | 422 | No | N/A | None | None | C |
| 1.5 | Wrong Content-Type | Request | `MALFORMED_JSON` | 400 | No | N/A | None | None | C |
| 1.6 | Empty body | Request | `MALFORMED_JSON` | 400 | No | N/A | None | None | C |
| 1.7 | Missing Authorization (future) | Request | `UNAUTHORIZED` | 401 | No | N/A | None | None | — |
| 1.8 | Rate limit exceeded | Request | `RATE_LIMITED` | 429 | Yes (after delay) | N/A | None | None | — |

## 2. LLM Dependency Faults

| # | Fault | Layer | Error Code | HTTP | Retryable | SSE Terminal | DB Side Effect | Secret Leak | Coverage |
|---|-------|-------|-----------|------|-----------|-------------|----------------|-------------|----------|
| 2.1 | API key invalid (401) | LLM | `LLM_AUTH_ERROR` | 502 | No | `failed` | Execution record (status=failed) | Must redact key from error | U, I |
| 2.2 | API key forbidden (403) | LLM | `LLM_AUTH_ERROR` | 502 | No | `failed` | Execution record (status=failed) | Must redact key from error | U, I |
| 2.3 | Rate limited (429) with Retry-After | LLM | `LLM_RATE_LIMITED` | 502 | Yes | `failed` | Execution record (status=failed) | None | U, I |
| 2.4 | Rate limited (429) no Retry-After | LLM | `LLM_RATE_LIMITED` | 502 | Yes | `failed` | Execution record (status=failed) | None | U |
| 2.5 | Server error (500) | LLM | `LLM_UNAVAILABLE` | 503 | Yes | `failed` | Execution record (status=failed) | None | U, I |
| 2.6 | Server error (502) | LLM | `LLM_UNAVAILABLE` | 503 | Yes | `failed` | Execution record (status=failed) | None | U |
| 2.7 | Server error (503) | LLM | `LLM_UNAVAILABLE` | 503 | Yes | `failed` | Execution record (status=failed) | None | U |
| 2.8 | Timeout (no response within deadline) | LLM | `LLM_TIMEOUT` | 504 | Yes | `failed` | Execution record (status=failed) | None | U, I |
| 2.9 | Connection reset (TCP RST) | LLM | `LLM_TIMEOUT` | 504 | Yes | `failed` | Execution record (status=failed) | None | U |
| 2.10 | Empty response body | LLM | `LLM_PROTOCOL_ERROR` | 502 | No | `failed` | Execution record (status=failed) | None | U |
| 2.11 | Malformed tool calls (invalid JSON schema) | LLM | `LLM_PROTOCOL_ERROR` | 502 | No | `failed` | Execution record (status=failed) | None | U |
| 2.12 | Unknown tool name in response | LLM | `LLM_PROTOCOL_ERROR` | 502 | No | `failed` | Execution record (status=failed) | None | U |
| 2.13 | Duplicate tool call for single-use tool | LLM | `LLM_PROTOCOL_ERROR` | 502 | No | `failed` | Execution record (status=failed) | None | U |
| 2.14 | Contradictory tool calls | LLM | `LLM_PROTOCOL_ERROR` | 502 | No | `failed` | Execution record (status=failed) | None | U |
| 2.15 | All retry attempts exhausted | LLM | `LLM_UNAVAILABLE` | 503 | Yes | `failed` | Execution record (status=failed) | None | U |
| 2.16 | Provider returns HTML instead of JSON | LLM | `LLM_PROTOCOL_ERROR` | 502 | No | `failed` | Execution record (status=failed) | None | U |

## 3. RAG Dependency Faults

| # | Fault | Layer | Error Code | HTTP | Retryable | SSE Terminal | DB Side Effect | Secret Leak | Coverage |
|---|-------|-------|-----------|------|-----------|-------------|----------------|-------------|----------|
| 3.1 | RAG service unavailable (connection refused) | RAG | `RAG_UNAVAILABLE` | — | — | `completed` (degraded) | Turn completes without RAG context | None | U, I |
| 3.2 | RAG service timeout | RAG | `RAG_UNAVAILABLE` | — | — | `completed` (degraded) | Turn completes without RAG context | None | U |
| 3.3 | RAG returns protocol mismatch (wrong format) | RAG | `RAG_PROTOCOL_ERROR` | — | — | `completed` (degraded) | Turn completes without RAG context | None | U |
| 3.4 | RAG returns legitimate empty result (no matches) | RAG | N/A (normal) | — | — | `completed` | Normal turn completion | None | U |
| 3.5 | RAG initialization failure | RAG | `RAG_UNAVAILABLE` | — | — | `completed` (degraded) | Turn completes without RAG context | None | U |

**Note:** RAG failures degrade the response quality (less context) but do NOT fail the turn. This is a design decision: the game should still work without RAG.

## 4. Database Faults

| # | Fault | Layer | Error Code | HTTP | Retryable | SSE Terminal | DB Side Effect | Secret Leak | Coverage |
|---|-------|-------|-----------|------|-----------|-------------|----------------|-------------|----------|
| 4.1 | PostgreSQL connection refused | DB | `DB_UNAVAILABLE` | 503 | Yes | `failed` | None (transaction rolled back) | None | I |
| 4.2 | PostgreSQL query timeout | DB | `DB_TIMEOUT` | 504 | Yes | `failed` | None (transaction rolled back) | None | I |
| 4.3 | Optimistic lock conflict (version mismatch) | DB | `TURN_CONFLICT` | 409 | No | `failed` | Previous turn preserved | None | U, I |
| 4.4 | Unique constraint violation (duplicate idempotencyKey) | DB | `TURN_IN_PROGRESS` / `TURN_ALREADY_COMPLETED` | 409 | No | N/A | Previous execution preserved | None | U, I |
| 4.5 | Transaction rollback (partial write prevented) | DB | `DB_UNAVAILABLE` | 503 | Yes | `failed` | None (atomic rollback) | None | I |
| 4.6 | Post-commit outbox write failure | DB | N/A (logged only) | — | — | `completed` | Turn committed, outbox entry missing | None | I |
| 4.7 | Post-commit indexing job failure | DB | N/A (logged only) | — | — | `completed` | Turn committed, indexing delayed | None | I |

**Note:** Post-commit failures (4.6, 4.7) never change a committed turn's status to failed — this is a hard invariant. They degrade non-critical functionality only.

## 5. Client/Transport Faults

| # | Fault | Layer | Error Code | HTTP | Retryable | SSE Terminal | DB Side Effect | Secret Leak | Coverage |
|---|-------|-------|-----------|------|-----------|-------------|----------------|-------------|----------|
| 5.1 | Client abort (user navigates away) | Client | `STREAM_INTERRUPTED` | N/A | — | N/A (transport broken) | Server may complete or abort independently | None | P |
| 5.2 | Client abort before first SSE event | Client | `STREAM_INTERRUPTED` | N/A | — | N/A | Execution record may be in-progress | None | P |
| 5.3 | Network disconnection mid-stream | Client | `STREAM_INTERRUPTED` | 502 | Yes | `cancelled` (server-side) | Execution record (status=in_progress or cancelled) | None | P |
| 5.4 | Premature stream close (no terminal event) | Client | `STREAM_INTERRUPTED` | 502 | Yes | N/A (missing) | May be in-progress or completed | None | U, P |
| 5.5 | Partial UTF-8 sequence at stream end | Client | `STREAM_INTERRUPTED` | 502 | Yes | N/A | N/A | None | U |
| 5.6 | SSE event malformed (invalid JSON) | Client | `PROTOCOL_ERROR` | 502 | No | N/A (before terminal) | May be in-progress | None | U, P |
| 5.7 | SSE sequence gap (non-terminal) | Client | `PROTOCOL_ERROR` | 502 | No | N/A (before terminal) | May be in-progress | None | U |
| 5.8 | SSE duplicate terminal event | Client | `PROTOCOL_ERROR` | 502 | No | N/A (second terminal) | Turn completed | None | U |
| 5.9 | SSE text-delta after failed event | Client | `PROTOCOL_ERROR` | — | No | N/A | N/A | None | U |
| 5.10 | Duplicate idempotency key (client retry) | Client | `TURN_IN_PROGRESS` (if running) or replay | 409 (if conflict) | — | Replay previous result | None (idempotent) | None | U, I |

## 6. Concurrency Faults

| # | Fault | Layer | Error Code | HTTP | Retryable | SSE Terminal | DB Side Effect | Secret Leak | Coverage |
|---|-------|-------|-----------|------|-----------|-------------|----------------|-------------|----------|
| 6.1 | Two concurrent turns for same player | DB | `TURN_CONFLICT` | 409 | No | `failed` (second request) | First turn preserved | None | U, I |
| 6.2 | Turn started while previous in-progress | DB | `TURN_IN_PROGRESS` | 409 | Yes (wait) | N/A | Previous turn continues | None | U |
| 6.3 | Turn submitted after completion (replay) | DB | `TURN_ALREADY_COMPLETED` | 409 | No | Replay previous response | None | None | U, I |
| 6.4 | Concurrent version increment race | DB | `TURN_CONFLICT` | 409 | No | `failed` | One winner, loser rejected | None | U |

## 7. Summary Statistics

| Layer | Fault Count | Covered (U) | Covered (C) | Covered (I) | Covered (E/P) | Gaps |
|-------|------------|-------------|-------------|-------------|---------------|------|
| Request | 8 | 0 | 8 | 0 | 2 | Auth/rate-limit (future) |
| LLM | 16 | 16 | 0 | 4 | 0 | E2E verification |
| RAG | 5 | 5 | 0 | 0 | 0 | Integration/E2E |
| DB | 7 | 4 | 0 | 7 | 0 | PostgreSQL unavailable |
| Client/Transport | 10 | 7 | 0 | 0 | 5 | Full E2E streams |
| Concurrency | 4 | 4 | 0 | 0 | 0 | PostgreSQL unavailable |
| **Total** | **50** | **36** | **8** | **11** | **7** | — |

## 8. Known Gaps (require PostgreSQL + LLM credentials)

- **I** (Integration) tests: require running PostgreSQL and/or LLM provider
- **E/P** (E2E/Playwright) tests: require full stack running
- Auth faults (1.7): not in current scope
- Rate limit faults (1.8): not in current scope

## 9. Verification Commands

```bash
# Unit tests (no external dependencies)
npx vitest run

# Contract tests (no external dependencies)
npx vitest run --config vitest.config.mts tests/contract/

# Integration tests (requires PostgreSQL)
npx vitest run --config vitest.db.config.mts tests/integration/

# E2E tests (requires running dev server)
npx playwright test

# Full fault-injection verification (requires full stack)
# Run each fault scenario and verify:
# 1. HTTP status matches matrix
# 2. Error code matches matrix
# 3. Retryability flag matches matrix
# 4. SSE terminal event received (or none for pre-stream)
# 5. No secrets in response body
# 6. Database side effects match matrix
```
