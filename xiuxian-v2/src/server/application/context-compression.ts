/**
 * Context Compression — 上下文自动压缩
 *
 * 当上下文的估算 token 数超过模型上限的 85% 时触发压缩：
 *   1. 保留最近 3 轮对话原文
 *   2. 更早的对话压缩为结构化摘要（前情提要）
 *   3. 摘要注入到 Layer 2 动态层的 narrativeSummary 字段
 *
 * 未来优化：使用廉价模型（DeepSeek）生成更高质量的摘要
 */

// ── Types ─────────────────────────────────────────────────────────────────

export interface CompressionResult {
  /** 压缩后的消息列表（替换原有消息） */
  compressedMessages: Array<{
    role: string
    content: string | null
    tool_calls?: Array<{
      id: string
      type: 'function'
      function: { name: string; arguments: string }
    }>
    tool_call_id?: string
  }>
  /** 生成的叙事摘要（注入到 system prompt 的 narrativeSummary） */
  narrativeSummary: string
  /** 压缩前token估算 */
  tokensBefore: number
  /** 压缩后token估算 */
  tokensAfter: number
}

interface TurnSummary {
  userInput: string
  keyEvents: string[]
  npcsMentioned: string[]
  locationsMentioned: string[]
  itemsChanged: string[]
}

// ── Token Estimation ──────────────────────────────────────────────────────

/** 简单token估算：中文≈1.5 token/字，英文≈1.3 token/词，其他≈1 token/字符 */
export function estimateTokens(text: string): number {
  let tokens = 0
  for (const char of text) {
    const code = char.charCodeAt(0)
    if (code >= 0x4e00 && code <= 0x9fff) {
      tokens += 1.5 // 中文字符
    } else if (/[a-zA-Z]/.test(char)) {
      tokens += 0.3 // 英文字母（按单词算≈1.3）
    } else {
      tokens += 1
    }
  }
  return Math.ceil(tokens)
}

export function estimateMessagesTokens(
  messages: Array<{ role: string; content?: string | null }>,
): number {
  let total = 0
  for (const msg of messages) {
    total += estimateTokens(msg.content ?? '')
    total += estimateTokens(msg.role)
    total += 4 // 消息结构开销
  }
  return total
}

// ── Compression ───────────────────────────────────────────────────────────

/** 从旧消息中提取关键信息生成摘要 */
function extractTurnSummary(
  messages: Array<{ role: string; content?: string | null }>,
): TurnSummary[] {
  const summaries: TurnSummary[] = []
  let currentSummary: Partial<TurnSummary> = {}

  for (const msg of messages) {
    const content = msg.content ?? ''
    if (msg.role === 'user') {
      if (currentSummary.userInput !== undefined) {
        summaries.push({
          userInput: currentSummary.userInput ?? '',
          keyEvents: currentSummary.keyEvents ?? [],
          npcsMentioned: currentSummary.npcsMentioned ?? [],
          locationsMentioned: currentSummary.locationsMentioned ?? [],
          itemsChanged: currentSummary.itemsChanged ?? [],
        })
      }
      currentSummary = { userInput: content }
    }
    if (msg.role === 'assistant' && currentSummary) {
      // 提取NPC名字
      const npcMatches = content.match(/([^\s，。！？、]{2,4}(?:真人|道人|散修|掌门|长老|弟子|老\w|小\w))/g)
      if (npcMatches) {
        currentSummary.npcsMentioned = [
          ...(currentSummary.npcsMentioned ?? []),
          ...npcMatches,
        ]
      }
      // 提取地点
      const locMatches = content.match(/([^\s，。！？、]{2,4}(?:山|城|林|谷|村|镇|坊市|门|派|宗|殿|阁|堂))/g)
      if (locMatches) {
        currentSummary.locationsMentioned = [
          ...(currentSummary.locationsMentioned ?? []),
          ...locMatches,
        ]
      }
      // 提取关键动词作为事件
      const eventMatches = content.match(/([^，。！？\n]{5,30}(?:了|过|到|出|来|去|见|遇|得|失|获))/g)
      if (eventMatches) {
        currentSummary.keyEvents = [
          ...(currentSummary.keyEvents ?? []),
          ...eventMatches.slice(0, 3),
        ]
      }
    }
  }

  if (currentSummary.userInput !== undefined) {
    summaries.push({
      userInput: currentSummary.userInput ?? '',
      keyEvents: currentSummary.keyEvents ?? [],
      npcsMentioned: currentSummary.npcsMentioned ?? [],
      locationsMentioned: currentSummary.locationsMentioned ?? [],
      itemsChanged: currentSummary.itemsChanged ?? [],
    })
  }

  return summaries
}

