import { describe, it, expect, beforeEach } from 'vitest'
import {
  recordEvent,
  getNpcKnowledge,
  doesNpcKnowAbout,
  getNpcKnowledgeSince,
  clearNpcKnowledge,
} from '@/server/domain/knowledge-bubble'
import type { T1Npc } from '@/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeGameTime(hour: number, dayOffset: number = 0): number {
  const base = Date.UTC(2026, 0, 1 + dayOffset, hour, 0, 0, 0)
  return base
}

function makeNpc(overrides: Partial<T1Npc> = {}): T1Npc {
  return {
    id: 'test-npc-1',
    name: '测试NPC',
    realm: '练气期一层',
    currentLocation: '青云坊市',
    alignment: '中立',
    sect: '散修',
    personality: '温和',
    relationship: 0,
    dialogueTemplates: {},
    description: '测试',
    createdAt: Date.now(),
    knowledge: [],
    schedule: [
      { startHour: 8, endHour: 18, activity: '站柜', location: '青云坊市-店铺', interactable: true },
      { startHour: 18, endHour: 8, activity: '休息', location: '青云坊市-店铺', interactable: false },
    ],
    ...overrides,
  }
}

// ── recordEvent ──────────────────────────────────────────────────────────────

describe('recordEvent', () => {
  it('records event for NPCs at the location', () => {
    const npc1 = makeNpc({ id: 'npc-1', name: '甲' })
    const npc2 = makeNpc({ id: 'npc-2', name: '乙' })
    const npcs = [npc1, npc2]
    const time = makeGameTime(10)

    recordEvent('player_action', '玩家购买了回灵丹', '青云坊市-店铺', time, npcs)

    expect(getNpcKnowledge(npc1)).toHaveLength(1)
    expect(getNpcKnowledge(npc2)).toHaveLength(1)
    expect(getNpcKnowledge(npc1)[0].description).toBe('玩家购买了回灵丹')
  })

  it('does not record for NPCs at different locations', () => {
    const npc1 = makeNpc({ id: 'npc-1', name: '甲' })
    const npc2 = makeNpc({ id: 'npc-2', name: '乙', currentLocation: '苍澜山' })
    const npcs = [npc1, npc2]
    const time = makeGameTime(10)

    // npc2's schedule keeps them at 青云坊市-店铺 during day, so let's use a spec ific time
    // Actually we need npc2 to not be at the event location
    // npc2's schedule says they're at 青云坊市-店铺 at 10am, let's make them at a diff erent place
    const npc3 = makeNpc({
      id: 'npc-3',
      name: '丙',
      schedule: [
        { startHour: 0, endHour: 24, activity: '修炼', location: '苍澜山', interactable: false },
      ],
    })
    const allNpcs = [npc1, npc3]

    recordEvent('player_action', '玩家在店铺砍价', '青云坊市-店铺', time, allNpcs)

    expect(getNpcKnowledge(npc1)).toHaveLength(1)
    expect(getNpcKnowledge(npc3)).toHaveLength(0)
  })

  it('records public knowledge for all NPCs regardless of location', () => {
    const npc1 = makeNpc({ id: 'npc-1', name: '甲' })
    const npc2 = makeNpc({
      id: 'npc-2',
      name: '乙',
      schedule: [
        { startHour: 0, endHour: 24, activity: '修炼', location: '苍澜山', interactable: false },
      ],
    })
    const npcs = [npc1, npc2]
    const time = makeGameTime(10)

    recordEvent('world_event', '天劫降临青云坊市', '青云坊市', time, npcs, true)

    expect(getNpcKnowledge(npc1)).toHaveLength(1)
    // 公共事件：即使不在现场也知道
    expect(getNpcKnowledge(npc2)).toHaveLength(1)
    expect(getNpcKnowledge(npc2)[0].publicKnowledge).toBe(true)
  })

  it('correctly records event type', () => {
    const npc = makeNpc()
    const npcs = [npc]
    const time = makeGameTime(10)

    const record = recordEvent('npc_action', '李散修买了一把飞剑', '青云坊市-店铺', time, npcs)

    expect(record.eventType).toBe('npc_action')
    expect(record.witnesses).toContain('test-npc-1')
  })
})

// ── doesNpcKnowAbout ─────────────────────────────────────────────────────────

describe('doesNpcKnowAbout', () => {
  it('returns true if NPC witnessed the event', () => {
    const npc = makeNpc()
    const npcs = [npc]
    const time = makeGameTime(10)

    recordEvent('player_action', '玩家使用了昂贵的丹药', '青云坊市-店铺', time, npcs)

    expect(doesNpcKnowAbout(npc, '昂贵的丹药')).toBe(true)
  })

  it('returns false if NPC did not witness', () => {
    const npc = makeNpc()
    expect(doesNpcKnowAbout(npc, '山洞里的功法')).toBe(false)
  })

  it('matches partial keywords', () => {
    const npc = makeNpc()
    const npcs = [npc]
    const time = makeGameTime(10)

    recordEvent('player_action', '玩家在店铺里发现了一株千年灵芝', '青云坊市-店铺', time, npcs)

    expect(doesNpcKnowAbout(npc, '千年灵芝')).toBe(true)
    expect(doesNpcKnowAbout(npc, '万年雪莲')).toBe(false)
  })

  it('returns false when knowledge is empty', () => {
    const npc = makeNpc({ knowledge: undefined })
    expect(doesNpcKnowAbout(npc, 'anything')).toBe(false)
  })
})

// ── getNpcKnowledgeSince ─────────────────────────────────────────────────────

describe('getNpcKnowledgeSince', () => {
  it('filters events by time', () => {
    const npc = makeNpc()
    const npcs = [npc]

    const day1 = makeGameTime(10, 0)   // day 1
    const day2 = makeGameTime(10, 1)   // day 2
    const day3 = makeGameTime(10, 2)   // day 3

    recordEvent('player_action', 'day1 event', '青云坊市-店铺', day1, npcs)
    recordEvent('player_action', 'day2 event', '青云坊市-店铺', day2, npcs)
    recordEvent('player_action', 'day3 event', '青云坊市-店铺', day3, npcs)

    const since = getNpcKnowledgeSince(npc, day2)
    expect(since).toHaveLength(2)
    expect(since[0].description).toBe('day2 event')
    expect(since[1].description).toBe('day3 event')
  })
})

// ── clearNpcKnowledge ────────────────────────────────────────────────────────

describe('clearNpcKnowledge', () => {
  it('removes old knowledge records', () => {
    const npc = makeNpc()
    const npcs = [npc]

    const old = makeGameTime(10, 0)
    const recent = makeGameTime(10, 5)

    recordEvent('player_action', 'old event', '青云坊市-店铺', old, npcs)
    recordEvent('player_action', 'recent event', '青云坊市-店铺', recent, npcs)

    expect(getNpcKnowledge(npc)).toHaveLength(2)

    const cutoff = makeGameTime(0, 3)
    clearNpcKnowledge(npc, cutoff)

    expect(getNpcKnowledge(npc)).toHaveLength(1)
    expect(getNpcKnowledge(npc)[0].description).toBe('recent event')
  })

  it('handles empty knowledge', () => {
    const npc = makeNpc({ knowledge: undefined })
    expect(() => clearNpcKnowledge(npc, makeGameTime(10))).not.toThrow()
  })
})
