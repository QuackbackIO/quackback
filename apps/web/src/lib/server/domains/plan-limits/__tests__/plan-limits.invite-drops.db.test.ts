/**
 * The seat and integration writes that live outside the domain services drop
 * the cached plan limits inputs too: a team invite added (it holds a seat),
 * a team invite cancelled, and an integration disconnected. Each case primes
 * the cache, runs the real code against a real database, and checks the entry
 * is gone.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, generateId, type InviteId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { CACHE_KEYS } from '@/lib/server/cache'
import { eq, integrations, invitation, user } from '@/lib/server/db'

const spies = vi.hoisted(() => ({ cache: new Map<string, unknown>() }))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let schema: { parse: (v: unknown) => unknown } | null = null
    let handler: ((args: { data: unknown }) => Promise<unknown>) | null = null
    const fn = async (args?: { data: unknown }) => {
      if (!handler) throw new Error('handler not registered')
      return handler({ data: schema ? schema.parse(args?.data) : args?.data })
    }
    fn.validator = (s: { parse: (v: unknown) => unknown }) => {
      schema = s
      return fn
    }
    fn.handler = (h: (args: { data: unknown }) => Promise<unknown>) => {
      handler = h
      return fn
    }
    return fn
  },
}))
vi.mock('@/lib/server/functions/auth-helpers', async (original) => ({
  ...(await original<typeof import('@/lib/server/functions/auth-helpers')>()),
  requireAuth: async () => ({ permissions: [] }),
}))
vi.mock('@/lib/server/cache', async (original) => ({
  ...(await original<typeof import('@/lib/server/cache')>()),
  cacheGet: async (key: string) =>
    spies.cache.has(key) ? structuredClone(spies.cache.get(key)) : null,
  cacheSet: async (key: string, value: unknown) => {
    spies.cache.set(key, structuredClone(value))
  },
  cacheDel: async (...keys: string[]) => {
    for (const key of keys) spies.cache.delete(key)
  },
}))
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
// No provider to call on disconnect, no shared install registry, and no
// magic links to revoke.
vi.mock('@/lib/server/integrations', () => ({ getIntegration: () => undefined }))
vi.mock('@/lib/server/integrations/install-registry', () => ({ unregisterInstall: async () => {} }))
vi.mock('@/lib/server/auth/magic-link-mint', async (original) => ({
  ...(await original<typeof import('@/lib/server/auth/magic-link-mint')>()),
  revokeMagicLinkTokens: async () => {},
}))

import { insertTeamInvites } from '@/lib/server/domains/principals/team-invitation'
import { cancelInvitationFn } from '@/lib/server/functions/admin'
import { deleteIntegrationFn } from '@/lib/server/functions/integrations'
import { ensureSettings } from './plan-limits.db-seed'

const fixture = await createDbTestFixture()
afterAll(fixture.close)

const KEY = CACHE_KEYS.PLAN_LIMITS_INPUTS
const prime = () => spies.cache.set(KEY, { usage: { maxTeamSeats: 0 } })

async function addInviter(): Promise<UserId> {
  const id = createId('user') as UserId
  await testDb.insert(user).values({ id, name: 'Acme Inviter', email: `${id}@example.com` })
  return id
}

describe.skipIf(!fixture.available)(
  'plan limits drops for invites and integrations (real DB)',
  () => {
    beforeEach(async () => {
      await fixture.begin()
      spies.cache.clear()
      await ensureSettings()
    })
    afterEach(() => fixture.rollback())

    it('drops when a team invite is added', async () => {
      const inviterId = await addInviter()
      const invitationId = generateId('invite') as InviteId
      prime()
      await testDb.transaction(async (tx) => {
        await insertTeamInvites(
          tx,
          [
            {
              invitationId,
              email: `${invitationId}@example.com`,
              inviteLink: 'https://acme.example.com/invite',
              magicLinkToken: `token-${invitationId}`,
              minted: {} as never,
            },
          ],
          { role: 'member', inviterId }
        )
      })
      const [row] = await testDb.select().from(invitation).where(eq(invitation.id, invitationId))
      expect(row?.status).toBe('pending')
      expect(spies.cache.has(KEY)).toBe(false)
    })

    it('drops when a team invite is cancelled', async () => {
      const inviterId = await addInviter()
      const invitationId = generateId('invite') as InviteId
      await testDb.insert(invitation).values({
        id: invitationId,
        email: `${invitationId}@example.com`,
        role: 'member',
        status: 'pending',
        kind: 'team',
        inviterId,
        expiresAt: new Date(Date.now() + 86_400_000),
        magicLinkTokens: [],
      } as never)
      prime()
      await cancelInvitationFn({ data: { invitationId } })
      const [row] = await testDb.select().from(invitation).where(eq(invitation.id, invitationId))
      expect(row?.status).toBe('canceled')
      expect(spies.cache.has(KEY)).toBe(false)
    })

    it('drops when an integration is disconnected', async () => {
      const [row] = await testDb
        .insert(integrations)
        .values({
          integrationType: `acme_${createId('user').slice(-12)}`,
          status: 'active',
        } as never)
        .returning({ id: integrations.id })
      prime()
      await deleteIntegrationFn({ data: { id: row!.id } })
      expect(await testDb.select().from(integrations).where(eq(integrations.id, row!.id))).toEqual(
        []
      )
      expect(spies.cache.has(KEY)).toBe(false)
    })
  }
)
