import { db, organization, eq } from '@quackback/db'

/**
 * Get organization logo data for SSR.
 * Converts blob to base64 data URL.
 */
export async function getOrganizationLogoData(organizationId: string): Promise<{
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
