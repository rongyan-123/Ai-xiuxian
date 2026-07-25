/**
 * NPC活动查询 — 纯函数，根据游戏时间和NPC日程表返回当前活动状态。
 *
 * 不做完整Region DM（人口层/活动分配/事件编排），只做日程驱动的活动查询。
 */
import type { T1Npc, NpcScheduleSlot } from '@/types'

export interface NpcActivityState {
  npc: T1Npc
  activity: string
  location: string
  interactable: boolean
}

/** 从毫秒时间戳提取游戏内小时（0-23），+8时区为UTC+8 */
function gameHourFromMs(gameTimeMs: number): number {
  const date = new Date(gameTimeMs)
  return date.getUTCHours()
}

/** 处理跨夜时段（如22-6），startHour > endHour表示跨夜 */
function isHourInSlot(hour: number, slot: NpcScheduleSlot): boolean {
  if (slot.startHour <= slot.endHour) {
    return hour >= slot.startHour && hour < slot.endHour
  }
  // 跨夜时段：如22-6，匹配22-23和0-5
  return hour >= slot.startHour || hour < slot.endHour
}

/** 查询单个NPC当前时间在做什么 */
export function getNpcCurrentActivity(
  npc: T1Npc,
  gameTimeMs: number,
): NpcActivityState | null {
  if (!npc.schedule || npc.schedule.length === 0) {
    // 无日程的NPC，返回默认状态
    return {
      npc,
      activity: '闲逛',
      location: npc.currentLocation,
      interactable: true,
    }
  }

  const hour = gameHourFromMs(gameTimeMs)
  const slot = npc.schedule.find((s) => isHourInSlot(hour, s))

  if (!slot) {
    return {
      npc,
      activity: '闲逛',
      location: npc.currentLocation,
      interactable: true,
    }
  }

  return {
    npc,
    activity: slot.activity,
    location: slot.location,
    interactable: slot.interactable,
  }
}

/** 查询某地点当前所有活跃NPC（含活动状态） */
export function getActiveNpcsAtLocation(
  npcs: T1Npc[],
  location: string,
  gameTimeMs: number,
): NpcActivityState[] {
  const results: NpcActivityState[] = []

  for (const npc of npcs) {
    const state = getNpcCurrentActivity(npc, gameTimeMs)
    if (!state) continue

    // 匹配：NPC当前活动所在位置与查询位置一致（前缀匹配）
    if (
      state.location === location ||
      state.location.startsWith(location + '-') ||
      location.startsWith(state.location + '-')
    ) {
      results.push(state)
    }
  }

  return results
}

/** 检查NPC当前是否可交互 */
export function isNpcAvailable(npc: T1Npc, gameTimeMs: number): boolean {
  const state = getNpcCurrentActivity(npc, gameTimeMs)
  return state?.interactable ?? false
}

/** 格式化NPC活动信息为prompt文本 */
export function formatNpcPresence(states: NpcActivityState[]): string {
  if (states.length === 0) return ''

  return states
    .map((s) => {
      const name = s.npc.name
      const title = s.npc.title ? `（${s.npc.title}）` : ''
      const realm = s.npc.realm
      const persona = s.npc.personality
      const status = s.interactable
        ? `正在${s.activity}`
        : `正在${s.activity}（不可打扰）`
      const desc = s.npc.description.slice(0, 40)
      return `- ${name}${title}（${realm}，${persona}）：${status}。${desc}`
    })
    .join('\n')
}
