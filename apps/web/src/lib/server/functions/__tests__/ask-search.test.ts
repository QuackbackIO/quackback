import { beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  auth: vi.fn(),
  actor: vi.fn(),
  flags: vi.fn(),
  search: vi.fn(),
  signal: new AbortController().signal,
}))
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let schema: { parse: (value: unknown) => unknown }
    const builder = {
      inputValidator(value: typeof schema) {
        schema = value
        return builder
      },
      handler(fn: (args: { data: unknown }) => unknown) {
        return async (args: { data: unknown }) => fn({ data: schema.parse(args.data) })
      },
    }
    return builder
  },
}))
vi.mock('@tanstack/react-start/server', () => ({ getRequest: () => ({ signal: state.signal }) }))
vi.mock('../auth-helpers', () => ({ requireAuth: state.auth, policyActorFromAuth: state.actor }))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({ getFeatureFlags: state.flags }))
vi.mock('@/lib/server/domains/assistant/ask-search', () => ({ searchWorkspace: state.search }))

import { searchWorkspaceFn } from '../ask-search'

const actor = { principalId: 'principal_you', permissions: new Set() }
beforeEach(() => {
  vi.resetAllMocks()
  state.auth.mockResolvedValue({ scope: 'dashboard', principal: { role: 'member' } })
  state.actor.mockResolvedValue(actor)
  state.flags.mockResolvedValue({ feedback: true })
  state.search.mockResolvedValue({ results: [], hasMore: false })
})

it('refuses a portal session before reading any workspace content', async () => {
  state.auth.mockResolvedValue({ scope: 'portal', principal: { role: 'user' } })
  await expect(searchWorkspaceFn({ data: { query: 'billing' } })).rejects.toThrow(/team dashboard/)
  expect(state.search).not.toHaveBeenCalled()
})

it('searches as the effective actor, full text only by default', async () => {
  await searchWorkspaceFn({ data: { query: ' billing ', kind: 'company' } })
  expect(state.search).toHaveBeenCalledWith(
    'billing',
    actor,
    { feedback: true },
    {
      kind: 'company',
      offset: 0,
      limit: 20,
      semantic: false,
      signal: undefined,
    }
  )
})

it('bounds a semantic search by the request and a time budget', async () => {
  await searchWorkspaceFn({ data: { query: 'slow pages', semantic: true, offset: 20 } })
  const options = state.search.mock.calls[0][3]
  expect(options).toMatchObject({ semantic: true, offset: 20 })
  expect(options.signal).toBeInstanceOf(AbortSignal)
})

it('rejects kinds it does not know and pages past the depth limit', async () => {
  await expect(
    searchWorkspaceFn({ data: { query: 'x', kind: 'invoice' as never } })
  ).rejects.toThrow()
  await expect(searchWorkspaceFn({ data: { query: 'x', offset: 500 } })).rejects.toThrow()
  expect(state.search).not.toHaveBeenCalled()
})
