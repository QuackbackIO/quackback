/**
 * The help center's strings for a route's `head`.
 *
 * Kept apart from `help-center-utils` on purpose: `head` is route-shared code,
 * which the router bundles into the entry chunk every page loads, so whatever
 * this module imports ships to the admin, the portal and the widget alike.
 * `help-center-utils` pulls in the category tree helpers; this needs nothing
 * but the layout's route id.
 */
import { getRouteApi } from '@tanstack/react-router'

const helpCenterLayout = getRouteApi('/_portal/hc')

/**
 * The help center strings the layout's loader read in the page's language, for
 * a route's `head`, which runs outside React and so can't use react-intl.
 */
export function helpCenterHeadMessages(
  matches: readonly { routeId: string; loaderData?: unknown }[]
): Record<string, string> {
  const layout = matches.find((m) => m.routeId === helpCenterLayout.id)
  return (layout?.loaderData as { messages?: Record<string, string> } | undefined)?.messages ?? {}
}

/**
 * The portal's head inputs for a help center page: the workspace name for the
 * title, and the public base URL canonical links are built on (the verified
 * custom domain when the request arrived on it, else BASE_URL). The base URL is
 * undefined when the request carries none.
 */
export function helpCenterHeadPortal(
  matches: readonly { routeId: string; loaderData?: unknown; context?: unknown }[]
): { workspaceName: string; baseUrl: string | undefined } {
  const portal = matches.find((m) => m.routeId === '/_portal')
  return {
    workspaceName:
      (portal?.loaderData as { workspaceName?: string } | undefined)?.workspaceName ??
      'Help Center',
    baseUrl: (portal?.context as { baseUrl?: string } | undefined)?.baseUrl,
  }
}

/**
 * The absolute URL of a help center path on the base URL, or undefined when
 * there is no base URL to build it on. A relative canonical or og:url would
 * resolve against whichever host the crawler fetched the page from.
 */
export function helpCenterAbsoluteUrl(
  baseUrl: string | undefined,
  path: string
): string | undefined {
  return baseUrl ? `${baseUrl}${path}` : undefined
}
