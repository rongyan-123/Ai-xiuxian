/**
 * Tool Catalog — complete registry of all tools in the game Agent system.
 *
 * Five categories with explicit boundaries:
 *   1. PerceptionQuery  — LLM reads world state (read-only, ephemeral)
 *   2. WorldAction      — LLM writes world state (must pass capability gate)
 *   3. NpcBehavior      — NPC LLM thinks/plans/speaks (cannot write world)
 *   4. NarrativeOutput  — LLM direct text to player (not a tool, output format)
 *   5. UiPanel          — Player clicks UI, frontend reads state (not Agent)
 *
 * Every tool definition carries metadata for the Agent harness:
 *   - who can invoke it
 *   - whether it needs the capability gate
 *   - ephemeral retention policy
 *   - whether it's parallel-safe (can run concurrently with others)
 *
 * EXTENSIBILITY: All interfaces use `metadata?: Record<string, unknown>` for
 * future attributes. New tool categories can be added via module augmentation.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Base Types
// ═══════════════════════════════════════════════════════════════════════════

/** Who is allowed to call this tool */
export type CallerRole = 'game_master' | 'llm_npc' | 'statemachine_npc'

/** Ephemeral retention policy for tool results in Agent context */
export type EphemeralPolicy =
  | { mode: 'keep' }                          // permanent — stays in conversation
  | { mode: 'last_n'; count: number }          // keep last N results of this tool
  | { mode: 'current_turn' }                   // discard at turn end
  | { mode: 'single_use' }                     // discard after next LLM response

/** Gate requirement level */
export type GateLevel =
  | 'none'            // no gate — read-only tools
  | 'validate'        // validate args only, never block
  | 'enforce'         // full gate — can block/modify

/** Execution safety for parallel tool execution */
export type ExecutionSafety =
  | 'readonly'        // safe to run concurrently with any tool
  | 'readonly_scoped' // safe with other readonly, not with writes in same scope
  | 'write'           // must run sequentially after all reads complete

// ═══════════════════════════════════════════════════════════════════════════
// Tool Definition Base Interface
// ═══════════════════════════════════════════════════════════════════════════

export interface ToolDefinition {
  /** Unique tool name — what the LLM sees in function calling */
  name: string
  /** Human-readable description — fed to LLM as tool description */
  description: string
  /** Which category this tool belongs to */
  category: ToolCategory
  /** Who is allowed to call this tool */
  allowedCallers: CallerRole[]
  /** Capability gate requirement */
  gate: GateLevel
  /** How tool results are retained in Agent context */
  ephemeral: EphemeralPolicy
  /** Parallel execution safety classification */
  execution: ExecutionSafety
  /** Zod schema name (references TOOL_SCHEMAS in tool-schemas.ts) */
  schemaRef?: string
  /** Extensible metadata for future attributes */
  metadata?: Record<string, unknown>
}

// ═══════════════════════════════════════════════════════════════════════════
// Tool Categories
// ═══════════════════════════════════════════════════════════════════════════

export const TOOL_CATEGORIES = [
  'perception_query',
  'world_action',
  'npc_behavior',
  'narrative_output',
  'ui_panel',
] as const

export type ToolCategory = (typeof TOOL_CATEGORIES)[number]

// ═══════════════════════════════════════════════════════════════════════════
// 1. PERCEPTION QUERY TOOLS (感知查询)
//    LLM reads world. Read-only. Ephemeral=current_turn. No gate.
// ═══════════════════════════════════════════════════════════════════════════

export interface PerceptionQueryTool extends ToolDefinition {
  category: 'perception_query'
  gate: 'none'
  ephemeral: { mode: 'current_turn' }
  execution: 'readonly'
}

/** Search a specific area/zone for items, creatures, NPCs, or hazards */
export const SEARCH_AREA: PerceptionQueryTool = {
  name: 'SearchArea',
  description: `探查当前区域。返回该区域的物品、生物、NPC、危险。
使用时机：进入新区域后、感知到异常时、玩家要求观察环境时。
注意：结果仅本轮有效。区域状态可能因时间/NPC行动而变化。`,
  category: 'perception_query',
  allowedCallers: ['game_master', 'llm_npc'],
  gate: 'none',
  ephemeral: { mode: 'current_turn' },
  execution: 'readonly',
  metadata: {
    params: {
      zone: { type: 'string', required: false, description: '探查范围：外围/中围/核心/全局，默认外围' },
      type: { type: 'string', required: false, description: '过滤类型：灵草/矿物/生物/NPC/全部，默认全部' },
    },
    returns: {
      zone: 'string',
      items: 'Array<{name: string, grade: string, count: number, description: string}>',
      creatures: 'Array<{name: string, realm: string, hostility: string, description: string}>',
      npcs: 'Array<{name: string, role: string, status: string}>',
      hazards: 'Array<{type: string, severity: string, description: string}>',
      atmosphere: 'string',
    },
  },
}

