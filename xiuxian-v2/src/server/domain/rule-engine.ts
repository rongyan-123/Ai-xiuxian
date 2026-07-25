/**
 * Pure domain rule engine.
 *
 * Evaluates validated LLM tool calls against immutable game state, returning
 * new state, domain events (deltas), and the input relationships reference
 * (mutated in-place for compatibility — see task 5.3 for repair).
 *
 * This module is side-effect-free when provided with deterministic `now` and
 * `random` functions. The default wrappers use the real Date.now/Math.random
 * for backward compatibility with existing route handlers.
 */
import type { ICharacterStats, IInventoryItem, Situation, Foreshadowing, T1Npc } from '@/types'
import { createT1Npc, getNpcsAtLocation } from './npc-engine'
import { getActiveNpcsAtLocation, formatNpcPresence } from './npc-activity'

export interface RuleEngineResult {
  stats: ICharacterStats
  inventory: IInventoryItem[]
  codex: CodexEntry[]
  relationships: Record<string, number>
  situations: Situation[]
  foreshadowings: Foreshadowing[]
  deltas: Record<string, unknown>
  worldTime: number
  currentLocation: string
  npcs: T1Npc[]
}

interface CodexEntry {
  id: string
  name: string
  entry_type: string
  description: string
  metadata: Record<string, unknown>
  timestamp: number
}

export interface RuleEngineDeps {
  now(): number
  random(): string
}

const defaultDeps: RuleEngineDeps = {
  now: () => Date.now(),
  random: () => Math.random().toString(36).substr(2, 5),
}

export function processRuleEngine(
  toolCalls: Array<{ name: string; args?: Record<string, unknown> }>,
  stats: ICharacterStats,
  inventory: IInventoryItem[],
  codex: CodexEntry[],
  relationships: Record<string, number>,
  situations: Situation[],
  foreshadowings: Foreshadowing[],
  deps: Partial<RuleEngineDeps> = {},
  worldTime: number = Date.now(),
  currentLocation: string = '新手村',
  npcs: T1Npc[] = [],
): RuleEngineResult {
  const { now, random } = { ...defaultDeps, ...deps }

  const newStats = { ...stats } as Record<string, unknown> & ICharacterStats
  const newInventory = [...inventory]
  const newCodex = [...(codex || [])]
  const newSituations = [...situations]
  const newForeshadowings = [...foreshadowings]
  const newNpcs = [...npcs]
  let newWorldTime = worldTime
  let newCurrentLocation = currentLocation
  const deltas: Record<string, unknown> = {}
  const turnEstimate = Math.max(1, situations.reduce((max, s) => Math.max(max, s.startTurn), 0) + 1)

  if (!newStats.hp)
    newStats.hp = { current: 100, max: 100, status_desc: '良好' }
  if (!newStats.mp) newStats.mp = { current: 50, max: 50, status_desc: '充沛' }
  if (!newStats.spirit) newStats.spirit = { value: 100, desc: '精神饱满' }
  if (!newStats.age) newStats.age = { current: 16, max: 100 }
  if (!newStats.shield) newStats.shield = { current: 0, max: 0 }

  for (const tc of toolCalls) {
    const args = tc.args || {} as Record<string, unknown>

    const wtRef = { value: newWorldTime }
    const locRef = { value: newCurrentLocation }
    evaluateToolCall(
      tc.name,
      args,
      newStats,
      newInventory,
      newCodex,
      relationships,
      newSituations,
      newForeshadowings,
      deltas,
      turnEstimate,
      now,
      random,
      wtRef,
      locRef,
      newNpcs,
    )
    newWorldTime = wtRef.value
    newCurrentLocation = locRef.value
  }

  return {
    stats: newStats as ICharacterStats,
    inventory: newInventory,
    codex: newCodex,
    relationships,
    situations: newSituations,
    foreshadowings: newForeshadowings,
    deltas,
    worldTime: newWorldTime,
    currentLocation: newCurrentLocation,
    npcs: newNpcs as T1Npc[],
  }
}

