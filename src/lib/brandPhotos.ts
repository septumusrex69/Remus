/**
 * REMUS'S PHOTOGRAPHS (Remus · Handover 6). Stephan, 31 Oct: "cool photos of power tools and like cement trucks
 * and ... mixing of cement with hands working. Some carpentry, but I don't want to see people ... hands ...
 * rustic, same platinum ... maybe it should be black and white."
 *
 * Unsplash photographs, served by Unsplash (as its guidelines ask), always drawn black and white (`sat=-100`).
 * The candidates are on the Photos page (/photos); an Administrator picks one for each place and the choice is
 * kept for everybody in company_settings.brand_photos. The sign-in page, which cannot read settings, remembers
 * the last choice in the browser.
 */
export interface BrandPhoto {
  id: string
  /** images.unsplash.com/photo-..., without a query. */
  base: string
  subject: string
  credit: string
}

export const BRAND_PHOTOS: BrandPhoto[] = [
  { id: '3H3Oz-h3_e0', base: 'https://images.unsplash.com/photo-1587370153281-c8c87fa5caf1', subject: 'A gloved hand on an angle grinder', credit: 'Luke Besley' },
  { id: 'aO4c6o4H2MI', base: 'https://images.unsplash.com/photo-1517437702514-0bdaa494a0b9', subject: 'Hands on a Bosch power tool', credit: 'Adi Goldstein' },
  { id: 'm18r0WxCmEs', base: 'https://images.unsplash.com/photo-1653071179315-6cc30f00415a', subject: 'A drill and a brush', credit: 'piotr krizhanskiy' },
  { id: 'rs4Fo1nEunc', base: 'https://images.unsplash.com/photo-1652989889210-253d2c2baec4', subject: 'A chainsaw in the workshop', credit: 'Ronnzy Moto' },
  { id: 'oHoOrmEms38', base: 'https://images.unsplash.com/photo-1569783899817-a49d2d25287c', subject: 'An adjustable wrench', credit: 'Oxa Roxa' },
  { id: 'VCToeWNGe6g', base: 'https://images.unsplash.com/photo-1649232211859-f99721ff7527', subject: 'A concrete pump hose on the machine', credit: 'Li Lin' },
  { id: 'ND9za8iLATg', base: 'https://images.unsplash.com/photo-1706178982450-c468034bc2eb', subject: 'A heavy truck at a building site', credit: 'Richard Stachmann' },
  { id: 'u7K4-aLbaPU', base: 'https://images.unsplash.com/photo-1610994326415-532b72839f51', subject: 'A cement truck by a building', credit: 'Dipan Kumar Rout' },
  { id: 'S3doeZUW9CM', base: 'https://images.unsplash.com/photo-1650212607236-0e5b1684e5f1', subject: 'A truck tyre, close up', credit: 'Amin Noveyrian' },
  { id: 'EqUFBrTIdeE', base: 'https://images.unsplash.com/photo-1519143009590-e3800b9df468', subject: 'Steel stacked in the yard, shadows', credit: 'Ricardo Gomez Angel' },
  { id: 'idEEZ-wQkfA', base: 'https://images.unsplash.com/photo-1553051021-9f94520a6cad', subject: 'Carpentry: cutting a slab', credit: 'Benjamin Thomas' },
  { id: 'wVycuhEJnN0', base: 'https://images.unsplash.com/photo-1718769327016-4fe93d01ce2c', subject: 'Timber planks', credit: 'Mary Schultz' },
  { id: 'LMpO06hCJyI', base: 'https://images.unsplash.com/photo-1562028288-e5e0eb2dac59', subject: 'A nail in wood', credit: 'Mark Boss' },
  { id: 'c9lnWi5nT34', base: 'https://images.unsplash.com/photo-1789871966074-f69a1606c3c4', subject: 'Scaffolding against concrete', credit: 'KC Shum' },
  // Remus · Handover 8: fifteen more, so a month of photos of the day hardly repeats (no faces, as before).
  { id: 'i6V6diaf71A', base: 'https://images.unsplash.com/photo-1701850009190-2859ba2aeea6', subject: 'Mortar going onto a brick wall', credit: 'Solømen' },
  { id: 'YClFdlDbfOU', base: 'https://images.unsplash.com/photo-1704005446360-5f30e4276182', subject: 'Hands laying a brick wall', credit: 'Gowtham AGM' },
  { id: 'FqAyHJpNhJA', base: 'https://images.unsplash.com/photo-1588399944136-efbd34b99d6b', subject: 'Grouting tools on the bench', credit: 'Haneen Krimly' },
  { id: 'Usn68-mvjjo', base: 'https://images.unsplash.com/photo-1579197586491-aed481d3a945', subject: 'Two old shovels on a plank', credit: 'Mari Potter' },
  { id: 'Wiu3w-99tNg', base: 'https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1', subject: 'Welding, the sparks flying', credit: 'Christopher Burns' },
  { id: 'VW4xiLRr-do', base: 'https://images.unsplash.com/photo-1508465818649-14a170138405', subject: 'A welding torch in the dark', credit: 'Glenn Hansen' },
  { id: 'ZhGGLxPcO_M', base: 'https://images.unsplash.com/photo-1499424401353-9b68ae399f0c', subject: 'A crane at night', credit: 'Christopher Baumeister' },
  { id: 'rpCP0gFdg5M', base: 'https://images.unsplash.com/photo-1656335865197-40ed379dd677', subject: 'A crane over a building site', credit: 'mostafa jamei' },
  { id: 'BIeC4YK2MTA', base: 'https://images.unsplash.com/photo-1591955506264-3f5a6834570a', subject: 'A crane in front of new flats', credit: 'Ben Allan' },
  { id: 'wIP0VMI3P7I', base: 'https://images.unsplash.com/photo-1620563704212-b4d54ce17d10', subject: 'A crane under a cloudy sky', credit: 'wu yi' },
  { id: 'eyq7H7gO0EY', base: 'https://images.unsplash.com/photo-1530863506128-dc9eb5c3e0fc', subject: 'Rebar, looking up', credit: 'Michael Bader' },
  { id: 'KS6YES3Djmc', base: 'https://images.unsplash.com/photo-1745909247906-123b53b70e06', subject: 'Rebar stacked, close up', credit: 'Araf Ibne Alam' },
  { id: 'WoZs8gGyQBY', base: 'https://images.unsplash.com/photo-1580901369227-308f6f40bdeb', subject: 'An excavator on rock', credit: 'Gerold Hinzen' },
  { id: 'nkxB5Ab-ONY', base: 'https://images.unsplash.com/photo-1630288214173-a119cf823388', subject: 'An excavator on bare ground', credit: 'Billy Freeman' },
  { id: 'MPjUcioFDxk', base: 'https://images.unsplash.com/photo-1749638442639-ecb976639ae0', subject: 'Brick showing through broken plaster', credit: 'Mathias Reding' },
]

