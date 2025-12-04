import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

const APP_DOMAIN = process.env.APP_DOMAIN

/**
 * Tenant Layout
 *
 * This layout:
 * 1. Redirects main domain requests to the landing page
 * 2. Workspace validation happens in proxy.ts
 *
 * Auth validation is handled by child layouts:
 * - Public routes (/, /roadmap, /:slug/posts/:id) don't require auth
 * - Admin routes require auth via their own layout
 */
export default async function TenantLayout({ children }: { children: React.ReactNode }) {
  const headersList = await headers()
  const host = headersList.get('host')

  // Tenant routes are only for tenant domains
  if (host === APP_DOMAIN) {
    redirect('/')
  }

  return <>{children}</>
}
