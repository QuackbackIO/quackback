import { db, organization, ssoProvider, eq } from '@quackback/db'
import { OTPAuthForm } from '@/components/auth/otp-auth-form'

/**
 * Admin Login Page
 *
 * For team members (owner, admin, member) to sign in to the admin dashboard using magic OTP codes.
 * Uses the organization's team auth settings (googleEnabled, etc.)
 */
export default async function AdminLoginPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params

  // Fetch org auth config server-side
  const org = await db.query.organization.findFirst({
    where: eq(organization.slug, orgSlug),
  })

  // Get SSO providers for this org
  const ssoProviders = org
    ? await db.query.ssoProvider.findMany({
        where: eq(ssoProvider.organizationId, org.id),
        columns: {
          providerId: true,
          issuer: true,
          domain: true,
        },
      })
    : []

  const authConfig = org
    ? {
        found: true,
        googleEnabled: org.googleOAuthEnabled,
        githubEnabled: org.githubOAuthEnabled,
        microsoftEnabled: org.microsoftOAuthEnabled,
        openSignupEnabled: org.openSignupEnabled,
        ssoProviders: ssoProviders.map((p) => ({
          providerId: p.providerId,
          issuer: p.issuer,
          domain: p.domain,
        })),
      }
    : null

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-8 px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Team Sign In</h1>
          <p className="mt-2 text-muted-foreground">Sign in to access the admin dashboard</p>
        </div>
        <OTPAuthForm mode="login" authConfig={authConfig} callbackUrl="/admin" context="team" />
      </div>
    </div>
  )
}
