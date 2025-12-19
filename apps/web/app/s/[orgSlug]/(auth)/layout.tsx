import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getWorkspaceBySlug } from '@/lib/tenant'
import { isCloud } from '@quackback/domain'

const APP_DOMAIN = process.env.APP_DOMAIN

/**
 * Tenant Auth Layout (Slug-Based Routing)
 *
 * Auth routes (login, signup, sso) are available on tenant domains.
 * In cloud mode, main domain requests are redirected to create-workspace.
 * In OSS mode, auth routes work on the main domain since it's the only domain.
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

  // In cloud mode, auth routes are only for tenant subdomains (not main domain)
  // In OSS mode, the main domain IS the tenant domain, so allow auth routes
  if (isCloud() && host === APP_DOMAIN) {
    redirect('/create-workspace')
  }

  // Validate org exists (redundant safety - proxy already validated)
  const org = await getWorkspaceBySlug(orgSlug)
  if (!org) {
    redirect('/workspace-not-found')
  }

  return <>{children}</>
}
