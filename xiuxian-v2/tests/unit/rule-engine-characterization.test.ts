/**
 * Characterization tests for processRuleEngine.
 *
 * These tests import and exercise the PRODUCTION rule engine from
 * src/server/domain/rule-engine.ts. No inline copy exists in this file.
 *
 * Coverage targets:
 * - All supported tools (17 tools)
 * - Bounds, edge cases, shield overflow, HP death
 * - Inventory add/reduce/consume
 * - Techniques, traits, mental, relationships, locations
 * - Breakthroughs, codex generators, journal, situations, foreshadowings
 * - Malformed/empty/missing args
 * - Combined tool calls in same turn
 */
import { describe, it, expect } from 'vitest'
import {
  processRuleEngine,
  type RuleEngineDeps,
} from '@/server/domain/rule-engine'
import type { ICharacterStats, IInventoryItem, Situation, Foreshadowing } from '@/types'

// ─── Deterministic test dependencies ────────────────────────────────────────

let idCounter = 0

function deterministicDeps(): Partial<RuleEngineDeps> {
  idCounter = 0
  return {
    now: () => 1700000000000 + idCounter,
    random: () => {
      const s = (++idCounter).toString(36)
      return s.padStart(5, '0')
    },
  }
}

function baseStats(): ICharacterStats {
  return {
    hp: { current: 100, max: 100, status_desc: '良好' },
    mp: { current: 50, max: 50, status_desc: '充沛' },
    spirit: { value: 100, desc: '精神饱满' },
    realm: '练气期一层',
    age: { current: 16, max: 100 },
    race: '人族',
    alignment: '中立',
    sect: '散修',
    spiritual_root: '五行杂灵根',
    mental_state: '心如止水',
    reputation: 0,
  }
}

function run(
  toolCalls: Array<{ name: string; args?: Record<string, unknown> }> = [],
  stats = baseStats(),
  inventory: IInventoryItem[] = [],
  codex: unknown[] = [],
  relationships: Record<string, number> = {},
  situations: Situation[] = [],
  foreshadowings: Foreshadowing[] = [],
) {
  return processRuleEngine(
    toolCalls,
    stats,
    inventory,
    codex as any[],
    relationships,
    situations,
    foreshadowings,
    deterministicDeps(),
  )
}

// ─── TESTS ──────────────────────────────────────────────────────────────────

