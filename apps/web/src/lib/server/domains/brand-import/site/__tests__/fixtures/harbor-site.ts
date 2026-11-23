/**
 * Site reads of the fictional Harbor & Pine (harborandpine.example), as the
 * site's code would name them, for the static reader: each builder is one
 * thing the code names (a brand property, a button, a theme colour, a face,
 * a logo) or nothing at all.
 */
import type { ColourCandidate, FontFact, SiteAsset, SiteFacts, SiteRead } from '../../types'
import type { PageStyle } from '../../site-style'

export type HarborSite = SiteRead & { facts: SiteFacts }

const URL = 'https://www.harborandpine.example/'

const face = (family: string, from: string, generic: FontFact['generic']): FontFact => ({
  family,
  stack: [family, generic === 'serif' ? 'serif' : 'sans-serif'],
  generic,
  from,
})

export function harborSite(
  over: {
    colours?: ColourCandidate[]
    themeColour?: string | null
    heading?: FontFact | null
    body?: FontFact | null
    logo?: SiteAsset | null
    style?: PageStyle | null
  } = {}
): HarborSite {
  return {
    facts: {
      url: URL,
      name: 'Harbor & Pine',
      nameFrom: 'og:site_name',
      organisationName: null,
      language: 'en',
      description: null,
      themeColour: over.themeColour ?? null,
      favicons: [],
      manifest: null,
      logos: [],
      shareImage: null,
      fonts: {
        heading: over.heading ?? null,
        body: over.body ?? null,
        faces: [],
        hosted: [],
      },
      colours: over.colours ?? [],
      style: over.style ?? null,
      stylesheets: [],
      localVersions: [],
    },
    favicon: null,
    icon: null,
    logo: over.logo ?? null,
    shareImage: null,
    failed: null,
  }
}

/** (a) A brand property and an orange button. */
export const brandAndButton = () =>
  harborSite({
    colours: [
      { hex: '#1f4d3a', from: '--brand-primary', weight: 3 },
      { hex: '#c2410c', from: 'button background', weight: 2 },
    ],
  })

/** (b) A button background only. */
export const buttonOnly = () =>
  harborSite({ colours: [{ hex: '#c2410c', from: 'button background', weight: 2 }] })

/** (c) The theme-color meta only. */
export const themeOnly = () =>
  harborSite({
    themeColour: '#2563eb',
    colours: [{ hex: '#2563eb', from: 'theme-color', weight: 1 }],
  })

/** (d) Monochrome: greys and near-black are dropped where they are read, so nothing is left. */
export const monochrome = () => harborSite({ themeColour: '#111111' })

/** (e) A heading face no bundled face is. */
export const ownHeadingFace = () =>
  harborSite({
    colours: [{ hex: '#1f4d3a', from: '--brand-primary', weight: 3 }],
    heading: face('Harbor Serif', 'h1', 'serif'),
  })

/** (f) A bundled face named for the headline. */
export const bundledHeadingFace = () =>
  harborSite({
    colours: [{ hex: '#1f4d3a', from: '--brand-primary', weight: 3 }],
    heading: face('Playfair Display', 'h1', 'serif'),
    body: face('Inter', 'body', 'sans'),
  })

/** A pale button colour beside a dark brand colour. */
export const paleButton = () =>
  harborSite({
    colours: [
      { hex: '#1f4d3a', from: '--brand-primary', weight: 3 },
      { hex: '#fde68a', from: 'button background', weight: 2 },
    ],
  })

/** Faces left to the system's own font: no brand face named. */
export const systemFonts = () =>
  harborSite({
    colours: [{ hex: '#1f4d3a', from: '--brand-primary', weight: 3 }],
    heading: face('system-ui', 'h1', 'sans'),
    body: face('system-ui', 'body', 'sans'),
  })

const WIDE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 60"><rect width="300" height="60" fill="#1f4d3a"/></svg>'

/** (g) A wide logo in the header: the name is in it. */
export const wideHeaderLogo = () =>
  harborSite({
    colours: [{ hex: '#1f4d3a', from: '--brand-primary', weight: 3 }],
    logo: {
      url: URL,
      mime: 'image/svg+xml',
      bytes: new TextEncoder().encode(WIDE_SVG),
      width: 300,
      height: 60,
      from: 'header-svg',
    },
  })
