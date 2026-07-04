/**
 * The shared workflow action executor (§4.6, Slice 3): each action dispatches to
 * the right conversation service with the right args and returns its label. A
 * thin dispatch layer, so it is unit-tested with the services mocked (apply_sla's
 * deep behavior is covered end-to-end by sla.service.test). Failures propagate —
 * the caller owns best-effort vs fail-fast.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type {
  ConversationId,
  PrincipalId,
  TeamId,
  ConversationTagId,
  SlaPolicyId,
} from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'

// vi.hoisted so the fns exist when the (statically-imported) mock factories run
// at module load, before the top-level consts would otherwise initialize.
const {
  assignConversation,
  assignTeam,
  setConversationPriority,
  snoozeConversation,
  setConversationStatus,
  attachTag,
  detachTag,
  applySlaToConversation,
} = vi.hoisted(() => ({
  assignConversation: vi.fn(),
  assignTeam: vi.fn(),
  setConversationPriority: vi.fn(),
  snoozeConversation: vi.fn(),
  setConversationStatus: vi.fn(),
  attachTag: vi.fn(),
  detachTag: vi.fn(),
  applySlaToConversation: vi.fn(),
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
  detachTag,
}))
vi.mock('@/lib/server/domains/sla/sla.service', () => ({ applySlaToConversation }))

import { applyAction, type WorkflowContext } from '../action.executor'

const conversationId = 'conversation_1' as ConversationId
const actor = { principalId: 'principal_a', role: 'admin' } as unknown as Actor
const ctx: WorkflowContext = { conversationId, actor }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('applyAction', () => {
  it('dispatches each state-change action to its service with the right args', async () => {
    expect(
      await applyAction({ type: 'assign_agent', principalId: 'principal_x' as PrincipalId }, ctx)
    ).toBe('assigned')
    expect(assignConversation).toHaveBeenCalledWith(conversationId, 'principal_x', actor)

    expect(await applyAction({ type: 'assign_team', teamId: 'team_1' as TeamId }, ctx)).toBe(
      'assigned to team'
    )
    expect(assignTeam).toHaveBeenCalledWith(conversationId, 'team_1', actor)

    expect(await applyAction({ type: 'add_tag', tagId: 'ctag_1' as ConversationTagId }, ctx)).toBe(
      'tagged'
    )
    expect(attachTag).toHaveBeenCalledWith(conversationId, 'ctag_1')

    expect(
      await applyAction({ type: 'remove_tag', tagId: 'ctag_1' as ConversationTagId }, ctx)
    ).toBe('untagged')
    expect(detachTag).toHaveBeenCalledWith(conversationId, 'ctag_1')

    expect(await applyAction({ type: 'set_priority', priority: 'high' }, ctx)).toBe('priority high')
    expect(setConversationPriority).toHaveBeenCalledWith(conversationId, 'high', actor)

    expect(await applyAction({ type: 'close' }, ctx)).toBe('closed')
    expect(setConversationStatus).toHaveBeenCalledWith(conversationId, 'closed', actor)
  })

  it('resolves the serializable snooze wake time (or null) to a Date', async () => {
    const untilIso = '2026-01-06T09:00:00.000Z'
    expect(await applyAction({ type: 'snooze', untilIso }, ctx)).toBe('snoozed')
    expect(snoozeConversation).toHaveBeenCalledWith(conversationId, new Date(untilIso), actor)

    await applyAction({ type: 'snooze', untilIso: null }, ctx)
    expect(snoozeConversation).toHaveBeenLastCalledWith(conversationId, null, actor)
  })

  it('applies an SLA policy through the SLA service', async () => {
    expect(
      await applyAction({ type: 'apply_sla', policyId: 'sla_policy_1' as SlaPolicyId }, ctx)
    ).toBe('SLA applied')
    expect(applySlaToConversation).toHaveBeenCalledWith(conversationId, 'sla_policy_1')
  })

  it('no-ops the deferred set_attribute action (null label, no dispatch)', async () => {
    expect(
      await applyAction({ type: 'set_attribute', key: 'plan', value: 'scale' }, ctx)
    ).toBeNull()
  })

  it('propagates a service failure to the caller', async () => {
    setConversationStatus.mockRejectedValueOnce(new Error('boom'))
    await expect(applyAction({ type: 'close' }, ctx)).rejects.toThrow('boom')
  })
})
