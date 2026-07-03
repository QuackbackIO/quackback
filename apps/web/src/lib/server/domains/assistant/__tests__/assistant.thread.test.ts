import { describe, it, expect } from 'vitest'
import { mapRowsToThreadMessages } from '../assistant.thread'
import type { ConversationMessageDTO } from '@/lib/shared/conversation/types'
import type { PrincipalId } from '@quackback/ids'

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
