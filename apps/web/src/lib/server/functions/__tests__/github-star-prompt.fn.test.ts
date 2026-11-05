import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'

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
  stage: null as 'card' | 'home' | null,
  stars: 341 as number | null,
  marks: [] as { userId: string; key: string }[],
  alreadyMarked: false,
  starReads: 0,
}))

vi.mock('../auth-helpers', () => ({
  requireAuth: async (options?: { permission?: string }) => {
    if (options?.permission && !hoisted.permissions.includes(options.permission)) {
      throw new Error(`Access denied: Requires permission '${options.permission}'`)
    }
    return { user: { id: 'user_caller' }, principal: { id: 'principal_caller' } }
  },
}))

vi.mock('@/lib/server/github-star-prompt', () => ({
  getStarPromptStage: async () => hoisted.stage,
}))

vi.mock('@/lib/server/github-star-count', () => ({
  readStarCount: async () => {
    hoisted.starReads += 1
    return hoisted.stars
  },
}))

vi.mock('@/lib/server/onboarding-progress', () => ({
  markOnboardingProgress: async (userId: string, key: string) => {
    hoisted.marks.push({ userId, key })
    return !hoisted.alreadyMarked
  },
}))

import { getStarPromptFn, markStarPromptShownFn } from '../github-star-prompt'

describe('star prompt server functions', () => {
  beforeEach(() => {
    hoisted.permissions = [PERMISSIONS.MEMBER_VIEW]
    hoisted.stage = null
    hoisted.marks = []
    hoisted.starReads = 0
    hoisted.alreadyMarked = false
  })

  it('is for team members only', async () => {
    hoisted.permissions = []
    await expect(getStarPromptFn()).rejects.toThrow(/member.view/)
    await expect(markStarPromptShownFn()).rejects.toThrow(/member.view/)
  })

  it('does not ask GitHub for the count when the prompt cannot show', async () => {
    expect(await getStarPromptFn()).toEqual({ stage: null, stars: null })
    expect(hoisted.starReads).toBe(0)
  })

  it('returns the stage with the star count when it can show', async () => {
    hoisted.stage = 'card'
    expect(await getStarPromptFn()).toEqual({ stage: 'card', stars: 341 })
  })

  it('claims the prompt for this person, and says when another tab got there first', async () => {
    expect(await markStarPromptShownFn()).toEqual({ claimed: true })
    expect(hoisted.marks).toEqual([{ userId: 'user_caller', key: 'githubStarPromptAt' }])
    hoisted.alreadyMarked = true
    expect(await markStarPromptShownFn()).toEqual({ claimed: false })
  })
})
