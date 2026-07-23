## ADDED Requirements

### Requirement: Versioned stream envelope
Every game-action SSE event SHALL conform to a runtime-validated envelope containing `protocolVersion`, `requestId`, `runId`, `sequence`, `occurredAt`, `type`, and a type-specific `payload`.

#### Scenario: Valid event is emitted
- **WHEN** the server emits any game-action event
- **THEN** the event SHALL validate against the schema for its declared protocol version and event type

### Requirement: Ordered event sequence
The first event SHALL be `accepted`, sequence numbers SHALL increase monotonically by one, and events SHALL preserve application order.

#### Scenario: Normal streaming turn
- **WHEN** a game turn emits progress, text, state, and completion events
- **THEN** the consumer SHALL observe one accepted event first, contiguous sequence values, and the completion event last

### Requirement: Exactly one terminal event
Every opened game-action stream SHALL attempt to terminate with exactly one of `completed`, `failed`, or `cancelled`; the writer SHALL reject events after a terminal event.

#### Scenario: Application fails after stream open
- **WHEN** a known or unknown failure occurs after response headers have been committed
- **THEN** the stream SHALL emit one schema-valid `failed` event carrying a sanitized problem payload and SHALL close without emitting `completed`

#### Scenario: Client cancels a turn
- **WHEN** the request AbortSignal indicates caller cancellation
- **THEN** the application SHALL stop cancellable work and the stream SHALL terminate as `cancelled` rather than `failed`

### Requirement: Pre-stream failures use HTTP errors
Failures discovered before the SSE stream is accepted SHALL be returned as non-2xx RFC 9457 HTTP responses rather than as a 200 stream containing an error string.

#### Scenario: Request schema fails
- **WHEN** a game-action request fails validation before the stream opens
- **THEN** the endpoint SHALL return a Problem Details response and SHALL emit no SSE events

### Requirement: Protocol violations are visible
The client SHALL detect malformed JSON, invalid payload schemas, unknown event types, missing or repeated sequence values, duplicate terminal events, and streams that close without a terminal event.

#### Scenario: Transport closes without terminal event
- **WHEN** the network stream ends after one or more non-terminal events but before a terminal event
- **THEN** the client SHALL enter failed state with code `STREAM_INTERRUPTED`, retain the request ID and candidate text, and SHALL NOT mark the turn completed

### Requirement: Authoritative completion state
Only a validated `state_update` followed by `completed` after successful persistence SHALL be treated as authoritative committed game state.

#### Scenario: Persistence fails after text deltas
- **WHEN** candidate narrative text was streamed but the final database transaction fails
- **THEN** the server SHALL emit `failed`, the client SHALL mark the candidate text uncommitted, and local player state SHALL not advance

