import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  listMyTicketsFn,
  getMyTicketFn,
  replyToMyTicketFn,
  createMyTicketFn,
} from '@/lib/server/functions/portal-tickets'
import type { TicketId } from '@quackback/ids'
import type { JSONContent } from '@tiptap/react'

export type PortalStatusCategory = 'open' | 'pending' | 'on_hold' | 'solved' | 'closed'

export interface PortalTicketRow {
  id: TicketId
  subject: string
  statusName: string
  statusCategory: PortalStatusCategory
  statusColor: string | null
  lastActivityAt: Date
  createdAt: Date
}

/**
 * Query factories for the portal tickets surface.
 *
 * Keys are flat tuples so list invalidation can use a prefix match. Server
 * responses use ISO date strings; we revive into `Date` here so components
 * can call `formatDistanceToNow` directly.
 */
export const portalTicketQueries = {
  list: (params: { statusCategory?: PortalStatusCategory } = {}) =>
    queryOptions({
      queryKey: ['portal', 'tickets', 'list', params.statusCategory ?? 'all'] as const,
      queryFn: async () => {
        const data = await listMyTicketsFn({
          data: { statusCategory: params.statusCategory },
        })
        return {
          rows: data.rows.map(
            (r): PortalTicketRow => ({
              id: r.id,
              subject: r.subject,
              statusName: r.statusName,
              statusCategory: r.statusCategory,
              statusColor: r.statusColor,
              lastActivityAt: new Date(r.lastActivityAt),
              createdAt: new Date(r.createdAt),
            })
          ),
          total: data.total,
        }
      },
    }),

  detail: (ticketId: TicketId) =>
    queryOptions({
      queryKey: ['portal', 'tickets', 'detail', ticketId] as const,
      queryFn: async () => {
        const data = await getMyTicketFn({ data: { ticketId } })
        return {
          ticket: {
            ...data.ticket,
            createdAt: new Date(data.ticket.createdAt),
            lastActivityAt: new Date(data.ticket.lastActivityAt),
          },
          threads: data.threads.map((t) => ({
            ...t,
            ticketId,
            createdAt: new Date(t.createdAt),
            editedAt: t.editedAt ? new Date(t.editedAt) : null,
          })),
          principalNames: data.principalNames,
          viewerPrincipalId: data.viewerPrincipalId,
          viewerRelationship: data.viewerRelationship,
        }
      },
    }),
}

/**
 * Reply mutation. Invalidates both the affected detail key and the entire
 * tickets-list namespace so any visible status filter refreshes.
 */
export function useReplyToMyTicket(ticketId: TicketId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { bodyJson?: unknown; bodyText?: string | null }) =>
      replyToMyTicketFn({
        data: {
          ticketId,
          bodyJson: (input.bodyJson ?? null) as { type: 'doc'; content?: unknown[] } | null,
          bodyText: input.bodyText ?? null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal', 'tickets', 'detail', ticketId] })
      qc.invalidateQueries({ queryKey: ['portal', 'tickets', 'list'] })
      toast.success('Reply sent')
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to send reply'),
  })
}

export function useCreateMyTicket() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      subject: string
      descriptionJson?: JSONContent | null
      descriptionText?: string | null
      priority?: 'low' | 'normal' | 'high' | 'urgent'
    }) =>
      createMyTicketFn({
        data: {
          subject: input.subject,
          descriptionJson: (input.descriptionJson ?? null) as {
            type: 'doc'
            content?: unknown[]
          } | null,
          descriptionText: input.descriptionText ?? null,
          priority: input.priority,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal', 'tickets', 'list'] })
      toast.success('Ticket created')
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to create ticket'),
  })
}
