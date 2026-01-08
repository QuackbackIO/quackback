import { createFileRoute, redirect, Link } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { settingsQueries } from '@/lib/queries/settings'
import { OTPAuthForm } from '@/components/auth/otp-auth-form'
import { DEFAULT_PORTAL_CONFIG } from '@/lib/settings'

/**
 * Portal Signup Page
 *
 * For portal visitors to create accounts using magic OTP codes or OAuth.
 * Creates member record with role='user' (portal users can vote/comment but not access admin).
 */
export const Route = createFileRoute('/auth/signup')({
  loader: async ({ context }) => {
    // Settings already available from root context
    const { settings, queryClient } = context
    if (!settings) {
      throw redirect({ to: '/onboarding' })
    }

    // Pre-fetch portal config using React Query
    await queryClient.ensureQueryData(settingsQueries.publicPortalConfig())

    return {
      settings,
    }
  },
  component: SignupPage,
})

function SignupPage() {
  const { settings } = Route.useLoaderData()

  // Read pre-fetched data from React Query cache
  const portalConfigQuery = useSuspenseQuery(settingsQueries.publicPortalConfig())
  const oauthConfig = portalConfigQuery.data.oauth ?? DEFAULT_PORTAL_CONFIG.oauth

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-8 px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Create an account</h1>
          <p className="mt-2 text-muted-foreground">Sign up to vote and comment</p>
        </div>
        <OTPAuthForm
          mode="signup"
          callbackUrl="/"
          context="portal"
          orgSlug={settings.slug}
          oauthConfig={oauthConfig}
        />
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link to="/auth/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
