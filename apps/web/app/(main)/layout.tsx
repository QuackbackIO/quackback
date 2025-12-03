import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

const APP_DOMAIN = process.env.APP_DOMAIN

/**
 * Main Domain Layout
 *
 * This layout only allows access from the main application domain (APP_DOMAIN).
 * Tenant subdomains are redirected to their boards page.
 */
export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const headersList = await headers()
  const host = headersList.get('host')

  // Main domain routes are only for main domain
  // Redirect tenant domains to their home page
  if (host !== APP_DOMAIN) {
    redirect('/')
  }

  return <>{children}</>
}
