import { lazy, Suspense, type ComponentProps } from 'react'

const charts = () => import('./charts')
const ProfitChart = lazy(() => charts().then((m) => ({ default: m.ProfitPerProjectChart })))
const CategoryChart = lazy(() => charts().then((m) => ({ default: m.CategoryBarChart })))

const placeholder = <div className="h-full w-full animate-pulse rounded-lg bg-slate-100" />

export function LazyProfitPerProjectChart(props: ComponentProps<typeof ProfitChart>) {
  return <Suspense fallback={placeholder}><ProfitChart {...props} /></Suspense>
}

export function LazyCategoryBarChart(props: ComponentProps<typeof CategoryChart>) {
  return <Suspense fallback={placeholder}><CategoryChart {...props} /></Suspense>
}
