/**
 * The brand a workspace's visitor emails carry: the published portal
 * design's colours and icon, so the emails match the portal. Callers already
 * read the settings row once per event or request and pass the two columns
 * this needs; the published design is one more indexed read.
 *
 * Without a published design (or while the portal shows the legacy theme)
 * the brand is left out and emails keep Quackback gold, as before.
 */
import type { EmailBrand } from '@quackback/email'
import { config } from '@/lib/server/config'
import { logger } from '@/lib/server/logger'
import {
  resolveFeatureFlags,
  type FeatureFlags,
} from '@/lib/server/domains/settings/settings.types'
import { getEmailSafeUrl } from '@/lib/server/storage/s3'
import { emailIconKey, emailPalette } from '@/lib/shared/design/email-palette'
import { resolveDesign } from '@/lib/shared/design/resolve'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { initialTilePath, shareCardFacts, shareCardVersion } from '@/lib/shared/design/share-card'

const log = logger.child({ component: 'email-brand' })

export interface EmailBranding {
  /** The header image: the brand icon, else the workspace logo; never an SVG. */
  logoUrl: string | undefined
  /** Absent keeps Quackback gold. */
  brand: EmailBrand | undefined
}

/** Mail clients do not draw SVG, so an SVG logo is left out rather than sent broken. */
const isSvg = (key: string) => /\.svg$/i.test(key)

function workspaceLogo(logoKey: string | null | undefined): string | undefined {
  if (!logoKey || isSvg(logoKey)) return undefined
  return getEmailSafeUrl(logoKey) ?? undefined
}

/**
 * The portal's drawn initial tile, absolute, for a brand with no image mail
 * can show: the same PNG the portal's favicon is (share-card/serve.ts).
 */
function initialTileUrl(doc: PortalDesign, workspaceName: string | null | undefined) {
  const base = config.baseUrl
  if (!base) return undefined
  const title = doc.brand.logo.name?.trim() || workspaceName || 'Quackback'
  const path = initialTilePath(shareCardVersion(shareCardFacts(doc, resolveDesign(doc))), title)
  return `${base.replace(/\/+$/, '')}${path}`
}

/**
 * A design's email brand: its colours, and its icon where mail clients draw
 * it, else the workspace logo, else the brand's initial tile.
 */
export function designEmailBranding(
  doc: PortalDesign,
  logoKey: string | null | undefined,
  workspaceName?: string | null
): EmailBranding {
  const icon = emailIconKey(doc)
  return {
    logoUrl:
      (icon ? getEmailSafeUrl(icon) : null) ??
      workspaceLogo(logoKey) ??
      initialTileUrl(doc, workspaceName),
    brand: emailPalette(doc),
  }
}

export async function emailBranding(workspace: {
  /** The workspace's name, for the initial tile when the design has no title. */
  name?: string | null
  logoKey: string | null | undefined
  /** The settings row's stored flags, or flags already resolved (cached settings). */
  featureFlags: string | null | undefined | FeatureFlags
}): Promise<EmailBranding> {
  const fallback: EmailBranding = { logoUrl: workspaceLogo(workspace.logoKey), brand: undefined }
  if (config.portalDesignEngine === 'legacy') return fallback
  const flags =
    typeof workspace.featureFlags === 'object' && workspace.featureFlags
      ? workspace.featureFlags
      : resolveFeatureFlags(workspace.featureFlags)
  if (!flags.portalDesignV2) return fallback
  try {
    const { getPublishedRevision } = await import('@/lib/server/domains/design/design.service')
    const published = await getPublishedRevision()
    if (!published) return fallback
    return designEmailBranding(published.document, workspace.logoKey, workspace.name)
  } catch (err) {
    // An email in gold beats no email.
    log.warn({ err }, 'published design unreadable; email keeps the default brand')
    return fallback
  }
}
