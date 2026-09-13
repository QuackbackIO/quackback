import { describe, it, expect } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import type { ConversationId } from '@quackback/ids'
import type { ConversationDTO } from '@/lib/shared/conversation/types'
import type { InboxItemDTO } from '@/lib/shared/inbox/items'
import { conversationKeys } from '@/lib/client/queries/conversation-keys'
import { inboxKeys } from '@/lib/client/queries/inbox'
import { upsertConversationEntity } from '../conversation-entities'

function dto(overrides: Partial<ConversationDTO> = {}): ConversationDTO {
  return {
    id: 'conversation_01JTEST' as ConversationId,
    status: 'open',
    priority: 'none',
    lastMessagePreview: 'hello',
    lastMessageAt: '2026-01-01T00:00:00.000Z',
    unreadCount: 1,
    assignedAgent: null,
    assignedTeamId: null,
    snoozedUntil: null,
    tags: [],
    ...overrides,
  } as ConversationDTO
}

function legacyList(conversations: ConversationDTO[]) {
  return { conversations, searchSnippets: {}, hasMore: false }
}

function unifiedList(items: InboxItemDTO[]) {
  return { items, cursor: null }
}

function conversationItem(c: ConversationDTO): InboxItemDTO {
  return { kind: 'conversation', conversation: c, linkedTicket: null, searchSnippet: null }
}

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

describe('upsertConversationEntity', () => {
  it('patches the thread header and every list row holding the conversation', () => {
    const qc = client()
    const before = dto()
    const other = dto({ id: 'conversation_01JOTHER' as ConversationId })
    qc.setQueryData(conversationKeys.agentThread(before.id), {
      conversation: before,
      messages: [],
      hasMore: false,
    })
    qc.setQueryData(
      conversationKeys.agentConversationList('view:all', 'open', 'all', ''),
      legacyList([before, other])
    )
    qc.setQueryData(inboxKeys.item('open|conversation'), unifiedList([conversationItem(before)]))

    const after = dto({ lastMessagePreview: 'updated', unreadCount: 0 })
    const { membershipChanged } = upsertConversationEntity(qc, after)

    expect(membershipChanged).toBe(false)
    expect(
      qc.getQueryData<{ conversation: ConversationDTO }>(conversationKeys.agentThread(before.id))
        ?.conversation.lastMessagePreview
    ).toBe('updated')
    const list = qc.getQueryData<{ conversations: ConversationDTO[] }>(
      conversationKeys.agentConversationList('view:all', 'open', 'all', '')
    )
    expect(list?.conversations.map((c) => c.lastMessagePreview)).toEqual(['updated', 'hello'])
    expect(list?.conversations[1]).toBe(other)
    const unified = qc.getQueryData<{ items: InboxItemDTO[] }>(inboxKeys.item('open|conversation'))
    const row = unified?.items[0]
    expect(row?.kind === 'conversation' && row.conversation.unreadCount).toBe(0)
  })

  it('reports a membership change when status, priority, assignee, team, tags, snooze, or sla move', () => {
    const qc = client()
    const before = dto()
    qc.setQueryData(
      conversationKeys.agentConversationList('view:all', 'open', 'all', ''),
      legacyList([before])
    )

    expect(upsertConversationEntity(qc, dto({ status: 'closed' })).membershipChanged).toBe(true)
    expect(upsertConversationEntity(qc, dto({ priority: 'urgent' })).membershipChanged).toBe(true)
    expect(
      upsertConversationEntity(
        qc,
        dto({
          assignedAgent: {
            principalId: 'principal_1',
            displayName: 'Maya',
            avatarUrl: null,
          } as ConversationDTO['assignedAgent'],
        })
      ).membershipChanged
    ).toBe(true)
    expect(upsertConversationEntity(qc, dto({ assignedTeamId: 'team_1' })).membershipChanged).toBe(
      true
    )
    expect(
      upsertConversationEntity(qc, dto({ snoozedUntil: '2026-02-01T00:00:00.000Z' }))
        .membershipChanged
    ).toBe(true)
    expect(
      upsertConversationEntity(
        qc,
        dto({
          tags: [
            { id: 'conversation_tag_1', name: 'VIP', color: 'red' },
          ] as ConversationDTO['tags'],
        })
      ).membershipChanged
    ).toBe(true)
    expect(
      upsertConversationEntity(
        qc,
        dto({
          sla: {
            policyId: 'policy_1',
            policyName: 'Standard',
            appliedAt: '2026-01-01T00:00:00.000Z',
            firstResponseDueAt: null,
            firstResponseAt: null,
            nextResponseDueAt: '2026-01-02T00:00:00.000Z',
            timeToCloseDueAt: null,
            resolvedAt: null,
          } as ConversationDTO['sla'],
        })
      ).membershipChanged
    ).toBe(true)
  })

  it('reports a membership change when nothing cached the conversation yet', () => {
    expect(upsertConversationEntity(client(), dto()).membershipChanged).toBe(true)
  })

  it('leaves caches without the conversation untouched by reference', () => {
    const qc = client()
    const list = legacyList([dto({ id: 'conversation_01JOTHER' as ConversationId })])
    qc.setQueryData(conversationKeys.agentConversationList('view:all', 'open', 'all', ''), list)

    upsertConversationEntity(qc, dto({ lastMessagePreview: 'updated' }))

    expect(
      qc.getQueryData(conversationKeys.agentConversationList('view:all', 'open', 'all', ''))
    ).toBe(list)
  })
})
