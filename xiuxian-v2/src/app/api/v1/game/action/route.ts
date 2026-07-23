/**
 * API v1 Game Action Route Handler.
 *
 * Thin HTTP adapter — validates input, builds request context,
 * calls ExecuteGameTurn, and returns SSE stream with Problem Details
 * on pre-stream failures.
 *
 * This handler contains NO business logic, persistence, or LLM calls.
 */
import { NextResponse } from 'next/server'
import { executeGameTurn } from '@/server/application/execute-game-turn'
import type { GameTurnRequest } from '@/server/application/execute-game-turn'
import { GameActionRequestSchema } from '@/server/contracts/game-action'
import { createFakeClock, createIdGenerator } from '@/server/infrastructure/adapters'
import type { EventSink } from '@/server/infrastructure/dependency-ports'
import type { EnvelopeEvent } from '@/server/streaming/event-factory'
import type { ProblemDetails } from '@/server/contracts/problem-details'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ─── SSE Event Sink ──────────────────────────────────────────────────────

function createSSEEventSink(controller: ReadableStreamDefaultController<Uint8Array>): EventSink {
  let closed = false

  function writeSSE(data: string): void {
    if (!closed) {
      controller.enqueue(new TextEncoder().encode(data))
    }
  }

  return {
    emit(event: EnvelopeEvent): void {
      const line = `data: ${JSON.stringify(event)}\n\n`
      writeSSE(line)
    },
    complete(): void {
      if (!closed) {
        writeSSE('data: {"type":"done"}\n\n')
        closed = true
        controller.close()
      }
    },
    fail(error: { code: string; message: string; retryable: boolean }): void {
      if (!closed) {
        writeSSE(`data: ${JSON.stringify({ type: 'failed', ...error })}\n\n`)
        closed = true
        controller.close()
      }
    },
    cancel(reason?: string): void {
      if (!closed) {
        writeSSE(`data: ${JSON.stringify({ type: 'cancelled', reason })}\n\n`)
        closed = true
        controller.close()
      }
    },
  }
}

// ─── Problem Details Builder ─────────────────────────────────────────────

function problemDetails(
  status: number,
  code: string,
  title: string,
  detail: string,
  requestId: string,
  retryable: boolean,
): ProblemDetails {
  return {
    type: `https://api.xiuxian.com/errors/${code.toLowerCase().replace(/_/g, '-')}`,
    title,
    status,
    detail,
    code,
    requestId,
    retryable,
  }
}

function validationError(
  detail: string,
  requestId: string,
  errors?: Array<{ pointer: string; message: string }>,
): ProblemDetails & { errors?: Array<{ pointer: string; message: string }> } {
  return {
    type: 'https://api.xiuxian.com/errors/validation-error',
    title: 'Validation Error',
    status: 422,
    detail,
    code: 'VALIDATION_ERROR',
    requestId,
    retryable: false,
    ...(errors ? { errors } : {}),
  }
}

// ─── POST Handler ────────────────────────────────────────────────────────

export async function POST(req: Request): Promise<Response> {
  const requestId = createIdGenerator().requestId()

  // Parse and validate the request body
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      problemDetails(400, 'BAD_REQUEST', 'Bad Request', 'Request body must be valid JSON', requestId, false),
      { status: 400 },
    )
  }

  const parsed = GameActionRequestSchema.safeParse(body)
  if (!parsed.success) {
    const errors = parsed.error.issues.map(issue => ({
      pointer: issue.path.join('/'),
      message: issue.message,
    }))
    return NextResponse.json(
      validationError('Input validation failed', requestId, errors),
      { status: 422 },
    )
  }

  const { input, playerId, mode = 'action', playerName = '修仙者', idempotencyKey } = parsed.data

  // Build the game turn request
  const turnRequest: GameTurnRequest = {
    playerId,
    playerName,
    input,
    mode: mode === 'prepare' ? 'action' : mode,
    idempotencyKey: idempotencyKey ?? createIdGenerator().idempotencyKey(),
    llmConfig: {
      apiKey: process.env.LLM_API_KEY ?? '',
      baseUrl: process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1',
      modelName: process.env.LLM_MODEL ?? 'gpt-4o-mini',
    },
    signal: req.signal,
  }

  // Create SSE stream
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const clock = createFakeClock(Date.now())
      const idGen = createIdGenerator()

      // FIXME: Replace fakes with real implementations when DB/LLM available
      // For now, we use the same fakes from tests — real adapters will be
      // wired in once PostgreSQL and LLM credentials are configured.
      const { createFakePlayerRepository } = await import('@/server/infrastructure/fake-repositories')
      const { createFakeTurnExecutionRepository } = await import('@/server/infrastructure/fake-repositories')
      const { createFakeOutboxRepository } = await import('@/server/infrastructure/fake-repositories')
      const { createFakeRAGProvider } = await import('@/server/infrastructure/rag-adapter')
      const { createFakeSummaryProvider } = await import('@/server/infrastructure/rag-adapter')
      const { createLLMAdapter } = await import('@/server/infrastructure/llm-adapter')
      const { createRetryPolicy } = await import('@/server/infrastructure/adapters')

      const eventSink = createSSEEventSink(controller)
      const retryPolicy = createRetryPolicy({ maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 30000, jitterFactor: 0.3 })

      // Seed a player if one doesn't exist (development convenience)
      let playerRepo = createFakePlayerRepository()
      let player = await playerRepo.findById(playerId)
      if (!player) {
        // Create a default player for testing — in production this would
        // reject with PLAYER_NOT_FOUND
        const defaultPlayer = {
          id: playerId,
          status: 'ALIVE' as const,
          name: playerName,
          gender: '男',
          version: 0,
          stats: {
            hp: { current: 100, max: 100, status_desc: '健康' },
            mp: { current: 50, max: 50, status_desc: '充足' },
            spirit: { value: 5, desc: '凡识' },
            realm: '练气期一层',
            age: { current: 18, max: 120 },
            race: '人族',
            alignment: '正道' as const,
            sect: '散修',
            spiritual_root: '金灵根',
            mental_state: '正常',
            reputation: 0,
            emotion: '平静',
            state_of_mind: 80,
            fortune: 50,
            karma: 0,
            techniques: { main: '基础吐纳', combat: [], movement: '步行', support: [] },
            shield: { current: 0, max: 50 },
            talents: [],
            traits: [],
          },
          inventory: [],
          codex: [],
          relationships: {},
          situations: [],
          foreshadowings: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
        // Directly seed the fake repo and use it as the player repo
        playerRepo = createFakePlayerRepository([defaultPlayer])
        player = await playerRepo.findById(playerId)
      }

      await executeGameTurn(
        {
          playerRepo,
          turnRepo: createFakeTurnExecutionRepository(),
          outboxRepo: createFakeOutboxRepository(),
          llmProvider: createLLMAdapter({
            retryPolicy,
            clock,
          }),
          ragProvider: createFakeRAGProvider({ results: [] }),
          summaryProvider: createFakeSummaryProvider(),
          clock,
          idGen,
          eventSink,
        },
        turnRequest,
      )
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Request-Id': requestId,
      'X-Protocol-Version': '1.0',
      'X-Accel-Buffering': 'no',
    },
  })
}
