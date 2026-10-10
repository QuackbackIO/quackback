// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { ssoUpgradePlanName } from '../sso-upgrade-notice'
import { describeEntitlementUpgrade } from '@/lib/shared/describe-upgrade'

describe('SsoUpgradeNotice', () => {
  it('names Enterprise as the cheapest plan that grants SSO', () => {
    expect(ssoUpgradePlanName()).toBe('Enterprise')
    expect(describeEntitlementUpgrade('sso').body).toMatch(
      /Single sign-on is an Enterprise feature/
    )
  })
})
