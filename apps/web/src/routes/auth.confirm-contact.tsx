import { createFileRoute, Link } from '@tanstack/react-router'
import { z } from 'zod'
import { PortalAuthShell } from '@/components/auth/portal-auth-shell'
import { PortalIntlProvider } from '@/components/portal-intl-provider'
import { loadPortalIntl } from '@/lib/server/functions/locale'
import { Button } from '@/components/ui/button'
import { confirmContactEmailFn } from '@/lib/server/functions/contact-email'

/**
 * Where the confirmation link in the email lands.
 *
 * Confirmation happens in the loader, so the address is written by the time
 * anything renders and a refresh cannot re-submit it. The token is single-use,
 * so a second visit legitimately reports failure — the copy says "expired or
 * already used" rather than claiming something went wrong.
 *
 * No session is required. The link is opened from a mail client, routinely on a
 * different device from the one that asked, and the token is the proof.
 */
export const Route = createFileRoute('/auth/confirm-contact')({
  validateSearch: z.object({ token: z.string().optional() }),
  loaderDeps: ({ search }) => ({ token: search.token }),
  loader: async ({ deps }) => {
    const intl = await loadPortalIntl()
    if (!deps.token) return { intl, result: { ok: false as const } }
    const result = await confirmContactEmailFn({ data: { token: deps.token } })
    return { intl, result }
  },
  component: ConfirmContactPage,
})

function ConfirmContactPage() {
  const { intl, result } = Route.useLoaderData()

  return (
    <PortalIntlProvider locale={intl.locale} messages={intl.messages}>
      {result.ok ? (
        <PortalAuthShell
          heading="Email confirmed"
          subheading={`We'll send notifications to ${result.email}.`}
        >
          <Button asChild className="w-full">
            <Link to="/">Back to the portal</Link>
          </Button>
        </PortalAuthShell>
      ) : (
        <PortalAuthShell
          heading="This link has expired"
          subheading="Confirmation links last an hour and can only be used once. Ask for a new one and we'll send another."
        >
          <Button asChild variant="outline" className="w-full">
            <Link to="/">Back to the portal</Link>
          </Button>
        </PortalAuthShell>
      )}
    </PortalIntlProvider>
  )
}
