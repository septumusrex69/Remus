import { describe, expect, it } from 'vitest'
import { BRAND_PHOTOS, DEFAULT_PHOTOS, photoFor, photoUrl } from './brandPhotos'

describe('brand photographs', () => {
  it('every default is a candidate, and ids are unique', () => {
    for (const id of Object.values(DEFAULT_PHOTOS)) expect(BRAND_PHOTOS.some((p) => p.id === id)).toBe(true)
    expect(new Set(BRAND_PHOTOS.map((p) => p.id)).size).toBe(BRAND_PHOTOS.length)
  })
  it('a choice that is not one of ours falls back to the default', () => {
    expect(photoFor('band', { band: 'nope' }).id).toBe(DEFAULT_PHOTOS.band)
    expect(photoFor('band', { band: 'LMpO06hCJyI' }).id).toBe('LMpO06hCJyI')
  })
  it('always black and white', () => {
    expect(photoUrl(BRAND_PHOTOS[0], 800)).toContain('sat=-100')
  })
})
