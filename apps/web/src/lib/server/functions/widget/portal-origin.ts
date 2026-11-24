import { createServerFn } from '@tanstack/react-start'

/**
 * Public: the portal's origin, for the widget's portal handoff link.
 *
 * Read from server config: in-process during SSR, one call to the server when
 * the widget Home loads in the browser. The iframe's own origin is not a
 * stand-in: the widget can be served from a different host than the portal,
 * and the handoff carries a sign-in token. The config import sits inside the
 * handler so the compiler drops it from the client graph. A plain dynamic
 * import in a route loader is not dropped: loaders also run in the browser, so
 * it would ship config.ts there.
 */
export const getWidgetPortalOriginFn = createServerFn({ method: 'GET' }).handler(async () =>
  (await import('@/lib/server/config')).getBaseUrl()
)
