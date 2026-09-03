/**
 * World Genesis 单元测试
 * 固定底层规则模板 + LLM 生成具体内容。测试不依赖 LLM，只测纯函数。
 */
import { describe, it, expect } from 'vitest'
import {
  WORLD_RULES,
  GENESIS_TOOLS,
  BACKGROUND_ENTRY_TYPE,
  needsWorldGenesis,
  buildWorldGenesisPrompt,
  pickStartLocation,
  buildFallbackWorld,
  buildFallbackBackground,
} from '@/server/domain/world-gen'

describe('world-gen: 世界生成系统', () => {
  describe('固定底层规则模板', () => {
    it('大陆固定四域 + 势力格局', () => {
      expect(WORLD_RULES.continent).toBe('苍元大陆')
      expect(WORLD_RULES.regions).toEqual(['北域·冰原', '南域·百越', '东域·沧海', '西域·大漠'])
      expect(WORLD_RULES.forces).toContain('正道')
      expect(WORLD_RULES.playerStart.region).toBe('南域·百越')
    })

    it('GENESIS_TOOLS 只包含生成类工具（不包含状态修改工具）', () => {
      expect(GENESIS_TOOLS).toEqual(['GenerateNpc', 'GenerateLocation', 'GenerateSect', 'AddCodexEntry'])
    })

    it('背景条目类型为 background', () => {
      expect(BACKGROUND_ENTRY_TYPE).toBe('background')
    })
  })

  describe('needsWorldGenesis', () => {
    it('codex 无 location 条目 → 需要生成世界', () => {
      expect(needsWorldGenesis([])).toBe(true)
      expect(needsWorldGenesis([{ entry_type: 'sect' }, { entry_type: 'npc' }])).toBe(true)
    })

    it('codex 已有 location 条目 → 不需要生成', () => {
      expect(needsWorldGenesis([{ entry_type: 'location' }])).toBe(false)
      expect(
        needsWorldGenesis([
          { entry_type: 'npc' },
          { entry_type: 'location' },
          { entry_type: 'background' },
        ]),
      ).toBe(false)
    })
  })

  describe('buildWorldGenesisPrompt', () => {
    const prompt = buildWorldGenesisPrompt({ name: '齐尘', gender: '男', realm: '练气期一层' })

    it('包含固定大陆格局', () => {
      expect(prompt).toContain('苍元大陆')
      expect(prompt).toContain('南域·百越')
      expect(prompt).toContain('北域·冰原')
      expect(prompt).toContain('东域·沧海')
      expect(prompt).toContain('西域·大漠')
      expect(prompt).toContain('正道七宗')
      expect(prompt).toContain('魔道三脉')
    })

    it('包含玩家信息与出生地要求', () => {
      expect(prompt).toContain('齐尘')
      expect(prompt).toContain('男')
      expect(prompt).toContain('练气期一层')
      // 第一个生成的地点必须是玩家出生地
      expect(prompt).toMatch(/第一个.{0,20}出生地/)
      expect(prompt).toContain('南域·百越')
    })

    it('要求生成地点/宗门/NPC/背景四类内容', () => {
      expect(prompt).toContain('GenerateLocation')
      expect(prompt).toContain('GenerateSect')
      expect(prompt).toContain('GenerateNpc')
      expect(prompt).toContain('AddCodexEntry')
      expect(prompt).toContain('background')
    })

    it('明确禁止使用通用名（新手村等）', () => {
      expect(prompt).toContain('禁止使用')
      expect(prompt).toContain('新手村')
      expect(prompt).toContain('青云坊市')
    })

    it('要求工具生成不输出叙事文本', () => {
      expect(prompt).toMatch(/只调用工具|不输出.{0,10}文本|不要.{0,10}文本/)
    })
  })

  describe('pickStartLocation', () => {
    it('返回第一个 location 条目名', () => {
      const codex = [
        { name: '青牛村', entry_type: 'location' },
        { name: '云台坊市', entry_type: 'location' },
        { name: '上清宗', entry_type: 'sect' },
      ]
      expect(pickStartLocation(codex)).toBe('青牛村')
    })

    it('无 location 条目时返回空字符串', () => {
      expect(pickStartLocation([])).toBe('')
      expect(pickStartLocation([{ name: '上清宗', entry_type: 'sect' }])).toBe('')
    })
  })

  describe('buildFallbackWorld（genesis 失败兜底）', () => {
    const fallback = buildFallbackWorld({ name: '齐尘', gender: '男', realm: '练气期一层' })

    it('包含至少 1 个 location + 1 个 background 条目', () => {
      expect(fallback.codex.some((e) => e.entry_type === 'location')).toBe(true)
      expect(fallback.codex.some((e) => e.entry_type === BACKGROUND_ENTRY_TYPE)).toBe(true)
    })

    it('不使用"新手村"等通用名', () => {
      expect(fallback.codex.some((e) => e.name === '新手村')).toBe(false)
      expect(fallback.currentLocation).not.toBe('新手村')
    })

    it('currentLocation 指向兜底村庄', () => {
      const village = fallback.codex.find((e) => e.entry_type === 'location')
      expect(fallback.currentLocation).toBe(village?.name)
    })

    it('兜底背景包含玩家名', () => {
      const bg = fallback.codex.find((e) => e.entry_type === BACKGROUND_ENTRY_TYPE)
      expect(bg?.description).toContain('齐尘')
    })

    it('兜底世界条目字段完整（description/metadata/timestamp）', () => {
      for (const e of fallback.codex) {
        expect(e.id).toBeTruthy()
        expect(e.name).toBeTruthy()
        expect(e.description).toBeTruthy()
        expect(e.metadata).toBeDefined()
        expect(typeof e.timestamp).toBe('number')
      }
    })
  })

  describe('buildFallbackBackground', () => {
    it('条目类型为 background，描述包含出身信息', () => {
      const bg = buildFallbackBackground({ name: '齐尘', gender: '男', realm: '练气期一层' })
      expect(bg.entry_type).toBe('background')
      expect(bg.name).toBe('齐尘')
      expect(bg.description).toContain('齐尘')
      expect(bg.description.length).toBeGreaterThan(30)
    })
  })
})
