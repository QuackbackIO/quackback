import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getCurrentOrganization } from '@/lib/tenant'

const APP_DOMAIN = process.env.APP_DOMAIN

/**
 * Tenant Layout - validates domain exists in workspace_domain table
 *
 * This layout:
 * 1. Redirects main domain requests to the landing page
 * 2. Validates the domain exists in workspace_domain table
 * 3. Redirects to login with error if workspace not found
 *
 * Auth validation is handled by child layouts:
 * - Public routes (/boards, /roadmap) don't require auth
 * - Admin routes require auth via their own layout
 */
export default async function TenantLayout({ children }: { children: React.ReactNode }) {
  const headersList = await headers()
  const host = headersList.get('host')

  // Tenant routes are only for tenant domains
  if (host === APP_DOMAIN) {
    redirect('/')
  }

  const org = await getCurrentOrganization()

  if (!org) {
    redirect('/login?error=workspace_not_found')
  }

  return <>{children}</>
}
