/**
 * Ticket detail page.
 *
 * Layout: full-width, no queue sidebar (handled at parent route). Top row =
 * <TicketDetailHeader>. Below: left column = thread feed + composer; right
 * column = tabs (Properties / Participants / Shares / SLA / Activity). All
 * mutations live inside the per-tab components.
 */
import { Suspense, useCallback, useMemo } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { createRouteErrorComponent } from '@/components/admin/shared'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import type { JSONContent } from '@tiptap/react'
import type { TicketId, TeamId } from '@quackback/ids'
import { ticketQueries } from '@/lib/client/queries/tickets'
import { updateTicketFn } from '@/lib/server/functions/tickets'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { useMyPermissions } from '@/lib/client/hooks/use-authz-queries'
import type { MyPermissionsResult } from '@/lib/server/functions/authz'
import { TicketDetailHeader } from '@/components/admin/tickets/ticket-detail-header'
import { TicketThreadFeed } from '@/components/admin/tickets/ticket-thread-feed'
import { TicketThreadComposer } from '@/components/admin/tickets/ticket-thread-composer'
import { TicketPropertiesPanel } from '@/components/admin/tickets/ticket-properties-panel'
import { TicketParticipantsList } from '@/components/admin/tickets/ticket-participants-list'
import { TicketSharesPanel } from '@/components/admin/tickets/ticket-shares-panel'
import { TicketSlaPanel } from '@/components/admin/tickets/ticket-sla-panel'
import { TicketActivityTimeline } from '@/components/admin/tickets/ticket-activity-timeline'
import { handleTicketConflict } from '@/lib/client/utils/handle-ticket-conflict'
import { toast } from 'sonner'

export const Route = createFileRoute('/admin/tickets/$ticketId')({
  loader: async ({ params, context }) => {
    const { queryClient } = context as {
      queryClient: import('@tanstack/react-query').QueryClient
    }
    const ticketId = params.ticketId as TicketId
    await Promise.all([
      queryClient.ensureQueryData(ticketQueries.detail(ticketId)),
      queryClient.ensureQueryData(ticketQueries.threads(ticketId)),
      queryClient.ensureQueryData(ticketQueries.participants(ticketId)),
      queryClient.ensureQueryData(ticketQueries.shares(ticketId)),
      queryClient.ensureQueryData(ticketQueries.statuses()),
    ])
  },
  errorComponent: createRouteErrorComponent('Failed to load ticket'),
  component: TicketDetailPage,
})

function hasAnyPermission(
  perms: ReturnType<typeof useMyPermissions>['data'] | undefined,
  key: string
): boolean {
  if (!perms) return false
  if (perms.workspacePermissions.includes(key as never)) return true
  return perms.teamPermissions.some((tp) => tp.permissions.includes(key as never))
}

function hasTicketResourcePermission(
  perms: MyPermissionsResult | undefined,
  key: string,
  resource: {
    primaryTeamId: TeamId | null
    assigneeTeamId: TeamId | null
    sharedTeamIds: readonly TeamId[]
  }
): boolean {
  if (!perms) return false
  if (perms.workspacePermissions.includes(key as never)) return true
  return perms.teamPermissions.some((tp) => {
    if (!tp.permissions.includes(key as never)) return false
    return (
      tp.teamId === resource.primaryTeamId ||
      tp.teamId === resource.assigneeTeamId ||
      resource.sharedTeamIds.includes(tp.teamId)
    )
  })
}

