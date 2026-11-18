/**
 * The Plan limits server functions: a chooser needs billing rights or the
 * permission that manages what it picks, and refuses as a value otherwise.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  setKeptBoard: vi.fn(async (_id: string) => ({ ok: true as const })),
  setSeatHolders: vi.fn(async (_ids: string[]) => ({ ok: true as const })),
}))

vi.mock('@/lib/server/functions/auth-helpers', async (original) => ({
  ...(await original<typeof import('@/lib/server/functions/auth-helpers')>()),
  requireAuth: hoisted.requireAuth,
}))
vi.mock('@/lib/server/domains/plan-limits/plan-limits.service', () => ({
  setKeptBoard: (id: string) => hoisted.setKeptBoard(id),
  setSeatHolders: (ids: string[]) => hoisted.setSeatHolders(ids),
}))

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>
const handlers: AnyHandler[] = []
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator() {
        return chain
      },
      handler(fn: AnyHandler) {
        handlers.push(fn)
        return chain
      },
    }
    return chain
  },
}))

await import('../plan-limits')
// Declaration order: get, board, seats, status components, sending domains.
const [, setKeptBoard, setSeatHolders] = handlers

beforeEach(() => vi.clearAllMocks())

const teammate = (permissions: string[]) => ({
  permissions,
  scope: 'dashboard',
  principal: { id: 'principal_me', role: 'member', type: 'user' },
})

describe('plan limits choosers', () => {
  it('lets a billing manager keep a board', async () => {
    hoisted.requireAuth.mockResolvedValue(teammate([PERMISSIONS.BILLING_MANAGE]))
    await expect(setKeptBoard!({ data: { boardId: 'board_1' } })).resolves.toEqual({ ok: true })
    expect(hoisted.setKeptBoard).toHaveBeenCalledWith('board_1')
  })

  it('lets a settings manager keep a board without billing rights', async () => {
    hoisted.requireAuth.mockResolvedValue(teammate([PERMISSIONS.SETTINGS_MANAGE]))
    await expect(setKeptBoard!({ data: { boardId: 'board_1' } })).resolves.toEqual({ ok: true })
  })

  it('refuses seat choices to someone who can neither manage billing nor members', async () => {
    hoisted.requireAuth.mockResolvedValue(teammate([PERMISSIONS.SETTINGS_MANAGE]))
    await expect(setSeatHolders!({ data: { ids: ['principal_1'] } })).rejects.toThrow(
      /Access denied/
    )
    expect(hoisted.setSeatHolders).not.toHaveBeenCalled()
  })

  it('needs a signed-in teammate', async () => {
    hoisted.requireAuth.mockRejectedValue(new Error('Authentication required'))
    await expect(setSeatHolders!({ data: { ids: [] } })).rejects.toThrow(/auth/i)
  })
})
