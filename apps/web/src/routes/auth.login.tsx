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

const searchSchema = z.object({
  callbackUrl: z.string().optional(),
})

/**
 * Portal Login Page — email-first dispatcher. Mirrors `/admin/login`:
 * verified-domain emails get routed to SSO (same hard-binding rule),
 * everything else falls through to the portal's configured methods.
 */
export const Route = createFileRoute('/auth/login')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ callbackUrl: search.callbackUrl }),
  loader: async ({ context, deps }) => {
    const { settings, queryClient } = context
    if (!settings) {
      throw redirect({ to: '/onboarding' })
    }
    await queryClient.ensureQueryData(settingsQueries.publicPortalConfig())

    const safeCallbackUrl = isSafeCallbackUrl(deps.callbackUrl) ? deps.callbackUrl : '/'
    const { locale, messages } = await loadPortalIntl()

    return { safeCallbackUrl, locale, messages }
  },
  component: LoginPage,
})

function LoginPage() {
  const { safeCallbackUrl, locale, messages } = Route.useLoaderData()
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
