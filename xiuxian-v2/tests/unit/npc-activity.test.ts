import { describe, it, expect } from 'vitest'
import {
  getNpcCurrentActivity,
  getActiveNpcsAtLocation,
  isNpcAvailable,
  formatNpcPresence,
} from '@/server/domain/npc-activity'
import { getAllSeedNpcs } from '@/server/domain/npc-engine'
import type { T1Npc } from '@/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeGameTime(hour: number, minute: number = 0): number {
  // 修仙元年 1月1日 UTC
  const base = Date.UTC(2026, 0, 1, hour, minute, 0, 0)
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
    description: '一个测试NPC',
    createdAt: Date.now(),
    schedule: [
      { startHour: 8, endHour: 12, activity: '站柜营业', location: '青云坊市-店铺', interactable: true },
      { startHour: 12, endHour: 13, activity: '午休', location: '青云坊市-店铺', interactable: false },
      { startHour: 13, endHour: 18, activity: '站柜营业', location: '青云坊市-店铺', interactable: true },
      { startHour: 18, endHour: 8, activity: '休息', location: '青云坊市-店铺', interactable: false },
    ],
    ...overrides,
  }
}

// ── getNpcCurrentActivity ────────────────────────────────────────────────────

describe('getNpcCurrentActivity', () => {
  it('returns correct activity for morning business hours', () => {
    const npc = makeNpc()
    const state = getNpcCurrentActivity(npc, makeGameTime(9))
    expect(state).not.toBeNull()
    expect(state!.activity).toBe('站柜营业')
    expect(state!.interactable).toBe(true)
  })

  it('returns non-interactable during lunch break', () => {
    const npc = makeNpc()
    const state = getNpcCurrentActivity(npc, makeGameTime(12, 30))
    expect(state).not.toBeNull()
    expect(state!.activity).toBe('午休')
    expect(state!.interactable).toBe(false)
  })

  it('returns resting during night hours', () => {
    const npc = makeNpc()
    const state = getNpcCurrentActivity(npc, makeGameTime(3))
    expect(state).not.toBeNull()
    expect(state!.activity).toBe('休息')
    expect(state!.interactable).toBe(false)
  })

  it('returns afternoon activity correctly', () => {
    const npc = makeNpc()
    const state = getNpcCurrentActivity(npc, makeGameTime(15))
    expect(state).not.toBeNull()
    expect(state!.activity).toBe('站柜营业')
    expect(state!.interactable).toBe(true)
  })

  it('returns default state for NPC without schedule', () => {
    const npc = makeNpc({ schedule: undefined })
    const state = getNpcCurrentActivity(npc, makeGameTime(12))
    expect(state).not.toBeNull()
    expect(state!.activity).toBe('闲逛')
    expect(state!.interactable).toBe(true)
  })

  it('handles boundary: exactly at start hour', () => {
    const npc = makeNpc()
    const state = getNpcCurrentActivity(npc, makeGameTime(8, 0))
    expect(state).not.toBeNull()
    expect(state!.activity).toBe('站柜营业')
  })

  it('handles boundary: exactly at end hour (next slot starts)', () => {
    const npc = makeNpc()
    const state = getNpcCurrentActivity(npc, makeGameTime(12, 0))
    expect(state).not.toBeNull()
    expect(state!.activity).toBe('午休')
  })
})

// ── getActiveNpcsAtLocation ──────────────────────────────────────────────────

describe('getActiveNpcsAtLocation', () => {
  it('finds NPCs at exact location match', () => {
    const npc = makeNpc()
    const result = getActiveNpcsAtLocation([npc], '青云坊市-店铺', makeGameTime(10))
    expect(result).toHaveLength(1)
    expect(result[0].activity).toBe('站柜营业')
  })

  it('finds NPCs with prefix location match', () => {
    const npc = makeNpc()
    const result = getActiveNpcsAtLocation([npc], '青云坊市', makeGameTime(10))
    expect(result).toHaveLength(1)
    expect(result[0].location).toBe('青云坊市-店铺')
  })

  it('returns empty for location with no NPCs', () => {
    const npc = makeNpc()
    const result = getActiveNpcsAtLocation([npc], '苍澜山', makeGameTime(10))
    expect(result).toHaveLength(0)
  })

  it('returns multiple NPCs at same location', () => {
    const npc1 = makeNpc({ id: 'npc-1', name: '甲' })
    const npc2 = makeNpc({
      id: 'npc-2',
      name: '乙',
      schedule: [
        { startHour: 8, endHour: 12, activity: '逛街', location: '青云坊市-店铺', interactable: true },
      ],
    })
    const result = getActiveNpcsAtLocation([npc1, npc2], '青云坊市-店铺', makeGameTime(10))
    expect(result).toHaveLength(2)
  })

  it('returns empty when NPCs are at the location but it is not their active slot', () => {
    const npc = makeNpc()
    // NPC schedule shows they're at 青云坊市-店铺 at 10am, but let's check a time when they're n ot there
    // Actually in this test NPC, all slots are at 青云坊市-店铺, so they're always t here
    // Let's test with a different NPC that moves
    const traveler = makeNpc({
      id: 'traveler',
      schedule: [
        { startHour: 6, endHour: 8, activity: '睡觉', location: '客栈', interactable: false },
        { startHour: 8, endHour: 18, activity: '出城', location: '苍澜山', interactable: false },
        { startHour: 18, endHour: 6, activity: '睡觉', location: '客栈', interactable: false },
      ],
    })
    const result = getActiveNpcsAtLocation([traveler], '苍澜山', makeGameTime(10))
    expect(result).toHaveLength(1)

    const empty = getActiveNpcsAtLocation([traveler], '青云坊市-店铺', makeGameTime(10))
    expect(empty).toHaveLength(0)
  })
})

