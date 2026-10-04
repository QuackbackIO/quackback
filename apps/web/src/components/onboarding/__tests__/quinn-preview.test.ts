import { describe, expect, it } from 'vitest'
import type { ConversationId, ConversationMessageId, PrincipalId } from '@quackback/ids'
import type { AgentThreadCache } from '@/components/conversation/events-reducer'
import { asAgentMessage, type ConversationMessageDTO } from '@/lib/shared/conversation/types'
import { QUINN_PREVIEW_ID, applyQuinnPreview } from '../quinn-preview'

const CONV = 'conversation_01kw8qxn1eeh4t2rek7varh032' as ConversationId
const QUINN = {
  principalId: 'principal_quinn' as PrincipalId,
  displayName: 'Quinn',
  avatarUrl: null,
}

function message(over: Partial<ConversationMessageDTO>): ConversationMessageDTO {
  return {
    id: 'conversation_msg_1' as ConversationMessageId,
    conversationId: CONV,
    ticketId: null,
    senderType: 'visitor',
    content: 'Hi! Is anyone there?',
    createdAt: '2026-10-04T10:00:00.000Z',
    author: null,
    attachments: [],
    citations: [],
    isAssistant: false,
    isInternal: false,
    contentJson: null,
    viaEmail: false,
    systemEvent: null,
    ...over,
  }
}

function thread(messages: ConversationMessageDTO[]): AgentThreadCache {
  return {
    conversation: { id: CONV } as AgentThreadCache['conversation'],
    messages: messages.map(asAgentMessage),
  }
}

const delta = (text: string) => ({
  kind: 'assistant_delta' as const,
  conversationId: CONV,
  text,
  at: '2026-10-04T10:00:01.000Z',
})

describe('applyQuinnPreview', () => {
  it('shows a streaming Quinn turn as one growing message', () => {
    const base = thread([
      message({}),
      message({
        id: 'conversation_msg_0' as ConversationMessageId,
        senderType: 'agent',
        isAssistant: true,
        author: QUINN,
      }),
    ])
    const first = applyQuinnPreview(base, delta('Hi!'))!
    const second = applyQuinnPreview(first, delta('Hi! I am here.'))!
    const previews = second.messages.filter((m) => m.id === QUINN_PREVIEW_ID)
    expect(previews).toHaveLength(1)
    expect(previews[0]).toMatchObject({
      content: 'Hi! I am here.',
      isAssistant: true,
      senderType: 'agent',
      author: QUINN,
    })
    expect(second.messages.at(-1)!.id).toBe(QUINN_PREVIEW_ID)
  })

  it('drops the preview when the turn retracts it or the real reply lands', () => {
    const streaming = applyQuinnPreview(thread([message({})]), delta('Hi!'))!
    expect(applyQuinnPreview(streaming, delta(''))!.messages.map((m) => m.id)).toEqual([
      'conversation_msg_1',
    ])
    const landed = applyQuinnPreview(streaming, {
      kind: 'message',
      conversationId: CONV,
      message: message({
        id: 'conversation_msg_2' as ConversationMessageId,
        isAssistant: true,
        senderType: 'agent',
      }),
    })!
    expect(landed.messages.some((m) => m.id === QUINN_PREVIEW_ID)).toBe(false)
  })

  it('leaves the thread alone for other events and before it has loaded', () => {
    const base = thread([message({})])
    expect(
      applyQuinnPreview(base, { kind: 'typing', conversationId: CONV, side: 'visitor', at: '' })
    ).toBe(base)
    expect(applyQuinnPreview(undefined, delta('Hi!'))).toBeUndefined()
  })
})
