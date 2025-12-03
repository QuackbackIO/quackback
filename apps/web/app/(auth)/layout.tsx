import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

const APP_DOMAIN = process.env.APP_DOMAIN

/**
 * Tenant Auth Layout
 *
 * Auth routes (login, signup, sso) are only available on tenant subdomains.
 * Main domain requests are redirected to create-workspace.
 * Workspace validation happens in proxy.ts.
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const headersList = await headers()
  const host = headersList.get('host')

  // Auth routes are only for tenant domains
  if (host === APP_DOMAIN) {
    redirect('/create-workspace')
  }

  return <>{children}</>
}
