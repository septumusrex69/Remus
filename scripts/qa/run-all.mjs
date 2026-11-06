#!/usr/bin/env node
/**
 * Every check Remus has, in one command, with one answer at the end.
 *
 *   npm run qa              everything (about three minutes)
 *   npm run qa -- --fast    everything but the browser (about a minute) -- what GitHub runs on every push
 *
 * COPIED FROM RAPTOR (scripts/qa/run-all.mjs and 55a7520 "test everything with one command, tour the app with a
 * robot, and get told when it breaks"), adapted to Remus · Handover 8. In order:
 *
 *   1. typecheck          tsc -b, the same check Vercel runs before it builds
 *   2. lint               oxlint src api
 *   3. unit tests         vitest run (the money, the dates, the access rules ...)
 *   4. production build   vite build -- if this fails, Vercel cannot deploy
 *   5. the browser        scripts/qa/e2e/*.mjs: the real app in a real browser, every request answered from fixtures.
 *                         tour.mjs visits every page on a phone and a desk; the others check particular screens.
 *
 * Exit code is 0 only if everything passed, so CI can gate on it.
 *
 * Raptor's rule kept: A BROWSER FILE THAT REPORTS NO COUNT IS A FAILURE, not a zero. A file that exits 0 having
 * asserted nothing (an early return, a loop over an empty list) would otherwise look exactly like a healthy one.
 *
 * DIFFERENT FROM RAPTOR: Raptor's checks are ~440 check-*.mjs files run by node; Remus's unit tests are vitest
 * files beside the code (src/lib/*.test.ts), so this runs the four tools rather than a folder of scripts. And the
 * browser files share ONE dev server, started here on a free port, instead of each starting its own on 5199.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '../..')
const fast = process.argv.includes('--fast')
const verbose = process.argv.includes('--verbose')
const bin = (name) => path.join(ROOT, 'node_modules/.bin', name)

/** Run one command, capture what it prints. Never throws. */
function run(cmd, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env, FORCE_COLOR: '0', NO_COLOR: '1' } })
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { out += d })
    child.on('error', (e) => resolve({ code: 1, out: `${out}\n${e.message}` }))
    child.on('close', (code) => resolve({ code: code ?? 1, out }))
  })
}

/*
 * Each step says how many checks it made, so the headline counts checks, not steps. A tool that checks the whole
 * code base at once (the typecheck, the linter, the build) counts as one.
 */
const STEPS = [
  { label: 'typecheck', cmd: bin('tsc'), args: ['-b'], count: () => 1 },
  { label: 'lint', cmd: bin('oxlint'), args: ['src', 'api'], count: () => 1 },
  {
    label: 'unit tests',
    cmd: bin('vitest'),
    args: ['run'],
    count: (out) => Number(/Tests\s+(\d+) passed/.exec(out)?.[1] ?? NaN),
  },
  {
    label: 'production build',
    cmd: bin('vite'),
    args: ['build', '--logLevel', 'warn'],
    count: () => 1,
    // The build needs a database address to exist; it is never contacted.
    env: { VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? 'https://fake.supabase.co', VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY ?? 'fake-anon-key' },
  },
]

const started = Date.now()
let checks = 0
const failed = []
const line = (ok, label, detail, ms) =>
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(28)} ${detail.padStart(14)} ${`${(ms / 1000).toFixed(1)}s`.padStart(7)}`)
const showTail = (out) => {
  const lines = out.split('\n').filter((l) => l.trim())
  console.log(lines.slice(-30).map((l) => `       ${l}`).join('\n'))
}

console.log(`Remus QA${fast ? ' (fast: no browser)' : ''}\n`)

for (const s of STEPS) {
  const t = Date.now()
  const r = await run(s.cmd, s.args, s.env)
  const n = s.count(r.out)
  const ok = r.code === 0 && Number.isFinite(n)
  line(ok, s.label, ok ? `${n} check${n === 1 ? '' : 's'}` : '', Date.now() - t)
  if (ok) checks += n
  else { failed.push(s.label); showTail(r.out) }
  if (ok && verbose) showTail(r.out)
}

if (!fast) {
  const dir = path.join(ROOT, 'scripts/qa/e2e')
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs') && !['harness.mjs', 'fixtures.mjs'].includes(f)).sort()
  // One dev server for all of them (harness.mjs startServer), stopped when this process ends.
  const { startServer } = await import(pathToFileURL(path.join(dir, 'harness.mjs')).href)
  const t0 = Date.now()
  const { origin, stop } = await startServer()
  console.log(`\n  (browser: dev server on ${origin}, ready in ${((Date.now() - t0) / 1000).toFixed(1)}s)`)
  try {
    for (const f of files) {
      const t = Date.now()
      const r = await run(process.execPath, [path.join(dir, f)], { REMUS_E2E_ORIGIN: origin })
      const n = /(\d+) passed, 0 failed/.exec(r.out)
      const ok = r.code === 0 && !!n
      line(ok, `browser: ${f.replace(/\.mjs$/, '')}`, ok ? `${n[1]} checks` : '', Date.now() - t)
      if (ok) checks += Number(n[1])
      else {
        failed.push(`browser: ${f}`)
        if (r.code === 0) console.log('       exited 0 but printed no "N passed, 0 failed" line, so it counted as nothing.')
        showTail(r.out)
      }
      if (ok && verbose) showTail(r.out)
    }
  } finally {
    stop()
  }
}

const secs = ((Date.now() - started) / 1000).toFixed(0)
console.log(failed.length === 0
  ? `\nAll green: ${checks.toLocaleString('en-ZA')} checks in ${secs}s.`
  : `\nFAILED: ${failed.join(', ')} (${secs}s). Screenshots of failing pages are in .qa-screenshots/.`)
process.exit(failed.length === 0 ? 0 : 1)
