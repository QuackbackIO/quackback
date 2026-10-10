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
  const now = new Date('2026-11-20T12:00:00.000Z')
  const due = (offsetMs: number) => new Date(now.getTime() + offsetMs)
  const choseFree = {
    planId: 'free',
    cleanupPaths: ['/admin/settings/boards', '/admin/settings/members'],
  }

  it('holds nothing during the grace period, even after Free was picked', () => {
    for (const pending of [null, choseFree]) {
      const input = { pending, trialChoiceDueAt: due(60_000), now }
      expect(adminBillingLock({ ...input, pathname: '/admin/feedback' })).toBeNull()
      expect(adminBillingLock({ ...input, pathname: '/admin/roadmap' })).toBeNull()
    }
  })

  it('after the grace period, holds everything but the plan picker and exports', () => {
    const input = { pending: null, trialChoiceDueAt: due(0), now }
    expect(adminBillingLock({ ...input, pathname: '/admin/feedback' })).toBe('trial_choice')
    expect(adminBillingLock({ ...input, pathname: '/admin/settings/boards' })).toBe('trial_choice')
    expect(adminBillingLock({ ...input, pathname: '/admin/settings/billing' })).toBeNull()
    expect(adminBillingLock({ ...input, pathname: '/admin/settings/imports' })).toBeNull()
  })

  it('after the grace period, opens only the pages that fix what is over Free for whoever picked it', () => {
    const input = { pending: choseFree, trialChoiceDueAt: due(-60_000), now }
    expect(adminBillingLock({ ...input, pathname: '/admin/settings/boards' })).toBeNull()
    expect(adminBillingLock({ ...input, pathname: '/admin/settings/members/roles/new' })).toBeNull()
    // Not a way around the choice: the rest of settings and the inbox stay held.
    expect(adminBillingLock({ ...input, pathname: '/admin/settings/general' })).toBe('trial_choice')
    expect(adminBillingLock({ ...input, pathname: '/admin/feedback' })).toBe('trial_choice')
  })

  it('keeps a paid downgrade to settings and the feedback inbox', () => {
    const input = { pending: { planId: 'pro', cleanupPaths: [] }, trialChoiceDueAt: null, now }
    expect(adminBillingLock({ ...input, pathname: '/admin/settings/general' })).toBeNull()
    expect(adminBillingLock({ ...input, pathname: '/admin/feedback' })).toBeNull()
    expect(adminBillingLock({ ...input, pathname: '/admin/roadmap' })).toBe('downgrade')
  })

  it('holds nothing with no pending downgrade and no ended trial', () => {
    expect(
      adminBillingLock({ pathname: '/admin', pending: null, trialChoiceDueAt: null, now })
    ).toBeNull()
  })
})
