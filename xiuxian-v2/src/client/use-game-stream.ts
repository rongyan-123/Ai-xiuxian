/**
 * useGameStream — 集中式 SSE 游戏回合流 Hook。
 *
 * 整合 gameTurnClient（fetch + 异步迭代 + Zod 校验）
 * 和 gameTurnReducer（idle → submitting → streaming → completed/failed/cancelled 状态机），
 * 提供声明式 API 给 React 组件使用。
 *
 * 所有 SSE 事件副作用（addMessage、setPlayer、addCodex 等）通过 Zustand 的
 * vanilla API（getState）直接写入，不依赖 React 重渲染。
 * 组件卸载时自动 AbortController.abort() 取消请求。
 */
'use client'

import { useReducer, useRef, useCallback, useEffect } from 'react'
import { createGameTurnStream } from './game-turn-client'
import type { GameTurnRequest, GameTurnError as StreamError } from './game-turn-client'
import { gameTurnReducer, initialGameTurnState } from './game-turn-reducer'
import type { GameStatus, GameTurnError, GameTurnAction } from './game-turn-reducer'
import { useGameStore } from '@/stores/game'
import type { ParsedSSEEvent } from './sse-parser'
import type { SSEEvent } from '@/server/contracts/sse-events'

// ─── Public Types ───────────────────────────────────────────────────────────

export interface UseGameStreamOptions {
  /** 流成功完成时调用，传入最终累积的回复文本 */
  onCompleted?: (replyText: string) => void
  /** 流失败时调用 */
  onFailed?: (error: { code: string; message: string; retryable: boolean }, userInput: string) => void
  /** 流被取消时调用 */
  onCancelled?: () => void
}

export interface UseGameStreamReturn {
  /** 发起一次游戏回合请求 */
  send: (req: Omit<GameTurnRequest, 'idempotencyKey'>) => void
  /** 取消当前进行中的请求 */
  abort: () => void
  /** 当前状态机状态 */
  status: GameStatus
  /** 累积的流式文本（completed 前为候选，completed 后为终稿） */
  streamingText: string
  /** 累积的步骤日志 */
  stepLogs: string[]
  /** 错误信息（status === 'failed' 时有值） */
  error: GameTurnError | null
  /** 当前回合发送的用户输入（用于重试） */
  currentUserInput: string | null
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useGameStream(options: UseGameStreamOptions = {}): UseGameStreamReturn {
  const [state, dispatch] = useReducer(gameTurnReducer, initialGameTurnState)
  const abortRef = useRef<(() => void) | null>(null)
  const userInputRef = useRef<string | null>(null)
  const optionsRef = useRef(options)
  optionsRef.current = options

  // 组件卸载时取消进行中的请求
  useEffect(() => {
    return () => {
      abortRef.current?.()
    }
  }, [])

  const send = useCallback((req: Omit<GameTurnRequest, 'idempotencyKey'>) => {
    // 取消之前的请求（如果有）
    abortRef.current?.()

    const idempotencyKey = `idem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const fullReq: GameTurnRequest = {
      ...req,
      mode: req.mode ?? 'action',
      playerName: req.playerName ?? '修仙者',
      idempotencyKey,
    }
    userInputRef.current = fullReq.input

    dispatch({
      type: 'SUBMIT',
      playerId: fullReq.playerId,
      playerName: fullReq.playerName!,
      input: fullReq.input,
      mode: fullReq.mode!,
      idempotencyKey,
    })

    const stream = createGameTurnStream(fullReq)
    abortRef.current = stream.abort

    // 异步消费流 — 不阻塞 send() 返回
    runStreamLoop(stream, dispatch, userInputRef, optionsRef)
  }, [])

  const abort = useCallback(() => {
    abortRef.current?.()
    dispatch({ type: 'CANCEL' })
  }, [])

  return {
    send,
    abort,
    status: state.status,
    streamingText: state.replyText,
    stepLogs: state.stepLogs.map(s => s.label),
    error: state.error,
    currentUserInput: userInputRef.current,
  }
}

// ─── Private Stream Loop ─────────────────────────────────────────────────────

function toParsedEvent(sse: SSEEvent): ParsedSSEEvent<Record<string, unknown>> {
  return {
    type: sse.type,
    payload: sse.payload as Record<string, unknown>,
    sequence: sse.sequence,
    raw: JSON.stringify(sse),
  }
}

async function runStreamLoop(
  stream: ReturnType<typeof createGameTurnStream>,
  dispatch: (action: GameTurnAction) => void,
  userInputRef: React.MutableRefObject<string | null>,
  optionsRef: React.MutableRefObject<UseGameStreamOptions>,
): Promise<void> {
  const userInput = userInputRef.current ?? ''

  try {
    for await (const sseEvent of stream) {
      dispatch({ type: 'SSE_EVENT', event: toParsedEvent(sseEvent) })

      // 非终端事件的副作用 — 直接写 Zustand
      switch (sseEvent.type) {
        case 'codex': {
          const store = useGameStore.getState()
          store.addCodex({
            id: `c-${Date.now()}`,
            name: sseEvent.payload.name,
            entry_type: sseEvent.payload.entry_type,
            description: sseEvent.payload.description,
            metadata: (sseEvent.payload.metadata as Record<string, unknown>) ?? {},
            timestamp: sseEvent.payload.timestamp,
          })
          store.addNotification('codex')
          break
        }
        case 'journal': {
          const store = useGameStore.getState()
          store.addJournal({
            id: `j-${Date.now()}`,
            title: sseEvent.payload.title,
            content: sseEvent.payload.content,
            entry_type: sseEvent.payload.entry_type,
            timestamp: sseEvent.payload.timestamp,
          })
          store.addNotification('journal')
          break
        }
        case 'state_update': {
          useGameStore.getState().setPlayer(sseEvent.payload.player as never)
          break
        }
        case 'completed': {
          optionsRef.current.onCompleted?.(sseEvent.payload.reply)
          return
        }
        case 'failed': {
          optionsRef.current.onFailed?.(
            {
              code: sseEvent.payload.code ?? 'INTERNAL_ERROR',
              message: sseEvent.payload.detail ?? '未知错误',
              retryable: sseEvent.payload.retryable ?? false,
            },
            userInput,
          )
          return
        }
        case 'cancelled': {
          optionsRef.current.onCancelled?.()
          return
        }
      }
    }
  } catch (err: unknown) {
    const streamErr = err as StreamError
    if (streamErr?.code) {
      dispatch({ type: 'FAIL', error: { code: streamErr.code, message: streamErr.message, retryable: streamErr.retryable } })
      optionsRef.current.onFailed?.(
        { code: streamErr.code, message: streamErr.message, retryable: streamErr.retryable },
        userInput,
      )
    } else {
      dispatch({ type: 'FAIL', error: { code: 'STREAM_INTERRUPTED', message: err instanceof Error ? err.message : '未知流错误', retryable: true } })
      optionsRef.current.onFailed?.(
        { code: 'STREAM_INTERRUPTED', message: err instanceof Error ? err.message : '未知流错误', retryable: true },
        userInput,
      )
    }
  }
}
