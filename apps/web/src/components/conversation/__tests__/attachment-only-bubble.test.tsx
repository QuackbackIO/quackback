// @vitest-environment happy-dom
/**
 * A message that carries only attachments shows its attachments and no empty
 * bubble above them, in the inbox (AgentMessageBubble) and in the widget and
 * portal (VisitorMessageBubble). The body may arrive as an empty string or as
 * an empty rich-text doc, depending on the composer that sent it.
 */
import { describe, it, expect, afterEach } from 'vitest'
import type React from 'react'
import { render, cleanup } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { AgentMessageBubble, VisitorMessageBubble } from '../message-bubble'
import type {
  AgentConversationMessageDTO,
  ConversationAttachment,
} from '@/lib/shared/conversation/types'
import type { TiptapContent } from '@/lib/shared/db-types'

afterEach(cleanup)

const image: ConversationAttachment = {
  url: 'https://files.example.com/photo.png',
  name: 'photo.png',
  contentType: 'image/png',
  size: 1024,
}

const emptyDoc = { type: 'doc', content: [{ type: 'paragraph' }] } as TiptapContent

/** The chat bubble's fill: every bubble variant carries these three tokens. */
function bubbles(container: HTMLElement) {
  return container.querySelectorAll('.rounded-2xl.px-3\\.5.py-2\\.5')
}

function agentMessage(over: Partial<AgentConversationMessageDTO>): AgentConversationMessageDTO {
  return {
    id: 'conversation_msg_1' as AgentConversationMessageDTO['id'],
    conversationId: 'conversation_1' as AgentConversationMessageDTO['conversationId'],
    ticketId: null,
    senderType: 'visitor',
    content: '',
    createdAt: '2026-07-01T00:00:00.000Z',
    author: { principalId: 'principal_v' as never, displayName: 'Vic', avatarUrl: null },
    attachments: [image],
    citations: [],
    isAssistant: false,
    isInternal: false,
    contentJson: null,
    viaEmail: false,
    systemEvent: null,
    reactions: [],
    flaggedAt: null,
    postSuggestion: null,
    translatedFrom: null,
    ...over,
  }
}

function withIntl(node: React.ReactNode) {
  return render(
    <IntlProvider locale="en-US" messages={{}} onError={() => {}}>
      {node}
    </IntlProvider>
  )
}

function renderVisitor(props: Parameters<typeof VisitorMessageBubble>[0]) {
  return withIntl(<VisitorMessageBubble {...props} />)
}

function renderAgent(message: AgentConversationMessageDTO) {
  return withIntl(<AgentMessageBubble message={message} />)
}

describe('a message with only attachments', () => {
  describe.each([
    ['an empty body', { content: '', contentJson: null }],
    ['a blank body', { content: '  \n ', contentJson: null }],
    ['an empty rich-text doc', { content: '', contentJson: emptyDoc }],
  ])('with %s', (_label, body) => {
    it.each(['visitor', 'agent'] as const)('shows no bubble in the inbox (%s)', (senderType) => {
      const { container } = renderAgent(agentMessage({ senderType, ...body }))
      expect(bubbles(container)).toHaveLength(0)
      expect(container.innerHTML).toContain('photo.png')
    })

    it.each(['self', 'peer'] as const)('shows no bubble in the widget (%s)', (side) => {
      const { container } = renderVisitor({ side, ...body, attachments: [image] })
      expect(bubbles(container)).toHaveLength(0)
      expect(container.innerHTML).toContain('photo.png')
    })
  })

  it('still shows the bubble when the message has text as well', () => {
    const inbox = renderAgent(agentMessage({ content: 'See attached' }))
    expect(bubbles(inbox.container)).toHaveLength(1)
    cleanup()
    const widget = renderVisitor({ side: 'self', content: 'See attached', attachments: [image] })
    expect(bubbles(widget.container)).toHaveLength(1)
  })
})
