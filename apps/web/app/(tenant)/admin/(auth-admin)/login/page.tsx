import { Suspense } from 'react'
import { LoginForm } from '@/components/auth/login-form'
import { getOrgSlug } from '@/lib/tenant'
import Link from 'next/link'

/**
 * Admin Login Page
 *
 * For team members (owner, admin, member) to sign in to the admin dashboard.
 * Uses the organization's team auth settings (passwordEnabled, googleEnabled, etc.)
 */
export default async function AdminLoginPage() {
  const orgSlug = await getOrgSlug()

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-8 px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Team Sign In</h1>
          <p className="mt-2 text-muted-foreground">Sign in to access the admin dashboard</p>
        </div>
        <Suspense fallback={<div className="animate-pulse h-64 bg-muted rounded-lg" />}>
          <LoginForm orgSlug={orgSlug ?? undefined} />
        </Suspense>
        <p className="text-center text-sm text-muted-foreground">
          Don&apos;t have a team account?{' '}
          <Link href="/admin/signup" className="font-medium text-primary hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  )
}
