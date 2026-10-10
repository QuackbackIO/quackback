import { describe, expect, it } from 'vitest'
import { pendingDowngradeIsLive } from '../pending-downgrade-state'

describe('pendingDowngradeIsLive', () => {
  it('holds while the workspace still sits above the pending plan', () => {
    expect(
      pendingDowngradeIsLive({ currentPlan: 'pro', pendingPlan: 'free', trialUndecided: false })
    ).toBe(true)
  })

  it('is stale once the workspace sits on or below it', () => {
    expect(
      pendingDowngradeIsLive({ currentPlan: 'free', pendingPlan: 'free', trialUndecided: false })
    ).toBe(false)
  })

  it('holds after an ended trial, which already resolves to Free but has not switched', () => {
    // Regression: the stale check compared Free with Free and dropped the
    // lock on the next navigation, so an expired trial that chose Free while
    // over its limits was never held to the clean-up pages.
    expect(
      pendingDowngradeIsLive({ currentPlan: 'free', pendingPlan: 'free', trialUndecided: true })
    ).toBe(true)
  })
})
