/**
 * TanStack Query factory for inbox admin reads. Mirrors `ticketQueries`:
 * route loaders pre-fetch via `ensureQueryData`; components read via
 * `useSuspenseQuery`.
 */
import { queryOptions } from '@tanstack/react-query'
import type { InboxId } from '@quackback/ids'
import {
  listInboxesFn,
  getInboxFn,
  listInboxChannelsFn,
  listInboxMembershipsFn,
} from '@/lib/server/functions/inboxes'

export const inboxQueries = {
  list: (params: { includeArchived?: boolean } = {}) =>
    queryOptions({
      queryKey: ['inboxes', 'list', params] as const,
      queryFn: () => listInboxesFn({ data: params }),
      staleTime: 30_000,
    }),
  detail: (inboxId: InboxId) =>
    queryOptions({
      queryKey: ['inboxes', 'detail', inboxId] as const,
      queryFn: () => getInboxFn({ data: { inboxId } }),
      staleTime: 30_000,
    }),
  channels: (inboxId: InboxId) =>
    queryOptions({
      queryKey: ['inboxes', 'channels', inboxId] as const,
      queryFn: () => listInboxChannelsFn({ data: { inboxId } }),
      staleTime: 30_000,
    }),
  memberships: (inboxId: InboxId) =>
    queryOptions({
      queryKey: ['inboxes', 'memberships', inboxId] as const,
      queryFn: () => listInboxMembershipsFn({ data: { inboxId } }),
      staleTime: 30_000,
    }),
}
