import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { AreaMessages } from '@/components/shared/area-messages'
import { PortalIntlProvider } from '@/components/portal-intl-provider'
import { DeviceApproval } from '@/components/device/device-approval'
import { buildSigninRedirect } from '@/lib/shared/auth-prompt'

/**
 * The verification page for the OAuth device authorization grant (RFC 8628):
 * a headless client shows a code and a link here, and the signed-in person
 * approves or denies it. The link carries the code, so a person who follows it
 * lands on the approval with nothing to type.
 */
export const Route = createFileRoute('/device')({
  validateSearch: (search: Record<string, unknown>): { user_code?: string } => ({
    user_code: typeof search.user_code === 'string' ? search.user_code.slice(0, 32) : undefined,
  }),
  beforeLoad: ({ context, search }) => {
    const user = context.session?.user as { isAnonymous?: boolean } | undefined
    if (!user || user.isAnonymous) {
      const back = search.user_code
        ? `/device?user_code=${encodeURIComponent(search.user_code)}`
        : '/device'
      throw redirect(buildSigninRedirect(back))
    }
  },
  // The loader's work lives in a lazy module: this route's options ride in the
  // entry bundle every page loads, and only the device page needs the rest.
  loader: async ({ context }) => {
    const { loadDeviceMessages } = await import('@/components/device/device-messages')
    return loadDeviceMessages(context.personLocale)
  },
  component: DeviceRoute,
})

function DeviceRoute() {
  const { locale, messages, shared } = Route.useLoaderData()
  const { user_code } = Route.useSearch()
  const navigate = useNavigate()
  return (
    <PortalIntlProvider locale={locale} messages={shared}>
      <meta name="robots" content="noindex" />
      <AreaMessages area="deviceSignIn" messages={messages}>
        <DeviceApproval
          userCode={user_code}
          onCode={(code) =>
            void navigate({ to: '/device', search: code ? { user_code: code } : {} })
          }
        />
      </AreaMessages>
    </PortalIntlProvider>
  )
}