function TicketDetailPage() {
  const { ticketId: rawId } = Route.useParams()
  const ticketId = rawId as TicketId
  const qc = useQueryClient()

  const { data: ticket } = useSuspenseQuery(ticketQueries.detail(ticketId))
  const { data: threads } = useSuspenseQuery(ticketQueries.threads(ticketId))
  const { data: participants } = useSuspenseQuery(ticketQueries.participants(ticketId))
  const { data: shares } = useSuspenseQuery(ticketQueries.shares(ticketId))
  const perms = useMyPermissions()
  const principalNames = useMemo(() => {
    const names: Record<string, string> = {}
    for (const thread of threads) {
      if (!thread.principalId) continue
      names[thread.principalId] = thread.principalName?.trim() || 'Unknown'
    }
    return names
  }, [threads])

  const currentPrincipalId = perms.data?.principalId ?? ticket.assigneePrincipalId ?? ticket.id
  const canPublic = hasAnyPermission(perms.data, 'ticket.reply_public')
  const canInternal = hasAnyPermission(perms.data, 'ticket.comment_internal')
  const canShared = hasAnyPermission(perms.data, 'ticket.share_cross_team')
  const sharedTeamIds = shares.map((s) => s.teamId as TeamId)
  const canEditDescription = hasTicketResourcePermission(perms.data, 'ticket.edit_fields', {
    primaryTeamId: ticket.primaryTeamId as TeamId | null,
    assigneeTeamId: ticket.assigneeTeamId as TeamId | null,
    sharedTeamIds,
  })

  const invalidateTicket = useCallback(() => {
    qc.invalidateQueries({ queryKey: ticketQueries.detail(ticketId).queryKey })
    qc.invalidateQueries({ queryKey: ticketQueries.activity(ticketId).queryKey })
    qc.invalidateQueries({ queryKey: ['tickets', 'list'] })
  }, [qc, ticketId])

  const descriptionMutation = useMutation({
    mutationFn: (patch: { descriptionJson: JSONContent | null; descriptionText: string | null }) =>
      updateTicketFn({
        data: {
          ticketId,
          expectedUpdatedAt: new Date(ticket.updatedAt).toISOString(),
          descriptionJson: patch.descriptionJson as { type: 'doc'; content?: unknown[] } | null,
          descriptionText: patch.descriptionText,
        },
      }),
    onSuccess: () => {
      invalidateTicket()
      toast.success('Description updated')
    },
    onError: (error) => handleTicketConflict(error, qc, ticketId),
  })

  const handleDescriptionUpdate = useCallback(
    (descriptionJson: JSONContent | null, descriptionText: string | null) => {
      descriptionMutation.mutate({ descriptionJson, descriptionText })
    },
    [descriptionMutation]
  )

  return (
    <div className="flex h-full flex-col">
      <TicketDetailHeader
        ticket={{
          id: ticket.id,
          subject: ticket.subject,
          channel: ticket.channel,
          priority: ticket.priority,
          visibilityScope: ticket.visibilityScope,
          updatedAt: ticket.updatedAt,
          assigneePrincipalId: ticket.assigneePrincipalId,
        }}
        currentPrincipalId={currentPrincipalId as never}
      />

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 flex flex-col min-w-0 border-r border-border/50">
          <div className="flex-1 overflow-auto p-4">
            <TicketThreadFeed
              threads={threads.map((t) => ({
                id: t.id,
                ticketId: t.ticketId,
                principalId: t.principalId,
                audience: t.audience as 'public' | 'internal' | 'shared_team',
                bodyJson: t.bodyJson,
                bodyText: t.bodyText,
                sharedWithTeamId: t.sharedWithTeamId,
                createdAt: t.createdAt,
                editedAt: t.editedAt,
              }))}
              principalNames={principalNames}
              description={
                ticket.descriptionText || ticket.descriptionJson
                  ? { text: ticket.descriptionText, json: ticket.descriptionJson }
                  : null
              }
              onDescriptionUpdate={canEditDescription ? handleDescriptionUpdate : undefined}
              isDescriptionSaving={descriptionMutation.isPending}
            />
          </div>
          <TicketThreadComposer
            ticketId={ticketId}
            canPublic={canPublic}
            canInternal={canInternal}
            canShared={canShared}
          />
        </div>

        <aside className="w-80 shrink-0 overflow-hidden bg-background xl:w-96">
          <Tabs defaultValue="properties" className="flex h-full min-h-0 flex-col gap-0">
            <div className="shrink-0 border-b border-border/50 px-3 py-2">
              <TabsList className="grid h-8 w-full grid-cols-5 rounded-md bg-muted/30 p-0.5">
                <TabsTrigger value="properties" className="min-w-0 px-1.5 text-xs">
                  Properties
                </TabsTrigger>
                <TabsTrigger value="participants" className="min-w-0 px-1.5 text-xs">
                  People
                </TabsTrigger>
                <TabsTrigger value="shares" className="min-w-0 px-1.5 text-xs">
                  Shares
                </TabsTrigger>
                <TabsTrigger value="sla" className="min-w-0 px-1.5 text-xs">
                  SLA
                </TabsTrigger>
                <TabsTrigger value="activity" className="min-w-0 px-1.5 text-xs">
                  Activity
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="properties" className="m-0 min-h-0 overflow-auto p-4">
              <TicketPropertiesPanel
                ticket={{
                  id: ticket.id,
                  subject: ticket.subject,
                  statusId: ticket.statusId,
                  priority: ticket.priority,
                  visibilityScope: ticket.visibilityScope,
                  primaryTeamId: ticket.primaryTeamId,
                  inboxId: ticket.inboxId,
                  organizationId: ticket.organizationId,
                  requesterContactId: ticket.requesterContactId,
                  assigneePrincipalId: ticket.assigneePrincipalId,
                  updatedAt: ticket.updatedAt,
                }}
              />
            </TabsContent>
            <TabsContent value="participants" className="m-0 min-h-0 overflow-auto p-4">
              <TicketParticipantsList
                ticketId={ticketId}
                participants={participants.map((p) => ({
                  id: p.id,
                  ticketId: p.ticketId,
                  principalId: p.principalId,
                  contactId: p.contactId,
                  role: p.role,
                }))}
              />
            </TabsContent>
            <TabsContent value="shares" className="m-0 min-h-0 overflow-auto p-4">
              <TicketSharesPanel
                ticketId={ticketId}
                shares={shares.map((s) => ({
                  id: s.id,
                  ticketId: s.ticketId,
                  teamId: s.teamId,
                  accessLevel: s.accessLevel,
                }))}
                canShare={canShared}
              />
            </TabsContent>
            <TabsContent value="sla" className="m-0 min-h-0 overflow-auto p-4">
              <Suspense fallback={<Skeleton className="h-24 w-full" />}>
                <TicketSlaPanel ticketId={ticketId} />
              </Suspense>
            </TabsContent>
            <TabsContent value="activity" className="m-0 min-h-0 overflow-auto p-4">
              <Suspense fallback={<Skeleton className="h-24 w-full" />}>
                <TicketActivityTimeline ticketId={ticketId} />
              </Suspense>
            </TabsContent>
          </Tabs>
        </aside>
      </div>
    </div>
  )
}
