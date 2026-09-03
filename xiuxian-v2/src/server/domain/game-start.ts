/**
 * 固定开局模板 — 开局不依赖 LLM 生成（模拟器核心是后续动态世界与 Agent 独立运行，
 * 开局只是入场仪式，固定模板保证稳定快速进入 PLAYING）。
 * 服务端玩家创建与前端初始快照共用此模板，避免双端数据漂移。
 */
import type { IInventoryItem, CodexEntry, IPlayer } from '@/types'

/** 穷散修初始背包：带完整字段（value/description/grade/type/count） */
export const STARTING_INVENTORY: IInventoryItem[] = [
  {
    id: 'item-stone',
    name: '一阶灵石',
    grade: '无',
    type: '货币',
    description: '下品灵石，修仙界通行的基础货币，散修囊中仅余的这些。',
    count: 10,
    value: 1,
  },
  {
    id: 'item-dan',
    name: '基础疗伤丹',
    grade: '黄阶下品',
    type: '丹药',
    description: '最普通的疗伤丹药，可恢复少量气血，行走江湖的必备之物。',
    count: 3,
    value: 5,
  },
  {
    id: 'item-sword',
    name: '旧木剑',
    grade: '无',
    type: '武器',
    description: '一柄削过柴火的旧木剑，剑身刻着模糊的符文，聊胜于无。',
    count: 1,
    value: 3,
  },
]

/**
 * 初始图鉴：新存档为空，世界由首次 action 的 Genesis 流程生成
 * （world-gen.ts）。genesis 失败时由 buildFallbackWorld 兜底。
 */
export const STARTING_CODEX: CodexEntry[] = []

/** 固定开场叙事（替代 LLM prepare 生成的开场剧情） */
export function buildOpeningNarrative(name: string): string {
  return (
    '你缓缓睁开双眼，破旧的茅屋顶映入眼帘。屋外传来鸡鸣，晨光从纸窗的缝隙漏进来，落在你身下的干草堆上。\n\n' +
    `你叫${name}，一个出生在南域山村的散修，资质平平，仅有五行杂灵根。昨日你在村口老槐树下，从路过的游方道人口中打听到——山外坊市的集市就要开了。\n\n` +
    '「世界不会等你。」你默默将这句话记在心头，翻身坐起，收拾起仅有的家当：十块一阶灵石、三枚基础疗伤丹，还有那柄削过柴火的旧木剑。\n\n' +
    '是时候出去看看了。'
  )
}

/** 完整初始玩家快照（前端 localStorage 与玩家创建共用） */
export function createStartingPlayer(params: {
  id: string
  name: string
  gender: string
  now?: number
}): IPlayer {
  const t = params.now ?? Date.now()
  return {
    id: params.id,
    status: 'ALIVE',
    name: params.name,
    gender: params.gender,
    stats: {
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
      emotion: '平静',
      state_of_mind: 80,
      fortune: 50,
      karma: 0,
      techniques: { main: '基础吐纳', combat: [], movement: '步行', support: [] },
      shield: { current: 0, max: 50 },
      talents: [],
      traits: [],
    },
    inventory: STARTING_INVENTORY.map((i) => ({ ...i })),
    codex: STARTING_CODEX.map((c) => ({ ...c, metadata: { ...c.metadata }, timestamp: t })),
    relationships: {},
    situations: [],
    foreshadowings: [],
    worldTime: t,
    currentLocation: '出生山村',
    npcs: [],
    createdAt: t,
    updatedAt: t,
    version: 0,
  }
}
