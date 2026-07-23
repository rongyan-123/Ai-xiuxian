## ADDED Requirements

### Requirement: Versioned API contract
The system SHALL expose refactored HTTP endpoints under `/api/v1` and SHALL publish an OpenAPI 3.1-compatible contract generated from or verified against the runtime schemas used by the handlers.

#### Scenario: Contract and runtime agree
- **WHEN** the OpenAPI contract is generated or checked in CI
- **THEN** every declared request, success response, error response, status code, and media type SHALL match the runtime schemas used by the corresponding Route Handler

### Requirement: Runtime boundary validation
The system SHALL validate every untrusted HTTP request body, path value, query value, persisted JSON value, and external-service payload before application or domain logic consumes it.

#### Scenario: Malformed JSON body
- **WHEN** a client sends malformed JSON to an API v1 endpoint
- **THEN** the system SHALL return status 400 with a valid Problem Details body and SHALL NOT call the application service

#### Scenario: Semantically invalid request
- **WHEN** JSON is syntactically valid but fails the endpoint schema
- **THEN** the system SHALL return status 422 with stable validation issue pointers and SHALL NOT perform a game-side effect

### Requirement: RFC 9457 error responses
Every non-streaming API failure SHALL use `application/problem+json` and SHALL include RFC 9457 fields plus stable `code`, `requestId`, and `retryable` extension members.

#### Scenario: Known application failure
- **WHEN** an application service returns a known failure
- **THEN** the HTTP adapter SHALL map it to the documented status and stable problem code without exposing stack traces, secrets, SQL, prompts, or raw provider responses

#### Scenario: Unknown exception
- **WHEN** an unexpected exception escapes application logic
- **THEN** the outer boundary SHALL log the complete internal cause, return a sanitized 500 `INTERNAL_ERROR`, and include the same request ID in both records

### Requirement: Stable error semantics
Clients SHALL branch on stable problem codes and status values and MUST NOT infer error types from human-readable titles, details, provider messages, or regular expressions.

#### Scenario: Error copy changes
- **WHEN** the localized title or detail of a known error changes
- **THEN** existing client behavior SHALL remain unchanged because the stable code and schema are unchanged

### Requirement: Correct HTTP status mapping
The API SHALL distinguish malformed input, unauthorized access, missing resources, conflicts, semantic validation, rate limiting, upstream failures, dependency unavailability, and timeouts with documented 4xx/5xx status codes.

#### Scenario: Dependency timeout
- **WHEN** an upstream dependency exceeds its deadline before an SSE stream opens
- **THEN** the endpoint SHALL return status 504 and a retryable timeout Problem Details response

#### Scenario: Concurrent game turn conflict
- **WHEN** a turn cannot commit because the player version changed
- **THEN** the endpoint SHALL return status 409 with code `TURN_CONFLICT` and SHALL NOT overwrite the newer state

### Requirement: No silent error conversion
The system MUST NOT convert exceptions or failed dependencies into empty arrays, empty strings, fabricated success data, or undocumented 200 responses.

#### Scenario: Optional dependency degrades
- **WHEN** a non-critical dependency fails and the operation can legally continue
- **THEN** the success result SHALL explicitly describe the degradation and observability records SHALL contain the dependency failure

