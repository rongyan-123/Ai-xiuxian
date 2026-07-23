## ADDED Requirements

### Requirement: End-to-end correlation identifiers
Every API request and game run SHALL have stable correlation identifiers propagated through HTTP headers, Problem Details, SSE envelopes, structured logs, traces, and execution records.

#### Scenario: Support investigates a failed turn
- **WHEN** a user supplies the request ID shown by the client
- **THEN** an operator SHALL be able to locate the corresponding sanitized request, run stages, dependency attempts, terminal error, and persistence outcome

### Requirement: Sanitized structured logging
The system SHALL emit structured logs for request lifecycle, run stages, dependency attempts, retries, cancellations, terminal outcomes, and unexpected exceptions through a centralized redaction layer.

#### Scenario: Provider call fails with a secret in its cause
- **WHEN** an exception or provider response contains an API key, authorization value, cookie, full prompt, or other configured sensitive field
- **THEN** external responses, logs, and trace attributes SHALL contain a redacted value rather than the secret

### Requirement: HTTP and dependency tracing
The system SHALL instrument HTTP server operations and LLM, RAG, and database dependencies with OpenTelemetry-compatible spans and SHALL record status, duration, attempt count, and `error.type` without recording full prompts or secrets.

#### Scenario: Database request times out
- **WHEN** a database dependency span ends because of timeout
- **THEN** the span SHALL be marked as error with a stable error type and SHALL share the request trace with the API operation

### Requirement: Separate liveness and readiness
The system SHALL expose liveness and readiness endpoints with different semantics: liveness proves the process can respond, while readiness reports whether required dependencies can accept game requests.

#### Scenario: Database is unavailable
- **WHEN** the process is running but the required database check fails
- **THEN** liveness SHALL remain healthy, readiness SHALL be non-ready with a sanitized database status, and game requests SHALL fail with a typed dependency error rather than hang

#### Scenario: Optional dependency is degraded
- **WHEN** an optional dependency is unavailable but core requests may legally continue
- **THEN** readiness SHALL report `degraded` for that dependency and MUST NOT report an entirely healthy dependency set

### Requirement: No paid or mutating health probes
Health endpoints MUST NOT invoke paid model generation, mutate player state, insert game data, or expose credentials and internal stack traces.

#### Scenario: Readiness is polled repeatedly
- **WHEN** infrastructure polls readiness at a high frequency
- **THEN** the checks SHALL remain bounded, read-only, and free of model usage charges or game-side effects
