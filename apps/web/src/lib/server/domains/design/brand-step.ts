/**
 * The launch plan's branding step, as the portal design sees it. A portal
 * drawn by the design engine has its brand in the builder's Brand kit, so the
 * step is done when a brand match has run there, or the Brand kit has an
 * icon, a colour and a font of its own, in the published design or the draft.
 * A portal on the legacy theme is left to the workspace logo (null here).
 */
import { config } from '@/lib/server/config'
import { brandIsSet } from '@/lib/shared/design/brand-set'
import { convertLegacyBranding } from '@/lib/shared/design/convert'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { getDesignState } from './design.service'
import { legacyBrandingOf, resolveDesignSource, type LegacySettings } from './engine'

export interface BrandStep {
  /** The portal's look is edited in the builder. */
  inBuilder: true
  done: boolean
}

export async function brandStepOf(input: {
  flagOn: boolean
  legacy: LegacySettings
}): Promise<BrandStep | null> {
  if (!input.flagOn) return null
  const state = await getDesignState()
  const published = state?.published
    ? { document: state.published.document, number: state.published.number }
    : null
  const legacy = legacyBrandingOf(input.legacy)
  const source = resolveDesignSource({
    override: config.portalDesignEngine,
    flagOn: true,
    published,
    legacy,
  })
  if (source.engine !== 'v2') return null
  const designs: PortalDesign[] = [published?.document, state?.draft].filter(
    (design): design is PortalDesign => !!design
  )
  // Nothing published or drafted yet: the portal draws the branding settings, converted.
  if (designs.length === 0) designs.push(convertLegacyBranding(legacy))
  return { inBuilder: true, done: designs.some(brandIsSet) }
}
