import { describe, expect, it } from 'vitest'
import { billingSessionErrorResponse } from '../session'

function location(res: Response): string {
  return res.headers.get('location') ?? ''
}

describe('billingSessionErrorResponse', () => {
  it('sends form posts back to billing with a named error', () => {
    const res = billingSessionErrorResponse(new Error('already_on_addon'))
    expect(res.status).toBe(303)
    expect(location(res)).toBe('/admin/settings/billing?billing_error=already_on_addon')
  })

  it('maps already_on_plan', () => {
    const res = billingSessionErrorResponse(new Error('already_on_plan'))
    expect(res.status).toBe(303)
    expect(location(res)).toBe('/admin/settings/billing?billing_error=already_on_plan')
  })

  it('names a missing session as unauthorized', () => {
    const res = billingSessionErrorResponse(new Error('Authentication required'))
    expect(res.status).toBe(303)
    expect(location(res)).toBe('/admin/settings/billing?billing_error=unauthorized')
  })

  it('names a foreign-workspace session as not_teammate', () => {
    const res = billingSessionErrorResponse(new Error('Access denied: Not a team member'))
    expect(res.status).toBe(303)
    expect(location(res)).toBe('/admin/settings/billing?billing_error=not_teammate')
  })

  it('names a missing billing permission as forbidden', () => {
    const res = billingSessionErrorResponse(
      new Error("Access denied: Requires permission 'billing.manage', role member lacks it")
    )
    expect(res.status).toBe(303)
    expect(location(res)).toBe('/admin/settings/billing?billing_error=forbidden')
  })

  it('names a seat cut below live usage', () => {
    const res = billingSessionErrorResponse(new Error('seats_below_usage'))
    expect(res.status).toBe(303)
    expect(location(res)).toBe('/admin/settings/billing?billing_error=seats_below_usage')
  })

  it('does not leak unknown failure text into the URL', () => {
    const res = billingSessionErrorResponse(new Error('stripe down'))
    expect(res.status).toBe(303)
    expect(location(res)).toBe('/admin/settings/billing?billing_error=unavailable')
  })
})
