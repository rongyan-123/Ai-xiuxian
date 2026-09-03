// NPC Tick引擎 — 单个NPC的决策执行 + 区域批量推进
// Phase C核心：串联Utility AI（Phase A）+ NPC Agent Loop（Phase B）

import type { T1Npc, KnowledgeRecord } from '@/types'
import type { ConstraintRule } from './region-dm'
import type { NpcTurnTrigger } from '../application/npc-agent-loop'
import {
  decideNpcAction,
  scoreAction,
  getAvailableActions,
  type NpcActionType,
  type NpcDecisionContext,
  type NpcParams,
} from './npc-decision'
import { getNpcCurrentActivity } from './npc-activity'

// ── Tick结果类型 ────────────────────────────────────────────────────────────

export type TickResult =
  | { kind: 'simple'; npc: T1Npc; narrative: string }
  | { kind: 'llm_needed'; npc: T1Npc; trigger: NpcTurnTrigger }

// ── 单个NPC Tick ────────────────────────────────────────────────────────────

export function tickNpc(
  npc: T1Npc,
  allNpcs: T1Npc[],
  gameTimeMs: number,
  playerNearby: boolean,
  threatLevel: number,
  _regionRules: ConstraintRule[],
): TickResult {
  const hour = new Date(gameTimeMs).getHours()
  const activity = getNpcCurrentActivity(npc, gameTimeMs)

  const context: NpcDecisionContext = {
    threatLevel,
    playerNearby,
    timeOfDay: hour,
    currentActivity: activity?.activity ?? '闲逛',
    locationName: npc.currentLocation,
  }

  const archetypeId = npc.archetype ?? 'wanderer'
  const params: NpcParams = {
    greed: npc.traits?.greed ?? 0.5,
    friendliness: npc.traits?.friendliness ?? 0.5,
    courage: npc.traits?.courage ?? 0.5,
    cunning: npc.traits?.cunning ?? 0.5,
    lawfulness: npc.traits?.lawfulness ?? 0.5,
    anger: npc.traits?.anger ?? 0.5,
    vigilance: npc.traits?.vigilance,
    gossip: npc.traits?.gossip,
    craftsmanship: npc.traits?.craftsmanship,
  }

  const decision = decideNpcAction(params, archetypeId, context)

  if (!decision.action.requiresLLM) {
    const narrative = formatSimpleAction(npc, decision.action.type)
    return { kind: 'simple', npc, narrative }
  }

  // 无外部触发时降级为简单动作（无玩家在附近 + 低威胁 → 不需要LLM）
  if (!playerNearby && threatLevel < 0.3) {
    const simpleAction = pickBestSimpleAction(archetypeId, params, context)
    const narrative = formatSimpleAction(npc, simpleAction)
    return { kind: 'simple', npc, narrative }
  }

  const trigger = buildTriggerFromDecision(npc, decision.action.type, context)
  return { kind: 'llm_needed', npc, trigger }
}

// ── 降级辅助：从可用动作中选最佳简单动作 ──────────────────────────────────────

function pickBestSimpleAction(
  archetypeId: string,
  params: NpcParams,
  context: NpcDecisionContext,
): NpcActionType {
  const available = getAvailableActions(archetypeId, 1)
    .filter((a) => !a.requiresLLM)
    .map((a) => a.type)

  if (available.length === 0) return 'wander'

  let best: { type: NpcActionType; score: number } = { type: available[0], score: -Infinity }
  for (const type of available) {
    const s = scoreAction(type, params, context)
    if (s > best.score) {
      best = { type, score: s }
    }
  }
  return best.type
}

// ── 决策结果 → 触发器 ──────────────────────────────────────────────────────

function buildTriggerFromDecision(
  npc: T1Npc,
  actionType: NpcActionType,
  context: NpcDecisionContext,
): NpcTurnTrigger {
  if (context.threatLevel > 0.5) {
    return {
      type: 'threat_detected',
      description: `${npc.name}感知到高威胁（${(context.threatLevel * 100).toFixed(0)}%）`,
      threatLevel: context.threatLevel,
    }
  }
  if (context.playerNearby) {
    return {
      type: 'player_nearby',
      description: `一位修士出现在${npc.currentLocation}，${npc.name}注意到了。`,
    }
  }
  // 事件类触发
  if (actionType === 'explore') {
    return { type: 'event_witness', description: `${npc.name}决定探索周边。` }
  }
  return {
    type: 'scheduled_action',
    description: `${npc.name}正在进行日常活动。`,
    actionType: context.currentActivity,
  }
}

