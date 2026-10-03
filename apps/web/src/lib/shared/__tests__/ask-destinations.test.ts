import { describe, expect, it } from 'vitest'
import { ALL_PERMISSIONS, PERMISSIONS } from '../permissions'
import {
  buildAskDestinations,
  searchAskDestinations,
  buildAskStarterPrompts,
} from '../ask-destinations'
import { SETTINGS_PAGES, AUTOMATION_PAGES } from '../settings-pages'

const options = {
  permissions: new Set(ALL_PERMISSIONS),
  featureFlags: {
    feedback: true,
    supportInbox: true,
    supportTickets: true,
    helpCenter: true,
    statusPage: true,
    changelog: true,
  },
  billingEnabled: true,
  domainsEnabled: true,
}

describe('Ask destinations', () => {
  it('includes every registered settings and automation page once', () => {
    const paths = buildAskDestinations(options).map((item) => item.href)
    for (const path of [...Object.keys(SETTINGS_PAGES), ...Object.keys(AUTOMATION_PAGES)]) {
      expect(
        paths.filter((candidate) => candidate === path),
        path
      ).toHaveLength(1)
    }
  })
  it('respects exact permissions, including an explicitly empty custom role', () => {
    const empty = buildAskDestinations({ ...options, permissions: new Set() }).map(
      (item) => item.href
    )
    expect(empty).toContain('/admin')
    expect(empty).not.toContain('/admin/settings/general')
    expect(empty).not.toContain('/admin/inbox')
    expect(empty).not.toContain('/admin/analytics')
    expect(empty).not.toContain('/admin/users')
    const limited = buildAskDestinations({
      ...options,
      permissions: new Set([PERMISSIONS.OFFICE_HOURS_MANAGE]),
    }).map((item) => item.href)
    expect(limited).toContain('/admin/settings/office-hours')
    expect(limited).not.toContain('/admin/settings/widget')
  })
  it('hides disabled products and optional billing and domain destinations', () => {
    const paths = buildAskDestinations({
      ...options,
      featureFlags: { feedback: true },
      billingEnabled: false,
      domainsEnabled: false,
    }).map((item) => item.href)
    expect(paths).not.toContain('/admin/inbox')
    expect(paths).not.toContain('/admin/settings/office-hours')
    expect(paths).not.toContain('/admin/settings/status')
    expect(paths).not.toContain('/admin/settings/billing')
    expect(paths).not.toContain('/admin/settings/domains')
    expect(paths).toContain('/admin/settings/widget/install')
  })
  it('searches translated labels and keywords without a model or server dependency', () => {
    expect(searchAskDestinations('invite', options)[0]?.href).toBe('/admin/settings/members')
    expect(
      searchAskDestinations('Facturation', options, (item) =>
        item.href === '/admin/settings/billing' ? 'Facturation' : item.defaultMessage
      )[0]?.href
    ).toBe('/admin/settings/billing')
    expect(searchAskDestinations('  ', options)).toHaveLength(0)
  })
  it('offers three useful prompts when the default feedback board already exists', () => {
    expect(
      buildAskStarterPrompts(['product_feedback'], ['create-board']).map((item) => item.id)
    ).toEqual(['ask.starter.feedback', 'ask.starter.branding', 'ask.starter.invite'])
  })
  it('keeps useful prompts after the launch plan is complete', () => {
    const prompts = buildAskStarterPrompts(
      ['help_center', 'status_page'],
      [
        'help-article',
        'add-status-service',
        'customize-branding',
        'invite-team',
        'connect-messenger',
      ]
    )
    expect(prompts.map((item) => item.id)).toEqual([
      'ask.starter.branding',
      'ask.starter.invite',
      'ask.starter.install',
    ])
  })
  it('combines goal starter prompts, preserving order and avoiding completed tasks', () => {
    const prompts = buildAskStarterPrompts(
      ['customer_support', 'help_center'],
      ['connect-messenger']
    )
    expect(prompts.map((item) => item.id)).toContain('ask.starter.welcome')
    expect(prompts.map((item) => item.id)).toContain('ask.starter.help')
    expect(prompts.map((item) => item.id)).not.toContain('ask.starter.install')
    expect(prompts.length).toBeLessThanOrEqual(4)
  })
})
