import { createServerFn } from '@tanstack/react-start'
import { resolveLocale, loadPortalMessages, type SupportedLocale } from '@/lib/shared/i18n'

/**
 * Resolve the portal locale from the request's Accept-Language header.
 *
 * Shared by the standalone `/auth/*` routes so they render under the same
 * `PortalIntlProvider` the in-portal pages get from `_portal.tsx` — without
 * it `useIntl`/`<FormattedMessage>` in the auth forms would have no provider.
 */
export const getPortalLocaleFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { getRequestHeaders } = await import('@tanstack/react-start/server')
  const acceptLanguage = getRequestHeaders().get('accept-language')
  return resolveLocale(acceptLanguage)
})

/**
 * Resolve the locale AND load its catalog for a route loader, so the page
 * renders translated during SSR (and hydrates from the same catalog) instead
 * of flashing English until the client fetches the messages.
 *
 * `loadPortalMessages` runs wherever the loader runs: server-side during SSR,
 * and client-side (cached, code-split chunk) on client navigation — only the
 * small locale lookup is ever an RPC. It returns just the portal slice of the
 * catalog (see PORTAL_MESSAGE_PREFIXES), so the SSR HTML doesn't carry the
 * admin/inbox strings the portal never renders.
 */
export async function loadPortalIntl(): Promise<{
  locale: SupportedLocale
  messages: Record<string, string>
}> {
  const locale = await getPortalLocaleFn()
  const messages = await loadPortalMessages(locale)
  return { locale, messages }
}
