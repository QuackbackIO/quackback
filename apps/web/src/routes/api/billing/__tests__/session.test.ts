import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getCloudConfig: vi.fn(),
  countSeatUsage: vi.fn(),
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

vi.mock('@/lib/server/domains/principals/seat-usage', () => ({
  countSeatUsage: (...args: unknown[]) => hoisted.countSeatUsage(...args),
}))

vi.mock('@/lib/server/control-plane/client', () => ({
  createHostedBillingSession: (...args: unknown[]) => hoisted.createHostedBillingSession(...args),
}))

import { Route } from '../session'

type Handlers = { POST: (args: { request: Request }) => Promise<Response> }
type RouteOpts = { server: { handlers: Handlers } }
const { POST } = (Route as unknown as { options: RouteOpts }).options.server.handlers

function seatsRequest(quantity: number): Request {
  return new Request('https://app.example.com/api/billing/session', {
    method: 'POST',
    headers: {
      origin: 'https://app.example.com',
      host: 'app.example.com',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ action: 'seats', quantity: String(quantity) }),
  })
}

describe('POST /api/billing/session seats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.requireAuth.mockResolvedValue({ user: { id: 'user_1' } })
    hoisted.getCloudConfig.mockResolvedValue({
      enabled: true,
      canUpgrade: true,
      canManageBilling: true,
    })
    hoisted.countSeatUsage.mockResolvedValue({ members: 6, pendingInvites: 1, used: 7 })
    hoisted.createHostedBillingSession.mockResolvedValue({ status: 'updated' })
  })

  it('refuses a quantity below live seat usage before the hosted call', async () => {
    const res = await POST({ request: seatsRequest(6) })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'seats_below_usage' })
    expect(hoisted.createHostedBillingSession).not.toHaveBeenCalled()
  })

  it('forwards a quantity at or above live usage', async () => {
    const res = await POST({ request: seatsRequest(7) })
    expect(res.status).toBe(303)
    expect(hoisted.createHostedBillingSession).toHaveBeenCalledWith({
      action: 'seats',
      quantity: 7,
    })
  })
})
