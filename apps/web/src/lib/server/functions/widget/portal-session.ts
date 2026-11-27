import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { shouldReusePortalSession } from '@/lib/shared/widget/portal-session-reuse'

/**
 * Whether this widget request may act as the visitor's portal session (see
 * shouldReusePortalSession). When it may not, the rest of the request is
 * served as an anonymous caller, so the widget Home's server-rendered seed
 * (posts, votes, boards and their permissions, the private-portal gate) never
 * reflects a portal session the frame does not hold.
 *
 * Called first in the widget Home loader, during the frame's document
 * request. A call from inside the frame later is its own request and never
 * matches, so it only narrows that request.
 */
export const widgetPortalSessionReusedFn = createServerFn({ method: 'GET' }).handler(async () => {
  const headers = getRequestHeaders()
  const reused = shouldReusePortalSession({
    site: headers.get('sec-fetch-site'),
    mode: headers.get('sec-fetch-mode'),
  })
  if (!reused) {
    const { treatRequestAsAnonymous } = await import('@/lib/server/auth/request-session')
    treatRequestAsAnonymous()
  }
  return reused
})
