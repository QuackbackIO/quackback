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
import type { TicketId, TicketStatusId } from '@quackback/ids'
import type { ConversationPriority } from '@/lib/shared/db-types'
import type { TicketDTO, CreateTicketInput } from '@/lib/server/domains/tickets'
import {
  setTicketStatusFn,
  assignTicketFn,
  setTicketPriorityFn,
  createTicketFn,
} from '@/lib/server/functions/tickets'
import { ticketKeys } from '@/lib/client/queries/inbox'

/** Seed the detail cache with the fresh ticket and refresh every list. */
function applyTicket(queryClient: QueryClient, ticket: TicketDTO) {
  queryClient.setQueryData(ticketKeys.detail(ticket.id), ticket)
  void queryClient.invalidateQueries({ queryKey: ticketKeys.lists() })
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
          priority: input.priority,
          companyId: input.companyId ?? undefined,
        },
      }),
    onSuccess: (ticket) => applyTicket(queryClient, ticket),
  })
}
