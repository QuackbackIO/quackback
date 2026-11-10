/**
 * What the portal's own share card is drawn from, as the design holds it,
 * and the version of it the card's address carries. The builder and the
 * server read these; they need the colour maths, so they live apart from
 * the addresses (share-card.ts), which every portal page's head loads.
 */
import { overlay } from './contrast'
import type { ResolvedDesign } from './resolve'
import type { PortalDesign } from './schema'
import { shortHash } from './share-card'

export interface ShareCardFacts {
  background: string
  ink: string
  accent: string
  accentInk: string
  /** The brand icon's stored key, or null. */
  iconKey: string | null
  /** The full logo's stored key, drawn in place of an icon the brand does not have. */
  logoKey?: string
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
  const { mark, wordmark } = doc.brand.logo
  const iconKey = (mark.light ?? mark.dark)?.key ?? null
  const logoKey = iconKey ? undefined : (wordmark.light ?? wordmark.dark)?.key
  return {
    // Only when there is one, so a card without keeps its address.
    ...(logoKey && { logoKey }),
    background: hex(vars.background, '#ffffff'),
    ink: hex(vars.foreground, '#0a0a0a'),
    accent: hex(vars.primary, '#ffd43b'),
    accentInk: hex(vars.primaryForeground, '#0a0a0a'),
    iconKey,
    headingFont: faceId(doc.brand.fonts.heading),
    headingWeight: doc.brand.fonts.headingWeight,
    bodyFont: faceId(doc.brand.fonts.body),
  }
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
