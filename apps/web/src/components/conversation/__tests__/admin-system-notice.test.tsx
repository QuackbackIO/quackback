// @vitest-environment happy-dom
/**
 * The inbox thread's system rows read in the teammate's language from their
 * structured event, and fall back to the stored English sentence when the
 * event cannot word it (or there is none).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import de from '@/locales/de.json'
import { AgentMessageBubble } from '../message-bubble'
import type {
  AgentConversationMessageDTO,
  ConversationSystemEvent,
} from '@/lib/shared/conversation/types'

afterEach(cleanup)

function systemRow(
  content: string,
  systemEvent: ConversationSystemEvent | null,
  isInternal = false
): AgentConversationMessageDTO {
  return {
    id: 'conversation_msg_1' as AgentConversationMessageDTO['id'],
    conversationId: 'conversation_1' as AgentConversationMessageDTO['conversationId'],
    ticketId: null,
    senderType: 'system',
    content,
    createdAt: '2026-07-01T00:00:00.000Z',
    author: null,
    attachments: [],
    citations: [],
    isAssistant: false,
    isInternal,
    contentJson: null,
    viaEmail: false,
    systemEvent,
    reactions: [],
    flaggedAt: null,
    postSuggestion: null,
    translatedFrom: null,
  }
}

function inGerman(message: AgentConversationMessageDTO, issueThread = false) {
  return render(
    <IntlProvider locale="de" messages={de}>
      <AgentMessageBubble message={message} issueThread={issueThread} />
    </IntlProvider>
  )
}

describe('system rows in the inbox thread', () => {
  it('words a notice by its kind in German', () => {
    inGerman(systemRow('Conversation ended', { kind: 'chat_ended' }))
    expect(screen.getByText('Unterhaltung beendet')).toBeTruthy()
    expect(screen.queryByText('Conversation ended')).toBeNull()
  })

  it('words the values the event carries', () => {
    inGerman(
      systemRow(
        'Ada changed the priority to high',
        { kind: 'priority_changed', priority: 'high', agentName: 'Ada' },
        true
      )
    )
    expect(screen.getByText('Ada hat die Priorität auf hoch gesetzt')).toBeTruthy()
  })

  it('tells an issue close from a conversation close, and an internal ticket from a shared one', () => {
    inGerman(systemRow('Issue closed', { kind: 'chat_ended' }), true)
    expect(screen.getByText('Issue geschlossen')).toBeTruthy()
    cleanup()
    inGerman(
      systemRow(
        'Internal ticket #4 opened from this conversation',
        { kind: 'ticket_created', ticketReference: '#4' },
        true
      )
    )
    expect(screen.getByText('Internes Ticket #4 aus dieser Unterhaltung geöffnet')).toBeTruthy()
  })

  it('keeps the stored sentence when the event cannot word it', () => {
    inGerman(systemRow('Ada snoozed the conversation until Jul 2, 9:00 AM', { kind: 'snoozed' }))
    expect(screen.getByText('Ada snoozed the conversation until Jul 2, 9:00 AM')).toBeTruthy()
    cleanup()
    inGerman(systemRow('Assigned long ago', null))
    expect(screen.getByText('Assigned long ago')).toBeTruthy()
  })

  it('reads the same English as the stored sentence on an English page', () => {
    render(
      <AgentMessageBubble
        message={systemRow('Conversation assigned to the Billing team', {
          kind: 'team_assigned',
          teamName: 'Billing',
        })}
      />
    )
    expect(screen.getByText('Conversation assigned to the Billing team')).toBeTruthy()
  })
})