// ── 简单动作 → 叙事文本 ────────────────────────────────────────────────────

export function formatSimpleAction(npc: T1Npc, actionType: NpcActionType): string {
  const name = npc.name
  const templates: Record<string, string[]> = {
    rest: [
      `${name}打了个哈欠，靠在${npc.currentLocation}的一角闭目养神。`,
      `${name}揉了揉眼睛，坐下来稍作休息。`,
      `${name}停下手中的活计，靠在墙边小憩。`,
    ],
    wander: [
      `${name}在${npc.currentLocation}的街道上悠闲地闲逛。`,
      `${name}踱着步子，四处打量着${npc.currentLocation}的景色。`,
      `${name}背着双手在${npc.currentLocation}漫步，不时驻足观望。`,
    ],
    patrol: [
      `${name}按着剑柄，沿着既定路线继续巡逻。`,
      `${name}警觉地扫视四周，迈着沉稳的步伐巡视。`,
      `${name}一边巡逻，一边仔细打量着每一个角落。`,
    ],
    guard: [
      `${name}挺直腰板站在岗位上，目光如炬。`,
      `${name}双手抱胸站在${npc.currentLocation}入口，保持警戒。`,
      `${name}纹丝不动地守在岗位上，神色严肃。`,
    ],
    craft: [
      `${name}在铺子里叮叮当当地锻造着。`,
      `${name}抡起铁锤，专注地敲打着烧红的铁块。`,
      `${name}擦了擦汗，继续打磨手中的器物。`,
    ],
  }

  const options = templates[actionType]
  if (!options) return `${name}继续着手头的事。`
  // 用npc.id做伪随机种子，确保同一个NPC同一个动作每次输出一致
  const seed = hashStr(npc.id + actionType)
  return options[seed % options.length]
}

// ── 区域批量NPC推进 ────────────────────────────────────────────────────────

export async function tickRegionNpcs(
  npcs: T1Npc[],
  allNpcs: T1Npc[],
  gameTimeMs: number,
  threatLevel: number,
  regionRules: ConstraintRule[],
): Promise<T1Npc[]> {
  if (npcs.length === 0) return []

  const updatedNpcs: T1Npc[] = []

  for (const npc of npcs) {
    // 玩家是否在该NPC的当前位置
    const playerNpc = allNpcs.find((n) => n.id === 'player')
    const playerNearby = playerNpc != null && playerNpc.currentLocation === npc.currentLocation

    const result = tickNpc(npc, allNpcs, gameTimeMs, playerNearby, threatLevel, regionRules)

    const updated = { ...result.npc }
    if (!updated.knowledge) updated.knowledge = []

    if (result.kind === 'simple') {
      // 记录知识气泡
      const eventRecord: KnowledgeRecord = {
        eventType: 'npc_action',
        description: result.narrative,
        location: npc.currentLocation,
        timestamp: gameTimeMs,
        witnesses: [npc.id],
        publicKnowledge: true,
      }
      if (!updated.knowledge) updated.knowledge = []
      updated.knowledge.push(eventRecord)

      // 同位置的其它NPC也目击
      for (const other of allNpcs) {
        if (other.id !== npc.id && other.currentLocation === npc.currentLocation) {
          // 找到或创建other在updatedNpcs中的副本
          const existingIdx = updatedNpcs.findIndex((u) => u.id === other.id)
          if (existingIdx >= 0) {
            if (!updatedNpcs[existingIdx].knowledge) updatedNpcs[existingIdx].knowledge = []
            updatedNpcs[existingIdx].knowledge!.push(eventRecord)
          } else {
            const otherCopy = { ...other }
            if (!otherCopy.knowledge) otherCopy.knowledge = []
            otherCopy.knowledge.push(eventRecord)
            // 后面会统一push，先暂存
            allNpcs[allNpcs.indexOf(other)] = otherCopy
          }
        }
      }
    }

    updatedNpcs.push(updated)
  }

  return updatedNpcs
}

// ── 简单hash ────────────────────────────────────────────────────────────────

function hashStr(s: string): number {
  let hash = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    hash = ((hash << 5) - hash + c) | 0
  }
  return Math.abs(hash)
}
