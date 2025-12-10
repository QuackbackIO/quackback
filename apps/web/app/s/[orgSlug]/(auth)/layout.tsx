import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getOrganizationBySlug } from '@/lib/tenant'

const APP_DOMAIN = process.env.APP_DOMAIN

/**
 * Tenant Auth Layout (Slug-Based Routing)
 *
 * Auth routes (login, signup, sso) are only available on tenant subdomains.
 * Main domain requests are redirected to create-workspace.
 * Workspace validation happens in proxy.ts and parent layout.
 */
interface AuthLayoutProps {
  children: React.ReactNode
  params: Promise<{ orgSlug: string }>
}

export default async function AuthLayout({ children, params }: AuthLayoutProps) {
  const headersList = await headers()
  const host = headersList.get('host')
  const { orgSlug } = await params

  // Auth routes are only for tenant domains
  if (host === APP_DOMAIN) {
    redirect('/create-workspace')
  }

  // Validate org exists (redundant safety - proxy already validated)
  const org = await getOrganizationBySlug(orgSlug)
  if (!org) {
    redirect('/workspace-not-found')
  }

  return <>{children}</>
}
