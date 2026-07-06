/**
 * buildTicketTranscript: the ticket copilot's grounding thread and the ticket
 * Summarize chip share this one rendering. Pins the customer/agent line
 * format and the system-message exclusion (mirrors conversation-summary.service.ts's
 * buildTranscript).
 */
import { describe, it, expect } from 'vitest'
import type { ConversationMessageDTO } from '@/lib/shared/conversation/types'
import { buildTicketTranscript } from '../ticket-transcript'

function msg(overrides: Partial<ConversationMessageDTO> = {}): ConversationMessageDTO {
  return {
    id: 'conversation_msg_1' as ConversationMessageDTO['id'],
    conversationId: null,
    ticketId: 'ticket_1' as ConversationMessageDTO['ticketId'],
    senderType: 'visitor',
    content: 'hi',
    createdAt: '2026-01-01T00:00:00Z',
    author: { principalId: 'principal_visitor_1' as never, displayName: null, avatarUrl: null },
    attachments: [],
    citations: [],
    isAssistant: false,
    isInternal: false,
    contentJson: null,
    viaEmail: false,
    systemEvent: null,
    ...overrides,
  }
}

describe('buildTicketTranscript', () => {
  it('renders visitor and agent turns as Customer/Agent lines, oldest first', () => {
    const transcript = buildTicketTranscript([
      msg({ senderType: 'visitor', content: 'The CSV export button does nothing.' }),
      msg({ senderType: 'agent', content: 'Looking into it now.' }),
    ])
    expect(transcript).toBe(
      'Customer: The CSV export button does nothing.\nAgent: Looking into it now.'
    )
  })

  it('excludes a system status-change message from the rendered thread', () => {
    const transcript = buildTicketTranscript([
      msg({ senderType: 'visitor', content: 'Any update?' }),
      msg({ senderType: 'system', content: 'Ticket status changed to In Progress.' }),
      msg({ senderType: 'agent', content: 'Still looking into it.' }),
    ])
    expect(transcript).not.toContain('In Progress')
    expect(transcript).toBe('Customer: Any update?\nAgent: Still looking into it.')
  })

  it('skips a message with empty or whitespace-only content', () => {
    const transcript = buildTicketTranscript([
      msg({ senderType: 'visitor', content: '   ' }),
      msg({ senderType: 'agent', content: 'Real reply.' }),
    ])
    expect(transcript).toBe('Agent: Real reply.')
  })

  it('returns an empty string for an empty thread', () => {
    expect(buildTicketTranscript([])).toBe('')
  })
})
