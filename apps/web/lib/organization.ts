import { db, organization, eq } from '@/lib/db'
import type { HeaderDisplayMode } from '@quackback/domain'
import type { OrgId } from '@quackback/ids'

/**
 * Get organization logo data for SSR.
 * Converts blob to base64 data URL.
 */
export async function getOrganizationLogoData(organizationId: OrgId): Promise<{
  logoUrl: string | null
  hasCustomLogo: boolean
}> {
  const org = await db.query.organization.findFirst({
    where: eq(organization.id, organizationId),
    columns: { logoBlob: true, logoType: true },
  })

  if (!org?.logoBlob || !org?.logoType) {
    return { logoUrl: null, hasCustomLogo: false }
  }

  const base64 = org.logoBlob.toString('base64')
  const logoUrl = `data:${org.logoType};base64,${base64}`

  return { logoUrl, hasCustomLogo: true }
}

/**
 * Get organization favicon data for SSR.
 * Uses the logo as favicon (no separate favicon upload).
 */
export async function getOrganizationFaviconData(organizationId: OrgId): Promise<{
  faviconUrl: string | null
  hasCustomFavicon: boolean
}> {
  // Use logo as favicon
  const logoData = await getOrganizationLogoData(organizationId)
  return {
    faviconUrl: logoData.logoUrl,
    hasCustomFavicon: logoData.hasCustomLogo,
  }
}

/**
 * Get organization header logo data for SSR.
 */
export async function getOrganizationHeaderLogoData(organizationId: OrgId): Promise<{
  headerLogoUrl: string | null
  hasHeaderLogo: boolean
  headerDisplayMode: HeaderDisplayMode
  headerDisplayName: string | null
}> {
  const org = await db.query.organization.findFirst({
    where: eq(organization.id, organizationId),
    columns: {
      headerLogoBlob: true,
      headerLogoType: true,
      headerDisplayMode: true,
      headerDisplayName: true,
    },
  })

  if (!org) {
    return {
      headerLogoUrl: null,
      hasHeaderLogo: false,
      headerDisplayMode: 'logo_and_name',
      headerDisplayName: null,
    }
  }

  let headerLogoUrl: string | null = null
  if (org.headerLogoBlob && org.headerLogoType) {
    const base64 = org.headerLogoBlob.toString('base64')
    headerLogoUrl = `data:${org.headerLogoType};base64,${base64}`
  }

  return {
    headerLogoUrl,
    hasHeaderLogo: !!headerLogoUrl,
    headerDisplayMode: (org.headerDisplayMode as HeaderDisplayMode) || 'logo_and_name',
    headerDisplayName: org.headerDisplayName || null,
  }
}

/**
 * Get organization branding data (logo + header branding) for SSR.
 * Logo is also used as favicon.
 */
export async function getOrganizationBrandingData(organizationId: OrgId): Promise<{
  logoUrl: string | null
  headerLogoUrl: string | null
  headerDisplayMode: HeaderDisplayMode
  headerDisplayName: string | null
}> {
  const org = await db.query.organization.findFirst({
    where: eq(organization.id, organizationId),
    columns: {
      logoBlob: true,
      logoType: true,
      headerLogoBlob: true,
      headerLogoType: true,
      headerDisplayMode: true,
      headerDisplayName: true,
    },
  })

  let logoUrl: string | null = null
  let headerLogoUrl: string | null = null

  if (org?.logoBlob && org?.logoType) {
    const base64 = org.logoBlob.toString('base64')
    logoUrl = `data:${org.logoType};base64,${base64}`
  }

  if (org?.headerLogoBlob && org?.headerLogoType) {
    const base64 = org.headerLogoBlob.toString('base64')
    headerLogoUrl = `data:${org.headerLogoType};base64,${base64}`
  }

  return {
    logoUrl,
    headerLogoUrl,
    headerDisplayMode: (org?.headerDisplayMode as HeaderDisplayMode) || 'logo_and_name',
    headerDisplayName: org?.headerDisplayName || null,
  }
}