/** Matches original: Date.now().toString() + "-" + Math.random().toString(36).substr(2, 5) */
function generateItemId(now: () => number, random: () => string): string {
  return `${now().toString()}-${random()}`
}

/** Matches original: prefix + Date.now().toString(36) + Math.random().toString(36).substr(2, 5) */
function generateCodexId(prefix: string, now: () => number, random: () => string): string {
  return `${prefix}-${now().toString(36)}${random()}`
}

/** Normalize old tool names to canonical names (no-op for already-canonical names). */
function normalizeToolName(name: string): string {
  const ALIASES: Record<string, string> = {
    Backpack_additems: 'ModifyInventory',
    Backpack_reduceitems: 'ModifyInventory',
    Consume_Item: 'ConsumeItem',
    Modify_Stats: 'ModifyStats',
    Modify_Techniques: 'ModifyTechniques',
    Modify_Traits: 'ModifyTraits',
    Modify_Mental: 'ModifyStats',
    Update_Relationship: 'UpdateRelationship',
    Change_Location: 'ChangeLocation',
    Check_Breakthrough: 'CheckBreakthrough',
    Generate_NPC: 'GenerateNpc',
    Generate_Location: 'GenerateLocation',
    Generate_Sect: 'GenerateSect',
    Generate_Item: 'GenerateItem',
    Write_Codex: 'AddCodexEntry',
    Write_Journal: 'AddJournalEntry',
    Update_Situation: 'UpdateSituation',
    Create_Foreshadowing: 'CreateForeshadowing',
    Search_History: 'RecallMemory',
  }
  return ALIASES[name] ?? name
}

/** 去重添加：同名+同类型不重复 */
function addCodexEntry(
  codex: CodexEntry[],
  entry: CodexEntry,
): void {
  const exists = codex.some((e) => e.name === entry.name && e.entry_type === entry.entry_type)
  if (!exists) codex.push(entry)
}

