import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Loads async data for a page. `deps` re-run the loader; `reload()` re-runs it on demand
 * (after a save). Results from a superseded run are dropped.
 */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const run = useRef(0)

  useEffect(() => {
    const id = ++run.current
    setLoading(true)
    loaderRef
      .current()
      .then((d) => {
        if (id !== run.current) return
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
  }, [tick, ...deps])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, error, loading, reload, setData }
}