export type PhotoPlace = 'band' | 'login' | 'side'
/** Photographs by place, and (Platinum Night) which drawing is in the dashboard band. */
export type BrandPhotoChoice = Partial<Record<PhotoPlace | 'hero', string>>

export const PHOTO_PLACES: { id: PhotoPlace; label: string }[] = [
  { id: 'band', label: 'Dashboard band' },
  { id: 'login', label: 'Sign-in page' },
  { id: 'side', label: 'Sidebar' },
]

export const DEFAULT_PHOTOS: Record<PhotoPlace, string> = { band: '3H3Oz-h3_e0', login: 'aO4c6o4H2MI', side: 'EqUFBrTIdeE' }

export function photoById(id: string | undefined): BrandPhoto | undefined {
  return BRAND_PHOTOS.find((p) => p.id === id)
}

/** The photograph for a place: the choice where it is one of ours, else the default. */
export function photoFor(place: PhotoPlace, choice: BrandPhotoChoice | null | undefined): BrandPhoto {
  return photoById(choice?.[place]) ?? photoById(DEFAULT_PHOTOS[place])!
}

/** Black and white, cropped to width. */
export function photoUrl(p: BrandPhoto, width: number): string {
  return `${p.base}?auto=format&fit=crop&w=${width}&q=70&sat=-100`
}

