/**
 * POST and DELETE /api/v1/segments/:slug/members report how many people they
 * added or removed: someone already a member was not added, and someone who
 * held no membership was not removed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  addMember: vi.fn(),
  removeMember: vi.fn(),
  principalRows: [] as Array<{ id: string }>,
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))
vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: vi.fn(async () => ({ role: 'admin' })),
}))
vi.mock('@/lib/server/domains/segments/segment-membership.service', () => ({
  addMember: m.addMember,
  removeMember: m.removeMember,
}))
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: { segments: { findFirst: vi.fn(async () => ({ id: 'segment_1' })) } },
    select: () => ({ from: () => ({ where: async () => m.principalRows }) }),
  },
}))

import { Route } from '../$slug.members'

type Handler = (ctx: { request: Request; params: Record<string, string> }) => Promise<Response>
const handlers = (
  Route as unknown as { options: { server: { handlers: Record<string, Handler> } } }
).options.server.handlers

describe('DELETE /api/v1/segments/:slug/members', () => {
  beforeEach(() => {
    m.removeMember.mockReset()
  })

  it('counts only the people whose membership was removed', async () => {
    m.principalRows = [{ id: 'principal_member' }, { id: 'principal_stranger' }]
    m.removeMember.mockImplementation(async ({ principalId }: { principalId: string }) => {
      return principalId === 'principal_member'
    })

    const res = await handlers.DELETE({
      request: new Request('http://localhost/api/v1/segments/vip/members', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ principalIds: ['principal_member', 'principal_stranger'] }),
      }),
      params: { slug: 'vip' },
    })

    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ removed: 1, failed: [] })
    expect(m.removeMember).toHaveBeenCalledTimes(2)
  })
})

describe('POST /api/v1/segments/:slug/members', () => {
  beforeEach(() => {
    m.addMember.mockReset()
  })

  it('counts only the people it made members', async () => {
    m.principalRows = [{ id: 'principal_new' }, { id: 'principal_already' }]
    m.addMember.mockImplementation(async ({ principalId }: { principalId: string }) => {
      return principalId === 'principal_new'
    })

    const res = await handlers.POST({
      request: new Request('http://localhost/api/v1/segments/vip/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ principalIds: ['principal_new', 'principal_already'] }),
      }),
      params: { slug: 'vip' },
    })

    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ added: 1, failed: [] })
    expect(m.addMember).toHaveBeenCalledTimes(2)
  })
})
