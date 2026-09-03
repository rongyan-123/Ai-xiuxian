/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useGameStore } from '@/stores/game'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Heart, Droplets, Timer, User, MapPin, Users, Clock } from 'lucide-react'
import { formatWorldTime, hpStatus, mpStatus, ageStatus } from '@/lib/utils'

const GRADE_DOT: Record<string, string> = {
  '天': 'bg-amber-400', '地': 'bg-emerald-400',
  '玄': 'bg-purple-400', '黄': 'bg-zinc-400',
}

const DANGER_COLORS: Record<string, string> = {
  '安全': 'bg-emerald-500/20 text-emerald-400',
  '低危': 'bg-blue-500/20 text-blue-400',
  '中危': 'bg-amber-500/20 text-amber-400',
  '高危': 'bg-orange-500/20 text-orange-400',
  '绝地': 'bg-red-500/20 text-red-400',
}

export function StatusPanel() {
  const { player } = useGameStore()
  if (!player) return null
  const { stats: rawStats, inventory: rawInv } = player as any
  const stats = rawStats || {}
  const inventory = rawInv || []
  const hp = stats.hp || { current: 0, max: 100 }
  const mp = stats.mp || { current: 0, max: 50 }
  const age = stats.age || { current: 16, max: 100 }
  const spirit = stats.spirit || { value: 0, desc: 'unknown' }

  const currentLocation: string = (player as any).currentLocation || '出生山村'
  const npcs: any[] = (player as any).npcs || []
  const npcsHere = npcs.filter((n: any) => n.currentLocation === currentLocation)
  const codex: any[] = (player as any).codex || []
  const locationCodex = codex.find((e: any) => e.entry_type === 'location' && e.name === currentLocation)
  const dangerLevel: string = locationCodex?.metadata?.danger_level ?? ''
  const worldTime: number = (player as any).worldTime ?? Date.now()

  return (
    <div className="hidden lg:flex flex-col w-80 bg-zinc-950 border-l border-zinc-800 h-full">
      <div className="p-4 border-b border-zinc-800">
        <h3 className="text-lg font-semibold text-zinc-200 font-chinese flex items-center gap-2">
          <User className="h-5 w-5 text-zinc-400" />修仙面板
        </h3>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
                <span className="text-white text-xs font-bold">{(player as any).name?.[0] || '?'}</span>
              </div>
              <div>
                <div className="text-sm font-medium text-zinc-200">{(player as any).name || '无名'}</div>
                <div className="text-xs text-zinc-500">{stats.realm || ''}</div>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="flex items-center gap-2 p-2 rounded-lg bg-zinc-900 border border-zinc-800">
              <Heart className="h-4 w-4 text-emerald-500 flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-[10px] text-zinc-500">气血</div>
                <div className="text-xs font-medium text-zinc-200 truncate">{hpStatus(hp)}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 p-2 rounded-lg bg-zinc-900 border border-zinc-800">
              <Droplets className="h-4 w-4 text-blue-500 flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-[10px] text-zinc-500">灵力</div>
                <div className="text-xs font-medium text-zinc-200 truncate">{mpStatus(mp)}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 p-2 rounded-lg bg-zinc-900 border border-zinc-800">
              <Timer className="h-4 w-4 text-amber-500 flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-[10px] text-zinc-500">寿元</div>
                <div className="text-xs font-medium text-zinc-200 truncate">{ageStatus(age)}</div>
              </div>
            </div>
          </div>
          {/* 游戏时间 */}
          <div className="flex items-center gap-2 p-2 rounded-lg bg-zinc-900/50 border border-zinc-800">
            <Clock className="h-4 w-4 text-amber-400 flex-shrink-0" />
            <span className="text-xs text-zinc-300">{formatWorldTime(worldTime)}</span>
          </div>

          {/* 当前位置 */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">当前位置</h4>
            <div className="flex items-center gap-2 p-2 rounded-lg bg-zinc-900 border border-zinc-800">
              <MapPin className="h-4 w-4 text-emerald-400 flex-shrink-0" />
              <span className="text-sm text-zinc-200 truncate">{currentLocation}</span>
              {dangerLevel && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${DANGER_COLORS[dangerLevel] || 'bg-zinc-500/20 text-zinc-400'}`}>
                  {dangerLevel}
                </span>
              )}
            </div>
          </div>

          {/* 在场人物 */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
              在场人物 {npcsHere.length > 0 && `(${npcsHere.length})`}
            </h4>
            {npcsHere.length === 0 ? (
              <div className="text-xs text-zinc-600 italic p-2">周围没有其他人</div>
            ) : (
              <div className="space-y-1">
                {npcsHere.slice(0, 5).map((npc: any, idx: number) => (
                  <div key={npc.id || idx} className="flex items-center gap-2 p-1.5 rounded-lg bg-zinc-900/50 border border-zinc-800/50">
                    <Users className="h-3 w-3 text-zinc-500 flex-shrink-0" />
                    <span className="text-xs text-zinc-300 truncate">{npc.name}</span>
                    <span className="text-[10px] text-zinc-600 flex-shrink-0">{npc.realm}</span>
                    {npc.sect && <span className="text-[10px] text-zinc-600 flex-shrink-0">{npc.sect}</span>}
                  </div>
                ))}
                {npcsHere.length > 5 && (
                  <div className="text-[10px] text-zinc-600 text-center pt-1">+{npcsHere.length - 5} 人</div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">属性</h4>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center gap-2 p-2 rounded-lg bg-zinc-900 border border-zinc-800"><Droplets className="h-4 w-4 text-purple-400" /><div><div className="text-[10px] text-zinc-500">神识</div><div className="text-sm font-bold text-zinc-200">{spirit.value}</div></div></div>
            </div>
          </div>
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">背包</h4>
            <div className="space-y-1">
              {inventory.length === 0 ? (
                <div className="text-xs text-zinc-600 italic p-2">空空如也</div>
              ) : inventory.slice(0, 5).map((item: any, index: number) => {
                const tier = item.grade?.[0] || '黄'
                return (
                  <div key={index} className="flex items-center justify-between p-2 rounded-lg bg-zinc-900/50 border border-zinc-800">
                    <div className="flex items-center gap-2">
                      <div className={"w-2 h-2 rounded-full " + (GRADE_DOT[tier] || 'bg-zinc-500')} />
                      <span className="text-xs text-zinc-300">{item.name}</span>
                    </div>
                    <span className="text-[10px] text-zinc-500">x{item.count}</span>
                  </div>
                )
              })}
              {inventory.length > 5 && <div className="text-[10px] text-zinc-600 text-center pt-1">+{inventory.length - 5} 件物品</div>}
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
