/**
 * Tests for setConversationAttributeValueFn (unified inbox §3.5): the
 * teammate inline-edit write path, generalized to a conversation OR a ticket
 * target. The required permission depends on the target, so the gate is bare
 * and the per-target permission is asserted at runtime (mirrors
 * bulkUpdateConversationsFn) — these tests assert that branch plus the
 * exactly-one-of-{conversationId,ticketId} input contract.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createId, type ConversationId, type TicketId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { permissionsForLegacyRole } from '@/lib/server/policy/permissions'
import type { Role } from '@/lib/server/auth'
import type { PermissionKey } from '@/lib/server/db'

// createServerFn → directly-callable fn that runs the real zod validator
// (mirrors macros.test.ts / assistant-snippets.test.ts) — the exactly-one-of
// {conversationId, ticketId} contract lives in the schema's .refine(), so the
// validator must actually run for the input-contract tests below to mean
// anything.
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let _schema: { parse: (v: unknown) => unknown } | null = null
    let _handler: ((args: { data: unknown }) => Promise<unknown>) | null = null
    const fn = async (args?: { data: unknown }) => {
      if (!_handler) throw new Error('handler not registered')
      return _handler({ data: _schema ? _schema.parse(args?.data) : args?.data })
    }
    fn.validator = (schema: { parse: (v: unknown) => unknown }) => {
      _schema = schema
      return fn
    }
    fn.handler = (h: (args: { data: unknown }) => Promise<unknown>) => {
      _handler = h
      return fn
    }
    return fn
  },
}))

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  setConversationAttribute: vi.fn(),
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
  // Exercise the REAL per-role permission check so the target-dependent gate is
  // meaningfully asserted (the policy module is not mocked); mirrors
  // conversation-bulk.test.ts.
  const { permissionsForLegacyRole } = await import('@/lib/server/policy/permissions')
  return {
    requireAuth: hoisted.requireAuth,
    assertPermission: (role: Role, permission: PermissionKey) => {
      if (!permissionsForLegacyRole(role).has(permission)) {
        throw new Error(`Access denied: Requires permission '${permission}', role ${role} lacks it`)
      }
    },
  }
})

vi.mock('@/lib/server/domains/conversation-attributes/conversation-attribute.service', () => ({
  listConversationAttributes: vi.fn(),
  createConversationAttribute: vi.fn(),
  updateConversationAttribute: vi.fn(),
  archiveConversationAttribute: vi.fn(),
  restoreConversationAttribute: vi.fn(),
}))

vi.mock('@/lib/server/domains/conversation-attributes/set-attribute.service', () => ({
  setConversationAttribute: hoisted.setConversationAttribute,
}))

import { setConversationAttributeValueFn } from '../conversation-attributes'

const AUTH = {
  user: { id: 'user_agent1', email: 'agent@x', name: 'Agent', image: null },
  principal: { id: 'principal_agent1', role: 'admin' as const, type: 'user' },
  settings: { id: 'ws_1', slug: 'x', name: 'X', logoKey: null },
}

const conversationId = createId('conversation') as ConversationId
const ticketId = createId('ticket') as TicketId

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (data: any) => setConversationAttributeValueFn({ data })

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue(AUTH)
  hoisted.setConversationAttribute.mockResolvedValue({ plan: { v: 'pro', src: 'teammate' } })
})

describe('setConversationAttributeValueFn — input contract', () => {
  it('rejects a payload with neither conversationId nor ticketId', async () => {
    await expect(call({ key: 'plan', value: 'pro' })).rejects.toThrow()
    expect(hoisted.setConversationAttribute).not.toHaveBeenCalled()
  })

  it('rejects a payload with both conversationId and ticketId', async () => {
    await expect(call({ conversationId, ticketId, key: 'plan', value: 'pro' })).rejects.toThrow()
    expect(hoisted.setConversationAttribute).not.toHaveBeenCalled()
  })

  it('rejects a malformed conversationId (wrong TypeID prefix)', async () => {
    await expect(call({ conversationId: ticketId, key: 'plan', value: 'pro' })).rejects.toThrow()
    expect(hoisted.setConversationAttribute).not.toHaveBeenCalled()
  })

  it('rejects a malformed ticketId (wrong TypeID prefix)', async () => {
    await expect(call({ ticketId: conversationId, key: 'plan', value: 'pro' })).rejects.toThrow()
    expect(hoisted.setConversationAttribute).not.toHaveBeenCalled()
  })
})

describe('setConversationAttributeValueFn — conversation target', () => {
  it('writes through with a bare requireAuth + conversation.set_attributes', async () => {
    await call({ conversationId, key: 'plan', value: 'pro' })
    expect(hoisted.requireAuth).toHaveBeenCalledWith()
    expect(hoisted.setConversationAttribute).toHaveBeenCalledWith(
      { conversationId },
      'plan',
      'pro',
      'teammate'
    )
  })

  it('rejects a role lacking conversation.set_attributes', async () => {
    const lacks = !permissionsForLegacyRole('user').has(PERMISSIONS.CONVERSATION_SET_ATTRIBUTES)
    expect(lacks).toBe(true)
    hoisted.requireAuth.mockResolvedValue({
      ...AUTH,
      principal: { ...AUTH.principal, role: 'user' as const },
    })
    await expect(call({ conversationId, key: 'plan', value: 'pro' })).rejects.toThrow(
      /conversation\.set_attributes/
    )
    expect(hoisted.setConversationAttribute).not.toHaveBeenCalled()
  })
})

describe('setConversationAttributeValueFn — ticket target', () => {
  it('writes through with a bare requireAuth + ticket.set_status', async () => {
    await call({ ticketId, key: 'plan', value: 'enterprise' })
    expect(hoisted.requireAuth).toHaveBeenCalledWith()
    expect(hoisted.setConversationAttribute).toHaveBeenCalledWith(
      { ticketId },
      'plan',
      'enterprise',
      'teammate'
    )
  })

  it('rejects a ticket write without ticket.set_status', async () => {
    const lacks = !permissionsForLegacyRole('user').has(PERMISSIONS.TICKET_SET_STATUS)
    expect(lacks).toBe(true)
    hoisted.requireAuth.mockResolvedValue({
      ...AUTH,
      principal: { ...AUTH.principal, role: 'user' as const },
    })
    await expect(call({ ticketId, key: 'plan', value: 'enterprise' })).rejects.toThrow(
      /ticket\.set_status/
    )
    expect(hoisted.setConversationAttribute).not.toHaveBeenCalled()
  })

  it('allows a member (holds ticket.set_status) to write a ticket attribute', async () => {
    const holds = permissionsForLegacyRole('member').has(PERMISSIONS.TICKET_SET_STATUS)
    expect(holds).toBe(true)
    hoisted.requireAuth.mockResolvedValue({
      ...AUTH,
      principal: { ...AUTH.principal, role: 'member' as const },
    })
    await call({ ticketId, key: 'plan', value: 'enterprise' })
    expect(hoisted.setConversationAttribute).toHaveBeenCalledWith(
      { ticketId },
      'plan',
      'enterprise',
      'teammate'
    )
  })
})
