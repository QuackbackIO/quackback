import { createIsomorphicFn } from '@tanstack/react-start'

/**
 * The portal's origin for the widget's portal handoff link.
 *
 * Server config during SSR. In the browser (a client-side return to the widget
 * Home) it is '', and WidgetShell falls back to the iframe's own origin: the
 * browser has no server config to read. The config import sits inside the
 * server half so the compiler drops it from the client graph. A plain dynamic
 * import in a route loader is not dropped: loaders also run in the browser,
 * so it would ship config.ts there.
 */
export const widgetPortalOrigin = createIsomorphicFn()
  .server(async () => (await import('@/lib/server/config')).getBaseUrl())
  .client(async () => '')
