import type { QueryClient } from '@tanstack/react-query'
import type { AgentConversationMessageDTO, ConversationDTO } from '@/lib/shared/conversation/types'
import type { InboxItemDTO } from '@/lib/shared/inbox/items'
import { conversationKeys } from '@/lib/client/queries/conversation-keys'
import { inboxKeys } from '@/lib/client/queries/inbox'

type ThreadCache = {
  conversation: ConversationDTO
  messages: AgentConversationMessageDTO[]
  hasMore?: boolean
}

type LegacyListCache = {
  conversations: ConversationDTO[]
  [key: string]: unknown
}

type UnifiedListCache = {
  items: InboxItemDTO[]
  cursor: string | null
}

function membershipFingerprint(c: ConversationDTO): string {
  const tagIds = [...c.tags.map((t) => t.id)].sort().join(',')
  return [
    c.status,
    c.assignedAgent?.principalId ?? '',
    c.assignedTeamId ?? '',
    c.snoozedUntil ?? '',
    tagIds,
  ].join('|')
}

function findConversation(caches: LegacyListCache[], id: string): ConversationDTO | undefined {
  for (const cache of caches) {
    const found = cache.conversations.find((c) => c.id === id)
    if (found) return found
  }
  return undefined
}

function patchLegacyList(prev: LegacyListCache, dto: ConversationDTO): LegacyListCache {
  if (!prev.conversations.some((c) => c.id === dto.id)) return prev
  return {
    ...prev,
    conversations: prev.conversations.map((c) => (c.id === dto.id ? dto : c)),
  }
}

function patchUnifiedItems(prev: UnifiedListCache, dto: ConversationDTO): UnifiedListCache {
  if (!prev.items.some((it) => it.kind === 'conversation' && it.conversation.id === dto.id)) {
    return prev
  }
  return {
    ...prev,
    items: prev.items.map((it) =>
      it.kind === 'conversation' && it.conversation.id === dto.id
        ? { ...it, conversation: dto }
        : it
    ),
  }
}

export function upsertConversationEntity(
  queryClient: QueryClient,
  dto: ConversationDTO
): { membershipChanged: boolean } {
  const thread = queryClient.getQueryData<ThreadCache>(conversationKeys.agentThread(dto.id))
  const legacyCaches = queryClient.getQueriesData<LegacyListCache>({
    queryKey: conversationKeys.agentConversations(),
  })
  const prev =
    thread?.conversation ??
    findConversation(
      legacyCaches.map(([, data]) => data).filter((d) => d !== undefined),
      dto.id
    )
  const membershipChanged = !prev || membershipFingerprint(prev) !== membershipFingerprint(dto)

  if (thread) {
    queryClient.setQueryData<ThreadCache>(conversationKeys.agentThread(dto.id), {
      ...thread,
      conversation: dto,
    })
  }
  queryClient.setQueriesData<LegacyListCache>(
    { queryKey: conversationKeys.agentConversations() },
    (prevCache) => (prevCache ? patchLegacyList(prevCache, dto) : prevCache)
  )
  queryClient.setQueriesData<UnifiedListCache>({ queryKey: inboxKeys.items() }, (prevCache) =>
    prevCache ? patchUnifiedItems(prevCache, dto) : prevCache
  )
  return { membershipChanged }
}
