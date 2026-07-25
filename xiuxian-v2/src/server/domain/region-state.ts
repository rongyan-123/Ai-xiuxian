/**
 * RegionState — 区域状态单例
 *
 * 从 world-seed 数据初始化区域约束，供 capabilityGate 查询。
 * 不做完整 Region DM（人口/活动/事件），只做 Gate 需要的最小数据层。
 */
import { SEED_LOCATIONS, type SeedLocation } from './world-seed'

// ── Types ─────────────────────────────────────────────────────────────────

export interface RegionConstraint {
  locationName: string
  dangerLevel: '安全' | '低危' | '中危' | '高危' | '绝地'
  levelRange: string
  minRealm: string
  connectedTo: string[]
  forbidden: boolean // 绝地 = 禁区
}

export interface RegionState {
  getLocationConstraint(locationName: string): RegionConstraint | undefined
  getConnectedLocations(locationName: string): string[]
  listLocations(): string[]
  isForbidden(locationName: string): boolean
}

// ── Realm ordering (for comparison) ───────────────────────────────────────

const REALM_ORDER: Record<string, number> = {
  '凡人': 0,
  '练气期一层': 1, '练气期二层': 2, '练气期三层': 3,
  '练气期四层': 4, '练气期五层': 5, '练气期六层': 6,
  '练气期七层': 7, '练气期八层': 8, '练气期九层': 9,
  '筑基初期': 10, '筑基中期': 11, '筑基后期': 12,
  '金丹初期': 13, '金丹中期': 14, '金丹后期': 15,
  '元婴初期': 16, '元婴中期': 17, '元婴后期': 18,
  '化神期': 20,
}

// ── Parse level range to minimum realm ─────────────────────────────────────

function parseMinRealm(levelRange: string): string {
  const parts = levelRange.split('到')
  const low = parts[0]?.trim() ?? '凡人'
  // Map seed data values to realm order keys
  const map: Record<string, string> = {
    '凡人': '凡人',
    '练气': '练气期一层',
    '筑基': '筑基初期',
    '金丹': '金丹初期',
    '元婴': '元婴初期',
  }
  return map[low] ?? '凡人'
}

// ── Singleton ─────────────────────────────────────────────────────────────

let _instance: RegionState | null = null

function createRegionState(): RegionState {
  const constraints = new Map<string, RegionConstraint>()

  for (const loc of SEED_LOCATIONS) {
    constraints.set(loc.name, {
      locationName: loc.name,
      dangerLevel: loc.danger_level,
      levelRange: loc.level_range,
      minRealm: parseMinRealm(loc.level_range),
      connectedTo: [...loc.connected_to],
      forbidden: loc.danger_level === '绝地',
    })
  }

  return {
    getLocationConstraint(locationName) {
      // 精确匹配优先，其次前缀匹配
      const exact = constraints.get(locationName)
      if (exact) return exact
      for (const [name, c] of constraints) {
        if (locationName.includes(name) || name.includes(locationName)) {
          return c
        }
      }
      return undefined
    },
    getConnectedLocations(locationName) {
      const c = this.getLocationConstraint(locationName)
      return c?.connectedTo ?? []
    },
    listLocations() {
      return [...constraints.keys()]
    },
    isForbidden(locationName) {
      const c = this.getLocationConstraint(locationName)
      return c?.forbidden ?? false
    },
  }
}

export function getRegionState(): RegionState {
  if (!_instance) {
    _instance = createRegionState()
  }
  return _instance
}

/** Realm comparison utilities, exported for gate checks */
export function compareRealms(playerRealm: string, requiredRealm: string): number {
  const player = REALM_ORDER[playerRealm] ?? 0
  const required = REALM_ORDER[requiredRealm] ?? 0
  return player - required
}

export function meetsRealmRequirement(playerRealm: string, requiredRealm: string): boolean {
  return compareRealms(playerRealm, requiredRealm) >= 0
}
