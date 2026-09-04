// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getCloudConfig: vi.fn(),
  startWorkspaceTrial: vi.fn(),
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
  startWorkspaceTrial: (...args: unknown[]) => hoisted.startWorkspaceTrial(...args),
}))

import { Route } from '../trial'

type Handlers = { POST: (args: { request: Request }) => Promise<Response> }
type RouteOpts = { server: { handlers: Handlers } }
const { POST } = (Route as unknown as { options: RouteOpts }).options.server.handlers

function formRequest(body: Record<string, string>): Request {
  return new Request('https://app.example.com/api/billing/trial', {
    method: 'POST',
    headers: {
      origin: 'https://app.example.com',
      host: 'app.example.com',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body),
  })
}

describe('POST /api/billing/trial', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.requireAuth.mockResolvedValue({ user: { id: 'user_1' } })
    hoisted.getCloudConfig.mockResolvedValue({ enabled: true, canUpgrade: true })
    hoisted.startWorkspaceTrial.mockResolvedValue('started')
  })

  it('accepts business/enterprise slugs and starts those trials', async () => {
    const res = await POST({ request: formRequest({ planId: 'business' }) })
    expect(res.status).toBe(303)
    expect(hoisted.startWorkspaceTrial).toHaveBeenCalledWith('business')

    hoisted.startWorkspaceTrial.mockClear()
    await POST({ request: formRequest({ planId: 'enterprise' }) })
    expect(hoisted.startWorkspaceTrial).toHaveBeenCalledWith('enterprise')
  })

  it('maps a pro checkout slug onto the entry-tier trial', async () => {
    await POST({ request: formRequest({ planId: 'pro' }) })
    expect(hoisted.startWorkspaceTrial).toHaveBeenCalledWith('growth')
  })
})
