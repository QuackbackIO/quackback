import { createFileRoute, Link, Outlet, useRouterState } from '@tanstack/react-router'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { PlusIcon } from '@heroicons/react/24/outline'
import { TicketQueueSidebar } from '@/components/admin/tickets/ticket-queue-sidebar'

const scopeSchema = z.enum([
  'all',
  'my_assigned',
  'my_team',
  'shared_with_me',
  'unassigned',
  'my_inbox',
  'inbox',
])

const statusCategorySchema = z.enum(['open', 'pending', 'on_hold', 'solved', 'closed'])

export const ticketsSearchSchema = z.object({
  scope: scopeSchema.optional().default('my_assigned'),
  statusCategory: statusCategorySchema.optional(),
  search: z.string().optional(),
  inboxId: z.string().optional(),
  sort: z.enum(['last_activity_desc', 'created_desc', 'created_asc']).optional(),
})

export type TicketsSearch = z.infer<typeof ticketsSearchSchema>

export const Route = createFileRoute('/admin/tickets')({
  validateSearch: ticketsSearchSchema,
  component: TicketsLayout,
})

function TicketsLayout() {
  const search = Route.useSearch()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const isDetailOrNew = /\/admin\/tickets\/.+/.test(pathname)

  if (isDetailOrNew) {
    return (
      <div className="flex h-full flex-col">
        <Outlet />
      </div>
    )
  }

  return (
    <div className="flex h-full">
      <TicketQueueSidebar
        activeScope={search.scope ?? 'my_assigned'}
        activeInboxId={search.inboxId}
      />
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center justify-end border-b border-border/50 px-4 py-2">
          <Button asChild size="sm">
            <Link to="/admin/tickets/new">
              <PlusIcon className="h-4 w-4 mr-1" />
              New ticket
            </Link>
          </Button>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
