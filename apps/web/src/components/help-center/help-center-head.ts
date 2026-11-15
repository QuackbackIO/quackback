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
import { sectionUrl, type SectionOrigins } from '@/lib/shared/section-links'

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
 * title, and `helpUrl`, which makes a help center path absolute for canonical
 * links: on the help center's own host once it has one (its home written as
 * `/` there), else on the request's base URL. `helpUrl` gives undefined when
 * the request carries neither.
 */
export function helpCenterHeadPortal(
  matches: readonly { routeId: string; loaderData?: unknown; context?: unknown }[]
): {
  workspaceName: string
  baseUrl: string | undefined
  helpUrl: (path: string) => string | undefined
} {
  const portal = matches.find((m) => m.routeId === '/_portal')
  const context = portal?.context as
    { baseUrl?: string; sectionOrigins?: SectionOrigins } | undefined
  const baseUrl = context?.baseUrl
  const origins = context?.sectionOrigins
  return {
    workspaceName:
      (portal?.loaderData as { workspaceName?: string } | undefined)?.workspaceName ??
      'Help Center',
    baseUrl,
    helpUrl: (path) =>
      origins ? sectionUrl('help', path, origins) : helpCenterAbsoluteUrl(baseUrl, path),
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
