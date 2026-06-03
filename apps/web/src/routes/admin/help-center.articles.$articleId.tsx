import { createFileRoute, Navigate } from '@tanstack/react-router'
import { HelpCenterArticleEditor } from '@/components/admin/help-center/help-center-article-editor'
import { helpCenterQueries } from '@/lib/client/queries/help-center'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import type { HelpCenterArticleId } from '@quackback/ids'

export const Route = createFileRoute('/admin/help-center/articles/$articleId')({
  loader: async ({ context, params }) => {
    const { queryClient } = context
    // Warm the queries the editor reads so the form renders with real data on
    // first paint instead of flashing empty values (category select, title)
    // before the article fetch resolves.
    await Promise.all([
      queryClient.ensureQueryData(helpCenterQueries.categories()),
      queryClient.ensureQueryData(
        helpCenterQueries.articleDetail(params.articleId as HelpCenterArticleId)
      ),
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

  return <HelpCenterArticleEditor articleId={articleId as HelpCenterArticleId} />
}
