/**
 * Tests for the unified inbox server fns (UNIFIED-INBOX-SPEC.md §3.1):
 * `listInboxItemsFn`/`fetchInboxCountsFn` are orchestration only — validate +
 * gate + delegate to the domain service (mocked here), plus a direct check of
 * the zod input schema. Mirrors conversation-bulk.test.ts's createServerFn
 * shim + hoisted-mock style.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// createServerFn → directly-callable fns (mirrors conversation-bulk.test.ts),
// extended to actually run the zod validator (a real schema, not a function)
// so the RBAC/mapping tests below exercise the same input shape prod does.
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let _validator: { parse: (data: unknown) => unknown } | null = null
    let _handler: ((args: { data: unknown }) => Promise<unknown>) | null = null
    const fn = (args: { data?: unknown }) => {
      if (!_handler) throw new Error('handler not registered')
      const data = _validator ? _validator.parse(args.data) : args.data
      return _handler({ data })
    }
    fn.validator = (v: { parse: (data: unknown) => unknown }) => {
      _validator = v
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
  policyActorFromAuth: vi.fn(),
  canViewInboxAtAll: vi.fn(),
  listInboxItems: vi.fn(),
  countInboxScopes: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.requireAuth,
  policyActorFromAuth: hoisted.policyActorFromAuth,
}))

vi.mock('@/lib/server/domains/inbox/inbox.query', () => ({
  canViewInboxAtAll: hoisted.canViewInboxAtAll,
  listInboxItems: hoisted.listInboxItems,
  countInboxScopes: hoisted.countInboxScopes,
}))

import { generateId } from '@quackback/ids'
import { listInboxItemsFn, fetchInboxCountsFn, listInboxItemsSchema } from '../inbox'

const AUTH = {
  user: { id: 'user_agent1', email: 'agent@x', name: 'Agent', image: null },
  principal: { id: 'principal_agent1', role: 'admin' as const, type: 'user' },
  settings: { id: 'ws_1', slug: 'x', name: 'X', logoKey: null },
}
const ACTOR = { principalId: 'principal_agent1' }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (data: any) => listInboxItemsFn({ data })

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue(AUTH)
  hoisted.policyActorFromAuth.mockResolvedValue(ACTOR)
  hoisted.canViewInboxAtAll.mockReturnValue(true)
  hoisted.listInboxItems.mockResolvedValue({ items: [], cursor: null })
  hoisted.countInboxScopes.mockResolvedValue({
    mine: 0,
    unassigned: 0,
    ticketsByType: { customer: 0, back_office: 0, tracker: 0 },
  })
})

describe('listInboxItemsSchema', () => {
  it('accepts a minimal valid payload (facet only)', () => {
    expect(() => listInboxItemsSchema.parse({ facet: 'open' })).not.toThrow()
  })

  it('accepts every declared facet', () => {
    for (const facet of ['open', 'waiting', 'closed', 'all']) {
      expect(() => listInboxItemsSchema.parse({ facet })).not.toThrow()
    }
  })

  it('rejects an unknown facet', () => {
    expect(() => listInboxItemsSchema.parse({ facet: 'snoozed' })).toThrow()
  })

  it('accepts a full payload with kinds/sort/priority/limit', () => {
    expect(() =>
      listInboxItemsSchema.parse({
        facet: 'all',
        kinds: ['conversation', 'ticket'],
        ticketType: 'customer',
        priority: 'urgent',
        search: 'billing',
        assignee: 'me',
        teamId: 'team_1',
        companyId: 'company_1',
        sort: 'priority',
        limit: 50,
        cursor: 'opaque-cursor',
      })
    ).not.toThrow()
  })

  it('rejects an empty kinds array (min 1)', () => {
    expect(() => listInboxItemsSchema.parse({ facet: 'all', kinds: [] })).toThrow()
  })

  it('rejects a kinds array with an unknown kind', () => {
    expect(() => listInboxItemsSchema.parse({ facet: 'all', kinds: ['ticket', 'post'] })).toThrow()
  })

  it('rejects an unknown sort', () => {
    expect(() => listInboxItemsSchema.parse({ facet: 'all', sort: 'sla' })).toThrow()
  })

  it('rejects a limit outside 1..100', () => {
    expect(() => listInboxItemsSchema.parse({ facet: 'all', limit: 0 })).toThrow()
    expect(() => listInboxItemsSchema.parse({ facet: 'all', limit: 101 })).toThrow()
  })
})

describe('listInboxItemsFn', () => {
  it('403s when the actor can view neither conversations nor tickets', async () => {
    hoisted.canViewInboxAtAll.mockReturnValue(false)
    await expect(call({ facet: 'all' })).rejects.toThrow('You cannot view the inbox')
    expect(hoisted.listInboxItems).not.toHaveBeenCalled()
  })

  it('delegates to listInboxItems with the resolved actor once the gate passes', async () => {
    await call({ facet: 'open' })
    expect(hoisted.listInboxItems).toHaveBeenCalledTimes(1)
    const [actorArg, filterArg] = hoisted.listInboxItems.mock.calls[0]
    expect(actorArg).toBe(ACTOR)
    expect(filterArg.facet).toBe('open')
  })

  it("resolves assignee 'me' and 'unassigned' through unchanged", async () => {
    await call({ facet: 'all', assignee: 'me' })
    expect(hoisted.listInboxItems.mock.calls[0][1].assignee).toBe('me')

    await call({ facet: 'all', assignee: 'unassigned' })
    expect(hoisted.listInboxItems.mock.calls[1][1].assignee).toBe('unassigned')
  })

  it('passes a well-formed principal TypeID assignee through', async () => {
    const principalId = generateId('principal')
    await call({ facet: 'all', assignee: principalId })
    expect(hoisted.listInboxItems.mock.calls[0][1].assignee).toBe(principalId)
  })

  it('drops a junk assignee id rather than reaching the query', async () => {
    await call({ facet: 'all', assignee: 'not-a-typeid' })
    expect(hoisted.listInboxItems.mock.calls[0][1].assignee).toBeUndefined()
  })

  it('drops a junk teamId/companyId rather than reaching the query', async () => {
    await call({ facet: 'all', teamId: 'nope', companyId: 'nope' })
    const filterArg = hoisted.listInboxItems.mock.calls[0][1]
    expect(filterArg.teamId).toBeUndefined()
    expect(filterArg.companyId).toBeUndefined()
  })

  it('passes kinds/sort/cursor/limit through untouched', async () => {
    await call({
      facet: 'all',
      kinds: ['ticket'],
      sort: 'priority',
      cursor: 'abc',
      limit: 10,
    })
    const filterArg = hoisted.listInboxItems.mock.calls[0][1]
    expect(filterArg.kinds).toEqual(['ticket'])
    expect(filterArg.sort).toBe('priority')
    expect(filterArg.cursor).toBe('abc')
    expect(filterArg.limit).toBe(10)
  })
})

describe('fetchInboxCountsFn', () => {
  const callCounts = () => fetchInboxCountsFn({ data: undefined })

  it('403s when the actor can view neither conversations nor tickets', async () => {
    hoisted.canViewInboxAtAll.mockReturnValue(false)
    await expect(callCounts()).rejects.toThrow('You cannot view the inbox')
    expect(hoisted.countInboxScopes).not.toHaveBeenCalled()
  })

  it('delegates to countInboxScopes with the resolved actor once the gate passes', async () => {
    const result = await callCounts()
    expect(hoisted.countInboxScopes).toHaveBeenCalledWith(ACTOR)
    expect(result).toEqual({
      mine: 0,
      unassigned: 0,
      ticketsByType: { customer: 0, back_office: 0, tracker: 0 },
    })
  })
})
