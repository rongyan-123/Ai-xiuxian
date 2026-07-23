/**
 * LLM provider response schemas.
 * Validates responses from the LLM API before they enter application logic.
 */
import { z } from 'zod/v4'

// ── OpenAI-compatible chat completion response ─────────────────────────

export const LLMToolCallSchema = z.object({
  id: z.string(),
  type: z.literal('function'),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
})

export const LLMMessageSchema = z.object({
  role: z.literal('assistant'),
  content: z.string().nullable(),
  tool_calls: z.array(LLMToolCallSchema).optional(),
})

export const LLMChoiceSchema = z.object({
  index: z.number(),
  message: LLMMessageSchema,
  finish_reason: z.string(),
})

export const LLMUsageSchema = z.object({
  prompt_tokens: z.number(),
  completion_tokens: z.number(),
  total_tokens: z.number(),
})

export const LLMResponseSchema = z.object({
  id: z.string(),
  object: z.literal('chat.completion'),
  created: z.number(),
  model: z.string(),
  choices: z.array(LLMChoiceSchema),
  usage: LLMUsageSchema.optional(),
})

export type LLMResponse = z.infer<typeof LLMResponseSchema>

// ── Streaming chunk ────────────────────────────────────────────────────

export const LLMStreamChunkSchema = z.object({
  id: z.string(),
  object: z.literal('chat.completion.chunk'),
  created: z.number(),
  model: z.string(),
  choices: z.array(z.object({
    index: z.number(),
    delta: z.object({
      role: z.string().optional(),
      content: z.string().nullable().optional(),
      tool_calls: z.array(z.object({
        index: z.number().optional(),
        id: z.string().optional(),
        type: z.literal('function').optional(),
        function: z.object({
          name: z.string().optional(),
          arguments: z.string().optional(),
        }).optional(),
      })).optional(),
    }),
    finish_reason: z.string().nullable().optional(),
  })),
})

export type LLMStreamChunk = z.infer<typeof LLMStreamChunkSchema>
