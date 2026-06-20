import { createFileRoute, redirect, Link } from '@tanstack/react-router'
import { z } from 'zod'
import { FormattedMessage } from 'react-intl'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useRouteContext } from '@tanstack/react-router'
import { settingsQueries } from '@/lib/client/queries/settings'
import { PortalAuthForm } from '@/components/auth/portal-auth-form'
import { PortalAuthShell } from '@/components/auth/portal-auth-shell'
import { PortalIntlProvider } from '@/components/portal-intl-provider'
import { loadPortalIntl } from '@/lib/server/functions/locale'
import { DEFAULT_PORTAL_CONFIG } from '@/lib/shared/types/settings'
import { isSafeCallbackUrl } from '@/lib/shared/routing'
import { AUTH_BLOCK_MESSAGES } from '@/lib/server/auth/redirect-errors'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ExclamationCircleIcon } from '@heroicons/react/24/solid'

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

    return { safeCallbackUrl, locale, messages, errorMessage }
  },
  component: LoginPage,
})

function LoginPage() {
  const { safeCallbackUrl, locale, messages, errorMessage } = Route.useLoaderData()
  const portalConfigQuery = useSuspenseQuery(settingsQueries.publicPortalConfig())
  const portalConfig = portalConfigQuery.data
  const authConfig = portalConfig.oauth ?? DEFAULT_PORTAL_CONFIG.oauth

  const ctx = useRouteContext({ from: '__root__' }) as {
    settings?: { brandingData?: { name?: string } }
  }
  const workspaceName = ctx.settings?.brandingData?.name

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
          customProviderNames={portalConfig.customProviderNames}
          workspaceName={workspaceName}
        />
      </PortalAuthShell>
    </PortalIntlProvider>
  )
}
