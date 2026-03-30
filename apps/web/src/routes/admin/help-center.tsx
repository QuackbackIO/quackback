import { createFileRoute, Navigate } from '@tanstack/react-router'
import { z } from 'zod'
import { HelpCenterList } from '@/components/admin/help-center/help-center-list'
import { HelpCenterArticleModal } from '@/components/admin/help-center/help-center-article-modal'
import type { FeatureFlags } from '@/lib/server/domains/settings/settings.types'

const searchSchema = z.object({
  status: z.enum(['draft', 'published']).optional(),
  category: z.string().optional(),
  article: z.string().optional(), // Article ID for modal view
  search: z.string().optional(),
})

export const Route = createFileRoute('/admin/help-center')({
  validateSearch: searchSchema,
  component: HelpCenterPage,
})

function HelpCenterPage() {
  const search = Route.useSearch()
  const { settings } = Route.useRouteContext()
  const flags = settings?.featureFlags as FeatureFlags | undefined
  if (!flags?.helpCenter) {
    return <Navigate to="/admin/feedback" />
  }

  return (
    <main className="h-full">
      <HelpCenterList />
      <HelpCenterArticleModal articleId={search.article} />
    </main>
  )
}
