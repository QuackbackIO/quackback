import { describe, it, expect } from 'vitest'
import { toMessageDTO } from '../conversation.query'

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

describe('toMessageDTO embed', () => {
  it('surfaces a quackbackEmbed post doc on contentJson', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'quackbackEmbed', attrs: { kind: 'post', id: 'post_1' } }],
    }
    const dto = toMessageDTO(msg({ contentJson: doc }), null)
    expect(dto.contentJson).toEqual(doc)
  })
  it('is null when there is no rich content', () => {
    expect(toMessageDTO(msg({}), null).contentJson).toBeNull()
  })
})
