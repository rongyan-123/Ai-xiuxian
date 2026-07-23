## ADDED Requirements

### Requirement: Contract-derived client
The frontend SHALL consume API v1 through a shared type-safe client derived from the published contract and SHALL runtime-validate all HTTP and SSE payloads before updating application state.

#### Scenario: Server success shape drifts
- **WHEN** the server returns a success payload that does not match the declared schema
- **THEN** the client SHALL reject it as `PROTOCOL_ERROR`, preserve diagnostic correlation IDs when available, and SHALL not update game state from the invalid payload

### Requirement: Centralized streaming parser
Incremental UTF-8 decoding, SSE framing, JSON parsing, event schema validation, sequence checking, and terminal enforcement SHALL be implemented once outside React components.

#### Scenario: JSON spans transport chunks
- **WHEN** one SSE data line is split across multiple network chunks
- **THEN** the parser SHALL buffer incomplete data and emit exactly one validated event after the complete frame arrives

### Requirement: Explicit game-turn state machine
The frontend SHALL represent a game turn as `idle`, `submitting`, `streaming`, `completed`, `failed`, `cancelling`, or `cancelled` and SHALL permit only documented transitions.

#### Scenario: Failed run is retryable
- **WHEN** a `failed` event carries `retryable: true`
- **THEN** the UI SHALL display a retry action with the request ID, retain the original user input and idempotency key, and SHALL not mutate authoritative player state

#### Scenario: Failed run is not retryable
- **WHEN** a `failed` event carries `retryable: false`
- **THEN** the UI SHALL present the safe error detail and request ID without offering an automatic retry action

### Requirement: Loading, empty, failure, and degraded results are distinct
Frontend consumers SHALL not represent failed or degraded operations as empty successful data and SHALL expose an appropriate visible state for each outcome.

#### Scenario: RAG returns a declared empty result
- **WHEN** RAG succeeds with no matches and the operation supports empty context
- **THEN** the UI/application state SHALL distinguish that valid empty result from `RAG_UNAVAILABLE` or `RAG_PROTOCOL_ERROR`

### Requirement: UI crash boundaries
The application SHALL provide route-level and global rendering error boundaries for unexpected render failures while keeping asynchronous request failures in the typed request state machine.

#### Scenario: Component throws during render
- **WHEN** an unexpected render exception occurs
- **THEN** the nearest error boundary SHALL show a recoverable fallback, report the correlated error, and prevent the entire application shell from becoming blank

