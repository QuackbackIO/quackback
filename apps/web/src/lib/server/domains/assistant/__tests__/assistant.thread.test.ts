import { describe, it, expect, vi } from 'vitest'
import { mapRowsToThreadMessages } from '../assistant.thread'
import { wrapUntrustedText } from '../injection-guard'
import type {
  ConversationMessageDTO,
  ConversationAttachment,
} from '@/lib/shared/conversation/types'
import type { PrincipalId } from '@quackback/ids'
import type { FileExcerptRow } from '@/lib/server/domains/files/files.excerpts'

const ASSISTANT = 'principal_assistant' as PrincipalId
const VISITOR = 'principal_visitor' as PrincipalId
const AGENT = 'principal_agent' as PrincipalId

/** Build a minimal message DTO for the mapper (internal notes + deleted rows are
 *  filtered in SQL, so they never reach it). `authorId` undefined = a visitor
 *  author; null = no author (system). */
function msg(
  p: Partial<ConversationMessageDTO> & { authorId?: PrincipalId | null }
): ConversationMessageDTO {
  const { authorId, ...rest } = p
  const author =
    authorId === undefined
      ? { principalId: VISITOR, displayName: null, avatarUrl: null }
      : authorId === null
        ? null
        : { principalId: authorId, displayName: null, avatarUrl: null }
  return {
    id: 'conversation_msg_1' as ConversationMessageDTO['id'],
    conversationId: 'conversation_1' as ConversationMessageDTO['conversationId'],
    ticketId: null,
    senderType: 'visitor',
    content: 'hi',
    createdAt: '2026-01-01T00:00:00Z',
    author,
    attachments: [],
    citations: [],
    isAssistant: false,
    isInternal: false,
    contentJson: null,
    viaEmail: false,
    systemEvent: null,
    ...rest,
  }
}

describe('mapRowsToThreadMessages', () => {
  it('maps a visitor message to a customer turn', () => {
    expect(
      mapRowsToThreadMessages([msg({ senderType: 'visitor', content: 'help' })], ASSISTANT)
    ).toEqual([{ sender: 'customer', content: 'help' }])
  })

  it("maps the assistant service principal's messages to assistant turns", () => {
    expect(
      mapRowsToThreadMessages(
        [msg({ senderType: 'agent', authorId: ASSISTANT, content: 'hello' })],
        ASSISTANT
      )
    ).toEqual([{ sender: 'assistant', content: 'hello' }])
  })

  it('maps any other team principal to a human_agent turn', () => {
    expect(
      mapRowsToThreadMessages(
        [msg({ senderType: 'agent', authorId: AGENT, content: 'on it' })],
        ASSISTANT
      )
    ).toEqual([{ sender: 'human_agent', content: 'on it' }])
  })

  it('skips system notices', () => {
    const rows = [
      msg({ senderType: 'system', authorId: null, content: 'Conversation ended' }),
      msg({ senderType: 'visitor', content: 'real' }),
    ]
    expect(mapRowsToThreadMessages(rows, ASSISTANT)).toEqual([
      { sender: 'customer', content: 'real' },
    ])
  })

  it('skips text-less messages and trims content', () => {
    const rows = [
      msg({ senderType: 'visitor', content: '   ' }),
      msg({ senderType: 'visitor', content: '  spaced  ' }),
    ]
    expect(mapRowsToThreadMessages(rows, ASSISTANT)).toEqual([
      { sender: 'customer', content: 'spaced' },
    ])
  })

  it('preserves order across mixed senders', () => {
    const rows = [
      msg({ senderType: 'visitor', content: 'q1' }),
      msg({ senderType: 'agent', authorId: ASSISTANT, content: 'a1' }),
      msg({ senderType: 'visitor', content: 'q2' }),
    ]
    expect(mapRowsToThreadMessages(rows, ASSISTANT)).toEqual([
      { sender: 'customer', content: 'q1' },
      { sender: 'assistant', content: 'a1' },
      { sender: 'customer', content: 'q2' },
    ])
  })
})

/**
 * Non-image attachments with a fileId (documents) make Quinn's thread mapper
 * surface a bracketed note plus the extracted excerpt, when one is loaded —
 * exactly like message text (same `content` field, same customer turn), so
 * no weaker or separate framing is invented for it. Files without an excerpt
 * still get their bracket line, so Quinn knows one exists but cannot read it.
 */