function evaluateToolCall(
  name: string,
  args: Record<string, unknown>,
  newStats: Record<string, unknown> & ICharacterStats,
  newInventory: IInventoryItem[],
  newCodex: CodexEntry[],
  relationships: Record<string, number>,
  newSituations: Situation[],
  newForeshadowings: Foreshadowing[],
  deltas: Record<string, unknown>,
  turnEstimate: number,
  now: () => number,
  random: () => string,
  worldTimeRef: { value: number },
  locationRef: { value: string },
  newNpcs: T1Npc[],
): void {
  const canonical = normalizeToolName(name)

  // ── ModifyInventory (was Backpack_additems / Backpack_reduceitems) ──

  if (canonical === 'ModifyInventory') {
    const isOldReduce = name === 'Backpack_reduceitems'
    const isOldAdd = name === 'Backpack_additems'

    // Additions (new API uses `additions`, old API uses `items` with Backpack_additems)
    if (!isOldReduce && (args.additions || (isOldAdd && args.items))) {
      const items = (args.additions || args.items) as Array<Record<string, unknown>>
      for (const item of items) {
        const existing = newInventory.find((i) => i.name === item.name)
        if (existing) {
          existing.count += (item.count as number)
        } else {
          newInventory.push({
            ...item,
            id: (item.id as string) || generateItemId(now, random),
          // HACK: as unknown as 类型强转绕过IInventoryItem严格校验，因Prisma schema的inventory字段为Json类型，运行时形状无法静态保证。Phase 2引入Zod runtime校验后移除。2026-07-24
          } as unknown as IInventoryItem)
        }
      }
      deltas.addedItems = items
    }
    // Removals (new API uses `removals`, old Backpack_reduceitems uses `items`)
    if (args.removals || (isOldReduce && args.items)) {
      const items = (args.removals || args.items) as Array<Record<string, unknown>>
      for (const item of items) {
        const idx = newInventory.findIndex((i) => i.name === item.name)
        if (idx !== -1) {
          newInventory[idx].count -= (item.count as number)
          if (newInventory[idx].count <= 0) newInventory.splice(idx, 1)
        }
      }
      deltas.reducedItems = items
    }
  }

  // ── ConsumeItem (was Consume_Item) ──────────────────────────────────

  if (canonical === 'ConsumeItem') {
    if (args.items) {
      const items = args.items as Array<Record<string, unknown>>
      for (const item of items) {
        const idx = newInventory.findIndex((i) => i.name === item.name)
        if (idx !== -1) {
          newInventory[idx].count -= (item.count as number)
          if (newInventory[idx].count <= 0) newInventory.splice(idx, 1)
        }
      }
      deltas.reducedItems = items
    }
    if ((args.mp_cost as number) && (args.mp_cost as number) > 0) {
      newStats.mp.current = Math.max(0, newStats.mp.current - (args.mp_cost as number))
      deltas.mpCost = args.mp_cost
    }
  }

  // ── ModifyStats (was Modify_Stats + Modify_Mental) ──────────────────

  if (canonical === 'ModifyStats') {
    applyModifyStats(args, newStats, deltas)
    // Handle Modify_Mental-only fields (not covered by applyModifyStats)
    if (args.emotion) newStats.emotion = args.emotion as string
    if (args.mental_state) newStats.mental_state = args.mental_state as string
    if (args.alignment) newStats.alignment = args.alignment as ICharacterStats['alignment']
    if (args.sect) newStats.sect = args.sect as string
    if (args.spiritual_root) newStats.spiritual_root = args.spiritual_root as string
    if (args.realm) newStats.realm = args.realm as string
    if (args.race) newStats.race = args.race as string
    deltas.mental = args
  }

  // ── ModifyTechniques (was Modify_Techniques) ────────────────────────

  if (canonical === 'ModifyTechniques') {
    if (!newStats.techniques) {
      newStats.techniques = { main: '', combat: [], movement: '', support: [] }
    }
    const t = newStats.techniques
    if (args.main !== undefined) t.main = args.main as string
    if (args.add_combat) t.combat = [...t.combat, args.add_combat as string]
    if (args.remove_combat) t.combat = t.combat.filter((c) => c !== args.remove_combat)
    if (args.movement !== undefined) t.movement = args.movement as string
    if (args.add_support) t.support = [...t.support, args.add_support as string]
    if (args.remove_support) t.support = t.support.filter((s) => s !== args.remove_support)
    deltas.techniques = t
  }

  // ── ModifyTraits (was Modify_Traits) ────────────────────────────────

  if (canonical === 'ModifyTraits') {
    if (args.add_talents) {
      newStats.talents = [...(newStats.talents || []), ...(args.add_talents as string[])]
    }
    if (args.remove_talents) {
      newStats.talents = (newStats.talents || []).filter(
        (t) => !(args.remove_talents as string[]).includes(t),
      )
    }
    if (args.add_traits) {
      newStats.traits = [...(newStats.traits || []), ...(args.add_traits as string[])]
    }
    if (args.remove_traits) {
      newStats.traits = (newStats.traits || []).filter(
        (t) => !(args.remove_traits as string[]).includes(t),
      )
    }
    deltas.traits = newStats.traits
  }

  // ── UpdateRelationship (was Update_Relationship) ────────────────────

  if (canonical === 'UpdateRelationship') {
    const npcName = (args.npc_name || args.entityB) as string
    const delta = (args.change || args.delta) as number
    relationships[npcName] = (relationships[npcName] || 0) + delta
    deltas.relationships = relationships
  }

  // ── ChangeLocation (was Change_Location) ────────────────────────────

  if (canonical === 'ChangeLocation') {
    const newLoc = (args.location || args.to) as string
    locationRef.value = newLoc
    deltas.location = newLoc
    // 报告新位置在场的NPC（含活动状态）
    const npcsActive = getActiveNpcsAtLocation(newNpcs, newLoc, worldTimeRef.value)
    if (npcsActive.length > 0) {
      deltas.npcsPresent = npcsActive.map((s) => ({
        name: s.npc.name,
        title: s.npc.title,
        realm: s.npc.realm,
        personality: s.npc.personality,
        activity: s.activity,
        interactable: s.interactable,
        location: s.location,
      }))
      deltas.npcsHereText = formatNpcPresence(npcsActive)
    }
  }

  // ── AdvanceTime ──────────────────────────────────────────────────────

  if (canonical === 'AdvanceTime') {
    const duration = args.duration as string
    const ms = parseDuration(duration)
    worldTimeRef.value += ms
    deltas.timeAdvanced = duration
    deltas.timeAdvancedMs = ms
    deltas.newWorldTime = worldTimeRef.value
  }

  // ── CheckBreakthrough (was Check_Breakthrough) ──────────────────────

  if (canonical === 'CheckBreakthrough') {
    if (args.result === 'SUCCESS' && args.new_realm) {
      newStats.realm = args.new_realm as string
    }
    deltas.breakthrough = args
  }

  // ── GenerateNpc (was Generate_NPC) ──────────────────────────────────

  if (canonical === 'GenerateNpc' && (args.npcs || args.npc)) {
    const npcs = (args.npcs || [args.npc]) as Array<Record<string, unknown>>
    const createdNpcNames: string[] = []
    for (const npc of npcs) {
      const parts = [npc.description as string]
      if (npc.realm) parts.push(`[${npc.realm}]`)
      if (npc.sect) parts.push(npc.sect as string)
      if (npc.personality) parts.push(npc.personality as string)
      addCodexEntry(newCodex, {
        id: generateCodexId('cv', now, random),
        name: npc.name as string,
        entry_type: 'npc',
        description: parts.join(' '),
        metadata: {},
        timestamp: now(),
      })

      // 创建 T1 NPC 实体
      const npcEntity = createT1Npc({
        name: npc.name as string,
        title: npc.title as string | undefined,
        realm: (npc.realm as string) ?? '凡人',
        currentLocation: locationRef.value,
        alignment: npc.alignment as '正道' | '魔道' | '中立' | undefined,
        sect: (npc.sect as string) ?? '散修',
        personality: (npc.personality as string) ?? '温和',
        description: npc.description as string,
        relationship: npc.relationship as number | undefined,
      })
      newNpcs.push(npcEntity)
      createdNpcNames.push(npc.name as string)
    }
    deltas.newNpcs = createdNpcNames
  }

  // ── GenerateLocation (was Generate_Location) ────────────────────────

  if (canonical === 'GenerateLocation' && (args.locations || args.location)) {
    const locs = (args.locations || [args.location]) as Array<Record<string, unknown>>
    for (const loc of locs) {
      const parts = [loc.description as string]
      if (loc.danger_level) parts.push(`[${loc.danger_level}]`)
      if (loc.region) parts.push(`位于${loc.region}`)
      if (loc.power_distribution) parts.push(`势力:${loc.power_distribution}`)
      if (loc.bound_locations && (loc.bound_locations as unknown[]).length > 0)
        parts.push(`关联:${(loc.bound_locations as string[]).join('、')}`)
      if (loc.inhabitants && (loc.inhabitants as unknown[]).length > 0)
        parts.push(`居民:${(loc.inhabitants as string[]).join('、')}`)
      addCodexEntry(newCodex, {
        id: generateCodexId('cv', now, random),
        name: loc.name as string,
        entry_type: 'location',
        description: parts.join(' '),
        metadata: {
          region: loc.region,
          danger_level: loc.danger_level,
          peace_orno: loc.peace_orno,
          power_distribution: loc.power_distribution,
          level_range: loc.level_range,
          rules: loc.rules,
          inhabitants: loc.inhabitants,
          bound_items: loc.bound_items,
          bound_locations: loc.bound_locations,
        },
        timestamp: now(),
      })
    }
  }

  // ── GenerateSect (was Generate_Sect) ────────────────────────────────

  if (canonical === 'GenerateSect' && (args.sects || args.sect)) {
    const sects = (args.sects || [args.sect]) as Array<Record<string, unknown>>
    for (const sect of sects) {
      const parts = [sect.description as string]
      if (sect.alignment) parts.push(`[${sect.alignment}]`)
      if (sect.master) parts.push(sect.master as string)
      if (sect.specialties) parts.push(sect.specialties as string)
      addCodexEntry(newCodex, {
        id: generateCodexId('cv', now, random),
        name: sect.name as string,
        entry_type: 'sect',
        description: parts.join(' '),
        metadata: {},
        timestamp: now(),
      })
    }
  }

  // ── GenerateItem (was Generate_Item) ────────────────────────────────

  if (canonical === 'GenerateItem' && (args.items || args.item)) {
    const items = (args.items || [args.item]) as Array<Record<string, unknown>>
    for (const item of items) {
      const parts = [item.description as string]
      if (item.grade) parts.push(`[${item.grade}]`)
      if (item.effects) parts.push(item.effects as string)
      addCodexEntry(newCodex, {
        id: generateCodexId('cv', now, random),
        name: item.name as string,
        entry_type: 'item',
        description: parts.join(' '),
        metadata: {},
        timestamp: now(),
      })
    }
  }

  // ── AddCodexEntry (was Write_Codex) ─────────────────────────────────

  if (canonical === 'AddCodexEntry') {
    addCodexEntry(newCodex, {
      id: generateCodexId('cv', now, random),
      name: args.name as string,
      entry_type: (args.entry_type || args.entryType) as string,
      description: args.description as string,
      metadata: (args.metadata as Record<string, unknown>) || {},
      timestamp: now(),
    })
    deltas.codex = {
      name: args.name,
      entry_type: args.entry_type || args.entryType,
      description: args.description,
      metadata: (args.metadata as Record<string, unknown>) || {},
      timestamp: now(),
    }
  }

  // ── AddJournalEntry (was Write_Journal) ─────────────────────────────

  if (canonical === 'AddJournalEntry') {
    deltas.journal = {
      title: args.title,
      content: args.content,
      entry_type: args.entry_type || args.entryType || 'general',
      timestamp: now(),
    }
  }

  // ── UpdateSituation / CreateSituation / ResolveSituation ────────────

  if (canonical === 'UpdateSituation') {
    applyUpdateSituation(args, newSituations, deltas, turnEstimate, now, random)
  }

  // CreateSituation: forward to UpdateSituation with action='create'
  if (canonical === 'CreateSituation') {
    applyUpdateSituation(
      { ...args, action: 'create' },
      newSituations, deltas, turnEstimate, now, random,
    )
  }

  // ResolveSituation: forward to UpdateSituation
  if (canonical === 'ResolveSituation') {
    const action = args.action || 'end'
    applyUpdateSituation(
      { ...args, action, situation_id: args.situationId || args.situation_id },
      newSituations, deltas, turnEstimate, now, random,
    )
  }

  // ── CreateForeshadowing ─────────────────────────────────────────────

  if (canonical === 'CreateForeshadowing') {
    applyCreateForeshadowing(args, newForeshadowings, newSituations, deltas, turnEstimate, now, random)
  }

  // ── Perception query tools & other read-only tools ──────────────────
  // SearchArea, ExamineObject, SenseDanger, CheckNpcState, QueryRegion,
  // RecallMemory, LookAround, TriggerCombat, Skip
  // GenerateDailyPlan, DecideReaction, FormMemory, GenerateDialogue, SelfReflection
  // → Read-only or handled elsewhere; no rule-engine state change needed.
}

