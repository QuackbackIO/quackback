import { z } from 'zod'
import { createFileRoute, useNavigate, Navigate } from '@tanstack/react-router'
import { CircleStackIcon } from '@heroicons/react/24/solid'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import { conversationAttributeQueries } from '@/lib/client/queries/conversation-attributes'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ConversationAttributesList } from '@/components/admin/settings/conversation-data/conversation-attributes-list'
import { ConversationTagsManager } from '@/components/admin/settings/conversation-data/conversation-tags-manager'

const searchSchema = z.object({
  tab: z.enum(['attributes', 'tags']).optional(),
})
type ConversationDataTab = 'attributes' | 'tags'

export const Route = createFileRoute('/admin/settings/conversation-data')({
  validateSearch: searchSchema,
  loader: async ({ context }) => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })
    await context.queryClient.ensureQueryData(conversationAttributeQueries.registry())
    return {}
  },
  component: ConversationDataRoute,
})

/**
 * Gate the page behind the experimental `supportInbox` flag (off by default),
 * mirroring the conversations settings route. Wrapping keeps the flag check
 * above the page's hooks so they aren't conditionally called.
 */
function ConversationDataRoute() {
  const { settings } = Route.useRouteContext()
  const flags = settings?.featureFlags as FeatureFlags | undefined
  if (!flags?.supportInbox) {
    return <Navigate to="/admin/settings" />
  }
  return <ConversationDataPage />
}

function ConversationDataPage() {
  const search = Route.useSearch()
  const tab: ConversationDataTab = search.tab ?? 'attributes'
  const navigate = useNavigate()

  return (
    <div className="max-w-5xl space-y-6">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={CircleStackIcon}
        title="Conversation data"
        description="Attributes and tags that structure your conversations and tickets."
      />

      <Tabs
        value={tab}
        onValueChange={(next) => {
          // Callback form preserves any other search params on the URL.
          void navigate({
            to: '/admin/settings/conversation-data',
            search: (prev) => ({ ...prev, tab: next as ConversationDataTab }),
            replace: true,
          })
        }}
        variant="line"
        className="space-y-6"
      >
        <TabsList>
          <TabsTrigger value="attributes">Attributes</TabsTrigger>
          <TabsTrigger value="tags">Tags</TabsTrigger>
        </TabsList>
        <TabsContent value="attributes" className="space-y-6">
          <ConversationAttributesList />
        </TabsContent>
        <TabsContent value="tags" className="space-y-6">
          <ConversationTagsManager />
        </TabsContent>
      </Tabs>
    </div>
  )
}
