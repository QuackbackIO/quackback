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

  it('omits optional metadata when absent and marks an unknown open time', () => {
    const out = renderConversationTranscript({ id: 'c' }, [])
    expect(out).not.toContain('- Subject:')
    expect(out).not.toContain('- Status:')
    expect(out).toContain('- Opened: unknown')
  })
})
