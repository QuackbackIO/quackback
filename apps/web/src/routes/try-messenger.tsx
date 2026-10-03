import { useCallback, useEffect, useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { IntlProvider, FormattedMessage, useIntl } from 'react-intl'
import { z } from 'zod'
import { DEFAULT_LOCALE, loadWidgetMessages } from '@/lib/shared/i18n'
import { onIntlError } from '@/lib/client/intl-error'
import {
  TestCustomerFrame,
  type TestCustomerFrameStatus,
} from '@/components/onboarding/test-customer-frame'

const searchSchema = z.object({ ott: z.string().max(100).optional() })

/**
 * "Try it on your phone": a teammate scans a code and lands here with a
 * one-time token. The page hosts the same bearer-only test frame as the
 * in-app sheet, so the phone never needs a cookie either.
 */
export const Route = createFileRoute('/try-messenger')({
  validateSearch: searchSchema,
  loader: async ({ context }) => {
    const locale = context.acceptLanguageLocale ?? DEFAULT_LOCALE
    return { locale, messages: await loadWidgetMessages(locale) }
  },
  head: () => ({ meta: [{ name: 'robots', content: 'noindex' }] }),
  component: TryMessengerRoot,
})

function TryMessengerRoot() {
  const { locale, messages } = Route.useLoaderData()
  return (
    <IntlProvider
      locale={locale}
      messages={messages}
      defaultLocale={DEFAULT_LOCALE}
      onError={onIntlError}
    >
      <TryMessengerPage />
    </IntlProvider>
  )
}

function TryMessengerPage() {
  const intl = useIntl()
  const navigate = useNavigate()
  const { ott } = Route.useSearch()
  const tokenRef = useRef(ott ?? null)
  const [status, setStatus] = useState<TestCustomerFrameStatus>(ott ? 'connecting' : 'expired')

  useEffect(() => {
    if (ott) void navigate({ to: '/try-messenger', search: {}, replace: true })
  }, [ott, navigate])

  // Single use: a reload of the frame finds the token already spent.
  const getToken = useCallback(async () => {
    const token = tokenRef.current
    tokenRef.current = null
    return token
  }, [])

  if (status === 'expired') {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background px-6 text-center">
        <p className="text-sm text-muted-foreground">
          <FormattedMessage
            id="widget.test.phoneExpired"
            defaultMessage="This link was already used. Scan the code again."
          />
        </p>
      </main>
    )
  }

  // The session lives in this tab only: a reload would need a fresh code.
  return (
    <main className="flex h-dvh flex-col bg-background">
      <p className="shrink-0 border-b px-4 py-1.5 text-center text-xs text-muted-foreground">
        <FormattedMessage
          id="widget.test.sessionBanner"
          defaultMessage="Test session · keep this tab open"
        />
      </p>
      <div className="min-h-0 flex-1">
        <TestCustomerFrame
          getToken={getToken}
          open={{ view: 'chat' }}
          onStatusChange={setStatus}
          title={intl.formatMessage({
            id: 'widget.test.frameTitle',
            defaultMessage: 'Messenger as a test customer',
          })}
        />
      </div>
    </main>
  )
}
