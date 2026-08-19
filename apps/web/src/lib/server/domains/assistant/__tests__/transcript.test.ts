/**
 * Shared transcript module: the ticket/conversation grounding threads and the
 * Summarize chips share these renderers and the head+tail char budget. Pins the
 * Customer/Agent/Note line format, the system-message exclusion, the D1
 * internal-note labelling, and the budget's head+tail-with-marker behavior.
 */
import { describe, it, expect } from 'vitest'
import type { ConversationMessageDTO } from '@/lib/shared/conversation/types'
import {
  buildTicketTranscript,
  buildConversationTranscript,
  budgetTranscript,
  OMITTED_MESSAGES_MARKER,
} from '../transcript'

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

describe('buildConversationTranscript', () => {
  it('renders visitor and agent turns identically to the ticket renderer', () => {
    const messages = [
      msg({ senderType: 'visitor', content: 'My export is broken.' }),
      msg({ senderType: 'agent', content: 'On it.' }),
    ]
    expect(buildConversationTranscript(messages)).toBe(buildTicketTranscript(messages))
    expect(buildConversationTranscript(messages)).toBe(
      'Customer: My export is broken.\nAgent: On it.'
    )
  })
})

/**
 * Phase C conversational block layer (slice C-1) open item: this renderer
 * must never need to understand `block`/`blockReply` — every block kind's
 * honest plain-text fallback lives in `content` by construction (the
 * contract's core guarantee), so the existing content-only renderer already
 * grounds Quinn correctly on a block-bearing thread with no code change.
 */
describe('conversational block messages (Phase C, slice C-1) render from content alone', () => {
  it('renders every block kind as an ordinary Agent line, using content only', () => {
    const transcript = buildConversationTranscript([
      msg({ senderType: 'visitor', content: 'I need help' }),
      msg({
        senderType: 'agent',
        content: 'How can we help?\n[Billing] [Technical issue]',
        block: {
          v: 1,
          runId: 'workflow_run_1',
          nodeId: 'n1',
          waiting: true,
          kind: 'buttons',
          options: [
            { key: 'billing', label: 'Billing' },
            { key: 'tech', label: 'Technical issue' },
          ],
          allowTyping: false,
        },
      }),
      msg({
        senderType: 'agent',
        content: "We're online — typically replies in under an hour.",
        block: {
          v: 1,
          runId: 'workflow_run_1',
          nodeId: 'n2',
          waiting: false,
          kind: 'replyTime',
          status: 'online',
        },
      }),
      msg({
        senderType: 'agent',
        content: 'How would you rate this conversation?\n😞 🙁 😐 🙂 😄',
        block: {
          v: 1,
          runId: 'workflow_run_1',
          nodeId: 'n3',
          waiting: true,
          kind: 'csat',
          allowTypingInterrupt: true,
          commentPrompt: 'Add a comment',
        },
      }),
      msg({
        senderType: 'visitor',
        content: 'Billing',
        blockReply: {
          kind: 'buttons',
          inReplyToMessageId: 'conversation_msg_block1',
          buttonKey: 'billing',
        },
      }),
    ])
    expect(transcript).toBe(
      [
        'Customer: I need help',
        'Agent: How can we help?\n[Billing] [Technical issue]',
        "Agent: We're online — typically replies in under an hour.",
        'Agent: How would you rate this conversation?\n😞 🙁 😐 🙂 😄',
        'Customer: Billing',
      ].join('\n')
    )
  })
})

describe('internal-note labelling (D1)', () => {
  it('labels an internal note distinctly from a customer-visible agent reply', () => {
    const transcript = buildConversationTranscript([
      msg({ senderType: 'visitor', content: 'When will this be fixed?' }),
      msg({ senderType: 'agent', isInternal: true, content: 'Known bug, ETA Friday.' }),
      msg({ senderType: 'agent', isInternal: false, content: 'We are working on it.' }),
    ])
    expect(transcript).toBe(
      'Customer: When will this be fixed?\nNote (internal): Known bug, ETA Friday.\nAgent: We are working on it.'
    )
  })
})

describe('budgetTranscript', () => {
  it('returns the transcript verbatim when within budget', () => {
    const transcript = 'Customer: hi\nAgent: hello'
    expect(budgetTranscript(transcript, 6000)).toBe(transcript)
  })

  it('keeps a head and tail window with the omitted-messages marker when over budget', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `Customer: message number ${i}`)
    const transcript = lines.join('\n')
    const budgeted = budgetTranscript(transcript, 400)

    expect(budgeted.length).toBeLessThan(transcript.length)
    expect(budgeted).toContain(OMITTED_MESSAGES_MARKER)
    // The original first message survives, and the most recent one does too.
    expect(budgeted.startsWith('Customer: message number 0')).toBe(true)
    expect(budgeted.endsWith('Customer: message number 199')).toBe(true)
    // The middle is dropped.
    expect(budgeted).not.toContain('message number 100')
  })

  it('never splits a message mid-line (head and tail are whole lines)', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `Customer: line ${i} with some content`)
    const budgeted = budgetTranscript(lines.join('\n'), 300)
    const [head, tail] = budgeted.split(OMITTED_MESSAGES_MARKER)
    for (const line of [...head.split('\n'), ...tail.split('\n')]) {
      expect(lines).toContain(line)
    }
  })

  it('preserves the opening of the first message and honors the budget when it is oversized', () => {
    const first = `Customer: ${'x'.repeat(500)}`
    const transcript = [first, 'Agent: short reply', 'Customer: latest'].join('\n')
    const budget = 100
    const budgeted = budgetTranscript(transcript, budget)
    // The opening of the original request survives even though the message is
    // hard-truncated to fit, and the total never exceeds the budget.
    expect(budgeted.startsWith('Customer: xxx')).toBe(true)
    expect(budgeted.length).toBeLessThanOrEqual(budget)
    expect(budgeted).toContain(OMITTED_MESSAGES_MARKER)
  })

  it('honors the total budget even when a single message dwarfs the whole budget', () => {
    const huge = `Customer: ${'x'.repeat(20000)}`
    const transcript = [huge, 'Agent: reply', 'Customer: latest here'].join('\n')
    const budget = 6000
    const budgeted = budgetTranscript(transcript, budget)
    expect(budgeted.length).toBeLessThanOrEqual(budget)
  })

  it('omits the marker when the head and tail windows cover every message (nothing dropped)', () => {
    // Two messages, forced over budget: the head takes the first and the tail
    // takes the second, so there is no gap between them and no "omitted" claim.
    const transcript = ['Customer: first message here', 'Agent: second message here'].join('\n')
    const budgeted = budgetTranscript(transcript, 40)
    expect(budgeted).not.toContain(OMITTED_MESSAGES_MARKER)
  })
})
