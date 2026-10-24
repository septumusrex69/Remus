/**
 * The visual skins, copied from Raptor's src/lib/themes.ts.
 *
 * A skin is purely cosmetic: it swaps design tokens and branding, never behaviour, wording or
 * structure. Adding one means an entry here and a matching html[data-theme] block in
 * src/styles/skins.css — no component changes.
 *
 * The company is Urban Haus; the app is Remus. So the Remus skins carry the REMUS wordmark in the
 * frame, while quotes, PDFs and emails keep the company's own logo from Settings whatever skin a
 * person picks (a skin is how the app looks to you, not what clients receive).
 */

export type ThemeId = 'urban-haus' | 'remus' | 'oxblood' | 'sage' | 'blueprint' | 'teal' | 'concrete'

export interface ThemeDefinition {
  id: ThemeId
  name: string
  description: string
  /** What the product calls itself under this skin: the browser tab and the Appearance card. */
  productName: string
  /** Logo for dark surfaces (the sidebar, the login panel). */
  lockupLight: string
  /** Logo for light surfaces (the login form on a phone, set-password). */
  lockupDark: string
  /** The square mark for the folded sidebar. */
  icon: string
  /** The line under the wordmark in the sidebar. Empty: the logo already says it. */
  tagline: string
  /** A light, full-panel picture for the sign-in screen (it carries its own wordmark). */
  loginArt?: string
  /** Three colours for the preview tile: ground (sidebar), surface (page), accent. */
  swatch: { ground: string; surface: string; accent: string }
}

const REMUS = {
  productName: 'Remus',
  lockupLight: '/brand/remus-wordmark-white.png',
  lockupDark: '/brand/remus-wordmark-graphite.png',
  icon: '/brand/remus-icon-64.png',
  tagline: 'Urban Haus Construction',
}

export const THEMES: ThemeDefinition[] = [
  {
    id: 'remus',
    name: 'Remus',
    description: 'The brand board: graphite, oxblood and sage on stone, with blueprint linework.',
    ...REMUS,
    loginArt: '/brand/remus-floorplan.jpg',
    swatch: { ground: '#3e4448', surface: '#eeeae4', accent: '#512c35' },
  },
  {
    id: 'oxblood',
    name: 'Oxblood',
    description: 'Deep oxblood frame on warm paper. Remus in its colour variant.',
    ...REMUS,
    swatch: { ground: '#2c171d', surface: '#f2ede7', accent: '#7a3342' },
  },
  {
    id: 'sage',
    name: 'Sage',
    description: 'Olive and sage on a light hex grid. Calm, site-office green.',
    ...REMUS,
    swatch: { ground: '#2b3328', surface: '#f1f1ea', accent: '#5d6b4e' },
  },
  {
    id: 'blueprint',
    name: 'Blueprint',
    description: 'Drawing-office navy on blueprint paper, with grid and circle linework.',
    ...REMUS,
    swatch: { ground: '#13233b', surface: '#edf1f7', accent: '#2c5a8c' },
  },
  {
    id: 'teal',
    name: 'Steel Teal',
    description: 'Dark teal and structural steel, with a faint truss pattern.',
    ...REMUS,
    swatch: { ground: '#0f2b2a', surface: '#edf2f1', accent: '#1f5f59' },
  },
  {
    id: 'concrete',
    name: 'Concrete',
    description: 'Monochrome charcoal on board-formed concrete, with a diagonal hatch.',
    ...REMUS,
    swatch: { ground: '#232323', surface: '#e9e6e0', accent: '#3b3b3b' },
  },
  {
    id: 'urban-haus',
    name: 'Urban Haus Classic',
    description: 'The look before Remus had its own brand: charcoal and Urban Haus orange.',
    productName: 'Urban Haus · Remus',
    lockupLight: '/brand/urban-haus-logo-white.png',
    lockupDark: '/brand/urban-haus-logo.png',
    icon: '/brand/icon-64.png',
    tagline: '',
    swatch: { ground: '#18191c', surface: '#f4f6fb', accent: '#ef6723' },
  },
]

/** What someone gets before they've ever chosen a skin: the new brand. */
export const DEFAULT_THEME: ThemeId = 'remus'

/**
 * The skin the stylesheet renders with no attribute set: index.css's own tokens are the Urban
 * Haus Classic look, and every other skin overrides them from its [data-theme] block.
 */
export const BASE_THEME: ThemeId = 'urban-haus'

/** index.html reads this key before first paint; change both together. */
export const THEME_STORAGE_KEY = 'remus.theme'

export function themeById(id: ThemeId): ThemeDefinition {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}

/** Storage can be unavailable or hold a skin that no longer exists: fall back to the default. */
export function readStoredTheme(): ThemeId {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (saved && THEMES.some((t) => t.id === saved)) return saved as ThemeId
  } catch {
    // Storage unavailable: the default is a good answer.
  }
  return DEFAULT_THEME
}

export function storeTheme(id: ThemeId) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, id)
  } catch {
    // Can't remember the choice; it still applies for this session.
  }
}

/** The base skin stamps nothing, so index.css renders exactly as it did before skins existed. */
export function applyTheme(id: ThemeId) {
  const root = document.documentElement
  if (id === BASE_THEME) root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', id)
  const meta = document.querySelector('meta[name="theme-color"]')
  meta?.setAttribute('content', themeById(id).swatch.ground)
}
