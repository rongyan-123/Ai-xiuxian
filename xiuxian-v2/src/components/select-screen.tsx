'use client'

import { useState, useRef } from 'react'
import { useGameStore } from '@/stores/game'
import { useGameStream } from '@/client/use-game-stream'
import { Loader2 } from 'lucide-react'

type Trope = {
  id: string
  name: string
  desc: string
  icon: string
  openingHint: string
}

const tropes: Trope[] = [
  { id: "feichai", name: "废柴流", desc: "主角资质极差，遭宗门/家族抛弃，后获奇遇逆袭成神", icon: "☕", openingHint: "资质低劣、被抛弃、遭遇嘲讽" },
  { id: "tuihun", name: "退婚流", desc: "主角被未婚妻当众退婚，受尽羞辱，发奋修炼，最终强势打脸", icon: "💔", openingHint: "当众被退婚、羞辱、嘲讽" },
  { id: "banzhuchihu", name: "扮猪吃虎流", desc: "主角表面平庸普通，实则隐藏实力，关键时刻一鸣惊人", icon: "🐷", openingHint: "隐藏实力、被轻视、关键时刻爆发" },
  { id: "haoqiang", name: "豪强回归流", desc: "曾是顶级势力嫡系，因故流落凡间，多年后强势归来", icon: "👑", openingHint: "曾经辉煌、流落凡间、归来夺回一切" },
  { id: "zhongtian", name: "种田流", desc: "不热衷战斗，专注炼丹炼器种药，靠技术和商业积累资本", icon: "🌾", openingHint: "专注辅助职业、商业积累、壮大势力" },
  { id: "qiyu", name: "奇遇流", desc: "意外发现仙人遗迹秘宝，获得逆天传承，踏上强者之路", icon: "✨", openingHint: "发现遗迹、获得传承、踏上强者之路" },
  { id: "dalian", name: "打脸流", desc: "主角被轻视嘲笑排挤，关键时刻展现实力", icon: "👊", openingHint: "被轻视、嘲笑、排挤，关键时刻爆发" },
  { id: "jiaporenwang", name: "家破人亡流", desc: "一夜之间宗门被灭家族覆灭，主角背负血海深仇", icon: "💀", openingHint: "宗门被灭、家族覆灭、背负血海深仇" },
  { id: "fuchou", name: "复仇流", desc: "主角曾被至交同门陷害身败名裂，今朝归来誓要讨回公道", icon: "🛡️", openingHint: "被陷害、身败名裂、归来复仇" },
  { id: "tishen", name: "替身流", desc: "主角被当作他人替身，终有一天揭竿而起", icon: "🎭", openingHint: "被当作替身、失去自我、揭竿而起" },
  { id: "beiguo", name: "背锅流", desc: "主角无辜替人背黑锅被世人唾弃，历经磨难后真相大白", icon: "🔗", openingHint: "无辜背锅、被世人唾弃、历经磨难" },
  { id: "shitu", name: "师徒背叛流", desc: "主角为师父门派奉献一切却被无情抛弃，终让背叛者悔不当初", icon: "⚡", openingHint: "为师门奉献一切、被无情抛弃、另有机缘" },
  { id: "zhuixu", name: "赘婿翻身流", desc: "主角入赘世家受尽白眼，一朝崛起让整个家族仰望", icon: "🏠", openingHint: "入赘世家、受尽白眼、一朝崛起" },
  { id: "beizhu", name: "被逐出师门流", desc: "主角因资质平庸被赶出山门，后凭毅力与机缘成就远超师门", icon: "🚪", openingHint: "因资质被赶出山门、流浪、最终成就远超师门" },
  { id: "sudi", name: "宿敌流", desc: "主角与命中宿敌从少年斗到中年，一路相爱相杀最终一决高低", icon: "⚔️", openingHint: "与宿敌纠缠、相爱相杀、最终对决" },
]

