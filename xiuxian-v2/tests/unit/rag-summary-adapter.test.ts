/**
 * RAG and Summary adapter tests (TDD: RED phase).
 *
 * Tests the RAG and Summary provider implementations:
 * - Success with results
 * - Legitimate empty result (not an error)
 * - Unavailable dependency
 * - Timeout
 * - Abort/cancellation
 * - Protocol error
 */
import { describe, it, expect } from 'vitest'
import {
  createFakeRAGProvider,
  createFakeSummaryProvider,
} from '@/server/infrastructure/rag-adapter'
import type { RAGProvider, SummaryProvider } from '@/server/infrastructure/dependency-ports'

// ─── RAG Provider Tests ─────────────────────────────────────────────────

describe('7.4 RAG provider', () => {
  it('returns results on successful search', async () => {
    const rag = createFakeRAGProvider({
      results: [
        { content: '青云门是正道第一门派', metadata: { source: 'codex' } },
        { content: '青云山位于东域' },
      ],
    })

    const result = await rag.search('青云门', 5)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.results).toHaveLength(2)
      expect(result.results[0].content).toContain('青云门')
      expect(result.results[0].metadata?.source).toBe('codex')
    }
  })

  it('returns empty results when nothing matches (not an error)', async () => {
    const rag = createFakeRAGProvider({ results: [] })

    const result = await rag.search('不存在的关键词', 5)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.results).toHaveLength(0)
    }
  })

  it('returns empty results by default', async () => {
    const rag = createFakeRAGProvider()

    const result = await rag.search('anything', 5)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.results).toEqual([])
    }
  })

  it('returns RAG_UNAVAILABLE when dependency is down', async () => {
    const rag = createFakeRAGProvider({
      error: { code: 'RAG_UNAVAILABLE', message: 'Vector store connection refused' },
    })

    const result = await rag.search('query', 5)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('RAG_UNAVAILABLE')
      expect(result.error.retryable).toBe(true)
    }
  })

  it('returns RAG_TIMEOUT when aborted', async () => {
    const controller = new AbortController()
    const rag = createFakeRAGProvider({ latencyMs: 1000 })

    // Abort before the latency completes
    setTimeout(() => controller.abort(), 10)

    const result = await rag.search('query', 5, controller.signal)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('RAG_TIMEOUT')
    }
  })

  it('returns RAG_PROTOCOL_ERROR for unexpected response format', async () => {
    const rag = createFakeRAGProvider({
      error: { code: 'RAG_PROTOCOL_ERROR', message: 'Unexpected response shape' },
    })

    const result = await rag.search('query', 5)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('RAG_PROTOCOL_ERROR')
      expect(result.error.retryable).toBe(false)
    }
  })

  it('detects pre-aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()
    const rag = createFakeRAGProvider()

    const result = await rag.search('query', 5, controller.signal)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('RAG_TIMEOUT')
    }
  })
})

// ─── Summary Provider Tests ────────────────────────────────────────────

describe('7.4 Summary provider', () => {
  it('returns summary on success', async () => {
    const summarizer = createFakeSummaryProvider({
      summary: '玩家探索了青云山，击败了妖兽。',
    })

    const result = await summarizer.summarize([
      { role: 'user', content: '探索青云山' },
      { role: 'assistant', content: '你发现了一只妖兽...' },
    ])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.summary).toContain('青云山')
    }
  })

  it('returns default summary when none configured', async () => {
    const summarizer = createFakeSummaryProvider()

    const result = await summarizer.summarize([
      { role: 'user', content: 'hello' },
    ])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.summary).toBeTruthy()
    }
  })

  it('returns SUMMARY_UNAVAILABLE when service is down', async () => {
    const summarizer = createFakeSummaryProvider({
      error: { code: 'SUMMARY_UNAVAILABLE', message: 'Summary service unavailable' },
    })

    const result = await summarizer.summarize([])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('SUMMARY_UNAVAILABLE')
      expect(result.error.retryable).toBe(false)
    }
  })

  it('returns SUMMARY_TIMEOUT when aborted', async () => {
    const controller = new AbortController()
    const summarizer = createFakeSummaryProvider({ latencyMs: 1000 })

    setTimeout(() => controller.abort(), 10)

    const result = await summarizer.summarize([], controller.signal)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('SUMMARY_TIMEOUT')
    }
  })

  it('returns SUMMARY_PROTOCOL_ERROR', async () => {
    const summarizer = createFakeSummaryProvider({
      error: { code: 'SUMMARY_PROTOCOL_ERROR', message: 'Invalid response format' },
    })

    const result = await summarizer.summarize([])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('SUMMARY_PROTOCOL_ERROR')
    }
  })

  it('accepts empty message array', async () => {
    const summarizer = createFakeSummaryProvider({
      summary: '空对话，无总结。',
    })

    const result = await summarizer.summarize([])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.summary).toBe('空对话，无总结。')
    }
  })
})
