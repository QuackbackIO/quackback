import { describe, expect, it } from 'vitest'
import { resolveAdminHomePath } from '../admin-home'

describe('resolveAdminHomePath', () => {
  it('sends an admin with unfinished launch work to Getting Started', () => {
    expect(
      resolveAdminHomePath({ isAdmin: true, launchResolved: false, flags: { feedback: true } })
    ).toBe('/admin/getting-started')
  })

  it('sends a finished admin to Feedback', () => {
    expect(
      resolveAdminHomePath({ isAdmin: true, launchResolved: true, flags: { feedback: true } })
    ).toBe('/admin/feedback')
  })

  it('sends members to the first enabled product, not Getting Started', () => {
    expect(
      resolveAdminHomePath({ isAdmin: false, launchResolved: false, flags: { feedback: true } })
    ).toBe('/admin/feedback')
  })

  it('falls through to Support when Feedback is off', () => {
    expect(
      resolveAdminHomePath({
        isAdmin: true,
        launchResolved: true,
        flags: { feedback: false, supportInbox: true },
      })
    ).toBe('/admin/inbox')
  })

  it('keeps walking the product list if Support is also off', () => {
    expect(
      resolveAdminHomePath({
        isAdmin: true,
        launchResolved: true,
        flags: {
          feedback: false,
          supportInbox: false,
          supportTickets: false,
          helpCenter: true,
        },
      })
    ).toBe('/admin/help-center')
  })
})
