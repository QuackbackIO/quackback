import { createFileRoute, redirect, Link } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { settingsQueries } from '@/lib/queries/settings'
import { PortalAuthForm } from '@/components/auth/portal-auth-form'
import { DEFAULT_PORTAL_CONFIG } from '@/lib/settings'

/**
 * Portal Signup Page
 *
 * For portal visitors to create accounts using email OTP, OAuth, or OIDC.
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
  const authConfig = portalConfigQuery.data.oauth ?? DEFAULT_PORTAL_CONFIG.oauth
  const oidcConfig = portalConfigQuery.data.oidc

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-8 px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Create an account</h1>
          <p className="mt-2 text-muted-foreground">Sign up to vote and comment</p>
        </div>
        <PortalAuthForm
          callbackUrl="/"
          orgSlug={settings.slug}
          authConfig={authConfig}
          oidcConfig={oidcConfig}
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
