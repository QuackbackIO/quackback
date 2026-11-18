/**
 * The plan limits service double stands in for the whole module, so it must
 * answer every runtime export the real one has: a caller of a helper the
 * double lacks would throw under every suite that uses it. Drift fails here.
 */
import { describe, expect, it } from 'vitest'
import * as real from '../plan-limits.service'
import { planLimitsServiceDouble, setFeatureState } from './feature-states'

describe('planLimitsServiceDouble', () => {
  it('provides every runtime export of plan-limits.service', () => {
    expect(Object.keys(planLimitsServiceDouble).sort()).toEqual(Object.keys(real).sort())
  })

  it('answers as without plan billing for everything but the features it is told about', async () => {
    setFeatureState('tierOff')
    const d = planLimitsServiceDouble
    expect(await d.isSeatPaused('principal_1')).toBe(false)
    expect(await d.isBoardOpen('board_1')).toBe(true)
    expect(await d.isStatusComponentVisible('status_component_1')).toBe(true)
    expect(await d.isSendingDomainActive('sending_domain_1')).toBe(true)
    expect(await d.isCapEnforced('maxBoards')).toBe(false)
    expect(await d.openBoardIds()).toBeNull()
    expect(await d.seatHolders()).toBeNull()
    expect(await d.visibleStatusComponentIds()).toBeNull()
    expect(await d.activeSendingDomainIds()).toBeNull()
    expect(await d.getPlanLimits()).toMatchObject({ enabled: false, phase: 'ok', issues: [] })
    expect(await d.isFeaturePaused('webhooks')).toBe(false)
  })
})
