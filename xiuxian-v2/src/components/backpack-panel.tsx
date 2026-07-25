/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useState, useMemo } from 'react'
import { useGameStore } from '@/stores/game'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Package, Gem, ScrollText, FlaskConical, Swords, Box, ChevronDown, ChevronRight, ArrowUpDown } from 'lucide-react'

const GRADE_ORDER = ['天阶', '地阶', '玄阶', '黄阶', '无']
const GRADE_SUB_ORDER = ['上品', '中品', '下品']

function gradeSortValue(grade: string): number {
  if (!grade || grade === '无') return 999
  for (let i = 0; i < GRADE_ORDER.length; i++) {
    if (grade.startsWith(GRADE_ORDER[i])) {
      for (let j = 0; j < GRADE_SUB_ORDER.length; j++) {
        if (grade.endsWith(GRADE_SUB_ORDER[j])) return i * 3 + j
      }
      return i * 3
    }
  }
  return 999
}

const GRADE_COLORS: Record<string, string> = {
  '天阶上品': 'text-amber-400 border-amber-500/50 bg-amber-500/10',
  '天阶中品': 'text-amber-300 border-amber-400/50 bg-amber-400/10',
  '天阶下品': 'text-amber-200 border-amber-300/50 bg-amber-300/10',
  '地阶上品': 'text-emerald-400 border-emerald-500/50 bg-emerald-500/10',
  '地阶中品': 'text-emerald-300 border-emerald-400/50 bg-emerald-400/10',
  '地阶下品': 'text-emerald-200 border-emerald-300/50 bg-emerald-300/10',
  '玄阶上品': 'text-purple-400 border-purple-500/50 bg-purple-500/10',
  '玄阶中品': 'text-purple-300 border-purple-400/50 bg-purple-400/10',
  '玄阶下品': 'text-purple-200 border-purple-300/50 bg-purple-300/10',
  '黄阶上品': 'text-zinc-300 border-zinc-400/50 bg-zinc-400/10',
  '黄阶中品': 'text-zinc-300 border-zinc-400/50 bg-zinc-400/10',
  '黄阶下品': 'text-zinc-400 border-zinc-500/50 bg-zinc-500/10',
}

const TYPE_ICONS: Record<string, any> = {
  '丹药': FlaskConical,
  '法宝': Gem,
  '功法': ScrollText,
  '材料': Box,
  '杂物': Package,
  '防具': Swords,
  '货币': Gem,
}

type SortMode = 'grade' | 'type' | 'name'

function getGradeClass(grade: string): string {
  return GRADE_COLORS[grade] || 'text-zinc-400 border-zinc-600/50 bg-zinc-600/10'
}

function getTypeIcon(type: string): any {
  return TYPE_ICONS[type] || Package
}

export function BackpackPanel() {
  const { setCurrentView, player } = useGameStore()
  const inventory: any[] = (player as any)?.inventory || []
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)
  const [sortMode, setSortMode] = useState<SortMode>('grade')

  const sorted = useMemo(() => {
    const items = [...inventory]
    switch (sortMode) {
      case 'grade':
        return items.sort((a, b) => gradeSortValue(a.grade) - gradeSortValue(b.grade))
      case 'type':
        return items.sort((a, b) => (a.type || '').localeCompare(b.type || ''))
      case 'name':
        return items.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      default:
        return items
    }
  }, [inventory, sortMode])

  const toggleExpand = (idx: number) => {
    setExpandedIdx((prev) => (prev === idx ? null : idx))
  }

  const cycleSort = () => {
    const modes: SortMode[] = ['grade', 'type', 'name']
    const idx = modes.indexOf(sortMode)
    setSortMode(modes[(idx + 1) % modes.length])
  }

  const sortLabel: Record<SortMode, string> = { grade: '品级', type: '类型', name: '名称' }

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      <div className="p-4 border-b border-zinc-800 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setCurrentView('chat')} className="text-zinc-400 hover:text-zinc-200">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h2 className="text-lg font-semibold text-zinc-200 font-chinese">背包</h2>
        <span className="text-xs text-zinc-500 ml-auto">{inventory.length} 件物品</span>
      </div>

      {/* 排序按钮 */}
      {inventory.length > 0 && (
        <div className="px-4 pt-3">
          <button
            onClick={cycleSort}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-zinc-900 text-zinc-400 border border-zinc-800 hover:text-zinc-300 transition-colors"
          >
            <ArrowUpDown className="h-3 w-3" />
            按{sortLabel[sortMode]}排序
          </button>
        </div>
      )}

      <div className="flex-1 p-4 overflow-auto">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-600 gap-3">
            <Package className="h-12 w-12" />
            <span className="italic">空空如也</span>
          </div>
        ) : (
          <div className="space-y-2">
            {sorted.map((item: any, index: number) => {
              const Icon = getTypeIcon(item.type)
              const isExpanded = expandedIdx === index
              const isConsumable = item.type === '丹药'
              return (
                <div
                  key={item.id || index}
                  className={'rounded-lg border transition-colors cursor-pointer ' + getGradeClass(item.grade)}
                  onClick={() => toggleExpand(index)}
                >
                  <div className="p-3 flex items-center gap-2">
                    <Icon className="h-4 w-4 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{item.name}</div>
                      <div className="text-xs opacity-60 mt-0.5">{item.type} · {item.grade}</div>
                    </div>
                    <div className="text-right flex-shrink-0 flex items-center gap-2">
                      <div>
                        <div className="text-xs font-bold">x{item.count}</div>
                        {item.value > 0 && <div className="text-[10px] opacity-50">{item.value}灵石</div>}
                      </div>
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 opacity-50" />
                      ) : (
                        <ChevronRight className="h-4 w-4 opacity-50" />
                      )}
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="px-3 pb-3 border-t border-zinc-700/30 pt-2">
                      {item.description && (
                        <p className="text-xs opacity-70 leading-relaxed mb-2">{item.description}</p>
                      )}
                      {item.effects && (
                        <div className="text-[11px] opacity-60 mb-2">效果：{item.effects}</div>
                      )}
                      {isConsumable && item.count > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs bg-zinc-800 border-zinc-600 text-zinc-300 hover:bg-zinc-700"
                          onClick={(e) => {
                            e.stopPropagation()
                            // TODO: 发送 ConsumeItem action 到后端
                          }}
                        >
                          使用
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}