/*
 * The Sign in button's way of asking SignInOpening (mounted above the routes) to play. Its own file because a module
 * that exports a component should export only components (fast refresh). Copied from Raptor S16.
 */
let listener: (() => void) | null = null

export function onRemusOpening(fn: (() => void) | null): void {
  listener = fn
}

export function queueRemusOpening(): void {
  listener?.()
}
