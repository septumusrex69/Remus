/**
 * REMUS'S OWN PRICE CRAWLER (Remus · Handoff 1, 27 Oct 2026). Stephan: "build our own crawler", then
 * compare it with pure Claude, then a combined version. This is step one: no AI at all.
 *
 * ONE SEARCH PAGE PER STORE PER PRESS. Somebody presses Find prices for one item; Remus opens each
 * store's own search page for it once, the way a browser would, and reads the products off it. It
 * never walks a catalogue -- a store that sees a whole catalogue copied blocks it, and a store that
 * sees one search looks at a shopper.
 *
 * READ WHAT THE STORE ALREADY PUBLISHES FOR MACHINES, NOT ITS LAYOUT. Shops put their products in
 * the page for Google as structured data (JSON-LD `Product` / `ItemList`), and most modern shop
 * front-ends also carry their search results as a JSON blob the page is drawn from. Both survive a
 * redesign; a parser of the visible HTML breaks every time a store moves a div. So extraction tries,
 * in order: JSON-LD, then embedded JSON (any object that has a name and a price), then microdata.
 * Nothing found is reported as exactly that -- with why, where we can tell (blocked, a challenge
 * page, a page drawn only by JavaScript) -- never guessed.
 *
 * PURE, apart from `fetch`: crawlStore takes the fetch it uses, so priceCrawl.test.ts drives it with
 * pages written by hand.
 */

export interface StoreDef {
  id: string
  name: string
  /** The store's own search page for `q`. */
  searchUrl: (q: string) => string
}

/*
 * THE STORES, and the search address each one's own search box goes to. Which of them lets Remus in
 * from its server is exactly what this step finds out; an address that turns out wrong is fixed here.
 */
export const STORES: StoreDef[] = [
  { id: 'builders', name: 'Builders', searchUrl: (q) => `https://www.builders.co.za/search/?text=${encodeURIComponent(q)}` },
  { id: 'leroymerlin', name: 'Leroy Merlin', searchUrl: (q) => `https://leroymerlin.co.za/catalogsearch/result/?q=${encodeURIComponent(q)}` },
  // Cashbuild's own SearchAction (its JSON-LD) names this address; /catalogsearch is a 404 there.
  { id: 'cashbuild', name: 'Cashbuild', searchUrl: (q) => `https://www.cashbuild.co.za/search?search_query=${encodeURIComponent(q)}` },
  { id: 'buco', name: 'BUCO', searchUrl: (q) => `https://www.buco.co.za/search?q=${encodeURIComponent(q)}` },
  { id: 'plumblink', name: 'Plumblink', searchUrl: (q) => `https://www.plumblink.co.za/search?q=${encodeURIComponent(q)}` },
  { id: 'buildit', name: 'Build It', searchUrl: (q) => `https://www.buildit.co.za/search?q=${encodeURIComponent(q)}` },
]

export interface CrawledProduct {
  name: string
  /** Rand, as the store shows it (VAT inclusive, which is how SA retail prices are shown). */
  price: number
  url: string | null
  image: string | null
  brand: string | null
  /** The store's own product code (SKU) -- what the shopping list says to ask for. Null where not shown. */
  code: string | null
  /** Which reader found it: kept so the comparison with Claude can say where each crawler is weak. */
  via: 'json-ld' | 'embedded-json' | 'microdata' | 'product-card'
}

export type CrawlOutcome = 'ok' | 'no-products' | 'blocked' | 'challenge' | 'script-only' | 'error' | 'timeout'

export interface StoreResult {
  store: string
  name: string
  url: string
  outcome: CrawlOutcome
  /** In plain words for the screen: what happened at this store. */
  note: string
  httpStatus: number | null
  ms: number
  bytes: number
  products: CrawledProduct[]
}

export const MAX_PRODUCTS = 12
const TIMEOUT_MS = 12_000

/** A browser's headers: a request that says it is a script is the first thing a shop turns away. */
export const BROWSER_HEADERS: Record<string, string> = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-ZA,en;q=0.9',
}

