import { createFileRoute, Outlet } from '@tanstack/react-router'
import { IntlProvider } from 'react-intl'
import { DEFAULT_LOCALE, loadOnboardingMessages } from '@/lib/shared/i18n'
import { onIntlError } from '@/lib/client/intl-error'

/**
 * Parent route for onboarding: renders children under an IntlProvider.
 * The index route handles redirection logic.
 *
 * The wizard layout and every step render `useIntl` / `<FormattedMessage>`, so
 * the provider is mounted here, at the root of the onboarding tree, rather than
 * on the `_layout` below it: the index and any future onboarding route are then
 * covered too, and there is exactly one provider for the flow (the same shape
 * `/admin` uses for the admin tree).
 *
 * The locale comes from the router context, where the root beforeLoad already
 * put the Accept-Language resolution from bootstrap. This is an admin-side flow,
 * so it needs no extra round-trip to resolve what the request already carried.
 * An absent or unrecognized locale degrades to the default rather than
 * throwing: bootstrap resolves through `resolveLocale`, the `??` below covers
 * a context without it, and `loadMessages` falls back to English when a
 * catalog is missing.
 *
 * The document's `<html lang>` deliberately stays on the default here (see
 * `documentLocale`): no catalog carries `onboarding.` keys yet, so the wizard
 * renders its inline English defaults and advertising another language would be
 * a lie. When translated onboarding copy lands, add this tree there too.
 */
export const Route = createFileRoute('/onboarding')({
  loader: async ({ context }) => {
    const locale = context.acceptLanguageLocale ?? DEFAULT_LOCALE
    return { locale, messages: await loadOnboardingMessages(locale) }
  },
  component: OnboardingRoot,
})

function OnboardingRoot() {
  const { locale, messages } = Route.useLoaderData()

  return (
    <IntlProvider
      locale={locale}
      messages={messages}
      defaultLocale={DEFAULT_LOCALE}
      onError={onIntlError}
    >
      <Outlet />
    </IntlProvider>
  )
}
