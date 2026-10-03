import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'

const DAY = 86_400_000

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain: Record<string, unknown> = {}
    chain.validator = () => chain
    chain.handler = (handler: (args: { data?: unknown }) => Promise<unknown>) =>
      Object.assign((args?: { data?: unknown }) => handler(args ?? {}), chain)
    return chain
  },
}))

const hoisted = vi.hoisted(() => ({
  permissions: [] as string[],
  marks: [] as { userId: string; key: string }[],
  settings: null as { setupState: string; createdAt: Date } | null,
  win: { reached: false, reachedAt: null as string | null },
}))

vi.mock('../auth-helpers', () => ({
  requireAuth: async (options?: { permission?: string }) => {
    if (options?.permission && !hoisted.permissions.includes(options.permission)) {
      throw new Error(`Access denied: Requires permission '${options.permission}'`)
    }
    return { user: { id: 'user_caller' } }
  },
}))
vi.mock('@/lib/server/onboarding-progress', () => ({
  readOnboardingProgress: () => ({}),
  markOnboardingProgress: async (userId: string, key: string) => {
    hoisted.marks.push({ userId, key })
    return true
  },
}))
vi.mock('../workspace', () => ({ getSettings: async () => hoisted.settings }))
vi.mock('@/lib/server/activation-wins', () => ({
  detectFirstWin: async (state: { completedAt?: string } | null) => {
    // The win is only reported for the setup state the workspace really has.
    expect(state?.completedAt).toBe(JSON.parse(hoisted.settings!.setupState).completedAt)
    return hoisted.win
  },
}))

const { markTourSeenFn, dismissTourOfferFn, claimFirstWinMomentFn } =
  await import('../onboarding-progress')

function workspace(createdAt: number, completedAt: number) {
  hoisted.settings = {
    createdAt: new Date(createdAt),
    setupState: JSON.stringify({
      version: 2,
      steps: {
        core: true,
        workspace: true,
        startingPoint: {
          outcome: 'product_feedback',
          resourceType: 'none',
          source: 'wizard',
          resolution: 'deferred',
          completedAt: new Date(completedAt).toISOString(),
        },
      },
      completedAt: new Date(completedAt).toISOString(),
      useCase: 'product_feedback',
    }),
  }
}

beforeEach(() => {
  hoisted.permissions = [PERMISSIONS.MEMBER_VIEW as PermissionKey]
  hoisted.marks = []
  hoisted.settings = null
  hoisted.win = { reached: false, reachedAt: null }
})

describe('tour markers', () => {
  it('refuse a caller who is not a team member', async () => {
    hoisted.permissions = []
    await expect(markTourSeenFn()).rejects.toThrow(/member\.view/)
    await expect(dismissTourOfferFn()).rejects.toThrow(/member\.view/)
    expect(hoisted.marks).toEqual([])
  })

  it('record seen and Not now separately for the caller', async () => {
    await markTourSeenFn()
    await dismissTourOfferFn()
    expect(hoisted.marks).toEqual([
      { userId: 'user_caller', key: 'tourSeenAt' },
      { userId: 'user_caller', key: 'tourDismissedAt' },
    ])
  })
})

describe('first-win celebration claim', () => {
  it('celebrates a win inside a new workspace launch window', async () => {
    const now = Date.now()
    workspace(now - 2 * DAY, now - 2 * DAY + 60_000)
    hoisted.win = { reached: true, reachedAt: new Date(now - DAY).toISOString() }
    expect(await claimFirstWinMomentFn()).toEqual({ show: true })
    expect(hoisted.marks).toEqual([{ userId: 'user_caller', key: 'firstWinShownAt' }])
  })

  it('never celebrates for an established workspace after an upgrade', async () => {
    const now = Date.now()
    workspace(now - 400 * DAY, now - 60_000)
    hoisted.win = { reached: true, reachedAt: new Date(now - 300 * DAY).toISOString() }
    expect(await claimFirstWinMomentFn()).toEqual({ show: false })
    expect(hoisted.marks).toEqual([])
  })

  it('ignores a win that predates setup and a workspace whose window closed', async () => {
    const now = Date.now()
    workspace(now - 2 * DAY, now - DAY)
    hoisted.win = { reached: true, reachedAt: new Date(now - 2 * DAY).toISOString() }
    expect(await claimFirstWinMomentFn()).toEqual({ show: false })

    workspace(now - 30 * DAY, now - 30 * DAY)
    hoisted.win = { reached: true, reachedAt: new Date(now - 29 * DAY).toISOString() }
    expect(await claimFirstWinMomentFn()).toEqual({ show: false })
    expect(hoisted.marks).toEqual([])
  })

  it('needs a reached win', async () => {
    const now = Date.now()
    workspace(now - DAY, now - DAY)
    expect(await claimFirstWinMomentFn()).toEqual({ show: false })
    expect(hoisted.marks).toEqual([])
  })
})
