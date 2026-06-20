import { createFileRoute, redirect, Link } from '@tanstack/react-router'
import { z } from 'zod'
import { FormattedMessage } from 'react-intl'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useRouteContext } from '@tanstack/react-router'
import { settingsQueries } from '@/lib/client/queries/settings'
import { PortalAuthForm } from '@/components/auth/portal-auth-form'
import { PortalAuthShell } from '@/components/auth/portal-auth-shell'
import { AdminAuthShell } from '@/components/auth/admin-auth-shell'
import { TeamLoginForm } from '@/components/auth/team-login-form'
import { PortalIntlProvider } from '@/components/portal-intl-provider'
import { loadPortalIntl } from '@/lib/server/functions/locale'
import { DEFAULT_PORTAL_CONFIG } from '@/lib/shared/types/settings'
import { isSafeCallbackUrl, isTeamCallback } from '@/lib/shared/routing'
import { AUTH_BLOCK_MESSAGES } from '@/lib/server/auth/redirect-errors'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ExclamationCircleIcon } from '@heroicons/react/24/solid'
import type { PortalAuthMethods } from '@/lib/shared/types'

const GENERIC_ERROR_MESSAGE =
  'Sign-in failed. Try again or contact your administrator if the problem persists.'

const searchSchema = z.object({
  callbackUrl: z.string().optional(),
  error: z.string().optional(),
})

/**
 * Portal Login Page — email-first dispatcher. Mirrors `/admin/login`:
 * verified-domain emails get routed to SSO (same hard-binding rule),
 * everything else falls through to the portal's configured methods.
 *
 * When the callback URL targets a team surface (`/admin`, `/complete-signup`,
 * `/auth/two-factor-setup-required`), the always-on `TeamLoginForm` is
 * served instead of the public portal form. This is the break-glass path
 * for admins who arrive at the unified `/auth/login` endpoint.
 */
export const Route = createFileRoute('/auth/login')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ callbackUrl: search.callbackUrl, error: search.error }),
  loader: async ({ context, deps }) => {
    const { settings, queryClient } = context
    if (!settings) {
      throw redirect({ to: '/onboarding' })
    }
    await queryClient.ensureQueryData(settingsQueries.publicPortalConfig())

    const safeCallbackUrl = isSafeCallbackUrl(deps.callbackUrl) ? deps.callbackUrl : '/'
    const { locale, messages } = await loadPortalIntl()

    const errorMessage = deps.error
      ? (AUTH_BLOCK_MESSAGES[deps.error as keyof typeof AUTH_BLOCK_MESSAGES] ??
          GENERIC_ERROR_MESSAGE)
      : null

    const isTeam = isTeamCallback(safeCallbackUrl)
    const teamAuthConfig = settings.publicAuthConfig.oauth

    return { safeCallbackUrl, isTeam, teamAuthConfig, locale, messages, errorMessage }
  },
  component: LoginPage,
})

interface TestOverrides {
  safeCallbackUrl: string
  isTeam: boolean
}

/**
 * Exported so unit tests can render the team branch without a full
 * RouterProvider. Pass `__test` to bypass loader / query / context hooks.
 */
export function LoginPage({ __test }: { __test?: TestOverrides } = {}) {
  // Test escape hatch — bypasses router/query context so unit tests can
  // drive the form branch without a RouterProvider or QueryClient.
  // The shell and IntlProvider are omitted; only the form tree is rendered.
  if (__test) {
    const { safeCallbackUrl, isTeam } = __test
    const emptyAuthConfig: PortalAuthMethods = {}
    if (isTeam) {
      return (
        <div>
          <TeamLoginForm callbackUrl={safeCallbackUrl} authConfig={emptyAuthConfig} />
          <p className="mt-6 text-center text-xs text-muted-foreground">
            SSO unavailable?{' '}
            <Link
              to="/auth/recovery"
              className="font-medium text-foreground hover:underline underline-offset-4"
            >
              Use a recovery code
            </Link>
          </p>
        </div>
      )
    }
    return null
  }

  return <LoginPageInner />
}

function LoginPageInner() {
  const { safeCallbackUrl, locale, messages, errorMessage, isTeam, teamAuthConfig } =
    Route.useLoaderData()
  const portalConfigQuery = useSuspenseQuery(settingsQueries.publicPortalConfig())
  const portalConfig = portalConfigQuery.data
  const authConfig = portalConfig.oauth ?? DEFAULT_PORTAL_CONFIG.oauth

  const ctx = useRouteContext({ from: '__root__' }) as {
    settings?: { brandingData?: { name?: string } }
  }
  const workspaceName = ctx.settings?.brandingData?.name

  if (isTeam) {
    return (
      <PortalIntlProvider locale={locale} messages={messages}>
        <AdminAuthShell heading="Sign in to your workspace">
          {errorMessage && (
            <Alert variant="destructive">
              <ExclamationCircleIcon className="h-4 w-4" />
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}
          <TeamLoginForm callbackUrl={safeCallbackUrl} authConfig={teamAuthConfig} />
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

  return (
    <PortalIntlProvider locale={locale} messages={messages}>
      <PortalAuthShell
        heading={<FormattedMessage id="portal.auth.welcomeBack" defaultMessage="Welcome back" />}
        subheading={
          workspaceName ? (
            <FormattedMessage
              id="portal.auth.login.subheadingNamed"
              defaultMessage="Sign in to keep voting and tracking what {workspace} ships."
              values={{ workspace: workspaceName }}
            />
          ) : (
            <FormattedMessage
              id="portal.auth.login.tagline"
              defaultMessage="Sign in to vote and comment on feedback."
            />
          )
        }
        footer={
          <p className="text-center text-sm text-muted-foreground">
            <FormattedMessage id="portal.auth.switch.newHere" defaultMessage="New here?" />{' '}
            <Link
              to="/auth/signup"
              search={{ callbackUrl: safeCallbackUrl }}
              className="font-medium text-primary hover:underline underline-offset-4"
            >
              <FormattedMessage
                id="portal.auth.switch.createAccount"
                defaultMessage="Create an account"
              />
            </Link>
          </p>
        }
      >
        {errorMessage && (
          <Alert variant="destructive">
            <ExclamationCircleIcon className="h-4 w-4" />
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}
        <PortalAuthForm
          mode="login"
          callbackUrl={safeCallbackUrl}
          authConfig={authConfig}
          oidcProviders={portalConfig.oidcProviders}
          workspaceName={workspaceName}
        />
      </PortalAuthShell>
    </PortalIntlProvider>
  )
}
