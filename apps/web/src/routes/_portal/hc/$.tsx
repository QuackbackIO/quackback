import { createFileRoute, notFound, redirect } from '@tanstack/react-router'
import { resolveHelpCenterRedirectFn } from '@/lib/server/functions/help-center-redirect-rules'

/**
 * Catch-all for any /hc/* path that doesn't match a real route (domains/
 * languages §2). Consults the admin-configured redirect rules before giving
 * up to the generic 404 -- this is the only place in the /hc tree an
 * unmatched path can be reached from, so it's full coverage for the rule set.
 */
export const Route = createFileRoute('/_portal/hc/$')({
  beforeLoad: async ({ params }) => {
    const path = `/hc/${params._splat ?? ''}`.replace(/\/$/, '')
    const target = await resolveHelpCenterRedirectFn({ data: { path } })
    if (target) throw redirect({ to: target as string as '/', replace: true, statusCode: 301 })
    throw notFound()
  },
})
