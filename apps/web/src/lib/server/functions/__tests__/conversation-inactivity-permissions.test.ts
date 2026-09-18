import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'
const mock = vi.hoisted(() => ({ auth: vi.fn(), update: vi.fn() }))
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let schema: { parse: (value: unknown) => unknown } | undefined
    let handler: (args: { data: unknown }) => Promise<unknown>
    const fn = async (args?: { data: unknown }) =>
      handler({ data: schema ? schema.parse(args?.data) : args?.data })
    fn.validator = (s: typeof schema) => {
      schema = s
      return fn
    }
    fn.handler = (h: typeof handler) => {
      handler = h
      return fn
    }
    return fn
  },
}))
vi.mock('../auth-helpers', async (original) => ({
  ...(await original<typeof import('../auth-helpers')>()),
  requireAuth: mock.auth,
}))
vi.mock('@/lib/server/domains/settings/settings.conversation-inactivity', () => ({
  updateConversationInactivitySettings: mock.update,
}))
import { updateConversationInactivityFn } from '../settings'
beforeEach(() => {
  vi.clearAllMocks()
  mock.update.mockResolvedValue({ revision: 1 })
})
describe('section-scoped inactivity authorization', () => {
  for (const [section, permission] of [
    ['messenger', PERMISSIONS.SETTINGS_MANAGE],
    ['email', PERMISSIONS.CHANNEL_ACCOUNT_MANAGE],
    ['assistant', PERMISSIONS.ASSISTANT_MANAGE],
  ] as const) {
    it(`${section} requires its own page permission`, async () => {
      mock.auth.mockResolvedValue({
        scope: 'dashboard',
        principal: { role: 'member' },
        permissions: [permission],
      })
      await expect(
        updateConversationInactivityFn({ data: { section, revision: 0, policy: {} } })
      ).resolves.toEqual({ revision: 1 })
      mock.auth.mockResolvedValue({
        scope: 'dashboard',
        principal: { role: 'member' },
        permissions: [PERMISSIONS.CONVERSATION_MANAGE],
      })
      await expect(
        updateConversationInactivityFn({ data: { section, revision: 0, policy: {} } })
      ).rejects.toThrow('Requires permission')
    })
  }
  it('rejects cross-section payloads before any mutation', async () => {
    mock.auth.mockResolvedValue({
      scope: 'dashboard',
      principal: { role: 'admin' },
      permissions: Object.values(PERMISSIONS),
    })
    await expect(
      updateConversationInactivityFn({
        data: { section: 'email', revision: 0, policy: {}, assistant: { enabled: false } } as never,
      })
    ).rejects.toThrow()
    await expect(
      updateConversationInactivityFn({
        data: { section: 'assistant', revision: 0, policy: {}, mode: 'off' } as never,
      })
    ).rejects.toThrow()
    expect(mock.update).not.toHaveBeenCalled()
  })
})
