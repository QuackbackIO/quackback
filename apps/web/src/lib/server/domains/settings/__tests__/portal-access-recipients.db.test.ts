/**
 * The portal gate asked of announcement recipients rather than of a request:
 * on a private portal only the people with a grant (teammate, verified email
 * on an allowed domain, accepted portal invite, allowed segment, widget
 * handoff with widget sign-in on) are let through; a public portal lets
 * everyone through. Runs against the real database inside the fixture's
 * rolled-back transaction; the portal config is the one thing mocked.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const portal = vi.hoisted(() => ({ config: {} as Record<string, unknown> }))
vi.mock('../settings.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../settings.service')>()),
  getPortalConfig: async () => portal.config,
}))

import {
  invitation,
  principal,
  segments,
  session,
  user,
  userSegments,
  widgetOriginSession,
} from '@/lib/server/db'
import { createId, type PrincipalId, type SegmentId, type UserId } from '@quackback/ids'
import { principalsWithPortalAccess } from '../portal-access.recipients'

const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const SEGMENT = createId('segment') as SegmentId

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: widgetOriginSession.sessionId }).from(widgetOriginSession).limit(0)
  },
})

interface Person {
  principalId: PrincipalId
  userId: UserId
}

async function person(
  name: string,
  opts: { domain?: string; verified?: boolean; role?: 'admin' | 'member' | 'user' } = {}
): Promise<Person> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({
    id: userId,
    name,
    email: `${name}-${run}@${opts.domain ?? 'outside.example'}`,
    emailVerified: opts.verified ?? true,
  })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: opts.role ?? 'user', createdAt: new Date() })
  return { principalId, userId }
}

function privatePortal(access: Record<string, unknown> = {}) {
  portal.config = {
    access: {
      visibility: 'private',
      allowedDomains: [],
      allowedSegmentIds: [],
      widgetSignIn: false,
      ...access,
    },
  }
}

describe.skipIf(!fixture.available)('principalsWithPortalAccess', () => {
  beforeEach(async () => {
    await fixture.begin()
    portal.config = { access: { visibility: 'public' } }
    await testDb.insert(segments).values({ id: SEGMENT, name: `pa-${run}`, slug: `pa-${run}` })
  })
  afterEach(() => fixture.rollback())
  afterAll(fixture.close)

  it('lets everyone through a public portal', async () => {
    const a = await person('a')
    const b = await person('b', { verified: false })
    const granted = await principalsWithPortalAccess([a.principalId, b.principalId])
    expect([...granted].sort()).toEqual([a.principalId, b.principalId].sort())
  })

  it('lets teammates through a private portal and turns a plain customer away', async () => {
    privatePortal()
    const admin = await person('admin', { role: 'admin' })
    const member = await person('member', { role: 'member' })
    const customer = await person('customer')
    const granted = await principalsWithPortalAccess([
      admin.principalId,
      member.principalId,
      customer.principalId,
    ])
    expect([...granted].sort()).toEqual([admin.principalId, member.principalId].sort())
  })

  it('lets a verified email on an allowed domain through, but not an unverified one', async () => {
    privatePortal({ allowedDomains: ['acme.example'] })
    const verified = await person('verified', { domain: 'acme.example' })
    const unverified = await person('unverified', { domain: 'acme.example', verified: false })
    const granted = await principalsWithPortalAccess([verified.principalId, unverified.principalId])
    expect([...granted]).toEqual([verified.principalId])
  })

  it('lets someone with an accepted portal invite through, but not a pending one', async () => {
    privatePortal()
    const accepted = await person('accepted')
    const pending = await person('pending')
    const inviter = await person('inviter', { role: 'admin' })
    await testDb.insert(invitation).values([
      {
        email: `accepted-${run}@outside.example`,
        kind: 'portal',
        status: 'accepted',
        expiresAt: new Date(Date.now() - 1000),
        inviterId: inviter.userId,
      },
      {
        email: `pending-${run}@outside.example`,
        kind: 'portal',
        status: 'pending',
        expiresAt: new Date(Date.now() + 86_400_000),
        inviterId: inviter.userId,
      },
    ])
    const granted = await principalsWithPortalAccess([accepted.principalId, pending.principalId])
    expect([...granted]).toEqual([accepted.principalId])
  })

  it('lets a member of an allowed segment through', async () => {
    privatePortal({ allowedSegmentIds: [SEGMENT] })
    const inside = await person('inside')
    const outside = await person('outside')
    await testDb
      .insert(userSegments)
      .values({ principalId: inside.principalId, segmentId: SEGMENT, addedBy: 'manual' })
    const granted = await principalsWithPortalAccess([inside.principalId, outside.principalId])
    expect([...granted]).toEqual([inside.principalId])
  })

  it('lets a live widget-handoff session through only while widget sign-in is on', async () => {
    const handedOff = await person('handed')
    const expired = await person('expired')
    const sessions = [
      { who: handedOff, expiresAt: new Date(Date.now() + 86_400_000) },
      { who: expired, expiresAt: new Date(Date.now() - 1000) },
    ]
    for (const { who, expiresAt } of sessions) {
      const sessionId = `s-${createId('user')}`
      await testDb.insert(session).values({
        id: sessionId,
        userId: who.userId,
        token: `t-${sessionId}`,
        expiresAt,
        updatedAt: new Date(),
        scope: 'portal',
      })
      await testDb.insert(widgetOriginSession).values({ sessionId, userId: who.userId })
    }
    const ids = [handedOff.principalId, expired.principalId]

    privatePortal({ widgetSignIn: true })
    expect([...(await principalsWithPortalAccess(ids))]).toEqual([handedOff.principalId])

    privatePortal({ widgetSignIn: false })
    expect([...(await principalsWithPortalAccess(ids))]).toEqual([])
  })
})
