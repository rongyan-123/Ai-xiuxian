export type GradeTier = '天' | '地' | '玄' | '黄'
export type GradeLevel = '上' | '中' | '下'
export type ItemGrade = `${GradeTier}阶${GradeLevel}品` | '无'
export type IntentType = 'NONE' | 'REWARD' | 'PENALTY' | 'COMBAT'

export interface T1Npc {
  id: string
  name: string
  title?: string
  realm: string
  currentLocation: string
  alignment: '正道' | '魔道' | '中立'
  sect: string
  personality: string
  relationship: number
  dialogueTemplates: Record<string, string[]>
  description: string
  createdAt: number
  /** NPC日程表（可选，T2+ NPC由种子数据设置） */
  schedule?: NpcScheduleSlot[]
  /** 知识气泡：此NPC目击的事件列表 */
  knowledge?: KnowledgeRecord[]
  /** 特性参数（可选，影响行为） */
  traits?: Record<string, number>
}

export interface NpcScheduleSlot {
  startHour: number
  endHour: number
  activity: string
  location: string
  interactable: boolean
}

export interface KnowledgeRecord {
  eventType: 'player_action' | 'npc_action' | 'world_event'
  description: string
  location: string
  timestamp: number
  witnesses: string[]
  publicKnowledge: boolean
}

export interface IPlayer {
  id: string
  status: 'ALIVE' | 'DEAD'
  name: string
  gender: string
  stats: ICharacterStats
  inventory: IInventoryItem[]
  codex: CodexEntry[]
  relationships: IRelationships
  worldTime: number
  currentLocation: string
  npcs: T1Npc[]
}

export interface ICharacterStats {
  hp: { current: number; max: number; status_desc: string }
  mp: { current: number; max: number; status_desc: string }
  spirit: { value: number; desc: string }
  realm: string
  age: { current: number; max: number }
  race: string
  alignment: '正道' | '魔道' | '中立'
  sect: string
  spiritual_root: string

  mental_state: string
  reputation: number
  emotion?: string
  state_of_mind?: number
  fortune?: number
  karma?: number
  techniques?: {
    main: string
    combat: string[]
    movement: string
    support: string[]
  }
  shield?: { current: number; max: number }
  talents?: string[]
  traits?: string[]
}

export interface IInventoryItem {
  id: string
  name: string
  grade: ItemGrade
  type: string
  description: string
  count: number
  value: number
}

export interface IRelationships {
  [key: string]: number
}

export interface IChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  thinking?: string
  timestamp: number
  error?: boolean
  userInput?: string
}


export interface JournalEntry {
  id: string
  title: string
  content: string
  entry_type: string
  timestamp: number
}

export interface CodexEntry {
  id: string
  name: string
  entry_type: string
  description: string
  metadata: Record<string, any>
  timestamp: number
}

export type SituationType = 'conflict' | 'exploration' | 'social' | 'opportunity' | 'mystery'
export type SituationStatus = 'brewing' | 'climax' | 'resolution' | 'ended'

export interface Situation {
  id: string
  title: string
  type: SituationType
  trigger: string
  npcs: string[]
  player_goal: string
  possible_outcomes: string[]
  actual_outcome?: string
  linked_foreshadowing: string[]
  linked_situation: string | null
  status: SituationStatus
  startTurn: number
  endTurn?: number
  updatedAt: number
}

export interface Foreshadowing {
  id: string
  title: string
  description: string
  related_situation: string
  plantedTurn: number
  resolvedTurn?: number
  resolved: boolean
}