describe('mapRowsToThreadMessages: attached documents', () => {
  function docAttachment(overrides: Partial<ConversationAttachment> = {}): ConversationAttachment {
    return {
      url: '/api/storage/files/a.pdf?read=sig',
      name: 'invoice.pdf',
      contentType: 'application/pdf',
      size: 100,
      fileId: 'file_1',
      family: 'pdf',
      ...overrides,
    }
  }

  const excerptRow = (overrides: Partial<FileExcerptRow> = {}): FileExcerptRow => ({
    id: 'file_1',
    name: 'invoice.pdf',
    family: 'pdf',
    previewStatus: 'ready',
    textExcerpt: 'Invoice #42 for Acme Corp, total $500.',
    ...overrides,
  })

  it('no longer drops a text-less visitor message that only carries a document', () => {
    const rows = [msg({ senderType: 'visitor', content: '', attachments: [docAttachment()] })]
    const out = mapRowsToThreadMessages(rows, ASSISTANT)
    expect(out).toHaveLength(1)
    expect(out[0].sender).toBe('customer')
    expect(out[0].content).toContain('[Attached file: invoice.pdf (PDF)]')
  })

  it('appends the bracket line only when no excerpt is loaded for the file', () => {
    const rows = [
      msg({ senderType: 'visitor', content: 'see attached', attachments: [docAttachment()] }),
    ]
    expect(mapRowsToThreadMessages(rows, ASSISTANT)).toEqual([
      { sender: 'customer', content: 'see attached\n\n[Attached file: invoice.pdf (PDF)]' },
    ])
  })

  it('appends the bracket line plus the fenced excerpt when one is loaded', () => {
    const rows = [
      msg({ senderType: 'visitor', content: 'see attached', attachments: [docAttachment()] }),
    ]
    const fileExcerpts = new Map([['file_1', excerptRow()]])
    expect(mapRowsToThreadMessages(rows, ASSISTANT, fileExcerpts)).toEqual([
      {
        sender: 'customer',
        content: [
          'see attached',
          '',
          '[Attached file: invoice.pdf (PDF)]',
          wrapUntrustedText('Excerpt of invoice.pdf', 'Invoice #42 for Acme Corp, total $500.'),
        ].join('\n'),
      },
    ])
  })

  it('a file with an excerpt-less row still gets just the bracket line', () => {
    const rows = [msg({ senderType: 'visitor', content: '', attachments: [docAttachment()] })]
    const fileExcerpts = new Map([
      ['file_1', excerptRow({ textExcerpt: null, previewStatus: 'pending' })],
    ])
    expect(mapRowsToThreadMessages(rows, ASSISTANT, fileExcerpts)).toEqual([
      { sender: 'customer', content: '[Attached file: invoice.pdf (PDF)]' },
    ])
  })

  it('truncates a single excerpt to 4000 chars before fencing it', () => {
    const longExcerpt = 'x'.repeat(5000)
    const capped = 'x'.repeat(4000)
    const rows = [msg({ senderType: 'visitor', content: '', attachments: [docAttachment()] })]
    const fileExcerpts = new Map([['file_1', excerptRow({ textExcerpt: longExcerpt })]])
    const out = mapRowsToThreadMessages(rows, ASSISTANT, fileExcerpts)
    expect(out[0].content).toBe(
      [
        '[Attached file: invoice.pdf (PDF)]',
        wrapUntrustedText('Excerpt of invoice.pdf', capped),
      ].join('\n')
    )
  })

  it('keeps every bracket line even once the thread-wide excerpt budget runs out within one turn', () => {
    const attachments = Array.from({ length: 7 }, (_, i) =>
      docAttachment({ fileId: `file_${i}`, name: `doc${i}.pdf` })
    )
    const fileExcerpts = new Map(
      attachments.map((a) => [
        a.fileId!,
        excerptRow({ id: a.fileId!, name: a.name, textExcerpt: 'y'.repeat(4000) }),
      ])
    )
    const rows = [msg({ senderType: 'visitor', content: '', attachments })]
    const out = mapRowsToThreadMessages(rows, ASSISTANT, fileExcerpts)
    // Every file's bracket line still appears, even once the thread-wide
    // 24,000-char excerpt budget runs out — so Quinn always knows how many
    // files there are.
    for (const a of attachments) {
      expect(out[0].content).toContain(`[Attached file: ${a.name} (PDF)]`)
    }
    // 6 files x 4000 chars exhausts the budget; the 7th file's excerpt is
    // dropped even though its bracket line survives.
    const excerptOccurrences = out[0].content.match(/y{4000}/g) ?? []
    expect(excerptOccurrences).toHaveLength(6)
  })

  it('spends one excerpt budget across the whole thread, newest turns first', () => {
    const rows = Array.from({ length: 7 }, (_, i) =>
      msg({
        senderType: 'visitor',
        content: '',
        attachments: [docAttachment({ fileId: `file_${i}`, name: `doc${i}.pdf` })],
      })
    )
    const fileExcerpts = new Map(
      rows.map((_, i) => [
        `file_${i}`,
        excerptRow({ id: `file_${i}`, name: `doc${i}.pdf`, textExcerpt: 'y'.repeat(4000) }),
      ])
    )
    const out = mapRowsToThreadMessages(rows, ASSISTANT, fileExcerpts)
    expect(out).toHaveLength(7)
    // Every bracket line survives on every turn, whatever the budget did.
    for (let i = 0; i < 7; i++) {
      expect(out[i].content).toContain(`[Attached file: doc${i}.pdf (PDF)]`)
    }
    // The 6 newest turns (indices 1..6, oldest-first) keep their full
    // excerpt; the oldest turn (index 0) is the one pushed out once the
    // thread-wide 24,000-char budget (6 x 4000) is spent.
    for (let i = 1; i < 7; i++) {
      expect(out[i].content).toContain('y'.repeat(4000))
    }
    expect(out[0].content).not.toContain('y')
  })

  it('never surfaces a document block for a human_agent or assistant turn', () => {
    const rows = [
      msg({
        senderType: 'agent',
        authorId: AGENT,
        content: 'forwarding this',
        attachments: [docAttachment()],
      }),
    ]
    const fileExcerpts = new Map([['file_1', excerptRow()]])
    expect(mapRowsToThreadMessages(rows, ASSISTANT, fileExcerpts)).toEqual([
      { sender: 'human_agent', content: 'forwarding this' },
    ])
  })

  // Internal notes are agent-only (isInternal is only ever true on a
  // senderType: 'agent' row — addAgentNote never writes a visitor-authored
  // note), and loadConversationThread's default excludes them from the rows
  // this mapper ever sees. Both guards hold independently: even an internal
  // note that somehow reached the mapper (includeInternal: true, the copilot
  // grounding path) would still be excluded here on sender type alone, never
  // on isInternal — so a customer-facing turn never surfaces a teammate's
  // note attachment regardless of which guard is doing the work.
  it("never surfaces an internal note's attached file on a customer-facing turn", () => {
    const rows = [
      msg({
        senderType: 'agent',
        authorId: AGENT,
        isInternal: true,
        content: 'internal doc for the team',
        attachments: [docAttachment()],
      }),
    ]
    const fileExcerpts = new Map([['file_1', excerptRow()]])
    const out = mapRowsToThreadMessages(rows, ASSISTANT, fileExcerpts)
    expect(out).toEqual([{ sender: 'human_agent', content: 'internal doc for the team' }])
    expect(out[0].content).not.toContain('Attached file')
  })

  it('leaves image attachments on the existing vision path, untouched by document handling', () => {
    const rows = [
      msg({
        senderType: 'visitor',
        content: 'see this',
        attachments: [
          { url: '/x.png', name: 'shot.png', contentType: 'image/png', size: 10 },
          docAttachment(),
        ],
      }),
    ]
    const fileExcerpts = new Map([['file_1', excerptRow()]])
    const out = mapRowsToThreadMessages(rows, ASSISTANT, fileExcerpts)
    expect(out[0].attachments).toEqual([
      { url: '/x.png', name: 'shot.png', contentType: 'image/png', size: 10 },
    ])
    expect(out[0].content).toContain('[Attached file: invoice.pdf (PDF)]')
  })
})

