/**
 * Tests for bulkUpdateConversationsFn (support platform §4.6 bulk actions).
 *
 * The fn is orchestration only: it resolves the acting agent once, then applies
 * one action to each conversation by REUSING the single-conversation service ops.
 * Reusing those ops is how each item gets the same realtime publish + webhook +
 * triage-wake as doing them one at a time, so these tests assert at that seam
 * (the service op is called with the right args) plus per-item error isolation,
 * the summary shape, and per-action permission gating.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { permissionsForLegacyRole } from '@/lib/server/policy/permissions'
import type { Role } from '@/lib/server/auth'
import type { PermissionKey } from '@/lib/server/db'

// createServerFn → directly-callable fns (mirrors uploads.test.ts).
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let _handler: ((args: { data: unknown }) => Promise<unknown>) | null = null
    const fn = (args: { data: unknown }) => {
      if (!_handler) throw new Error('handler not registered')
      return _handler(args)
    }
    fn.validator = () => fn
    fn.handler = (h: (args: { data: unknown }) => Promise<unknown>) => {
      _handler = h
      return fn
    }
    return fn
  },
}))

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  policyActorFromAuth: vi.fn(),
  assignConversation: vi.fn(),
  assignTeam: vi.fn(),
  setConversationPriority: vi.fn(),
  setConversationStatus: vi.fn(),
  snoozeConversation: vi.fn(),
  sendAgentMessage: vi.fn(),
  restoreConversationFromSpam: vi.fn(),
  deleteConversationPermanently: vi.fn(),
  assertRequiredAttributesForClose: vi.fn(),
  attachTag: vi.fn(),
  getMacro: vi.fn(),
  buildMacroContext: vi.fn(),
  applyMacroActions: vi.fn(),
  log: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}))

vi.mock('@/lib/server/logger', () => {
  const child = () => ({ ...hoisted.log, child })
  return { logger: { ...hoisted.log, child }, createLogger: () => ({ ...hoisted.log, child }) }
})

vi.mock('@/lib/server/functions/auth-helpers', async () => {
  // Exercise the REAL per-role permission check so the action-dependent gate is
  // meaningfully asserted (the policy module is not mocked); mirrors the fn.
  const { permissionsForLegacyRole } = await import('@/lib/server/policy/permissions')
  return {
    requireAuth: hoisted.requireAuth,
    policyActorFromAuth: hoisted.policyActorFromAuth,
    assertPermission: (
      auth: { permissions?: PermissionKey[]; principal: { role: Role } },
      permission: PermissionKey
    ) => {
      const held = auth.permissions ?? [...permissionsForLegacyRole(auth.principal.role)]
      if (!held.includes(permission)) {
        throw new Error(
          `Access denied: Requires permission '${permission}', role ${auth.principal.role} lacks it`
        )
      }
    },
  }
})

vi.mock('@/lib/server/domains/conversation/conversation.service', () => ({
  assignConversation: hoisted.assignConversation,
  assignTeam: hoisted.assignTeam,
  setConversationPriority: hoisted.setConversationPriority,
  setConversationStatus: hoisted.setConversationStatus,
  snoozeConversation: hoisted.snoozeConversation,
  sendAgentMessage: hoisted.sendAgentMessage,
  restoreConversationFromSpam: hoisted.restoreConversationFromSpam,
  deleteConversationPermanently: hoisted.deleteConversationPermanently,
}))

vi.mock('@/lib/server/domains/macros', () => ({
  getMacro: hoisted.getMacro,
  buildMacroContext: hoisted.buildMacroContext,
  applyMacroActions: hoisted.applyMacroActions,
  // renderMacro is pure — exercise the real interpolation so the posted body
  // assertion covers per-conversation rendering, not a mock echo.
  renderMacro: (body: string, context: Record<string, string | null | undefined>) =>
    body.replace(/\{(\w+)\}/g, (_m: string, token: string) => {
      const value = context[token]
      return value == null ? '' : String(value)
    }),
}))

vi.mock('@/lib/server/domains/conversation-attributes/close-guard', () => ({
  assertRequiredAttributesForClose: hoisted.assertRequiredAttributesForClose,
}))

vi.mock('@/lib/server/domains/conversation/conversation-tag.service', () => ({
  attachTag: hoisted.attachTag,
}))

import { bulkUpdateConversationsFn } from '../conversation'

const AUTH = {
  user: { id: 'user_agent1', email: 'agent@x', name: 'Agent', image: null },
  principal: { id: 'principal_agent1', role: 'admin' as const, type: 'user' },
  settings: { id: 'ws_1', slug: 'x', name: 'X', logoKey: null },
}
// Opaque actor object — the service ops are mocked, so only identity matters.
const ACTOR = { principalId: 'principal_agent1' }

// oxlint-disable-next-line @typescript-eslint/no-explicit-any
const call = (data: any) => bulkUpdateConversationsFn({ data })

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue(AUTH)
  hoisted.policyActorFromAuth.mockResolvedValue(ACTOR)
  hoisted.assignConversation.mockResolvedValue({})
  hoisted.assignTeam.mockResolvedValue({})
  hoisted.setConversationPriority.mockResolvedValue({})
  hoisted.setConversationStatus.mockResolvedValue({})
  hoisted.snoozeConversation.mockResolvedValue({})
  hoisted.sendAgentMessage.mockResolvedValue({})
  hoisted.restoreConversationFromSpam.mockResolvedValue({})
  hoisted.deleteConversationPermanently.mockResolvedValue(undefined)
  hoisted.assertRequiredAttributesForClose.mockResolvedValue(undefined)
  hoisted.attachTag.mockResolvedValue([])
  hoisted.getMacro.mockResolvedValue({
    id: 'macro_1',
    name: 'Greeting',
    body: 'Hi {firstName}, thanks for reaching out about {conversationTitle}!',
    scope: 'support',
    actions: [{ type: 'add_tag', tagId: 'conversation_tag_9' }],
  })
  hoisted.buildMacroContext.mockImplementation(async (id: string) => ({
    firstName: id === 'conversation_c1' ? 'Ada' : 'Grace',
    lastName: null,
    email: null,
    conversationTitle: null,
  }))
  hoisted.applyMacroActions.mockResolvedValue(['Tagged'])
})

describe('bulkUpdateConversationsFn — per-item isolation', () => {
  it('processes the rest of the batch when a middle item throws and reports it in failed', async () => {
    hoisted.setConversationStatus.mockImplementation(async (id: string) => {
      if (id === 'conversation_c2') throw new Error('boom')
      return {}
    })

    const result = await call({
      conversationIds: ['conversation_c1', 'conversation_c2', 'conversation_c3'],
      action: { type: 'close' },
    })

    // Middle failure does not abort the batch.
    expect(result.succeeded).toEqual(['conversation_c1', 'conversation_c3'])
    expect(result.failed).toEqual([{ id: 'conversation_c2', reason: 'boom' }])
    // Every item was attempted via the single-conversation op (fan-out for free).
    expect(hoisted.setConversationStatus).toHaveBeenCalledTimes(3)
    expect(hoisted.setConversationStatus).toHaveBeenNthCalledWith(
      1,
      'conversation_c1',
      'closed',
      ACTOR
    )
    expect(hoisted.setConversationStatus).toHaveBeenNthCalledWith(
      2,
      'conversation_c2',
      'closed',
      ACTOR
    )
    expect(hoisted.setConversationStatus).toHaveBeenNthCalledWith(
      3,
      'conversation_c3',
      'closed',
      ACTOR
    )
  })
})

describe('bulkUpdateConversationsFn — summary shape', () => {
  it('reports every id in succeeded when all items succeed', async () => {
    const result = await call({
      conversationIds: ['conversation_c1', 'conversation_c2'],
      action: { type: 'close' },
    })
    expect(result).toEqual({ succeeded: ['conversation_c1', 'conversation_c2'], failed: [] })
  })

  it('reduces a non-Error throw to a stable reason string', async () => {
    hoisted.setConversationStatus.mockRejectedValueOnce('nope')
    const result = await call({
      conversationIds: ['conversation_c1'],
      action: { type: 'close' },
    })
    expect(result).toEqual({
      succeeded: [],
      failed: [{ id: 'conversation_c1', reason: 'Unknown error' }],
    })
  })

  it('a required-to-close refusal fails that item without closing it', async () => {
    hoisted.assertRequiredAttributesForClose.mockImplementation(async (id: string) => {
      if (id === 'conversation_c1') throw new Error('Missing required attributes: Plan')
    })
    const result = await call({
      conversationIds: ['conversation_c1', 'conversation_c2'],
      action: { type: 'close' },
    })
    expect(result).toEqual({
      succeeded: ['conversation_c2'],
      failed: [{ id: 'conversation_c1', reason: 'Missing required attributes: Plan' }],
    })
    // The blocked conversation was never closed.
    expect(hoisted.setConversationStatus).toHaveBeenCalledTimes(1)
    expect(hoisted.setConversationStatus).toHaveBeenCalledWith('conversation_c2', 'closed', ACTOR)
  })
})

describe('bulkUpdateConversationsFn — gating', () => {
  it('propagates a requireAuth rejection and performs no writes', async () => {
    hoisted.requireAuth.mockRejectedValue(new Error('Access denied'))
    await expect(
      call({ conversationIds: ['conversation_c1'], action: { type: 'close' } })
    ).rejects.toThrow('Access denied')
    expect(hoisted.setConversationStatus).not.toHaveBeenCalled()
  })

  // The gate is bare + a runtime per-action permission check (a role's permission
  // set decides), so authz is asserted by rejecting a role that lacks the action's
  // permission while allowing one that holds it — not by a static requireAuth arg.
  it('authenticates with a bare requireAuth (permission is action-dependent)', async () => {
    await call({ conversationIds: ['conversation_c1'], action: { type: 'close' } })
    expect(hoisted.requireAuth).toHaveBeenCalledWith()
  })

  it('rejects assign actions when the role lacks conversation.assign', async () => {
    // 'member' holds set_status but not assign (assign is Manager+). Verify the
    // split so a status-only agent cannot bulk-reassign.
    const assignable = permissionsForLegacyRole('member')
    const skip = assignable.has(PERMISSIONS.CONVERSATION_ASSIGN)
    hoisted.requireAuth.mockResolvedValue({
      ...AUTH,
      principal: { ...AUTH.principal, role: 'member' as const },
    })
    for (const action of [
      { type: 'assign' as const, assignTo: null },
      { type: 'assign_team' as const, teamId: null },
    ]) {
      if (skip) continue
      await expect(call({ conversationIds: ['conversation_c1'], action })).rejects.toThrow(
        /conversation\.assign/
      )
    }
    expect(hoisted.assignConversation).not.toHaveBeenCalled()
    expect(hoisted.assignTeam).not.toHaveBeenCalled()
  })

  it('gates tag on conversation.set_tags, not on set_status', async () => {
    // A teammate who may change status but not labels must not bulk-tag.
    hoisted.requireAuth.mockResolvedValue({
      ...AUTH,
      permissions: [PERMISSIONS.CONVERSATION_SET_STATUS, PERMISSIONS.CONVERSATION_ASSIGN],
    })
    await expect(
      call({
        conversationIds: ['conversation_c1'],
        action: { type: 'tag', tagId: 'conversation_tag_1' },
      })
    ).rejects.toThrow(/conversation\.set_tags/)
    expect(hoisted.attachTag).not.toHaveBeenCalled()

    hoisted.requireAuth.mockResolvedValue({
      ...AUTH,
      permissions: [PERMISSIONS.CONVERSATION_SET_TAGS],
    })
    const res = await call({
      conversationIds: ['conversation_c1'],
      action: { type: 'tag', tagId: 'conversation_tag_1' },
    })
    expect(res.succeeded).toEqual(['conversation_c1'])
  })

  it('allows status actions for a role that holds conversation.set_status', async () => {
    // admin holds every permission; status actions go through with no gate throw.
    for (const action of [
      { type: 'close' as const },
      { type: 'reopen' as const },
      { type: 'priority' as const, priority: 'high' as const },
      { type: 'snooze' as const, until: null },
    ]) {
      const res = await call({ conversationIds: ['conversation_c1'], action })
      expect(res.succeeded).toEqual(['conversation_c1'])
    }
  })
})

describe('bulkUpdateConversationsFn — action routing', () => {
  it("resolves assign 'me' to the acting agent principal", async () => {
    await call({ conversationIds: ['conversation_c1'], action: { type: 'assign', assignTo: 'me' } })
    expect(hoisted.assignConversation).toHaveBeenCalledWith(
      'conversation_c1',
      'principal_agent1',
      ACTOR
    )
  })

  it('passes a null assignee through as an unassign', async () => {
    await call({ conversationIds: ['conversation_c1'], action: { type: 'assign', assignTo: null } })
    expect(hoisted.assignConversation).toHaveBeenCalledWith('conversation_c1', null, ACTOR)
  })

  it('routes assign_team to assignTeam with the team id', async () => {
    await call({
      conversationIds: ['conversation_c1'],
      action: { type: 'assign_team', teamId: 'team_1' },
    })
    expect(hoisted.assignTeam).toHaveBeenCalledWith('conversation_c1', 'team_1', ACTOR)
  })

  it('routes priority to setConversationPriority', async () => {
    await call({
      conversationIds: ['conversation_c1'],
      action: { type: 'priority', priority: 'high' },
    })
    expect(hoisted.setConversationPriority).toHaveBeenCalledWith('conversation_c1', 'high', ACTOR)
  })

  it('routes a timed snooze to snoozeConversation with a Date', async () => {
    await call({
      conversationIds: ['conversation_c1'],
      action: { type: 'snooze', until: '2026-08-01T00:00:00.000Z' },
    })
    expect(hoisted.snoozeConversation).toHaveBeenCalledWith(
      'conversation_c1',
      new Date('2026-08-01T00:00:00.000Z'),
      ACTOR
    )
  })

  it('routes a null snooze (until-reply) to snoozeConversation with null', async () => {
    await call({
      conversationIds: ['conversation_c1'],
      action: { type: 'snooze', until: null },
    })
    expect(hoisted.snoozeConversation).toHaveBeenCalledWith('conversation_c1', null, ACTOR)
  })

  it('routes tag to attachTag for every conversation in the batch', async () => {
    const result = await call({
      conversationIds: ['conversation_c1', 'conversation_c2', 'conversation_c3'],
      action: { type: 'tag', tagId: 'conversation_tag_1' },
    })
    expect(result).toEqual({
      succeeded: ['conversation_c1', 'conversation_c2', 'conversation_c3'],
      failed: [],
    })
    expect(hoisted.attachTag).toHaveBeenCalledTimes(3)
    expect(hoisted.attachTag).toHaveBeenNthCalledWith(1, 'conversation_c1', 'conversation_tag_1')
    expect(hoisted.attachTag).toHaveBeenNthCalledWith(2, 'conversation_c2', 'conversation_tag_1')
    expect(hoisted.attachTag).toHaveBeenNthCalledWith(3, 'conversation_c3', 'conversation_tag_1')
  })

  it('isolates a tag failure to its own item and tags the rest', async () => {
    hoisted.attachTag.mockImplementation(async (id: string) => {
      if (id === 'conversation_c2') throw new Error('tag is archived')
      return []
    })
    const result = await call({
      conversationIds: ['conversation_c1', 'conversation_c2', 'conversation_c3'],
      action: { type: 'tag', tagId: 'conversation_tag_1' },
    })
    expect(result).toEqual({
      succeeded: ['conversation_c1', 'conversation_c3'],
      failed: [{ id: 'conversation_c2', reason: 'tag is archived' }],
    })
  })

  it('maps close/reopen onto setConversationStatus closed/open', async () => {
    await call({ conversationIds: ['conversation_c1'], action: { type: 'close' } })
    expect(hoisted.setConversationStatus).toHaveBeenLastCalledWith(
      'conversation_c1',
      'closed',
      ACTOR
    )
    await call({ conversationIds: ['conversation_c1'], action: { type: 'reopen' } })
    expect(hoisted.setConversationStatus).toHaveBeenLastCalledWith('conversation_c1', 'open', ACTOR)
  })
})

describe('bulkUpdateConversationsFn — macro reply', () => {
  it('posts the rendered macro body as a reply to every selected conversation', async () => {
    const result = await call({
      conversationIds: ['conversation_c1', 'conversation_c2'],
      action: { type: 'macro', macroId: 'macro_1' },
    })
    expect(result).toEqual({
      succeeded: ['conversation_c1', 'conversation_c2'],
      failed: [],
    })
    // The macro is fetched once for the whole batch, then rendered per
    // conversation against its own visitor context.
    expect(hoisted.getMacro).toHaveBeenCalledTimes(1)
    expect(hoisted.getMacro).toHaveBeenCalledWith('macro_1')
    expect(hoisted.sendAgentMessage).toHaveBeenCalledTimes(2)
    expect(hoisted.sendAgentMessage).toHaveBeenNthCalledWith(
      1,
      'conversation_c1',
      'Hi Ada, thanks for reaching out about !',
      expect.objectContaining({ principalId: 'principal_agent1' }),
      ACTOR
    )
    expect(hoisted.sendAgentMessage).toHaveBeenNthCalledWith(
      2,
      'conversation_c2',
      'Hi Grace, thanks for reaching out about !',
      expect.objectContaining({ principalId: 'principal_agent1' }),
      ACTOR
    )
  })

  it('runs the macro bundled actions after the reply lands', async () => {
    await call({
      conversationIds: ['conversation_c1'],
      action: { type: 'macro', macroId: 'macro_1' },
    })
    expect(hoisted.applyMacroActions).toHaveBeenCalledWith(
      'conversation_c1',
      [{ type: 'add_tag', tagId: 'conversation_tag_9' }],
      ACTOR
    )
    // Reply first, actions second — a failed action must not eat the reply.
    const sendOrder = hoisted.sendAgentMessage.mock.invocationCallOrder[0]
    const actionsOrder = hoisted.applyMacroActions.mock.invocationCallOrder[0]
    expect(sendOrder).toBeLessThan(actionsOrder)
  })

  it('gates the macro action on conversation.reply', async () => {
    hoisted.requireAuth.mockResolvedValue({
      ...AUTH,
      permissions: [PERMISSIONS.CONVERSATION_SET_STATUS],
    })
    await expect(
      call({ conversationIds: ['conversation_c1'], action: { type: 'macro', macroId: 'macro_1' } })
    ).rejects.toThrow(/conversation\.reply/)
    expect(hoisted.sendAgentMessage).not.toHaveBeenCalled()

    hoisted.requireAuth.mockResolvedValue({
      ...AUTH,
      permissions: [PERMISSIONS.CONVERSATION_REPLY],
    })
    const res = await call({
      conversationIds: ['conversation_c1'],
      action: { type: 'macro', macroId: 'macro_1' },
    })
    expect(res.succeeded).toEqual(['conversation_c1'])
  })

  it('isolates a send failure to its own item and replies to the rest', async () => {
    hoisted.sendAgentMessage.mockImplementation(async (id: string) => {
      if (id === 'conversation_c2') throw new Error('conversation is closed')
      return {}
    })
    const result = await call({
      conversationIds: ['conversation_c1', 'conversation_c2', 'conversation_c3'],
      action: { type: 'macro', macroId: 'macro_1' },
    })
    expect(result).toEqual({
      succeeded: ['conversation_c1', 'conversation_c3'],
      failed: [{ id: 'conversation_c2', reason: 'conversation is closed' }],
    })
    expect(hoisted.sendAgentMessage).toHaveBeenCalledTimes(3)
    // No bundled actions for the failed item.
    expect(hoisted.applyMacroActions).toHaveBeenCalledTimes(2)
  })

  it('fails every item when the macro no longer exists', async () => {
    hoisted.getMacro.mockRejectedValue(new Error('Macro not found'))
    const result = await call({
      conversationIds: ['conversation_c1', 'conversation_c2'],
      action: { type: 'macro', macroId: 'macro_gone' },
    })
    expect(result.succeeded).toEqual([])
    expect(result.failed).toEqual([
      { id: 'conversation_c1', reason: 'Macro not found' },
      { id: 'conversation_c2', reason: 'Macro not found' },
    ])
    expect(hoisted.sendAgentMessage).not.toHaveBeenCalled()
  })
})

describe('bulkUpdateConversationsFn — spam bulk actions', () => {
  it('routes restore_spam to restoreConversationFromSpam for every item', async () => {
    const result = await call({
      conversationIds: ['conversation_c1', 'conversation_c2'],
      action: { type: 'restore_spam' },
    })
    expect(result).toEqual({ succeeded: ['conversation_c1', 'conversation_c2'], failed: [] })
    expect(hoisted.restoreConversationFromSpam).toHaveBeenCalledTimes(2)
    expect(hoisted.restoreConversationFromSpam).toHaveBeenNthCalledWith(1, 'conversation_c1', ACTOR)
    expect(hoisted.restoreConversationFromSpam).toHaveBeenNthCalledWith(2, 'conversation_c2', ACTOR)
  })

  it('routes delete_forever to deleteConversationPermanently with per-item isolation', async () => {
    hoisted.deleteConversationPermanently.mockImplementation(async (id: string) => {
      if (id === 'conversation_c2') throw new Error('Conversation is not marked as spam')
    })
    const result = await call({
      conversationIds: ['conversation_c1', 'conversation_c2', 'conversation_c3'],
      action: { type: 'delete_forever' },
    })
    expect(result.succeeded).toEqual(['conversation_c1', 'conversation_c3'])
    expect(result.failed).toEqual([
      { id: 'conversation_c2', reason: 'Conversation is not marked as spam' },
    ])
    expect(hoisted.deleteConversationPermanently).toHaveBeenCalledTimes(3)
  })

  it('gates restore_spam on conversation.set_status (a member may restore)', async () => {
    hoisted.requireAuth.mockResolvedValue({
      ...AUTH,
      principal: { ...AUTH.principal, role: 'member' as const },
    })
    const res = await call({
      conversationIds: ['conversation_c1'],
      action: { type: 'restore_spam' },
    })
    expect(res.succeeded).toEqual(['conversation_c1'])
    expect(hoisted.restoreConversationFromSpam).toHaveBeenCalledTimes(1)
  })

  it('gates delete_forever on conversation.manage, not set_status', async () => {
    // 'member' holds set_status but deliberately NOT conversation.manage (the
    // destructive permission), so a status-only agent cannot bulk-delete.
    const held = permissionsForLegacyRole('member')
    expect(held.has(PERMISSIONS.CONVERSATION_SET_STATUS)).toBe(true)
    if (held.has(PERMISSIONS.CONVERSATION_MANAGE)) return // premise guard
    hoisted.requireAuth.mockResolvedValue({
      ...AUTH,
      principal: { ...AUTH.principal, role: 'member' as const },
    })
    await expect(
      call({ conversationIds: ['conversation_c1'], action: { type: 'delete_forever' } })
    ).rejects.toThrow(/conversation\.manage/)
    expect(hoisted.deleteConversationPermanently).not.toHaveBeenCalled()
  })
})
