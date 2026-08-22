import { z } from 'zod'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { createFileRoute, useNavigate, redirect } from '@tanstack/react-router'
import { CircleStackIcon } from '@heroicons/react/24/solid'
import { isProductEnabled } from '@/lib/shared/types/settings'
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
  beforeLoad: ({ context }) => {
    if (!isProductEnabled(context.settings?.featureFlags, 'support')) {
      throw redirect({ to: '/admin/settings/general' })
    }
  },
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.CONVERSATION_MANAGE)
    await context.queryClient.ensureQueryData(conversationAttributeQueries.registry())
    return {}
  },
  component: ConversationDataPage,
})

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
