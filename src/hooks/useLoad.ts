import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Last result per page query, for stale-while-revalidate: going back to a page shows what it had
 * straight away and refreshes in the background, instead of a spinner and a fresh round trip to
 * the database (Paris, ~150-200 ms each way from South Africa). Cleared on sign-out.
 */
const cache = new Map<string, unknown>()

export function clearLoadCache() {
  cache.clear()
}

/**
 * Loads async data for a page. `deps` re-run the loader; `reload()` re-runs it on demand
 * (after a save). Results from a superseded run are dropped.
 *
 * With a `cacheKey`, the last result for that key (plus deps) is shown at once while it refreshes.
 */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = [], cacheKey?: string) {
  const fullKey = cacheKey ? `${cacheKey}:${JSON.stringify(deps)}` : null
  const cached = fullKey && cache.has(fullKey) ? (cache.get(fullKey) as T) : null
  const [data, setData] = useState<T | null>(cached)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(cached === null)
  const [tick, setTick] = useState(0)
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const run = useRef(0)

  useEffect(() => {
    const id = ++run.current
    // Switching to other deps (another project, say): show its cached copy, if any, right away.
    if (fullKey && cache.has(fullKey)) setData(cache.get(fullKey) as T)
    setLoading(true)
    loaderRef
      .current()
      .then((d) => {
        if (id !== run.current) return
        if (fullKey) cache.set(fullKey, d)
        setData(d)
        setError(null)
      })
      .catch((e: unknown) => {
        if (id !== run.current) return
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (id === run.current) setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, fullKey, ...deps])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  const set = useCallback(
    (v: T | null | ((prev: T | null) => T | null)) =>
      setData((prev) => {
        const next = typeof v === 'function' ? (v as (p: T | null) => T | null)(prev) : v
        if (fullKey && next !== null) cache.set(fullKey, next)
        return next
      }),
    [fullKey],
  )
  return { data, error, loading, reload, setData: set }
}
