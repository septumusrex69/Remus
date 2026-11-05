import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { cleanExtraction, fixDate, readingSize, shrinkForReading } from './slipReader.js'

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

describe('the first five test slips (Remus · Handover 8)', () => {
  it('reads a month-first date the other way round when day-first would be in the future', () => {
    // Brite-Lite: "06/11/26" read day-first on 5 Nov 2026 is 6 Nov -- tomorrow, so it is 11 June.
    expect(fixDate('2026-11-06', '2026-11-05')).toBe('2026-06-11')
    expect(fixDate('2026-11-05', '2026-11-05')).toBe('2026-11-05')
    expect(fixDate('2026-12-06', '2026-11-05')).toBe('2026-06-12')
    expect(fixDate('2026-09-21', '2026-11-05')).toBe('2026-09-21')
    expect(fixDate('2027-03-30', '2026-11-05')).toBeNull() // cannot be swapped: dropped, not kept wrong
    expect(fixDate(null, '2026-11-05')).toBeNull()
  })
  it('keeps the handwritten note and negative promotion lines', () => {
    const x = cleanExtraction({ supplier: 'Madibeng Local Municipality', date: '2026-09-17', total_incl: 232.38, vat: null, slip_number: null, line_items: [], note: ' Nancy Rubble Removal ' }, '2026-11-05')
    expect(x.note).toBe('Nancy Rubble Removal')
    const b = cleanExtraction({ supplier: 'Builders', date: '2026-09-21', total_incl: 900, vat: 117.39, slip_number: 'S148210926102036', note: null,
      line_items: [{ description: 'Lasher spade 660mm', quantity: 2, amount: 518 }, { description: 'Promotion item', quantity: null, amount: -60 }] }, '2026-11-05')
    expect(b.line_items[1].amount).toBe(-60)
    expect(b.note).toBeNull()
  })
})
