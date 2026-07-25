/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useState } from 'react'
import { useGameStore } from '@/stores/game'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { motion } from 'framer-motion'

export function InitScreen() {
  const { setPhase, setPlayer, player } = useGameStore()
  const [name, setName] = useState('')
  const [gender, setGender] = useState('男')
  // active removed

  const handleStart = async () => {
    if (!name.trim()) return
    setPlayer({
      id: player?.id || String(Date.now()),
      status: 'ALIVE',
      name: name,
      gender: gender,
      stats: {
        hp: { current: 100, max: 100, status_desc: '良好' },
        mp: { current: 50, max: 50, status_desc: '充沛' },
        spirit: { value: 100, desc: '精神饱满' },
        realm: '练气期一层',
        age: { current: 16, max: 100 },
        race: '人族',
        alignment: '中立',
        sect: '散修',
        spiritual_root: '五行杂灵根',
        mental_state: '心如止水',
        reputation: 0,
        emotion: '平静',
        state_of_mind: 80,
        fortune: 50,
        karma: 0,
        techniques: { main: '基础吐纳', combat: [], movement: '步行', support: [] },
        shield: { current: 0, max: 50 },
        talents: [],
        traits: [],
      },
      inventory: [],
      codex: [],
      relationships: {},
      situations: [],
      foreshadowings: [],
      worldTime: Date.now(),
      currentLocation: '新手村',
      npcs: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: 0,
    })
    setPhase('SELECT')
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col items-center justify-center h-full bg-gradient-to-b from-zinc-950 to-zinc-900 p-4"
    >
      <div className="w-full max-w-md space-y-6 md:space-y-8 px-2 md:px-0">
        <div className="text-center space-y-1.5 md:space-y-2">
          <h1 className="text-2xl md:text-4xl font-bold text-zinc-200 font-chinese tracking-wider">仙 途 启 程</h1>
          <p className="text-sm md:text-base text-zinc-400">道友，请留下你的名号，开启这段修仙之旅</p>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4 md:p-6 shadow-2xl backdrop-blur-sm space-y-5 md:space-y-6">
          <div className="space-y-2">
            <Label htmlFor="name" className="text-zinc-300">道号</Label>
            <Input
              id="name"
              placeholder="请输入你的道号..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-zinc-800 border-zinc-700 text-zinc-200 focus:ring-2 focus:ring-amber-500/50"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-zinc-300">性别</Label>
            <div className="flex gap-4">
              {[['男', '男'], ['女', '女']].map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setGender(val)}
                  className={"px-6 py-2 rounded-lg border transition-colors " + (gender === val ? 'border-amber-500 bg-amber-500/20 text-amber-300' : 'border-zinc-700 text-zinc-400 hover:border-zinc-600')}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <Button
            onClick={handleStart}
            disabled={!name.trim()}
            className="w-full bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white font-bold py-2 px-4 rounded-lg transition-all duration-200 shadow-lg"
          >
            踏入仙途
          </Button>
        </div>
      </div>
    </motion.div>
  )
}
