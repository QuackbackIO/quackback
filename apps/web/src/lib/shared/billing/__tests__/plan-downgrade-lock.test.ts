import { describe, expect, it } from 'vitest'
import { isAdminPathAllowedDuringDowngradeLock } from '../plan-downgrade-lock'

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
    expect(isAdminPathAllowedDuringDowngradeLock('/admin/roadmap')).toBe(false)
    expect(isAdminPathAllowedDuringDowngradeLock('/admin/settingsfoo')).toBe(false)
  })
})
