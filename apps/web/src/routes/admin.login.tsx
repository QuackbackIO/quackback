import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { TeamLoginForm } from '@/components/auth/team-login-form'
import { AdminAuthShell } from '@/components/auth/admin-auth-shell'
import { PortalIntlProvider } from '@/components/portal-intl-provider'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ExclamationCircleIcon } from '@heroicons/react/24/solid'
import { isSafeCallbackUrl } from '@/lib/shared/routing'
import { AUTH_BLOCK_MESSAGES } from '@/lib/server/auth/redirect-errors'
import { getPortalLocaleFn } from '@/lib/server/functions/locale'

// Pre-check codes (password_method_not_allowed, rate_limited, etc.)
// share copy with the portal-side auth-client hook via
// AUTH_BLOCK_MESSAGES. Codes below are admin-only paths the portal
// modal can't reach: token expiry, OAuth-callback failures, the
// SSO-signup-disabled branch.
const errorMessages: Record<string, string> = {
  ...AUTH_BLOCK_MESSAGES,
  invalid_token: 'Your login link is invalid or has been tampered with. Please try again.',
  token_expired: 'Your login link has expired. Please request a new one.',
  not_team_member:
    "This account doesn't have team access. Team membership is by invitation only. Please contact your administrator.",
  // Better-Auth genericOAuth surfaces this when disableSignUp blocks a
  // brand-new SSO user (`autoCreateUsers === false` on the SSO config).
  // Existing users still link via accountLinking and don't see this.
  signup_disabled:
    "Your account isn't pre-provisioned for SSO. Ask an administrator to invite you first.",
  // Better-Auth's genericOAuth plugin surfaces these when the upstream
  // OIDC callback fails — IdP returned an error, token exchange
  // rejected, scope mismatch, etc.
  OAUTH_CALLBACK_ERROR:
    'Sign-in failed. Your identity provider rejected the request — check the app configuration in your IdP and try again.',
  oauth_signin_error:
    'Sign-in failed. Your identity provider rejected the request — check the app configuration in your IdP and try again.',
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

    // `<TeamLoginForm>` hands off to `<PortalAuthForm>`, which calls
    // `useIntl()` — so the page needs a `PortalIntlProvider` ancestor just
    // like /auth/login. Resolve the locale here so the provider has it on
    // first paint (no flash of the wrong language).
    const locale = await getPortalLocaleFn()

    return {
      errorMessage,
      safeCallbackUrl,
      authConfig,
      locale,
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
  const { errorMessage, safeCallbackUrl, authConfig, locale } = Route.useLoaderData()

  return (
    <PortalIntlProvider locale={locale}>
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
    </PortalIntlProvider>
  )
}
