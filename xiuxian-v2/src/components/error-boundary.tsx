'use client'

import { Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ErrorBoundaryProps {
  children: ReactNode
  /** Custom fallback UI; receives error and reset callback */
  fallback?: (error: Error, reset: () => void) => ReactNode
  /** Called when an error is caught */
  onError?: (error: Error, errorInfo: ErrorInfo) => void
}

interface ErrorBoundaryState {
  error: Error | null
}

// ─── Default Fallback ───────────────────────────────────────────────────────

function DefaultFallback({ error, onReset }: { error: Error; onReset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[200px] p-6 rounded-xl bg-red-950/20 border border-red-500/20" role="alert">
      <AlertTriangle className="h-8 w-8 text-red-400 mb-3" />
      <h3 className="text-sm font-semibold text-red-300 mb-1">界面渲染异常</h3>
      <p className="text-xs text-red-400/70 mb-4 max-w-md text-center font-mono break-all">
        {error.message || 'Unknown render error'}
      </p>
      <button
        onClick={onReset}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-800/40 border border-red-500/40 text-red-200 hover:bg-red-700/50 hover:text-red-100 transition-colors text-xs"
      >
        <RefreshCw className="h-3 w-3" />
        重新加载
      </button>
    </div>
  )
}

// ─── ErrorBoundary ──────────────────────────────────────────────────────────

/**
 * React error boundary that catches render errors in child components.
 *
 * Design rules:
 * - Catches ONLY synchronous render errors (not async/event-handler errors).
 * - Async failures (e.g., SSE stream errors) stay in the typed state machine
 *   (game-turn reducer) and do NOT reach this boundary.
 * - Shows a recoverable fallback UI with a reset button.
 * - Reset remounts children — game state in Zustand is preserved.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] Render error caught:', error.message)
    console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack)
    this.props.onError?.(error, errorInfo)
  }

  handleReset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.handleReset)
      }
      return <DefaultFallback error={this.state.error} onReset={this.handleReset} />
    }

    return this.props.children
  }
}

// ─── Game UI Error Boundary ─────────────────────────────────────────────────

/**
 * Pre-configured error boundary for the game UI shell.
 * Wraps the main game panel and catches render crashes in child components
 * like ChatPanel, SelectScreen, or status displays.
 */
export function GameErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      onError={(error) => {
        // In production, this could report to an error tracking service
        console.warn('[GameErrorBoundary]', error.name, error.message)
      }}
    >
      {children}
    </ErrorBoundary>
  )
}
