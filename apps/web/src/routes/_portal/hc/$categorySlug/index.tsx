import { createFileRoute, redirect } from '@tanstack/react-router'
import { resolveHelpCenterRedirectFn } from '@/lib/server/functions/help-center-redirect-rules'

export const Route = createFileRoute('/_portal/hc/$categorySlug/')({
  beforeLoad: async ({ params }) => {
    // A single-segment /hc/* path is normally the legacy category URL, but an
    // admin-configured redirect rule (domains/languages §2) takes priority --
    // otherwise a rule at this exact shape could never be reached, since this
    // shim would always win the route match ahead of the catch-all.
    const target = await resolveHelpCenterRedirectFn({
      data: { path: `/hc/${params.categorySlug}` },
    })
    if (target) throw redirect({ to: target as string as '/', replace: true, statusCode: 301 })
    throw redirect({ to: `/hc/categories/${params.categorySlug}` as '/', replace: true })
  },
})
