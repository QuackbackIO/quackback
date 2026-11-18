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
  getPlanLimits: vi.fn(),
  getPlanLimitsWithCandidates: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', async (original) => ({
  ...(await original<typeof import('@/lib/server/functions/auth-helpers')>()),
  requireAuth: hoisted.requireAuth,
}))
vi.mock('@/lib/server/domains/plan-limits/plan-limits.choosers', () => ({
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

vi.mock('@/lib/server/domains/plan-limits/plan-limits.service', () => ({
  getPlanLimits: () => hoisted.getPlanLimits(),
  getPlanLimitsWithCandidates: () => hoisted.getPlanLimitsWithCandidates(),
}))

await import('../plan-limits')
// Declaration order: get, board, seats, status components, sending domains, summary.
const [getPlanLimits, setKeptBoard, setSeatHolders] = handlers
const getPlanLimitsSummary = handlers[5]

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

  it('reads the page only for a teammate who can see members, never a portal user', async () => {
    hoisted.requireAuth.mockRejectedValue(new Error('Access denied'))
    await expect(getPlanLimits!({ data: {} })).rejects.toThrow(/Access denied/)
    expect(hoisted.requireAuth).toHaveBeenCalledWith({ permission: PERMISSIONS.MEMBER_VIEW })
  })

  it('needs a signed-in teammate', async () => {
    hoisted.requireAuth.mockRejectedValue(new Error('Authentication required'))
    await expect(setSeatHolders!({ data: { ids: [] } })).rejects.toThrow(/auth/i)
  })
})

describe('plan limits summary', () => {
  const graceView = {
    enabled: true,
    phase: 'grace',
    plan: 'free',
    since: '2026-11-18T00:00:00.000Z',
    graceEndsAt: '2026-11-25T00:00:00.000Z',
    fromPlan: 'pro',
    issues: [
      {
        key: 'maxBoards',
        used: 5,
        cap: 1,
        message: 'You have 5 out of 1 boards',
        actionLabel: 'Remove 4 boards',
        href: '/admin/settings/boards',
      },
    ],
    infoRows: [],
    featureIssues: [],
    features: {},
    fromFeatures: null,
    openBoardIds: ['b1'],
    keptBoardId: 'b1',
    seatHolderIds: null,
    visibleStatusComponentIds: null,
    sendingDomainIds: null,
  }

  it('reads the state without loading any chooser candidates', async () => {
    hoisted.requireAuth.mockResolvedValue(teammate([PERMISSIONS.MEMBER_VIEW]))
    hoisted.getPlanLimits.mockResolvedValue(graceView)
    const summary = (await getPlanLimitsSummary!({ data: {} })) as Record<string, unknown>
    expect(hoisted.requireAuth).toHaveBeenCalledWith({ permission: PERMISSIONS.MEMBER_VIEW })
    expect(hoisted.getPlanLimitsWithCandidates).not.toHaveBeenCalled()
    expect(summary).toMatchObject({
      phase: 'grace',
      planName: 'Free',
      canManageBilling: false,
      candidates: {},
    })
    expect((summary.issues as unknown[]).length).toBe(1)
  })
})
