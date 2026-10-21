import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * A crash anywhere below shows a "Something went wrong" panel with a Reload button instead of a
 * blank page. A page whose code can't be fetched (usually because a new version was deployed while
 * the app was open) reloads once by itself to pick up the new version.
 */

const RELOADED_KEY = 'remus.chunkReloadAt'

function isChunkLoadError(error: unknown): boolean {
  const msg = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk/i.test(msg)
}

/** Reload once for a missing chunk; false if we already tried in the last minute. */
function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOADED_KEY) || 0)
    if (Date.now() - last < 60_000) return false
    sessionStorage.setItem(RELOADED_KEY, String(Date.now()))
  } catch {
    return false
  }
  window.location.reload()
  return true
}

interface Props {
  children: ReactNode
  /** Changing this (e.g. the route path) clears a previous error, so navigating away recovers. */
  resetKey?: string
}

export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Remus crashed', error, info.componentStack)
    if (isChunkLoadError(error)) reloadForNewVersion()
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const chunk = isChunkLoadError(error)
    return (
      <div className="flex min-h-[50vh] items-center justify-center px-4 py-10">
        <div className="max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <p className="mb-1 font-semibold text-slate-900">{chunk ? 'A new version of Remus is available' : 'Something went wrong'}</p>
          <p className="mb-4 text-sm text-slate-500">
            {chunk ? 'Reload to continue.' : 'This page hit an error. Your saved work is safe. Reload to try again.'}
          </p>
          {!chunk && <p className="mb-4 break-words rounded bg-slate-50 px-3 py-2 text-left font-mono text-xs text-slate-500">{error.message}</p>}
          <div className="flex justify-center gap-2">
            <button onClick={() => window.location.reload()} className="rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-slate-800">Reload</button>
            <a href="/" className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Dashboard</a>
          </div>
        </div>
      </div>
    )
  }
}
