/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useGameStore } from '@/stores/game'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Heart, Droplets, Wind, Shield, Brain, Star, Swords } from 'lucide-react'

function Bar({current, max, color}: {current: number; max: number; color: string}) {
  const pct = max > 0 ? Math.min(100, (current / max) * 100) : 0
  const isLow = pct < 30
  return (
    <div className="w-full h-2 rounded-full bg-zinc-800 overflow-hidden">
      <div className={"h-full rounded-full transition-all duration-500 " + (isLow ? 'bg-red-500 animate-pulse' : color)} style={{width: pct + '%'}} />
    </div>
  )
}

export function StatsDetailPanel() {
  const { setCurrentView, player } = useGameStore()
  if (!player) return null
  const s = (player as any).stats || {}
  const hp = s.hp || { current: 0, max: 100 }
  const mp = s.mp || { current: 0, max: 50 }
  const age = s.age || { current: 16, max: 100 }
  const spirit = s.spirit || { value: 0, desc: '' }
  const tech = s.techniques || {}
  const equip = s.equipment || {}
  const talents = s.talents || []
  const traits = s.traits || []

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      <div className="p-4 border-b border-zinc-800 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setCurrentView('chat')} className="text-zinc-400 hover:text-zinc-200">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h2 className="text-lg font-semibold text-zinc-200 font-chinese">详细属性</h2>
      </div>
      <div className="flex-1 p-4 overflow-auto space-y-5">
        {/* Core Bars */}
        <div className="space-y-3">
          <div>
            <div className="flex justify-between text-xs mb-1"><span className="text-emerald-400 flex items-center gap-1"><Heart className="h-3 w-3" />气血</span><span className="text-zinc-300">{hp.current}/{hp.max}</span></div>
            <Bar current={hp.current} max={hp.max} color="bg-emerald-500" />
          </div>
          <div>
            <div className="flex justify-between text-xs mb-1"><span className="text-blue-400 flex items-center gap-1"><Droplets className="h-3 w-3" />灵力</span><span className="text-zinc-300">{mp.current}/{mp.max}</span></div>
            <Bar current={mp.current} max={mp.max} color="bg-blue-500" />
          </div>
          <div>
            <div className="flex justify-between text-xs mb-1"><span className="text-amber-400 flex items-center gap-1"><Star className="h-3 w-3" />寿元</span><span className="text-zinc-300">{age.current}/{age.max}年</span></div>
            <Bar current={age.current} max={age.max} color="bg-amber-500" />
          </div>
        </div>

        {/* Info Grid */}
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">基础信息</h4>
          <div className="grid grid-cols-2 gap-2">
            {[['境界', s.realm], ['灵根', s.spiritual_root], ['阵营', s.alignment], ['宗门', s.sect], ['种族', s.race], ['心境', s.state_of_mind || s.mental_state]].map(([k, v]) => (
              <div key={String(k)} className="p-2 rounded-lg bg-zinc-900 border border-zinc-800">
                <div className="text-[10px] text-zinc-500">{String(k)}</div>
                <div className="text-sm font-medium text-zinc-200 mt-0.5">{String(v ?? '-')}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Combat & Spirit */}
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">神识与命数</h4>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-2 p-2 rounded-lg bg-zinc-900 border border-zinc-800">
              <Wind className="h-4 w-4 text-purple-400" />
              <div>
                <div className="text-[10px] text-zinc-500">神识</div>
                <div className="text-sm font-bold text-zinc-200">{spirit.value}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 p-2 rounded-lg bg-zinc-900 border border-zinc-800">
              <Star className="h-4 w-4 text-amber-400" />
              <div>
                <div className="text-[10px] text-zinc-500">运势</div>
                <div className="text-sm font-bold text-zinc-200">{s.fortune ?? '-'}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 p-2 rounded-lg bg-zinc-900 border border-zinc-800">
              <Brain className="h-4 w-4 text-emerald-400" />
              <div>
                <div className="text-[10px] text-zinc-500">因果</div>
                <div className="text-sm font-bold text-zinc-200">{s.karma ?? '-'}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 p-2 rounded-lg bg-zinc-900 border border-zinc-800">
              <Shield className="h-4 w-4 text-blue-400" />
              <div>
                <div className="text-[10px] text-zinc-500">声望</div>
                <div className="text-sm font-bold text-zinc-200">{s.reputation ?? '-'}</div>
              </div>
            </div>
          </div>
          {spirit.desc && (
            <div className="p-2 rounded-lg bg-zinc-900/50 border border-zinc-800/50">
              <div className="text-[10px] text-zinc-500 mb-0.5">神识感知</div>
              <div className="text-xs text-zinc-400 italic">{spirit.desc}</div>
            </div>
          )}
        </div>

        {/* Techniques */}
        {tech.main && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">功法</h4>
            <div className="space-y-1">
              <div className="p-2 rounded-lg bg-zinc-900 border border-zinc-800"><span className="text-[10px] text-zinc-500">主修</span><span className="text-sm text-amber-400 ml-2">{tech.main}</span></div>
              {tech.combat?.length > 0 && <div className="p-2 rounded-lg bg-zinc-900 border border-zinc-800"><span className="text-[10px] text-zinc-500">战斗</span><span className="text-sm text-red-400 ml-2">{tech.combat.join(', ')}</span></div>}
              {tech.movement && <div className="p-2 rounded-lg bg-zinc-900 border border-zinc-800"><span className="text-[10px] text-zinc-500">身法</span><span className="text-sm text-blue-400 ml-2">{tech.movement}</span></div>}
            </div>
          </div>
        )}

        {/* Equipment */}
        {(equip.weapon || equip.armor || equip.artifact) && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">装备</h4>
            <div className="space-y-1">
              {equip.weapon && <div className="p-2 rounded-lg bg-zinc-900 border border-zinc-800"><span className="text-[10px] text-zinc-500">武器</span><span className="text-sm text-red-400 ml-2">{equip.weapon}</span></div>}
              {equip.armor && <div className="p-2 rounded-lg bg-zinc-900 border border-zinc-800"><span className="text-[10px] text-zinc-500">防具</span><span className="text-sm text-blue-400 ml-2">{equip.armor}</span></div>}
              {equip.artifact && <div className="p-2 rounded-lg bg-zinc-900 border border-zinc-800"><span className="text-[10px] text-zinc-500">法宝</span><span className="text-sm text-purple-400 ml-2">{equip.artifact}</span></div>}
            </div>
          </div>
        )}

        {/* Talents & Traits */}
        {(talents.length > 0 || traits.length > 0) && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">天赋与特质</h4>
            <div className="flex flex-wrap gap-1">
              {talents.map((t: string, i: number) => (
                <span key={"t"+i} className="px-2 py-0.5 rounded-full text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30">{t}</span>
              ))}
              {traits.map((t: string, i: number) => (
                <span key={"r"+i} className="px-2 py-0.5 rounded-full text-xs bg-zinc-500/20 text-zinc-400 border border-zinc-500/30">{t}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
