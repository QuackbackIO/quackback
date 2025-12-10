import Link from 'next/link'
import { db, organization, eq } from '@quackback/db'
import { OTPAuthForm } from '@/components/auth/otp-auth-form'

interface LoginPageProps {
  params: Promise<{ orgSlug: string }>
}

/**
 * Portal Login Page
 *
 * For portal users (visitors) to sign in using magic OTP codes.
 * Uses the organization's portal auth settings.
 */
export default async function LoginPage({ params }: LoginPageProps) {
  const { orgSlug } = await params

  // Fetch org auth config server-side
  const org = await db.query.organization.findFirst({
    where: eq(organization.slug, orgSlug),
  })

  const authConfig = org
    ? {
        found: true,
        portalAuthEnabled: org.portalAuthEnabled,
        googleEnabled: org.portalGoogleEnabled,
        githubEnabled: org.portalGithubEnabled,
      }
    : null

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-8 px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Welcome back</h1>
          <p className="mt-2 text-muted-foreground">Sign in to your account</p>
        </div>
        <OTPAuthForm mode="login" authConfig={authConfig} callbackUrl="/" context="portal" />
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
