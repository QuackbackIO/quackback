// @vitest-environment happy-dom
/**
 * The conversation list row carries its assignee in a FIXED-width column at a
 * constant horizontal position on every row (the at-a-glance anatomy: name /
 * optional ticket line / preview + assignee column + time), so the eye scans
 * assignees down one unbroken vertical line regardless of snippet length.
 * Unassigned threads render an explicit "Unassigned" label in the same
 * column — the scan line never breaks.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import type { ConversationId, PrincipalId, TicketId, TicketStatusId } from '@quackback/ids'
import type { ConversationDTO } from '@/lib/shared/conversation/types'
import type { InboxItemDTO, LinkedTicketSummary } from '@/lib/shared/inbox/items'
import type { TicketDTO } from '@/lib/server/domains/tickets'
import { ConversationRow, TicketRow } from '../conversation-list-column'

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

describe('ConversationRow test chip', () => {
  it('marks a test thread', () => {
    const c = conversation({ isTest: true })
    render(
      <IntlProvider locale="en">
        <ConversationRow item={item(c)} id={c.id} selected={false} onSelect={() => {}} />
      </IntlProvider>
    )
    expect(screen.getByText('Test')).toBeInTheDocument()
  })

  it('leaves a real thread unmarked', () => {
    renderRow(conversation({}))
    expect(screen.queryByText('Test')).not.toBeInTheDocument()
  })
})

describe('ticket due marker on inbox rows', () => {
  const NOW = new Date('2026-10-14T12:00:00.000Z')
  const OVERDUE = '2026-10-14T10:00:00.000Z' // 2h ago
  const DUE_SOON = '2026-10-14T17:30:00.000Z' // in 5h 30m
  const LATER = '2026-10-16T12:00:00.000Z' // 2 days out

  afterEach(() => vi.useRealTimers())

  function linked(overrides: Partial<LinkedTicketSummary>): LinkedTicketSummary {
    return {
      id: 'ticket_1' as TicketId,
      number: 142,
      title: 'Cannot log in',
      statusName: 'Open',
      statusCategory: 'open',
      dueAt: null,
      ...overrides,
    }
  }

  async function renderLinked(ticket: LinkedTicketSummary) {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    const c = conversation({})
    render(
      <IntlProvider locale="en">
        <ConversationRow
          item={{ ...item(c), linkedTicket: ticket }}
          id={c.id}
          selected={false}
          onSelect={() => {}}
        />
      </IntlProvider>
    )
    // The marker reads the clock after mount.
    await act(async () => {})
  }

  async function renderTicket(dueAt: string | null, category: 'open' | 'closed' = 'open') {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    const t = {
      id: 'ticket_1' as TicketId,
      number: 142,
      type: 'customer',
      title: 'Cannot log in',
      status: { id: 'ticket_status_1' as TicketStatusId, name: 'Open', color: '#888', category },
      assignee: { principalId: null, displayName: null, teamId: null, teamName: null },
      dueAt,
      lastMessagePreview: null,
      updatedAt: NOW.toISOString(),
    } as unknown as TicketDTO
    render(
      <IntlProvider locale="en">
        <TicketRow
          item={{ kind: 'ticket', ticket: t, unreadCount: 0 }}
          id={t.id}
          selected={false}
          onSelect={() => {}}
        />
      </IntlProvider>
    )
    await act(async () => {})
  }

  it('marks an overdue linked ticket in red', async () => {
    await renderLinked(linked({ dueAt: OVERDUE }))
    const marker = screen.getByRole('img', { name: 'Overdue by 2h' })
    expect(marker.textContent).toBe('2h over')
    expect(marker.className).toContain('text-red-600')
  })

  it('marks a linked ticket due within a day in amber', async () => {
    await renderLinked(linked({ dueAt: DUE_SOON }))
    const marker = screen.getByRole('img', { name: 'Due in 5h 30m' })
    expect(marker.textContent).toBe('5h 30m')
    expect(marker.className).toContain('text-amber-700')
  })

  it('shows nothing for a closed linked ticket or one due further out', async () => {
    await renderLinked(linked({ dueAt: OVERDUE, statusCategory: 'closed' }))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    await renderLinked(linked({ dueAt: LATER }))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('marks an overdue ticket row after its status chip', async () => {
    await renderTicket(OVERDUE)
    const marker = screen.getByRole('img', { name: 'Overdue by 2h' })
    expect(marker.previousElementSibling?.textContent).toContain('Open')
  })

  it('leaves a closed ticket row, or one with no due date, unmarked', async () => {
    await renderTicket(OVERDUE, 'closed')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    await renderTicket(null)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
