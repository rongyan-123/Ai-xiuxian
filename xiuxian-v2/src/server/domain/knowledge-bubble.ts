/**
 * 知识气泡 — 记录NPC目击的事件，实现"NPC只能感知当前位置发生的事"。
 *
 * 不做记忆流存储（那是Phase 4），只做最小的事件记录和查询。
 */
import type { T1Npc, KnowledgeRecord } from '@/types'
import { getActiveNpcsAtLocation } from './npc-activity'

/** 记录一个世界事件，所有在场NPC成为目击者 */
export function recordEvent(
  eventType: KnowledgeRecord['eventType'],
  description: string,
  location: string,
  gameTimeMs: number,
  allNpcs: T1Npc[],
  publicKnowledge: boolean = false,
): KnowledgeRecord {
  const witnesses = getActiveNpcsAtLocation(allNpcs, location, gameTimeMs).map(
    (s) => s.npc.id,
  )

  const record: KnowledgeRecord = {
    eventType,
    description,
    location,
    timestamp: gameTimeMs,
    witnesses,
    publicKnowledge,
  }

  // 将事件写入在场NPC的知识气泡
  for (const npc of allNpcs) {
    if (witnesses.includes(npc.id) || publicKnowledge) {
      if (!npc.knowledge) npc.knowledge = []
      npc.knowledge.push(record)
    }
  }

  return record
}

/** 查询NPC知道的所有事件 */
export function getNpcKnowledge(npc: T1Npc): KnowledgeRecord[] {
  return npc.knowledge ?? []
}

/** 检查NPC是否知道某件事（模糊匹配描述） */
export function doesNpcKnowAbout(npc: T1Npc, eventDescription: string): boolean {
  const knowledge = npc.knowledge ?? []
  const keywords = eventDescription.split(/\s+/).filter((k) => k.length >= 2)
  return knowledge.some((k) =>
    keywords.some((kw) => k.description.includes(kw)),
  )
}

/** 获取某时段内NPC目击的事件 */
export function getNpcKnowledgeSince(
  npc: T1Npc,
  sinceTimeMs: number,
): KnowledgeRecord[] {
  return (npc.knowledge ?? []).filter((k) => k.timestamp >= sinceTimeMs)
}

/** 清空NPC知识（如长时间未交互导致遗忘） */
export function clearNpcKnowledge(npc: T1Npc, olderThanMs: number): void {
  if (!npc.knowledge) return
  npc.knowledge = npc.knowledge.filter((k) => k.timestamp >= olderThanMs)
}
