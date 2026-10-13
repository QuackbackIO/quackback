import { beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ auth: vi.fn(), actor: vi.fn(), flags: vi.fn(), keyword: vi.fn(), semantic: vi.fn() }))
vi.mock('@tanstack/react-start', () => ({ createServerFn: () => {
  let schema: { parse: (value: unknown) => unknown }
  return { inputValidator(value: typeof schema) { schema = value; return this }, handler(fn: (args: { data: unknown }) => unknown) { return (args: { data: unknown }) => fn({ data: schema.parse(args.data) }) } }
} }))
vi.mock('@tanstack/react-start/server', () => ({ getRequest: () => new Request('http://localhost/admin/search') }))
vi.mock('../auth-helpers', () => ({ requireAuth: state.auth, policyActorFromAuth: state.actor }))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({ getFeatureFlags: state.flags }))
vi.mock('@/lib/server/domains/assistant/ask-search', () => ({ searchAskEntities: state.keyword }))
vi.mock('@/lib/server/domains/assistant/workspace-semantic-search', () => ({ searchWorkspaceSemantically: state.semantic }))
import { searchWorkspaceEntitiesFn } from '../workspace-search'
beforeEach(() => { vi.resetAllMocks(); state.auth.mockResolvedValue({ scope: 'dashboard', principal: { role: 'member' } }); state.actor.mockResolvedValue({ principalId: 'you', permissions: new Set() }); state.flags.mockResolvedValue({ feedback: true }); state.keyword.mockResolvedValue([]); state.semantic.mockResolvedValue({ available: false, results: [] }) })
it('refuses a portal session before reading workspace content', async () => {
  state.auth.mockResolvedValue({ scope: 'portal', principal: { role: 'user' } })
  await expect(searchWorkspaceEntitiesFn({ data: { query: 'billing' } })).rejects.toMatchObject({ code: 'DASHBOARD_REQUIRED' })
  expect(state.keyword).not.toHaveBeenCalled(); expect(state.semantic).not.toHaveBeenCalled()
})
it('uses the effective actor for ordinary search without asking an embedding provider', async () => {
  await searchWorkspaceEntitiesFn({ data: { query: ' billing ', kind: 'post' } })
  expect(state.keyword).toHaveBeenCalledWith('billing', await state.actor.mock.results[0].value, { feedback: true }, { kind: 'post', limit: 10, detailed: true })
  expect(state.semantic).not.toHaveBeenCalled()
})
it('bounds semantic work and preserves its separate availability result', async () => {
  expect(await searchWorkspaceEntitiesFn({ data: { query: 'slow pages', mode: 'semantic' } })).toEqual({ available: false, results: [] })
  expect(state.semantic).toHaveBeenCalledWith('slow pages', expect.any(Object), { feedback: true }, { kind: undefined, limit: 10, signal: expect.any(AbortSignal) })
  expect(state.keyword).not.toHaveBeenCalled()
})
