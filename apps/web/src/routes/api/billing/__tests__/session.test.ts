// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getCloudConfig: vi.fn(),
  countSeatUsage: vi.fn(),
  createHostedBillingSession: vi.fn(),
  fetchBillingCatalogue: vi.fn(),
  transaction: vi.fn(),
  forUpdate: vi.fn(),
  transactionActive: false,
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: (...args: unknown[]) => hoisted.requireAuth(...args),
}))

vi.mock('@/lib/server/domains/settings/cloud/cloud.service', () => ({
  getCloudConfig: (...args: unknown[]) => hoisted.getCloudConfig(...args),
}))

vi.mock('@/lib/server/domains/principals/seat-usage', () => ({
  countSeatUsage: (...args: unknown[]) => hoisted.countSeatUsage(...args),
}))

vi.mock('@/lib/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/db')>()
  return {
    ...actual,
    db: {
      transaction: (...args: unknown[]) => hoisted.transaction(...args),
    },
  }
})

vi.mock('@/lib/server/control-plane/client', () => ({
  createHostedBillingSession: (...args: unknown[]) => hoisted.createHostedBillingSession(...args),
  fetchBillingCatalogue: (...args: unknown[]) => hoisted.fetchBillingCatalogue(...args),
}))

import { Route } from '../session'

type Handlers = { POST: (args: { request: Request }) => Promise<Response> }
type RouteOpts = { server: { handlers: Handlers } }
const { POST } = (Route as unknown as { options: RouteOpts }).options.server.handlers

function formRequest(body: Record<string, string>): Request {
  return new Request('https://app.example.com/api/billing/session', {
    method: 'POST',
    headers: {
      origin: 'https://app.example.com',
      host: 'app.example.com',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body),
  })
}

function seatsRequest(quantity: number): Request {
  return formRequest({ action: 'seats', quantity: String(quantity) })
}

function checkoutRequest(quantity?: number): Request {
  const body: Record<string, string> = {
    action: 'checkout',
    planId: 'pro',
    billingPeriod: 'monthly',
  }
  if (quantity !== undefined) body.quantity = String(quantity)
  return formRequest(body)
}

describe('POST /api/billing/session seats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.transactionActive = false
    hoisted.requireAuth.mockResolvedValue({ user: { id: 'user_1' } })
    hoisted.getCloudConfig.mockResolvedValue({
      enabled: true,
      canUpgrade: true,
      canManageBilling: true,
    })
    hoisted.countSeatUsage.mockResolvedValue({ members: 6, pendingInvites: 1, used: 7 })
    hoisted.forUpdate.mockResolvedValue([{ id: 'ws_1' }])
    hoisted.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      hoisted.transactionActive = true
      try {
        return await fn({
          select: () => ({
            from: () => ({
              limit: () => ({
                for: (...args: unknown[]) => hoisted.forUpdate(...args),
              }),
            }),
          }),
        })
      } finally {
        hoisted.transactionActive = false
      }
    })
    hoisted.createHostedBillingSession.mockResolvedValue({
      url: 'https://billing.example.com/checkout',
      status: 'updated',
    })
  })

  it('refuses a quantity below live seat usage before the hosted call', async () => {
    const res = await POST({ request: seatsRequest(6) })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe(
      '/admin/settings/billing?billing_error=seats_below_usage'
    )
    expect(hoisted.createHostedBillingSession).not.toHaveBeenCalled()
    expect(hoisted.forUpdate).toHaveBeenCalledWith('update')
  })

  it('forwards a quantity at or above live usage under the settings lock', async () => {
    hoisted.createHostedBillingSession.mockImplementation(async () => {
      expect(hoisted.transactionActive).toBe(true)
      expect(hoisted.forUpdate).toHaveBeenCalledWith('update')
      return { url: 'https://billing.example.com/checkout', status: 'updated' }
    })

    const res = await POST({ request: seatsRequest(7) })
    expect(res.status).toBe(303)
    expect(hoisted.transaction).toHaveBeenCalledOnce()
    expect(hoisted.countSeatUsage).toHaveBeenCalledOnce()
    expect(hoisted.createHostedBillingSession).toHaveBeenCalledWith({
      action: 'seats',
      quantity: 7,
    })
    expect(hoisted.transactionActive).toBe(false)
  })
})

