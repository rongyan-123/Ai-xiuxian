/* eslint-disable @typescript-eslint/no-explicit-any */
"use client"

import { useState, useMemo } from "react"
import { useGameStore } from "@/stores/game"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ArrowLeft, ScrollText, MapPin, User, Package, Search, ChevronDown, ChevronRight, Building2 } from "lucide-react"

const TYPE_TABS = [
  { key: "", label: "全部", icon: ScrollText },
  { key: "npc", label: "人物", icon: User },
  { key: "location", label: "地点", icon: MapPin },
  { key: "item", label: "物品", icon: Package },
  { key: "sect", label: "宗门", icon: Building2 },
]

const TYPE_LABELS: Record<string, string> = {
  npc: "人物", location: "地点", item: "物品", sect: "宗门",
}

function MetadataSection({ entry }: { entry: any }) {
  const m = entry.metadata || {}

  if (entry.entry_type === "location") {
    return (
      <div className="mt-2 pt-2 border-t border-zinc-700/50 space-y-1">
        {m.danger_level && <div className="text-[11px] text-zinc-400">危险等级：<span className="text-zinc-300">{m.danger_level}</span></div>}
        {m.region && <div className="text-[11px] text-zinc-400">区域：<span className="text-zinc-300">{m.region}</span></div>}
        {m.features && <div className="text-[11px] text-zinc-400">特征：<span className="text-zinc-300">{Array.isArray(m.features) ? m.features.join("、") : String(m.features)}</span></div>}
        {m.level_range && <div className="text-[11px] text-zinc-400">等级范围：<span className="text-zinc-300">{m.level_range}</span></div>}
      </div>
    )
  }

  if (entry.entry_type === "npc") {
    return (
      <div className="mt-2 pt-2 border-t border-zinc-700/50 space-y-1">
        {m.realm && <div className="text-[11px] text-zinc-400">境界：<span className="text-zinc-300">{m.realm}</span></div>}
        {m.sect && <div className="text-[11px] text-zinc-400">宗门：<span className="text-zinc-300">{m.sect}</span></div>}
        {m.alignment && <div className="text-[11px] text-zinc-400">阵营：<span className="text-zinc-300">{m.alignment}</span></div>}
        {m.personality && <div className="text-[11px] text-zinc-400">性格：<span className="text-zinc-300">{m.personality}</span></div>}
        {typeof m.relationship === "number" && (
          <div className="text-[11px] text-zinc-400">好感度：<span className={m.relationship >= 0 ? "text-emerald-400" : "text-red-400"}>{m.relationship}</span></div>
        )}
      </div>
    )
  }

  if (entry.entry_type === "item") {
    return (
      <div className="mt-2 pt-2 border-t border-zinc-700/50 space-y-1">
        {m.grade && <div className="text-[11px] text-zinc-400">品级：<span className="text-zinc-300">{m.grade}</span></div>}
        {m.type && <div className="text-[11px] text-zinc-400">类型：<span className="text-zinc-300">{m.type}</span></div>}
        {m.effects && <div className="text-[11px] text-zinc-400">效果：<span className="text-zinc-300">{m.effects}</span></div>}
        {typeof m.value === "number" && <div className="text-[11px] text-zinc-400">价值：<span className="text-zinc-300">{m.value} 灵石</span></div>}
      </div>
    )
  }

  if (entry.entry_type === "sect") {
    return (
      <div className="mt-2 pt-2 border-t border-zinc-700/50 space-y-1">
        {m.alignment && <div className="text-[11px] text-zinc-400">阵营：<span className="text-zinc-300">{m.alignment}</span></div>}
        {m.power_level && <div className="text-[11px] text-zinc-400">势力：<span className="text-zinc-300">{m.power_level}</span></div>}
        {m.master && <div className="text-[11px] text-zinc-400">掌门：<span className="text-zinc-300">{m.master}（{m.master_realm}）</span></div>}
        {m.specialties && <div className="text-[11px] text-zinc-400">特长：<span className="text-zinc-300">{m.specialties}</span></div>}
      </div>
    )
  }

  return null
}

export function CodexPanel() {
  const { codex, setCurrentView } = useGameStore()
  const [search, setSearch] = useState("")
  const [activeTab, setActiveTab] = useState("")
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const filtered = useMemo(() => {
    let result = [...codex]
    if (activeTab) {
      result = result.filter((e) => e.entry_type === activeTab)
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q),
      )
    }
    return result
  }, [codex, activeTab, search])

  const grouped: Record<string, any[]> = {}
  filtered.forEach((e) => {
    if (!grouped[e.entry_type]) grouped[e.entry_type] = []
    grouped[e.entry_type].push(e)
  })

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const countsByType: Record<string, number> = {}
  codex.forEach((e) => {
    countsByType[e.entry_type] = (countsByType[e.entry_type] || 0) + 1
  })

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      <div className="p-4 border-b border-zinc-800 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setCurrentView("chat")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h2 className="text-lg font-semibold text-zinc-200 font-chinese">修仙图鉴</h2>
      </div>

      {/* 搜索栏 */}
      <div className="px-4 pt-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索图鉴..."
            className="pl-8 h-9 text-sm bg-zinc-900 border-zinc-700 text-zinc-200 placeholder:text-zinc-500"
          />
        </div>
      </div>

      {/* 分类标签 */}
      <div className="px-4 pt-3 pb-2 flex gap-1 overflow-x-auto">
        {TYPE_TABS.map((tab) => {
          const count = tab.key ? (countsByType[tab.key] || 0) : codex.length
          const isActive = activeTab === tab.key
          const Icon = tab.icon
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                isActive
                  ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                  : "bg-zinc-900 text-zinc-400 border border-zinc-800 hover:text-zinc-300"
              }`}
            >
              <Icon className="h-3 w-3" />
              {tab.label}
              <span className="text-[10px] opacity-60">{count}</span>
            </button>
          )
        })}
      </div>

      {/* 图鉴列表 */}
      <div className="flex-1 p-4 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-500">
            <ScrollText className="h-12 w-12 mb-4 opacity-50" />
            <p>{search ? "未找到匹配条目" : "暂无图鉴记录"}</p>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(grouped).map(([type, entries]) => (
              <div key={type}>
                <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
                  {TYPE_LABELS[type] || type} ({entries.length})
                </h3>
                <div className="space-y-2">
                  {entries.map((entry) => {
                    const isExpanded = expandedIds.has(entry.id)
                    return (
                      <div
                        key={entry.id}
                        className="rounded-xl border border-zinc-700 bg-zinc-900 overflow-hidden cursor-pointer hover:border-zinc-600 transition-colors"
                        onClick={() => toggleExpand(entry.id)}
                      >
                        <div className="p-3 flex items-center gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-bold text-zinc-200 truncate">{entry.name}</div>
                            {!isExpanded && (
                              <p className="text-xs text-zinc-500 leading-relaxed mt-0.5 line-clamp-1">{entry.description}</p>
                            )}
                          </div>
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-zinc-500 flex-shrink-0" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-zinc-500 flex-shrink-0" />
                          )}
                        </div>
                        {isExpanded && (
                          <div className="px-3 pb-3">
                            <p className="text-xs text-zinc-400 leading-relaxed">{entry.description}</p>
                            <MetadataSection entry={entry} />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}