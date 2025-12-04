import { Suspense } from 'react'
import { PortalLoginForm } from '@/components/auth/portal-login-form'
import { getOrgSlug } from '@/lib/tenant'
import Link from 'next/link'

/**
 * Portal Login Page
 *
 * For portal users (visitors) to sign in.
 * Uses the organization's portal auth settings.
 */
export default async function LoginPage() {
  const orgSlug = await getOrgSlug()

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-8 px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Welcome back</h1>
          <p className="mt-2 text-muted-foreground">Sign in to your account</p>
        </div>
        <Suspense fallback={<div className="animate-pulse h-64 bg-muted rounded-lg" />}>
          <PortalLoginForm orgSlug={orgSlug ?? undefined} />
        </Suspense>
        <p className="text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{' '}
          <Link href="/signup" className="font-medium text-primary hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  )
}