/** "R 1 299,00", "1299.00", 1299, "ZAR 1,299.00" -> 1299. Null when it is not a usable positive price. */
export function parsePrice(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? Math.round(raw * 100) / 100 : null
  if (typeof raw !== 'string') return null
  let s = raw.replace(/[^\d.,]/g, '')
  if (!s) return null
  // A comma followed by exactly two digits at the end is the decimal comma (en-ZA); other commas group.
  if (/,\d{2}$/.test(s) && !/\.\d{2}$/.test(s)) s = s.replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.')
  else s = s.replace(/,/g, '')
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
}

function absolute(url: unknown, base: string): string | null {
  if (typeof url !== 'string' || !url.trim()) return null
  try { return new URL(url, base).toString() } catch { return null }
}

function firstString(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null
  if (Array.isArray(v)) return firstString(v[0])
  if (v && typeof v === 'object') return firstString((v as Record<string, unknown>).url ?? (v as Record<string, unknown>).name)
  return null
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' }
function decode(s: string): string {
  return s.replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  }).replace(/\s+/g, ' ').trim()
}

/** A schema.org Product (or anything shaped like one) to a product, or null. */
function fromSchemaProduct(o: Record<string, unknown>, base: string): CrawledProduct | null {
  const name = typeof o.name === 'string' ? decode(o.name) : null
  if (!name) return null
  const offers = Array.isArray(o.offers) ? o.offers[0] : o.offers
  const off = (offers && typeof offers === 'object' ? offers : {}) as Record<string, unknown>
  const price = parsePrice(off.price ?? off.lowPrice ?? o.price)
  if (price === null) return null
  const currency = typeof off.priceCurrency === 'string' ? off.priceCurrency.toUpperCase() : 'ZAR'
  if (currency !== 'ZAR') return null
  return {
    name,
    price,
    url: absolute(o.url ?? off.url, base),
    image: absolute(firstString(o.image), base),
    brand: firstString(o.brand),
    code: firstString(o.sku ?? o.mpn ?? o.productID),
    via: 'json-ld',
  }
}

/** Every JSON-LD block, walked for Products (also inside ItemList / @graph). */
export function fromJsonLd(html: string, base: string): CrawledProduct[] {
  const out: CrawledProduct[] = []
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  for (const m of html.matchAll(re)) {
    let data: unknown
    try { data = JSON.parse(m[1].trim()) } catch { continue }
    const walk = (v: unknown, depth: number) => {
      if (depth > 8 || !v) return
      if (Array.isArray(v)) { v.forEach((x) => walk(x, depth + 1)); return }
      if (typeof v !== 'object') return
      const o = v as Record<string, unknown>
      const type = Array.isArray(o['@type']) ? o['@type'] : [o['@type']]
      if (type.includes('Product')) {
        const p = fromSchemaProduct(o, base)
        if (p) out.push(p)
        return
      }
      for (const k of ['@graph', 'itemListElement', 'item', 'mainEntity']) if (k in o) walk(o[k], depth + 1)
    }
    walk(data, 0)
  }
  return out
}

/*
 * EMBEDDED JSON: the state a shop front-end draws its search results from (__NEXT_DATA__, Nuxt,
 * window.__INITIAL_STATE__, a Magento or SAP data island ...). Walked for any object carrying a name
 * and a price -- the keys differ store to store, the shape does not.
 */
const NAME_KEYS = ['name', 'title', 'productName', 'displayName']
const PRICE_KEYS = ['price', 'finalPrice', 'final_price', 'salePrice', 'sellingPrice', 'currentPrice', 'formattedValue', 'value', 'amount']
const URL_KEYS = ['url', 'productUrl', 'link', 'href', 'canonicalUrl', 'url_key']
const IMAGE_KEYS = ['image', 'imageUrl', 'thumbnail', 'img', 'small_image']

function pricey(o: Record<string, unknown>): number | null {
  for (const k of PRICE_KEYS) {
    const v = o[k]
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const inner = v as Record<string, unknown>
      const p = parsePrice(inner.value ?? inner.amount ?? inner.formattedValue ?? (inner.regularPrice as Record<string, unknown> | undefined)?.amount)
      if (p !== null) return p
      const deeper = pricey(inner)
      if (deeper !== null) return deeper
    } else {
      const p = parsePrice(v)
      if (p !== null && k !== 'value' && k !== 'amount') return p
      if (p !== null && (typeof v === 'string' && /R|ZAR|\d[.,]\d{2}/.test(v))) return p
    }
  }
  return null
}

