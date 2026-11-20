/**
 * POST/DELETE /api/v1/segments/:slug/members against a real database.
 *
 * A malformed principal id must be reported in `failed`, like an unknown one,
 * rather than reaching the typeid column and failing the whole request.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type SegmentId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { principal, segments, user } from '@/lib/server/db'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: vi.fn(async () => ({ role: 'admin' })),
}))
vi.mock('@/lib/server/domains/segments/segment-membership.service', () => ({
  addMember: vi.fn(async () => undefined),
  removeMember: vi.fn(async () => undefined),
}))

import { Route } from '../$slug.members'

type Handler = (args: { request: Request; params: { slug: string } }) => Promise<Response>
const { POST, DELETE } = (
  Route as unknown as { options: { server: { handlers: { POST: Handler; DELETE: Handler } } } }
).options.server.handlers

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: segments.id }).from(segments).limit(0)
    await db.select({ id: principal.id }).from(principal).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seed(): Promise<{ slug: string; principalId: PrincipalId }> {
  const slug = `members-${suffix()}`
  await testDb
    .insert(segments)
    .values({ id: createId('segment') as SegmentId, name: slug, slug, type: 'manual' })
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Member', email: `${slug}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'user', type: 'user', createdAt: new Date() })
  return { slug, principalId }
}

function call(handler: Handler, slug: string, principalIds: string[]) {
  return handler({
    params: { slug },
    request: new Request(`http://test/api/v1/segments/${slug}/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ principalIds }),
    }),
  })
}

describe.skipIf(!fixture.available)('/api/v1/segments/:slug/members (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('lists a malformed principal id in failed and still adds the valid one', async () => {
    const { slug, principalId } = await seed()
    const res = await call(POST, slug, ['not-an-id', principalId])
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ added: 1, failed: ['not-an-id'] })
  })

  it('answers 200 when every id is malformed', async () => {
    const { slug } = await seed()
    const res = await call(POST, slug, ['not-an-id'])
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ added: 0, failed: ['not-an-id'] })
  })

  it('lists a malformed principal id in failed on removal', async () => {
    const { slug, principalId } = await seed()
    const res = await call(DELETE, slug, ['not-an-id', principalId])
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ removed: 1, failed: ['not-an-id'] })
  })
})
