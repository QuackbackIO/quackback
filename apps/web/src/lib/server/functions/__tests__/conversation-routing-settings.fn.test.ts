/**
 * The conversation routing switch (Settings > Channels) follows
 * routing.manage, the permission for routing rules, not settings.manage: the
 * Support lead preset, which holds routing.manage and not settings.manage, may
 * read and change it; a role with settings.manage and no routing.manage may
 * not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PERMISSIONS, SYSTEM_ROLE_PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'

type AnyHandler = (args?: { data: Record<string, unknown> }) => Promise<unknown>

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator() {
        return chain
      },
      handler: (fn: AnyHandler) => fn,
    }
    return chain
  },
}))

const hoisted = vi.hoisted(() => ({
  held: [] as string[],
  getConversationRouting: vi.fn(),
  updateConversationRouting: vi.fn(),
}))

/** Refuses as requireAuth does when the caller lacks the permission. */
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: async (opts?: { permission?: string }) => {
    if (opts?.permission && !hoisted.held.includes(opts.permission)) {
      throw new Error(`Access denied: Requires permission '${opts.permission}', role lacks it`)
    }
    return { principal: { id: 'principal_1', role: 'member' }, permissions: hoisted.held }
  },
}))

vi.mock('@/lib/server/domains/settings/settings.conversation-routing', () => ({
  getConversationRouting: hoisted.getConversationRouting,
  updateConversationRouting: hoisted.updateConversationRouting,
}))

const { fetchConversationRoutingFn, updateConversationRoutingFn } = await import('../settings')
const fetchRouting = fetchConversationRoutingFn as unknown as AnyHandler
const updateRouting = updateConversationRoutingFn as unknown as AnyHandler

const ON = { enabled: true, strategy: 'auto_assign_active' }

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.getConversationRouting.mockResolvedValue({ enabled: false })
  hoisted.updateConversationRouting.mockImplementation(async (v: unknown) => v)
})

function hold(permissions: readonly PermissionKey[]) {
  hoisted.held = [...permissions]
}

describe('conversation routing switch', () => {
  it('lets a Support lead read and change it', async () => {
    hold(SYSTEM_ROLE_PERMISSIONS.support_lead)
    expect(SYSTEM_ROLE_PERMISSIONS.support_lead).not.toContain(PERMISSIONS.SETTINGS_MANAGE)
    await expect(fetchRouting()).resolves.toEqual({ enabled: false })
    await expect(updateRouting({ data: ON })).resolves.toEqual(ON)
    expect(hoisted.updateConversationRouting).toHaveBeenCalledWith(ON)
  })

  it('lets an Admin read and change it', async () => {
    hold(SYSTEM_ROLE_PERMISSIONS.admin)
    await expect(fetchRouting()).resolves.toEqual({ enabled: false })
    await expect(updateRouting({ data: ON })).resolves.toEqual(ON)
  })

  it('refuses a role with settings.manage but no routing.manage, and changes nothing', async () => {
    hold([PERMISSIONS.SETTINGS_MANAGE])
    await expect(fetchRouting()).rejects.toThrow(/Access denied/)
    await expect(updateRouting({ data: ON })).rejects.toThrow(/Access denied/)
    expect(hoisted.updateConversationRouting).not.toHaveBeenCalled()
  })

  it('refuses a Contributor', async () => {
    hold(SYSTEM_ROLE_PERMISSIONS.contributor)
    await expect(updateRouting({ data: ON })).rejects.toThrow(/Access denied/)
    expect(hoisted.updateConversationRouting).not.toHaveBeenCalled()
  })
})
