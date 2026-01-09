import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { useSuspenseQuery } from '@tanstack/react-query'
import { settingsQueries } from '@/lib/queries/settings'
import { DEFAULT_AUTH_CONFIG } from '@/lib/settings'
import { OTPAuthForm } from '@/components/auth/otp-auth-form'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ExclamationCircleIcon } from '@heroicons/react/24/solid'

// Error messages for trust-login failures
const errorMessages: Record<string, string> = {
  invalid_token: 'Your login link is invalid or has been tampered with. Please try again.',
  token_expired: 'Your login link has expired. Please request a new one.',
  trust_login_not_configured: 'Single sign-on is not configured for this workspace.',
  trust_login_not_supported: 'Single sign-on is not supported in this mode.',
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

    // Get error message if present
    const errorMessage = error && errorMessages[error]

    // Validate callbackUrl is a relative path to prevent open redirects
    const safeCallbackUrl =
      callbackUrl && callbackUrl.startsWith('/') && !callbackUrl.startsWith('//')
        ? callbackUrl
        : '/admin'

    // Pre-fetch auth config using React Query
    await queryClient.ensureQueryData(settingsQueries.publicAuthConfig())

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

  // Read pre-fetched data from React Query cache
  const authConfigQuery = useSuspenseQuery(settingsQueries.publicAuthConfig())
  const authConfig = authConfigQuery.data
    ? {
        found: true,
        openSignup: authConfigQuery.data.openSignup,
      }
    : {
        found: false,
        openSignup: DEFAULT_AUTH_CONFIG.openSignup,
      }

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
          mode="login"
          authConfig={authConfig}
          callbackUrl={safeCallbackUrl}
          context="team"
          orgSlug={settings.slug}
          showOAuth
        />
      </div>
    </div>
  )
}
