// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getCloudConfig: vi.fn(),
  createHostedBillingSession: vi.fn(),
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

vi.mock('@/lib/server/control-plane/client', () => ({
  createHostedBillingSession: (...args: unknown[]) => hoisted.createHostedBillingSession(...args),
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

function checkoutRequest(quantity?: number): Request {
  const body: Record<string, string> = {
    action: 'checkout',
    planId: 'pro',
    billingPeriod: 'monthly',
  }
  if (quantity !== undefined) body.quantity = String(quantity)
  return formRequest(body)
}

describe('POST /api/billing/session checkout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.requireAuth.mockResolvedValue({ user: { id: 'user_1' } })
    hoisted.getCloudConfig.mockResolvedValue({
      enabled: true,
      canUpgrade: true,
      canManageBilling: true,
    })
    hoisted.createHostedBillingSession.mockResolvedValue({
      url: 'https://billing.example.com/checkout',
    })
  })

  it('always checks out quantity 1', async () => {
    const res = await POST({ request: checkoutRequest(6) })
    expect(res.status).toBe(303)
    expect(hoisted.createHostedBillingSession).toHaveBeenCalledWith({
      action: 'checkout',
      planId: 'pro',
      billingPeriod: 'monthly',
      quantity: 1,
    })
  })

  it('accepts business/enterprise checkout slugs and forwards those ids', async () => {
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
      quantity: 1,
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
})
