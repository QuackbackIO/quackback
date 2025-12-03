import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

const APP_DOMAIN = process.env.APP_DOMAIN

/**
 * Tenant Auth Layout
 *
 * Auth routes (login, signup, sso) are only available on tenant subdomains.
 * Main domain requests are redirected to create-workspace.
 *
 * Note: This layout does NOT validate org exists - the login form handles
 * showing the error if the workspace is not found.
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
