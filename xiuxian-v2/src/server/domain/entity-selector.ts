/**
 * Entity Selector — 从种子数据中匹配最合适的实体
 *
 * 纯函数，无副作用。找不到匹配时返回 null，由调用方决定是否触发 LLM 生成。
 */

import {
  SEED_SECTS,
  SEED_LOCATIONS,
  SEED_ITEMS,
  SEED_TECHNIQUES,
  type SeedSect,
  type SeedLocation,
  type SeedItem,
  type SeedTechnique,
} from './world-seed'

// ── 宗门匹配 ──────────────────────────────────────────────────────────────

/** 根据流派标签匹配最合适的宗门 */
export function selectSect(params: {
  genre?: string
  alignment?: '正道' | '魔道' | '中立'
  preferredPower?: string
}): SeedSect | null {
  const { genre, alignment, preferredPower } = params

  let candidates = [...SEED_SECTS]

  // 流派→宗门映射
  const genreMap: Record<string, string> = {
    剑修: '金剑门',
    道修: '青云门',
    丹修: '药王谷',
    魔修: '天魔教',
    商修: '万宝楼',
    阵修: '太虚观',
    符修: '太虚观',
    体修: '金剑门',
    散修: '万宝楼',
  }

  if (genre) {
    for (const [key, sectName] of Object.entries(genreMap)) {
      if (genre.includes(key)) {
        const match = candidates.find((s) => s.name === sectName)
        if (match) return match
      }
    }
  }

  // 按阵营筛选
  if (alignment) {
    const byAlignment = candidates.filter((s) => s.alignment === alignment)
    if (byAlignment.length > 0) candidates = byAlignment
  }

  // 按势力等级筛选
  if (preferredPower) {
    const byPower = candidates.filter((s) => s.power_level === preferredPower)
    if (byPower.length > 0) candidates = byPower
  }

  return candidates.length > 0 ? candidates[0] : null
}

export function getAllSects(): SeedSect[] {
  return [...SEED_SECTS]
}

export function findSectByName(name: string): SeedSect | null {
  return SEED_SECTS.find((s) => s.name === name) ?? null
}

// ── 地点匹配 ──────────────────────────────────────────────────────────────

export function selectLocation(params: {
  dangerLevel?: string
  region?: string
  connectedFrom?: string
}): SeedLocation | null {
  const { dangerLevel, region, connectedFrom } = params

  let candidates = [...SEED_LOCATIONS]

  if (region) {
    const byRegion = candidates.filter((l) => l.region === region)
    if (byRegion.length > 0) candidates = byRegion
  }

  if (dangerLevel) {
    const byDanger = candidates.filter((l) => l.danger_level === dangerLevel)
    if (byDanger.length > 0) candidates = byDanger
  }

  if (connectedFrom) {
    const connected = candidates.filter((l) => l.connected_to.includes(connectedFrom!))
    if (connected.length > 0) candidates = connected
  }

  return candidates.length > 0 ? candidates[0] : null
}

export function getAllLocations(): SeedLocation[] {
  return [...SEED_LOCATIONS]
}

export function findLocationByName(name: string): SeedLocation | null {
  return SEED_LOCATIONS.find((l) => l.name === name) ?? null
}

export function getConnectedLocations(locationName: string): SeedLocation[] {
  const loc = findLocationByName(locationName)
  if (!loc) return []
  return loc.connected_to
    .map((name) => findLocationByName(name))
    .filter((l): l is SeedLocation => l !== null)
}

// ── 物品匹配 ──────────────────────────────────────────────────────────────

export function selectItems(params: {
  type?: string
  grade?: string
  maxValue?: number
  count?: number
}): SeedItem[] {
  const { type, grade, maxValue, count = 1 } = params

  let candidates = [...SEED_ITEMS]

  if (type) {
    candidates = candidates.filter((i) => i.type === type)
  }
  if (grade) {
    candidates = candidates.filter((i) => i.grade === grade)
  }
  if (maxValue !== undefined) {
    candidates = candidates.filter((i) => i.value <= maxValue)
  }

  return candidates.slice(0, count)
}

export function findItemByName(name: string): SeedItem | null {
  return SEED_ITEMS.find((i) => i.name === name) ?? null
}

// ── 功法匹配 ──────────────────────────────────────────────────────────────

export function selectTechniques(params: {
  category?: 'main' | 'combat' | 'movement' | 'support'
  suitableFor?: string
}): SeedTechnique[] {
  const { category, suitableFor } = params

  let candidates = [...SEED_TECHNIQUES]

  if (category) {
    candidates = candidates.filter((t) => t.category === category)
  }
  if (suitableFor) {
    candidates = candidates.filter((t) => t.suitable_for.includes(suitableFor!))
  }

  return candidates
}

export function findTechniqueByName(name: string): SeedTechnique | null {
  return SEED_TECHNIQUES.find((t) => t.name === name) ?? null
}

// ── 世界概览 ──────────────────────────────────────────────────────────────

/** 生成种子数据的世界概览文本，供 system prompt 注入 */
export function buildWorldOverview(): string {
  const sectLines = SEED_SECTS.map(
    (s) => `- ${s.name}（${s.alignment}，${s.power_level}）：${s.description.slice(0, 60)}...`,
  ).join('\n')

  const locLines = SEED_LOCATIONS.map(
    (l) => `- ${l.name}[${l.danger_level}]：${l.description.slice(0, 60)}...`,
  ).join('\n')

  return `【已知宗门】
${sectLines}

【已知地点】
${locLines}

以上是南域修仙界已有的宗门和地点。当需要为玩家选择宗门或描述地点时，优先从以上列表中选择。只有在完全不适用的情况下才创建新的。`
}
