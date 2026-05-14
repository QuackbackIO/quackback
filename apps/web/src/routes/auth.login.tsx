import { createFileRoute, redirect, Link } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useRouteContext } from '@tanstack/react-router'
import { settingsQueries } from '@/lib/client/queries/settings'
import { PortalAuthForm } from '@/components/auth/portal-auth-form'
import { PortalAuthShell } from '@/components/auth/portal-auth-shell'
import { DEFAULT_PORTAL_CONFIG } from '@/lib/shared/types/settings'

/**
 * Portal Login Page — email-first dispatcher. Mirrors `/admin/login`:
 * verified-domain emails get routed to SSO (same hard-binding rule),
 * everything else falls through to the portal's configured methods.
 */
export const Route = createFileRoute('/auth/login')({
  loader: async ({ context }) => {
    const { settings, queryClient } = context
    if (!settings) {
      throw redirect({ to: '/onboarding' })
    }
    await queryClient.ensureQueryData(settingsQueries.publicPortalConfig())
    return {}
  },
  component: LoginPage,
})

function LoginPage() {
  Route.useLoaderData()
  const portalConfigQuery = useSuspenseQuery(settingsQueries.publicPortalConfig())
  const portalConfig = portalConfigQuery.data
  const authConfig = portalConfig.oauth ?? DEFAULT_PORTAL_CONFIG.oauth

  const ctx = useRouteContext({ from: '__root__' }) as {
    settings?: { brandingData?: { name?: string } }
  }
  const workspaceName = ctx.settings?.brandingData?.name

  return (
    <PortalAuthShell
      heading="Welcome back"
      subheading={
        workspaceName
          ? `Sign in to keep voting and tracking what ${workspaceName} ships.`
          : 'Sign in to vote and comment on feedback.'
      }
      footer={
        <p className="text-center text-sm text-muted-foreground">
          New here?{' '}
          <Link
            to="/auth/signup"
            className="font-medium text-primary hover:underline underline-offset-4"
          >
            Create an account
          </Link>
        </p>
      }
    >
      <PortalAuthForm
        mode="login"
        callbackUrl="/"
        authConfig={authConfig}
        customProviderNames={portalConfig.customProviderNames}
        workspaceName={workspaceName}
      />
    </PortalAuthShell>
  )
}
