/**
 * Tool schema validation tests (TDD: RED phase).
 *
 * Tests runtime Zod schemas for all LLM tool calls:
 * - Well-formed calls pass
 * - Malformed args fail with MALFORMED_ARGS
 * - Unknown tools fail with UNKNOWN_TOOL
 * - Duplicate tools fail with DUPLICATE_TOOL
 * - Contradictory tools fail with CONTRADICTORY_TOOLS
 */
import { describe, it, expect } from 'vitest'
import {
  validateToolCalls,
  TOOL_SCHEMAS,
  KNOWN_TOOL_NAMES,
  type ToolName,
} from '@/server/domain/tool-schemas'

// ─── Helpers ───────────────────────────────────────────────────────────────

function validCall(name: ToolName, args: Record<string, unknown>) {
  return { name, args }
}

function callWithoutArgs(name: string) {
  return { name }
}

// ─── TESTS ─────────────────────────────────────────────────────────────────

describe('Tool schemas — schema coverage', () => {
  it('all known tools (old + new) are in TOOL_SCHEMAS', () => {
    expect(KNOWN_TOOL_NAMES.length).toBeGreaterThanOrEqual(20)
    expect(KNOWN_TOOL_NAMES).toContain('Backpack_additems')
    expect(KNOWN_TOOL_NAMES).toContain('Search_History')
    expect(KNOWN_TOOL_NAMES).toContain('Skip')
    // New-catalog tools must also be present
    expect(KNOWN_TOOL_NAMES).toContain('SearchArea')
    expect(KNOWN_TOOL_NAMES).toContain('ModifyStats')
    expect(KNOWN_TOOL_NAMES).toContain('ModifyInventory')
    expect(KNOWN_TOOL_NAMES).toContain('ChangeLocation')
  })

  it('every known tool has a Zod schema', () => {
    for (const name of KNOWN_TOOL_NAMES) {
      expect(TOOL_SCHEMAS[name]).toBeDefined()
    }
  })
})