export function SelectScreen() {
  const { setPhase, addMessage, removeMessage, setLoading, setCurrentEvent, player } = useGameStore()
  const [selected, setSelected] = useState<string | null>(null)
  const errorInputRef = useRef<string>("")

  // ── useGameStream — 集中 SSE 处理 ──────────────────────────────────────
  const { send, status, streamingText, stepLogs } = useGameStream({
    onCompleted: (replyText) => {
      // 流完成后才切换到 PLAYING 阶段，SelectScreen 保持挂载直到此刻
      // 将开局身世叙事写入 chatHistory，作为 ChatPanel 的首个气泡
      if (replyText && replyText.trim()) {
        addMessage({
          id: 'ai-open-' + Date.now(),
          role: 'assistant',
          content: replyText,
          timestamp: Date.now(),
        })
      }
      setLoading(false)
      setCurrentEvent('')
      setPhase("PLAYING")
    },
    onFailed: (err) => {
      const input = errorInputRef.current
      const msgs = useGameStore.getState().chatHistory
      const lastMsg = msgs[msgs.length - 1]
      if (lastMsg?.error) removeMessage(lastMsg.id)
      addMessage({
        id: 'err-' + Date.now(),
        role: 'assistant',
        content: err.message || '请求失败，请重试',
        timestamp: Date.now(),
        error: true,
        userInput: input,
      })
      setLoading(false)
      setCurrentEvent('')
      setPhase("PLAYING")
    },
  })

  const loading = status === 'submitting' || status === 'streaming'

  const getCardClass = (id: string) => {
    const base = "p-3 md:p-4 rounded-xl border cursor-pointer transition-all duration-200 hover:scale-[1.02]"
    if (selected === id) return base + "border-amber-500 bg-zinc-800/80 shadow-lg shadow-amber-500/20"
    return base + "border-zinc-700 bg-zinc-900 hover:bg-zinc-800/50"
  }

  const handleSelect = () => {
    if (!selected || loading || !player) return
    const trope = tropes.find(t => t.id === selected)
    if (!trope) return

    const userInput = '\n[STREAM_START]\n[GENRE]' + trope.id + '\n[TITLE]' + trope.name + '\n[HINT]' + trope.openingHint + '\n[STREAM_END]\n'
    errorInputRef.current = userInput

    setLoading(true)
    addMessage({ id: 'sys-' + Date.now(), role: 'system', content: '选择了开局流派: ' + trope.name, timestamp: Date.now() })
    send({
      input: userInput,
      playerId: player.id,
      playerName: player.name,
      mode: 'prepare',
    })
  }

  return (
    <div className="flex flex-col items-center justify-center h-full bg-gradient-to-b from-zinc-950 to-zinc-900 p-4 overflow-auto">
      <div className="w-full max-w-5xl space-y-4 md:space-y-6 px-2 md:px-0">
        <div className="text-center space-y-1 md:space-y-2">
          <h1 className="text-2xl md:text-4xl font-bold text-zinc-200 font-chinese tracking-wider">天 命 抉 择</h1>
          <p className="text-xs md:text-base text-zinc-400">选择你的开局流派，不同流派将决定你修仙之路的起点与命运</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-5 gap-2 md:gap-3">
          {tropes.map((trope) => (
            <div key={trope.id} onClick={() => !loading && setSelected(trope.id)} className={getCardClass(trope.id)}>
              <div className="text-xl md:text-2xl mb-1.5 md:mb-2">{trope.icon}</div>
              <h3 className="text-xs md:text-sm font-bold text-zinc-200 mb-0.5 md:mb-1 font-chinese">{trope.name}</h3>
              <p className="text-zinc-500 text-[10px] md:text-xs leading-relaxed line-clamp-3 md:line-clamp-none">{trope.desc}</p>
            </div>
          ))}
        </div>
        <div className="flex justify-center">
          <button onClick={handleSelect} disabled={!selected || loading} className="px-6 md:px-8 py-2.5 md:py-3 text-base md:text-lg bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white font-bold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all">
            {loading ? <><Loader2 className="h-4 w-4 md:h-5 md:w-5 mr-1.5 md:mr-2 animate-spin inline" />天道推演中...</> : '确认选择'}
          </button>
        </div>

        {/* 流式文本 — 准备阶段的 AI 叙述 */}
        {streamingText && (
          <div className="max-w-2xl mx-auto p-4 rounded-xl bg-zinc-900/70 border border-emerald-500/10 text-sm text-zinc-300 leading-relaxed font-chinese">
            {streamingText}
            {loading && <span className="inline-block w-1.5 h-4 bg-emerald-400/70 ml-0.5 animate-pulse align-middle" />}
          </div>
        )}

        {/* 步骤日志 — 显示 AI 执行过程 */}
        {stepLogs.length > 0 && (
          <div className="max-w-md mx-auto space-y-0.5 max-h-48 overflow-y-auto bg-zinc-900/50 rounded-lg p-3 border border-zinc-800">
            {stepLogs.map((log, i) => (
              <div
                key={i}
                className={
                  "text-xs " +
                  (log.includes("[Node]")
                    ? "text-amber-400 font-medium"
                    : log.includes("Executed")
                    ? "text-emerald-400"
                    : log.includes("[思考]")
                    ? "text-violet-400"
                    : log.includes("[RAG]")
                    ? "text-cyan-400"
                    : log.includes("[验证]")
                    ? "text-yellow-400"
                    : log.includes("failed") || log.includes("Failed")
                    ? "text-red-400"
                    : log.includes("Done")
                    ? "text-emerald-300 font-medium"
                    : "text-zinc-400")
                }
              >
                <span className="text-zinc-600 mr-1 select-none">▸</span>
                {log}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
