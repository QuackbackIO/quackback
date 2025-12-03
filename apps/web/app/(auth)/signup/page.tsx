import { Suspense } from 'react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { TenantSignupForm } from '@/components/auth/tenant-signup-form'
import { Loader2 } from 'lucide-react'

/**
 * Tenant Signup Page
 *
 * This page is shown on tenant subdomains (e.g., acme.localhost / acme.quackback.io).
 * Users can sign up to join an existing organization if openSignupEnabled = true.
 *
 * Note: This is different from the main domain /create-workspace flow which creates
 * a new organization. This flow joins an EXISTING organization.
 */
export default async function SignupPage() {
  const headersList = await headers()
  const orgSlug = headersList.get('x-org-slug')

  // Redirect to main domain if not on a subdomain
  if (!orgSlug) {
    redirect('/create-workspace')
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-8 px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Join the team</h1>
          <p className="mt-2 text-muted-foreground">Create your account to get started</p>
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
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-primary hover:underline">
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

  return <TenantSignupForm orgSlug={orgSlug} authConfig={authConfig} />
}
