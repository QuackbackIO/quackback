import { describe, it, expect } from 'vitest'
import { setConversationPriority } from '../conversation.service'
import type { Actor } from '@/lib/server/policy/types'
import type { ConversationId } from '@quackback/ids'

// A non-team (anonymous) actor — the agent guard runs before any DB access, so
// this rejects without a database.
const visitor: Actor = {
  principalId: 'principal_visitor' as unknown as Actor['principalId'],
  role: 'user',
  principalType: 'anonymous',
  segmentIds: new Set(),
}

const convId = 'conversation_x' as unknown as ConversationId

describe('conversation priority mutations require an agent', () => {
  it('setConversationPriority rejects a non-agent', async () => {
    await expect(setConversationPriority(convId, 'high', visitor)).rejects.toThrow()
  })
})
