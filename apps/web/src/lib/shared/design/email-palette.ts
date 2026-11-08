/**
 * The brand in a visitor's email, from the published portal design: the
 * button in the brand colour with the text the portal's contrast solver
 * picks for it, links that read on the white email card, and the icon when
 * mail clients can draw it. Emails have no editor of their own; the design
 * is the one source.
 */
import { oklchToHex } from '@/lib/shared/theme/colors'
import { solveContrast } from './contrast'
import { resolveDesign } from './resolve'
import type { PortalDesign } from './schema'

export interface EmailPalette {
  /** The button fill and accent bars. */
  accent: string
  /** The button text, readable on the accent. */
  accentText: string
  /** Links, readable on the white card. */
  link: string
}

/** The email card every template draws on. */
const EMAIL_CARD = '#ffffff'
/** Links fall back to the body text when no shade of the brand reads. */
const EMAIL_TEXT = '#334155'

/** Mail clients take hex; the design may hold oklch(). */
const hex = (colour: string) => (colour.startsWith('#') ? colour.toLowerCase() : oklchToHex(colour))

export function emailPalette(doc: PortalDesign): EmailPalette {
  const resolved = resolveDesign(doc)
  // Emails are light; a dark-only design gives its dark colours.
  const vars = resolved.light ?? resolved.dark
  if (!vars?.primary || !vars.primaryForeground) {
    return { accent: hex(doc.brand.light.accent), accentText: '#09090b', link: EMAIL_TEXT }
  }
  const accent = hex(vars.primary)
  return {
    accent,
    accentText: hex(vars.primaryForeground),
    link: hex(solveContrast(accent, [EMAIL_CARD], 4.5) ?? EMAIL_TEXT),
  }
}

/** Image types every mail client draws; SVG and WebP are left out. */
const EMAIL_SAFE_IMAGE = /\.(png|jpe?g|gif)$/i

/** The brand icon's storage key when it can go in an email, else null. */
export function emailIconKey(doc: PortalDesign): string | null {
  const { light, dark } = doc.brand.logo.mark
  const key = light?.key ?? dark?.key ?? null
  return key && EMAIL_SAFE_IMAGE.test(key) ? key : null
}
