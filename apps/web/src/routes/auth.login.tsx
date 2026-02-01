import { createFileRoute, redirect, Link } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { settingsQueries } from '@/lib/client/queries/settings'
import { PortalAuthForm } from '@/components/auth/portal-auth-form'
import { DEFAULT_PORTAL_CONFIG } from '@/lib/server/domains/settings'

/**
 * Portal Login Page
 *
 * For portal users (visitors) to sign in using email OTP, OAuth, or OIDC.
 */
export const Route = createFileRoute('/auth/login')({
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
  component: LoginPage,
})

function LoginPage() {
  const { settings } = Route.useLoaderData()

  // Read pre-fetched data from React Query cache
  const portalConfigQuery = useSuspenseQuery(settingsQueries.publicPortalConfig())
  const authConfig = portalConfigQuery.data.oauth ?? DEFAULT_PORTAL_CONFIG.oauth
  const oidcConfig = portalConfigQuery.data.oidc

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-8 px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Welcome back</h1>
          <p className="mt-2 text-muted-foreground">Sign in to your account</p>
        </div>
        <PortalAuthForm
          callbackUrl="/"
          orgSlug={settings.slug}
          authConfig={authConfig}
          oidcConfig={oidcConfig}
        />
        <p className="text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{' '}
          <Link to="/auth/signup" className="font-medium text-primary hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  )
}
