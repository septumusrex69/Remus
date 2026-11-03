import { describe, expect, it } from 'vitest'
import { budgetAlertLevel, budgetColour, budgetStep } from './budgetLevel'

describe('the bell at 50, 75, 90 and 100%', () => {
  it('says the highest step reached, nothing under half', () => {
    expect(budgetStep(null)).toBeNull()
    expect(budgetStep(49.9)).toBeNull()
    expect(budgetStep(50)).toBe(50)
    expect(budgetStep(74)).toBe(50)
    expect(budgetStep(75)).toBe(75)
    expect(budgetStep(92)).toBe(90)
    expect(budgetStep(100)).toBe(100)
    expect(budgetStep(140)).toBe(100)
  })
})

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
