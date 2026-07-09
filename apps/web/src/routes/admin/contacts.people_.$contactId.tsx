/**
 * Contact detail — Tabs shell with Overview / Linked users / Tickets.
 */
import { Suspense } from 'react'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { createRouteErrorComponent } from '@/components/admin/shared'
import { useSuspenseQuery } from '@tanstack/react-query'
import type { ContactId } from '@quackback/ids'
import { contactQueries } from '@/lib/client/queries/contacts'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'
import { ContactOverviewTab } from '@/components/admin/contacts/contact-overview-tab'
import { ContactLinkedUsersTab } from '@/components/admin/contacts/contact-linked-users-tab'
import { ContactTicketsTab } from '@/components/admin/contacts/contact-tickets-tab'

export const Route = createFileRoute('/admin/contacts/people_/$contactId')({
  loader: async ({ params, context }) => {
    const { queryClient } = context as {
      queryClient: import('@tanstack/react-query').QueryClient
    }
    const contactId = params.contactId as ContactId
    const [detail] = await Promise.all([
      queryClient.ensureQueryData(contactQueries.detail(contactId)),
      queryClient.ensureQueryData(contactQueries.links(contactId)),
    ])
    if (!detail) throw notFound()
  },
  errorComponent: createRouteErrorComponent('Failed to load contact'),
  component: ContactDetailPage,
})

function ContactDetailPage() {
  const { contactId: rawId } = Route.useParams()
  const contactId = rawId as ContactId
  const { data: contact } = useSuspenseQuery(contactQueries.detail(contactId))

  if (!contact) return null

  const display = contact.name ?? contact.email ?? contact.id

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin/contacts/people">
            <ArrowLeftIcon className="h-4 w-4 mr-1" />
            People
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">{display}</h1>
            {contact.email && (
              <span className="text-xs text-muted-foreground">{contact.email}</span>
            )}
            {contact.archivedAt ? (
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
          <TabsTrigger value="linked-users">Linked users</TabsTrigger>
          <TabsTrigger value="tickets">Tickets</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="pt-4">
          <ContactOverviewTab contact={contact} />
        </TabsContent>
        <TabsContent value="linked-users" className="pt-4">
          <Suspense fallback={<Skeleton className="h-24 w-full" />}>
            <ContactLinkedUsersTab contactId={contactId} />
          </Suspense>
        </TabsContent>
        <TabsContent value="tickets" className="pt-4">
          <Suspense fallback={<Skeleton className="h-24 w-full" />}>
            <ContactTicketsTab contactId={contactId} />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  )
}
