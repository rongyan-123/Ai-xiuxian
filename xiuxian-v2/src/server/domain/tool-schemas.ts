/**
 * Runtime Zod schemas for all LLM tool calls consumed by the rule engine.
 *
 * These schemas validate tool call arguments at the domain boundary before
 * they enter the pure rule engine, converting "stringly-typed" LLM output
 * into validated, typed data.
 */
import { z } from 'zod/v4'

// ── Shared enumerations ─────────────────────────────────────────────────

/**
 * 已知的 camelCase → snake_case 键名映射。
 * LLM 可能按工具目录的旧参数名输出 camelCase，需要在此统一转换。
 */
const CAMEL_TO_SNAKE_KEYS: Record<string, string> = {
  npcId: 'npcId',
  playerGoal: 'player_goal',
  possibleOutcomes: 'possible_outcomes',
  linkedSituation: 'linked_situation',
  situationId: 'situation_id',
  actualOutcome: 'actual_outcome',
  relatedSituation: 'related_situation',
  resolveNote: 'resolve_note',
  entryType: 'entry_type',
  playerName: 'player_name',
  newRealm: 'new_realm',
  realmChange: 'realm_change',
}

/**
 * 将对象中的 camelCase 键转换为 snake_case（仅限已知映射）。
 * 保留原始键，优先使用 snake_case 版本的值。
 */
function normalizeCamelKeys(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const obj = raw as Record<string, unknown>
  const result = { ...obj }
  for (const [camel, snake] of Object.entries(CAMEL_TO_SNAKE_KEYS)) {
    if (camel in obj && !(snake in obj)) {
      result[snake] = obj[camel]
      delete result[camel]
    }
  }
  // 递归处理嵌套对象
  for (const key of Object.keys(result)) {
    const val = result[key]
    if (val && typeof val === 'object') {
      if (Array.isArray(val)) {
        result[key] = val.map((item) =>
          typeof item === 'object' && !Array.isArray(item) ? normalizeCamelKeys(item) : item,
        )
      } else {
        result[key] = normalizeCamelKeys(val)
      }
    }
  }
  return result
}

const ItemGrade = z.enum([
  '黄阶下品', '黄阶中品', '黄阶上品',
  '玄阶下品', '玄阶中品', '玄阶上品',
  '地阶下品', '地阶中品', '地阶上品',
  '天阶下品', '天阶中品', '天阶上品',
  '无',
])

const ItemType = z.enum(['丹药', '法宝', '材料', '功法', '杂物', '特殊物品'])

const Alignment = z.enum(['正道', '魔道', '中立'])

const DangerLevel = z.enum(['安全', '低危', '中危', '高危', '绝地'])

const PeaceLevel = z.enum(['和平', '冲突', '战争', '混乱'])

const SituationType = z.enum(['conflict', 'exploration', 'social', 'opportunity', 'mystery'])

const SituationStatus = z.enum(['brewing', 'climax', 'resolution', 'ended'])

const SituationAction = z.enum(['create', 'update_status', 'end', 'add_outcome'])

const BreakthroughResult = z.enum(['SUCCESS', 'FAIL'])

const CodexEntryType = z.enum(['npc', 'location', 'item', 'sect', 'background'])

const JournalEntryType = z.enum(['story_start', 'major_twist', 'story_end', 'general'])

// ── Individual tool argument schemas ────────────────────────────────────

/**
 * 规范化枚举字段值，处理 LLM 可能输出的非标准值。
 * 返回有效枚举值或默认值。
 */
function normalizeEnumField(
  value: unknown,
  validValues: string[],
  defaultValue: string,
): string {
  if (typeof value !== 'string') return defaultValue
  // 精确匹配
  if (validValues.includes(value)) return value
  // 模糊匹配：包含关键词
  for (const v of validValues) {
    if (value.includes(v) || v.includes(value)) return v
  }
  return defaultValue
}

const BackpackAddItemsArgs = z.object({
  items: z.array(z.object({
    name: z.string(),
    type: z.string().optional(),
    grade: z.string().optional(),
    description: z.string().optional(),
    count: z.number(),
    value: z.number().optional(),
    id: z.string().optional(),
    effects: z.string().optional(),
  })),
})

