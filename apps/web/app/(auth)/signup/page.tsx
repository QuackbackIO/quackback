import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { PortalSignupForm } from '@/components/auth/portal-signup-form'
import { getOrgSlug } from '@/lib/tenant'
import { Loader2 } from 'lucide-react'

/**
 * Portal Signup Page
 *
 * For portal visitors to create accounts.
 * Uses the organization's portal auth settings.
 * Creates users with role='user' (portal-only access).
 */
export default async function SignupPage() {
  const orgSlug = await getOrgSlug()

  // Redirect to create workspace if not on a tenant domain (subdomain or custom domain)
  if (!orgSlug) {
    redirect('/create-workspace')
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-8 px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Create an account</h1>
          <p className="mt-2 text-muted-foreground">Sign up to vote and comment</p>
        </div>
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          }
        >
          <PortalSignupForm orgSlug={orgSlug} />
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
