/**
 * T1 NPC Engine — pure functions for template-based NPC generation and dialogue.
 *
 * T1 NPCs use keyword-matched dialogue templates with zero LLM calls.
 * Personality and sect determine template flavor. Future tiers (T2, T3) will
 * add LLM-driven dialogue and memory respectively.
 */
import type { T1Npc } from '@/types'
import type { T1Npc as T1NpcContract } from '../contracts/player'

export type { T1Npc }

export interface CreateT1NpcParams {
  name: string
  title?: string
  realm: string
  currentLocation: string
  alignment?: '正道' | '魔道' | '中立'
  sect: string
  personality: string
  description: string
  relationship?: number
}

const PERSONALITY_TEMPLATES: Record<string, Record<string, string[]>> = {
  热情: {
    greeting: ['道友来得正好！', '哈哈哈，有缘有缘！', '哎呀，可算等到人了！'],
    farewell: ['后会有期，道友保重！', '下次再聊，别忘了来找我！', '一路顺风！'],
    info: ['这附近我熟得很，有什么事尽管问！', '说到这个，我可就有话说了……'],
    default: ['哈哈，这倒是个有趣的话题。', '道友说得在理！'],
  },
  冷漠: {
    greeting: ['……', '何事？', '有话快说。'],
    farewell: ['嗯。', '不送。', '……'],
    info: ['自己看。', '没什么好说的。', '你问错人了。'],
    default: ['无趣。', '说完了？', '……'],
  },
  阴险: {
    greeting: ['呵呵，又来了个不知死活的。', '道友面生得很哪……', '有意思，真有意思。'],
    farewell: ['小心点走，夜路可不好走。', '呵呵……后会……有期。'],
    info: ['这个消息可不便宜。', '我知道，但我凭什么告诉你？'],
    default: ['你以为我会信？', '你的底细我清楚得很……'],
  },
  高傲: {
    greeting: ['区区散修，也敢打扰本座？', '看在同道的份上，给你个说话的机会。'],
    farewell: ['去吧，本座乏了。', '下次带点像样的东西再来。'],
    info: ['这种粗浅的问题也来问本座？', '罢了，指点你一二也无妨。'],
    default: ['以你的修为，说了也白说。', '本座今日心情尚可，便不与你计较。'],
  },
  温和: {
    greeting: ['道友安好。', '善哉，又是一位有缘人。', '阿弥陀佛……哦不，道友请坐。'],
    farewell: ['愿你道途坦荡。', '惜缘惜福，后会有期。', '一路平安。'],
    info: ['让我想想……此事确实有些眉目。', '我知道的不多，但可以分享一二。'],
    default: ['修行之路漫漫，不必心急。', '心静自然明。'],
  },
  贪婪: {
    greeting: ['哟，来了个有钱的主儿！', '灵石带够了吗？'],
    farewell: ['下次多带点灵石来！', '不买别耽误我做生意！'],
    info: ['一百灵石，我就告诉你。', '情报都有价，你出得起吗？'],
    default: ['没钱？没钱你跟我废什么话！', '灵石到位，什么都好说。'],
  },
}

function pickRandom(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)]
}

function generateDialogueTemplates(
  personality: string,
  name: string,
): Record<string, string[]> {
  const base = PERSONALITY_TEMPLATES[personality] ?? PERSONALITY_TEMPLATES['温和']

  return {
    问候: base.greeting.map((t) => t.replace('道友', name ? `${name}道友` : '道友')),
    告别: base.farewell,
    打探消息: base.info,
    交易: base.info.map((t) => `[打量了一番] ${t}`),
    切磋: [`${name}: 来得好！让我看看你的本事！`, `${name}: 点到为止，出招吧！`],
    论道: [`${name}: 大道三千，各取一瓢。你修的是什么道？`],
    默认: base.default,
  }
}

export function createT1Npc(params: CreateT1NpcParams): T1Npc {
  const {
    name,
    title,
    realm,
    currentLocation,
    alignment = '中立',
    sect,
    personality,
    description,
    relationship = 0,
  } = params

  return {
    id: `npc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    title,
    realm,
    currentLocation,
    alignment,
    sect,
    personality,
    relationship,
    dialogueTemplates: generateDialogueTemplates(personality, name),
    description,
    createdAt: Date.now(),
  }
}

export function getNpcsAtLocation(npcs: T1Npc[], location: string): T1Npc[] {
  return npcs.filter((n) => n.currentLocation === location)
}

export function matchDialogue(
  npc: T1Npc,
  playerInput: string,
): string | null {
  const templates = npc.dialogueTemplates
  const input = playerInput.trim()

  // Keyword matching
  const keywords: Record<string, string[]> = {
    问候: ['你好', '您好', '拜见', '见过', '参见', '打扰', '请问', '前辈', '道友'],
    告别: ['告辞', '再见', '后会有期', '走了', '拜拜', '下次'],
    打探消息: ['知道', '听说', '消息', '情报', '打听', '附近', '这里', '哪有', '哪里'],
    交易: ['买', '卖', '交易', '交换', '灵石', '价格', '多少', '换'],
    切磋: ['切磋', '比试', '较量', '过招', '试试', '请教', '指点'],
    论道: ['道', '修炼', '修行', '功法', '境界', '突破', '心得'],
  }

  for (const [category, words] of Object.entries(keywords)) {
    if (words.some((w) => input.includes(w))) {
      const responses = templates[category] ?? templates['默认']
      if (responses && responses.length > 0) {
        return `${npc.name}${npc.title ? `（${npc.title}）` : ''}：${pickRandom(responses)}`
      }
    }
  }

  // Fallback to default responses
  const defaults = templates['默认'] ?? ['……']
  return `${npc.name}：${pickRandom(defaults)}`
}

export function npcsToContract(npcs: T1Npc[]): T1NpcContract[] {
  return npcs as unknown as T1NpcContract[]
}

// ── Seed NPC Factory ─────────────────────────────────────────────────────────

import type { SeedNpc } from './world-seed'
import { SEED_NPCS } from './world-seed'
import { rollNpcParams } from './npc-archetype'

export function createNpcFromSeed(seed: SeedNpc): T1Npc {
  const npc = createT1Npc({
    name: seed.name,
    title: seed.title,
    realm: seed.realm,
    currentLocation: seed.currentLocation,
    alignment: seed.alignment,
    sect: seed.sect,
    personality: seed.personality,
    description: seed.description,
    relationship: seed.relationship,
  })

  // 附加种子数据特有的字段
  npc.schedule = seed.schedule.map((s) => ({ ...s }))
  npc.knowledge = []

  // 接入原型系统：从原型roll参数，seed.traits作为手工覆盖值
  const archetypeParams = rollNpcParams(seed.archetype, {
    seed: `seed-${seed.name}`,
    overrides: seed.traits,
  })
  npc.traits = { ...archetypeParams }

  return npc
}

/** 获取所有预种子NPC实例 */
export function getAllSeedNpcs(): T1Npc[] {
  return SEED_NPCS.map(createNpcFromSeed)
}

/** 获取预种子T2+ NPC */
export function getT2Npcs(): T1Npc[] {
  return SEED_NPCS.filter((s) => s.tier === 'T2').map(createNpcFromSeed)
}

