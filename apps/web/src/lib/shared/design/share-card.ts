/**
 * What the portal's own share card and favicon are drawn from, as the
 * design holds it, and where the portal asks for them. The card is drawn
 * on the server (domains/design/share-card); its address carries a version
 * of everything it shows, so a link preview or browser can keep it for good
 * and a changed brand is a new address.
 */
import { overlay } from './contrast'
import type { ResolvedDesign } from './resolve'
import type { PortalDesign } from './schema'

/** The pages that have their own card: the page's name under the title. The portal's own has none. */
export const SHARE_CARD_PAGES = ['feedback', 'roadmap', 'changelog', 'help', 'status'] as const
export type ShareCardPage = (typeof SHARE_CARD_PAGES)[number]

export const isShareCardPage = (value: unknown): value is ShareCardPage =>
  (SHARE_CARD_PAGES as readonly unknown[]).includes(value)

/** Where the portal serves its drawn brand images. */
export const BRAND_IMAGE_PATH = '/brand.png'

export interface ShareCardFacts {
  background: string
  ink: string
  accent: string
  accentInk: string
  /** The brand icon's stored key, or null. */
  iconKey: string | null
  headingFont: string
  headingWeight: number
  bodyFont: string
}

const hex = (colour: string | undefined, fallback: string) => {
  try {
    return overlay(colour ?? fallback, '#000000', 1)
  } catch {
    return fallback
  }
}

const faceId = (font: PortalDesign['brand']['fonts']['heading']) =>
  font.kind === 'bundled' ? font.id : 'inter'

/** The mode a card shows: light, unless the design only ever shows dark. */
function shownVars(resolved: ResolvedDesign) {
  return resolved.light ?? resolved.dark ?? {}
}

export function shareCardFacts(doc: PortalDesign, resolved: ResolvedDesign): ShareCardFacts {
  const vars = shownVars(resolved)
  const { mark } = doc.brand.logo
  return {
    background: hex(vars.background, '#ffffff'),
    ink: hex(vars.foreground, '#0a0a0a'),
    accent: hex(vars.primary, '#ffd43b'),
    accentInk: hex(vars.primaryForeground, '#0a0a0a'),
    iconKey: (mark.light ?? mark.dark)?.key ?? null,
    headingFont: faceId(doc.brand.fonts.heading),
    headingWeight: doc.brand.fonts.headingWeight,
    bodyFont: faceId(doc.brand.fonts.body),
  }
}

/** A short, stable hash (FNV-1a, base 36) of the text. */
export function shortHash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/** A version of everything the card shows but its title, which the address adds. */
export const shareCardVersion = (facts: ShareCardFacts): string => shortHash(JSON.stringify(facts))

/** The page colours for the browser's own chrome (theme-color), per mode the design shows. */
export function themeColours(resolved: ResolvedDesign): {
  light: string | null
  dark: string | null
} {
  return {
    light: resolved.light?.background ? hex(resolved.light.background, '#ffffff') : null,
    dark: resolved.dark?.background ? hex(resolved.dark.background, '#0a0a0a') : null,
  }
}

/** The card's address: its version and title, and the page whose name it shows. */
export function shareCardPath(version: string, title: string, page?: ShareCardPage): string {
  const v = `${version}${shortHash(title)}`
  return `${BRAND_IMAGE_PATH}?v=${v}${page ? `&page=${page}` : ''}`
}

/** The favicon's address: the brand icon fitted into a square. */
export const squareIconPath = (version: string): string =>
  `${BRAND_IMAGE_PATH}?v=${version}&kind=icon`

/**
 * The initial tile's address, for a brand with no icon a browser tab or
 * mail client can show: drawn from the card's colours and the title's
 * initial, so it carries the card's version and the title.
 */
export const initialTilePath = (cardVersion: string, title: string): string =>
  `${BRAND_IMAGE_PATH}?v=${cardVersion}${shortHash(title)}&kind=icon`
