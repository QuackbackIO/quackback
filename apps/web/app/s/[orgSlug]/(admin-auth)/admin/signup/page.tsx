import { redirect } from 'next/navigation'
import Link from 'next/link'
import { db, organization, eq } from '@quackback/db'
import { OTPAuthForm } from '@/components/auth/otp-auth-form'

interface AdminSignupPageProps {
  params: Promise<{ orgSlug: string }>
  searchParams: Promise<{ invitation?: string }>
}

/**
 * Admin Signup Page
 *
 * For team members to join an existing organization using magic OTP codes.
 * ONLY accessible via invitation link - redirects to login if no invitation provided.
 */
export default async function AdminSignupPage({ params, searchParams }: AdminSignupPageProps) {
  const { orgSlug } = await params
  const { invitation: invitationId } = await searchParams

  // Redirect to login if no invitation - team signup is invite-only
  if (!invitationId) {
    redirect('/admin/login')
  }

  // Fetch org auth config server-side
  const org = await db.query.organization.findFirst({
    where: eq(organization.slug, orgSlug),
  })

  const authConfig = org
    ? {
        found: true,
        googleEnabled: org.googleOAuthEnabled,
        githubEnabled: org.githubOAuthEnabled,
        microsoftEnabled: org.microsoftOAuthEnabled,
      }
    : null

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-8 px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Join the team</h1>
          <p className="mt-2 text-muted-foreground">
            Create your team account to access the admin dashboard
          </p>
        </div>
        <OTPAuthForm
          mode="signup"
          authConfig={authConfig}
          invitationId={invitationId}
          callbackUrl="/admin"
          context="team"
        />
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
