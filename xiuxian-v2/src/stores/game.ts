"use client";

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import { IPlayer, IChatMessage, JournalEntry, CodexEntry } from "@/types"

export interface GameState {
  // 单对话：只有一场修仙旅程
  player: IPlayer | null
  chatHistory: IChatMessage[]
  journal: JournalEntry[]
  codex: CodexEntry[]
  phase: "INIT" | "SELECT" | "PLAYING" | "DEAD"
  currentView: "chat" | "backpack" | "stats" | "settings" | "journal" | "codex"
  isLoading: boolean
  currentEvent: string
  notifications: Record<string, number>
  pendingInput: string
  stepLogs: string[]
  streamingText: string

  setPhase: (phase: GameState["phase"]) => void
  setPlayer: (player: IPlayer) => void
  updateStats: (stats: Partial<IPlayer["stats"]>) => void
  updateInventory: (inventory: IPlayer["inventory"]) => void
  addMessage: (msg: IChatMessage) => void
  removeMessage: (id: string) => void
  addJournal: (entry: JournalEntry) => void
  addCodex: (entry: CodexEntry) => void
  clearHistory: () => void
  setCurrentView: (v: GameState["currentView"]) => void
  setLoading: (v: boolean) => void
  setCurrentEvent: (v: string) => void
  addNotification: (key: string) => void
  clearNotification: (key: string) => void
  setPendingInput: (input: string) => void
  resetGame: () => void
  appendStepLog: (label: string) => void
  setStepLogs: (logs: string[]) => void
  setStreamingText: (text: string) => void
}

export const useGameStore = create<GameState>()(
  persist(
    (set) => ({
      player: null,
      chatHistory: [],
      journal: [],
      codex: [],
      phase: "INIT",
      currentView: "chat",
      isLoading: false,
      currentEvent: "",
      notifications: {},
      pendingInput: "",
      stepLogs: [],
      streamingText: "",

      setPhase: (phase) => set({ phase }),
      setPlayer: (player) => set((s) => ({ player: player, codex: (player && player.codex) ? player.codex : s.codex })),
      updateStats: (stats) => set((s) => ({
        player: s.player ? { ...s.player, stats: { ...s.player.stats, ...stats } as IPlayer["stats"] } : null,
      })),
      updateInventory: (inventory) => set((s) => ({
        player: s.player ? { ...s.player, inventory } : null,
      })),
      addCodex: (entry) => set((s) => ({ codex: [...s.codex, entry] })),
      addJournal: (entry) => set((s) => ({
        journal: [...s.journal, entry],
      })),
      addMessage: (msg) => set((s) => ({
        chatHistory: [...s.chatHistory, msg],
      })),
      removeMessage: (id) => set((s) => ({
        chatHistory: s.chatHistory.filter(m => m.id !== id),
      })),
      clearHistory: () => set({ chatHistory: [] }),
      setCurrentView: (currentView) => set((s) => {
        const notif = { ...s.notifications };
        if (currentView !== 'chat') notif[currentView] = 0;
        return { currentView, notifications: notif };
      }),
      setLoading: (isLoading) => set({ isLoading }),
      setCurrentEvent: (currentEvent) => set({ currentEvent }),
      addNotification: (key) => set((s) => ({
        notifications: { ...s.notifications, [key]: (s.notifications[key] || 0) + 1 },
      })),
      clearNotification: (key) => set((s) => ({
        notifications: { ...s.notifications, [key]: 0 },
      })),
      setPendingInput: (pendingInput) => set({ pendingInput }),
      resetGame: () => set({ player: null, chatHistory: [],
      journal: [], codex: [], phase: "INIT", currentView: "chat", notifications: {}, pendingInput: "", stepLogs: [], streamingText: "" }),
      appendStepLog: (label) => set((s) => ({ stepLogs: [...s.stepLogs, label] })),
      setStepLogs: (stepLogs) => set({ stepLogs }),
      setStreamingText: (streamingText) => set({ streamingText }),
    }),
    {
      name: "xiuxian-game",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ player: s.player, chatHistory: s.chatHistory, phase: s.phase, journal: s.journal, codex: s.codex }),
    }
  )
)