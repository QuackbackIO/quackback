import Link from 'next/link'
import { db, organization, eq } from '@quackback/db'
import { OTPAuthForm } from '@/components/auth/otp-auth-form'

interface SignupPageProps {
  params: Promise<{ orgSlug: string }>
}

/**
 * Portal Signup Page
 *
 * For portal visitors to create accounts using magic OTP codes.
 * Uses the organization's portal auth settings.
 * Creates member record with role='user' (portal users can vote/comment but not access admin).
 */
export default async function SignupPage({ params }: SignupPageProps) {
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
          <h1 className="text-2xl font-bold">Create an account</h1>
          <p className="mt-2 text-muted-foreground">Sign up to vote and comment</p>
        </div>
        <OTPAuthForm mode="signup" authConfig={authConfig} callbackUrl="/" context="portal" />
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
