import { createFileRoute, Navigate, redirect } from '@tanstack/react-router'
import { HelpCenterArticleEditor } from '@/components/admin/help-center/help-center-article-editor'
import { helpCenterQueries } from '@/lib/client/queries/help-center'
import { canonicalArticleTypeId } from '@/lib/shared/widget/article-ref'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import type { KbArticleId } from '@quackback/ids'

export const Route = createFileRoute('/admin/help-center/articles/$articleId')({
  beforeLoad: ({ params }) => {
    const canonical = canonicalArticleTypeId(params.articleId)
    if (canonical && canonical !== params.articleId) {
      throw redirect({
        to: '/admin/help-center/articles/$articleId',
        params: { articleId: canonical },
        replace: true,
      })
    }
  },
  loader: async ({ context, params }) => {
    const { queryClient } = context
    // Warm the queries the editor reads so the form renders with real data on
    // first paint instead of flashing empty values (category select, title)
    // before the article fetch resolves.
    await Promise.all([
      queryClient.ensureQueryData(helpCenterQueries.categories()),
      queryClient.ensureQueryData(helpCenterQueries.articleDetail(params.articleId as KbArticleId)),
    ])
    return {}
  },
  component: HelpCenterArticleEditorPage,
})

function HelpCenterArticleEditorPage() {
  const { articleId } = Route.useParams()
  const { settings } = Route.useRouteContext()
  const flags = settings?.featureFlags as FeatureFlags | undefined

  if (!flags?.helpCenter) {
    return <Navigate to="/admin/feedback" />
  }

  return <HelpCenterArticleEditor articleId={articleId as KbArticleId} />
}
