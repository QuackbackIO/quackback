/**
 * Ticket mutation hooks (support platform §4.2, folded into the unified inbox
 * at UNIFIED-INBOX-SPEC.md M6): status, assignment, priority, and create. Each
 * writes the returned ticket into its detail cache for a snappy update and
 * invalidates every ticket list so the row reflects the change.
 *
 * Formerly `lib/client/mutations/tickets.ts` — cache keys are unchanged so
 * existing invalidations keep matching.
 */
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { TicketId, TicketStatusId, PrincipalId } from '@quackback/ids'
import type { ConversationPriority } from '@/lib/shared/db-types'
import type { TicketDTO, CreateTicketInput } from '@/lib/server/domains/tickets'
import type { TicketWatchStatus } from '@/lib/server/domains/tickets/ticket-subscription.service'
import {
  setTicketStatusFn,
  assignTicketFn,
  setTicketPriorityFn,
  createTicketFn,
  watchTicketFn,
  unwatchTicketFn,
  muteTicketFn,
  unmuteTicketFn,
  adminAddTicketWatcherFn,
  adminRemoveTicketWatcherFn,
} from '@/lib/server/functions/tickets'
import { ticketKeys } from '@/lib/client/queries/inbox'

/** Seed the detail cache with the fresh ticket and refresh every list. */
function applyTicket(queryClient: QueryClient, ticket: TicketDTO) {
  queryClient.setQueryData(ticketKeys.detail(ticket.id), ticket)
  void queryClient.invalidateQueries({ queryKey: ticketKeys.lists() })
  // The write just appended to the ticket's activity timeline; refetch it so
  // the detail panel's Activity section reflects the change immediately.
  void queryClient.invalidateQueries({ queryKey: ['activity', 'ticket', ticket.id] })
}

export function useSetTicketStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { ticketId: TicketId; statusId: TicketStatusId }) =>
      setTicketStatusFn({ data: vars }),
    onSuccess: (ticket) => applyTicket(queryClient, ticket),
  })
}

/** Independent assignment: an absent field leaves that side unchanged. */
export function useAssignTicket() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: {
      ticketId: TicketId
      assigneePrincipalId?: string | null
      assigneeTeamId?: string | null
    }) => assignTicketFn({ data: vars }),
    onSuccess: (ticket) => applyTicket(queryClient, ticket),
  })
}

export function useSetTicketPriority() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { ticketId: TicketId; priority: ConversationPriority }) =>
      setTicketPriorityFn({ data: vars }),
    onSuccess: (ticket) => applyTicket(queryClient, ticket),
  })
}

export function useCreateTicket() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateTicketInput) =>
      createTicketFn({
        data: {
          type: input.type,
          title: input.title,
          description: input.description,
          descriptionJson: input.descriptionJson,
          attachments: input.attachments,
          requesterPrincipalId: input.requesterPrincipalId ?? undefined,
          assigneePrincipalId: input.assigneePrincipalId ?? undefined,
          conversationId: input.sourceConversationId ?? undefined,
          priority: input.priority,
          companyId: input.companyId ?? undefined,
        },
      }),
    onSuccess: (ticket) => applyTicket(queryClient, ticket),
  })
}

// ---------------------------------------------------------------------------
// Ticket watchers (subscriptions). The self-service mutations (watch/unwatch/
// mute/unmute) optimistically write `ticketKeys.watch(id)` so the watch
// control's trigger updates instantly, then settle with an invalidate to
// reconcile with the server's `mutedUntil` timestamp. The admin roster
// mutations (add/remove another watcher) have no useful optimistic shape —
// they just invalidate the watcher list (and, for remove, the watch status,
// since removing yourself changes it).
// ---------------------------------------------------------------------------

/**
 * Shared optimistic mutation for a principal's own watch status: cancel inflight
 * fetches, snapshot for rollback, write the computed next status, roll back on
 * error, and reconcile with the server's `mutedUntil` on settle. `computeNext`
 * derives the optimistic value from the current cache (and the mutation vars).
 */
function useWatchStatusMutation<V extends { ticketId: TicketId }>(
  mutationFn: (vars: V) => Promise<unknown>,
  computeNext: (previous: TicketWatchStatus | undefined, vars: V) => TicketWatchStatus
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onMutate: async (vars: V) => {
      const queryKey = ticketKeys.watch(vars.ticketId)
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<TicketWatchStatus>(queryKey)
      queryClient.setQueryData<TicketWatchStatus>(queryKey, computeNext(previous, vars))
      return { previous }
    },
    onError: (_err, vars, context) => {
      if (context?.previous)
        queryClient.setQueryData(ticketKeys.watch(vars.ticketId), context.previous)
    },
    onSettled: (_data, _err, vars) => {
      void queryClient.invalidateQueries({ queryKey: ticketKeys.watch(vars.ticketId) })
    },
  })
}

export function useWatchTicket() {
  return useWatchStatusMutation(
    (vars: { ticketId: TicketId }) => watchTicketFn({ data: vars }),
    () => ({ watching: true, reason: 'manual', mutedUntil: null })
  )
}

export function useUnwatchTicket() {
  return useWatchStatusMutation(
    (vars: { ticketId: TicketId }) => unwatchTicketFn({ data: vars }),
    () => ({ watching: false, reason: null, mutedUntil: null })
  )
}

/** Mute for `days` (default 7, mirroring the server fn's default). */
export function useMuteTicket() {
  return useWatchStatusMutation(
    (vars: { ticketId: TicketId; days?: number }) =>
      muteTicketFn({ data: { ticketId: vars.ticketId, days: vars.days ?? 7 } }),
    (previous, vars) => ({
      watching: previous?.watching ?? true,
      reason: previous?.reason ?? 'manual',
      mutedUntil: new Date(Date.now() + (vars.days ?? 7) * 24 * 60 * 60 * 1000),
    })
  )
}

export function useUnmuteTicket() {
  return useWatchStatusMutation(
    (vars: { ticketId: TicketId }) => unmuteTicketFn({ data: vars }),
    (previous) => ({
      watching: previous?.watching ?? true,
      reason: previous?.reason ?? 'manual',
      mutedUntil: null,
    })
  )
}

/** Admin: add another principal (a team member) as a manual watcher. Also
 *  invalidates watch status — the added principal may be the caller themself
 *  (the picker offers any not-yet-watching team member), which changes their
 *  own watch state. */
export function useAdminAddTicketWatcher() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { ticketId: TicketId; principalId: PrincipalId }) =>
      adminAddTicketWatcherFn({ data: vars }),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: ticketKeys.watchers(vars.ticketId) })
      void queryClient.invalidateQueries({ queryKey: ticketKeys.watch(vars.ticketId) })
    },
  })
}

/** Admin: remove another watcher. Also invalidates watch status — the removed
 *  principal may be the caller themself, which changes their own watch state. */
export function useAdminRemoveTicketWatcher() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { ticketId: TicketId; principalId: PrincipalId }) =>
      adminRemoveTicketWatcherFn({ data: vars }),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: ticketKeys.watchers(vars.ticketId) })
      void queryClient.invalidateQueries({ queryKey: ticketKeys.watch(vars.ticketId) })
    },
  })
}
