import { createFileRoute, notFound, rootRouteId } from '@tanstack/react-router'
import { isPortalAddress } from '@/lib/shared/portal-address-space'

/**
 * Any portal address with nothing at it: the portal's not-found page, in
 * its header and footer (PortalShell provides it). Addresses that belong to
 * the admin, the API or sign-in get the plain page, before the portal loads.
 */
export const Route = createFileRoute('/_portal/$')({
  beforeLoad: ({ location }) => {
    if (!isPortalAddress(location.pathname)) throw notFound({ routeId: rootRouteId })
  },
  loader: () => {
    throw notFound()
  },
  head: () => ({ meta: [{ name: 'robots', content: 'noindex' }] }),
})
