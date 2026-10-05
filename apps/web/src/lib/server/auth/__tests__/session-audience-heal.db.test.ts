/**
 * Healing portal anonymous sessions that carry the widget scope.
 *
 * A portal visitor holding a widget-tagged anonymous session as the site
 * cookie is refused by every site surface, and never re-mints because a
 * session already exists. The heal retags exactly those sessions as portal,
 * on the real session table, and leaves every other session alone: a widget
 * Bearer, an identified user's widget session, and non-widget scopes.
 *
 * Runs inside the db-test-fixture rollback transaction; the global `db` is
 * rebound to it so the real UPDATE runs unmodified.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, session, user } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { healStrandedPortalSession } from '../session-audience'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: session.id, scope: session.scope }).from(session).limit(0)
    await db.select({ id: user.id, anon: user.isAnonymous }).from(user).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seed(opts: { anonymous: boolean; scope: string }) {
  const userId = createId('user') as UserId
  await testDb.insert(user).values({ id: userId, name: 'Visitor', isAnonymous: opts.anonymous })
  const id = `sess-${suffix()}`
  const token = `tok-${suffix()}`
  await testDb.insert(session).values({
    id,
    token,
    userId,
    scope: opts.scope,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    updatedAt: new Date(),
  })
  return {
    token,
    resolved: { session: { id, scope: opts.scope }, user: { isAnonymous: opts.anonymous } },
  }
}

async function storedScope(id: string) {
  const [row] = await testDb
    .select({ scope: session.scope })
    .from(session)
    .where(eq(session.id, id))
  return row?.scope
}

const viaCookie = (token: string, name = 'better-auth.session_token') =>
  new Headers({ cookie: `theme=dark; ${name}=${token}.sig` })
const viaBearer = (token: string) => new Headers({ authorization: `Bearer ${token}` })

describe.skipIf(!fixture.available)('healStrandedPortalSession (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('retags a cookie-borne anonymous widget session as portal', async () => {
    const { token, resolved } = await seed({ anonymous: true, scope: 'widget' })

    const healed = await healStrandedPortalSession(resolved, viaCookie(token))

    expect(healed.session.scope).toBe('portal')
    expect(await storedScope(resolved.session.id)).toBe('portal')
  })

  it('recognises the secure-prefixed cookie name', async () => {
    const { token, resolved } = await seed({ anonymous: true, scope: 'widget' })

    const healed = await healStrandedPortalSession(
      resolved,
      viaCookie(token, '__Secure-better-auth.session_token')
    )

    expect(healed.session.scope).toBe('portal')
    expect(await storedScope(resolved.session.id)).toBe('portal')
  })

  it('leaves a widget Bearer session as widget', async () => {
    const { token, resolved } = await seed({ anonymous: true, scope: 'widget' })

    const result = await healStrandedPortalSession(resolved, viaBearer(token))

    expect(result).toBe(resolved)
    expect(await storedScope(resolved.session.id)).toBe('widget')
  })

  it('leaves an identified widget session as widget even when sent as a cookie', async () => {
    const { token, resolved } = await seed({ anonymous: false, scope: 'widget' })

    const result = await healStrandedPortalSession(resolved, viaCookie(token))

    expect(result).toBe(resolved)
    expect(await storedScope(resolved.session.id)).toBe('widget')
  })

  it('leaves dashboard and portal sessions untouched', async () => {
    for (const scope of ['dashboard', 'portal']) {
      const { token, resolved } = await seed({ anonymous: true, scope })

      const result = await healStrandedPortalSession(resolved, viaCookie(token))

      expect(result).toBe(resolved)
      expect(await storedScope(resolved.session.id)).toBe(scope)
    }
  })
})
