import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ConversationId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import type { MacroAction } from '@/lib/server/db'

// vi.hoisted so the fns exist when the (statically-imported, via the shared
// action executor) mock factories run at module load.
const {
  assignConversation,
  assignTeam,
  setConversationPriority,
  snoozeConversation,
  setConversationStatus,
  attachTag,
  setConversationAttribute,
} = vi.hoisted(() => ({
  assignConversation: vi.fn(),
  assignTeam: vi.fn(),
  setConversationPriority: vi.fn(),
  snoozeConversation: vi.fn(),
  setConversationStatus: vi.fn(),
  attachTag: vi.fn(),
  setConversationAttribute: vi.fn(),
}))

vi.mock('@/lib/server/domains/conversation/conversation.service', () => ({
  assignConversation,
  assignTeam,
  setConversationPriority,
  snoozeConversation,
  setConversationStatus,
}))
vi.mock('@/lib/server/domains/conversation/conversation-tag.service', () => ({
  attachTag,
}))
vi.mock('@/lib/server/domains/conversation-attributes/set-attribute.service', () => ({
  setConversationAttribute,
}))

import { applyMacroActions } from '../macro.actions'

const conversationId = 'conversation_1' as ConversationId
const actor = {
  principalId: 'principal_a',
  role: 'admin',
  principalType: 'user',
} as unknown as Actor

beforeEach(() => {
  vi.clearAllMocks()
})

describe('applyMacroActions', () => {
  it('dispatches each supported action to its conversation service', async () => {
    const actions: MacroAction[] = [
      { type: 'assign_agent', principalId: 'principal_x' },
      { type: 'assign_team', teamId: 'team_1' },
      { type: 'add_tag', tagId: 'ctag_1' },
      { type: 'set_priority', priority: 'high' },
      { type: 'snooze', preset: 'tomorrow' },
      { type: 'close' },
    ]
    const applied = await applyMacroActions(conversationId, actions, actor)

    expect(assignConversation).toHaveBeenCalledWith(conversationId, 'principal_x', actor)
    expect(assignTeam).toHaveBeenCalledWith(conversationId, 'team_1', actor)
    expect(attachTag).toHaveBeenCalledWith(conversationId, 'ctag_1')
    expect(setConversationPriority).toHaveBeenCalledWith(conversationId, 'high', actor)
    expect(snoozeConversation).toHaveBeenCalledWith(conversationId, expect.any(Date), actor)
    expect(setConversationStatus).toHaveBeenCalledWith(conversationId, 'closed', actor)
    expect(applied).toEqual([
      'assigned',
      'assigned to team',
      'tagged',
      'priority high',
      'snoozed',
      'closed',
    ])
  })

  it('snooze until_reply defers with a null wake time', async () => {
    await applyMacroActions(conversationId, [{ type: 'snooze', preset: 'until_reply' }], actor)
    expect(snoozeConversation).toHaveBeenCalledWith(conversationId, null, actor)
  })

  it('applies set_attribute as the invoking teammate (macros run as the agent)', async () => {
    const applied = await applyMacroActions(
      conversationId,
      [{ type: 'set_attribute', key: 'plan', value: 'scale' }],
      actor
    )
    expect(setConversationAttribute).toHaveBeenCalledWith(
      { conversationId },
      'plan',
      'scale',
      'teammate'
    )
    expect(applied).toEqual(['set plan'])
  })

  it('continues past a failing action', async () => {
    assignConversation.mockRejectedValueOnce(new Error('boom'))
    const applied = await applyMacroActions(
      conversationId,
      [{ type: 'assign_agent', principalId: 'principal_x' }, { type: 'close' }],
      actor
    )
    expect(applied).toEqual(['closed'])
    expect(setConversationStatus).toHaveBeenCalled()
  })
})
