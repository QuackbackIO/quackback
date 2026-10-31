/**
 * The design a new workspace starts with: its branding converted, as an
 * established workspace's is on read, with Home on and laid out from the
 * pages the workspace has. An established workspace's `/` never changes on
 * upgrade; only setup publishes this.
 */
import { eq, settings, type Transaction } from '@/lib/server/db'
import { parseJsonOrNull, parsePortalConfig } from '@/lib/server/domains/settings/settings.helpers'
import { resolveStatusSettings } from '@/lib/server/domains/settings/settings.status'
import {
  resolveFeatureFlags,
  type BrandingConfig,
} from '@/lib/server/domains/settings/settings.types'
import { convertLegacyBranding } from '@/lib/shared/design/convert'
import { starterHomeBlocks } from '@/lib/shared/design/home'
import { portalPageGates } from '@/lib/shared/design/paths'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { publishStartingDesign } from './design.service'
import { advancedCssRemainder, legacyBrandingOf } from './engine'

type SettingsRow = typeof settings.$inferSelect

/**
 * The starting design for a workspace's settings, or null when it stays on
 * its theme: the design engine off, or custom CSS a switch would have to
 * carry over. `PORTAL_DESIGN_ENGINE=legacy` still keeps the portal on its
 * theme, published design or not.
 */
export function startingDesign(row: SettingsRow): PortalDesign | null {
  const featureFlags = resolveFeatureFlags(row.featureFlags)
  if (!featureFlags.portalDesignV2) return null
  if (advancedCssRemainder(row.customCss ?? '') !== '') return null
  const portalConfig = parsePortalConfig(row.portalConfig)
  const doc = convertLegacyBranding(
    legacyBrandingOf({
      ...row,
      brandingConfig: parseJsonOrNull<BrandingConfig>(row.brandingConfig) ?? {},
      portalConfig,
    })
  )
  const gates = portalPageGates(
    { featureFlags, portalConfig, statusConfig: resolveStatusSettings(row.metadata) },
    false
  )
  doc.nav.home.on = true
  doc.pages.home.blocks = starterHomeBlocks(gates)
  return doc
}

/** Publishes the starting design for the workspace in `tx`, unless it has a design. */
export async function seedStartingDesign(
  tx: Transaction,
  workspaceId: SettingsRow['id']
): Promise<boolean> {
  const [row] = await tx.select().from(settings).where(eq(settings.id, workspaceId)).limit(1)
  const doc = row ? startingDesign(row) : null
  return doc ? publishStartingDesign(tx, doc) : false
}
