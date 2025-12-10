import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

const APP_DOMAIN = process.env.APP_DOMAIN

/**
 * Admin Auth Layout
 *
 * Auth routes (login, signup) for team members are only available on tenant subdomains.
 * Main domain requests are redirected to create-workspace.
 * These pages don't require authentication (they ARE the auth pages).
 */
export default async function AdminAuthLayout({ children }: { children: React.ReactNode }) {
  const headersList = await headers()
  const host = headersList.get('host')

  // Auth routes are only for tenant domains
  if (host === APP_DOMAIN) {
    redirect('/create-workspace')
  }

  return <>{children}</>
}
