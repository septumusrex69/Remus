import { describe, expect, it } from 'vitest'
import { crawlStore, diagnose, fromEmbeddedJson, fromJsonLd, fromMicrodata, parsePrice, type StoreDef } from './priceCrawl.js'

/* Pages written by hand in the shapes shops use; the real stores are checked on the preview. */

const BASE = 'https://shop.example.co.za/search?q=toilet'

describe('prices as South African shops write them', () => {
  it('reads rand in every common shape', () => {
    expect(parsePrice('R 1 299,00')).toBe(1299)
    expect(parsePrice('R1,299.00')).toBe(1299)
    expect(parsePrice('1299.5')).toBe(1299.5)
    expect(parsePrice('R 12 999,95')).toBe(12999.95)
    expect(parsePrice('ZAR 1.299,00')).toBe(1299)
    expect(parsePrice(349)).toBe(349)
  })
  it('a missing, zero or wordy price is no price', () => {
    expect([parsePrice(''), parsePrice('Call for price'), parsePrice(0), parsePrice(null), parsePrice(Number.NaN)]).toEqual([null, null, null, null, null])
  })
})

describe('reading products', () => {
  it('JSON-LD: a Product, and Products inside an ItemList', () => {
    const html = `<script type="application/ld+json">{"@type":"ItemList","itemListElement":[
      {"@type":"ListItem","item":{"@type":"Product","name":"Close Coupled Toilet White","url":"/p/123","image":["/i/1.jpg"],"brand":{"name":"Cobra"},
        "offers":{"@type":"Offer","price":"1299.00","priceCurrency":"ZAR"}}}]}</script>
      <script type="application/ld+json">{"@type":"Product","name":"Toilet Seat &amp; Lid","offers":[{"price":199,"priceCurrency":"ZAR"}]}</script>`
    const p = fromJsonLd(html, BASE)
    expect(p.map((x) => [x.name, x.price, x.url, x.brand])).toEqual([
      ['Close Coupled Toilet White', 1299, 'https://shop.example.co.za/p/123', 'Cobra'],
      ['Toilet Seat & Lid', 199, null, null],
    ])
  })
  it('JSON-LD in another currency, or broken, is skipped', () => {
    const html = `<script type="application/ld+json">{"@type":"Product","name":"Toilet","offers":{"price":"99","priceCurrency":"USD"}}</script>
      <script type="application/ld+json">{ not json </script>`
    expect(fromJsonLd(html, BASE)).toEqual([])
  })
  it('embedded JSON: anything with a name and a price, whatever the keys', () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"results":[
      {"productName":"Galvanised Pipe 20mm x 6m","price":{"formattedValue":"R 389,95","value":389.95},"url":"/galv-20"},
      {"title":"Galvanised Elbow 20mm","finalPrice":"R 24,99"},
      {"name":"Colour","value":3}]}}}</script>`
    const p = fromEmbeddedJson(html, BASE)
    expect(p.map((x) => [x.name, x.price])).toEqual([['Galvanised Pipe 20mm x 6m', 389.95], ['Galvanised Elbow 20mm', 24.99]])
  })
  it('microdata', () => {
    const html = `<div itemscope itemtype="https://schema.org/Product"><span itemprop="name">Basin Mixer</span>
      <meta itemprop="price" content="649.00"><a itemprop="url" href="/basin-mixer">x</a></div>`
    expect(fromMicrodata(html, BASE)).toEqual([{ name: 'Basin Mixer', price: 649, url: 'https://shop.example.co.za/basin-mixer', image: null, brand: null, via: 'microdata' }])
  })
})

describe('what a page that gave nothing was', () => {
  it('turned away, a robot check, drawn by script, or simply empty', () => {
    expect(diagnose(403, '').outcome).toBe('blocked')
    expect(diagnose(200, '<html><div id="cf-chl-widget"></div></html>').outcome).toBe('challenge')
    expect(diagnose(200, '<html><body><div id="root"></div><script src="/app.js"></script></body></html>').outcome).toBe('script-only')
    expect(diagnose(200, `<html><body>${'<p>Nothing found for your search, try another word.</p>'.repeat(60)}</body></html>`).outcome).toBe('no-products')
  })
})

describe('one store, end to end', () => {
  const store: StoreDef = { id: 'x', name: 'Example', searchUrl: (q) => `https://shop.example.co.za/search?q=${encodeURIComponent(q)}` }
  const page = (body: string, status = 200) => (async () => new Response(body, { status })) as unknown as typeof fetch
  it('reads, and reads the same product only once', async () => {
    const html = `<script type="application/ld+json">{"@type":"Product","name":"Toilet A","offers":{"price":"999","priceCurrency":"ZAR"}}</script>
      <script type="application/json">{"items":[{"name":"Toilet A","price":"R 999,00"},{"name":"Toilet B","price":"R 1 499,00"}]}</script>`
    const r = await crawlStore(store, 'toilet', page(html))
    expect(r.outcome).toBe('ok')
    expect(r.products.map((p) => p.name)).toEqual(['Toilet A', 'Toilet B'])
  })
  it('a refusal is reported, not thrown', async () => {
    const r = await crawlStore(store, 'toilet', page('Forbidden', 403))
    expect([r.outcome, r.products.length]).toEqual(['blocked', 0])
    const down = await crawlStore(store, 'toilet', (async () => { throw new Error('getaddrinfo ENOTFOUND') }) as unknown as typeof fetch)
    expect(down.outcome).toBe('error')
  })
})