const LOGIN_KEY = 'remus.loginPhoto'
export function rememberLoginPhoto(id: string): void {
  try { localStorage.setItem(LOGIN_KEY, id) } catch { /* the default then */ }
}
export function rememberedLoginPhoto(): BrandPhoto {
  let id: string | null = null
  try { id = localStorage.getItem(LOGIN_KEY) } catch { /* default */ }
  return photoFor('login', id ? { login: id } : null)
}

/*
 * THE NIGHT HERO DRAWINGS (Remus · Handover 6). Stephan: "Give me like 10 options to choose from." Line drawings in
 * public/brand/heroes (scripts/brand/heroes.py and night-city.py make them); Platinum Night draws the chosen one in
 * the dashboard band. 10, the site contours, is the default (Stephan, 31 Oct: "the only one ... I actually like was
 * the last one. That contours thing").
 */
export const NIGHT_HEROES: { id: string; name: string }[] = [
  { id: 'hero-01', name: 'City skyline' },
  { id: 'hero-02', name: 'City skyline, busy (monorail, craft, lit windows)' },
  { id: 'hero-03', name: 'A steel-frame tower going up, two cranes' },
  { id: 'hero-04', name: 'Cable-stayed bridge' },
  { id: 'hero-05', name: 'Modern cantilevered house' },
  { id: 'hero-06', name: 'Isometric wireframe tower' },
  { id: 'hero-07', name: 'A street between towers, in perspective' },
  { id: 'hero-08', name: 'Steel detail: beam to column, bolted' },
  { id: 'hero-09', name: 'Arena roof on a long-span truss arch' },
  { id: 'hero-10', name: 'Site: contours and setting-out grid' },
  // Remus · Handover 6: more in the contour style Stephan liked (scripts/brand/heroes_contours.py).
  { id: 'hero-11', name: 'Contours: a house on the slope, building line' },
  { id: 'hero-12', name: 'Contours: a hill with spot heights' },
  { id: 'hero-13', name: 'Contours: a road set out with chainages' },
  { id: 'hero-14', name: 'Contours: a level survey on a grid' },
  { id: 'hero-15', name: 'Contours: a stream and a culvert crossing' },
  { id: 'hero-16', name: 'Contours: section A-A and the ground profile' },
  { id: 'hero-17', name: 'Contours: map graticule, north arrow, scale' },
  { id: 'hero-18', name: 'Contours: a township layout, erven numbered' },
]
export function heroFor(choice: BrandPhotoChoice | null | undefined): string {
  return NIGHT_HEROES.some((h) => h.id === choice?.hero) ? choice!.hero! : 'hero-10'
}
export const heroUrl = (id: string) => `/brand/heroes/${id}.svg`

/** Puts the chosen band and sidebar photographs on the page (skins.css draws them under Platinum). */
export function applyBrandPhotos(choice: BrandPhotoChoice | null | undefined): void {
  const root = document.documentElement
  root.style.setProperty('--skin-photo-band', `url('${photoUrl(photoFor('band', choice), 2000)}')`)
  // The day's framing, when an approved photo of the day sets one (lib/dayPhotos.ts); the band's usual otherwise.
  root.style.removeProperty('--skin-photo-band-pos')
  root.style.setProperty('--skin-photo-side', `url('${photoUrl(photoFor('side', choice), 600)}')`)
  root.dataset.bandCredit = `Photo: ${photoFor('band', choice).credit} / Unsplash`
  root.style.setProperty('--skin-night-hero', `url('${heroUrl(heroFor(choice))}')`)
  rememberLoginPhoto(photoFor('login', choice).id)
}