export function fromEmbeddedJson(html: string, base: string): CrawledProduct[] {
  const blobs: string[] = []
  for (const m of html.matchAll(/<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)) blobs.push(m[1])
  for (const m of html.matchAll(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/gi)) blobs.push(m[1])
  for (const m of html.matchAll(/window\.__[A-Z_]+__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/g)) blobs.push(m[1])
  const out: CrawledProduct[] = []
  const seen = new Set<string>()
  for (const blob of blobs) {
    let data: unknown
    try { data = JSON.parse(blob.trim()) } catch { continue }
    const walk = (v: unknown, depth: number) => {
      if (depth > 14 || !v || out.length >= MAX_PRODUCTS * 3) return
      if (Array.isArray(v)) { v.forEach((x) => walk(x, depth + 1)); return }
      if (typeof v !== 'object') return
      const o = v as Record<string, unknown>
      const nameKey = NAME_KEYS.find((k) => typeof o[k] === 'string' && (o[k] as string).trim().length > 3)
      const price = nameKey ? pricey(o) : null
      if (nameKey && price !== null) {
        const name = decode(o[nameKey] as string)
        const key = `${name}|${price}`
        if (!seen.has(key)) {
          seen.add(key)
          const urlKey = URL_KEYS.find((k) => typeof o[k] === 'string')
          const imgKey = IMAGE_KEYS.find((k) => o[k])
          out.push({
            name,
            price,
            url: urlKey ? absolute(o[urlKey], base) : null,
            image: imgKey ? absolute(firstString(o[imgKey]), base) : null,
            brand: firstString(o.brand ?? o.manufacturer),
            code: firstString(o.sku ?? o.code ?? o.productCode),
            via: 'embedded-json',
          })
        }
        return
      }
      for (const k of Object.keys(o)) walk(o[k], depth + 1)
    }
    walk(data, 0)
  }
  return out
}