/** Examine a specific object/target in detail */
export const EXAMINE_OBJECT: PerceptionQueryTool = {
  name: 'ExamineObject',
  description: `详细检视目标。返回物品品质/药力/状态、生物伤势/修为/情绪等详细信息。
使用时机：发现物品后判断价值、遇到生物后评估威胁、查看机关或阵法时。`,
  category: 'perception_query',
  allowedCallers: ['game_master', 'llm_npc'],
  gate: 'none',
  ephemeral: { mode: 'current_turn' },
  execution: 'readonly',
  metadata: {
    params: {
      target: { type: 'string', required: true, description: '要检视的目标名称或描述' },
    },
    returns: {
      name: 'string',
      type: 'string',
      quality: 'string',
      description: 'string',
      details: 'Record<string, unknown>',
    },
  },
}

/** Sense danger in the vicinity */
export const SENSE_DANGER: PerceptionQueryTool = {
  name: 'SenseDanger',
  description: `感知附近的危险。返回威胁列表和强度评估。
使用时机：进入陌生区域后、气氛描述有异常时、玩家要求警戒时。
注意：低修为可能感知不到高阶隐匿威胁。`,
  category: 'perception_query',
  allowedCallers: ['game_master', 'llm_npc'],
  gate: 'none',
  ephemeral: { mode: 'current_turn' },
  execution: 'readonly',
  metadata: {
    params: {
      radius: { type: 'string', required: false, description: '感知半径：近/中/远，默认近。越远精度越低。' },
    },
    returns: {
      threats: 'Array<{type: string, distance: string, estimatedRealm: string, confidence: string}>',
      overallLevel: 'string',
      warningSignals: 'string[]',
    },
  },
}

/** Check an NPC's current state */
export const CHECK_NPC_STATE: PerceptionQueryTool = {
  name: 'CheckNpcState',
  description: `查询指定NPC的当前状态。返回位置、行为、情绪、对玩家的态度、记忆摘要。
使用时机：与NPC互动前、追踪NPC下落、判断NPC是否可信时。
注意：只能查到公开信息和玩家已知信息。NPC的隐藏动机不可查。`,
  category: 'perception_query',
  allowedCallers: ['game_master', 'llm_npc'],
  gate: 'none',
  ephemeral: { mode: 'current_turn' },
  execution: 'readonly',
  metadata: {
    params: {
      npcId: { type: 'string', required: true, description: 'NPC标识' },
    },
    returns: {
      name: 'string',
      role: 'string',
      realm: 'string',
      currentActivity: 'string',
      location: 'string',
      mood: 'string',
      attitudeToPlayer: 'number',
      memoryDigest: 'string',
      publicInfo: 'Record<string, unknown>',
    },
  },
}

/** Query macro-level region information */
export const QUERY_REGION: PerceptionQueryTool = {
  name: 'QueryRegion',
  description: `查询区域的宏观信息。返回势力分布、近期事件、流言、商业行情等。
使用时机：了解大局、规划行程、打探消息时。
注意：情报可能有滞后或偏差，取决于信息传播速度。`,
  category: 'perception_query',
  allowedCallers: ['game_master'],
  gate: 'none',
  ephemeral: { mode: 'current_turn' },
  execution: 'readonly',
  metadata: {
    params: {
      region: { type: 'string', required: true, description: '区域名称' },
      aspects: { type: 'string[]', required: false, description: '关注的方面：势力/事件/流言/行情，默认全部' },
    },
    returns: {
      region: 'string',
      factions: 'Array<{name: string, influence: string, status: string}>',
      recentEvents: 'Array<{event: string, impact: string}>',
      rumors: 'string[]',
      marketConditions: 'Record<string, string>',
    },
  },
}

/** Search entity memory (player or NPC) */
export const RECALL_MEMORY: PerceptionQueryTool = {
  name: 'RecallMemory',
  description: `搜索玩家或NPC的记忆。返回相关记忆片段。
使用时机：NPC回忆过去的事、判定NPC是否知道某件事、检查玩家历史行为。
注意：搜索范围受限于目标的知识范围。玩家不能查NPC的记忆（除非搜魂等特殊能力）。`,
  category: 'perception_query',
  allowedCallers: ['game_master', 'llm_npc'],
  gate: 'none',
  ephemeral: { mode: 'current_turn' },
  execution: 'readonly',
  metadata: {
    params: {
      query: { type: 'string', required: true, description: '搜索关键词或语义查询' },
      target: { type: 'string', required: false, description: '搜索目标：player/npc_id，默认当前实体' },
    },
    returns: {
      results: 'Array<{content: string, timestamp: number, importance: number, relevance: number}>',
      totalFound: 'number',
    },
  },
}

