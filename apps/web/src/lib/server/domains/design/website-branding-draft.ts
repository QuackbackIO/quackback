/**
 * Branding accepted from the brand's website (onboarding's step or Home's
 * notice), carried into the portal design. Once a design is published the
 * portal draws it, not the branding settings, so a logo and colour written
 * only there would change nothing visitors see. They land in the draft
 * instead, for the person to see and publish in the builder. An icon or
 * colour the design already has stays: a choice made there is kept.
 */
import { config } from '@/lib/server/config'
import { db } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import { resolveFeatureFlags } from '@/lib/server/domains/settings/settings.types'
import { normaliseColor } from '@/lib/shared/design/color'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { saveDesignDraft } from './design.actions'
import { getDesignState, type DesignAuthor } from './design.service'

const log = logger.child({ module: 'design-website-branding' })

const DEFAULT_ACCENT = defaultDesign().brand.light.accent

/**
 * Writes the website's logo and colour into the draft; true when the draft
 * changed. The save names the draft revision it read, so a change saved in
 * the builder meanwhile is kept: the draft is read again and written once more.
 */
export async function websiteBrandingIntoDraft(
  found: { logoKey: string | null; colour: string | null },
  author: DesignAuthor
): Promise<boolean> {
  const row = await db.query.settings.findFirst({ columns: { featureFlags: true } })
  if (!resolveFeatureFlags(row?.featureFlags).portalDesignV2) return false
  if (config.portalDesignEngine === 'legacy') return false
  for (let attempt = 0; attempt < 2; attempt++) {
    const state = await getDesignState()
    // Before the first publish the portal converts the branding settings, which already hold these.
    if (!state?.published) return false
    const design = withWebsiteBranding(
      structuredClone(state.draft ?? state.published.document),
      found
    )
    if (!design) return false
    const saved = await saveDesignDraft(design, author, state.revision)
    if (saved.ok) {
      log.info('website branding written into the design draft')
      return true
    }
    if (saved.code !== 'REVISION_MISMATCH' || attempt > 0) {
      log.warn({ code: saved.code }, 'website branding could not be written into the design draft')
      return false
    }
  }
  return false
}

/** The design with the website's logo and colour where it has none of its own, or null when unchanged. */
function withWebsiteBranding(
  design: PortalDesign,
  found: { logoKey: string | null; colour: string | null }
): PortalDesign | null {
  const { brand } = design
  let changed = false
  if (found.logoKey && !brand.logo.mark.light && !brand.logo.mark.dark) {
    brand.logo.mark.light = { key: found.logoKey }
    changed = true
  }
  const colour = found.colour ? normaliseColor(found.colour) : null
  if (colour && brand.light.accent === DEFAULT_ACCENT) {
    brand.light.accent = colour
    changed = true
  }
  return changed ? design : null
}