describe('Tool schemas — well-formed calls pass', () => {
  it('Backpack_additems with valid args', () => {
    const r = validateToolCalls([
      validCall('Backpack_additems', {
        items: [{ name: '灵石', count: 5, type: 'currency', grade: '黄阶下品' }],
      }),
    ])
    expect(r.valid).toBe(true)
  })

  it('Backpack_reduceitems with valid args', () => {
    const r = validateToolCalls([
      validCall('Backpack_reduceitems', {
        items: [{ name: '灵石', count: 2 }],
      }),
    ])
    expect(r.valid).toBe(true)
  })

  it('Consume_Item with valid args', () => {
    const r = validateToolCalls([
      validCall('Consume_Item', {
        items: [{ name: '回灵丹', count: 1 }],
        mp_cost: 10,
      }),
    ])
    expect(r.valid).toBe(true)
  })

  it('Consume_Item with only mp_cost (no items)', () => {
    const r = validateToolCalls([
      validCall('Consume_Item', { mp_cost: 20 }),
    ])
    expect(r.valid).toBe(true)
  })

  it('Modify_Stats with multiple stat changes', () => {
    const r = validateToolCalls([
      validCall('Modify_Stats', {
        hp_change: -30,
        mp_change: -10,
        reputation_change: 5,
        karma_change: 2,
      }),
    ])
    expect(r.valid).toBe(true)
  })

  it('Modify_Techniques with all fields', () => {
    const r = validateToolCalls([
      validCall('Modify_Techniques', {
        main: '太玄经',
        add_combat: '天外飞仙',
        movement: '凌波微步',
        add_support: '炼丹术',
      }),
    ])
    expect(r.valid).toBe(true)
  })

  it('Modify_Traits adding talents and traits', () => {
    const r = validateToolCalls([
      validCall('Modify_Traits', {
        add_talents: ['剑道天才', '先天道体'],
        remove_traits: ['胆小鬼'],
      }),
    ])
    expect(r.valid).toBe(true)
  })

  it('Modify_Mental with emotion and realm change', () => {
    const r = validateToolCalls([
      validCall('Modify_Mental', {
        emotion: '狂喜',
        mental_state: '心花怒放',
        alignment: '正道',
        realm: '筑基期',
      }),
    ])
    expect(r.valid).toBe(true)
  })

  it('Update_Relationship', () => {
    const r = validateToolCalls([
      validCall('Update_Relationship', { npc_name: '青云掌门', change: 15 }),
    ])
    expect(r.valid).toBe(true)
  })

  it('Change_Location', () => {
    const r = validateToolCalls([
      validCall('Change_Location', { location: '青云山' }),
    ])
    expect(r.valid).toBe(true)
  })

  it('Check_Breakthrough SUCCESS with new_realm', () => {
    const r = validateToolCalls([
      validCall('Check_Breakthrough', { result: 'SUCCESS', new_realm: '筑基期一层' }),
    ])
    expect(r.valid).toBe(true)
  })

  it('Check_Breakthrough FAIL', () => {
    const r = validateToolCalls([
      validCall('Check_Breakthrough', { result: 'FAIL' }),
    ])
    expect(r.valid).toBe(true)
  })

  it('Generate_NPC', () => {
    const r = validateToolCalls([
      validCall('Generate_NPC', {
        npcs: [{
          name: '青云真人', realm: '元婴期', alignment: '正道',
          sect: '青云门', personality: '威严', relationship: 0,
          description: '青云门掌门',
        }],
      }),
    ])
    expect(r.valid).toBe(true)
  })

  it('Generate_Location', () => {
    const r = validateToolCalls([
      validCall('Generate_Location', {
        locations: [{
          name: '黑木林', region: '南域', danger_level: '中危',
          description: '毒雾弥漫', power_distribution: '散修聚集',
          level_range: '练气到金丹', rules: '禁止飞行',
          peace_orno: '混乱', inhabitants: ['毒修'], bound_items: [],
          bound_locations: ['毒雾沼泽'],
        }],
      }),
    ])
    expect(r.valid).toBe(true)
  })

  it('Generate_Sect', () => {
    const r = validateToolCalls([
      validCall('Generate_Sect', {
        sects: [{
          name: '青云门', alignment: '正道', power_level: '泰山北斗',
          master: '青云真人', master_realm: '元婴期',
          description: '正道第一门派',
        }],
      }),
    ])
    expect(r.valid).toBe(true)
  })

  it('Generate_Item', () => {
    const r = validateToolCalls([
      validCall('Generate_Item', {
        items: [{
          name: '青釭剑', type: '法宝', grade: '地阶上品',
          description: '上古神兵', count: 1, value: 1000,
        }],
      }),
    ])
    expect(r.valid).toBe(true)
  })

  it('Write_Codex', () => {
    const r = validateToolCalls([
      validCall('Write_Codex', {
        name: '修仙入门', entry_type: 'item', description: '基础知识',
      }),
    ])
    expect(r.valid).toBe(true)
  })

  it('Write_Journal', () => {
    const r = validateToolCalls([
      validCall('Write_Journal', {
        title: '突破筑基', content: '成功突破至筑基期。',
      }),
    ])
    expect(r.valid).toBe(true)
  })

  it('Update_Situation create', () => {
    const r = validateToolCalls([
      validCall('Update_Situation', {
        action: 'create', title: '门派大比', type: 'conflict',
        trigger: '青云门发布大比公告', npcs: ['青云掌门'],
        player_goal: '在大比中获胜',
      }),
    ])
    expect(r.valid).toBe(true)
  })

  it('Create_Foreshadowing (unresolved)', () => {
    const r = validateToolCalls([
      validCall('Create_Foreshadowing', {
        title: '神秘玉佩', description: '一块刻着龙纹的古玉', resolved: false,
      }),
    ])
    expect(r.valid).toBe(true)
  })

  it('Create_Foreshadowing (resolved)', () => {
    const r = validateToolCalls([
      validCall('Create_Foreshadowing', {
        resolved: true, foreshadowing_id: 'fs-abc123', resolve_note: '玉佩发光',
      }),
    ])
    expect(r.valid).toBe(true)
  })

  it('Search_History', () => {
    const r = validateToolCalls([
      validCall('Search_History', { query: '青云门', limit: 5 }),
    ])
    expect(r.valid).toBe(true)
  })

  it('Skip', () => {
    const r = validateToolCalls([
      validCall('Skip', { reason: '无事发生' }),
    ])
    expect(r.valid).toBe(true)
  })

  it('multiple valid tool calls in one turn', () => {
    const r = validateToolCalls([
      validCall('Modify_Stats', { hp_change: -30 }),
      validCall('Backpack_additems', {
        items: [{ name: '战利品', count: 1 }],
      }),
      validCall('Write_Journal', { title: '战斗记录', content: '获胜' }),
    ])
    expect(r.valid).toBe(true)
    if (r.valid) expect(r.calls).toHaveLength(3)
  })

  it('empty tool call array is valid', () => {
    const r = validateToolCalls([])
    expect(r.valid).toBe(true)
  })

  it('tool call with no args defaults to empty object for all-optional tools', () => {
    // Modify_Stats has all optional fields, so {} is valid
    const r = validateToolCalls([callWithoutArgs('Modify_Stats')])
    expect(r.valid).toBe(true)
  })
})

