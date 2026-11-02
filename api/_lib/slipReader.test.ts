import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { cleanExtraction, readingSize, shrinkForReading } from './slipReader.js'

describe('readingSize', () => {
  it('shrinks a normal photo to 1200px on its long side', () => {
    expect(readingSize(1500, 2000)).toEqual({ width: 900, height: 1200 })
    expect(readingSize(2000, 1500)).toEqual({ width: 1200, height: 900 })
  })
  it('never makes a photo bigger', () => {
    expect(readingSize(760, 1250)).toEqual({ width: 730, height: 1200 })
    expect(readingSize(600, 800)).toEqual({ width: 600, height: 800 })
  })
  it('keeps a long till slip wide enough to read, at no more pixels than 1200 x 1200', () => {
    const s = readingSize(600, 3000)
    expect(s.width).toBeGreaterThanOrEqual(450)
    expect(s.height).toBeLessThanOrEqual(2400)
    expect(s.width * s.height).toBeLessThanOrEqual(1200 * 1200 + 2400)
  })
})

describe('shrinkForReading', () => {
  it('turns the photo upright from its EXIF, greyscale, JPEG, shrunk', async () => {
    // 2000 wide x 1500 high as stored, EXIF orientation 6 (the phone was held upright): really 1500 x 2000.
    const photo = await sharp({ create: { width: 2000, height: 1500, channels: 3, background: { r: 200, g: 30, b: 30 } } })
      .jpeg().withMetadata({ orientation: 6 }).toBuffer()
    const out = await shrinkForReading(photo)
    expect([out.width, out.height]).toEqual([900, 1200])
    const meta = await sharp(out.data).metadata()
    expect(meta.format).toBe('jpeg')
    expect(meta.channels).toBe(1)
    expect(meta.orientation ?? 1).toBe(1)
    expect(out.bytesOut).toBeLessThan(out.bytesIn)
  })
})

describe('cleanExtraction', () => {
  it('drops a date that is not a date and items without words', () => {
    const x = cleanExtraction({ supplier: ' Cashbuild ', date: '2026-02-30', total_incl: 1819.81, vat: null, slip_number: null,
      line_items: [{ description: 'Cement 50kg', quantity: 4, amount: 459.96 }, { description: '  ', quantity: null, amount: 1 }] })
    expect(x.supplier).toBe('Cashbuild')
    expect(x.date).toBeNull()
    expect(x.line_items).toHaveLength(1)
  })
})
