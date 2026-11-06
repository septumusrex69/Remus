import { configDefaults, defineConfig } from 'vitest/config'

/*
 * Unit tests are Remus's own: never the copies helper sessions leave under .claude/worktrees (Remus · Handover 8,
 * when one `npm run qa` counted 1 085 tests because it ran three checkouts at once).
 */
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
})
