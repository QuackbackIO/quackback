/**
 * Inbox detail route. Pre-fetches detail/channels/memberships in parallel,
 * shows a header with name + slug + active/archived chip, and a tabbed body
 * (Overview / Channels / Members).
 */
import { Suspense } from 'react'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { createRouteErrorComponent } from '@/components/admin/shared'
import { useSuspenseQuery } from '@tanstack/react-query'
import type { InboxId } from '@quackback/ids'
import { inboxQueries } from '@/lib/client/queries/inboxes'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'
import { InboxOverviewTab } from '@/components/admin/settings/inboxes/inbox-overview-tab'
import { InboxChannelsTab } from '@/components/admin/settings/inboxes/inbox-channels-tab'
import { InboxMembersTab } from '@/components/admin/settings/inboxes/inbox-members-tab'

export const Route = createFileRoute('/admin/settings/inboxes_/$inboxId')({
  loader: async ({ params, context }) => {
    const { queryClient } = context as {
      queryClient: import('@tanstack/react-query').QueryClient
    }
    const inboxId = params.inboxId as InboxId
    const [detail] = await Promise.all([
      queryClient.ensureQueryData(inboxQueries.detail(inboxId)),
      queryClient.ensureQueryData(inboxQueries.channels(inboxId)),
      queryClient.ensureQueryData(inboxQueries.memberships(inboxId)),
    ])
    if (!detail) throw notFound()
  },
  errorComponent: createRouteErrorComponent('Failed to load inbox'),
  component: InboxDetailPage,
})

function InboxDetailPage() {
  const { inboxId: rawId } = Route.useParams()
  const inboxId = rawId as InboxId
  const { data: inbox } = useSuspenseQuery(inboxQueries.detail(inboxId))

  if (!inbox) return null

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin/settings/inboxes">
            <ArrowLeftIcon className="h-4 w-4 mr-1" />
            Inboxes
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">{inbox.name}</h1>
            <span className="font-mono text-xs text-muted-foreground">{inbox.slug}</span>
            {inbox.archivedAt ? (
              <Badge variant="outline" className="text-muted-foreground">
                Archived
              </Badge>
            ) : (
              <Badge variant="outline">Active</Badge>
            )}
          </div>
          {inbox.description && (
            <p className="text-xs text-muted-foreground mt-0.5">{inbox.description}</p>
          )}
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="channels">Channels</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="pt-4">
          <InboxOverviewTab inbox={inbox} />
        </TabsContent>
        <TabsContent value="channels" className="pt-4">
          <Suspense fallback={<Skeleton className="h-24 w-full" />}>
            <InboxChannelsTab inboxId={inboxId} />
          </Suspense>
        </TabsContent>
        <TabsContent value="members" className="pt-4">
          <Suspense fallback={<Skeleton className="h-24 w-full" />}>
            <InboxMembersTab inboxId={inboxId} />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  )
}
