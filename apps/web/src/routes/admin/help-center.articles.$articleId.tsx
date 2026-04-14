import { createFileRoute, Navigate } from '@tanstack/react-router'
import { HelpCenterArticleEditor } from '@/components/admin/help-center/help-center-article-editor'
import type { FeatureFlags } from '@/lib/server/domains/settings/settings.types'
import type { HelpCenterArticleId } from '@quackback/ids'

export const Route = createFileRoute('/admin/help-center/articles/$articleId')({
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
