/**
 * Pure serializer coverage for P3.1 (TICKET-CONTENT-PARITY-SPEC §P3.1): the REST
 * ticket-message shape must stop stripping `contentJson`/`attachments`, and
 * `content` must restore image nodes the stored markdown column lost (mirrors
 * the posts/changelog read-path fix in contentJsonToMarkdown).
 */
import { describe, expect, it } from 'vitest'
import { serializeTicketMessage } from '../-serialize'
import type {
  ConversationAttachment,
  ConversationMessageDTO,
} from '@/lib/shared/conversation/types'
import type { ConversationMessageId, PrincipalId, TicketId } from '@quackback/ids'

const TICKET_ID = 'ticket_01h455vb4pex5vsknk084sn02q' as TicketId

/** A fully-populated DTO fixture; individual tests override just what they need. */
function baseMessage(overrides: Partial<ConversationMessageDTO> = {}): ConversationMessageDTO {
  return {
    id: 'conversation_msg_01h455vb4pex5vsknk084sn02q' as ConversationMessageId,
    conversationId: null,
    ticketId: TICKET_ID,
    senderType: 'agent',
    content: 'plain text',
    createdAt: '2026-07-05T00:00:00.000Z',
    author: { principalId: 'principal_01h455vb4pex5vsknk084sn02q' as PrincipalId, displayName: 'Grace', avatarUrl: null },
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

describe('serializeTicketMessage', () => {
  it('derives markdown from contentJson for an image-bearing message and echoes contentJson + attachments', () => {
    const contentJson = {
      type: 'doc' as const,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'See attached:' }] },
        { type: 'image', attrs: { src: 'https://cdn.example/x.png' } },
      ],
    }
    const attachments: ConversationAttachment[] = [
      { url: 'https://cdn.example/x.png', name: 'x.png', contentType: 'image/png', size: 1234 },
    ]
    const dto = baseMessage({
      content: 'See attached:', // stored markdown lost the image, as usual
      contentJson,
      attachments,
    })

    const result = serializeTicketMessage(dto)

    expect(result.content).toContain('See attached:')
    expect(result.content).toContain('![](https://cdn.example/x.png)')
    expect(result.contentJson).toEqual(contentJson)
    expect(result.attachments).toEqual(attachments)
  })

  it('returns plain content verbatim, and null contentJson/attachments, for a plain-text message', () => {
    const dto = baseMessage({
      content: 'I still cannot sign in after resetting my password.',
      contentJson: null,
      attachments: [],
    })

    const result = serializeTicketMessage(dto)

    expect(result.content).toBe('I still cannot sign in after resetting my password.')
    expect(result.contentJson).toBeNull()
    expect(result.attachments).toBeNull()
  })

  it('pins the rest of the shape: id/ticketId/senderType/isInternal/author fields pass through unchanged, no citations key', () => {
    const dto = baseMessage({
      senderType: 'agent',
      isInternal: true,
      author: { principalId: 'principal_note_author' as PrincipalId, displayName: 'Ada', avatarUrl: null },
      content: 'internal note text',
      citations: [{ type: 'article', id: 'kb_1', title: 'Reset your password', url: 'https://x.test/a' }],
    })

    const result = serializeTicketMessage(dto)

    expect(result).toEqual({
      id: dto.id,
      ticketId: TICKET_ID,
      senderType: 'agent',
      isInternal: true,
      authorPrincipalId: 'principal_note_author',
      authorName: 'Ada',
      content: 'internal note text',
      contentJson: null,
      attachments: null,
      createdAt: dto.createdAt,
    })
    expect(result).not.toHaveProperty('citations')
  })

  it('falls back to null authorPrincipalId/authorName for an authorless system message', () => {
    const dto = baseMessage({
      senderType: 'system',
      author: null,
      content: 'Ticket reopened',
    })

    const result = serializeTicketMessage(dto)

    expect(result.authorPrincipalId).toBeNull()
    expect(result.authorName).toBeNull()
  })
})