// ─── Helpers (internal) ────────────────────────────────────────────────────

/** Parse human-readable duration to milliseconds. Supports m/分钟/min, h/小时/hour, d/天/day. */
function parseDuration(d: string): number {
  const match = d.match(/^(\d+)\s*(m|分钟|min|h|小时|hour|d|天|day)$/i)
  if (!match) return 0
  const num = parseInt(match[1], 10)
  const unit = match[2].toLowerCase()
  if (unit === 'm' || unit === '分钟' || unit === 'min') return num * 60 * 1000
  if (unit === 'h' || unit === '小时' || unit === 'hour') return num * 60 * 60 * 1000
  if (unit === 'd' || unit === '天' || unit === 'day') return num * 24 * 60 * 60 * 1000
  return 0
}

function applyModifyStats(
  a: Record<string, unknown>,
  newStats: Record<string, unknown> & ICharacterStats,
  deltas: Record<string, unknown>,
): void {
  if (a.shield_change) {
    newStats.shield = newStats.shield || { current: 0, max: 0 }
    newStats.shield.current = Math.max(0, (newStats.shield.current || 0) + (a.shield_change as number))
  }
  if (a.shield_max_change) {
    newStats.shield = newStats.shield || { current: 0, max: 0 }
    newStats.shield.max += a.shield_max_change as number
  }

  if (a.hp_change && (a.hp_change as number) < 0) {
    const damage = Math.abs(a.hp_change as number)
    const shieldCurrent = newStats.shield?.current || 0
    if (shieldCurrent > 0) {
      if (shieldCurrent >= damage) {
        newStats.shield = newStats.shield || { current: 0, max: 0 }
        newStats.shield.current = shieldCurrent - damage
      } else {
        const overflow = damage - shieldCurrent
        newStats.shield = newStats.shield || { current: 0, max: 0 }
        newStats.shield.current = 0
        newStats.hp.current = Math.max(0, newStats.hp.current - overflow)
      }
    } else {
      newStats.hp.current = Math.max(0, Math.min(newStats.hp.max, newStats.hp.current + (a.hp_change as number)))
    }
  } else if (a.hp_change && (a.hp_change as number) > 0) {
    newStats.hp.current = Math.min(newStats.hp.max, newStats.hp.current + (a.hp_change as number))
  }

  const hpPct = (newStats.hp.current / newStats.hp.max) * 100
  if (hpPct >= 90) newStats.hp.status_desc = '状态良好'
  else if (hpPct >= 70) newStats.hp.status_desc = '轻伤'
  else if (hpPct >= 50) newStats.hp.status_desc = '流血负伤'
  else if (hpPct >= 30) newStats.hp.status_desc = '伤及内脏'
  else if (hpPct >= 10) newStats.hp.status_desc = '肉身破裂'
  else newStats.hp.status_desc = '神仙难救'

  if (a.hp_max_change) newStats.hp.max += a.hp_max_change as number
  if (a.mp_change) {
    newStats.mp = newStats.mp || { current: 50, max: 50, status_desc: '充沛' }
    newStats.mp.current = Math.max(0, Math.min(newStats.mp.max, newStats.mp.current + (a.mp_change as number)))
  }
  if (a.mp_max_change) {
    newStats.mp = newStats.mp || { current: 50, max: 50, status_desc: '充沛' }
    newStats.mp.max += a.mp_max_change as number
  }
  if (a.spirit_change) {
    newStats.spirit = newStats.spirit || { value: 100, desc: '精神饱满' }
    newStats.spirit.value += a.spirit_change as number
  }
  if (a.age_change) newStats.age.current += a.age_change as number
  if (a.reputation_change) newStats.reputation += a.reputation_change as number
  if (a.state_of_mind_change) {
    newStats.state_of_mind = (newStats.state_of_mind || 50) + (a.state_of_mind_change as number)
  }
  if (a.fortune_change) {
    newStats.fortune = (newStats.fortune || 10) + (a.fortune_change as number)
  }
  if (a.karma_change) {
    newStats.karma = (newStats.karma || 0) + (a.karma_change as number)
  }
  deltas.stats = a
}

