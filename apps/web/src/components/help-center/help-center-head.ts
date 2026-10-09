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
