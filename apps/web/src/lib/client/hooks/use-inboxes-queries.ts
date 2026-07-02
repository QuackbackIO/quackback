/**
 * Inboxes query hooks.
 */
import { useQuery } from '@tanstack/react-query'
import type { InboxId } from '@quackback/ids'
import {
  listInboxesFn,
  getInboxFn,
  listInboxChannelsFn,
  listInboxMembershipsFn,
  listMyInboxesFn,
} from '@/lib/server/functions/inboxes'

export const inboxesKeys = {
  all: ['inboxes'] as const,
  lists: () => [...inboxesKeys.all, 'list'] as const,
  list: (filters: { includeArchived?: boolean }) => [...inboxesKeys.lists(), filters] as const,
  myList: () => [...inboxesKeys.all, 'mine'] as const,
  detail: (id: InboxId) => [...inboxesKeys.all, 'detail', id] as const,
  channels: (id: InboxId) => [...inboxesKeys.all, 'channels', id] as const,
  memberships: (id: InboxId) => [...inboxesKeys.all, 'memberships', id] as const,
}

export function useInboxes(opts: { includeArchived?: boolean; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: inboxesKeys.list({ includeArchived: opts.includeArchived }),
    queryFn: () => listInboxesFn({ data: { includeArchived: opts.includeArchived } }),
    enabled: opts.enabled ?? true,
    staleTime: 60_000,
  })
}

export function useMyInboxes(enabled = true) {
  return useQuery({
    queryKey: inboxesKeys.myList(),
    queryFn: () => listMyInboxesFn(),
    enabled,
    staleTime: 60_000,
  })
}

export function useInbox(inboxId: InboxId | null | undefined) {
  return useQuery({
    queryKey: inboxId ? inboxesKeys.detail(inboxId) : ['inboxes', 'detail', 'none'],
    queryFn: () => getInboxFn({ data: { inboxId: inboxId! } }),
    enabled: !!inboxId,
    staleTime: 60_000,
  })
}

export function useInboxChannels(inboxId: InboxId | null | undefined) {
  return useQuery({
    queryKey: inboxId ? inboxesKeys.channels(inboxId) : ['inboxes', 'channels', 'none'],
    queryFn: () => listInboxChannelsFn({ data: { inboxId: inboxId! } }),
    enabled: !!inboxId,
    staleTime: 30_000,
  })
}

export function useInboxMemberships(inboxId: InboxId | null | undefined) {
  return useQuery({
    queryKey: inboxId ? inboxesKeys.memberships(inboxId) : ['inboxes', 'memberships', 'none'],
    queryFn: () => listInboxMembershipsFn({ data: { inboxId: inboxId! } }),
    enabled: !!inboxId,
    staleTime: 30_000,
  })
}
