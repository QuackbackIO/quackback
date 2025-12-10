import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getOrganizationBySlug } from '@/lib/tenant'

const APP_DOMAIN = process.env.APP_DOMAIN

/**
 * Root Tenant Layout (Slug-Based Routing)
 *
 * This layout:
 * 1. Redirects main domain requests to the landing page (safety check)
 * 2. Validates the organization exists for the given slug
 *
 * The proxy rewrites tenant URLs from /path to /s/[orgSlug]/path, so:
 * - External URL: acme.quackback.io/admin
 * - Internal routing: /s/acme/admin
 *
 * Auth validation and UI shell are handled by child layouts:
 * - (portal)/ routes: public portal with PortalHeader (/, /roadmap, /b/...)
 * - (auth)/ routes: login/signup forms
 * - admin/ routes: admin dashboard with AdminNav
 * - settings/ routes: user settings with PortalHeader
 * - onboarding/ routes: minimal wizard layout
 */
interface TenantLayoutProps {
  children: React.ReactNode
  params: Promise<{ orgSlug: string }>
}

export default async function TenantLayout({ children, params }: TenantLayoutProps) {
  const headersList = await headers()
  const host = headersList.get('host')
  const { orgSlug } = await params

  // Tenant routes are only for tenant domains (safety check - proxy already handles this)
  if (host === APP_DOMAIN) {
    redirect('/')
  }

  // Validate organization exists (redundant safety - proxy already validated)
  const org = await getOrganizationBySlug(orgSlug)
  if (!org) {
    redirect('/workspace-not-found')
  }

  return <>{children}</>
}