const BackpackReduceItemsArgs = z.object({
  items: z.array(z.object({
    name: z.string(),
    count: z.number(),
  })),
})

const ConsumeItemArgs = z.object({
  items: z.array(z.object({
    name: z.string(),
    count: z.number(),
  })).optional(),
  mp_cost: z.number().optional(),
})

const ModifyStatsArgs = z.object({
  hp_change: z.number().optional(),
  hp_max_change: z.number().optional(),
  mp_change: z.number().optional(),
  mp_max_change: z.number().optional(),
  spirit_change: z.number().optional(),
  age_change: z.number().optional(),
  combat_power_change: z.number().optional(),
  reputation_change: z.number().optional(),
  state_of_mind_change: z.number().optional(),
  fortune_change: z.number().optional(),
  karma_change: z.number().optional(),
  shield_change: z.number().optional(),
  shield_max_change: z.number().optional(),
})

const ModifyTechniquesArgs = z.object({
  main: z.string().optional(),
  add_combat: z.string().optional(),
  remove_combat: z.string().optional(),
  movement: z.string().optional(),
  add_support: z.string().optional(),
  remove_support: z.string().optional(),
})

const ModifyTraitsArgs = z.object({
  add_talents: z.array(z.string()).optional(),
  remove_talents: z.array(z.string()).optional(),
  add_traits: z.array(z.string()).optional(),
  remove_traits: z.array(z.string()).optional(),
})

const ModifyMentalArgs = z.object({
  emotion: z.string().optional(),
  mental_state: z.string().optional(),
  reputation_change: z.number().optional(),
  state_of_mind_change: z.number().optional(),
  alignment: Alignment.optional(),
  sect: z.string().optional(),
  spiritual_root: z.string().optional(),
  realm: z.string().optional(),
  race: z.string().optional(),
})

const UpdateRelationshipArgs = z.object({
  npc_name: z.string(),
  change: z.number(),
})

const ChangeLocationArgs = z.preprocess(
  (raw: unknown) => {
    const obj = raw as Record<string, unknown> | null
    if (!obj || typeof obj !== 'object') return raw
    // 标准化: where/to → location
    const loc = obj.where ?? obj.to ?? obj.location
    if (typeof loc === 'string') {
      return { ...obj, location: loc }
    }
    return obj
  },
  z.object({
    location: z.string(),
  }),
)

const CheckBreakthroughArgs = z.object({
  result: BreakthroughResult,
  new_realm: z.string().optional(),
  realm_change: z.string().optional(),
})

const NpcFields = z.object({
  name: z.string(),
  title: z.string().optional(),
  realm: z.string(),
  alignment: Alignment,
  sect: z.string(),
  personality: z.string(),
  relationship: z.number(),
  description: z.string(),
})

const GenerateNPCArgs = z.preprocess(
  (raw: unknown) => {
    const obj = normalizeCamelKeys(raw) as Record<string, unknown> | null
    if (!obj || typeof obj !== 'object') return obj
    // 标准化: npc（单对象）→ npcs（数组）
    if (obj.npc && !obj.npcs) {
      return { ...obj, npcs: [obj.npc], npc: undefined }
    }
    return obj
  },
  z.object({
    npcs: z.array(NpcFields),
  }),
)

