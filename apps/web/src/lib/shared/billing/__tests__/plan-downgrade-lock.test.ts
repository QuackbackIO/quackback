import { describe, expect, it } from 'vitest'
import {
  adminBillingLock,
  isAdminPathAllowedDuringDowngradeLock,
  isAdminPathAllowedDuringTrialChoice,
} from '../plan-downgrade-lock'

describe('isAdminPathAllowedDuringDowngradeLock', () => {
  it('allows settings, billing, and the pages that delete capped resources', () => {
    expect(isAdminPathAllowedDuringDowngradeLock('/admin/settings')).toBe(true)
    expect(isAdminPathAllowedDuringDowngradeLock('/admin/settings/billing')).toBe(true)
    expect(isAdminPathAllowedDuringDowngradeLock('/admin/settings/boards')).toBe(true)
    expect(isAdminPathAllowedDuringDowngradeLock('/admin/settings/members')).toBe(true)
    expect(isAdminPathAllowedDuringDowngradeLock('/admin/settings/status')).toBe(true)
    expect(isAdminPathAllowedDuringDowngradeLock('/admin/settings/domains')).toBe(true)
    expect(isAdminPathAllowedDuringDowngradeLock('/admin/feedback')).toBe(true)
    expect(isAdminPathAllowedDuringDowngradeLock('/admin/login')).toBe(true)
  })

  it('blocks the rest of admin, including product surfaces', () => {
    expect(isAdminPathAllowedDuringDowngradeLock('/admin')).toBe(false)
    expect(isAdminPathAllowedDuringDowngradeLock('/admin/inbox')).toBe(false)
    expect(isAdminPathAllowedDuringDowngradeLock('/admin/changelog')).toBe(false)
    expect(isAdminPathAllowedDuringDowngradeLock('/admin/automation')).toBe(false)
    expect(isAdminPathAllowedDuringDowngradeLock('/admin/analytics')).toBe(false)
    expect(isAdminPathAllowedDuringDowngradeLock('/admin/roadmap')).toBe(false)
    expect(isAdminPathAllowedDuringDowngradeLock('/admin/settingsfoo')).toBe(false)
  })
})

describe('AI & Automation pages under settings', () => {
  it('stay blocked, including the pages beneath them', () => {
    for (const page of ['agent', 'copilot', 'skills', 'connectors', 'workflows']) {
      expect(isAdminPathAllowedDuringDowngradeLock(`/admin/settings/${page}`), page).toBe(false)
    }
    expect(isAdminPathAllowedDuringDowngradeLock('/admin/settings/connectors/connector_1')).toBe(
      false
    )
    expect(isAdminPathAllowedDuringDowngradeLock('/admin/settings/workflows/workflow_1')).toBe(
      false
    )
  })

  it('leave the other settings pages open, including names that only start the same', () => {
    expect(isAdminPathAllowedDuringDowngradeLock('/admin/settings/agents')).toBe(true)
    expect(isAdminPathAllowedDuringDowngradeLock('/admin/settings/integrations')).toBe(true)
    expect(isAdminPathAllowedDuringDowngradeLock('/admin/settings/billing')).toBe(true)
  })
})

describe('isAdminPathAllowedDuringTrialChoice', () => {
  it('allows the plan picker, its checkout, and exports', () => {
    expect(isAdminPathAllowedDuringTrialChoice('/admin/settings/billing')).toBe(true)
    expect(isAdminPathAllowedDuringTrialChoice('/admin/settings/billing/checkout')).toBe(true)
    expect(isAdminPathAllowedDuringTrialChoice('/admin/settings/imports')).toBe(true)
    expect(isAdminPathAllowedDuringTrialChoice('/admin/login')).toBe(true)
  })

  it('blocks the rest of admin, settings included', () => {
    expect(isAdminPathAllowedDuringTrialChoice('/admin')).toBe(false)
    expect(isAdminPathAllowedDuringTrialChoice('/admin/feedback')).toBe(false)
    expect(isAdminPathAllowedDuringTrialChoice('/admin/settings')).toBe(false)
    expect(isAdminPathAllowedDuringTrialChoice('/admin/settings/boards')).toBe(false)
    expect(isAdminPathAllowedDuringTrialChoice('/admin/settings/billingfoo')).toBe(false)
  })
})

describe('adminBillingLock', () => {
  const now = new Date('2026-08-20T12:00:00.000Z')
  const due = (offsetMs: number) => new Date(now.getTime() + offsetMs)

  it('waits out the grace period, then gates everything but the picker', () => {
    const during = { pendingDowngrade: false, trialChoiceDueAt: due(60_000), now }
    expect(adminBillingLock({ ...during, pathname: '/admin/feedback' })).toBeNull()
    const after = { pendingDowngrade: false, trialChoiceDueAt: due(0), now }
    expect(adminBillingLock({ ...after, pathname: '/admin/feedback' })).toBe('trial_choice')
    expect(adminBillingLock({ ...after, pathname: '/admin/settings/boards' })).toBe('trial_choice')
    expect(adminBillingLock({ ...after, pathname: '/admin/settings/billing' })).toBeNull()
  })

  it('lets a pending downgrade win, so its clean-up pages stay open', () => {
    const input = { pendingDowngrade: true, trialChoiceDueAt: due(-60_000), now }
    expect(adminBillingLock({ ...input, pathname: '/admin/settings/boards' })).toBeNull()
    expect(adminBillingLock({ ...input, pathname: '/admin/feedback' })).toBeNull()
    expect(adminBillingLock({ ...input, pathname: '/admin/roadmap' })).toBe('downgrade')
  })

  it('locks nothing with no pending downgrade and no ended trial', () => {
    expect(
      adminBillingLock({ pathname: '/admin', pendingDowngrade: false, trialChoiceDueAt: null, now })
    ).toBeNull()
  })
})
