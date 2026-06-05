import { createServerFn } from '@tanstack/react-start'
import { resolveLocale } from '@/lib/shared/i18n'

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
