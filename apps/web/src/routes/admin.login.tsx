import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { OTPAuthForm } from '@/components/auth/otp-auth-form'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ExclamationCircleIcon } from '@heroicons/react/24/solid'
import { settingsQueries } from '@/lib/queries/settings'
import { useSuspenseQuery } from '@tanstack/react-query'

// Error messages for login failures
const errorMessages: Record<string, string> = {
  invalid_token: 'Your login link is invalid or has been tampered with. Please try again.',
  token_expired: 'Your login link has expired. Please request a new one.',
  trust_login_not_configured: 'Single sign-on is not configured for this workspace.',
  trust_login_not_supported: 'Single sign-on is not supported in this mode.',
  not_team_member:
    "This account doesn't have team access. Team membership is by invitation only. Please contact your administrator.",
  sso_required: 'Your organization requires SSO. Please sign in with your identity provider.',
  oauth_method_not_allowed: 'This sign-in method is not enabled for team members.',
}

const searchSchema = z.object({
  callbackUrl: z.string().optional(),
  error: z.string().optional(),
})

/**
 * Admin Login Page
 *
 * For team members (owner, admin, member) to sign in to the admin dashboard using magic OTP codes.
 * Uses the organization's team auth settings.
 */
export const Route = createFileRoute('/admin/login')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ callbackUrl: search.callbackUrl, error: search.error }),
  loader: async ({ deps, context }) => {
    // Settings already available from root context
    const { settings, queryClient } = context
    if (!settings) {
      throw redirect({ to: '/onboarding' })
    }

    const { callbackUrl, error } = deps

    // Pre-fetch public security config for team login options
    await queryClient.ensureQueryData(settingsQueries.publicSecurityConfig())

    // Get error message if present
    const errorMessage = error && errorMessages[error]

    // Validate callbackUrl is a relative path to prevent open redirects
    const safeCallbackUrl =
      callbackUrl && callbackUrl.startsWith('/') && !callbackUrl.startsWith('//')
        ? callbackUrl
        : '/admin'

    return {
      settings,
      errorMessage,
      safeCallbackUrl,
    }
  },
  component: AdminLoginPage,
})

function AdminLoginPage() {
  const { settings, errorMessage, safeCallbackUrl } = Route.useLoaderData()
  const securityConfig = useSuspenseQuery(settingsQueries.publicSecurityConfig()).data

  // Determine what auth methods to show based on security config
  const ssoRequired = securityConfig.sso.enabled && securityConfig.sso.enforcement === 'required'
  const showGitHub = !ssoRequired && securityConfig.teamSocialLogin.github
  const showGoogle = !ssoRequired && securityConfig.teamSocialLogin.google
  const showSSO = securityConfig.sso.enabled

  // Build OIDC config for OTPAuthForm if SSO is enabled
  const oidcConfig = showSSO
    ? { enabled: true, displayName: securityConfig.sso.displayName || 'SSO' }
    : null

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-8 px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Team Sign In</h1>
          <p className="mt-2 text-muted-foreground">Sign in to access the admin dashboard</p>
        </div>
        {errorMessage && (
          <Alert variant="destructive">
            <ExclamationCircleIcon className="h-4 w-4" />
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}
        <OTPAuthForm
          callbackUrl={safeCallbackUrl}
          orgSlug={settings.slug}
          oauthConfig={{ github: showGitHub, google: showGoogle }}
          oidcConfig={oidcConfig}
          oidcType="team"
        />
      </div>
    </div>
  )
}