function applyUpdateSituation(
  a: Record<string, unknown>,
  newSituations: Situation[],
  deltas: Record<string, unknown>,
  turnEstimate: number,
  now: () => number,
  random: () => string,
): void {
  if (a.action === 'create') {
    const newSit: Situation = {
      id: generateCodexId('sit', now, random),
      title: (a.title as string) || '未命名局面',
      type: (a.type as Situation['type']) || 'conflict',
      trigger: (a.trigger as string) || '',
      npcs: (a.npcs as string[]) || [],
      player_goal: (a.player_goal as string) || '',
      possible_outcomes: (a.possible_outcomes as string[]) || ['其他可能结局'],
      linked_foreshadowing: [],
      linked_situation: (a.linked_situation as string) || null,
      status: 'brewing',
      startTurn: turnEstimate,
      updatedAt: now(),
    }
    newSituations.push(newSit)
    deltas.situation = { action: 'create', situation: newSit }
  } else if (a.action === 'update_status' && a.situation_id) {
    const idx = newSituations.findIndex((s) => s.id === a.situation_id)
    if (idx !== -1 && a.status) {
      newSituations[idx] = { ...newSituations[idx], status: a.status as Situation['status'], updatedAt: now() }
      deltas.situation = { action: 'update_status', situation_id: a.situation_id, status: a.status }
    }
  } else if (a.action === 'end' && a.situation_id) {
    const idx = newSituations.findIndex((s) => s.id === a.situation_id)
    if (idx !== -1) {
      newSituations[idx] = {
        ...newSituations[idx],
        status: 'ended',
        actual_outcome: (a.actual_outcome as string) || '局面已结束',
        endTurn: turnEstimate,
        updatedAt: now(),
      }
      deltas.situation = { action: 'end', situation_id: a.situation_id, actual_outcome: a.actual_outcome }
    }
  } else if (a.action === 'add_outcome' && a.situation_id && a.new_outcome) {
    const idx = newSituations.findIndex((s) => s.id === a.situation_id)
    if (idx !== -1) {
      const outcomes = [...newSituations[idx].possible_outcomes, a.new_outcome as string]
      newSituations[idx] = { ...newSituations[idx], possible_outcomes: outcomes, updatedAt: now() }
      deltas.situation = { action: 'add_outcome', situation_id: a.situation_id, new_outcome: a.new_outcome }
    }
  }
}

