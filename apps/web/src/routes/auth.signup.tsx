import { createFileRoute, redirect, Link } from '@tanstack/react-router'
import { z } from 'zod'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useRouteContext } from '@tanstack/react-router'
import { settingsQueries } from '@/lib/client/queries/settings'
import { PortalAuthForm } from '@/components/auth/portal-auth-form'
import { PortalAuthShell } from '@/components/auth/portal-auth-shell'
import { DEFAULT_PORTAL_CONFIG } from '@/lib/shared/types/settings'
import { isSafeCallbackUrl } from '@/lib/shared/routing'

const searchSchema = z.object({
  callbackUrl: z.string().optional(),
})

/**
 * Portal Signup Page
 *
 * For portal visitors to create accounts using email OTP or OAuth.
 * Creates member record with role='user' (portal users can vote/comment
 * but not access admin).
 */
export const Route = createFileRoute('/auth/signup')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ callbackUrl: search.callbackUrl }),
  loader: async ({ context, deps }) => {
    const { settings, queryClient } = context
    if (!settings) {
      throw redirect({ to: '/onboarding' })
    }
    await queryClient.ensureQueryData(settingsQueries.publicPortalConfig())

    const safeCallbackUrl = isSafeCallbackUrl(deps.callbackUrl) ? deps.callbackUrl : '/'

    return { safeCallbackUrl }
  },
  component: SignupPage,
})

function SignupPage() {
  const { safeCallbackUrl } = Route.useLoaderData()
  const portalConfigQuery = useSuspenseQuery(settingsQueries.publicPortalConfig())
  const portalConfig = portalConfigQuery.data
  const authConfig = portalConfig.oauth ?? DEFAULT_PORTAL_CONFIG.oauth

  const ctx = useRouteContext({ from: '__root__' }) as {
    settings?: { brandingData?: { name?: string } }
  }
  const workspaceName = ctx.settings?.brandingData?.name

  return (
    <PortalAuthShell
      heading="Create an account"
      subheading={
        workspaceName
          ? `Join ${workspaceName} to vote, comment, and follow the roadmap.`
          : 'Sign up to vote and comment on feedback.'
      }
      footer={
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link
            to="/auth/login"
            search={{ callbackUrl: safeCallbackUrl }}
            className="font-medium text-primary hover:underline underline-offset-4"
          >
            Sign in
          </Link>
        </p>
      }
    >
      <PortalAuthForm
        mode="signup"
        callbackUrl={safeCallbackUrl}
        authConfig={authConfig}
        customProviderNames={portalConfig.customProviderNames}
        workspaceName={workspaceName}
      />
    </PortalAuthShell>
  )
}