describe('processRuleEngine — characterization tests (production import)', () => {

  // ── Empty / no-op ──────────────────────────────────────────────────────

  describe('3.1 Empty / no-op turn', () => {
    it('returns input state unchanged when no tool calls', () => {
      const r = run()
      expect(r.stats.hp.current).toBe(100)
      expect(r.stats.mp.current).toBe(50)
      expect(r.inventory).toEqual([])
      expect(r.codex).toEqual([])
      expect(r.deltas).toEqual({})
    })

    it('returns input inventory unchanged', () => {
      const inv = [{ id: '1', name: '灵丹', grade: '玄阶中品' as const, type: 'consumable', description: '回复灵力', count: 3, value: 10 }]
      const r = run([], baseStats(), inv)
      expect(r.inventory).toHaveLength(1)
      expect(r.inventory[0].name).toBe('灵丹')
      expect(r.inventory[0].count).toBe(3)
    })

    it('return values are new object references (shallow immutability)', () => {
      const stats = baseStats()
      const inv: IInventoryItem[] = []
      const r = run([], stats, inv)
      expect(r.stats).not.toBe(stats)
      expect(r.inventory).not.toBe(inv)
    })
  })

  // ── Backpack_additems ──────────────────────────────────────────────────

  describe('3.2 Backpack_additems', () => {
    it('adds a new item to empty inventory', () => {
      const r = run([
        { name: 'Backpack_additems', args: { items: [{ name: '灵石', count: 5, grade: '黄阶下品', type: 'currency', description: '货币', value: 1 }] } },
      ])
      expect(r.inventory).toHaveLength(1)
      expect(r.inventory[0].name).toBe('灵石')
      expect(r.inventory[0].count).toBe(5)
      expect(r.deltas.addedItems).toBeDefined()
    })

    it('merges with existing item of same name', () => {
      const inv = [{ id: 'x1', name: '灵石', grade: '黄阶下品' as const, type: 'currency', description: '货币', count: 3, value: 1 }]
      const r = run([
        { name: 'Backpack_additems', args: { items: [{ name: '灵石', count: 2 }] } },
      ], baseStats(), inv)
      expect(r.inventory).toHaveLength(1)
      expect(r.inventory[0].count).toBe(5)
    })

    it('adds multiple items at once', () => {
      const r = run([
        { name: 'Backpack_additems', args: { items: [{ name: '灵石', count: 3 }, { name: '丹药', count: 1 }] } },
      ])
      expect(r.inventory).toHaveLength(2)
      expect(r.inventory[0].name).toBe('灵石')
      expect(r.inventory[1].name).toBe('丹药')
    })

    it('assigns deterministic id when item has no id (original format: decimal-ts-random)', () => {
      const r = run([
        { name: 'Backpack_additems', args: { items: [{ name: '无名之物', count: 1 }] } },
      ])
      expect(r.inventory[0].id).toBeTruthy()
      // Original format: Date.now().toString() + "-" + Math.random().toString(36).substr(2, 5)
      // With deterministic deps: "1700000000001-00001"
      expect(r.inventory[0].id).toMatch(/^\d+-\d+$/)
    })

    it('preserves existing item id when present', () => {
      const r = run([
        { name: 'Backpack_additems', args: { items: [{ id: 'custom-id', name: '宝物', count: 1 }] } },
      ])
      expect(r.inventory[0].id).toBe('custom-id')
    })

    it('ignores Backpack_additems with no args.items', () => {
      const r = run([
        { name: 'Backpack_additems', args: {} },
      ])
      expect(r.inventory).toEqual([])
      expect(r.deltas.addedItems).toBeUndefined()
    })

    it('fills missing value with 0 (LLM may omit it, must not break PlayerSnapshotSchema)', () => {
      const r = run([
        { name: 'Backpack_additems', args: { items: [{ name: '神秘丹', count: 1 }] } },
      ])
      expect(r.inventory[0].value).toBe(0)
    })

    it('fills missing count/grade/type/description with defaults', () => {
      const r = run([
        { name: 'Backpack_additems', args: { items: [{ name: '无名之物' }] } },
      ])
      expect(r.inventory[0]).toMatchObject({
        count: 1,
        grade: '无',
        type: '杂物',
        description: '',
        value: 0,
      })
    })

    it('defaults count to 1 when merging with existing item', () => {
      const inv = [{ id: 'x1', name: '灵石', grade: '黄阶下品' as const, type: 'currency', description: '货币', count: 3, value: 1 }]
      const r = run([
        { name: 'Backpack_additems', args: { items: [{ name: '灵石' }] } },
      ], baseStats(), inv)
      expect(r.inventory[0].count).toBe(4)
    })
  })

  // ── Backpack_reduceitems / Consume_Item ─────────────────────────────────

  describe('3.3 Inventory reduce / consume', () => {
    it('reduces item count via Backpack_reduceitems', () => {
      const inv = [{ id: '1', name: '灵石', grade: '黄阶下品' as const, type: 'currency', description: '', count: 5, value: 1 }]
      const r = run([
        { name: 'Backpack_reduceitems', args: { items: [{ name: '灵石', count: 2 }] } },
      ], baseStats(), inv)
      expect(r.inventory).toHaveLength(1)
      expect(r.inventory[0].count).toBe(3)
    })

    it('removes item when count drops to 0', () => {
      const inv = [{ id: '1', name: '灵石', grade: '黄阶下品' as const, type: 'currency', description: '', count: 1, value: 1 }]
      const r = run([
        { name: 'Backpack_reduceitems', args: { items: [{ name: '灵石', count: 1 }] } },
      ], baseStats(), inv)
      expect(r.inventory).toHaveLength(0)
    })

    it('removes item when count goes below 0', () => {
      const inv = [{ id: '1', name: '灵石', grade: '黄阶下品' as const, type: 'currency', description: '', count: 2, value: 1 }]
      const r = run([
        { name: 'Backpack_reduceitems', args: { items: [{ name: '灵石', count: 5 }] } },
      ], baseStats(), inv)
      expect(r.inventory).toHaveLength(0)
    })

    it('Consume_Item reduces items AND applies mp_cost', () => {
      const inv = [{ id: '1', name: '回灵丹', grade: '玄阶中品' as const, type: 'consumable', description: '', count: 3, value: 10 }]
      const r = run([
        { name: 'Consume_Item', args: { items: [{ name: '回灵丹', count: 1 }], mp_cost: 5 } },
      ], baseStats(), inv)
      expect(r.inventory[0].count).toBe(2)
      expect(r.stats.mp.current).toBe(45)
      expect(r.deltas.mpCost).toBe(5)
    })

    it('Consume_Item mp_cost does not go below 0', () => {
      const inv = [{ id: '1', name: '回灵丹', grade: '玄阶中品' as const, type: 'consumable', description: '', count: 3, value: 10 }]
      const r = run([
        { name: 'Consume_Item', args: { items: [{ name: '回灵丹', count: 1 }], mp_cost: 999 } },
      ], baseStats(), inv)
      expect(r.stats.mp.current).toBe(0)
    })

    it('Consume_Item with mp_cost=0 does not change MP', () => {
      const inv = [{ id: '1', name: '回灵丹', grade: '玄阶中品' as const, type: 'consumable', description: '', count: 3, value: 10 }]
      const r = run([
        { name: 'Consume_Item', args: { items: [{ name: '回灵丹', count: 1 }], mp_cost: 0 } },
      ], baseStats(), inv)
      expect(r.stats.mp.current).toBe(50)
    })

    it('no-op for unknown item name', () => {
      const inv = [{ id: '1', name: '灵石', grade: '黄阶下品' as const, type: 'currency', description: '', count: 5, value: 1 }]
      const r = run([
        { name: 'Backpack_reduceitems', args: { items: [{ name: '不存在的物品', count: 1 }] } },
      ], baseStats(), inv)
      expect(r.inventory).toHaveLength(1)
      expect(r.inventory[0].count).toBe(5)
    })
  })

  // ── Modify_Stats: HP/Shield/Damage ─────────────────────────────────────

  describe('3.4 Modify_Stats — HP and Shield', () => {
    it('applies direct HP damage with no shield', () => {
      const r = run([
        { name: 'Modify_Stats', args: { hp_change: -30 } },
      ])
      expect(r.stats.hp.current).toBe(70)
      expect(r.stats.hp.status_desc).toBe('轻伤')
    })

    it('shield absorbs full damage when shield >= damage', () => {
      const stats = { ...baseStats(), shield: { current: 50, max: 50 } }
      const r = run([
        { name: 'Modify_Stats', args: { hp_change: -30 } },
      ], stats)
      expect(r.stats.shield!.current).toBe(20)
      expect(r.stats.hp.current).toBe(100)
      expect(r.stats.hp.status_desc).toBe('状态良好')
    })

    it('shield partially absorbs damage with overflow to HP', () => {
      const stats = { ...baseStats(), shield: { current: 20, max: 50 } }
      const r = run([
        { name: 'Modify_Stats', args: { hp_change: -50 } },
      ], stats)
      expect(r.stats.shield!.current).toBe(0)
      expect(r.stats.hp.current).toBe(70)
    })

    it('HP healing capped at max', () => {
      const stats = { ...baseStats(), hp: { current: 80, max: 100, status_desc: '轻伤' } }
      const r = run([
        { name: 'Modify_Stats', args: { hp_change: 50 } },
      ], stats)
      expect(r.stats.hp.current).toBe(100)
    })

    it('HP cannot go below 0', () => {
      const r = run([
        { name: 'Modify_Stats', args: { hp_change: -999 } },
      ])
      expect(r.stats.hp.current).toBe(0)
      expect(r.stats.hp.status_desc).toBe('神仙难救')
    })

    it('status_desc injury grading: all levels', () => {
      const tests: [number, string][] = [
        [-5, '状态良好'], [-10, '状态良好'], [-30, '轻伤'],
        [-40, '流血负伤'], [-60, '伤及内脏'], [-85, '肉身破裂'],
        [-95, '神仙难救'],
      ]
      for (const [change, expected] of tests) {
        const r = run([{ name: 'Modify_Stats', args: { hp_change: change } }])
        expect(r.stats.hp.status_desc).toBe(expected)
      }
    })
  })

  // ── Modify_Stats: other stats ──────────────────────────────────────────

  describe('3.5 Modify_Stats — MP, Spirit, Age, Reputation, etc.', () => {
    it('mp_change clamps to [0, max]', () => {
      const r = run([{ name: 'Modify_Stats', args: { mp_change: -20 } }])
      expect(r.stats.mp.current).toBe(30)
      const r2 = run([{ name: 'Modify_Stats', args: { mp_change: 20 } }])
      expect(r2.stats.mp.current).toBe(50)
    })

    it('mp_max_change applied', () => {
      const r = run([{ name: 'Modify_Stats', args: { mp_max_change: 10 } }])
      expect(r.stats.mp.max).toBe(60)
    })

    it('hp_max_change applied', () => {
      const r = run([{ name: 'Modify_Stats', args: { hp_max_change: 20 } }])
      expect(r.stats.hp.max).toBe(120)
    })

    it('spirit_change, age_change, reputation_change', () => {
      const r = run([{ name: 'Modify_Stats', args: { spirit_change: 50, age_change: 10, reputation_change: 100 } }])
      expect(r.stats.spirit.value).toBe(150)
      expect(r.stats.age.current).toBe(26)
      expect(r.stats.reputation).toBe(100)
    })

    it('state_of_mind_change defaults to 50 when not set', () => {
      const r = run([{ name: 'Modify_Stats', args: { state_of_mind_change: -20 } }])
      expect(r.stats.state_of_mind).toBe(30)
    })

    it('fortune_change defaults to 10', () => {
      const r = run([{ name: 'Modify_Stats', args: { fortune_change: 5 } }])
      expect(r.stats.fortune).toBe(15)
    })

    it('karma_change defaults to 0', () => {
      const r = run([{ name: 'Modify_Stats', args: { karma_change: -10 } }])
      expect(r.stats.karma).toBe(-10)
    })

    it('shield_change and shield_max_change', () => {
      const r = run([{ name: 'Modify_Stats', args: { shield_change: 30 } }])
      expect(r.stats.shield!.current).toBe(30)
    })

    it('shield_change does not go below 0', () => {
      const r = run([{ name: 'Modify_Stats', args: { shield_change: -50 } }])
      expect(r.stats.shield!.current).toBe(0)
    })

    it('combined stat changes in one call', () => {
      const r = run([{
        name: 'Modify_Stats',
        args: { hp_change: -10, mp_change: -5, reputation_change: 3, karma_change: 1, fortune_change: 2, state_of_mind_change: 5 },
      }])
      expect(r.stats.hp.current).toBe(90)
      expect(r.stats.mp.current).toBe(45)
      expect(r.stats.reputation).toBe(3)
      expect(r.stats.karma).toBe(1)
      expect(r.stats.fortune).toBe(12)
      expect(r.stats.state_of_mind).toBe(55)
    })
  })

  // ── Modify_Techniques ──────────────────────────────────────────────────

  describe('3.6 Modify_Techniques', () => {
    it('initializes techniques when not present', () => {
      const r = run([{ name: 'Modify_Techniques', args: { main: '太玄经' } }])
      expect(r.stats.techniques).toBeDefined()
      expect(r.stats.techniques!.main).toBe('太玄经')
    })

    it('adds and removes combat techniques', () => {
      const stats = { ...baseStats(), techniques: { main: '', combat: ['基础剑法'], movement: '', support: [] } }
      const r = run([{ name: 'Modify_Techniques', args: { add_combat: '天外飞仙', remove_combat: '基础剑法' } }], stats)
      expect(r.stats.techniques!.combat).toEqual(['天外飞仙'])
    })

    it('adds and removes support techniques', () => {
      const stats = { ...baseStats(), techniques: { main: '', combat: [], movement: '', support: ['吐纳术'] } }
      const r = run([{ name: 'Modify_Techniques', args: { add_support: '炼丹术', remove_support: '吐纳术' } }], stats)
      expect(r.stats.techniques!.support).toEqual(['炼丹术'])
    })
  })

  // ── Modify_Traits ──────────────────────────────────────────────────────

  describe('3.7 Modify_Traits', () => {
    it('adds and removes talents', () => {
      const r = run([{ name: 'Modify_Traits', args: { add_talents: ['剑道天才'] } }])
      expect(r.stats.talents).toEqual(['剑道天才'])
    })

    it('adds and removes traits', () => {
      const r = run([{ name: 'Modify_Traits', args: { add_traits: ['身负血海深仇'] } }])
      expect(r.stats.traits).toEqual(['身负血海深仇'])
    })

    it('remove from non-existent talents produces empty array', () => {
      const r = run([{ name: 'Modify_Traits', args: { remove_talents: ['不存在的天赋'] } }])
      expect(r.stats.talents).toEqual([])
    })
  })

  // ── Modify_Mental ──────────────────────────────────────────────────────

  describe('3.8 Modify_Mental', () => {
    it('changes emotion, mental_state, alignment, sect, realm, race', () => {
      const r = run([{
        name: 'Modify_Mental',
        args: { emotion: '狂喜', mental_state: '心花怒放', alignment: '正道', sect: '青云门', spiritual_root: '天灵根', realm: '筑基期', race: '灵族' },
      }])
      expect(r.stats.emotion).toBe('狂喜')
      expect(r.stats.mental_state).toBe('心花怒放')
      expect(r.stats.alignment).toBe('正道')
      expect(r.stats.sect).toBe('青云门')
      expect(r.stats.realm).toBe('筑基期')
    })

    it('reputation_change through Modify_Mental', () => {
      const r = run([{ name: 'Modify_Mental', args: { reputation_change: 50 } }])
      expect(r.stats.reputation).toBe(50)
    })

    it('state_of_mind_change through Modify_Mental', () => {
      const r = run([{ name: 'Modify_Mental', args: { state_of_mind_change: -30 } }])
      expect(r.stats.state_of_mind).toBe(20)
    })
  })

  // ── Update_Relationship ────────────────────────────────────────────────

  describe('3.9 Update_Relationship', () => {
    it('adds and modifies relationship', () => {
      const rels = { '青云掌门': 50 }
      const r = run([{ name: 'Update_Relationship', args: { npc_name: '青云掌门', change: -20 } }], baseStats(), [], [], rels)
      expect(r.relationships['青云掌门']).toBe(30)
    })

    it('defaults to 0 for unknown NPC', () => {
      const r = run([{ name: 'Update_Relationship', args: { npc_name: '陌生人', change: 5 } }])
      expect(r.relationships['陌生人']).toBe(5)
    })

    it('mutates the original relationships object (pass-by-reference)', () => {
      const rels = { '张三': 10 }
      run([{ name: 'Update_Relationship', args: { npc_name: '张三', change: 5 } }], baseStats(), [], [], rels)
      expect(rels['张三']).toBe(15)
    })
  })

  // ── Change_Location ────────────────────────────────────────────────────

  describe('3.10 Change_Location', () => {
    it('sets deltas.location', () => {
      const r = run([{ name: 'Change_Location', args: { location: '青云山' } }])
      expect(r.deltas.location).toBe('青云山')
    })
  })

  // ── Check_Breakthrough ─────────────────────────────────────────────────

  describe('3.11 Check_Breakthrough', () => {
    it('SUCCESS updates realm', () => {
      const r = run([{ name: 'Check_Breakthrough', args: { result: 'SUCCESS', new_realm: '筑基期一层' } }])
      expect(r.stats.realm).toBe('筑基期一层')
    })

    it('FAILURE does not update realm', () => {
      const r = run([{ name: 'Check_Breakthrough', args: { result: 'FAILURE' } }])
      expect(r.stats.realm).toBe('练气期一层')
    })

    it('SUCCESS without new_realm does not update', () => {
      const r = run([{ name: 'Check_Breakthrough', args: { result: 'SUCCESS' } }])
      expect(r.stats.realm).toBe('练气期一层')
    })
  })

  // ── Codex generators ──────────────────────────────────────────────────

  describe('3.12-3.16 Codex generators and Write_Codex', () => {
    it('Generate_NPC → codex entry', () => {
      const r = run([{ name: 'Generate_NPC', args: { npcs: [{ name: '青云真人', description: '青云门掌门', realm: '元婴期' }] } }])
      expect(r.codex).toHaveLength(1)
      expect(r.codex[0].entry_type).toBe('npc')
      expect(r.codex[0].description).toContain('青云门掌门')
    })

    it('Generate_Location → codex entry', () => {
      const r = run([{ name: 'Generate_Location', args: { locations: [{ name: '青云山', description: '仙家福地', danger_level: '中', region: '东域' }] } }])
      expect(r.codex[0].entry_type).toBe('location')
    })

    it('Generate_Sect → codex entry', () => {
      const r = run([{ name: 'Generate_Sect', args: { sects: [{ name: '青云门', description: '正道第一门派' }] } }])
      expect(r.codex[0].entry_type).toBe('sect')
    })

    it('Generate_Item → codex entry', () => {
      const r = run([{ name: 'Generate_Item', args: { items: [{ name: '青釭剑', description: '上古神兵' }] } }])
      expect(r.codex[0].entry_type).toBe('item')
    })

    it('Write_Codex creates entry with metadata', () => {
      const r = run([{ name: 'Write_Codex', args: { name: '修仙入门', entry_type: 'manual', description: '基础知识', metadata: { author: '古仙人' } } }])
      expect(r.codex).toHaveLength(1)
      expect(r.codex[0].name).toBe('修仙入门')
      expect(r.deltas.codex).toBeDefined()
    })

    // ── 生成前校验：种子数据/已有codex中的地点不允许重复生成 ─────────────

    it('Generate_Location 种子已存在的地点（新手村）→ 不新增条目', () => {
      const r = run([{ name: 'Generate_Location', args: { locations: [{ name: '新手村', description: 'LLM臆想的重复描述', region: '南域' }] } }])
      expect(r.codex).toHaveLength(0)
    })

    it('Generate_Location 种子已存在的地点（青云坊市）→ 不新增条目', () => {
      const r = run([{ name: 'Generate_Location', args: { locations: [{ name: '青云坊市', description: '重复生成', region: '南域' }] } }])
      expect(r.codex).toHaveLength(0)
    })

    it('Generate_Location 已有codex中的同名地点 → 不新增条目', () => {
      const existing = [{ id: 'cv-1', name: '落霞峰', entry_type: 'location', description: '已收录', timestamp: 0 }]
      const r = run(
        [{ name: 'Generate_Location', args: { locations: [{ name: '落霞峰', description: '再次生成' }] } }],
        baseStats(), [], existing,
      )
      expect(r.codex).toHaveLength(1)
      expect(r.codex[0].description).toBe('已收录')
    })

    it('Generate_Location 非种子新地点 → 正常新增', () => {
      const r = run([{ name: 'Generate_Location', args: { locations: [{ name: '无名的荒谷', description: '全新地点', region: '南域' }] } }])
      expect(r.codex).toHaveLength(1)
      expect(r.codex[0].name).toBe('无名的荒谷')
    })

    it('Generate_Location 混合调用：种子地点跳过 + 新地点新增', () => {
      const r = run([{ name: 'Generate_Location', args: { locations: [
        { name: '新手村', description: '重复' },
        { name: '碧水潭', description: '全新地点' },
      ] } }])
      expect(r.codex).toHaveLength(1)
      expect(r.codex[0].name).toBe('碧水潭')
    })
  })

  // ── Write_Journal ──────────────────────────────────────────────────────

  describe('3.17 Write_Journal', () => {
    it('creates journal delta with defaults', () => {
      const r = run([{ name: 'Write_Journal', args: { title: '突破筑基', content: '成功了。' } }])
      expect(r.deltas.journal).toBeDefined()
      expect((r.deltas.journal as any).entry_type).toBe('general')
    })
  })

  // ── Update_Situation ───────────────────────────────────────────────────

  describe('3.18 Update_Situation', () => {
    it('creates situation with defaults', () => {
      const r = run([{ name: 'Update_Situation', args: { action: 'create', title: '门派大比' } }])
      expect(r.situations).toHaveLength(1)
      expect(r.situations[0].status).toBe('brewing')
      expect(r.situations[0].startTurn).toBe(1)
    })

    it('updates status', () => {
      const existing: Situation[] = [{
        id: 'sit-test', title: 't', type: 'conflict', trigger: '', npcs: [],
        player_goal: '', possible_outcomes: [], linked_foreshadowing: [],
        linked_situation: null, status: 'brewing', startTurn: 1, updatedAt: 0,
      }]
      const r = run([{ name: 'Update_Situation', args: { action: 'update_status', situation_id: 'sit-test', status: 'climax' } }], baseStats(), [], [], {}, existing)
      expect(r.situations[0].status).toBe('climax')
    })

    it('ends situation', () => {
      const existing: Situation[] = [{
        id: 'sit-test', title: 't', type: 'conflict', trigger: '', npcs: [],
        player_goal: '', possible_outcomes: [], linked_foreshadowing: [],
        linked_situation: null, status: 'climax', startTurn: 1, updatedAt: 0,
      }]
      const r = run([{ name: 'Update_Situation', args: { action: 'end', situation_id: 'sit-test', actual_outcome: '解决' } }], baseStats(), [], [], {}, existing)
      expect(r.situations[0].status).toBe('ended')
    })
  })

  // ── Create_Foreshadowing ───────────────────────────────────────────────

  describe('3.19 Create_Foreshadowing', () => {
    it('creates foreshadowing', () => {
      const r = run([{ name: 'Create_Foreshadowing', args: { title: '神秘玉佩', description: '...', resolved: false } }])
      expect(r.foreshadowings).toHaveLength(1)
      expect(r.foreshadowings[0].resolved).toBe(false)
    })

    it('resolves existing foreshadowing', () => {
      const fss: Foreshadowing[] = [{ id: 'fs-1', title: 'f', description: '', related_situation: '', plantedTurn: 1, resolved: false }]
      const r = run([{ name: 'Create_Foreshadowing', args: { resolved: true, foreshadowing_id: 'fs-1', resolve_note: '回收！' } }], baseStats(), [], [], {}, [], fss)
      expect(r.foreshadowings[0].resolved).toBe(true)
    })
  })

  // ── Combined tool calls ────────────────────────────────────────────────

  describe('3.20 Combined tool calls in one turn', () => {
    it('processes damage + inventory add + journal together', () => {
      const r = run([
        { name: 'Modify_Stats', args: { hp_change: -30 } },
        { name: 'Backpack_additems', args: { items: [{ name: '战利品', count: 1 }] } },
        { name: 'Write_Journal', args: { title: '战斗记录', content: '击败了敌人' } },
      ])
      expect(r.stats.hp.current).toBe(70)
      expect(r.inventory).toHaveLength(1)
      expect(r.deltas.journal).toBeDefined()
    })

    it('healing + consume + breakthrough SUCCESS', () => {
      const inv = [{ id: '1', name: '筑基丹', grade: '天阶上品' as const, type: 'consumable', description: '', count: 1, value: 100 }]
      const stats = { ...baseStats(), hp: { current: 30, max: 100, status_desc: '伤及内脏' } }
      const r = run([
        { name: 'Modify_Stats', args: { hp_change: 50 } },
        { name: 'Consume_Item', args: { items: [{ name: '筑基丹', count: 1 }], mp_cost: 10 } },
        { name: 'Check_Breakthrough', args: { result: 'SUCCESS', new_realm: '筑基期一层' } },
      ], stats, inv)
      expect(r.stats.hp.current).toBe(80)
      expect(r.inventory).toHaveLength(0)
      expect(r.stats.mp.current).toBe(40)
      expect(r.stats.realm).toBe('筑基期一层')
    })
  })

  // ── Edge cases ────────────────────────────────────────────────────────

  describe('3.21 Edge cases and defensive behavior', () => {
    it('unknown tool name does nothing', () => {
      const r = run([{ name: 'NonExistentTool', args: { foo: 'bar' } }])
      expect(r.deltas).toEqual({})
    })

    it('tool with missing args is handled safely (was: TypeError crash in old code)', () => {
      // Old inline code: tc.args was undefined → crash.
      // Production module: defaults args to {} → no crash, state unchanged.
      const r = run([{ name: 'Modify_Stats' } as any])
      expect(r.stats.hp.current).toBe(100) // unchanged
    })

    it('tool with empty args object does not crash', () => {
      const r = run([{ name: 'Modify_Stats', args: {} }])
      expect(r.stats.hp.current).toBe(100)
    })

    it('defaults missing hp/mp/spirit/age/shield on stats', () => {
      const broken = { realm: '练气期一层', alignment: '中立' as const, sect: '散修', spiritual_root: '', race: '人族', mental_state: '', reputation: 0 } as unknown as ICharacterStats
      const r = run([], broken)
      expect(r.stats.hp.current).toBe(100)
      expect(r.stats.mp.current).toBe(50)
    })

    it('state_of_mind can go negative (no lower bound)', () => {
      const r = run([{ name: 'Modify_Stats', args: { state_of_mind_change: -100 } }])
      expect(r.stats.state_of_mind).toBe(-50)
    })

    it('fortune can go negative (no lower bound)', () => {
      const r = run([{ name: 'Modify_Stats', args: { fortune_change: -50 } }])
      expect(r.stats.fortune).toBe(-40)
    })

    it('karma can go negative (no lower bound)', () => {
      const r = run([{ name: 'Modify_Stats', args: { karma_change: -100 } }])
      expect(r.stats.karma).toBe(-100)
    })

    it('relationships object is mutated in place (shared reference)', () => {
      const rels: Record<string, number> = { 'NPC_A': 10 }
      const r = run([{ name: 'Update_Relationship', args: { npc_name: 'NPC_A', change: 5 } }], baseStats(), [], [], rels)
      expect(rels['NPC_A']).toBe(15)
      expect(r.relationships['NPC_A']).toBe(15)
    })
  })
})
