import { Suspense } from 'react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { TenantSignupForm } from '@/components/auth/tenant-signup-form'
import { getOrgSlug } from '@/lib/tenant'
import { Loader2 } from 'lucide-react'

/**
 * Admin Signup Page
 *
 * For team members to join an existing organization (requires openSignupEnabled = true).
 * Uses the organization's team auth settings.
 */
export default async function AdminSignupPage() {
  const orgSlug = await getOrgSlug()

  // Redirect to main domain if not on a subdomain
  if (!orgSlug) {
    redirect('/create-workspace')
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-8 px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Join the team</h1>
          <p className="mt-2 text-muted-foreground">
            Create your team account to access the admin dashboard
          </p>
        </div>
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          }
        >
          <SignupFormWithConfig orgSlug={orgSlug} />
        </Suspense>
        <p className="text-center text-sm text-muted-foreground">
          Already have a team account?{' '}
          <Link href="/admin/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}

/**
 * Fetch auth config and render the signup form
 */
async function SignupFormWithConfig({ orgSlug }: { orgSlug: string }) {
  // Fetch auth config for the org (server-side)
  let authConfig = null
  try {
    const headersList = await headers()
    const host = headersList.get('host')!
    const protocol = headersList.get('x-forwarded-proto') || 'http'
    const response = await fetch(`${protocol}://${host}/api/auth/org-auth-config?slug=${orgSlug}`, {
      cache: 'no-store',
    })
    if (response.ok) {
      authConfig = await response.json()
    }
  } catch {
    // Silently fail - use defaults
  }

  return <TenantSignupForm authConfig={authConfig} />
}
