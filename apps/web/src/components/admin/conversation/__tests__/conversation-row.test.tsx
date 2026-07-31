/**
 * The conversation list row carries its assignee inline (the at-a-glance
 * anatomy: name / optional ticket line / preview + time + assignee), so an
 * agent can see WHO is handling a thread without opening it. Unassigned
 * threads render no assignee element at all — absence IS the "unassigned"
 * signal, matching the queues.
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ConversationId, PrincipalId } from '@quackback/ids'
import type { ConversationDTO } from '@/lib/shared/conversation/types'
import type { InboxItemDTO } from '@/lib/shared/inbox/items'
import { ConversationRow } from '../conversation-list-column'

function conversation(overrides: Partial<ConversationDTO>): ConversationDTO {
  return {
    id: 'conversation_01JTEST' as ConversationId,
    status: 'open',
    priority: 'none',
    channel: 'messenger',
    subject: null,
    lastMessagePreview: 'Where is my order?',
    lastMessageAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
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
    ...overrides,
  } as ConversationDTO
}

function item(c: ConversationDTO): Extract<InboxItemDTO, { kind: 'conversation' }> {
  return { kind: 'conversation', conversation: c, linkedTicket: null, searchSnippet: null }
}

function renderRow(c: ConversationDTO) {
  return render(
    <ConversationRow
      item={item(c)}
      id={c.id}
      selected={false}
      checked={false}
      selectionActive={false}
      onSelect={() => {}}
      onToggleSelect={() => {}}
    />
  )
}

describe('ConversationRow assignee', () => {
  it('shows the assignee inline when the conversation is assigned', () => {
    renderRow(
      conversation({
        assignedAgent: {
          principalId: 'principal_agent' as PrincipalId,
          displayName: 'Maya Chen',
          avatarUrl: null,
        },
      })
    )
    expect(screen.getByTitle('Assigned to Maya Chen')).toBeInTheDocument()
    // The chip renders the first name; the full name is the hover title.
    expect(screen.getByText('Maya')).toBeInTheDocument()
  })

  it('renders no assignee element when the conversation is unassigned', () => {
    renderRow(conversation({ assignedAgent: null }))
    expect(screen.queryByTitle(/^Assigned to /)).not.toBeInTheDocument()
  })
})