// ── Malformed args ──────────────────────────────────────────────────────

describe('Tool schemas — malformed args reject', () => {
  it('Backpack_additems with missing items array', () => {
    const r = validateToolCalls([
      { name: 'Backpack_additems', args: {} },
    ])
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.code).toBe('MALFORMED_ARGS')
  })

  it('Backpack_additems with wrong item field type', () => {
    const r = validateToolCalls([
      validCall('Backpack_additems', {
        items: [{ name: '灵石', count: 'five' }],
      } as unknown as Record<string, unknown>),
    ])
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.code).toBe('MALFORMED_ARGS')
  })

  it('Modify_Stats with string instead of number', () => {
    const r = validateToolCalls([
      validCall('Modify_Stats', { hp_change: 'minus-thirty' }),
    ])
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.code).toBe('MALFORMED_ARGS')
  })

  it('Update_Relationship missing required npc_name', () => {
    const r = validateToolCalls([
      validCall('Update_Relationship', { change: 10 }),
    ])
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.code).toBe('MALFORMED_ARGS')
  })

  it('Check_Breakthrough with invalid result value', () => {
    const r = validateToolCalls([
      validCall('Check_Breakthrough', { result: 'MAYBE' }),
    ])
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.code).toBe('MALFORMED_ARGS')
  })

  it('Generate_NPC with missing required npc fields', () => {
    const r = validateToolCalls([
      validCall('Generate_NPC', {
        npcs: [{ name: 'Test' }], // missing realm, alignment, etc.
      }),
    ])
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.code).toBe('MALFORMED_ARGS')
  })

  it('non-array input produces MALFORMED_ARGS', () => {
    const r = validateToolCalls({ foo: 'bar' })
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.code).toBe('MALFORMED_ARGS')
      expect(r.message).toContain('array')
    }
  })

  it('tool call with missing name field', () => {
    const r = validateToolCalls([{ args: {} }])
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.code).toBe('MALFORMED_ARGS')
  })
})

// ── Unknown tools ───────────────────────────────────────────────────────

describe('Tool schemas — unknown tools', () => {
  it('completely unknown tool name', () => {
    const r = validateToolCalls([
      validCall('NonExistentTool' as ToolName, { foo: 'bar' }),
    ])
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.code).toBe('UNKNOWN_TOOL')
      expect(r.message).toContain('NonExistentTool')
    }
  })

  it('typo of known tool name', () => {
    const r = validateToolCalls([
      validCall('Modify_Stat' as ToolName, { hp_change: -10 }),
    ])
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.code).toBe('UNKNOWN_TOOL')
  })

  it('lowercase version of known tool', () => {
    const r = validateToolCalls([
      validCall('modify_stats' as ToolName, { hp_change: -10 }),
    ])
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.code).toBe('UNKNOWN_TOOL')
  })
})

