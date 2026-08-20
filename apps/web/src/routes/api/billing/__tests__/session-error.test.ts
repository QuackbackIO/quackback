import { describe, expect, it } from 'vitest'
import { billingSessionErrorResponse } from '../session'

describe('billingSessionErrorResponse', () => {
  it('names an already-on-plan refusal instead of a 503', async () => {
    const res = billingSessionErrorResponse(new Error('already_on_plan'))
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: 'already_on_plan' })
  })

  it('names a missing session as 401 instead of a 503', async () => {
    const res = billingSessionErrorResponse(new Error('Authentication required'))
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ error: 'unauthorized' })
  })

  it('names a foreign-workspace session as 403 not_teammate', async () => {
    const res = billingSessionErrorResponse(new Error('Access denied: Not a team member'))
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'not_teammate' })
  })

  it('names a missing billing permission as 403 forbidden', async () => {
    const res = billingSessionErrorResponse(
      new Error("Access denied: Requires permission 'billing.manage', role member lacks it")
    )
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'forbidden' })
  })

  it('keeps unknown failures as 503', async () => {
    const res = billingSessionErrorResponse(new Error('stripe down'))
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({ error: 'stripe down' })
  })
})