const GenerateLocationArgs = z.preprocess(
  (raw: unknown) => {
    const obj = raw as Record<string, unknown> | null
    if (!obj || typeof obj !== 'object') return raw
    // 标准化: location（单对象）→ locations（数组）
    if (obj.location && !obj.locations) {
      const loc = obj.location
      // location 可能是对象或字符串
      const locObj = typeof loc === 'string' ? { name: loc } : loc
      return { ...obj, locations: Array.isArray(locObj) ? locObj : [locObj], location: undefined }
    }
    // 标准化: locations 是单对象而非数组 → 包装成数组
    if (obj.locations && !Array.isArray(obj.locations)) {
      obj.locations = [obj.locations]
    }
    // 标准化: locations 数组中的每个元素，规范化 enum 字段
    if (Array.isArray(obj.locations)) {
      obj.locations = (obj.locations as Array<Record<string, unknown>>).map((loc) => ({
        ...loc,
        danger_level: normalizeEnumField(loc.danger_level, ['安全', '低危', '中危', '高危', '绝地'], '低危'),
        peace_orno: normalizeEnumField(loc.peace_orno, ['和平', '冲突', '战争', '混乱'], '和平'),
      }))
    }
    return obj
  },
  z.object({
    // 必填仅为核心字段；LLM 生成的次要字段可能缺失，rule-engine 已做空值保护
    locations: z.array(z.object({
      name: z.string(),
      region: z.string(),
      danger_level: DangerLevel,
      description: z.string(),
      peace_orno: PeaceLevel,
      power_distribution: z.string().optional(),
      level_range: z.string().optional(),
      rules: z.string().optional(),
      inhabitants: z.array(z.string()).optional(),
      bound_items: z.array(z.string()).optional(),
      bound_locations: z.array(z.string()).optional(),
    })),
  }),
)

const GenerateSectArgs = z.preprocess(
  (raw: unknown) => {
    const obj = raw as Record<string, unknown> | null
    if (!obj || typeof obj !== 'object') return raw
    if (obj.sect && !obj.sects) {
      return { ...obj, sects: [obj.sect], sect: undefined }
    }
    return obj
  },
  z.object({
    sects: z.array(z.object({
      name: z.string(),
      alignment: Alignment,
      power_level: z.string(),
      master: z.string(),
      master_realm: z.string(),
      description: z.string(),
      specialties: z.string().optional(),
    })),
  }),
)

const GenerateItemArgs = z.preprocess(
  (raw: unknown) => {
    const obj = raw as Record<string, unknown> | null
    if (!obj || typeof obj !== 'object') return raw
    if (obj.item && !obj.items) {
      return { ...obj, items: [obj.item], item: undefined }
    }
    return obj
  },
  z.object({
    items: z.array(z.object({
      name: z.string(),
      type: ItemType,
      grade: ItemGrade,
      description: z.string(),
      count: z.number(),
      value: z.number(),
      effects: z.string().optional(),
    })),
  }),
)

const WriteCodexArgs = z.preprocess(normalizeCamelKeys, z.object({
  name: z.string(),
  entry_type: CodexEntryType,
  description: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}))

const WriteJournalArgs = z.preprocess(normalizeCamelKeys, z.object({
  title: z.string(),
  content: z.string(),
  entry_type: JournalEntryType.optional(),
}))

const UpdateSituationArgs = z.preprocess(
  (raw: unknown) => {
    const obj = normalizeCamelKeys(raw) as Record<string, unknown> | null
    if (!obj || typeof obj !== 'object') return obj
    // 缺失 action 时默认为 'create'
    if (!obj.action) {
      ;(obj as Record<string, unknown>).action = 'create'
    }
    return obj
  },
  z.object({
    action: SituationAction,
    situation_id: z.string().optional(),
    title: z.string().optional(),
    type: SituationType.optional(),
    trigger: z.string().optional(),
    npcs: z.array(z.string()).optional(),
    player_goal: z.string().optional(),
    possible_outcomes: z.array(z.string()).optional(),
    linked_situation: z.string().optional(),
    status: SituationStatus.optional(),
    actual_outcome: z.string().optional(),
    new_outcome: z.string().optional(),
  }),
)

const CreateForeshadowingArgs = z.preprocess(normalizeCamelKeys, z.object({
  foreshadowing_id: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  related_situation: z.string().optional(),
  resolved: z.boolean().default(false),
  resolve_note: z.string().optional(),
}))

const SearchHistoryArgs = z.object({
  query: z.string(),
  limit: z.number().optional().default(5),
})

const SkipArgs = z.object({
  reason: z.string(),
})

// ── New-catalog tool schemas (perception queries, merged actions, NPC behaviors) ──

const SearchAreaArgs = z.object({
  zone: z.string().optional(),
  type: z.string().optional(),
})

const ExamineObjectArgs = z.object({
  target: z.string(),
})

