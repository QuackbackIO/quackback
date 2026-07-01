import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ConversationId, PrincipalId } from '@quackback/ids'
import type { Conversation } from '@/lib/server/db'

const listOnlineAgentIds = vi.fn<() => Promise<string[]>>()
let principalRows: Array<{ id: string; role: string }> = []
// One row per open conversation currently assigned to an agent (counted in app code).
let loadRows: Array<{ agent: string }> = []
const getLiveChatConfig = vi.fn()

vi.mock('@/lib/server/realtime/presence', () => ({
  listOnlineAgentIds: (...a: []) => listOnlineAgentIds(...a),
}))

vi.mock('@/lib/server/db', () => {
  // .select().from(table).where() resolves per table: the principal lookup vs
  // the open-load lookup. `from` is set before each (sequential) await. Tables
  // are defined inside the factory (vi.mock is hoisted above module consts).
  const principalTable = { id: 'id', role: 'role' }
  const conversationsTable = { assignedAgentPrincipalId: 'assigned', status: 'status' }
  let from: unknown
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.from = (t: unknown) => {
    from = t
    return chain
  }
  chain.where = async () => (from === conversationsTable ? loadRows : principalRows)
  return {
    db: { select: () => chain },
    principal: principalTable,
    conversations: conversationsTable,
    inArray: vi.fn(),
    eq: vi.fn(),
    and: vi.fn(),
  }
})

vi.mock('@/lib/server/domains/settings/settings.widget', () => ({
  getLiveChatConfig: (...a: []) => getLiveChatConfig(...a),
}))

import { autoAssignActiveStrategy, pickLeastLoaded } from '../strategies/auto-assign-active'
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
  loadRows = []
})

describe('pickLeastLoaded', () => {
  const p = (s: string) => s as unknown as PrincipalId
  it('returns null with no candidates', () => {
    expect(pickLeastLoaded([], new Map())).toBeNull()
  })
  it('prefers the agent carrying the fewest open conversations', () => {
    const load = new Map([[p('principal_amy'), 3]])
    expect(pickLeastLoaded([p('principal_amy'), p('principal_zoe')], load)).toBe('principal_zoe')
  })
  it('breaks ties lexicographically (absent load = 0)', () => {
    expect(pickLeastLoaded([p('principal_zoe'), p('principal_amy')], new Map())).toBe(
      'principal_amy'
    )
  })
})

describe('autoAssignActiveStrategy', () => {
  it('returns no assignment when no agents are online', async () => {
    listOnlineAgentIds.mockResolvedValue([])
    expect((await autoAssignActiveStrategy.route(ctx)).assignedPrincipalId).toBeNull()
  })

  it('assigns the lexicographically-first online team agent when load is equal', async () => {
    listOnlineAgentIds.mockResolvedValue(['principal_zoe', 'principal_amy'])
    principalRows = [
      { id: 'principal_zoe', role: 'member' },
      { id: 'principal_amy', role: 'admin' },
    ]
    expect((await autoAssignActiveStrategy.route(ctx)).assignedPrincipalId).toBe('principal_amy')
  })

  it('prefers the least-loaded online agent over the lexicographically-first', async () => {
    listOnlineAgentIds.mockResolvedValue(['principal_amy', 'principal_zoe'])
    principalRows = [
      { id: 'principal_amy', role: 'admin' },
      { id: 'principal_zoe', role: 'member' },
    ]
    // Amy (lexicographically first) already carries 3 open chats; Zoe carries none.
    loadRows = [{ agent: 'principal_amy' }, { agent: 'principal_amy' }, { agent: 'principal_amy' }]
    expect((await autoAssignActiveStrategy.route(ctx)).assignedPrincipalId).toBe('principal_zoe')
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
