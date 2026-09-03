import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** 格式化游戏世界时间。与 agent-loop.ts 中 formatWorldTime 保持同步。 */
export function formatWorldTime(ms: number): string {
  const base = new Date(2026, 0, 1).getTime()
  const elapsed = ms - base
  const days = Math.floor(elapsed / 86400000)
  const hours = Math.floor((elapsed % 86400000) / 3600000)
  return `修仙历${days + 1}天 ${hours}时`
}

/** 气血状态描述：优先使用服务端 status_desc，否则按比率映射 */
export function hpStatus(hp?: { current: number; max: number; status_desc?: string }): string {
  if (!hp) return '气息未知'
  if (hp.status_desc) return hp.status_desc
  const ratio = hp.max > 0 ? hp.current / hp.max : 0
  if (ratio > 0.8) return '精力充沛'
  if (ratio > 0.5) return '气息平稳'
  if (ratio > 0.2) return '身负轻伤'
  return '重伤濒危'
}

/** 灵力状态描述：优先使用服务端 status_desc，否则按比率映射 */
export function mpStatus(mp?: { current: number; max: number; status_desc?: string }): string {
  if (!mp) return '灵力未知'
  if (mp.status_desc) return mp.status_desc
  const ratio = mp.max > 0 ? mp.current / mp.max : 0
  if (ratio > 0.8) return '灵力充裕'
  if (ratio > 0.4) return '灵力正常'
  return '灵力枯竭'
}

/** 寿元状态描述 */
export function ageStatus(age?: { current: number; max: number }): string {
  if (!age || age.max <= 0) return '寿元未知'
  const ratio = age.current / age.max
  if (ratio > 0.5) return '正当壮年'
  if (ratio > 0.3) return '年过半百'
  return '油尽灯枯'
}
