/**
 * Branding accepted from the brand's website (Home's notice), carried into
 * the portal design. On the design engine the design is the one home of the
 * brand: the portal, the widget and its launcher, and emails read it. So the
 * logo and colour land in the draft, for the person to review and publish in
 * the builder, and nothing live changes. An icon or colour the design already
 * has stays: a choice made there is kept.
 */
import { config } from '@/lib/server/config'
import { db } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import { resolveFeatureFlags } from '@/lib/server/domains/settings/settings.types'
import { normaliseColor } from '@/lib/shared/design/color'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { readDraftForChange, saveDesignDraft } from './design.actions'
import { getPublishedRevision, type DesignAuthor } from './design.service'
import { advancedCssRemainder } from './engine'

const log = logger.child({ module: 'design-website-branding' })

const DEFAULT_ACCENT = defaultDesign().brand.light.accent

/**
 * Whether the design engine draws this workspace's portal, from a published
 * design or one converted from the branding settings on read (see
 * resolveDesignSource). Then the branding settings no longer reach visitors.
 */
export async function designOwnsBrand(): Promise<boolean> {
  const row = await db.query.settings.findFirst({
    columns: { featureFlags: true, customCss: true },
  })
  if (!resolveFeatureFlags(row?.featureFlags).portalDesignV2) return false
  if (config.portalDesignEngine === 'legacy') return false
  if (advancedCssRemainder(row?.customCss ?? '') === '') return true
  return (await getPublishedRevision()) !== null
}

/**
 * Writes the website's logo and colour into the draft; true when the draft
 * changed. Before the first publish the draft starts from the branding
 * settings converted, as the builder does. The save names the draft revision
 * it read, so a change saved in the builder meanwhile is kept: the draft is
 * read again and written once more.
 */
export async function websiteBrandingIntoDraft(
  found: { logoKey: string | null; colour: string | null },
  author: DesignAuthor
): Promise<boolean> {
  if (!(await designOwnsBrand())) return false
  for (let attempt = 0; attempt < 2; attempt++) {
    const current = await readDraftForChange()
    const design = withWebsiteBranding(structuredClone(current.design), found)
    if (!design) return false
    const saved = await saveDesignDraft(design, author, current.revision)
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
