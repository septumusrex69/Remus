import { useEffect, useState } from 'react'
import { RemusOpening } from './RemusOpening'
import { onRemusOpening } from './openingQueue'
import { chosenOpening } from './openingChoice'

/**
 * THE OPENING AFTER A SIGN-IN, OUTSIDE THE ROUTES (copied from Raptor S16). It sits above <Routes> in App, so it is
 * never remounted (and restarted) as the page under it goes from the sign-in to "Loading…" to the app -- which is
 * what it covers. The Sign in button asks for it (queueRemusOpening) once the password is accepted; a reload of a
 * session already signed in plays nothing, because a show on every refresh is a wait.
 */
export function SignInOpening() {
  const [run, setRun] = useState(0)
  const [showing, setShowing] = useState(false)
  useEffect(() => {
    onRemusOpening(() => { setRun((n) => n + 1); setShowing(true) })
    return () => onRemusOpening(null)
  }, [])
  return showing ? <RemusOpening key={run} variant={chosenOpening()} onDone={() => setShowing(false)} /> : null
}
