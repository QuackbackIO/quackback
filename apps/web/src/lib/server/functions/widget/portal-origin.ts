import { createIsomorphicFn } from '@tanstack/react-start'

/**
 * The portal's origin for the widget's portal handoff link.
 *
 * Server config during SSR. In the browser (a client-side return to the widget
 * Home) it is '', and WidgetShell falls back to the iframe's own origin: the
 * browser has no server config to read. The config import sits inside the
 * server half so the compiler drops it from the client graph; a plain dynamic
 * import in the route loader shipped config.ts to the browser.
 */
export const widgetPortalOrigin = createIsomorphicFn()
  .server(async () => (await import('@/lib/server/config')).getBaseUrl())
  .client(async () => '')