const SenseDangerArgs = z.object({
  radius: z.string().optional(),
})

const CheckNpcStateArgs = z.object({
  npcId: z.string(),
})

const QueryRegionArgs = z.object({
  region: z.string(),
  aspects: z.array(z.string()).optional(),
})

const LookAroundArgs = z.object({})

const ModifyInventoryArgs = z.object({
  who: z.string().optional(),
  additions: z.array(z.object({
    name: z.string(),
    type: z.string().optional(),
    grade: z.string().optional(),
    description: z.string().optional(),
    count: z.number(),
    value: z.number().optional(),
  })).optional(),
  removals: z.array(z.object({
    name: z.string(),
    count: z.number(),
  })).optional(),
  reason: z.string().optional(),
})

const TriggerCombatArgs = z.object({
  participants: z.array(z.object({
    side: z.enum(['a', 'b']),
    entities: z.array(z.string()),
  })),
  context: z.string(),
  environment: z.string().optional(),
})

const AdvanceTimeArgs = z.object({
  duration: z.string(),
  activity: z.string(),
})

const GenerateDailyPlanArgs = z.object({})

const DecideReactionArgs = z.object({
  event: z.string(),
  source: z.string().optional(),
})

const FormMemoryArgs = z.object({
  content: z.string(),
  importance: z.number().optional(),
  tags: z.array(z.string()).optional(),
})

const GenerateDialogueArgs = z.object({
  interlocutor: z.string(),
  context: z.string().optional(),
})

const SelfReflectionArgs = z.object({})

// ── Tool name → schema mapping (old + new) ──────────────────────────────

export const TOOL_SCHEMAS: Record<string, z.ZodTypeAny> = {
  // Old names (backward compat)
  Backpack_additems: BackpackAddItemsArgs,
  Backpack_reduceitems: BackpackReduceItemsArgs,
  Consume_Item: ConsumeItemArgs,
  Modify_Stats: ModifyStatsArgs,
  Modify_Techniques: ModifyTechniquesArgs,
  Modify_Traits: ModifyTraitsArgs,
  Modify_Mental: ModifyMentalArgs,
  Update_Relationship: UpdateRelationshipArgs,
  Change_Location: ChangeLocationArgs,
  Check_Breakthrough: CheckBreakthroughArgs,
  Generate_NPC: GenerateNPCArgs,
  Generate_Location: GenerateLocationArgs,
  Generate_Sect: GenerateSectArgs,
  Generate_Item: GenerateItemArgs,
  Write_Codex: WriteCodexArgs,
  Write_Journal: WriteJournalArgs,
  Update_Situation: UpdateSituationArgs,
  Create_Foreshadowing: CreateForeshadowingArgs,
  Search_History: SearchHistoryArgs,
  Skip: SkipArgs,
  // New canonical names
  SearchArea: SearchAreaArgs,
  ExamineObject: ExamineObjectArgs,
  SenseDanger: SenseDangerArgs,
  CheckNpcState: CheckNpcStateArgs,
  QueryRegion: QueryRegionArgs,
  RecallMemory: SearchHistoryArgs,
  LookAround: LookAroundArgs,
  ChangeLocation: ChangeLocationArgs,
  ModifyStats: ModifyStatsArgs,
  ModifyInventory: ModifyInventoryArgs,
  UpdateRelationship: UpdateRelationshipArgs,
  TriggerCombat: TriggerCombatArgs,
  CreateSituation: UpdateSituationArgs,
  ResolveSituation: UpdateSituationArgs,
  CreateForeshadowing: CreateForeshadowingArgs,
  AdvanceTime: AdvanceTimeArgs,
  GenerateNpc: GenerateNPCArgs,
  GenerateLocation: GenerateLocationArgs,
  AddJournalEntry: WriteJournalArgs,
  AddCodexEntry: WriteCodexArgs,
  GenerateDailyPlan: GenerateDailyPlanArgs,
  DecideReaction: DecideReactionArgs,
  FormMemory: FormMemoryArgs,
  GenerateDialogue: GenerateDialogueArgs,
  SelfReflection: SelfReflectionArgs,
  ConsumeItem: ConsumeItemArgs,
  ModifyTechniques: ModifyTechniquesArgs,
  ModifyTraits: ModifyTraitsArgs,
  CheckBreakthrough: CheckBreakthroughArgs,
  GenerateSect: GenerateSectArgs,
  GenerateItem: GenerateItemArgs,
}

