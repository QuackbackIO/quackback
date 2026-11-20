/**
 * An MCP OAuth token for a teammate whose seat is paused (the plan has fewer
 * team seats than members, after the grace) resolves as the portal user they
 * still are: role `user` and no permissions, so every team tool refuses. The
 * token is not rejected, so the client does not loop on re-auth.
 *
 * Real here: the principal re-read, the OAuth client read and the permission
 * resolution. Stood in for: the token signature check, and the paused answer,
 * keyed on the principal it is asked about as the real `isSeatPaused` is (that
 * answer is proved against a database in plan-limits.team.db.test.ts).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

if (!process.env.BASE_URL?.startsWith('http')) process.env.BASE_URL = 'http://localhost:3000'
process.env.SECRET_KEY ??= 'test-secret-key-with-at-least-32-characters'

import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { principal, user } from '@/lib/server/db'

const hoisted = vi.hoisted(() => ({ paused: new Set<string>(), asked: [] as string[] }))

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('better-auth/oauth2', async (original) => ({
  ...(await original<typeof import('better-auth/oauth2')>()),
  // The token names its principal as `<principalId>`; the signature is not checked here.
  verifyAccessTokenRequest: async (input: { authorizationHeader?: string | null }) => {
    const header = input.authorizationHeader ?? ''
    const principalId = header.replace(/^Bearer /, '')
    if (!principalId) throw new Error('no token')
    return { principalId, sub: `user-of-${principalId}`, scope: 'read:feedback write:feedback' }
  },
}))
vi.mock('@/lib/server/domains/plan-limits/plan-limits.service', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/plan-limits/plan-limits.service')>()),
  isSeatPaused: async (principalId: string) => {
    hoisted.asked.push(principalId)
    return hoisted.paused.has(principalId)
  },
}))

import { resolveAuthContext } from '../handler'

const fixture = await createDbTestFixture()
afterAll(fixture.close)

async function addTeammate(role: 'admin' | 'member'): Promise<PrincipalId> {
  const uid = createId('user') as UserId
  const id = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: uid, name: 'Acme Teammate', email: `${uid}@example.com` })
  await testDb
    .insert(principal)
    .values({ id, userId: uid, role, type: 'user', createdAt: new Date() })
  return id
}

const resolve = (principalId: PrincipalId) =>
  resolveAuthContext(
    new Request('http://localhost:3000/api/mcp', {
      method: 'POST',
      headers: { authorization: `Bearer ${principalId}` },
    })
  )

describe.skipIf(!fixture.available)('MCP OAuth and a paused seat (real DB)', () => {
  beforeEach(async () => {
    await fixture.begin()
    hoisted.paused.clear()
    hoisted.asked = []
  })
  afterEach(() => fixture.rollback())

  it('resolves a paused teammate as a portal user with no permissions', async () => {
    const paused = await addTeammate('admin')
    const kept = await addTeammate('admin')
    hoisted.paused.add(paused)

    const pausedCtx = await resolve(paused)
    expect(pausedCtx).not.toBeInstanceOf(Response)
    expect(pausedCtx).toMatchObject({ principalId: paused, role: 'user', authMethod: 'oauth' })
    expect([...((pausedCtx as unknown as { permissions: Set<string> }).permissions ?? [])]).toEqual(
      []
    )

    const keptCtx = await resolve(kept)
    expect(keptCtx).toMatchObject({ principalId: kept, role: 'admin' })
    expect((keptCtx as unknown as { permissions: Set<string> }).permissions.size).toBeGreaterThan(0)
    expect(hoisted.asked).toEqual(expect.arrayContaining([paused, kept]))
  })
})
