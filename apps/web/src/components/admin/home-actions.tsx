import { Fragment, Suspense, lazy, useState } from 'react'
import { useNavigate, useRouteContext } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronDownIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { adminQueries } from '@/lib/client/queries/admin'
import { homeActionGroups, type HomeActionId } from '@/lib/shared/admin-home'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import type { TicketId } from '@quackback/ids'

const CreatePostDialog = lazy(() =>
  import('@/components/admin/feedback/create-post-dialog').then((module) => ({
    default: module.CreatePostDialog,
  }))
)
const CreateChangelogDialog = lazy(() =>
  import('@/components/admin/changelog/create-changelog-dialog').then((module) => ({
    default: module.CreateChangelogDialog,
  }))
)
const CreateArticleDialog = lazy(() =>
  import('@/components/admin/help-center/create-article-dialog').then((module) => ({
    default: module.CreateArticleDialog,
  }))
)
const NewConversationDialog = lazy(() =>
  import('@/components/admin/conversation/new-conversation-dialog').then((module) => ({
    default: module.NewConversationDialog,
  }))
)
const CreateTicketDialog = lazy(() =>
  import('@/components/admin/inbox/create-ticket-dialog').then((module) => ({
    default: module.CreateTicketDialog,
  }))
)
const ReportIncidentDialog = lazy(() =>
  import('@/components/admin/status/status-report-incident-dialog').then((module) => ({
    default: module.ReportIncidentDialog,
  }))
)

export function HomeActions({ flags }: { flags: Partial<FeatureFlags> | undefined }) {
  const groups = homeActionGroups(flags)
  const [action, setAction] = useState<HomeActionId | null>(null)
  const close = () => setAction(null)

  if (groups.length === 0) return null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            Actions
            <ChevronDownIcon className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {groups.map((group, index) => (
            <Fragment key={group.productId}>
              {index > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </DropdownMenuLabel>
                {group.actions.map((item) => (
                  <DropdownMenuItem key={item.id} onClick={() => setAction(item.id)}>
                    {item.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {action ? (
        <Suspense fallback={null}>
          {action === 'new-post' ? <HomeCreatePost onClose={close} /> : null}
          {action === 'new-changelog' ? (
            <CreateChangelogDialog open onOpenChange={(open) => !open && close()} />
          ) : null}
          {action === 'new-conversation' ? (
            <NewConversationDialog open onOpenChange={(open) => !open && close()} />
          ) : null}
          {action === 'new-ticket' ? <HomeCreateTicket onClose={close} /> : null}
          {action === 'new-article' ? (
            <CreateArticleDialog open onOpenChange={(open) => !open && close()} />
          ) : null}
          {action === 'report-incident' ? (
            <ReportIncidentDialog open onOpenChange={(open) => !open && close()} />
          ) : null}
        </Suspense>
      ) : null}
    </>
  )
}

function HomeCreatePost({ onClose }: { onClose: () => void }) {
  const { user, principal } = useRouteContext({ from: '/admin' })
  const boards = useQuery(adminQueries.boards())
  const tags = useQuery(adminQueries.tags())
  const statuses = useQuery(adminQueries.statuses())

  if (!user || !principal || !boards.data || !tags.data || !statuses.data) return null

  return (
    <CreatePostDialog
      open
      onOpenChange={(open) => !open && onClose()}
      boards={boards.data}
      tags={tags.data}
      statuses={statuses.data}
      currentUser={{
        name: user.name,
        email: user.email ?? '',
        principalId: principal.id,
      }}
    />
  )
}

function HomeCreateTicket({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  return (
    <CreateTicketDialog
      open
      onOpenChange={(open) => !open && onClose()}
      onCreated={(id: TicketId) => {
        void navigate({ to: '/admin/inbox', search: { i: id } })
      }}
    />
  )
}
