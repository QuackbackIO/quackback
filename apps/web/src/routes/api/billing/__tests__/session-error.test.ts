import { describe, expect, it } from 'vitest'
import { billingDowngradeAlreadyOnPlanResponse, billingSessionErrorResponse } from '../session'

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

  it('treats Switch to Free after a lapsed trial as already on Free', () => {
    const res = billingDowngradeAlreadyOnPlanResponse(new Error('already_on_plan'))
    expect(res?.status).toBe(303)
    expect(res && location(res)).toBe('/admin/settings/billing')
    expect(billingDowngradeAlreadyOnPlanResponse(new Error('unavailable'))).toBeNull()
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

  it('names a checkout that would exceed the target plan seat cap', () => {
    const res = billingSessionErrorResponse(new Error('seat_cap_exceeded'))
    expect(res.status).toBe(303)
    expect(location(res)).toBe('/admin/settings/billing?billing_error=seat_cap_exceeded')
  })

  it('names a downgrade that still exceeds the target plan', () => {
    const res = billingSessionErrorResponse(new Error('over_plan_limits'))
    expect(res.status).toBe(303)
    expect(location(res)).toBe('/admin/settings/billing?billing_error=over_plan_limits')
  })

  it('does not leak unknown failure text into the URL', () => {
    const res = billingSessionErrorResponse(new Error('stripe down'))
    expect(res.status).toBe(303)
    expect(location(res)).toBe('/admin/settings/billing?billing_error=unavailable')
  })
})
