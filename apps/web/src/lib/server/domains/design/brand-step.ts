/**
 * The launch plan's branding step, as the portal design sees it. A portal
 * drawn by the design engine has its brand in the builder's Brand kit, so the
 * step is done when the design visitors see carries the brand (brandIsSet):
 * the published design, or with none yet the branding settings it draws. A
 * branded draft not yet published leaves the step open, waiting to publish.
 * A portal on the legacy theme is left to the workspace logo (null here).
 */
import { config } from '@/lib/server/config'
import { brandIsSet } from '@/lib/shared/design/brand-set'
import { getDesignState } from './design.service'
import { legacyBrandingOf, resolveDesignSource, type LegacySettings } from './engine'

export interface BrandStep {
  /** The portal's look is edited in the builder. */
  inBuilder: true
  /** Visitors see the brand. */
  done: boolean
  /** The draft carries the brand and waits to be published. */
  drafted: boolean
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
  // What visitors see: the published design, or the branding settings, converted.
  const done = brandIsSet(source.doc)
  const drafted = !done && !!state?.draft && brandIsSet(state.draft)
  return { inBuilder: true, done, drafted }
}
