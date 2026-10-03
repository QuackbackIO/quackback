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

  it('stops once the plan is resolved, even before a first win', () => {
    const resolved = { ...supportOnly, hasWidgetInstalled: true, hasWidgetEnabled: true }
    expect(resolved.hasFirstWin).toBe(false)
    expect(launchStatusRefetchInterval(resolved)).toBe(false)
  })

  it('waits for data', () => {
    expect(launchStatusRefetchInterval(undefined)).toBe(false)
  })
})
