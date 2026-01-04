import { createFileRoute, redirect, Link } from '@tanstack/react-router'
import { z } from 'zod'
import { useSuspenseQuery } from '@tanstack/react-query'
import { settingsQueries } from '@/lib/queries/settings'
import { DEFAULT_AUTH_CONFIG } from '@/lib/settings'
import { OTPAuthForm } from '@/components/auth/otp-auth-form'

const searchSchema = z.object({
  invitation: z.string().optional(),
})

/**
 * Admin Signup Page
 *
 * For team members to join an existing organization using magic OTP codes.
 * ONLY accessible via invitation link - redirects to login if no invitation provided.
 */
export const Route = createFileRoute('/admin/signup')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ invitation: search.invitation }),
  loader: async ({ deps, context }) => {
    // Settings already available from root context
    const { settings, queryClient } = context
    if (!settings) {
      throw redirect({ to: '/workspace-not-found' })
    }

    const { invitation: invitationId } = deps

    // Redirect to login if no invitation - team signup is invite-only
    if (!invitationId) {
      throw redirect({ to: '/admin/login' })
    }

    // Pre-fetch auth config using React Query
    await queryClient.ensureQueryData(settingsQueries.publicAuthConfig())

    return {
      settings,
      invitationId,
    }
  },
  component: AdminSignupPage,
})

function AdminSignupPage() {
  const { settings, invitationId } = Route.useLoaderData()

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
          <h1 className="text-2xl font-bold">Join the team</h1>
          <p className="mt-2 text-muted-foreground">
            Create your team account to access the admin dashboard
          </p>
        </div>
        <OTPAuthForm
          mode="signup"
          authConfig={authConfig}
          invitationId={invitationId}
          callbackUrl="/admin"
          context="team"
          orgSlug={settings.slug}
          showOAuth
        />
        <p className="text-center text-sm text-muted-foreground">
          Already have a team account?{' '}
          <Link to="/admin/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
