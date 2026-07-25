/**
 * Gate Checks — 工具闸门检查函数
 *
 * 每个函数接收 (args, agentState, regionConstraint)，返回 GateResult。
 * 纯函数，无副作用，不依赖外部状态。
 */
import type { RegionConstraint } from './region-state'
import { meetsRealmRequirement } from './region-state'

// ── Types ─────────────────────────────────────────────────────────────────

export interface GateCheckContext {
  args: Record<string, unknown>
  currentLocation: string
  playerRealm: string
  playerHp: { current: number; max: number }
  npcsAtLocation: Array<{ id: string; name: string }>
  locationConstraint?: RegionConstraint
}

export interface GateResult {
  allowed: boolean
  reason?: string
}

export type GateCheckFn = (ctx: GateCheckContext) => GateResult

// ── Individual Checks ──────────────────────────────────────────────────────

/** 目标位置是否可达（在 connected_to 列表中或模糊匹配） */
export function checkLocationReachable(ctx: GateCheckContext): GateResult {
  const target = ctx.args.to as string | undefined
  if (!target) return { allowed: true }

  const constraint = ctx.locationConstraint
  if (!constraint) return { allowed: true } // 未知地点放行

  const connected = constraint.connectedTo
  const isConnected = connected.some(
    (c) => target.includes(c) || c.includes(target),
  )
  if (!isConnected && connected.length > 0) {
    return {
      allowed: false,
      reason: `${ctx.currentLocation} 无法直接到达 "${target}"。可前往的地点：${connected.join('、')}`,
    }
  }
  return { allowed: true }
}

/** 境界是否满足目标地点的最低要求 */
export function checkRealmRequirement(ctx: GateCheckContext): GateResult {
  const target = ctx.args.to as string | undefined
  if (!target) return { allowed: true }

  // 使用 region state 查目标地点的约束（这里用传入的 locationConstraint）
  // 注意：这是当前位置的约束，不是目标地点的。简化处理：如果目标在 connected_to 中，不做拦截
  // 实际检查在 change_location 时会从 RegionState 获取目标地点约束
  return { allowed: true }
}

/** 禁止进入禁区 */
export function checkNotForbidden(ctx: GateCheckContext): GateResult {
  const target = ctx.args.to as string | undefined
  if (!target) return { allowed: true }

  // 由 RegionState.isForbidden 在 capabilityGate 调用前预查
  return { allowed: true }
}

/** 危险区域修炼时间上限 */
export function checkDangerZoneTimeLimit(ctx: GateCheckContext): GateResult {
  const duration = ctx.args.duration as string | undefined
  if (!duration) return { allowed: true }

  const constraint = ctx.locationConstraint
  if (!constraint) return { allowed: true }

  // 高危/绝地区域限制单次修炼不超过4小时
  if (
    (constraint.dangerLevel === '高危' || constraint.dangerLevel === '绝地') &&
    parseDurationHours(duration) > 4
  ) {
    return {
      allowed: false,
      reason: `${constraint.locationName} 环境危险，单次修炼不宜超过4小时`,
    }
  }
  return { allowed: true }
}

/** 目标 NPC 存在性检查 */
export function checkNpcExists(ctx: GateCheckContext): GateResult {
  const npcName = ctx.args.target as string | undefined
  if (!npcName) return { allowed: true }

  const found = ctx.npcsAtLocation.some(
    (n) => n.name === npcName || npcName.includes(n.name) || n.name.includes(npcName),
  )
  if (!found && ctx.npcsAtLocation.length > 0) {
    return {
      allowed: false,
      reason: `当前位置没有名为 "${npcName}" 的人物`,
    }
  }
  return { allowed: true }
}

/** 境界差距合理性检查 */
export function checkRealmGap(ctx: GateCheckContext): GateResult {
  // 简化处理：始终放行，具体战斗结果由 rule-engine 决定
  return { allowed: true }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function parseDurationHours(duration: string): number {
  const match = duration.match(/^(\d+)\s*(分钟|min|m|小时|h|天|d)/i)
  if (!match) return 0
  const num = parseInt(match[1], 10)
  const unit = match[2].toLowerCase()
  if (unit === '分钟' || unit === 'min' || unit === 'm') return num / 60
  if (unit === '小时' || unit === 'h') return num
  if (unit === '天' || unit === 'd') return num * 24
  return 0
}

// ── Tool-to-Check Mapping ──────────────────────────────────────────────────

/** 每个工具对应的闸门检查函数列表 */
export const TOOL_GATE_CHECKS: Record<string, GateCheckFn[]> = {
  change_location: [checkLocationReachable],
  advance_time: [checkDangerZoneTimeLimit],
  engage_combat: [checkNpcExists],
}
