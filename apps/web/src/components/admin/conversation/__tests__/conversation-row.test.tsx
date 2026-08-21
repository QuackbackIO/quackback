// @vitest-environment happy-dom
/**
 * The conversation list row carries its assignee in a FIXED-width column at a
 * constant horizontal position on every row (the at-a-glance anatomy: name /
 * optional ticket line / preview + assignee column + time), so the eye scans
 * assignees down one unbroken vertical line regardless of snippet length.
 * Unassigned threads render an explicit "Unassigned" label in the same
 * column — the scan line never breaks.
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
  return render(<ConversationRow item={item(c)} id={c.id} selected={false} onSelect={() => {}} />)
}

describe('ConversationRow assignee column', () => {
  it('shows the assignee in a fixed-width column when the conversation is assigned', () => {
    renderRow(
      conversation({
        assignedAgent: {
          principalId: 'principal_agent' as PrincipalId,
          displayName: 'Maya Chen',
          avatarUrl: null,
        },
      })
    )
    const column = screen.getByTitle('Assigned to Maya Chen')
    expect(column).toBeInTheDocument()
    // The chip renders the first name; the full name is the hover title.
    expect(screen.getByText('Maya')).toBeInTheDocument()
    // The column's width is pinned, so its left edge never moves with the
    // snippet length — assignees align down a single vertical line.
    expect(column.className).toContain('w-24')
  })

  it('renders an explicit unassigned state in the same fixed column', () => {
    renderRow(conversation({ assignedAgent: null }))
    const unassigned = screen.getByText('Unassigned')
    expect(unassigned).toBeInTheDocument()
    expect(unassigned.className).toContain('w-24')
  })
})

describe('ConversationRow spam filing reason', () => {
  it('shows the filing-reason badge on a spam-ended row', () => {
    renderRow(conversation({ status: 'closed', endReason: 'spam', spamReason: 'auto_responder' }))
    expect(screen.getByText('Auto-responder')).toBeInTheDocument()
  })

  it('labels an agent-filed spam as manually filed', () => {
    renderRow(conversation({ status: 'closed', endReason: 'spam', spamReason: 'manual' }))
    expect(screen.getByText('Manually filed')).toBeInTheDocument()
  })

  it('renders no badge on a non-spam row', () => {
    renderRow(conversation({}))
    expect(screen.queryByText('Auto-responder')).not.toBeInTheDocument()
    expect(screen.queryByText('Manually filed')).not.toBeInTheDocument()
  })
})
