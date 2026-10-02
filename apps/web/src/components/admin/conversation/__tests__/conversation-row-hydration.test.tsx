// @vitest-environment happy-dom
/**
 * A row's age ("3m") is worked out on the server and again as the inbox
 * hydrates, and the two can fall either side of a whole minute. That must not
 * surface as a hydration error; the age settles on the browser's value once
 * mounted.
 */
import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConversationId, PrincipalId } from '@quackback/ids'
import type { ConversationDTO } from '@/lib/shared/conversation/types'
import type { InboxItemDTO } from '@/lib/shared/inbox/items'
import { ConversationRow } from '../conversation-list-column'

const LAST_MESSAGE_AT = '2026-10-01T03:30:37.700Z'

const conversation: Partial<ConversationDTO> = {
  id: 'conversation_01JTEST' as ConversationId,
  status: 'open',
  priority: 'none',
  channel: 'messenger',
  subject: null,
  lastMessagePreview: 'Where is my order?',
  lastMessageAt: LAST_MESSAGE_AT,
  createdAt: LAST_MESSAGE_AT,
  visitor: {
    principalId: 'principal_visitor' as PrincipalId,
    displayName: 'Rita Visitor',
    avatarUrl: null,
  },
  assignedAgent: null,
  unreadCount: 0,
  visitorLastReadAt: null,
  agentLastReadAt: null,
  csatRating: null,
  visitorEmail: null,
  resolvedAt: null,
  endReason: null,
  endNote: null,
  snoozedUntil: null,
  tags: [],
}

const item: Extract<InboxItemDTO, { kind: 'conversation' }> = {
  kind: 'conversation',
  conversation: conversation as ConversationDTO,
  linkedTicket: null,
  searchSnippet: null,
}

const row = () => (
  <ConversationRow item={item} id={item.conversation.id} selected={false} onSelect={() => {}} />
)

afterEach(() => vi.useRealTimers())

describe('ConversationRow hydration', () => {
  it('hydrates without error when the age ticked over since the server render', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // 3 minutes 59.9 seconds after the last message: the server says "3m".
    vi.setSystemTime(new Date('2026-10-01T03:34:37.600Z'))
    const container = document.createElement('div')
    container.innerHTML = renderToString(row())
    expect(container.textContent).toContain('3m')

    // The browser hydrates a moment later, past the 4 minute mark.
    vi.setSystemTime(new Date('2026-10-01T03:34:38.100Z'))
    const errors: unknown[] = []
    await act(async () => {
      hydrateRoot(container, row(), { onRecoverableError: (error) => errors.push(error) })
    })

    expect(errors).toEqual([])
    expect(container.textContent).toContain('4m')
    expect(container.textContent).not.toContain('3m')
  })
})