/** schema.org microdata: an itemscope Product with itemprop="name" and itemprop="price" inside it. */
export function fromMicrodata(html: string, base: string): CrawledProduct[] {
  const out: CrawledProduct[] = []
  const parts = html.split(/itemtype=["']https?:\/\/schema\.org\/Product["']/i).slice(1)
  for (const part of parts) {
    const chunk = part.slice(0, 6000)
    const name = chunk.match(/itemprop=["']name["'][^>]*?(?:content=["']([^"']+)["'][^>]*>|>\s*([^<]+)<)/i)
    const price = chunk.match(/itemprop=["']price["'][^>]*?(?:content=["']([^"']+)["']|>\s*([^<]+)<)/i)
    const url = chunk.match(/itemprop=["']url["'][^>]*?(?:content|href)=["']([^"']+)["']/i)
    const n = name ? decode(name[1] ?? name[2] ?? '') : ''
    const p = price ? parsePrice(price[1] ?? price[2]) : null
    const sku = chunk.match(/itemprop=["']sku["'][^>]*?(?:content=["']([^"']+)["']|>\s*([^<]+)<)/i)
    if (n && p !== null) out.push({ name: n, price: p, url: url ? absolute(url[1], base) : null, image: null, brand: null, code: sku ? (sku[1] ?? sku[2]).trim() : null, via: 'microdata' })
  }
  return out
}

/*
 * THE PRODUCT CARD: a shop page drawn on the server (PrestaShop -- Cashbuild -- and most others) lays
 * each result out as one card that carries its price as an attribute (`data-price="989.95"`), with the
 * name in a link under a heading classed product-title or product-name. Found on Cashbuild's search
 * page, 27 Oct 2026, where none of the readers above found anything.
 */
export function fromProductCards(html: string, base: string): CrawledProduct[] {
  const out: CrawledProduct[] = []
  const starts = [...html.matchAll(/<(article|div|li)\b[^>]*\bdata-price=["']([\d.,]+)["'][^>]*>/gi)]
  starts.forEach((m, i) => {
    const from = m.index ?? 0
    const to = i + 1 < starts.length ? (starts[i + 1].index ?? html.length) : Math.min(html.length, from + 8000)
    const card = html.slice(from, to)
    const price = parsePrice(m[2])
    const title = card.match(/class=["'][^"']*product-(?:title|name)[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i)
      ?? card.match(/class=["'][^"']*product-(?:title|name)[^"']*["'][^>]*>([^<]+)</i)
    if (!title || price === null) return
    const href = title.length === 3 ? title[1] : null
    const name = decode((title.length === 3 ? title[2] : title[1]).replace(/<[^>]+>/g, ' '))
    const img = card.match(/<img\b[^>]*(?:data-src|src)=["']([^"']+)["']/i)
    // Cashbuild's own code ("301401") is on the card's compare link; data-reference-product is an internal id.
    const ref = card.match(/\bdata-reference=["']([^"']+)["']/i) ?? card.match(/\bdata-sku=["']([^"']+)["']/i)
    if (name) out.push({ name, price, url: absolute(href, base), image: img ? absolute(img[1], base) : null, brand: null, code: ref ? ref[1] : null, via: 'product-card' })
  })
  return out
}

/** What a page that gave us nothing was, as far as its markup says. */
export function diagnose(status: number, html: string): { outcome: CrawlOutcome; note: string } {
  const h = html.slice(0, 200_000).toLowerCase()
  if (status === 403 || status === 401 || status === 429) return { outcome: 'blocked', note: `The store turned Remus away (${status}).` }
  if (/cf-chl|challenge-platform|captcha|are you a robot|access denied|incapsula|perimeterx|px-captcha|_abck|akamai/.test(h)) {
    return { outcome: 'challenge', note: 'The store answered with a robot check instead of results.' }
  }
  if (status >= 400) return { outcome: 'error', note: `The store's search page answered ${status}.` }
  const text = h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  if ((text.length < 1500 && /<script/.test(h)) || /id=["']?(react-app|root|app)["']?>\s*<\/div>|<app-root|ng-version|data-beasties-container/.test(h)) {
    return { outcome: 'script-only', note: 'The page is drawn by JavaScript after it loads, so its products are not in what the store sends.' }
  }
  return { outcome: 'no-products', note: 'The page loaded, but no products with prices could be read from it.' }
}

/** One store: fetch its search page once and read the products off it. */
export async function crawlStore(store: StoreDef, query: string, fetchImpl: typeof fetch = fetch): Promise<StoreResult> {
  const url = store.searchUrl(query)
  const started = Date.now()
  const base = { store: store.id, name: store.name, url }
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const res = await fetchImpl(url, { headers: BROWSER_HEADERS, redirect: 'follow', signal: ctl.signal })
    const html = await res.text()
    const pageUrl = res.url || url
    const products = dedupe([...fromJsonLd(html, pageUrl), ...fromEmbeddedJson(html, pageUrl), ...fromProductCards(html, pageUrl), ...fromMicrodata(html, pageUrl)]).slice(0, MAX_PRODUCTS)
    const ms = Date.now() - started
    if (products.length) {
      return { ...base, url: pageUrl, outcome: 'ok', note: `${products.length} product${products.length === 1 ? '' : 's'} read.`, httpStatus: res.status, ms, bytes: html.length, products }
    }
    return { ...base, url: pageUrl, ...diagnose(res.status, html), httpStatus: res.status, ms, bytes: html.length, products: [] }
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    return {
      ...base,
      outcome: aborted ? 'timeout' : 'error',
      note: aborted ? `The store did not answer within ${TIMEOUT_MS / 1000} seconds.` : `Could not reach the store: ${e instanceof Error ? e.message : String(e)}`,
      httpStatus: null, ms: Date.now() - started, bytes: 0, products: [],
    }
  } finally {
    clearTimeout(timer)
  }
}

/** The same product read twice (JSON-LD and the page's own JSON both carry it) is one product. */
function dedupe(list: CrawledProduct[]): CrawledProduct[] {
  const seen = new Set<string>()
  return list.filter((p) => {
    const k = `${p.name.toLowerCase()}|${p.price}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** Every chosen store at once: one slow store does not hold the others up. */
export async function crawlAll(query: string, storeIds: string[] | null, fetchImpl: typeof fetch = fetch): Promise<StoreResult[]> {
  const stores = storeIds?.length ? STORES.filter((s) => storeIds.includes(s.id)) : STORES
  return Promise.all(stores.map((s) => crawlStore(s, query, fetchImpl)))
}
