import { redirect } from 'next/navigation'
import { getOrgSlug, getCurrentOrganization } from '@/lib/tenant'
import { buildMainDomainUrl } from '@/lib/routing'

/**
 * Root tenant layout - only validates organization exists
 * Auth validation is handled by child layouts:
 * - (public)/* routes don't require auth
 * - admin/* routes require auth via their own layout
 */
export default async function TenantLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const orgSlug = await getOrgSlug()

  // If no subdomain, this layout shouldn't be reached (proxy handles it)
  if (!orgSlug) {
    redirect(buildMainDomainUrl('/select-org'))
  }

  // Validate org exists (but don't require auth - that's done by child layouts)
  const org = await getCurrentOrganization()

  if (!org) {
    redirect(buildMainDomainUrl('/select-org?error=org_not_found'))
  }

  return <>{children}</>
}
