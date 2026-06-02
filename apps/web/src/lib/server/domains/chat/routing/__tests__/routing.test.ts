import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ConversationId, PrincipalId } from '@quackback/ids'
import type { Conversation } from '@/lib/server/db'

const listOnlineAgentIds = vi.fn<() => Promise<string[]>>()
let principalRows: Array<{ id: string; role: string }> = []
const getLiveChatConfig = vi.fn()

vi.mock('@/lib/server/realtime/presence', () => ({
  listOnlineAgentIds: (...a: []) => listOnlineAgentIds(...a),
}))

vi.mock('@/lib/server/db', () => {
  // Thenable-ish chain: .select().from().where() resolves to principalRows.
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.from = () => chain
  chain.where = async () => principalRows
  return {
    db: { select: () => chain },
    principal: { id: 'id', role: 'role' },
    inArray: vi.fn(),
  }
})

vi.mock('@/lib/server/domains/settings/settings.widget', () => ({
  getLiveChatConfig: (...a: []) => getLiveChatConfig(...a),
}))

import { autoAssignActiveStrategy } from '../strategies/auto-assign-active'
import { routeConversation } from '../routing.service'

const ctx = {
  conversationId: 'conversation_1' as ConversationId,
  visitorPrincipalId: 'principal_v' as PrincipalId,
}
const conversation = {
  id: 'conversation_1',
  visitorPrincipalId: 'principal_v',
} as unknown as Conversation

beforeEach(() => {
  vi.clearAllMocks()
  principalRows = []
})

describe('autoAssignActiveStrategy', () => {
  it('returns no assignment when no agents are online', async () => {
    listOnlineAgentIds.mockResolvedValue([])
    expect((await autoAssignActiveStrategy.route(ctx)).assignedPrincipalId).toBeNull()
  })

  it('assigns the lexicographically-first online team agent (deterministic)', async () => {
    listOnlineAgentIds.mockResolvedValue(['principal_zoe', 'principal_amy'])
    principalRows = [
      { id: 'principal_zoe', role: 'member' },
      { id: 'principal_amy', role: 'admin' },
    ]
    expect((await autoAssignActiveStrategy.route(ctx)).assignedPrincipalId).toBe('principal_amy')
  })

  it('excludes non-team principals from assignment', async () => {
    listOnlineAgentIds.mockResolvedValue(['principal_user'])
    principalRows = [{ id: 'principal_user', role: 'user' }]
    expect((await autoAssignActiveStrategy.route(ctx)).assignedPrincipalId).toBeNull()
  })
})

describe('routeConversation', () => {
  it('does not assign (or even query agents) when routing is disabled', async () => {
    getLiveChatConfig.mockResolvedValue({
      routing: { enabled: false, strategy: 'auto_assign_active' },
    })
    expect((await routeConversation(conversation)).assignedPrincipalId).toBeNull()
    expect(listOnlineAgentIds).not.toHaveBeenCalled()
  })

  it('does not assign when routing config is absent', async () => {
    getLiveChatConfig.mockResolvedValue({})
    expect((await routeConversation(conversation)).assignedPrincipalId).toBeNull()
  })

  it('delegates to the active-agent strategy when enabled', async () => {
    getLiveChatConfig.mockResolvedValue({
      routing: { enabled: true, strategy: 'auto_assign_active' },
    })
    listOnlineAgentIds.mockResolvedValue(['principal_amy'])
    principalRows = [{ id: 'principal_amy', role: 'admin' }]
    expect((await routeConversation(conversation)).assignedPrincipalId).toBe('principal_amy')
  })

  it('fails soft to no assignment when the strategy throws', async () => {
    getLiveChatConfig.mockResolvedValue({
      routing: { enabled: true, strategy: 'auto_assign_active' },
    })
    listOnlineAgentIds.mockRejectedValue(new Error('redis down'))
    expect((await routeConversation(conversation)).assignedPrincipalId).toBeNull()
  })
})
