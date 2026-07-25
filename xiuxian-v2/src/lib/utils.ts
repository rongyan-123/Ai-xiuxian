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