function buildNarrativeSummary(summaries: TurnSummary[]): string {
  if (summaries.length === 0) return ''

  const lines: string[] = []
  const allNpcs = new Set<string>()
  const allLocations = new Set<string>()

  for (const s of summaries) {
    for (const npc of s.npcsMentioned) allNpcs.add(npc)
    for (const loc of s.locationsMentioned) allLocations.add(loc)
  }

  if (allNpcs.size > 0) {
    lines.push(`遇到过的人物：${[...allNpcs].join('、')}`)
  }
  if (allLocations.size > 0) {
    lines.push(`去过的地点：${[...allLocations].join('、')}`)
  }

  // 最近3个事件
  const recentEvents = summaries.slice(-3).flatMap((s) => s.keyEvents.slice(0, 2))
  if (recentEvents.length > 0) {
    lines.push(`最近经历：${recentEvents.join('；')}`)
  }

  if (lines.length === 0) return ''
  return lines.join('\n')
}

// ── Main Compression Function ─────────────────────────────────────────────

/**
 * 压缩消息列表。当 token 估算超过 thresholdTokens 时触发。
 *
 * 策略：
 *   - keepRecentTurns: 保留最近 N 轮（user+assistant对）原文
 *   - 更早的对话 → 提取摘要 → 注入为 narrativeSummary
 */
export function compressMessages(params: {
  messages: Array<{
    role: string
    content: string | null
    tool_calls?: Array<{
      id: string
      type: 'function'
      function: { name: string; arguments: string }
    }>
    tool_call_id?: string
  }>
  systemPromptTokens: number
  modelContextLimit: number
  keepRecentTurns?: number
}): CompressionResult | null {
  const { messages, systemPromptTokens, modelContextLimit, keepRecentTurns = 3 } = params
  const threshold = Math.floor(modelContextLimit * 0.85)
  const totalTokens = systemPromptTokens + estimateMessagesTokens(messages)

  if (totalTokens <= threshold) return null

  // 找到 system 消息之后、最近的 keepRecentTurns 轮对话
  // 消息结构: [system, user, assistant(tool_calls), tool, tool, assistant, user, ...]
  const userIndices: number[] = []
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'user') userIndices.push(i)
  }

  if (userIndices.length <= keepRecentTurns) return null

  // 需要压缩的旧消息范围: [1, 第一个保留的user消息之前)
  const firstKeptUserIdx = userIndices[userIndices.length - keepRecentTurns]
  const oldMessages = messages.slice(1, firstKeptUserIdx) // 不包括system消息
  const recentMessages = messages.slice(firstKeptUserIdx)

  // 从旧消息提取摘要
  const summaries = extractTurnSummary(oldMessages)
  const narrativeSummary = buildNarrativeSummary(summaries)

  // 构建压缩后的消息列表: system + 摘要note + 最近N轮
  const compressed: CompressionResult['compressedMessages'] = [
    messages[0], // system prompt
  ]

  if (narrativeSummary) {
    compressed.push({
      role: 'system',
      content: `[系统记录] 以下是之前发生的事：\n${narrativeSummary}`,
    })
  }

  compressed.push(...recentMessages)

  const tokensAfter =
    systemPromptTokens +
    estimateTokens(narrativeSummary) +
    estimateMessagesTokens(recentMessages)

  return {
    compressedMessages: compressed,
    narrativeSummary,
    tokensBefore: totalTokens,
    tokensAfter,
  }
}