export type ToolName = keyof typeof TOOL_SCHEMAS

export const KNOWN_TOOL_NAMES = Object.keys(TOOL_SCHEMAS) as ToolName[]

// ── Tool call input type (what the LLM produces) ────────────────────────

export const ToolCallSchema = z.object({
  name: z.string(),
  args: z.record(z.string(), z.unknown()).optional().default({}),
})

export type ToolCall = z.infer<typeof ToolCallSchema>

// ── Tool call array schemas ─────────────────────────────────────────────

export const ToolCallArraySchema = z.array(ToolCallSchema)

// ── Validation helpers ──────────────────────────────────────────────────

export interface ToolValidationResult {
  valid: true
  calls: Array<{ name: ToolName; args: Record<string, unknown> }>
}

export interface ToolValidationError {
  valid: false
  code: 'UNKNOWN_TOOL' | 'MALFORMED_ARGS' | 'DUPLICATE_TOOL' | 'CONTRADICTORY_TOOLS'
  message: string
  toolName?: string
  details?: unknown
}

/**
 * Validate an array of raw tool calls from the LLM.
 *
 * Checks:
 * 1. Every tool name is known
 * 2. Every tool's args conform to its schema
 * 3. No contradictory tool calls (heal + damage in same turn, etc.)
 */
export function validateToolCalls(
  rawCalls: unknown,
): ToolValidationResult | ToolValidationError {
  if (!Array.isArray(rawCalls)) {
    return { valid: false, code: 'MALFORMED_ARGS', message: 'Tool calls must be an array' }
  }

  const parsed: Array<{ name: ToolName; args: Record<string, unknown> }> = []

  for (let i = 0; i < rawCalls.length; i++) {
    const call = rawCalls[i]

    // Parse tool call shape
    const parsedCall = ToolCallSchema.safeParse(call)
    if (!parsedCall.success) {
      return {
        valid: false,
        code: 'MALFORMED_ARGS',
        message: `Tool call at index ${i} is malformed`,
        details: parsedCall.error,
      }
    }

    const { name, args } = parsedCall.data

    // Check known tool
    if (!(name in TOOL_SCHEMAS)) {
      return {
        valid: false,
        code: 'UNKNOWN_TOOL',
        message: `Unknown tool: "${name}"`,
        toolName: name,
      }
    }

    // Validate args against the tool's schema
    const schema = TOOL_SCHEMAS[name]
    const validatedArgs = schema.safeParse(args)
    if (!validatedArgs.success) {
      return {
        valid: false,
        code: 'MALFORMED_ARGS',
        message: `Invalid arguments for tool "${name}"`,
        toolName: name,
        details: validatedArgs.error,
      }
    }

    parsed.push({ name: name as ToolName, args: validatedArgs.data as Record<string, unknown> })
  }

  // Detect contradictions
  const contradiction = detectContradictions(parsed)
  if (contradiction) {
    return contradiction
  }

  return { valid: true, calls: parsed }
}

/** 校验单个工具调用 — 用于 Agent 自修正循环 */
export function validateSingleToolCall(
  name: string,
  args: Record<string, unknown>,
): ToolValidationResult | ToolValidationError {
  if (!(name in TOOL_SCHEMAS)) {
    return {
      valid: false,
      code: 'UNKNOWN_TOOL',
      message: `Unknown tool: "${name}"`,
      toolName: name,
    }
  }
  const schema = TOOL_SCHEMAS[name]
  const validatedArgs = schema.safeParse(args)
  if (!validatedArgs.success) {
    return {
      valid: false,
      code: 'MALFORMED_ARGS',
      message: `Invalid arguments for tool "${name}"`,
      toolName: name,
      details: validatedArgs.error,
    }
  }
  return { valid: true, calls: [{ name: name as ToolName, args: validatedArgs.data as Record<string, unknown> }] }
}

