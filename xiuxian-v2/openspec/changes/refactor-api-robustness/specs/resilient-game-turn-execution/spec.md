## ADDED Requirements

### Requirement: Single game-turn application entry
All production game-turn requests SHALL execute through one application use case and one canonical LangGraph workflow; HTTP handlers, compatibility routes, and tests MUST NOT contain alternate business orchestration.

#### Scenario: API v1 executes a turn
- **WHEN** the API v1 game-action handler receives a valid request
- **THEN** it SHALL invoke the canonical application use case without directly accessing Prisma, LLM, RAG, or domain rule implementations

### Requirement: Pure deterministic rule engine
The rule engine SHALL be a side-effect-free function over validated tool calls and immutable game state, returning a new state, domain events, deltas, and typed failures.

#### Scenario: Same rule input is replayed
- **WHEN** the same validated state and tool calls are evaluated more than once
- **THEN** the rule engine SHALL produce structurally equivalent results without performing network, database, clock, random, or logging side effects

### Requirement: Request-scoped dependency configuration
Provider credentials, model selection, correlation context, cancellation signals, and retry state SHALL be immutable and scoped to one request or run.

#### Scenario: Concurrent providers
- **WHEN** two players execute overlapping turns with different provider configurations
- **THEN** each run SHALL use only its own configuration and neither run's logs or requests SHALL contain the other's API key or model selection

### Requirement: Idempotent side effects
Each logical game turn SHALL carry an idempotency key unique per player, and repeating the same key SHALL not repeat model billing where a stored terminal result exists or repeat any game-state mutation.

#### Scenario: Completed request is retried
- **WHEN** the client repeats a previously completed request with the same player and idempotency key
- **THEN** the server SHALL return or replay the recorded terminal outcome without applying stats, inventory, messages, or relationships a second time

#### Scenario: Request is already running
- **WHEN** a duplicate request arrives while the original idempotency record is still running
- **THEN** the server SHALL return or stream a documented conflict/in-progress outcome and SHALL not start a second execution

### Requirement: Optimistic concurrency and atomic persistence
Committed player mutation, user/assistant messages, domain events, and turn terminal status SHALL be persisted atomically with a player-version precondition.

#### Scenario: Atomic commit succeeds
- **WHEN** the calculated turn is based on the current player version
- **THEN** all authoritative mutations SHALL commit together and the player version SHALL increment exactly once

#### Scenario: Any transactional write fails
- **WHEN** one required write in the final transaction fails
- **THEN** all required writes SHALL roll back, the player state SHALL remain at its prior version, and the turn SHALL not be reported completed

### Requirement: Explicit timeout and cancellation propagation
The application SHALL enforce a total run deadline and dependency-specific deadlines, propagate AbortSignal to cancellable operations, and distinguish caller cancellation from timeout and internal failure.

#### Scenario: LLM exceeds deadline
- **WHEN** the LLM call exceeds its configured deadline
- **THEN** the operation SHALL be aborted, mapped to `LLM_TIMEOUT`, and SHALL leave no committed game mutation

### Requirement: Bounded safe retries
Automatic retries SHALL be limited to documented transient failures on operations that are safe to repeat and SHALL use bounded exponential backoff with jitter and `Retry-After` when present.

#### Scenario: Provider authentication fails
- **WHEN** the model provider returns 401 or 403
- **THEN** the adapter SHALL not retry and SHALL return a non-retryable typed provider-authentication error

#### Scenario: Transient pre-commit provider failure
- **WHEN** a safe provider call returns a documented transient 429 or 503 before persistence begins
- **THEN** the adapter SHALL apply the configured transient retry policy without exceeding its bound and SHALL record each attempt

### Requirement: Visible post-commit degradation
Non-critical post-commit operations such as memory indexing SHALL use a durable retry mechanism or a visible degraded result and MUST NOT be silently discarded.

#### Scenario: History indexing fails after commit
- **WHEN** the game turn commits but history indexing fails
- **THEN** the completed result SHALL remain valid, a retryable post-commit job or explicit degradation record SHALL be created, and the failure SHALL be observable