/** Quick surroundings snapshot — no filter, cheapest perception call */
export const LOOK_AROUND: PerceptionQueryTool = {
  name: 'LookAround',
  description: `快速查看当前所在位置的基本信息。不消耗太多注意力。
使用时机：刚进入新地点、需要快速确认环境时。
与SearchArea的区别：LookAround是粗粒度快照，SearchArea是细粒度搜索。`,
  category: 'perception_query',
  allowedCallers: ['game_master', 'llm_npc'],
  gate: 'none',
  ephemeral: { mode: 'current_turn' },
  execution: 'readonly',
  metadata: {
    params: {},
    returns: {
      location: 'string',
      visibleExits: 'string[]',
      presentNpcs: 'Array<{name: string, role: string}>',
      notableFeatures: 'string[]',
      timeOfDay: 'string',
      weather: 'string',
    },
  },
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. WORLD ACTION TOOLS (世界行动)
//    LLM writes world state. MUST pass capability gate. Game Master only.
// ═══════════════════════════════════════════════════════════════════════════

export interface WorldActionTool extends ToolDefinition {
  category: 'world_action'
  gate: 'enforce'
  allowedCallers: ['game_master']
  ephemeral: { mode: 'keep' }
}

/** Move an entity to a new location */
export const CHANGE_LOCATION: WorldActionTool = {
  name: 'ChangeLocation',
  description: `移动实体到新位置。触发行程时间计算和途中事件判定。
只能在合理距离内移动。远距离移动会自动分段并可能触发中途事件。`,
  category: 'world_action',
  allowedCallers: ['game_master'],
  gate: 'enforce',
  ephemeral: { mode: 'keep' },
  execution: 'write',
  metadata: {
    params: {
      who: { type: 'string', required: false, description: '谁移动：player/npc_id，默认player' },
      to: { type: 'string', required: true, description: '目标位置名称' },
      method: { type: 'string', required: false, description: '移动方式：步行/御剑/传送/骑乘，默认步行' },
    },
    returns: {
      from: 'string',
      to: 'string',
      distance: 'string',
      timeCost: 'number',
      events: 'Array<{type: string, description: string}>',
    },
    // HACK: gateRules仅为文档描述，未在运行时强制执行。Phase 2接入capabilityGate后生效。2026-07-24
    gateRules: [
      '禁止进入的区域：禁地、未开放区域',
      '境界限制：某些区域需要最低修为',
      '状态限制：重伤/濒死状态限制移动距离',
    ],
  },
}

/** Modify character stats (HP, MP, spirit, etc.) */
export const MODIFY_STATS: WorldActionTool = {
  name: 'ModifyStats',
  description: `修改角色属性值。造成伤害、治疗、灵力消耗、修为提升等。
伤害计算必须考虑护盾、防御、抗性。治疗不能超过最大值。`,
  category: 'world_action',
  allowedCallers: ['game_master'],
  gate: 'enforce',
  ephemeral: { mode: 'keep' },
  execution: 'write',
  metadata: {
    params: {
      who: { type: 'string', required: false, description: '目标：player/npc_id，默认player' },
      hp_change: { type: 'number', required: false },
      mp_change: { type: 'number', required: false },
      spirit_change: { type: 'number', required: false },
      shield_change: { type: 'number', required: false },
      experience_change: { type: 'number', required: false },
    },
    returns: {
      before: 'StatsSnapshot',
      after: 'StatsSnapshot',
      deltas: 'Record<string, number>',
    },
    gateRules: [
      'HP变化必须在当前可能范围（伤害≤剩余HP+护盾，治疗≤最大HP-当前HP）',
      'MP消耗不能超过当前MP',
      '修为提升需要突破判定，不能直接修改realm',
      '死亡判定：HP≤0时触发死亡流程，不能绕过',
    ],
  },
}

/** Modify entity inventory */
export const MODIFY_INVENTORY: WorldActionTool = {
  name: 'ModifyInventory',
  description: `修改实体物品栏。添加/移除物品。
交易、掉落、消耗、赠送等所有物品转移都走这个接口。`,
  category: 'world_action',
  allowedCallers: ['game_master'],
  gate: 'enforce',
  ephemeral: { mode: 'keep' },
  execution: 'write',
  metadata: {
    params: {
      who: { type: 'string', required: false, description: '目标：player/npc_id，默认player' },
      additions: { type: 'Array<{name, type, grade, count: number, description?}>', required: false },
      removals: { type: 'Array<{name, count: number}>', required: false },
      reason: { type: 'string', required: false, description: '变动原因（交易/掉落/消耗/赠送）' },
    },
    returns: {
      added: 'Array<{name: string, count: number}>',
      removed: 'Array<{name: string, count: number}>',
      overflow: 'Array<{name: string, count: number}>',  // 背包满了装不下的
    },
    gateRules: [
      '移除物品时必须有且数量足够',
      '背包容量限制，超量物品进入overflow',
      '绑定物品不可交易/丢弃',
    ],
  },
}

/** Update relationship between two entities */
export const UPDATE_RELATIONSHIP: WorldActionTool = {
  name: 'UpdateRelationship',
  description: `更新两个实体之间的关系值。影响NPC对玩家的态度、对话选项、交易价格等。
关系值范围通常为-100到+100。`,
  category: 'world_action',
  allowedCallers: ['game_master'],
  gate: 'enforce',
  ephemeral: { mode: 'keep' },
  execution: 'write',
  metadata: {
    params: {
      entityA: { type: 'string', required: true, description: '实体A' },
      entityB: { type: 'string', required: true, description: '实体B' },
      delta: { type: 'number', required: true, description: '变化量，正=好感上升' },
      reason: { type: 'string', required: false, description: '原因（影响后续NPC记忆）' },
    },
    returns: {
      previous: 'number',
      current: 'number',
      statusChange: 'string | null',
    },
    gateRules: [
      'delta不能超过单次交互的合理范围（±30以内）',
      '极端事件（救命/背叛）可以突破上限',
    ],
  },
}

/** Trigger combat */
export const TRIGGER_COMBAT: WorldActionTool = {
  name: 'TriggerCombat',
  description: `触发战斗。战斗系统接管后续流程。
必须先通过SearchArea/SenseDanger确认敌方存在。不能凭空创建战斗。`,
  category: 'world_action',
  allowedCallers: ['game_master'],
  gate: 'enforce',
  ephemeral: { mode: 'keep' },
  execution: 'write',
  metadata: {
    params: {
      participants: { type: 'Array<{side: "a"|"b", entities: string[]}>', required: true },
      context: { type: 'string', required: true, description: '战斗起因（伏击/遭遇/挑战/自卫）' },
      environment: { type: 'string', required: false, description: '战场环境描述' },
    },
    returns: {
      combatId: 'string',
      combatMode: 'string',  // 回合制/实时，由系统决定
    },
    gateRules: [
      '所有参战实体必须存在于当前区域',
      '不能在同一回合重复触发同一战斗',
      '和平区域禁止战斗（坊市内）',
    ],
  },
}

/** Create a narrative situation */
export const CREATE_SITUATION: WorldActionTool = {
  name: 'CreateSituation',
  description: `创建一个叙事局面。局面是一种持续性的叙事状态，有开始→发展→结局。
用于追踪多回合的剧情线、NPC行动线、区域性事件。`,
  category: 'world_action',
  allowedCallers: ['game_master'],
  gate: 'enforce',
  ephemeral: { mode: 'keep' },
  execution: 'write',
  metadata: {
    params: {
      action: { type: 'string', required: true, description: '"create"（创建新局面）/ "update_status" / "end" / "add_outcome"' },
      title: { type: 'string', required: false },
      type: { type: 'string', required: false, description: '"conflict"|"exploration"|"social"|"opportunity"|"mystery"' },
      npcs: { type: 'string[]', required: false },
      player_goal: { type: 'string', required: false },
      possible_outcomes: { type: 'string[]', required: false },
      linked_situation: { type: 'string', required: false },
    },
    returns: {
      situation_id: 'string',
      status: 'string',
    },
  },
}

/** Resolve/end a situation */
export const RESOLVE_SITUATION: WorldActionTool = {
  name: 'ResolveSituation',
  description: `结局或更新一个叙事局面。局面到达自然结局点时使用。`,
  category: 'world_action',
  allowedCallers: ['game_master'],
  gate: 'enforce',
  ephemeral: { mode: 'keep' },
  execution: 'write',
  metadata: {
    params: {
      situation_id: { type: 'string', required: true },
      action: { type: 'string', required: true, description: '"update_status"|"end"|"add_outcome"' },
      status: { type: 'string', required: false },
      actual_outcome: { type: 'string', required: false },
    },
    returns: {
      situation_id: 'string',
      previous_status: 'string',
      new_status: 'string',
    },
  },
}

/** Create foreshadowing for future narrative */
export const CREATE_FORESHADOWING: WorldActionTool = {
  name: 'CreateForeshadowing',
  description: `埋设叙事伏笔。伏笔是跨越多个局面/回合的长期叙事线索。
当前不可见，但会在未来某时刻触发。`,
  category: 'world_action',
  allowedCallers: ['game_master'],
  gate: 'enforce',
  ephemeral: { mode: 'keep' },
  execution: 'write',
  metadata: {
    params: {
      title: { type: 'string', required: false },
      description: { type: 'string', required: false },
      related_situation: { type: 'string', required: false },
      resolved: { type: 'boolean', required: false },
      resolve_note: { type: 'string', required: false },
    },
    returns: {
      foreshadowingId: 'string',
    },
  },
}

/** Advance the world clock */
export const ADVANCE_TIME: WorldActionTool = {
  name: 'AdvanceTime',
  description: `消耗时间，推进世界时钟。所有玩家行动都应该消耗时间。
时间推进后：区域状态更新、NPC执行计划、日计划到期重新生成、触发定时事件。`,
  category: 'world_action',
  allowedCallers: ['game_master'],
  gate: 'enforce',
  ephemeral: { mode: 'keep' },
  execution: 'write',
  metadata: {
    params: {
      duration: { type: 'string', required: true, description: '时间长度："30m"/"2h"/"8h"/"1d"' },
      activity: { type: 'string', required: true, description: '这段时间在做什么（修炼/赶路/炼丹/休息）' },
    },
    returns: {
      timePassed: 'string',
      newTime: 'string',
      events: 'Array<{time: string, event: string, affected: string[]}>',
      playerStateChanges: 'Record<string, unknown>',
    },
    gateRules: [
      '修炼时间不能超过灵力/体力上限',
      '赶路时间由距离和移动方式决定，不能手动缩短',
      '时间推进开始后不能中断（横向执行保证一致性）',
    ],
  },
}

/** Generate NPCs into world */
export const GENERATE_NPC: WorldActionTool = {
  name: 'GenerateNpc',
  description: `生成新的NPC并写入世界状态。用于首次遇到某NPC时创建其实体。
只在NPC确实存在且玩家第一次接触时使用。`,
  category: 'world_action',
  allowedCallers: ['game_master'],
  gate: 'enforce',
  ephemeral: { mode: 'keep' },
  execution: 'write',
  metadata: {
    params: {
      npcs: { type: 'Array<{name, title?, realm: string, alignment: "正道"|"魔道"|"中立", sect, personality, relationship: number, description}>', required: true },
    },
    returns: {
      created: 'Array<{npcId: string, name: string}>',
    },
    gateRules: [
      '不能创建与已有NPC同名的实体',
      'NPC修为不能超出区域等级范围（高阶NPC需要特殊事件引入）',
    ],
  },
}

/** Generate a location */
export const GENERATE_LOCATION: WorldActionTool = {
  name: 'GenerateLocation',
  description: `生成新的地点并写入世界状态。发现新区域时使用。`,
  category: 'world_action',
  allowedCallers: ['game_master'],
  gate: 'enforce',
  ephemeral: { mode: 'keep' },
  execution: 'write',
  metadata: {
    params: {
      locations: { type: 'Array<{name, region, danger_level: "安全"|"低危"|"中危"|"高危"|"绝地", description, power_distribution, level_range, rules, peace_orno: "和平"|"冲突"|"战争"|"混乱", inhabitants: string[], bound_items: string[], bound_locations: string[]}>', required: true },
    },
    returns: {
      created: 'Array<{locationId: string, name: string}>',
    },
  },
}

/** Add journal entry */
export const ADD_JOURNAL_ENTRY: WorldActionTool = {
  name: 'AddJournalEntry',
  description: `写入玩家日志。记录重要事件、剧情转折、发现等。
日志是玩家的"冒险记录"，影响后续NPC对玩家的认知。`,
  category: 'world_action',
  allowedCallers: ['game_master'],
  gate: 'enforce',
  ephemeral: { mode: 'keep' },
  execution: 'write',
  metadata: {
    params: {
      title: { type: 'string', required: true },
      content: { type: 'string', required: true },
      entry_type: { type: 'string', required: false, description: '"story_start"|"major_twist"|"story_end"|"general"' },
    },
    returns: {
      journalId: 'string',
      timestamp: 'number',
    },
  },
}

/** Add codex entry */
export const ADD_CODEX_ENTRY: WorldActionTool = {
  name: 'AddCodexEntry',
  description: `写入典籍/图鉴条目。记录NPC、地点、物品、宗门等信息。
用于追踪玩家已知的世界信息。`,
  category: 'world_action',
  allowedCallers: ['game_master'],
  gate: 'enforce',
  ephemeral: { mode: 'keep' },
  execution: 'write',
  metadata: {
    params: {
      name: { type: 'string', required: true },
      entry_type: { type: 'string', required: true, description: '"npc"|"location"|"item"|"sect"' },
      description: { type: 'string', required: true },
      metadata: { type: 'Record<string, unknown>', required: false },
    },
    returns: {
      codexId: 'string',
    },
  },
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. NPC BEHAVIOR TOOLS (NPC行为)
//    NPC LLM thinks/plans/speaks. CANNOT modify world directly.
//    Gate: validate (check plan reasonability, never block dialogue)
// ═══════════════════════════════════════════════════════════════════════════

export interface NpcBehaviorTool extends ToolDefinition {
  category: 'npc_behavior'
  allowedCallers: ['llm_npc']
  gate: 'validate'
}

/** Generate NPC's daily plan */
export const GENERATE_DAILY_PLAN: NpcBehaviorTool = {
  name: 'GenerateDailyPlan',
  description: `为NPC生成今日的行动计划。基于角色设定、当前状态、区域约束、世界事件。
输出行动计划→由行为树分解执行。NPC不能在执行中直接改计划，除非遇到重大打断事件。`,
  category: 'npc_behavior',
  allowedCallers: ['llm_npc'],
  gate: 'validate',
  ephemeral: { mode: 'current_turn' },
  execution: 'readonly',
  metadata: {
    params: {},
    returns: {
      plans: 'Array<{action: string, location: string, timeSlot: string, priority: number, reason: string}>',
    },
    gateRules: [
      '计划不得包含NPC无法执行的行动（T2 NPC不能做只有T3能做的事）',
      '计划不得违反区域约束中的bound=true规则',
      '计划中的地点必须在NPC可达范围内',
    ],
  },
}

/** NPC decides reaction to an event */
export const DECIDE_REACTION: NpcBehaviorTool = {
  name: 'DecideReaction',
  description: `NPC对突发事件做出反应决策。输入事件描述，输出反应类型和对话提示。
不直接执行行动（行动由行为树执行）。`,
  category: 'npc_behavior',
  allowedCallers: ['llm_npc'],
  gate: 'validate',
  ephemeral: { mode: 'single_use' },
  execution: 'readonly',
  metadata: {
    params: {
      event: { type: 'string', required: true, description: '事件描述' },
      source: { type: 'string', required: false, description: '事件来源（player/npc_id/world）' },
    },
    returns: {
      reaction: 'string',
      emotion: 'string',
      actionHint: 'string',
      dialogueHint: 'string',
      relationshipDelta: 'number',
    },
  },
}

/** NPC forms a new memory */
export const FORM_MEMORY: NpcBehaviorTool = {
  name: 'FormMemory',
  description: `NPC形成一条新记忆。记忆写入NPC的外部记忆流存储，不留在对话上下文中。
包含重要性评分，影响后续检索优先级。`,
  category: 'npc_behavior',
  allowedCallers: ['llm_npc'],
  gate: 'validate',
  ephemeral: { mode: 'single_use' },
  execution: 'readonly',
  metadata: {
    params: {
      content: { type: 'string', required: true, description: '记忆内容' },
      importance: { type: 'number', required: false, description: '1-10重要性评分，默认5' },
      tags: { type: 'string[]', required: false, description: '标签（便于检索）' },
    },
    returns: {
      memoryId: 'string',
    },
  },
}

/** NPC generates dialogue */
export const GENERATE_DIALOGUE: NpcBehaviorTool = {
  name: 'GenerateDialogue',
  description: `NPC生成对话文本。基于NPC性格、当前情绪、对对方的态度、相关知识。
这是NPC的主要输出形式。对话文本会直接展示给玩家。`,
  category: 'npc_behavior',
  allowedCallers: ['llm_npc'],
  gate: 'validate',
  ephemeral: { mode: 'single_use' },
  execution: 'readonly',
  metadata: {
    params: {
      interlocutor: { type: 'string', required: true, description: '对话对象' },
      context: { type: 'string', required: false, description: '对话的上下文/话题' },
    },
    returns: {
      dialogueText: 'string',
      tone: 'string',
      hiddenIntent: 'string',
    },
    gateRules: [
      '不得泄露NPC不应知道的信息（知识气泡约束）',
      '不得违反角色设定（Trait约束）',
    ],
  },
}

/** NPC self-reflection (T3 only) */
export const SELF_REFLECTION: NpcBehaviorTool = {
  name: 'SelfReflection',
  description: `NPC进行自我反思。分析近期经历、更新自我认知、可能修改constraint_bindings。
仅T3 NPC可用。低频操作（每几天1次，或重大事件后触发）。`,
  category: 'npc_behavior',
  allowedCallers: ['llm_npc'],
  gate: 'validate',
  ephemeral: { mode: 'single_use' },
  execution: 'readonly',
  metadata: {
    params: {},
    returns: {
      insights: 'string[]',
      bindingChanges: 'Array<{ruleId: string, oldValue: boolean, newValue: boolean, reason: string}>',
      goalAdjustments: 'string[]',
    },
    tierRestriction: 'T3 only',
  },
}

// ═══════════════════════════════════════════════════════════════════════════
// 2.5 EXTENDED WORLD ACTION TOOLS (rule-engine compatibility)
//    These are tools that the rule engine handles but weren't in the
//    original 25-tool catalog. Added for backward compatibility.
// ═══════════════════════════════════════════════════════════════════════════

/** Modify techniques (combat, movement, support) */
export const MODIFY_TECHNIQUES: WorldActionTool = {
  name: 'ModifyTechniques',
  description: `修改角色的功法/技能。添加、升级或移除战斗技能、身法、辅助功法。`,
  category: 'world_action',
  allowedCallers: ['game_master'],
  gate: 'enforce',
  ephemeral: { mode: 'keep' },
  execution: 'write',
  metadata: {
    params: {
      main: { type: 'string', required: false, description: '主修功法' },
      add_combat: { type: 'string', required: false },
      remove_combat: { type: 'string', required: false },
      movement: { type: 'string', required: false },
      add_support: { type: 'string', required: false },
      remove_support: { type: 'string', required: false },
    },
    returns: {
      techniques: 'Techniques',
    },
  },
}

/** Modify traits and talents */
export const MODIFY_TRAITS: WorldActionTool = {
  name: 'ModifyTraits',
  description: `修改角色的天赋和特质。添加或移除天赋、性格特质。`,
  category: 'world_action',
  allowedCallers: ['game_master'],
  gate: 'enforce',
  ephemeral: { mode: 'keep' },
  execution: 'write',
  metadata: {
    params: {
      add_talents: { type: 'string[]', required: false },
      remove_talents: { type: 'string[]', required: false },
      add_traits: { type: 'string[]', required: false },
      remove_traits: { type: 'string[]', required: false },
    },
    returns: {
      talents: 'string[]',
      traits: 'string[]',
    },
  },
}

/** Attempt realm breakthrough */
export const CHECK_BREAKTHROUGH: WorldActionTool = {
  name: 'CheckBreakthrough',
  description: `尝试境界突破。根据角色当前修为和条件，判定突破是否成功。
  成功后提升境界，失败可能修为倒退或走火入魔。`,
  category: 'world_action',
  allowedCallers: ['game_master'],
  gate: 'enforce',
  ephemeral: { mode: 'keep' },
  execution: 'write',
  metadata: {
    params: {
      result: { type: 'string', required: true, description: 'SUCCESS 或 FAIL' },
      new_realm: { type: 'string', required: false, description: '成功后新的境界名称' },
      realm_change: { type: 'string', required: false },
    },
    returns: {
      result: 'string',
      newRealm: 'string | null',
    },
  },
}

/** Generate a sect/clan */
export const GENERATE_SECT: WorldActionTool = {
  name: 'GenerateSect',
  description: `生成新的宗门/势力并写入世界状态。用于创建区域势力结构。`,
  category: 'world_action',
  allowedCallers: ['game_master'],
  gate: 'enforce',
  ephemeral: { mode: 'keep' },
  execution: 'write',
  metadata: {
    params: {
      sects: { type: 'Array<{name, alignment: "正道"|"魔道"|"中立", power_level, master, master_realm, description, specialties?}>', required: true },
    },
    returns: {
      created: 'Array<{name: string}>',
    },
  },
}

/** Generate a new item */
export const GENERATE_ITEM: WorldActionTool = {
  name: 'GenerateItem',
  description: `生成新物品并写入世界/背包。用于掉落、奖励、商店生成等。`,
  category: 'world_action',
  allowedCallers: ['game_master'],
  gate: 'enforce',
  ephemeral: { mode: 'keep' },
  execution: 'write',
  metadata: {
    params: {
      items: { type: 'Array<{name, type: "丹药"|"法宝"|"材料"|"功法"|"杂物"|"特殊物品", grade: "黄阶下品"|"黄阶中品"|"黄阶上品"|"玄阶下品"|"玄阶中品"|"玄阶上品"|"地阶下品"|"地阶中品"|"地阶上品"|"天阶下品"|"天阶中品"|"天阶上品"|"无", description, count: number, value: number, effects?}>', required: true },
    },
    returns: {
      created: 'Array<{name: string, type: string, grade: string}>',
    },
  },
}

// ═══════════════════════════════════════════════════════════════════════════
// Master Registry — all tool definitions in one place
// ═══════════════════════════════════════════════════════════════════════════

/** Complete registry of all tools exposed to LLM */
export const TOOL_REGISTRY: Record<string, ToolDefinition> = {
  // ── Perception Query ─────────────────────────────────────────────────
  SearchArea: SEARCH_AREA,
  ExamineObject: EXAMINE_OBJECT,
  SenseDanger: SENSE_DANGER,
  CheckNpcState: CHECK_NPC_STATE,
  QueryRegion: QUERY_REGION,
  RecallMemory: RECALL_MEMORY,
  LookAround: LOOK_AROUND,

  // ── World Action ─────────────────────────────────────────────────────
  ChangeLocation: CHANGE_LOCATION,
  ModifyStats: MODIFY_STATS,
  ModifyInventory: MODIFY_INVENTORY,
  UpdateRelationship: UPDATE_RELATIONSHIP,
  TriggerCombat: TRIGGER_COMBAT,
  CreateSituation: CREATE_SITUATION,
  ResolveSituation: RESOLVE_SITUATION,
  CreateForeshadowing: CREATE_FORESHADOWING,
  AdvanceTime: ADVANCE_TIME,
  GenerateNpc: GENERATE_NPC,
  GenerateLocation: GENERATE_LOCATION,
  AddJournalEntry: ADD_JOURNAL_ENTRY,
  AddCodexEntry: ADD_CODEX_ENTRY,
  ModifyTechniques: MODIFY_TECHNIQUES,
  ModifyTraits: MODIFY_TRAITS,
  CheckBreakthrough: CHECK_BREAKTHROUGH,
  GenerateSect: GENERATE_SECT,
  GenerateItem: GENERATE_ITEM,

  // ── NPC Behavior ─────────────────────────────────────────────────────
  GenerateDailyPlan: GENERATE_DAILY_PLAN,
  DecideReaction: DECIDE_REACTION,
  FormMemory: FORM_MEMORY,
  GenerateDialogue: GENERATE_DIALOGUE,
  SelfReflection: SELF_REFLECTION,
} as const

export type ToolName = keyof typeof TOOL_REGISTRY

// ═══════════════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════════════

/** Get tools available to a specific caller role */
export function getToolsForCaller(role: CallerRole): ToolDefinition[] {
  return Object.values(TOOL_REGISTRY).filter((t) =>
    t.allowedCallers.includes(role),
  )
}

/** Get tools in a specific category */
export function getToolsByCategory(category: ToolCategory): ToolDefinition[] {
  return Object.values(TOOL_REGISTRY).filter((t) => t.category === category)
}

/** Get tools that require capability gate enforcement */
export function getGatedTools(): ToolDefinition[] {
  return Object.values(TOOL_REGISTRY).filter((t) => t.gate === 'enforce')
}

/** Look up a single tool definition by name */
export function getToolDefinition(name: string): ToolDefinition | undefined {
  const key = name as keyof typeof TOOL_REGISTRY
  return TOOL_REGISTRY[key]
}

/** Build tool definitions for LLM API call (Anthropic/OpenAI format) */
export function toLlmToolDefinitions(tools: ToolDefinition[]): Array<{
  name: string
  description: string
  input_schema: Record<string, unknown>
}> {
  return tools.map((t) => {
    const raw = (t.metadata?.params as Record<string, unknown>) ?? { type: 'object', properties: {} }
    return {
      name: t.name,
      description: t.description,
      input_schema: normalizeJsonSchema(raw),
    }
  })
}

/**
 * Normalize internal schema to strict JSON Schema (Draft 2020-12).
 * - Moves per-property `required` flags to top-level `required` array
 * - Strips non-standard fields from property definitions
 * - Handles both raw props objects and {type, properties} wrapped schemas
 * - Expands Array<{...}> inline types into proper {type:"array", items:{...}} schemas
 */
function normalizeJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  // 只用 'properties' 判断是否 schema wrapper，避免属性名恰好是 'type' 时误判
  const hasSchemaWrapper = 'properties' in schema
  const props = hasSchemaWrapper
    ? (schema.properties as Record<string, Record<string, unknown>>)
    : (schema as Record<string, Record<string, unknown>>)

  if (!props || typeof props !== 'object') return schema

  const required: string[] = []
  const normalized: Record<string, Record<string, unknown>> = {}

  for (const [key, prop] of Object.entries(props)) {
    if (typeof prop !== 'object' || prop === null) {
      normalized[key] = prop
      continue
    }
    const { required: isRequired, ...rest } = prop
    if (isRequired === true) {
      required.push(key)
    }
    const entry = rest as Record<string, unknown>

    // 处理内联 Array<{...}> 语法 → 生成 items schema
    if (typeof entry.type === 'string') {
      const parsed = parseArrayType(entry.type as string)
      if (parsed) {
        entry.type = 'array'
        entry.items = parsed
      } else {
        entry.type = normalizeSchemaType(entry.type as string)
        // string[] / number[] → array with primitive items
        if (entry.type === 'array') {
          const primitiveItems = primitiveArrayItems(entry._originalType as string ?? entry.type as string)
          if (primitiveItems) {
            ;(entry as Record<string, unknown>).items = primitiveItems
          }
        }
      }
    }
    normalized[key] = entry
  }

  // 只有 schema wrapper 的 type 才可信；raw props 对象里的 "type" 是属性名
  const schemaType = hasSchemaWrapper ? ((schema.type as string) ?? 'object') : 'object'
  const result: Record<string, unknown> = {
    type: schemaType,
    properties: normalized,
  }

  if (required.length > 0) {
    result.required = required
  }

  if ('additionalProperties' in schema) {
    result.additionalProperties = schema.additionalProperties
  }

  return result
}

/**
 * Parse Array<{field1, field2?, field3: type}> inline syntax into
 * JSON Schema { type: 'object', properties: {...}, required: [...] }.
 * Returns null if the type string doesn't match this pattern.
 */
function parseArrayType(typeStr: string): Record<string, unknown> | null {
  const match = typeStr.match(/^Array<\{(.+)\}>$/)
  if (!match) return null

  const fieldsStr = match[1]
  const fields = fieldsStr.split(',').map((f) => f.trim()).filter(Boolean)
  const properties: Record<string, Record<string, unknown>> = {}
  const required: string[] = []

  for (const field of fields) {
    let name = field
    let fieldType = 'string'
    let rawType = 'string'
    let isOptional = false

    // Handle ? (optional)
    if (name.endsWith('?')) {
      name = name.slice(0, -1)
      isOptional = true
    }

    // Handle : type annotation
    if (name.includes(':')) {
      const parts = name.split(':')
      name = parts[0].trim()
      rawType = parts.slice(1).join(':').trim()
      // Clean up quotes around enum values like "a"|"b"
      const cleanType = rawType.replace(/"([^"]+)"/g, '$1')
      if (cleanType.includes('|')) {
        fieldType = 'string'
        const enums = cleanType.split('|').map((e) => e.trim())
        properties[name] = { type: 'string', enum: enums } as Record<string, unknown>
        if (!isOptional) required.push(name)
        continue
      }
      fieldType = mapInlineType(cleanType)
    }

    if (!isOptional) required.push(name)
    const propDef: Record<string, unknown> = { type: fieldType }
    // 数组类型补充 items
    if (fieldType === 'array' && !isOptional) {
      // string[] → items: { type: 'string' }; number[] → items: { type: 'number' }
      propDef.items = { type: rawType === 'number[]' ? 'number' : 'string' }
    }
    properties[name] = propDef
  }

  const itemSchema: Record<string, unknown> = {
    type: 'object',
    properties,
  }
  if (required.length > 0) {
    itemSchema.required = required
  }
  return itemSchema
}

function mapInlineType(t: string): string {
  if (t === 'string[]') return 'array'
  if (t === 'number[]') return 'array'
  if (t.startsWith('Array<')) return 'array'
  if (t === 'number') return 'number'
  if (t === 'boolean') return 'boolean'
  return 'string'
}

function primitiveArrayItems(originalType: string): Record<string, unknown> | null {
  if (originalType === 'string[]') return { type: 'string' }
  if (originalType === 'number[]') return { type: 'number' }
  if (originalType === 'boolean[]') return { type: 'boolean' }
  return null
}

/** 将 TS 风格的类型简写转为 JSON Schema 合法类型 */
function normalizeSchemaType(type: string): string {
  // 数组简写
  if (type === 'string[]') return 'array'
  if (type === 'number[]') return 'array'
  if (type === 'boolean[]') return 'array'
  if (type.startsWith('Array<')) return 'array'
  // 非标准类型 → object
  if (type === 'Record<string, unknown>') return 'object'
  if (type === 'StatsSnapshot') return 'object'
  if (type === 'Techniques') return 'object'
  // 标准 JSON Schema 类型直接返回
  if (['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'].includes(type)) return type
  // 默认当作 object
  return 'object'
}
