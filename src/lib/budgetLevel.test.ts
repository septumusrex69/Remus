import { describe, expect, it } from 'vitest'
import { budgetAlertLevel, budgetColour } from './budgetLevel'

describe('budget colours', () => {
  it('green, then yellow at 75%, then red at 90%', () => {
    expect(budgetColour({ costPct: 40, tone: 'good' })).toBe('green')
    expect(budgetColour({ costPct: 74, tone: 'good' })).toBe('green')
    expect(budgetColour({ costPct: 75, tone: 'good' })).toBe('yellow')
    expect(budgetColour({ costPct: 89, tone: 'good' })).toBe('yellow')
    expect(budgetColour({ costPct: 90, tone: 'warn' })).toBe('red')
    expect(budgetColour({ costPct: 120, tone: 'bad' })).toBe('red')
  })
  it('the verdict can make it worse, never better', () => {
    expect(budgetColour({ costPct: 60, tone: 'warn' })).toBe('yellow')
    expect(budgetColour({ costPct: 50, tone: 'bad' })).toBe('red')
  })
  it('a finished job keeps its verdict', () => {
    expect(budgetColour({ costPct: 95, tone: 'good' }, false)).toBe('green')
    expect(budgetColour({ costPct: null, tone: 'neutral' })).toBe('grey')
  })
  it('the bell: yellow, red, over', () => {
    expect(budgetAlertLevel(null)).toBeNull()
    expect(budgetAlertLevel(70)).toBeNull()
    expect(budgetAlertLevel(75)).toBe('yellow')
    expect(budgetAlertLevel(90)).toBe('red')
    expect(budgetAlertLevel(100)).toBe('red')
    expect(budgetAlertLevel(101)).toBe('over')
  })
})
