/**
 * src/server/contracts — Single source of truth for all API types and schemas.
 *
 * Every cross-boundary payload (HTTP request, HTTP response, SSE event, DB JSON,
 * provider response) must be validated through a schema defined here.
 */
export * from './app-result'
export * from './problem-details'
export * from './player'
export * from './game-action'
export * from './sse-events'
export * from './provider'
