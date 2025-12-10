import { organizationService, DEFAULT_AUTH_CONFIG } from '@quackback/domain'
import { OTPAuthForm } from '@/components/auth/otp-auth-form'

/**
 * Admin Login Page
 *
 * For team members (owner, admin, member) to sign in to the admin dashboard using magic OTP codes.
 * Uses the organization's team auth settings.
 */
export default async function AdminLoginPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params

  // Fetch org auth config using the service
  const result = await organizationService.getPublicAuthConfig(orgSlug)

  const authConfig = result.success
    ? {
        found: true,
        oauth: result.value.oauth,
        openSignup: result.value.openSignup,
        ssoProviders: result.value.ssoProviders,
      }
    : {
        found: false,
        oauth: DEFAULT_AUTH_CONFIG.oauth,
        openSignup: DEFAULT_AUTH_CONFIG.openSignup,
        ssoProviders: [],
      }

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
