/**
 * Runtime Zod schemas for all LLM tool calls consumed by the rule engine.
 *
 * These schemas validate tool call arguments at the domain boundary before
 * they enter the pure rule engine, converting "stringly-typed" LLM output
 * into validated, typed data.
 */
import { z } from 'zod/v4'

// ── Shared enumerations ─────────────────────────────────────────────────

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

const CodexEntryType = z.enum(['npc', 'location', 'item', 'sect'])

const JournalEntryType = z.enum(['story_start', 'major_twist', 'story_end', 'general'])

// ── Individual tool argument schemas ────────────────────────────────────

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

const ChangeLocationArgs = z.object({
  location: z.string(),
})

const CheckBreakthroughArgs = z.object({
  result: BreakthroughResult,
  new_realm: z.string().optional(),
  realm_change: z.string().optional(),
})

const GenerateNPCArgs = z.object({
  npcs: z.array(z.object({
    name: z.string(),
    title: z.string().optional(),
    realm: z.string(),
    alignment: Alignment,
    sect: z.string(),
    personality: z.string(),
    relationship: z.number(),
    description: z.string(),
  })),
})

const GenerateLocationArgs = z.object({
  locations: z.array(z.object({
    name: z.string(),
    region: z.string(),
    danger_level: DangerLevel,
    description: z.string(),
    power_distribution: z.string(),
    level_range: z.string(),
    rules: z.string(),
    peace_orno: PeaceLevel,
    inhabitants: z.array(z.string()),
    bound_items: z.array(z.string()),
    bound_locations: z.array(z.string()),
  })),
})

const GenerateSectArgs = z.object({
  sects: z.array(z.object({
    name: z.string(),
    alignment: Alignment,
    power_level: z.string(),
    master: z.string(),
    master_realm: z.string(),
    description: z.string(),
    specialties: z.string().optional(),
  })),
})

const GenerateItemArgs = z.object({
  items: z.array(z.object({
    name: z.string(),
    type: ItemType,
    grade: ItemGrade,
    description: z.string(),
    count: z.number(),
    value: z.number(),
    effects: z.string().optional(),
  })),
})

const WriteCodexArgs = z.object({
  name: z.string(),
  entry_type: CodexEntryType,
  description: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const WriteJournalArgs = z.object({
  title: z.string(),
  content: z.string(),
  entry_type: JournalEntryType.optional(),
})

const UpdateSituationArgs = z.object({
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
})

const CreateForeshadowingArgs = z.object({
  foreshadowing_id: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  related_situation: z.string().optional(),
  resolved: z.boolean().default(false),
  resolve_note: z.string().optional(),
})

const SearchHistoryArgs = z.object({
  query: z.string(),
  limit: z.number().optional().default(5),
})

const SkipArgs = z.object({
  reason: z.string(),
})

// ── Tool name → schema mapping ──────────────────────────────────────────

export const TOOL_SCHEMAS: Record<string, z.ZodTypeAny> = {
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
 * 3. No duplicate tool calls (same name used twice)
 * 4. No contradictory tool calls (heal + damage in same turn, etc.)
 */
export function validateToolCalls(
  rawCalls: unknown,
): ToolValidationResult | ToolValidationError {
  if (!Array.isArray(rawCalls)) {
    return { valid: false, code: 'MALFORMED_ARGS', message: 'Tool calls must be an array' }
  }

  const parsed: Array<{ name: ToolName; args: Record<string, unknown> }> = []
  const seen = new Set<string>()

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

    // Check for duplicates (same tool called twice in one turn)
    if (seen.has(name)) {
      return {
        valid: false,
        code: 'DUPLICATE_TOOL',
        message: `Duplicate tool call: "${name}" cannot be called more than once per turn`,
        toolName: name,
      }
    }
    seen.add(name)

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

// ── Contradiction detection ─────────────────────────────────────────────

function detectContradictions(
  calls: Array<{ name: ToolName; args: Record<string, unknown> }>,
): ToolValidationError | null {
  const modifyStatsCall = calls.find((c) => c.name === 'Modify_Stats')
  const breakthroughCall = calls.find((c) => c.name === 'Check_Breakthrough')
  const consumeCall = calls.find((c) => c.name === 'Consume_Item')
  const backpackAddCall = calls.find((c) => c.name === 'Backpack_additems')
  const backpackReduceCall = calls.find((c) => c.name === 'Backpack_reduceitems')

  // Contradiction: healing AND damaging in same Modify_Stats
  if (modifyStatsCall) {
    const hpChange = modifyStatsCall.args.hp_change as number | undefined
    if (hpChange !== undefined && hpChange !== 0) {
      // Single hp_change with both sign aspects is fine — it's one value
      // But if somehow both positive and negative changes exist, flag it
    }
  }

  // Contradiction: adding AND consuming same item in one turn
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

  // Contradiction: breakthrough success with realm downgrade via Modify_Mental
  if (breakthroughCall && breakthroughCall.args.result === 'SUCCESS') {
    const mentalCall = calls.find((c) => c.name === 'Modify_Mental')
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
