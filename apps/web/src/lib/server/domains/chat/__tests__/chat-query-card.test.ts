import { describe, it, expect } from 'vitest'
import { toMessageDTO } from '../chat.query'

function msg(overrides: any) {
  return {
    id: 'chatmsg_1',
    conversationId: 'conversation_1',
    senderType: 'agent',
    content: 'I drafted this',
    createdAt: new Date('2026-06-07T00:00:00Z'),
    attachments: null,
    isInternal: false,
    contentJson: null,
    metadata: null,
    principalId: 'principal_a',
    ...overrides,
  } as any
}

describe('toMessageDTO card', () => {
  it('surfaces a draft_post card from metadata', () => {
    const dto = toMessageDTO(
      msg({
        metadata: {
          card: {
            type: 'draft_post',
            status: 'proposed',
            boardId: 'board_1',
            title: 'Dark mode',
            content: 'x',
          },
        },
      }),
      null
    )
    expect(dto.card).toEqual({
      type: 'draft_post',
      status: 'proposed',
      boardId: 'board_1',
      title: 'Dark mode',
      content: 'x',
    })
  })
  it('is null when there is no card', () => {
    expect(toMessageDTO(msg({}), null).card).toBeNull()
  })
})
