import { redirect } from 'next/navigation'
import { validateTenantAccess, getOrgSlug } from '@/lib/tenant'
import { buildMainDomainUrl } from '@/lib/routing'

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

  const result = await validateTenantAccess()

  if (!result.valid) {
    const redirectMap = {
      not_authenticated: '/login',
      org_not_found: '/select-org?error=org_not_found',
      not_a_member: '/select-org?error=not_a_member',
    } as const
    redirect(buildMainDomainUrl(redirectMap[result.reason]))
  }

  return <>{children}</>
}
