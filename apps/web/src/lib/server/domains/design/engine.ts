/**
 * Which engine renders a workspace's portal, and with which design.
 *
 * The legacy engine stays until the `portalDesignV2` flag is on. Then a
 * published design wins, and a workspace with no custom CSS is converted from
 * its branding settings on read, with nothing written. A workspace with CSS
 * stays on legacy until it switches. `PORTAL_DESIGN_ENGINE=legacy` keeps every
 * workspace on legacy, whatever the flag says.
 */
import { convertLegacyBranding, type LegacyBranding } from '@/lib/shared/design/convert'
import { fontStack } from '@/lib/shared/design/fonts'
import { renderDesignCss, resolveDesign } from '@/lib/shared/design/resolve'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { PortalDesignView } from '@/lib/shared/design/view'

export type DesignSource =
  { engine: 'legacy' } | { engine: 'v2'; doc: PortalDesign; revision: number | null }

export interface DesignSourceInput {
  override: string | undefined
  flagOn: boolean
  published: { document: PortalDesign; number: number } | null
  legacy: LegacyBranding & { customCss: string }
}

/** Custom CSS without comments or whitespace: what a switch would have to carry over. */
export function advancedCssRemainder(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '').trim()
}

export function resolveDesignSource(input: DesignSourceInput): DesignSource {
  if (input.override === 'legacy' || !input.flagOn) return { engine: 'legacy' }
  if (input.published) {
    return { engine: 'v2', doc: input.published.document, revision: input.published.number }
  }
  if (advancedCssRemainder(input.legacy.customCss) === '') {
    return { engine: 'v2', doc: convertLegacyBranding(input.legacy), revision: null }
  }
  return { engine: 'legacy' }
}

/** What a portal page needs from the chosen design: the mode and the CSS to inject. */
export function portalDesignView(source: DesignSource): PortalDesignView {
  if (source.engine === 'legacy') return { engine: 'legacy' }
  const { doc } = source
  return {
    engine: 'v2',
    mode: doc.mode,
    revision: source.revision,
    themeStyles: renderDesignCss(resolveDesign(doc)),
    customCss: doc.css ? `@layer tenant {\n${doc.css}\n}` : '',
    fontSans: fontStack(doc.brand.fonts.body),
  }
}
