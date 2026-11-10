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
import {
  initialTilePath,
  logoImagePath,
  shareCardFacts,
  shareCardVersion,
  shortHash,
  squareIconPath,
} from '@/lib/shared/design/share-card'

const log = logger.child({ component: 'email-brand' })

export interface EmailBranding {
  /** The header image: the brand icon, else the workspace logo; never an SVG. */
  logoUrl: string | undefined
  /** Absent keeps Quackback gold. */
  brand: EmailBrand | undefined
  /** The portal's name as its header shows it: the Brand kit title, else the workspace's. */
  title?: string
  /**
   * When the header image is one /brand.png draws from the published design,
   * which: the icon (or initial tile) or the full logo. A sample of a draft
   * draws its own in place of the address.
   */
  drawn?: 'icon' | 'logo'
}

/** Mail clients do not draw SVG, so an SVG logo is left out rather than sent broken. */
const isSvg = (key: string) => /\.svg$/i.test(key)

function workspaceLogo(logoKey: string | null | undefined): string | undefined {
  if (!logoKey || isSvg(logoKey)) return undefined
  return getEmailSafeUrl(logoKey) ?? undefined
}

/**
 * The portal's own PNGs of the brand, absolute, from the same /brand.png
 * the favicon is (share-card/serve.ts): the icon, drawn when stored as SVG;
 * the full logo fitted into the header's square; or the initial tile.
 */
function drawnBrandUrl(doc: PortalDesign, workspaceName: string | null | undefined) {
  const base = config.baseUrl
  if (!base) return {}
  const at = (path: string) => `${base.replace(/\/+$/, '')}${path}`
  const facts = shareCardFacts(doc, resolveDesign(doc))
  const title = doc.brand.logo.name?.trim() || workspaceName || 'Quackback'
  return {
    svgIcon:
      facts.iconKey && isSvg(facts.iconKey)
        ? at(squareIconPath(shortHash(facts.iconKey)))
        : undefined,
    fullLogo: facts.logoKey ? at(logoImagePath(facts.logoKey)) : undefined,
    tile: at(initialTilePath(shareCardVersion(facts), title)),
  }
}

/** The header image in order of preference, and which drawn image it is, if one. */
function headerImage(
  icon: string | null | undefined,
  drawn: ReturnType<typeof drawnBrandUrl>,
  logoKey: string | null | undefined
): Pick<EmailBranding, 'logoUrl' | 'drawn'> {
  const stored = icon ? getEmailSafeUrl(icon) : null
  if (stored) return { logoUrl: stored }
  if (drawn.svgIcon) return { logoUrl: drawn.svgIcon, drawn: 'icon' }
  if (drawn.fullLogo) return { logoUrl: drawn.fullLogo, drawn: 'logo' }
  const workspace = workspaceLogo(logoKey)
  if (workspace) return { logoUrl: workspace }
  return drawn.tile ? { logoUrl: drawn.tile, drawn: 'icon' } : { logoUrl: undefined }
}

/**
 * A design's email brand: its colours, and its icon where mail clients draw
 * it (an SVG one drawn to PNG by the portal), else its full logo, else the
 * workspace logo, else the brand's initial tile.
 */
export function designEmailBranding(
  doc: PortalDesign,
  logoKey: string | null | undefined,
  workspaceName?: string | null
): EmailBranding {
  const icon = emailIconKey(doc)
  const drawn = drawnBrandUrl(doc, workspaceName)
  const title = doc.brand.logo.name?.trim() || workspaceName || undefined
  return {
    ...(title && { title }),
    ...headerImage(icon, drawn, logoKey),
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
  const fallback: EmailBranding = {
    logoUrl: workspaceLogo(workspace.logoKey),
    brand: undefined,
    ...(workspace.name && { title: workspace.name }),
  }
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
