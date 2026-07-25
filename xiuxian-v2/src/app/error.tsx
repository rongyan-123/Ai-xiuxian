'use client'

/**
 * Next.js App Router error boundary for the root route segment.
 *
 * Catches render errors thrown in page.tsx, layout.tsx, or any child
 * component during rendering. Automatically resets when the user
 * navigates to a different route or retries.
 *
 * Async errors (SSE stream failures, fetch errors) are handled by
 * the game-turn reducer and Zustand store — not this boundary.
 */
import { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle, RefreshCw, Home } from 'lucide-react'

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[Route Error Boundary]', error)
  }, [error])

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <div className="flex flex-col items-center p-8 rounded-2xl bg-red-950/10 border border-red-500/10 max-w-md mx-4" role="alert">
        <AlertTriangle className="h-12 w-12 text-red-400 mb-4" />
        <h1 className="text-lg font-semibold text-zinc-200 mb-2 font-chinese">
          天道异常
        </h1>
        <p className="text-sm text-zinc-400 mb-2 text-center">
          界面渲染时发生错误，请尝试重新加载。
        </p>
        {error.digest && (
          <p className="text-xs text-zinc-600 font-mono mb-4">
            ID: {error.digest}
          </p>
        )}
        <div className="flex gap-3">
          <button
            onClick={reset}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-800/40 border border-red-500/40 text-red-200 hover:bg-red-700/50 hover:text-red-100 transition-colors text-sm"
          >
            <RefreshCw className="h-4 w-4" />
            重试
          </button>
          <Link
            href="/"
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 transition-colors text-sm"
          >
            <Home className="h-4 w-4" />
            返回首页
          </Link>
        </div>
      </div>
    </div>
  )
}
