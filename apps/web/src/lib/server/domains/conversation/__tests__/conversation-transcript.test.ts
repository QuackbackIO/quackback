/**
 * The transcript renderer is pure: given conversation metadata and an
 * agent-scoped message list, it produces a deterministic UTC markdown export.
 * These pin the speaker labelling (role, assistant, internal note), the header,
 * attachment notes, and empty/absent-field handling.
 */
import { describe, it, expect } from 'vitest'
import { renderConversationTranscript, type TranscriptMessage } from '../conversation.transcript'

const msg = (over: Partial<TranscriptMessage>): TranscriptMessage => ({
  senderType: 'visitor',
  content: 'hi',
  contentJson: null,
  createdAt: '2026-07-04T09:15:30.000Z',
  author: { displayName: 'Alice' } as TranscriptMessage['author'],
  isInternal: false,
  isAssistant: false,
  attachments: [],
  ...over,
})

describe('renderConversationTranscript', () => {
  it('renders a metadata header and a UTC opened time', () => {
    const out = renderConversationTranscript(
      {
        id: 'conversation_1',
        subject: 'Billing question',
        status: 'closed',
        channel: 'messenger',
        createdAt: '2026-07-04T09:15:30.000Z',
      },
      []
    )
    expect(out).toContain('# Conversation conversation_1')
    expect(out).toContain('- Subject: Billing question')
    expect(out).toContain('- Status: closed')
    expect(out).toContain('- Channel: messenger')
    expect(out).toContain('- Opened: 2026-07-04 09:15 UTC')
    expect(out).toContain('_No messages._')
  })

  it('labels each speaker by role, marking the assistant and internal notes', () => {
    const out = renderConversationTranscript({ id: 'c' }, [
      msg({
        author: { displayName: 'Alice' } as TranscriptMessage['author'],
        content: 'I need help',
      }),
      msg({
        senderType: 'agent',
        author: { displayName: 'Jane' } as TranscriptMessage['author'],
        content: 'Sure',
        createdAt: '2026-07-04T09:16:00.000Z',
      }),
      msg({
        senderType: 'agent',
        author: { displayName: 'Jane' } as TranscriptMessage['author'],
        content: 'escalate to billing',
        isInternal: true,
        createdAt: '2026-07-04T09:17:00.000Z',
      }),
      msg({
        senderType: 'agent',
        author: { displayName: 'Quinn' } as TranscriptMessage['author'],
        isAssistant: true,
        content: 'See this article',
        createdAt: '2026-07-04T09:18:00.000Z',
      }),
      msg({
        senderType: 'system',
        author: null,
        content: 'Conversation closed',
        createdAt: '2026-07-04T09:20:00.000Z',
      }),
    ])
    expect(out).toContain('[2026-07-04 09:15 UTC] Alice (visitor): I need help')
    expect(out).toContain('Jane (agent): Sure')
    expect(out).toContain('Jane (agent) · internal note: escalate to billing')
    expect(out).toContain('Quinn (assistant): See this article')
    expect(out).toContain('System: Conversation closed')
  })

  it('falls back to a role name, notes attachments, and handles empty content', () => {
    const out = renderConversationTranscript({ id: 'c' }, [
      msg({
        author: null,
        content: '',
        attachments: [
          { url: 'https://x/y', name: 'screenshot.png', contentType: 'image/png', size: 1 },
        ],
      }),
    ])
    expect(out).toContain('Visitor (visitor): (no text content)')
    expect(out).toContain('    - attachment: screenshot.png')
  })

  it('uses a custom heading when provided (e.g. a ticket reference)', () => {
    const out = renderConversationTranscript({ id: 'ticket_1', heading: 'Ticket #142' }, [])
    expect(out).toContain('# Ticket #142')
    expect(out).not.toContain('# Conversation')
  })

  it('omits optional metadata when absent and marks an unknown open time', () => {
    const out = renderConversationTranscript({ id: 'c' }, [])
    expect(out).not.toContain('- Subject:')
    expect(out).not.toContain('- Status:')
    expect(out).toContain('- Opened: unknown')
  })
})

describe('renderConversationTranscript — deriving text and images from contentJson', () => {
  it('derives an image-only message from contentJson instead of falling back to "(no text content)"', () => {
    const out = renderConversationTranscript({ id: 'c' }, [
      msg({
        content: '',
        contentJson: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'chatImage', attrs: { src: 'https://cdn.example.com/a.png' } }],
            },
          ],
        },
      }),
    ])
    expect(out).not.toContain('(no text content)')
    expect(out).toContain('[image] https://cdn.example.com/a.png')
  })

  it('renders derived text alongside the image source line for a rich text+image message', () => {
    const out = renderConversationTranscript({ id: 'c' }, [
      msg({
        content: '',
        contentJson: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'See this screenshot' },
                { type: 'chatImage', attrs: { src: 'https://cdn.example.com/b.png' } },
              ],
            },
          ],
        },
      }),
    ])
    expect(out).not.toContain('(no text content)')
    expect(out).toContain('See this screenshot')
    expect(out).toContain('[image] https://cdn.example.com/b.png')
  })

  it('renders a plain-content message exactly as before, ignoring contentJson entirely', () => {
    const out = renderConversationTranscript({ id: 'c' }, [
      msg({
        senderType: 'agent',
        author: { displayName: 'Jane' } as TranscriptMessage['author'],
        content: 'Sure',
        // A plain message never carries contentJson in practice, but the
        // renderer must still prefer `content` when it's non-blank.
        contentJson: { type: 'doc', content: [] },
      }),
    ])
    expect(out).toContain('[2026-07-04 09:15 UTC] Jane (agent): Sure')
    expect(out).not.toContain('[image]')
  })

  it('still falls back to "(no text content)" when neither content nor contentJson has anything', () => {
    const out = renderConversationTranscript({ id: 'c' }, [msg({ content: '', contentJson: null })])
    expect(out).toContain('(no text content)')
  })

  /**
   * Phase C conversational block layer (slice C-1) open item: this export
   * renderer's TranscriptMessage type (a Pick over ConversationMessageDTO)
   * doesn't even include `block`/`blockReply` — it structurally can't read
   * them. A block message's honest plain-text fallback in `content` is what
   * carries it, exactly like any other agent message.
   */
  it('renders a conversational block message (Phase C) as an ordinary agent line, via content', () => {
    const out = renderConversationTranscript({ id: 'c' }, [
      msg({
        senderType: 'agent',
        isAssistant: true,
        author: { displayName: 'Quinn' } as TranscriptMessage['author'],
        content: 'Pick one\n[Billing] [Technical issue]',
        contentJson: { type: 'doc', content: [{ type: 'text', text: 'Pick one' }] },
      }),
    ])
    expect(out).toContain('Quinn (assistant): Pick one\n[Billing] [Technical issue]')
  })
})
