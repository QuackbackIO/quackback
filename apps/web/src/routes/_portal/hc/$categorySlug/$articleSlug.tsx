import { createFileRoute, redirect } from '@tanstack/react-router'
import { resolveHelpCenterRedirectFn } from '@/lib/server/functions/help-center-redirect-rules'

export const Route = createFileRoute('/_portal/hc/$categorySlug/$articleSlug')({
  beforeLoad: async ({ params }) => {
    // Same rationale as the sibling index route: an admin-configured redirect
    // rule at this two-segment shape must win over the legacy article shim.
    const path = `/hc/${params.categorySlug}/${params.articleSlug}`
    const target = await resolveHelpCenterRedirectFn({ data: { path } })
    if (target) throw redirect({ to: target as string as '/', replace: true, statusCode: 301 })
    throw redirect({
      to: `/hc/articles/${params.categorySlug}/${params.articleSlug}` as '/',
      replace: true,
    })
  },
})
