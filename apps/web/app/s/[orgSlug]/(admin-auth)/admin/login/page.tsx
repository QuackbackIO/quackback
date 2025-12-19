import { workspaceService, DEFAULT_AUTH_CONFIG } from '@quackback/domain'
import { OTPAuthForm } from '@/components/auth/otp-auth-form'

const APP_DOMAIN = process.env.APP_DOMAIN

/**
 * Admin Login Page
 *
 * For team members (owner, admin, member) to sign in to the admin dashboard using magic OTP codes.
 * Uses the organization's team auth settings.
 */
export default async function AdminLoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>
  searchParams: Promise<{ callbackUrl?: string }>
}) {
  const { orgSlug } = await params
  const { callbackUrl } = await searchParams

  // Validate callbackUrl is a relative path to prevent open redirects
  const safeCallbackUrl =
    callbackUrl && callbackUrl.startsWith('/') && !callbackUrl.startsWith('//')
      ? callbackUrl
      : '/admin'

  // Fetch org auth config using the service
  const result = await workspaceService.getPublicAuthConfig(orgSlug)

  const authConfig = result.success
    ? {
        found: true,
        openSignup: result.value.openSignup,
        ssoProviders: result.value.ssoProviders,
      }
    : {
        found: false,
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
        <OTPAuthForm
          mode="login"
          authConfig={authConfig}
          callbackUrl={safeCallbackUrl}
          context="team"
          orgSlug={orgSlug}
          appDomain={APP_DOMAIN}
          showOAuth
        />
      </div>
    </div>
  )
}
