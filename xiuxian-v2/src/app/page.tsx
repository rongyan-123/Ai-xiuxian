"use client";

import { GameSidebar } from "@/components/game-sidebar"
import { ChatPanel } from "@/components/chat-panel"
import { StatusPanel } from "@/components/status-panel"
import { InitScreen } from "@/components/init-screen"
import { SettingsPanel } from "@/components/settings-panel"
import { BackpackPanel } from "@/components/backpack-panel"
import { StatsDetailPanel } from "@/components/stats-panel"
import { JournalPanel } from "@/components/journal-panel"
import { CodexPanel } from "@/components/codex-panel"
import { MobileTabBar } from "@/components/mobile-tab-bar"
import { MobileSheet } from "@/components/mobile-sheet"
import { useGameStore } from "@/stores/game"
import { useState, useEffect } from "react"

export default function Home() {
  const [mounted, setMounted] = useState(false)
  const { currentView, phase, setCurrentView } = useGameStore()
  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  const mobileSheetProps = {
    backpack: { title: "背包", height: "full" as const },
    stats: { title: "属性", height: "full" as const },
    codex: { title: "图鉴", height: "full" as const },
    journal: { title: "日志", height: "full" as const },
    settings: { title: "设置", height: "full" as const },
  }

  return (
    <main className="flex h-full overflow-hidden bg-zinc-950">
      {/* === 桌面端：三栏布局 (md及以上) === */}
      <div className="hidden md:flex w-full h-full">
        <GameSidebar />
        <div className="flex flex-1 flex-col relative overflow-hidden min-h-0">
          {currentView === "settings" && <SettingsPanel />}
          {currentView === "backpack" && <BackpackPanel />}
          {currentView === "journal" && <JournalPanel />}
          {currentView !== "settings" && currentView !== "backpack" && currentView !== "journal" && phase === "INIT" && <InitScreen />}
          {/* 开局固定模板，直接进 PLAYING（SelectScreen 已停用） */}
          {/* ChatPanel始终挂载，CSS隐藏代替卸载，避免切换面板中断SSE流 */}
          {phase === "PLAYING" && (
            <div
              style={{ display: currentView === "chat" ? "flex" : "none" }}
              className="flex-1 flex-col relative overflow-hidden min-h-0"
            >
              <ChatPanel />
            </div>
          )}
          {phase === "PLAYING" && currentView === "stats" && <StatsDetailPanel />}
          {phase === "PLAYING" && currentView === "codex" && <CodexPanel />}
          {phase === "DEAD" && <div className="flex items-center justify-center h-full text-red-500 text-2xl font-chinese">小元已尽</div>}
        </div>
        {phase === "PLAYING" && <StatusPanel />}
      </div>

      {/* === 移动端：全屏内容 + 底部Tab + Sheet === */}
      <div className="md:hidden flex flex-col w-full h-full">
        <div className="flex-1 overflow-y-auto">
          {currentView === "chat" && phase === "INIT" && <InitScreen />}
          {/* 移动端ChatPanel同样保持挂载（CSS隐藏），避免sheet打开时断流 */}
          {phase === "PLAYING" && (
            <div style={{ display: currentView === "chat" ? "flex" : "none" }} className="flex flex-col h-full">
              <ChatPanel />
            </div>
          )}
          {phase === "DEAD" && <div className="flex items-center justify-center h-full text-red-500 text-xl font-chinese">小元已尽</div>}
        </div>

        <MobileTabBar />

        {/* 移动端 Sheet：覆盖显示非聊天视图 */}
        <MobileSheet
          open={currentView === "backpack"}
          onClose={() => setCurrentView("chat")}
          title="背包"
          height="full"
        >
          <BackpackPanel />
        </MobileSheet>

        <MobileSheet
          open={currentView === "stats"}
          onClose={() => setCurrentView("chat")}
          title="属性"
          height="full"
        >
          <StatsDetailPanel />
        </MobileSheet>

        <MobileSheet
          open={currentView === "codex"}
          onClose={() => setCurrentView("chat")}
          title="图鉴"
          height="full"
        >
          <CodexPanel />
        </MobileSheet>

        <MobileSheet
          open={currentView === "journal"}
          onClose={() => setCurrentView("chat")}
          title="日志"
          height="full"
        >
          <JournalPanel />
        </MobileSheet>

        <MobileSheet
          open={currentView === "settings"}
          onClose={() => setCurrentView("chat")}
          title="设置"
          height="full"
        >
          <SettingsPanel />
        </MobileSheet>
      </div>
    </main>
  )
}
