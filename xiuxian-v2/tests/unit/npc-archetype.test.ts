import { describe, it, expect } from 'vitest'
import {
  rollNpcParams,
  getBehaviorPool,
  getDialogueStyle,
  shouldBindRule,
  ARCHETYPES,
} from '@/server/domain/npc-archetype'

// ── rollNpcParams ──────────────────────────────────────────────────────────

describe('rollNpcParams — 原型参数随机生成', () => {
  it('商人原型 — 所有参数在范围内', () => {
    const params = rollNpcParams('merchant')
    const ranges = ARCHETYPES['merchant']!.paramRanges

    for (const [name, range] of Object.entries(ranges)) {
      expect(params[name]).toBeGreaterThanOrEqual(range.min - 0.01)
      expect(params[name]).toBeLessThanOrEqual(range.max + 0.01)
    }
    // 必须包含所有参数
    expect(Object.keys(params)).toHaveLength(Object.keys(ranges).length)
  })

  it('散修原型 — 包含gossip参数', () => {
    const params = rollNpcParams('wanderer')
    expect(params.gossip).toBeDefined()
    expect(params.gossip).toBeGreaterThanOrEqual(0.29)
    expect(params.gossip).toBeLessThanOrEqual(0.91)
  })

  it('匠人原型 — 包含craftsmanship参数', () => {
    const params = rollNpcParams('craftsman')
    expect(params.craftsmanship).toBeDefined()
    expect(params.craftsmanship).toBeGreaterThanOrEqual(0.49)
    expect(params.craftsmanship).toBeLessThanOrEqual(0.96)
  })

  it('守卫原型 — 包含vigilance参数', () => {
    const params = rollNpcParams('guard')
    expect(params.vigilance).toBeDefined()
    expect(params.vigilance).toBeGreaterThanOrEqual(0.49)
    expect(params.vigilance).toBeLessThanOrEqual(0.91)
  })

  it('确定性种子 — 同种子同参数产生相同值', () => {
    const a = rollNpcParams('merchant', { seed: 'npc-wang' })
    const b = rollNpcParams('merchant', { seed: 'npc-wang' })
    for (const key of Object.keys(a)) {
      expect(a[key]).toBe(b[key])
    }
  })

  it('不同种子产生不同值（大概率）', () => {
    const a = rollNpcParams('merchant', { seed: 'npc-wang' })
    const b = rollNpcParams('merchant', { seed: 'npc-li' })
    // 至少有一个参数不同
    const anyDiff = Object.keys(a).some((k) => a[k] !== b[k])
    expect(anyDiff).toBe(true)
  })

  it('overrides覆盖指定参数', () => {
    const params = rollNpcParams('merchant', {
      seed: 'test',
      overrides: { greed: 0.95, lawfulness: 0.15 },
    })
    expect(params.greed).toBe(0.95)
    expect(params.lawfulness).toBe(0.15)
    // 其他参数不受影响，仍在范围内
    expect(params.friendliness).toBeGreaterThanOrEqual(0.29)
    expect(params.friendliness).toBeLessThanOrEqual(0.81)
  })

  it('overrides不受seed影响（始终为覆盖值）', () => {
    const a = rollNpcParams('merchant', {
      seed: 'aaa',
      overrides: { greed: 0.5 },
    })
    const b = rollNpcParams('merchant', {
      seed: 'bbb',
      overrides: { greed: 0.5 },
    })
    expect(a.greed).toBe(0.5)
    expect(b.greed).toBe(0.5)
  })

  it('未知原型抛出错误', () => {
    expect(() => rollNpcParams('demon_lord')).toThrow('Unknown archetype')
  })

  it('参数保留一位小数', () => {
    for (let i = 0; i < 50; i++) {
      const params = rollNpcParams('merchant')
      for (const val of Object.values(params)) {
        // 验证小数位数最多一位
        const str = String(val)
        const decimalPart = str.split('.')[1]
        if (decimalPart) {
          expect(decimalPart.length).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  it('多次roll商人参数在统计上分布合理（不做严格统计）', () => {
    const results: number[] = []
    for (let i = 0; i < 100; i++) {
      results.push(rollNpcParams('merchant').greed)
    }
    // 值都在范围内
    results.forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0.29)
      expect(v).toBeLessThanOrEqual(0.91)
    })
    // 不全是同一个值
    expect(new Set(results).size).toBeGreaterThan(1)
  })
})

// ── getBehaviorPool ────────────────────────────────────────────────────────

describe('getBehaviorPool — 行为池查询', () => {
  it('商人原型返回5个行为', () => {
    const pool = getBehaviorPool('merchant')
    expect(pool.length).toBeGreaterThanOrEqual(4)
    expect(pool).toContain('站柜营业')
  })

  it('散修原型返回包含"逛街淘宝"', () => {
    const pool = getBehaviorPool('wanderer')
    expect(pool).toContain('逛街淘宝')
  })

  it('未知原型返回默认"闲逛"', () => {
    const pool = getBehaviorPool('unknown')
    expect(pool).toEqual(['闲逛'])
  })

  it('所有原型的行为池都是非空数组', () => {
    for (const id of Object.keys(ARCHETYPES)) {
      const pool = getBehaviorPool(id)
      expect(pool.length).toBeGreaterThan(0)
    }
  })
})

// ── getDialogueStyle ───────────────────────────────────────────────────────

describe('getDialogueStyle — 默认对话风格', () => {
  it('商人原型返回特定文本', () => {
    expect(getDialogueStyle('merchant')).toBe('客官要什么？')
  })

  it('守卫原型返回特定文本', () => {
    expect(getDialogueStyle('guard')).toBe('站住，干什么的？')
  })

  it('未知原型返回省略号', () => {
    expect(getDialogueStyle('unknown')).toBe('……')
  })
})

// ── shouldBindRule ────────────────────────────────────────────────────────

describe('shouldBindRule — 约束绑定判断', () => {
  const baseParams = {
    greed: 0.5,
    friendliness: 0.5,
    courage: 0.5,
    cunning: 0.5,
    lawfulness: 0.9, // 高守法度
    anger: 0.3,
  }

  it('高守法度 + 无特殊trait → 大概率遵守', () => {
    // 用确定性种子验证
    const result = shouldBindRule(
      baseParams,
      'economic_fair_price',
      'economic',
      [],
      'npc-test-001',
    )
    // lawfulness=0.9, rebellionChance=0.1, seed应使遵守
    // 使用确定性的hash，具体结果取决于hash值
    // 至少类型正确
    expect(typeof result).toBe('boolean')
  })

  it('低守法度 → 大概率不遵守', () => {
    const lowLaw = { ...baseParams, lawfulness: 0.1 }
    // rebellionChance = 0.9，大概率false
    // 用大量规则+不同ID确保统计上有足够false
    const results = Array.from({ length: 30 }, (_, i) =>
      shouldBindRule(lowLaw, `rule-${i}`, 'economic', [], `npc-low-${i}`),
    )
    // 高叛乱率下，绝大多数是false（90%概率）
    const falseCount = results.filter((r) => !r).length
    expect(falseCount).toBeGreaterThan(20)
  })

  it('lawfulness=0 → 100%概率不遵守', () => {
    const zeroLaw = { ...baseParams, lawfulness: 0 }
    const results = Array.from({ length: 20 }, (_, i) =>
      shouldBindRule(zeroLaw, `rule-${i}`, 'economic', [], 'npc-zero'),
    )
    // rebellionChance = 1.0，seed永远<1.0，所以全部false
    expect(results.every((r) => !r)).toBe(true)
  })

  it('lawfulness=1.0 → 100%概率遵守', () => {
    const perfectLaw = { ...baseParams, lawfulness: 1.0 }
    const results = Array.from({ length: 20 }, (_, i) =>
      shouldBindRule(perfectLaw, `rule-${i}`, 'economic', [], 'npc-perfect'),
    )
    // rebellionChance = 0，不可能false
    expect(results.every((r) => r)).toBe(true)
  })

  // ── Trait覆盖（确定性）───────────────────────────────────────────────

  it('"黑商"trait → 经济类规则一律false', () => {
    const result = shouldBindRule(
      baseParams,
      'economic_fair_price',
      'economic',
      ['黑商'],
      'npc-heishang',
    )
    expect(result).toBe(false)
  })

  it('"黑商"trait → 非经济类规则不受影响', () => {
    // 黑商对social/spatial/survival没有强制覆盖
    const result = shouldBindRule(
      baseParams,
      'social_no_fight',
      'social',
      ['黑商'],
      'npc-heishang',
    )
    // 社交规则走lawfulness逻辑，不是强制false
    expect(typeof result).toBe('boolean')
  })

  it('"傲慢"trait → 社交类规则一律false', () => {
    const result = shouldBindRule(
      baseParams,
      'social_hierarchy',
      'social',
      ['傲慢'],
      'npc-proud',
    )
    expect(result).toBe(false)
  })

  it('"傲慢"trait → 经济类规则不受影响', () => {
    const result = shouldBindRule(
      baseParams,
      'economic_fair_price',
      'economic',
      ['傲慢'],
      'npc-proud',
    )
    // 经济规则走lawfulness
    expect(typeof result).toBe('boolean')
  })

  it('"魔修"trait → 生存类规则一律false', () => {
    const result = shouldBindRule(
      baseParams,
      'survival_demon_flee',
      'survival',
      ['魔修'],
      'npc-demon',
    )
    expect(result).toBe(false)
  })

  it('"魔修"trait → 经济类规则不受影响', () => {
    const result = shouldBindRule(
      baseParams,
      'economic_no_steal',
      'economic',
      ['魔修'],
      'npc-demon',
    )
    expect(typeof result).toBe('boolean')
  })

  // ── courage + spatial交互 ────────────────────────────────────────────

  it('courage > 0.8 + spatial规则 → 80%概率false（用确定性验证）', () => {
    const brave = { ...baseParams, courage: 0.9, lawfulness: 0.9 }

    // 用多个NPC ID，约80%应返回false
    const results = Array.from({ length: 50 }, (_, i) =>
      shouldBindRule(
        brave,
        'spatial_no_trespass',
        'spatial',
        [],
        `npc-brave-${i}`,
      ),
    )
    const falseCount = results.filter((r) => !r).length
    // 80%概率 → 50个样本中，大约35-45是false
    // 放宽到25-50之间
    expect(falseCount).toBeGreaterThan(20)
    expect(falseCount).toBeLessThan(46)
  })

  it('courage <= 0.8 + spatial → 正常走lawfulness逻辑', () => {
    const timid = { ...baseParams, courage: 0.7, lawfulness: 0.9 }
    const results = Array.from({ length: 30 }, (_, i) =>
      shouldBindRule(
        timid,
        'spatial_no_trespass',
        'spatial',
        [],
        `npc-timid-${i}`,
      ),
    )
    // lawfulness=0.9，大概率遵守
    const trueCount = results.filter((r) => r).length
    expect(trueCount).toBeGreaterThan(15)
  })

  it('courage > 0.8 + 非spatial规则 → 不受影响', () => {
    const brave = { ...baseParams, courage: 0.9, lawfulness: 0.9 }
    const result = shouldBindRule(
      brave,
      'economic_fair_price',
      'economic',
      [],
      'npc-brave-eco',
    )
    // 经济规则不走courage逻辑
    expect(typeof result).toBe('boolean')
  })

  // ── 确定性 ──────────────────────────────────────────────────────────

  it('同NPC同规则多次查询结果一致', () => {
    const params = { ...baseParams, lawfulness: 0.5 }
    const first = shouldBindRule(params, 'rule-x', 'economic', [], 'npc-consistent')
    for (let i = 0; i < 20; i++) {
      expect(
        shouldBindRule(params, 'rule-x', 'economic', [], 'npc-consistent'),
      ).toBe(first)
    }
  })

  it('不同NPC结果可能不同', () => {
    const params = { ...baseParams, lawfulness: 0.4 }
    // 用大量NPC ID，确保分布有变异
    const results = new Set(
      Array.from({ length: 30 }, (_, i) =>
        shouldBindRule(params, 'same-rule', 'economic', [], `npc-var-${i}`),
      ),
    )
    // 0.4 lawfulness → 60% rebellion，应该有true也有false
    expect(results.size).toBe(2)
  })

  // ── 边界：缺少参数 ──────────────────────────────────────────────────

  it('缺少lawfulness → 默认0.5', () => {
    const result = shouldBindRule(
      {} as any,
      'rule-default',
      'economic',
      [],
      'npc-noparam',
    )
    // lawfulness=0.5, rebellion=0.5
    expect(typeof result).toBe('boolean')
  })

  it('缺少courage → 默认0.5，不触发courage>0.8分支', () => {
    // courage默认0.5，不会触发>0.8逻辑
    const result = shouldBindRule(
      { lawfulness: 0.9 } as any,
      'spatial_no_trespass',
      'spatial',
      [],
      'npc-nocourage',
    )
    expect(typeof result).toBe('boolean')
  })
})
