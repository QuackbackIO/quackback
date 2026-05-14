import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { TeamLoginForm } from '@/components/auth/team-login-form'
import { AdminAuthShell } from '@/components/auth/admin-auth-shell'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ExclamationCircleIcon } from '@heroicons/react/24/solid'
import { isSafeCallbackUrl } from '@/lib/shared/routing'

// Error messages for login failures
const errorMessages: Record<string, string> = {
  invalid_token: 'Your login link is invalid or has been tampered with. Please try again.',
  token_expired: 'Your login link has expired. Please request a new one.',
  not_team_member:
    "This account doesn't have team access. Team membership is by invitation only. Please contact your administrator.",
  oauth_method_not_allowed: 'This sign-in method is not enabled for team members.',
  password_method_not_allowed: 'Password sign-in is not enabled. Please use another method.',
  // Better-Auth genericOAuth surfaces this when disableSignUp blocks a
  // brand-new SSO user (`autoCreateUsers === false` on the SSO config).
  // Existing users still link via accountLinking and don't see this.
  signup_disabled:
    "Your account isn't pre-provisioned for SSO. Ask an administrator to invite you first.",
  auth_method_blocked:
    "This sign-in method isn't allowed for your account right now. Try another option or contact your administrator.",
  // Verified-domain hard-binding (Section 3 of design): emails at the
  // tenant's verified SSO domain must use SSO — password / sign-up /
  // social / generic-OAuth callbacks are rejected. Magic-link / OTP
  // remain available as documented break-glass.
  verified_domain_requires_sso:
    'Your email domain is configured for SSO. Sign in with your single sign-on provider.',
  // Better-Auth's genericOAuth plugin surfaces these when the upstream
  // OIDC callback fails — IdP returned an error, token exchange
  // rejected, scope mismatch, etc.
  OAUTH_CALLBACK_ERROR:
    'Sign-in failed. Your identity provider rejected the request — check the app configuration in your IdP and try again.',
  oauth_signin_error:
    'Sign-in failed. Your identity provider rejected the request — check the app configuration in your IdP and try again.',
  rate_limited: 'Too many sign-in attempts. Please wait a few minutes and try again.',
}

const GENERIC_ERROR_MESSAGE =
  'Sign-in failed. Try again or contact your administrator if the problem persists.'

const searchSchema = z.object({
  callbackUrl: z.string().optional(),
  error: z.string().optional(),
})

/**
 * Admin Login Page — email-first dispatcher for team members.
 * `<TeamLoginForm>` reads the email, calls `lookupAuthMethodsFn`, and
 * either redirects to the configured SSO IdP (verified-domain match)
 * or renders the methods form (password / magic-link / other-OAuth).
 */
export const Route = createFileRoute('/admin/login')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ callbackUrl: search.callbackUrl, error: search.error }),
  loader: async ({ deps, context }) => {
    const { settings } = context
    if (!settings) {
      throw redirect({ to: '/onboarding' })
    }

    const { callbackUrl, error } = deps

    // Map a query-param error code to a user-visible message. Unknown
    // codes (e.g. an IdP error we haven't catalogued, a future hook)
    // fall back to a generic line so the alert never renders blank.
    const errorMessage = error ? (errorMessages[error] ?? GENERIC_ERROR_MESSAGE) : null

    // Validate callbackUrl is a relative path to prevent open redirects
    const safeCallbackUrl = isSafeCallbackUrl(callbackUrl) ? callbackUrl : '/admin'

    const authConfig = settings.publicAuthConfig.oauth

    return {
      errorMessage,
      safeCallbackUrl,
      authConfig,
    }
  },
  component: AdminLoginPage,
})

/**
 * /admin/login is the team sign-in page. Email-first dispatch:
 * `<TeamLoginForm>` asks for an email, calls `lookupAuthMethodsFn`,
 * and either redirects to the configured SSO IdP (verified-domain
 * match) or hands off to `<PortalAuthForm>` with the email pre-filled.
 *
 * Magic-link is unconditionally enabled for team sign-in inside
 * `<TeamLoginForm>` (invitation-claim mechanism + SSO break-glass).
 * Password and other-OAuth pass through whatever the tenant configured;
 * Layer A registration filter skips disabled providers.
 */
function AdminLoginPage() {
  const { errorMessage, safeCallbackUrl, authConfig } = Route.useLoaderData()

  return (
    <AdminAuthShell heading="Sign in to your workspace">
      {errorMessage && (
        <Alert variant="destructive">
          <ExclamationCircleIcon className="h-4 w-4" />
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}
      <TeamLoginForm callbackUrl={safeCallbackUrl} authConfig={authConfig} />
      <p className="mt-6 text-center text-xs text-muted-foreground">
        SSO unavailable?{' '}
        <Link
          to="/auth/recovery"
          className="font-medium text-foreground hover:underline underline-offset-4"
        >
          Use a recovery code
        </Link>
      </p>
    </AdminAuthShell>
  )
}