// ── Duplicate tools ─────────────────────────────────────────────────────

describe('Tool schemas — duplicate detection', () => {
  it('same Modify_Stats called twice', () => {
    const r = validateToolCalls([
      validCall('Modify_Stats', { hp_change: -10 }),
      validCall('Modify_Stats', { mp_change: -5 }),
    ])
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.code).toBe('DUPLICATE_TOOL')
      expect(r.message).toContain('Modify_Stats')
    }
  })

  it('same Backpack_additems called twice', () => {
    const r = validateToolCalls([
      validCall('Backpack_additems', {
        items: [{ name: '灵石', count: 5 }],
      }),
      validCall('Backpack_additems', {
        items: [{ name: '丹药', count: 1 }],
      }),
    ])
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.code).toBe('DUPLICATE_TOOL')
  })

  it('three duplicates — fails on first duplicate', () => {
    const r = validateToolCalls([
      validCall('Write_Journal', { title: 'a', content: 'b' }),
      validCall('Write_Journal', { title: 'c', content: 'd' }),
      validCall('Write_Journal', { title: 'e', content: 'f' }),
    ])
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.code).toBe('DUPLICATE_TOOL')
  })
})

// ── Contradictory tools ─────────────────────────────────────────────────

describe('Tool schemas — contradiction detection', () => {
  it('adding and reducing same item in one turn', () => {
    const r = validateToolCalls([
      validCall('Backpack_additems', {
        items: [{ name: '灵石', count: 5 }],
      }),
      validCall('Backpack_reduceitems', {
        items: [{ name: '灵石', count: 2 }],
      }),
    ])
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.code).toBe('CONTRADICTORY_TOOLS')
      expect(r.message).toContain('灵石')
    }
  })

  it('adding and consuming same item in one turn', () => {
    const r = validateToolCalls([
      validCall('Backpack_additems', {
        items: [{ name: '回灵丹', count: 3 }],
      }),
      validCall('Consume_Item', {
        items: [{ name: '回灵丹', count: 1 }],
      }),
    ])
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.code).toBe('CONTRADICTORY_TOOLS')
  })

  it('different items in add and reduce is not contradictory', () => {
    const r = validateToolCalls([
      validCall('Backpack_additems', {
        items: [{ name: '灵石', count: 5 }],
      }),
      validCall('Backpack_reduceitems', {
        items: [{ name: '丹药', count: 1 }],
      }),
    ])
    expect(r.valid).toBe(true)
  })

  it('breakthrough realm contradicts Modify_Mental realm', () => {
    const r = validateToolCalls([
      validCall('Check_Breakthrough', { result: 'SUCCESS', new_realm: '筑基期一层' }),
      validCall('Modify_Mental', { realm: '金丹期' }),
    ])
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.code).toBe('CONTRADICTORY_TOOLS')
      expect(r.message).toContain('realm')
    }
  })

  it('breakthrough SUCCESS with matching Modify_Mental realm is OK', () => {
    const r = validateToolCalls([
      validCall('Check_Breakthrough', { result: 'SUCCESS', new_realm: '筑基期一层' }),
      validCall('Modify_Mental', { realm: '筑基期一层' }),
    ])
    expect(r.valid).toBe(true)
  })
})

// ── Schema strictness: extra fields ─────────────────────────────────────

describe('Tool schemas — extra/unknown fields', () => {
  it('extra unknown field in Backpack_additems item passes (z.object is not strict by default)', () => {
    const r = validateToolCalls([
      validCall('Backpack_additems', {
        items: [{ name: '灵石', count: 5, extraUnknownField: 'should be stripped' }],
      }),
    ])
    // Zod object() is not strict by default; extra fields are ignored
    expect(r.valid).toBe(true)
  })

  it('completely wrong shape for Modify_Stats', () => {
    const r = validateToolCalls([
      validCall('Modify_Stats', { not_a_stat: true, random_string: 'nope' }),
    ])
    // Extra fields are ignored by Zod by default, so this passes (all fields optional)
    expect(r.valid).toBe(true)
  })
})
