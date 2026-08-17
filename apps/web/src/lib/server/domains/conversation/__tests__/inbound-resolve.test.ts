import { describe, expect, it } from 'vitest'
import { resolveInboundConversation } from '../conversation.inbound-resolve'
import type { ConversationId } from '@quackback/ids'

const ID = 'conversation_01kw8qxn1eeh4t2rek7varh032' as ConversationId

describe('resolveInboundConversation', () => {
  it('prefers the correlation key', async () => {
    const id = await resolveInboundConversation({
      lookupCorrelation: async () => ID,
      lookupOpenBySender: async () => 'conversation_other' as ConversationId,
    })
    expect(id).toBe(ID)
  })

  it('falls back to the sender open conversation, then create', async () => {
    const open = await resolveInboundConversation({
      lookupCorrelation: async () => null,
      lookupOpenBySender: async () => ID,
    })
    expect(open).toBe(ID)
    const create = await resolveInboundConversation({
      lookupCorrelation: async () => null,
    })
    expect(create).toBeNull()
  })
})
