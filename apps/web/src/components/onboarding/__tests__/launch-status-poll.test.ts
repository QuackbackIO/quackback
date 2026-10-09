import { describe, expect, it } from 'vitest'
import type { LaunchStatus } from '@/lib/shared/launch-checklist'
import { launchStatusRefetchInterval } from '../use-launch-plan'

const supportOnly: LaunchStatus = {
  hasBoards: false,
  memberCount: 1,
  hasBranding: false,
  goals: ['customer_support'],
  hasFirstWin: false,
  features: {
    supportInbox: true,
    helpCenter: false,
    statusPage: false,
    integrations: true,
    assistant: false,
  },
}

describe('launch status polling', () => {
  it('polls while the plan is open', () => {
    expect(launchStatusRefetchInterval(supportOnly)).toBe(15_000)
  })

  it('keeps polling with every chore done, until the first win', () => {
    const chores = { ...supportOnly, hasWidgetInstalled: true, hasWidgetEnabled: true }
    expect(launchStatusRefetchInterval(chores)).toBe(15_000)
    expect(launchStatusRefetchInterval({ ...chores, hasFirstWin: true })).toBe(false)
  })

  it('waits for data', () => {
    expect(launchStatusRefetchInterval(undefined)).toBe(false)
  })
})