// ── isNpcAvailable ───────────────────────────────────────────────────────────

describe('isNpcAvailable', () => {
  it('returns true during business hours', () => {
    const npc = makeNpc()
    expect(isNpcAvailable(npc, makeGameTime(10))).toBe(true)
  })

  it('returns false during lunch break', () => {
    const npc = makeNpc()
    expect(isNpcAvailable(npc, makeGameTime(12, 30))).toBe(false)
  })

  it('returns false during night', () => {
    const npc = makeNpc()
    expect(isNpcAvailable(npc, makeGameTime(2))).toBe(false)
  })
})

// ── formatNpcPresence ────────────────────────────────────────────────────────

describe('formatNpcPresence', () => {
  it('returns empty string for empty list', () => {
    expect(formatNpcPresence([])).toBe('')
  })

  it('formats NPC presence with activity', () => {
    const npc = makeNpc()
    const states = getActiveNpcsAtLocation([npc], '青云坊市-店铺', makeGameTime(10))
    const text = formatNpcPresence(states)
    expect(text).toContain('测试NPC')
    expect(text).toContain('站柜营业')
    expect(text).toContain('练气期一层')
  })

  it('marks non-interactable NPCs', () => {
    const npc = makeNpc()
    const states = getActiveNpcsAtLocation([npc], '青云坊市-店铺', makeGameTime(12, 30))
    const text = formatNpcPresence(states)
    expect(text).toContain('不可打扰')
  })
})

// ── Seed NPCs validation ─────────────────────────────────────────────────────

describe('Seed NPCs', () => {
  it('allows creating NPCs from seed data', () => {
    const npcs = getAllSeedNpcs()
    expect(npcs).toHaveLength(3)
  })

  it('seed NPCs have valid schedules', () => {
    const npcs = getAllSeedNpcs()
    for (const npc of npcs) {
      expect(npc.schedule).toBeDefined()
      expect(npc.schedule!.length).toBeGreaterThan(0)
      for (const slot of npc.schedule!) {
        expect(slot.startHour).toBeGreaterThanOrEqual(0)
        expect(slot.startHour).toBeLessThan(24)
        expect(slot.endHour).toBeGreaterThanOrEqual(0)
        expect(slot.endHour).toBeLessThanOrEqual(24)
        expect(slot.activity).toBeTruthy()
        expect(slot.location).toBeTruthy()
      }
    }
  })

  it('each seed NPC has activity at every hour', () => {
    const npcs = getAllSeedNpcs()
    for (const npc of npcs) {
      for (let h = 0; h < 24; h++) {
        const state = getNpcCurrentActivity(npc, makeGameTime(h))
        expect(state, `${npc.name} at hour ${h}`).not.toBeNull()
        expect(state!.activity).toBeTruthy()
      }
    }
  })

  it('王老四 is interactable during business hours', () => {
    const npcs = getAllSeedNpcs()
    const wang = npcs.find((n) => n.name === '王老四')!
    // 早上10点应该在站柜
    expect(isNpcAvailable(wang, makeGameTime(10))).toBe(true)
    // 凌晨3点应该在休息
    expect(isNpcAvailable(wang, makeGameTime(3))).toBe(false)
  })

  it('李散修 moves between locations', () => {
    const npcs = getAllSeedNpcs()
    const li = npcs.find((n) => n.name === '李散修')!

    const morning = getNpcCurrentActivity(li, makeGameTime(10))
    expect(morning!.location).toContain('青云坊市')

    const noon = getNpcCurrentActivity(li, makeGameTime(13))
    expect(noon!.location).toContain('茶楼')

    const evening = getNpcCurrentActivity(li, makeGameTime(18))
    expect(evening!.location).toContain('苍澜山')
  })

  it('张铁匠 has consistent schedule', () => {
    const npcs = getAllSeedNpcs()
    const zhang = npcs.find((n) => n.name === '张铁匠')!

    const day = getNpcCurrentActivity(zhang, makeGameTime(10))
    expect(day!.activity).toContain('打铁')

    const night = getNpcCurrentActivity(zhang, makeGameTime(23))
    expect(night!.activity).toBe('休息')
  })
})
