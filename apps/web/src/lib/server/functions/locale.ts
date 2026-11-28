import { createServerFn } from '@tanstack/react-start'
import {
  resolveRequestLocale,
  loadPortalMessages,
  loadUnsubscribeMessages,
  type SupportedLocale,
} from '@/lib/shared/i18n'

/**
 * Resolve the portal locale from the request's Accept-Language header.
 *
 * Shared by the standalone `/auth/*` routes so they render under the same
 * `PortalIntlProvider` the in-portal pages get from `_portal.tsx` — without
 * it `useIntl`/`<FormattedMessage>` in the auth forms would have no provider.
 */
export const getPortalLocaleFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { getRequestHeaders } = await import('@tanstack/react-start/server')
  const { getLanguageConfig } = await import('@/lib/server/domains/settings/settings.service')
  const acceptLanguage = getRequestHeaders().get('accept-language')
  return resolveRequestLocale(acceptLanguage, await getLanguageConfig(), { forVisitor: true })
})

/**
 * The widget's language, resolved on the server so SSR and hydration agree:
 * the host page's `?locale=` when the product has it, then the workspace's
 * visitor rule. Both are read server-side because navigator/URL access during
 * render would diverge from SSR and trigger React hydration error #418.
 */
export const getWidgetLocaleFn = createServerFn({ method: 'GET' })
  // A plain validator: this file rides with the portal layout's loader in the
  // route tree chunk every page loads, so it keeps zod out of it.
  .validator((data: { explicitLocale?: unknown }) => ({
    explicitLocale: typeof data?.explicitLocale === 'string' ? data.explicitLocale : undefined,
  }))
  .handler(async ({ data }) => {
    const { getRequestHeaders } = await import('@tanstack/react-start/server')
    const { getLanguageConfig } = await import('@/lib/server/domains/settings/settings.service')
    const acceptLanguage = getRequestHeaders().get('accept-language')
    return resolveRequestLocale(acceptLanguage, await getLanguageConfig(), {
      explicit: data.explicitLocale,
      forVisitor: true,
    })
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
export async function loadPortalIntl(pageLocale?: SupportedLocale | null): Promise<{
  locale: SupportedLocale
  messages: Record<string, string>
}> {
  // A page whose address names its language (a help center page) reads in it.
  const locale = pageLocale ?? (await getPortalLocaleFn())
  const messages = await loadPortalMessages(locale)
  return { locale, messages }
}

/**
 * {@link loadPortalIntl} for the standalone /unsubscribe page, which renders
 * only its own `unsubscribe.` strings and so seeds only those.
 */
export async function loadUnsubscribeIntl(): Promise<{
  locale: SupportedLocale
  messages: Record<string, string>
}> {
  const locale = await getPortalLocaleFn()
  const messages = await loadUnsubscribeMessages(locale)
  return { locale, messages }
}