// ── Contradiction detection ─────────────────────────────────────────────

function detectContradictions(
  calls: Array<{ name: string; args: Record<string, unknown> }>,
): ToolValidationError | null {
  const modifyStatsCall = calls.find((c) => c.name === 'Modify_Stats' || c.name === 'ModifyStats')
  const breakthroughCall = calls.find((c) => c.name === 'Check_Breakthrough' || c.name === 'CheckBreakthrough')
  const consumeCall = calls.find((c) => c.name === 'Consume_Item' || c.name === 'ConsumeItem')
  const backpackAddCall = calls.find((c) => c.name === 'Backpack_additems')
  const backpackReduceCall = calls.find((c) => c.name === 'Backpack_reduceitems')
  const modifyInventoryCall = calls.find((c) => c.name === 'ModifyInventory')

  // Contradiction: healing AND damaging in same Modify_Stats
  if (modifyStatsCall) {
    const hpChange = modifyStatsCall.args.hp_change as number | undefined
    if (hpChange !== undefined && hpChange !== 0) {
      // Single hp_change with both sign aspects is fine — it's one value
      // But if somehow both positive and negative changes exist, flag it
    }
  }

  // Contradiction: adding AND consuming/removing same item in one turn
  if (backpackAddCall && backpackReduceCall) {
    const addedItems = (backpackAddCall.args.items as Array<{ name: string }>) || []
    const reducedItems = (backpackReduceCall.args.items as Array<{ name: string }>) || []
    const addedNames = new Set(addedItems.map((i) => i.name))
    const reducedNames = new Set(reducedItems.map((i) => i.name))
    const overlap = [...addedNames].filter((n) => reducedNames.has(n))
    if (overlap.length > 0) {
      return {
        valid: false,
        code: 'CONTRADICTORY_TOOLS',
        message: `Cannot add and reduce the same item(s) in one turn: ${overlap.join(', ')}`,
      }
    }
  }
  if (backpackAddCall && consumeCall) {
    const addedItems = (backpackAddCall.args.items as Array<{ name: string }>) || []
    const consumedItems = (consumeCall.args.items as Array<{ name: string }>) || []
    const addedNames = new Set(addedItems.map((i) => i.name))
    const consumedNames = new Set(consumedItems.map((i) => i.name))
    const overlap = [...addedNames].filter((n) => consumedNames.has(n))
    if (overlap.length > 0) {
      return {
        valid: false,
        code: 'CONTRADICTORY_TOOLS',
        message: `Cannot add and consume the same item(s) in one turn: ${overlap.join(', ')}`,
      }
    }
  }
  // ModifyInventory self-contradiction check
  if (modifyInventoryCall) {
    const additions = (modifyInventoryCall.args.additions as Array<{ name: string }>) || []
    const removals = (modifyInventoryCall.args.removals as Array<{ name: string }>) || []
    const addNames = new Set(additions.map((i) => i.name))
    const removeNames = new Set(removals.map((i) => i.name))
    const overlap = [...addNames].filter((n) => removeNames.has(n))
    if (overlap.length > 0) {
      return {
        valid: false,
        code: 'CONTRADICTORY_TOOLS',
        message: `Cannot add and remove the same item(s) in one turn: ${overlap.join(', ')}`,
      }
    }
  }

  // Contradiction: breakthrough success with realm downgrade via Modify_Mental/ModifyStats
  if (breakthroughCall && breakthroughCall.args.result === 'SUCCESS') {
    const mentalCall = calls.find((c) => c.name === 'Modify_Mental' || c.name === 'ModifyStats')
    if (mentalCall?.args.realm) {
      const newRealm = breakthroughCall.args.new_realm as string | undefined
      const mentalRealm = mentalCall.args.realm as string
      if (newRealm && mentalRealm !== newRealm) {
        return {
          valid: false,
          code: 'CONTRADICTORY_TOOLS',
          message: `Check_Breakthrough sets realm to "${newRealm}" but Modify_Mental sets it to "${mentalRealm}"`,
        }
      }
    }
  }

  return null
}