describe('loadThreadFileExcerpts', () => {
  it('collects only non-image fileIds from visitor messages, deduped', async () => {
    const mockLoad = vi.fn().mockResolvedValue(new Map())
    vi.doMock('@/lib/server/domains/files/files.excerpts', () => ({
      loadFileExcerpts: mockLoad,
    }))
    vi.resetModules()
    const { loadThreadFileExcerpts } = await import('../assistant.thread')

    const rows = [
      msg({
        senderType: 'visitor',
        content: 'two docs, one image, one dup',
        attachments: [
          { url: '/a', name: 'a.pdf', contentType: 'application/pdf', size: 1, fileId: 'file_1' },
          { url: '/b', name: 'b.pdf', contentType: 'application/pdf', size: 1, fileId: 'file_1' },
          {
            url: '/c',
            name: 'c.docx',
            contentType: 'application/msword',
            size: 1,
            fileId: 'file_2',
          },
          { url: '/d', name: 'd.png', contentType: 'image/png', size: 1, fileId: 'file_3' },
        ],
      }),
      msg({
        senderType: 'agent',
        authorId: AGENT,
        content: 'agent note',
        attachments: [
          { url: '/e', name: 'e.pdf', contentType: 'application/pdf', size: 1, fileId: 'file_9' },
        ],
      }),
    ]
    await loadThreadFileExcerpts(rows)

    expect(mockLoad).toHaveBeenCalledTimes(1)
    const [ids] = mockLoad.mock.calls[0]
    expect([...ids].sort()).toEqual(['file_1', 'file_2'])
    vi.doUnmock('@/lib/server/domains/files/files.excerpts')
    vi.resetModules()
  })

  it('returns an empty map without importing files.excerpts when there is nothing to load', async () => {
    const { loadThreadFileExcerpts } = await import('../assistant.thread')
    const rows = [msg({ senderType: 'visitor', content: 'just text' })]
    expect(await loadThreadFileExcerpts(rows)).toEqual(new Map())
  })
})