describe('POST /api/billing/session checkout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.transactionActive = false
    hoisted.requireAuth.mockResolvedValue({ user: { id: 'user_1' } })
    hoisted.getCloudConfig.mockResolvedValue({
      enabled: true,
      canUpgrade: true,
      canManageBilling: true,
    })
    hoisted.countSeatUsage.mockResolvedValue({ members: 6, pendingInvites: 1, used: 7 })
    hoisted.forUpdate.mockResolvedValue([{ id: 'ws_1' }])
    hoisted.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      hoisted.transactionActive = true
      try {
        return await fn({
          select: () => ({
            from: () => ({
              limit: () => ({
                for: (...args: unknown[]) => hoisted.forUpdate(...args),
              }),
            }),
          }),
        })
      } finally {
        hoisted.transactionActive = false
      }
    })
    hoisted.createHostedBillingSession.mockResolvedValue({
      url: 'https://billing.example.com/checkout',
    })
    hoisted.fetchBillingCatalogue.mockResolvedValue({
      plans: [{ id: 'pro', billedPer: 'seat' }],
    })
  })

  it('raises a stale quantity to live seat usage before the hosted call', async () => {
    const res = await POST({ request: checkoutRequest(6) })
    expect(res.status).toBe(303)
    expect(hoisted.createHostedBillingSession).toHaveBeenCalledWith({
      action: 'checkout',
      planId: 'pro',
      billingPeriod: 'monthly',
      quantity: 7,
    })
  })

  it('defaults an omitted quantity to live usage, at least one', async () => {
    const res = await POST({ request: checkoutRequest() })
    expect(res.status).toBe(303)
    expect(hoisted.createHostedBillingSession).toHaveBeenCalledWith({
      action: 'checkout',
      planId: 'pro',
      billingPeriod: 'monthly',
      quantity: 7,
    })

    hoisted.createHostedBillingSession.mockClear()
    hoisted.countSeatUsage.mockResolvedValue({ members: 0, pendingInvites: 0, used: 0 })
    await POST({ request: checkoutRequest() })
    expect(hoisted.createHostedBillingSession).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: 1 })
    )
  })

  it('keeps quantity 1 for a workspace-priced plan', async () => {
    hoisted.fetchBillingCatalogue.mockResolvedValue({
      plans: [{ id: 'pro', billedPer: 'workspace' }],
    })
    const res = await POST({ request: checkoutRequest(1) })
    expect(res.status).toBe(303)
    expect(hoisted.createHostedBillingSession).toHaveBeenCalledWith({
      action: 'checkout',
      planId: 'pro',
      billingPeriod: 'monthly',
      quantity: 1,
    })
  })

  it('accepts business/enterprise checkout slugs and forwards those ids', async () => {
    hoisted.fetchBillingCatalogue.mockResolvedValue({
      plans: [
        { id: 'business', billedPer: 'workspace' },
        { id: 'enterprise', billedPer: 'workspace' },
      ],
    })
    await POST({
      request: formRequest({
        action: 'checkout',
        planId: 'business',
        billingPeriod: 'monthly',
      }),
    })
    expect(hoisted.createHostedBillingSession).toHaveBeenCalledWith({
      action: 'checkout',
      planId: 'business',
      billingPeriod: 'monthly',
      quantity: 1,
    })

    hoisted.createHostedBillingSession.mockClear()
    await POST({
      request: formRequest({
        action: 'checkout',
        planId: 'enterprise',
        billingPeriod: 'annual',
      }),
    })
    expect(hoisted.createHostedBillingSession).toHaveBeenCalledWith({
      action: 'checkout',
      planId: 'enterprise',
      billingPeriod: 'annual',
      quantity: 1,
    })
  })

  it('rejects leftover growth/scale checkout slugs', async () => {
    const growth = await POST({
      request: formRequest({
        action: 'checkout',
        planId: 'growth',
        billingPeriod: 'monthly',
      }),
    })
    expect(growth.headers.get('location')).toContain('billing_error=invalid')
    const scale = await POST({
      request: formRequest({
        action: 'checkout',
        planId: 'scale',
        billingPeriod: 'annual',
      }),
    })
    expect(scale.headers.get('location')).toContain('billing_error=invalid')
    expect(hoisted.createHostedBillingSession).not.toHaveBeenCalled()
  })

  it('forwards a quantity at or above live usage', async () => {
    const res = await POST({ request: checkoutRequest(8) })
    expect(res.status).toBe(303)
    expect(hoisted.createHostedBillingSession).toHaveBeenCalledWith({
      action: 'checkout',
      planId: 'pro',
      billingPeriod: 'monthly',
      quantity: 8,
    })
  })

  it('bundles branding removal into the checkout only when the box was ticked', async () => {
    await POST({
      request: formRequest({
        action: 'checkout',
        planId: 'pro',
        billingPeriod: 'annual',
        quantity: '8',
        brandingRemoval: 'true',
      }),
    })
    expect(hoisted.createHostedBillingSession).toHaveBeenCalledWith({
      action: 'checkout',
      planId: 'pro',
      billingPeriod: 'annual',
      quantity: 8,
      brandingRemoval: true,
    })

    hoisted.createHostedBillingSession.mockClear()
    const res = await POST({
      request: formRequest({
        action: 'checkout',
        planId: 'pro',
        billingPeriod: 'annual',
        brandingRemoval: 'yes',
      }),
    })
    expect(res.headers.get('location')).toContain('billing_error=invalid')
    expect(hoisted.createHostedBillingSession).not.toHaveBeenCalled()
  })

  it('forwards branding-removal purchase to the control plane', async () => {
    hoisted.createHostedBillingSession.mockResolvedValue({ status: 'updated' })
    const res = await POST({
      request: formRequest({ action: 'branding', billingPeriod: 'monthly' }),
    })
    expect(res.status).toBe(303)
    expect(hoisted.createHostedBillingSession).toHaveBeenCalledWith({
      action: 'branding',
      billingPeriod: 'monthly',
    })
    expect(res.headers.get('location')).toBe('/admin/settings/billing?checkout=success')
  })

  it('does not treat branding removal as a checkout success', async () => {
    hoisted.createHostedBillingSession.mockResolvedValue({ status: 'updated' })
    const res = await POST({
      request: formRequest({ action: 'branding-remove' }),
    })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/admin/settings/billing')
  })

  it('holds the settings lock through hosted checkout creation', async () => {
    hoisted.createHostedBillingSession.mockImplementation(async () => {
      expect(hoisted.transactionActive).toBe(true)
      expect(hoisted.forUpdate).toHaveBeenCalledWith('update')
      return { url: 'https://billing.example.com/checkout' }
    })
    const res = await POST({ request: checkoutRequest(8) })
    expect(res.status).toBe(303)
    expect(hoisted.transaction).toHaveBeenCalledOnce()
    expect(hoisted.transactionActive).toBe(false)
  })
})
