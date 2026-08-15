// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SsoUpgradeNotice, ssoUpgradePlanName } from '../sso-upgrade-notice'

describe('SsoUpgradeNotice', () => {
  it('names Scale as the cheapest plan that grants SSO', () => {
    expect(ssoUpgradePlanName()).toBe('Scale')
    render(<SsoUpgradeNotice />)
    expect(screen.getByText(/Single sign-on is a Scale feature/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Upgrade to Scale' })).toHaveAttribute(
      'href',
      '/admin/settings/billing'
    )
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
