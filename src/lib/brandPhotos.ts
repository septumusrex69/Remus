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
]

export type PhotoPlace = 'band' | 'login' | 'side'
export type BrandPhotoChoice = Partial<Record<PhotoPlace, string>>

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

/** Puts the chosen band and sidebar photographs on the page (skins.css draws them under Platinum). */
export function applyBrandPhotos(choice: BrandPhotoChoice | null | undefined): void {
  const root = document.documentElement
  root.style.setProperty('--skin-photo-band', `url('${photoUrl(photoFor('band', choice), 2000)}')`)
  root.style.setProperty('--skin-photo-side', `url('${photoUrl(photoFor('side', choice), 600)}')`)
  root.dataset.bandCredit = `Photo: ${photoFor('band', choice).credit} / Unsplash`
  rememberLoginPhoto(photoFor('login', choice).id)
}
