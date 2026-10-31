import { BRANDING_FONTS } from '@/lib/shared/theme/fonts'
import type { PortalDesign } from './schema'
import type { BUNDLED_FONT_IDS } from './options'

type BundledFontId = (typeof BUNDLED_FONT_IDS)[number]
type DesignFont = PortalDesign['brand']['fonts']['body']

const ADDED_FAMILIES: Record<string, string> = {
  'ibm-plex-sans': '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif',
  fraunces: '"Fraunces", ui-serif, Georgia, serif',
  'bricolage-grotesque': '"Bricolage Grotesque", ui-sans-serif, system-ui, sans-serif',
  'system-mono': 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
}

/** The CSS font-family stack for a bundled font. */
export function bundledFontStack(id: BundledFontId): string {
  const known = BRANDING_FONTS.find((font) => font.id === id)
  return known?.value ?? ADDED_FAMILIES[id]
}

/** The CSS font-family stack for a design font; an uploaded family falls back to its bundled match. */
export function fontStack(font: DesignFont): string {
  if (font.kind === 'bundled') return bundledFontStack(font.id)
  return `"${font.family}", ${bundledFontStack(font.fallback)}`
}