function applyCreateForeshadowing(
  a: Record<string, unknown>,
  newForeshadowings: Foreshadowing[],
  newSituations: Situation[],
  deltas: Record<string, unknown>,
  turnEstimate: number,
  now: () => number,
  random: () => string,
): void {
  if (!a.resolved) {
    const newFs: Foreshadowing = {
      id: generateCodexId('fs', now, random),
      title: (a.title as string) || '未命名伏笔',
      description: (a.description as string) || '',
      related_situation: (a.related_situation as string) || '',
      plantedTurn: turnEstimate,
      resolved: false,
    }
    newForeshadowings.push(newFs)
    deltas.foreshadowing = { action: 'create', foreshadowing: newFs }
    if (a.related_situation) {
      const sIdx = newSituations.findIndex((s) => s.id === a.related_situation)
      if (sIdx !== -1) {
        newSituations[sIdx] = {
          ...newSituations[sIdx],
          linked_foreshadowing: [...newSituations[sIdx].linked_foreshadowing, newFs.id],
        }
      }
    }
  } else if (a.resolved && a.foreshadowing_id) {
    const idx = newForeshadowings.findIndex((f) => f.id === a.foreshadowing_id)
    if (idx !== -1) {
      newForeshadowings[idx] = {
        ...newForeshadowings[idx],
        resolved: true,
        resolvedTurn: turnEstimate,
      }
      deltas.foreshadowing = {
        action: 'resolve',
        foreshadowing_id: a.foreshadowing_id,
        resolve_note: (a.resolve_note as string) || '',
      }
    }
  }
}
