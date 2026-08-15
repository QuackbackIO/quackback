import { describe, expect, it } from 'vitest'
import { billingSessionErrorResponse } from '../session'

describe('billingSessionErrorResponse', () => {
  it('names an already-on-plan refusal instead of a 503', async () => {
    const res = billingSessionErrorResponse(new Error('already_on_plan'))
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: 'already_on_plan' })
  })

  it('keeps unknown failures as 503', async () => {
    const res = billingSessionErrorResponse(new Error('stripe down'))
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({ error: 'stripe down' })
  })
})
