/**
 * Organization detail — Tabs shell with Overview / Contacts / Tickets.
 */
import { Suspense } from 'react'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { createRouteErrorComponent } from '@/components/admin/shared'
import { useSuspenseQuery } from '@tanstack/react-query'
import type { OrganizationId } from '@quackback/ids'
import { organizationQueries } from '@/lib/client/queries/organizations'
import { contactQueries } from '@/lib/client/queries/contacts'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'
import { OrganizationOverviewTab } from '@/components/admin/contacts/organization-overview-tab'
import { OrganizationContactsTab } from '@/components/admin/contacts/organization-contacts-tab'
import { OrganizationTicketsTab } from '@/components/admin/contacts/organization-tickets-tab'

export const Route = createFileRoute('/admin/contacts/organizations_/$organizationId')({
  loader: async ({ params, context }) => {
    const { queryClient } = context as {
      queryClient: import('@tanstack/react-query').QueryClient
    }
    const organizationId = params.organizationId as OrganizationId
    const [detail] = await Promise.all([
      queryClient.ensureQueryData(organizationQueries.detail(organizationId)),
      queryClient.ensureQueryData(contactQueries.byOrg(organizationId, {})),
    ])
    if (!detail) throw notFound()
  },
  errorComponent: createRouteErrorComponent('Failed to load organization'),
  component: OrganizationDetailPage,
})

function OrganizationDetailPage() {
  const { organizationId: rawId } = Route.useParams()
  const organizationId = rawId as OrganizationId
  const { data: org } = useSuspenseQuery(organizationQueries.detail(organizationId))

  if (!org) return null

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin/contacts/organizations">
            <ArrowLeftIcon className="h-4 w-4 mr-1" />
            Organizations
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">{org.name}</h1>
            {org.domain && (
              <span className="font-mono text-xs text-muted-foreground">{org.domain}</span>
            )}
            {org.archivedAt ? (
              <Badge variant="outline" className="text-muted-foreground">
                Archived
              </Badge>
            ) : (
              <Badge variant="outline">Active</Badge>
            )}
          </div>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="contacts">Contacts</TabsTrigger>
          <TabsTrigger value="tickets">Tickets</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="pt-4">
          <OrganizationOverviewTab organization={org} />
        </TabsContent>
        <TabsContent value="contacts" className="pt-4">
          <Suspense fallback={<Skeleton className="h-24 w-full" />}>
            <OrganizationContactsTab organizationId={organizationId} />
          </Suspense>
        </TabsContent>
        <TabsContent value="tickets" className="pt-4">
          <Suspense fallback={<Skeleton className="h-24 w-full" />}>
            <OrganizationTicketsTab organizationId={organizationId} />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  )
}
